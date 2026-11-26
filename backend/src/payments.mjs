// Paiements : webhooks Stripe (signés, dédupliqués, tolérants au désordre), rapprochement à partir
// de l'état relu chez Stripe, balayage des réservations, ventes de l'ancien lien 1.0, remboursements
// et import des ventes passées. Un remboursement ne remet jamais une pièce en stock.
import { all, audit, batch, fail, getSettings, newReference, one, sql, uuid } from './lib.mjs';
import { emailHash, sealContact } from './security.mjs';
import { emailReady, validEmail } from './email.mjs';
import { intentStatement, processMailIntents } from './intents.mjs';
import { assertZone, orderItems, releaseStatements, validSession } from './commerce.mjs';
import { sessionParams, verifyStripeSignature } from './stripe.mjs';
import { afterSale } from './notify.mjs';
import { COST, fits } from './budget.mjs';

// Produit vendu par l'ancien lien 1.0 : déduit de la table de correspondance, jamais supposé.
const LEGACY_PRODUCT = '(SELECT v.product_id FROM legacy_link_sizes l JOIN variants v ON v.sku = l.sku ORDER BY l.value LIMIT 1)';

const SESSION_EVENTS = new Set(['checkout.session.completed', 'checkout.session.expired',
  'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed']);

export async function handleStripeWebhook(env, raw, signature, deps) {
  const { db } = env;
  const now = deps.now();
  if (!deps.stripe) throw fail('not_configured');
  const event = await verifyStripeSignature(raw, signature, env.STRIPE_WEBHOOK_SECRET, now, deps.stripe.live);
  if (await one(db, 'SELECT 1 AS seen FROM processed_events WHERE event_id = ?', event.id)) {
    await processMailIntents(env, deps, { limit: 2 }); // renvoi : occasion de reprendre un e-mail en attente
    return { duplicate: true };
  }
  const object = event.data?.object ?? {};
  if (SESSION_EVENTS.has(event.type)) {
    const session = await deps.stripe.retrieveSession(object.id); // l'état réel fait foi, jamais l'événement
    if (session.payment_link) await recordLegacyLinkSale(env, session, deps, { eventCreated: Number.isSafeInteger(event.created) ? event.created : null });
    else await reconcileSession(env, session, deps);
  } else if (event.type === 'charge.refunded') {
    await recordRefunds(env, await deps.stripe.retrieveCharge(object.id), deps);
  } else if (event.type === 'charge.dispute.created') {
    await deps.notify({ kind: 'dispute', ref: String(object.id ?? event.id), level: 'critical',
      title: 'Litige bancaire ouvert', body: 'Un client conteste un paiement. Réponse à préparer dans Stripe.' });
  }
  await batch(db, [sql(db, `INSERT INTO processed_events (event_id, type, at) VALUES (?, ?, ?)
    ON CONFLICT (event_id) DO NOTHING`, event.id, event.type, now)]);
  await processMailIntents(env, deps, { limit: 2 });
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
// Frais Stripe réels du paiement (transaction de solde de la charge), sinon inconnus (null).
const stripeFee = (s) => {
  const fee = s.payment_intent?.latest_charge?.balance_transaction?.fee;
  return Number.isSafeInteger(fee) && fee >= 0 ? fee : null;
};

function contactFrom(session) {
  const details = session.customer_details ?? {};
  const shipping = session.collected_information?.shipping_details ?? session.shipping_details ?? null;
  const recipient = (session.custom_fields ?? []).find((f) => f.key === 'recipient_name')?.text?.value ?? null;
  return { name: details.name ?? null, email: details.email ?? null, phone: details.phone ?? null,
    shipping_name: shipping?.name ?? null, recipient_name: recipient, address: shipping?.address ?? null };
}

// Adresse saisie sur Stripe hors de la zone livrée (Corse, outre-mer…) : jamais d'envoi ni de
// remboursement automatique, la commande passe « à vérifier ».
async function outOfZone(db, order, contact) {
  if (order.shipping_method !== 'home') return false;
  const settings = await getSettings(db);
  const address = contact.address ?? {};
  try {
    assertZone(settings, String(address.country ?? ''), String(address.postal_code ?? ''));
    return false;
  } catch {
    return true;
  }
}

// Vente confirmée : réservations converties (ou pièce reprise si encore libre), numéro attribué.
// Commande non expédiable en l'état (adresse hors zone, coordonnées non chiffrées) : « à vérifier »,
// pièce gardée pour elle, aucune étiquette ni remboursement automatique.
async function confirmSale(env, order, session, deps) {
  const { db } = env;
  const now = deps.now();
  const contact = contactFrom(session);
  const sealed = await sealContact(env, contact, order.id);
  const zoneProblem = await outOfZone(db, order, contact);
  const reviewReason = zoneProblem ? 'address_out_of_zone' : !sealed ? 'contact_not_sealed' : null;
  // Confirmation au client : intention durable écrite avec la vente (V13-B1), seulement si l'adresse
  // est enregistrée chiffrée et l'envoi configuré. Mise en file ensuite, reprise en cas de panne.
  const confirmation = `order_confirmation:${order.id}`;
  const wantsConfirmation = Boolean(sealed && validEmail(contact.email) && emailReady(env) && env.PUBLIC_ORIGIN);
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
    sql(db, `INSERT INTO order_contacts (order_id, sealed, email_hash, created_at) SELECT ?, ?, ?, ? WHERE ? IS NOT NULL
      ON CONFLICT (order_id) DO NOTHING`, order.id, sealed, contact.email ? await emailHash(env, contact.email) : null, now, sealed),
    sql(db, 'UPDATE orders SET stripe_fee_cents = COALESCE(stripe_fee_cents, ?) WHERE id = ?', stripeFee(session), order.id),
    sql(db, `UPDATE orders SET review_reason = COALESCE(review_reason, ?), updated_at = ?
      WHERE id = ? AND paid_at = ? AND ? IS NOT NULL`, reviewReason, now, order.id, now, reviewReason),
    sql(db, `UPDATE orders SET status = 'review', updated_at = ? WHERE id = ? AND status = 'paid' AND ? IS NOT NULL
      AND paid_at = ?`, now, order.id, reviewReason, now),
    ...(wantsConfirmation ? [intentStatement(db, { kind: 'order_confirmation', dedupe: confirmation, ref: order.id, now,
      when: `EXISTS (SELECT 1 FROM orders WHERE id = ? AND paid_at = ? AND status IN ('paid', 'paid_no_stock', 'review'))`,
      params: [order.id, now] })] : []),
  ]);
  const after = await one(db, 'SELECT status, paid_at FROM orders WHERE id = ?', order.id);
  const justPaid = after.paid_at === now;
  if (justPaid && reviewReason === 'address_out_of_zone') {
    await deps.notify({ kind: 'address_out_of_zone', ref: order.id, level: 'critical', title: 'Adresse hors zone livrée',
      body: `Commande ${order.reference} payée avec une adresse hors zone. Pièce réservée à cette commande ; décision manuelle, aucun remboursement automatique.` });
  } else if (justPaid && reviewReason === 'contact_not_sealed') {
    await deps.notify({ kind: 'contact_not_sealed', ref: order.id, level: 'critical', title: 'Coordonnées non enregistrées',
      body: `Commande ${order.reference} : la clé de chiffrement est absente ou invalide. Commande à vérifier avant expédition (adresse visible dans Stripe).` });
  }
  if (after.status === 'paid_no_stock') {
    await deps.notify({ kind: 'paid_without_stock', ref: order.id, level: 'critical',
      title: 'Commande payée sans pièce disponible', body: `Commande ${order.reference} : décision manuelle (aucun remboursement automatique).` });
  } else if (after.status === 'paid') {
    await afterSale(env, order.id, deps);
  } else if (after.status === 'review' && justPaid) {
    await afterSale(env, order.id, deps, { announce: false });
  }
  // Mise en file de la confirmation, à chaque passage (premier webhook, renvoi, autre événement) :
  // sans effet si elle est déjà en file ; une panne laisse l'intention en attente, jamais perdue.
  await processMailIntents(env, deps, { only: confirmation });
  return { status: after.status };
}

// Filet de sécurité : vente arrivée par l'ancien lien de paiement 1.0 sur le même compte Stripe.
// Reconnue seulement si le lien ET le prix sont ceux enregistrés dans STUDIO, avec une seule ligne,
// une quantité de 1, le prix du catalogue et l'euro. Sinon : « à vérifier », sans taille supposée.
// Imputation selon l'instant réel du règlement (création de la charge Stripe) et l'inventaire :
//  - inventaire de la taille non confirmé : historique sans effet (le comptage la reflète) ;
//  - réglée après l'inventaire : décomptée une fois (« payée sans pièce » si plus rien n'est libre) ;
//  - réglée plus de 24 h avant l'inventaire : déjà reflétée par le comptage ;
//  - réglée dans les 24 h qui précèdent l'inventaire, ou instant inconnu : pièce retirée par
//    prudence et commande « à vérifier » (le fondateur indique si elle était déjà mise de côté).
// Une même session n'est jamais enregistrée deux fois (session Stripe unique en base).
const LEGACY_REVIEW_TEXT = {
  unknown_link: 'lien de paiement non reconnu', link_not_configured: 'lien 1.0 non enregistré dans STUDIO',
  lines: 'lignes de paiement inattendues', size: 'taille non reconnue', quantity: 'quantité différente de 1',
  price: 'prix différent du catalogue', currency: 'devise autre que l’euro',
  settled_near_inventory: 'réglée peu avant l’inventaire : pièce retirée par prudence',
  settlement_unknown: 'instant du règlement inconnu : pièce retirée par prudence',
};
export const legacyReviewText = (reason) => String(reason ?? '').split(',').filter(Boolean)
  .map((r) => LEGACY_REVIEW_TEXT[r] ?? r).join(' ; ');

export async function recordLegacyLinkSale(env, session, deps, { eventCreated = null } = {}) {
  const { db } = env;
  const now = deps.now();
  if (!(session.status === 'complete' && session.payment_status === 'paid')) return { status: 'ignored' };
  if (await one(db, 'SELECT id FROM orders WHERE stripe_session_id = ?', session.id)) return { status: 'duplicate' };
  const settings = await getSettings(db);
  const problems = new Set();
  if (!settings.legacy_payment_link_id || !settings.legacy_link_price_id) problems.add('link_not_configured');
  else if (session.payment_link !== settings.legacy_payment_link_id) problems.add('unknown_link');
  const lines = session.line_items?.data;
  const line = Array.isArray(lines) && lines.length === 1 && !session.line_items?.has_more ? lines[0] : null;
  const field = (session.custom_fields ?? []).find((f) => f.key === settings.legacy_link_size_field);
  const value = String(field?.dropdown?.value ?? '').trim().toLowerCase();
  const map = value ? await one(db, `SELECT l.sku, v.product_id, p.price_cents, i.confirmed_at FROM legacy_link_sizes l
      JOIN variants v ON v.sku = l.sku JOIN products p ON p.id = v.product_id JOIN inventory i ON i.sku = l.sku
      WHERE l.value = ?`, value) : null;
  if (!map) problems.add('size');
  if (!line) problems.add('lines');
  else {
    if (line.quantity !== 1) problems.add('quantity');
    if (settings.legacy_link_price_id && line.price?.id !== settings.legacy_link_price_id) problems.add('price');
    if (map && line.price?.unit_amount !== map.price_cents) problems.add('price');
    if (String(line.price?.currency ?? '').toLowerCase() !== 'eur') problems.add('currency');
  }
  if (String(session.currency ?? '').toLowerCase() !== 'eur') problems.add('currency');

  // Instant du règlement : création de la charge réussie (Stripe). Borne haute : l'événement signé.
  const charge = typeof session.payment_intent === 'object' ? session.payment_intent?.latest_charge : null;
  const settledAt = Number.isSafeInteger(charge?.created) ? charge.created : null;
  const window = Number(settings.legacy_review_window_seconds || 86400);
  let treatment = 'none';
  if (map) {
    const count = map.confirmed_at;
    if (count === null) treatment = 'history';
    else if ((Number.isSafeInteger(session.created) && session.created >= count) || (settledAt !== null && settledAt >= count)) treatment = 'count';
    else if ((settledAt ?? eventCreated) !== null && (settledAt ?? eventCreated) < count - window) treatment = 'history';
    else {
      treatment = 'hold';
      problems.add(settledAt === null ? 'settlement_unknown' : 'settled_near_inventory');
    }
    // Non conforme mais vendue après l'inventaire : la pièce est retirée, la commande reste à vérifier.
    if (treatment === 'count' && problems.size) treatment = 'hold';
  }
  const reason = [...problems].join(',') || null;
  const id = uuid();
  const reference = newReference();
  const paidAt = settledAt ?? (Number.isSafeInteger(eventCreated) ? eventCreated : now);
  const ref = `link:${session.id}`;
  const statements = [];
  // Quantité payée (1 attendue) : autant de pièces retirées, seulement si elles sont libres.
  const qty = Number.isSafeInteger(line?.quantity) && line.quantity >= 1 && line.quantity <= 10 ? line.quantity : 1;
  if (treatment === 'count' || treatment === 'hold') {
    statements.push(sql(db, `INSERT INTO stock_movements (sku, d_on_hand, d_reserved, reason, ref, note, at)
        SELECT ?, ?, 0, 'legacy_link_sale', ?, ?, ? WHERE (SELECT on_hand - reserved FROM inventory WHERE sku = ?) >= ?`,
    map.sku, -qty, ref, treatment === 'hold' ? 'Vente 1.0 à vérifier : pièce retirée par prudence' : 'Vente 1.0 après inventaire', now, map.sku, qty));
  } else if (treatment === 'history') {
    statements.push(sql(db, `INSERT INTO stock_movements (sku, d_on_hand, d_reserved, reason, ref, note, at)
        VALUES (?, 0, 0, 'imported_sale', ?, 'Vente 1.0 reflétée par l’inventaire', ?)`, map.sku, ref, now));
  }
  const withStock = treatment === 'count' || treatment === 'hold';
  statements.push(sql(db, `INSERT INTO orders (id, reference, source, status, review_reason, subtotal_cents, shipping_cents, total_cents,
      currency, stripe_session_id, stripe_payment_intent, customer_name, created_at, paid_at, updated_at)
    VALUES (?, ?, 'legacy_link', CASE
        WHEN ? = 1 AND NOT EXISTS (SELECT 1 FROM stock_movements WHERE ref = ?) THEN 'paid_no_stock'
        WHEN ? IS NOT NULL THEN 'review' ELSE 'paid' END,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  id, reference, withStock ? 1 : 0, ref, reason, reason, Math.max(session.amount_subtotal ?? session.amount_total ?? 0, 0),
  Math.max(session.total_details?.amount_shipping ?? 0, 0), Math.max(session.amount_total ?? 0, 0), String(session.currency ?? 'eur').toLowerCase(),
  session.id, paymentIntentId(session), session.customer_details?.name ?? null, now, paidAt, now));
  statements.push(sql(db, `INSERT INTO order_items (order_id, line, product_id, sku, quantity, unit_price_cents)
    SELECT ?, 1, COALESCE(?, ${LEGACY_PRODUCT}), ?, ?, ?`, id, map?.product_id, map?.sku,
  qty, Math.max(line?.price?.unit_amount ?? map?.price_cents ?? session.amount_subtotal ?? 0, 0)));
  statements.push(sql(db, `UPDATE orders SET number = (SELECT COALESCE(MAX(number), 0) + 1 FROM orders)
    WHERE id = ? AND number IS NULL`, id));
  const legacyContact = contactFrom(session);
  const sealed = await sealContact(env, legacyContact, id);
  if (sealed) statements.push(sql(db, 'INSERT INTO order_contacts (order_id, sealed, email_hash, created_at) VALUES (?, ?, ?, ?)', id, sealed,
    legacyContact.email ? await emailHash(env, legacyContact.email) : null, now));
  statements.push(sql(db, 'UPDATE orders SET stripe_fee_cents = ? WHERE id = ?', stripeFee(session), id));
  statements.push(audit(db, now, 'stripe', 'legacy_link_sale', reference, `${treatment}${reason ? `:${reason}` : ''}`));
  try {
    await batch(db, statements);
  } catch (error) {
    if (error.dbCode === 'unique_failed') return { status: 'duplicate' };
    throw error;
  }
  const order = await one(db, 'SELECT status, reference FROM orders WHERE id = ?', id);
  if (order.status === 'paid_no_stock') {
    await deps.notify({ kind: 'legacy_link_without_stock', ref: session.id, level: 'critical',
      title: 'Vente 1.0 sans pièce libre', body: `Commande ${order.reference} : décision manuelle nécessaire.${reason ? ` À vérifier aussi : ${legacyReviewText(reason)}.` : ''}` });
  } else if (order.status === 'review') {
    await deps.notify({ kind: 'legacy_link_review', ref: session.id, level: 'critical',
      title: 'Vente 1.0 à vérifier', body: `Commande ${order.reference} : ${legacyReviewText(reason)}. À valider dans STUDIO avant préparation.` });
  } else if (treatment === 'count') {
    await afterSale(env, id, deps);
  } else {
    await deps.notify({ kind: 'legacy_link_sale', ref: session.id, level: 'info',
      title: 'Vente 1.0 enregistrée', body: `Commande ${order.reference} : antérieure à l'inventaire, sans effet sur le stock.` });
  }
  return { status: order.status, treatment };
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

// Balayage (chaque minute) : sessions expirées ou incertaines.
//  - Session incertaine pendant la réservation : retrouvée par sa clé et CONSERVÉE (le client qui
//    réessaie avec la même clé reçoit la même session) ; jamais de seconde session.
//  - Réservation échue : on ferme d'abord la session chez Stripe, on relit son état, puis on vend
//    ou on libère. Stripe muet : la pièce reste gardée.
export async function sweep(env, deps, limit = 20) {
  const { db } = env;
  const now = deps.now();
  if (!deps.stripe) return { released: 0, checked: 0, recovered: 0 };
  const rows = await all(db, `SELECT * FROM orders WHERE status = 'pending' AND (expires_at <= ? OR needs_stripe_check = 1)
    ORDER BY created_at LIMIT ?`, now, limit);
  let released = 0;
  let recovered = 0;
  let checked = 0;
  for (const order of rows) {
    // Invocation comptée : chaque commande peut aller jusqu'au rattrapage d'une vente (pire cas).
    if (!fits(deps, COST.sweepOrder)) break; // commandes restantes à la minute suivante
    checked += 1;
    try {
      const running = order.expires_at > now;
      let sid = order.stripe_session_id;
      if (!sid) {
        let found;
        try {
          const items = await orderItems(db, order.id);
          found = await deps.stripe.createCheckoutSession(sessionParams(order, items, env.PUBLIC_ORIGIN), `sayless-checkout-${order.id}`);
        } catch (error) {
          if (!error.definite) continue;
          // Refus explicite : aucune session n'existe pour cette clé, la pièce peut revenir.
          await batch(db, [...releaseStatements(db, order.id, now, 'expired'),
            audit(db, now, 'system', 'uncertain_session_closed', order.reference, `stripe_${error.status}`)]);
          released += 1;
          continue;
        }
        sid = found.id;
        const keep = running && validSession(found, order);
        await batch(db, [sql(db, `UPDATE orders SET stripe_session_id = ?, stripe_session_url = ?, needs_stripe_check = ?, updated_at = ?
          WHERE id = ? AND stripe_session_id IS NULL`, found.id, found.url, keep ? 0 : 1, now, order.id)]);
        if (keep) {
          recovered += 1;
          continue;
        }
      } else if (running) {
        const current = await deps.stripe.retrieveSession(sid);
        if (current.status === 'open' && validSession(current, order)) {
          await batch(db, [sql(db, 'UPDATE orders SET needs_stripe_check = 0, updated_at = ? WHERE id = ?', now, order.id)]);
          recovered += 1;
          continue;
        }
        if (current.status !== 'open') {
          await reconcileSession(env, current, deps);
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
  return { released, checked, recovered };
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
