// Paiements : webhooks Stripe (signés, dédupliqués, tolérants au désordre), rapprochement à partir
// de l'état relu chez Stripe, balayage des réservations, ventes de l'ancien lien 1.0, remboursements
// et import des ventes passées. Un remboursement ne remet jamais une pièce en stock.
import { all, audit, batch, fail, getSettings, newReference, one, sql, uuid } from './lib.mjs';
import { sealContact } from './security.mjs';
import { orderItems, releaseStatements } from './commerce.mjs';
import { sessionParams, verifyStripeSignature } from './stripe.mjs';
import { afterSale } from './notify.mjs';

// Produit vendu par l'ancien lien 1.0 : déduit de la table de correspondance, jamais supposé.
const LEGACY_PRODUCT = '(SELECT v.product_id FROM legacy_link_sizes l JOIN variants v ON v.sku = l.sku ORDER BY l.value LIMIT 1)';

const SESSION_EVENTS = new Set(['checkout.session.completed', 'checkout.session.expired',
  'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed']);

export async function handleStripeWebhook(env, raw, signature, deps) {
  const { db } = env;
  const now = deps.now();
  if (!deps.stripe) throw fail('not_configured');
  const event = await verifyStripeSignature(raw, signature, env.STRIPE_WEBHOOK_SECRET, now, deps.stripe.live);
  if (await one(db, 'SELECT 1 AS seen FROM processed_events WHERE event_id = ?', event.id)) return { duplicate: true };
  const object = event.data?.object ?? {};
  if (SESSION_EVENTS.has(event.type)) {
    const session = await deps.stripe.retrieveSession(object.id); // l'état réel fait foi, jamais l'événement
    if (session.payment_link) await recordLegacyLinkSale(env, session, deps);
    else await reconcileSession(env, session, deps);
  } else if (event.type === 'charge.refunded') {
    await recordRefunds(env, await deps.stripe.retrieveCharge(object.id), deps);
  } else if (event.type === 'charge.dispute.created') {
    await deps.notify({ kind: 'dispute', ref: String(object.id ?? event.id), level: 'critical',
      title: 'Litige bancaire ouvert', body: 'Un client conteste un paiement. Réponse à préparer dans Stripe.' });
  }
  await batch(db, [sql(db, `INSERT INTO processed_events (event_id, type, at) VALUES (?, ?, ?)
    ON CONFLICT (event_id) DO NOTHING`, event.id, event.type, now)]);
  return { processed: true };
}

const sessionSku = (line) => line?.price?.product?.metadata?.sku ?? null;

// La session correspond-elle exactement à la commande ? Montant, devise, lignes, référence.
function sessionMismatch(order, items, session) {
  if (session.client_reference_id !== order.id && session.metadata?.sayless_order_id !== order.id) return 'reference';
  if (session.amount_total !== order.total_cents) return 'amount';
  if (String(session.currency).toLowerCase() !== order.currency) return 'currency';
  const lines = session.line_items?.data;
  if (!Array.isArray(lines) || session.line_items?.has_more) return 'lines';
  const got = lines.map((l) => [sessionSku(l), l.quantity, l.price?.unit_amount]).sort().join('|');
  const want = items.map((i) => [i.sku, i.quantity, i.unit_price_cents]).sort().join('|');
  return got === want ? null : 'lines';
}

export async function reconcileSession(env, session, deps) {
  const { db } = env;
  const now = deps.now();
  const orderId = session.metadata?.sayless_order_id ?? session.client_reference_id;
  const order = orderId ? await one(db, 'SELECT * FROM orders WHERE id = ?', orderId) : null;
  if (!order) {
    await deps.notify({ kind: 'unknown_session', ref: String(session.id), level: 'warning',
      title: 'Paiement sans commande connue', body: 'Une session Stripe ne correspond à aucune commande SAYLESS.' });
    return { status: 'unknown' };
  }
  const paid = session.status === 'complete' && session.payment_status === 'paid';
  if (paid) {
    const items = await orderItems(db, order.id);
    const mismatch = sessionMismatch(order, items, session);
    if (mismatch) {
      await batch(db, [
        sql(db, `UPDATE orders SET status = 'review', paid_at = COALESCE(paid_at, ?), stripe_payment_intent = ?,
            stripe_session_id = COALESCE(stripe_session_id, ?), updated_at = ?
          WHERE id = ? AND status IN ('pending', 'awaiting_payment', 'expired', 'failed')`,
        now, paymentIntentId(session), session.id, now, order.id),
        audit(db, now, 'stripe', 'payment_mismatch', order.reference, mismatch),
      ]);
      await deps.notify({ kind: 'payment_mismatch', ref: order.id, level: 'critical',
        title: 'Paiement à vérifier', body: `Commande ${order.reference} : écart « ${mismatch} ». Aucune pièce attribuée automatiquement.` });
      return { status: 'review' };
    }
    return confirmSale(env, order, session, deps);
  }
  if (session.status === 'complete' && session.payment_status === 'unpaid') {
    const intentStatus = typeof session.payment_intent === 'object' ? session.payment_intent?.status : 'processing';
    if (['requires_payment_method', 'canceled'].includes(intentStatus)) {
      await batch(db, releaseStatements(db, order.id, now, 'failed'));
      await deps.notify({ kind: 'payment_failed', ref: order.id, level: 'info',
        title: 'Paiement différé refusé', body: `Commande ${order.reference} : pièce remise en vente.` });
      return { status: 'failed' };
    }
    await batch(db, [
      sql(db, `UPDATE reservations SET status = 'awaiting_payment', updated_at = ? WHERE order_id = ? AND status = 'held'`, now, order.id),
      sql(db, `UPDATE orders SET status = 'awaiting_payment', updated_at = ? WHERE id = ? AND status = 'pending'`, now, order.id),
    ]);
    return { status: 'awaiting_payment' };
  }
  if (session.status === 'expired') {
    await batch(db, releaseStatements(db, order.id, now, 'expired'));
    return { status: 'expired' };
  }
  return { status: 'open' };
}

const paymentIntentId = (s) => (typeof s.payment_intent === 'object' ? s.payment_intent?.id : s.payment_intent) ?? null;

function contactFrom(session) {
  const details = session.customer_details ?? {};
  const shipping = session.collected_information?.shipping_details ?? session.shipping_details ?? null;
  return { name: details.name ?? null, email: details.email ?? null, phone: details.phone ?? null,
    shipping_name: shipping?.name ?? null, address: shipping?.address ?? null };
}

// Vente confirmée : réservations converties (ou pièce reprise si encore libre), numéro attribué.
async function confirmSale(env, order, session, deps) {
  const { db } = env;
  const now = deps.now();
  const contact = contactFrom(session);
  const sealed = await sealContact(env, contact);
  // Les pièces ne sont attribuées qu'une fois, tant que la commande n'est pas déjà tranchée :
  // un renvoi d'événement après une remise en stock ne décompte jamais une seconde fois.
  const open = `(SELECT status FROM orders WHERE id = ?) IN ('pending', 'awaiting_payment', 'expired', 'failed')`;
  await batch(db, [
    sql(db, `UPDATE reservations SET status = 'converted', updated_at = ?
      WHERE order_id = ? AND status IN ('held', 'awaiting_payment') AND ${open}`, now, order.id, order.id),
    sql(db, `UPDATE reservations SET status = 'converted', updated_at = ?
      WHERE order_id = ? AND status = 'released' AND ${open}
        AND NOT EXISTS (SELECT 1 FROM reservations r2 JOIN inventory i ON i.sku = r2.sku
          WHERE r2.order_id = ? AND r2.status = 'released' AND i.on_hand - i.reserved < r2.quantity)`,
    now, order.id, order.id, order.id),
    sql(db, `UPDATE orders SET
        status = CASE WHEN NOT EXISTS (SELECT 1 FROM reservations WHERE order_id = ? AND status <> 'converted')
          THEN 'paid' ELSE 'paid_no_stock' END,
        paid_at = COALESCE(paid_at, ?), stripe_payment_intent = ?, stripe_session_id = COALESCE(stripe_session_id, ?),
        customer_name = COALESCE(customer_name, ?), needs_stripe_check = 0, updated_at = ?
      WHERE id = ? AND status IN ('pending', 'awaiting_payment', 'expired', 'failed')`,
    order.id, now, paymentIntentId(session), session.id, contact.name, now, order.id),
    sql(db, `UPDATE orders SET number = (SELECT COALESCE(MAX(number), 0) + 1 FROM orders)
      WHERE id = ? AND number IS NULL AND paid_at IS NOT NULL`, order.id),
    sql(db, `INSERT INTO order_contacts (order_id, sealed, created_at) SELECT ?, ?, ? WHERE ? IS NOT NULL
      ON CONFLICT (order_id) DO NOTHING`, order.id, sealed, now, sealed),
  ]);
  const after = await one(db, 'SELECT status FROM orders WHERE id = ?', order.id);
  if (!sealed) {
    await deps.notify({ kind: 'technical', ref: 'pii_key_missing', level: 'critical',
      title: 'Clé de chiffrement absente', body: 'Les coordonnées de livraison ne sont pas enregistrées : consulte-les dans Stripe.' });
  }
  if (after.status === 'paid_no_stock') {
    await deps.notify({ kind: 'paid_without_stock', ref: order.id, level: 'critical',
      title: 'Commande payée sans pièce disponible', body: `Commande ${order.reference} : décision manuelle (aucun remboursement automatique).` });
  } else if (after.status === 'paid') {
    await afterSale(env, order.id, deps);
  }
  return { status: after.status };
}

// Filet de sécurité : vente arrivée par l'ancien lien de paiement 1.0 sur le même compte Stripe.
// Avant l'inventaire confirmé de la taille : historique sans effet sur le stock (le comptage la
// reflète). Après : décomptée une fois, ou signalée si plus aucune pièce n'est libre.
export async function recordLegacyLinkSale(env, session, deps) {
  const { db } = env;
  const now = deps.now();
  if (!(session.status === 'complete' && session.payment_status === 'paid')) return { status: 'ignored' };
  if (await one(db, 'SELECT id FROM orders WHERE stripe_session_id = ?', session.id)) return { status: 'duplicate' };
  const settings = await getSettings(db);
  const field = (session.custom_fields ?? []).find((f) => f.key === settings.legacy_link_size_field);
  const value = String(field?.dropdown?.value ?? '').trim().toLowerCase();
  const map = value ? await one(db, `SELECT l.sku, v.product_id, p.price_cents, i.confirmed_at FROM legacy_link_sizes l
      JOIN variants v ON v.sku = l.sku JOIN products p ON p.id = v.product_id JOIN inventory i ON i.sku = l.sku
      WHERE l.value = ?`, value) : null;
  const id = uuid();
  const reference = newReference();
  const paidAt = Number.isFinite(session.created) ? session.created : now;
  const counted = map && map.confirmed_at !== null && paidAt >= map.confirmed_at;
  const ref = `link:${session.id}`;
  const statements = [];
  if (map) {
    statements.push(counted
      ? sql(db, `INSERT INTO stock_movements (sku, d_on_hand, d_reserved, reason, ref, at)
          SELECT ?, -1, 0, 'legacy_link_sale', ?, ? WHERE (SELECT on_hand - reserved FROM inventory WHERE sku = ?) >= 1`,
      map.sku, ref, now, map.sku)
      : sql(db, `INSERT INTO stock_movements (sku, d_on_hand, d_reserved, reason, ref, at)
          VALUES (?, 0, 0, 'imported_sale', ?, ?)`, map.sku, ref, now));
  }
  statements.push(sql(db, `INSERT INTO orders (id, reference, source, status, subtotal_cents, shipping_cents, total_cents,
      currency, stripe_session_id, stripe_payment_intent, customer_name, created_at, paid_at, updated_at)
    VALUES (?, ?, 'legacy_link', CASE WHEN ? = 0 THEN 'review'
        WHEN EXISTS (SELECT 1 FROM stock_movements WHERE ref = ?) THEN 'paid' ELSE 'paid_no_stock' END,
      ?, ?, ?, 'eur', ?, ?, ?, ?, ?, ?)`,
  id, reference, map ? 1 : 0, ref, session.amount_subtotal ?? session.amount_total ?? 0, session.total_details?.amount_shipping ?? 0,
  session.amount_total ?? 0, session.id, paymentIntentId(session), session.customer_details?.name ?? null, now, paidAt, now));
  statements.push(sql(db, `INSERT INTO order_items (order_id, line, product_id, sku, quantity, unit_price_cents)
    SELECT ?, 1, COALESCE(?, ${LEGACY_PRODUCT}), ?, 1, ?`, id, map?.product_id, map?.sku,
  map?.price_cents ?? session.amount_subtotal ?? 0));
  statements.push(sql(db, `UPDATE orders SET number = (SELECT COALESCE(MAX(number), 0) + 1 FROM orders)
    WHERE id = ? AND number IS NULL`, id));
  const sealed = await sealContact(env, contactFrom(session));
  if (sealed) statements.push(sql(db, 'INSERT INTO order_contacts (order_id, sealed, created_at) VALUES (?, ?, ?)', id, sealed, now));
  try {
    await batch(db, statements);
  } catch (error) {
    if (error.dbCode === 'unique_failed') return { status: 'duplicate' };
    throw error;
  }
  const order = await one(db, 'SELECT status, reference FROM orders WHERE id = ?', id);
  if (order.status === 'paid_no_stock') {
    await deps.notify({ kind: 'legacy_link_without_stock', ref: session.id, level: 'critical',
      title: 'Vente 1.0 sans pièce libre', body: `Commande ${order.reference} : décision manuelle nécessaire.` });
  } else if (order.status === 'review') {
    await deps.notify({ kind: 'legacy_link_unknown_size', ref: session.id, level: 'critical',
      title: 'Vente 1.0 sans taille reconnue', body: `Commande ${order.reference} : taille à confirmer avant préparation.` });
  } else if (counted) {
    await afterSale(env, id, deps);
  } else {
    await deps.notify({ kind: 'legacy_link_sale', ref: session.id, level: 'info',
      title: 'Vente 1.0 enregistrée', body: `Commande ${order.reference} : antérieure à l'inventaire, sans effet sur le stock.` });
  }
  return { status: order.status };
}

// Remboursements : enregistrés et rapprochés de la commande. Jamais de remise en stock ici.
export async function recordRefunds(env, charge, deps) {
  const { db } = env;
  const now = deps.now();
  const intent = typeof charge.payment_intent === 'object' ? charge.payment_intent?.id : charge.payment_intent;
  const order = intent ? await one(db, 'SELECT * FROM orders WHERE stripe_payment_intent = ?', intent) : null;
  if (!order) {
    await deps.notify({ kind: 'unknown_refund', ref: String(charge.id), level: 'warning',
      title: 'Remboursement sans commande connue', body: 'Un remboursement Stripe ne correspond à aucune commande.' });
    return { status: 'unknown' };
  }
  const refunds = (charge.refunds?.data ?? []).filter((r) => r.status !== 'failed' && r.status !== 'canceled');
  const statements = refunds.map((r) => sql(db, `INSERT INTO refunds (id, order_id, amount_cents, created_at)
    VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`, r.id, order.id, r.amount, r.created ?? now));
  const refunded = Math.max(charge.amount_refunded ?? 0, order.amount_refunded_cents);
  statements.push(sql(db, `UPDATE orders SET amount_refunded_cents = ?,
      status = CASE WHEN ? >= total_cents THEN 'refunded' ELSE 'partially_refunded' END, updated_at = ?
    WHERE id = ? AND ? > 0 AND status IN ('paid', 'paid_no_stock', 'review', 'partially_refunded')`,
  refunded, refunded, now, order.id, refunded));
  statements.push(audit(db, now, 'stripe', 'refund_recorded', order.reference, `total=${refunded}`));
  await batch(db, statements);
  await deps.notify({ kind: 'refund', ref: `${order.id}:${refunded}`, level: 'info', title: 'Remboursement enregistré',
    body: `Commande ${order.reference}. Stock inchangé : remise en vente seulement après contrôle du retour.` });
  return { status: 'recorded' };
}

// Balayage (chaque minute) : sessions expirées ou incertaines. On ferme d'abord la session chez
// Stripe, on relit son état, puis on vend ou on libère. Stripe muet : la pièce reste gardée.
export async function sweep(env, deps, limit = 20) {
  const { db } = env;
  const now = deps.now();
  if (!deps.stripe) return { released: 0, checked: 0 };
  const rows = await all(db, `SELECT * FROM orders WHERE status = 'pending' AND (expires_at <= ? OR needs_stripe_check = 1)
    ORDER BY created_at LIMIT ?`, now, limit);
  let released = 0;
  for (const order of rows) {
    try {
      let sid = order.stripe_session_id;
      if (!sid) {
        try {
          const items = await orderItems(db, order.id);
          const s = await deps.stripe.createCheckoutSession(sessionParams(order, items, env.PUBLIC_ORIGIN), `sayless-checkout-${order.id}`);
          sid = s.id;
          await batch(db, [sql(db, `UPDATE orders SET stripe_session_id = ?, stripe_session_url = ?, updated_at = ?
            WHERE id = ? AND stripe_session_id IS NULL`, s.id, s.url, now, order.id)]);
        } catch (error) {
          if (!error.definite) continue;
          await batch(db, [...releaseStatements(db, order.id, now, 'expired'),
            audit(db, now, 'system', 'uncertain_session_closed', order.reference, `stripe_${error.status}`)]);
          released += 1;
          continue;
        }
      }
      try {
        await deps.stripe.expireSession(sid, `sayless-expire-${sid}`);
      } catch (error) {
        if (!error.definite) continue; // réseau : rien n'est libéré
      }
      const session = await deps.stripe.retrieveSession(sid);
      const result = await reconcileSession(env, session, deps);
      if (result.status === 'expired') released += 1;
    } catch {
      // Base ou Stripe indisponible pour cette commande : nouvel essai à la minute suivante.
    }
  }
  return { released, checked: rows.length };
}

// Import des ventes passées (saisies par le fondateur dans STUDIO, jamais versionnées).
// Avant l'inventaire confirmé : historique sans effet sur le stock. Après : décomptée une fois.
// Taille inconnue après l'inventaire : commande « à vérifier », aucune taille supposée.
export async function importHistory(env, sales, actor, deps) {
  const { db } = env;
  const now = deps.now();
  const results = [];
  const ordered = [...sales].sort((a, b) => a.paid_at - b.paid_at);
  const start = (await one(db, 'SELECT MIN(confirmed_at) AS t FROM inventory')).t;
  for (const sale of ordered) {
    const key = String(sale.stripe_session_id ?? sale.import_ref ?? '');
    if (!/^[A-Za-z0-9_:-]{6,120}$/.test(key) || !Number.isSafeInteger(sale.amount_cents) || sale.amount_cents < 0
      || !Number.isSafeInteger(sale.paid_at)) throw fail('invalid_request');
    if (await one(db, 'SELECT id FROM orders WHERE stripe_session_id = ?', key)) { results.push('duplicate'); continue; }
    const variant = sale.sku ? await one(db, `SELECT v.sku, v.product_id, i.confirmed_at FROM variants v
      JOIN inventory i ON i.sku = v.sku WHERE v.sku = ?`, sale.sku) : null;
    if (sale.sku && !variant) throw fail('invalid_items');
    const counted = Boolean(variant && variant.confirmed_at !== null && sale.paid_at >= variant.confirmed_at);
    const unknownAfter = !variant && start !== null && sale.paid_at >= start;
    const id = uuid();
    const ref = `import:${key}`;
    const statements = [];
    if (variant) {
      statements.push(counted
        ? sql(db, `INSERT INTO stock_movements (sku, d_on_hand, d_reserved, reason, ref, actor, at)
            SELECT ?, -1, 0, 'legacy_link_sale', ?, ?, ? WHERE (SELECT on_hand - reserved FROM inventory WHERE sku = ?) >= 1`,
        variant.sku, ref, actor, now, variant.sku)
        : sql(db, `INSERT INTO stock_movements (sku, d_on_hand, d_reserved, reason, ref, actor, at)
            VALUES (?, 0, 0, 'imported_sale', ?, ?, ?)`, variant.sku, ref, actor, now));
    }
    statements.push(sql(db, `INSERT INTO orders (id, reference, source, status, subtotal_cents, shipping_cents, total_cents,
        stripe_session_id, stripe_fee_cents, created_at, paid_at, updated_at)
      VALUES (?, ?, 'import', CASE WHEN ? = 1 THEN 'review' WHEN ? = 0 OR EXISTS (SELECT 1 FROM stock_movements WHERE ref = ?)
        THEN 'paid' ELSE 'paid_no_stock' END, ?, 0, ?, ?, ?, ?, ?, ?)`,
    id, newReference(), unknownAfter ? 1 : 0, counted ? 1 : 0, ref, sale.amount_cents, sale.amount_cents, key,
    Number.isSafeInteger(sale.fee_cents) ? sale.fee_cents : null, now, sale.paid_at, now));
    statements.push(sql(db, `INSERT INTO order_items (order_id, line, product_id, sku, quantity, unit_price_cents)
      SELECT ?, 1, COALESCE(?, ${LEGACY_PRODUCT}), ?, 1, ?`, id, variant?.product_id, variant?.sku, sale.amount_cents));
    statements.push(sql(db, `UPDATE orders SET number = (SELECT COALESCE(MAX(number), 0) + 1 FROM orders) WHERE id = ?`, id));
    statements.push(audit(db, now, actor, 'import_sale', key, counted ? 'counted' : unknownAfter ? 'review' : 'history_only'));
    try {
      await batch(db, statements);
      results.push(counted ? 'counted' : unknownAfter ? 'review' : 'history_only');
    } catch (error) {
      if (error.dbCode === 'unique_failed') { results.push('duplicate'); continue; }
      throw error;
    }
  }
  return results;
}
