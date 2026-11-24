// Parcours d'achat côté serveur : devis signé sans donnée personnelle, checkout idempotent avec
// réservation atomique, statut de confirmation. Le navigateur n'envoie jamais de prix.
import {
  all, audit, batch, fail, fromB64url, getSettings, hmacB64, iso, newReference, one, sha256Hex, sql,
  timingSafeEqual, uuid, b64url,
} from './lib.mjs';
import { explainShortage } from './stock.mjs';
import { sessionParams } from './stripe.mjs';

const SKU = /^[A-Z0-9-]{3,40}$/;

// Lignes demandées : SKU uniques, quantités entières. Les paniers de plusieurs pièces restent
// bloqués tant que leur tarification n'est pas validée (max_items_per_order).
export function normalizeItems(items, maxItems) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 10) throw fail('invalid_items');
  const seen = new Set();
  const out = items.map((item) => {
    const sku = item?.sku;
    const quantity = item?.quantity;
    if (typeof sku !== 'string' || !SKU.test(sku) || seen.has(sku) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10) {
      throw fail('invalid_items');
    }
    seen.add(sku);
    return { sku, quantity };
  });
  if (out.reduce((n, i) => n + i.quantity, 0) > maxItems) throw fail('quantity_not_supported', { max_items: maxItems });
  return out.sort((a, b) => a.sku.localeCompare(b.sku));
}

async function priceLines(db, items) {
  const lines = [];
  for (const item of items) {
    const row = await one(db, `SELECT v.sku, v.size, p.id AS product_id, p.name, p.price_cents, p.status
      FROM variants v JOIN products p ON p.id = v.product_id WHERE v.sku = ?`, item.sku);
    if (!row || row.status !== 'published') throw fail('invalid_items');
    lines.push({ ...item, product_id: row.product_id, unit_price_cents: row.price_cents,
      label: `${row.name} — Taille ${row.size}` });
  }
  return lines;
}

async function stockCheck(db, items) {
  for (const item of items) {
    const row = await one(db, 'SELECT on_hand, reserved, confirmed_at FROM inventory WHERE sku = ?', item.sku);
    if (!row || row.confirmed_at === null) throw fail('stock_unavailable');
    if (row.on_hand - row.reserved < item.quantity) throw fail(await explainShortage(db, [item]));
  }
}

// Zone livrée (décision du 24 novembre) : pays autorisés, codes postaux exclus (Corse, outre-mer).
export function assertZone(settings, country, postcode) {
  const countries = String(settings.shipping_countries || 'FR').split(',').map((c) => c.trim()).filter(Boolean);
  const excluded = String(settings.excluded_postcode_prefixes ?? '20,97,98').split(',').map((p) => p.trim()).filter(Boolean);
  if (!countries.includes(country)) throw fail('destination_not_supported');
  if (typeof postcode !== 'string' || !/^\d{5}$/.test(postcode)) throw fail('postcode_required');
  if (excluded.some((prefix) => postcode.startsWith(prefix))) throw fail('destination_not_supported');
}

async function resolveShipping(db, deps, settings, { shipping, relayId, country = 'FR', postcode }) {
  if (!['relay', 'home'].includes(shipping)) throw fail('invalid_request');
  const rate = await one(db, 'SELECT cents, label FROM shipping_rates WHERE method = ?', shipping);
  if (!rate) throw fail('service_unavailable');
  if (shipping === 'home') {
    assertZone(settings, country, postcode);
    return { method: 'home', cents: rate.cents, relay: null, zone: { country, postcode } };
  }
  if (typeof relayId !== 'string' || !relayId.trim()) throw fail('relay_required');
  if (!deps.relays) throw fail('relay_unavailable');
  const relay = await deps.relays.find(relayId);
  if (!relay || relay.open === false) throw fail('invalid_relay');
  assertZone(settings, relay.country, relay.postcode);
  return { method: 'relay', cents: rate.cents, relay: { id: relay.id, label: relay.name, network: relay.network ?? null,
    postcode: relay.postcode, city: relay.city ?? null }, zone: { country: relay.country, postcode: relay.postcode } };
}

// ---------- devis ----------
// Le devis est un jeton signé (HMAC APP_SECRET) : aucune écriture en base, aucune coordonnée.
export async function createQuote(env, body, deps) {
  const { db } = env;
  const now = deps.now();
  if (!env.APP_SECRET) throw fail('not_configured');
  const settings = await getSettings(db).catch(() => { throw fail('service_unavailable'); });
  if (settings.shop_mode !== 'open') throw fail('paused');
  const items = normalizeItems(body.items, Number(settings.max_items_per_order || 1));
  const lines = await priceLines(db, items);
  await stockCheck(db, items);
  const ship = await resolveShipping(db, deps, settings, { shipping: body.shipping, relayId: body.relay_id,
    country: body.country ?? 'FR', postcode: body.postcode });
  const subtotal = lines.reduce((n, l) => n + l.unit_price_cents * l.quantity, 0);
  const expires = now + Number(settings.quote_seconds || 600);
  const payload = {
    v: 1, exp: expires, items: lines.map((l) => [l.sku, l.quantity, l.unit_price_cents]),
    shipping: ship.method, relay: ship.relay, zone: ship.zone, ship: ship.cents, total: subtotal + ship.cents,
  };
  const encoded = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const id = `q1.${encoded}.${await hmacB64(env.APP_SECRET, `quote:${encoded}`)}`;
  return {
    id,
    currency: 'EUR',
    items: lines.map((l) => ({ sku: l.sku, quantity: l.quantity, unit_price_cents: l.unit_price_cents,
      line_total_cents: l.unit_price_cents * l.quantity })),
    subtotal_cents: subtotal,
    shipping_cents: ship.cents,
    total_cents: subtotal + ship.cents,
    shipping: ship.method,
    relay: ship.relay,
    expires_at: iso(expires),
  };
}

export async function readQuote(env, id, now) {
  if (typeof id !== 'string' || id.length > 4096) throw fail('quote_invalid');
  const [version, encoded, signature] = id.split('.');
  if (version !== 'q1' || !encoded || !signature) throw fail('quote_invalid');
  if (!timingSafeEqual(signature, await hmacB64(env.APP_SECRET, `quote:${encoded}`))) throw fail('quote_invalid');
  const payload = JSON.parse(new TextDecoder().decode(fromB64url(encoded)));
  if (payload.v !== 1 || !(payload.exp > now)) throw fail('quote_expired');
  return payload;
}

// ---------- checkout ----------
const orderRow = (db, id) => one(db, 'SELECT * FROM orders WHERE id = ?', id);
export const orderItems = (db, id) => all(db, `SELECT oi.sku, oi.product_id, oi.quantity, oi.unit_price_cents,
    p.name || ' — Taille ' || v.size AS label
  FROM order_items oi JOIN products p ON p.id = oi.product_id LEFT JOIN variants v ON v.sku = oi.sku
  WHERE oi.order_id = ? ORDER BY oi.line`, id);

export function releaseStatements(db, orderId, now, to = 'expired') {
  return [
    sql(db, `UPDATE reservations SET status = 'released', updated_at = ?
      WHERE order_id = ? AND status IN ('held', 'awaiting_payment')`, now, orderId),
    sql(db, `UPDATE orders SET status = ?, needs_stripe_check = 0, updated_at = ?
      WHERE id = ? AND status IN ('pending', 'awaiting_payment')`, to, now, orderId),
  ];
}

export async function startCheckout(env, input, deps) {
  const { db } = env;
  const now = deps.now();
  const { body, idempotencyKey, clientHash, ip } = input;
  if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) throw fail('invalid_request');
  if (!env.APP_SECRET || !env.PUBLIC_ORIGIN) throw fail('not_configured');
  const quote = await readQuote(env, body.quote_id, now);
  const settings = await getSettings(db).catch(() => { throw fail('service_unavailable'); });
  const items = normalizeItems(body.items, Number(settings.max_items_per_order || 1));
  const relayId = body.shipping === 'relay' ? body.relay_id : null;
  const sameItems = JSON.stringify(items.map((i) => [i.sku, i.quantity])) === JSON.stringify(quote.items.map(([s, q]) => [s, q]));
  if (!sameItems || body.shipping !== quote.shipping || (relayId ?? null) !== (quote.relay?.id ?? null)) throw fail('quote_mismatch');
  if (typeof body.terms_version !== 'string' || !body.terms_version || body.terms_version.length > 40) throw fail('invalid_request');
  if (settings.terms_version && body.terms_version !== settings.terms_version) throw fail('terms_outdated');
  const fingerprint = await sha256Hex(JSON.stringify({ items, shipping: body.shipping, relayId, quote: body.quote_id, terms: body.terms_version }));

  // Reprise d'une tentative : même clé et même contenu, sans nouveau contrôle anti-abus.
  const existing = await one(db, 'SELECT * FROM orders WHERE idempotency_key = ?', idempotencyKey);
  if (existing) return resumeCheckout(env, existing, fingerprint, deps);

  if (settings.shop_mode !== 'open') throw fail('paused');
  if (settings.payments_enabled !== '1' || !deps.stripe) throw fail('payments_disabled');
  await deps.rateLimit(`checkout:${clientHash}`, 5, 600);
  await deps.turnstile(body.turnstile, ip);

  const lines = await priceLines(db, items);
  // Mode de livraison, point relais et zone revérifiés au moment de payer (le devis peut dater).
  const ship = await resolveShipping(db, deps, settings, { shipping: body.shipping, relayId,
    country: quote.zone?.country ?? 'FR', postcode: quote.zone?.postcode });
  const changed = lines.some((l, i) => l.unit_price_cents !== quote.items[i][2]) || ship.cents !== quote.ship;
  if (changed) throw fail('price_changed');

  const holdSeconds = Number(settings.hold_seconds || 1920);
  const order = {
    id: uuid(), reference: newReference(), shipping_method: ship.method, relay_id: ship.relay?.id ?? null,
    relay_label: ship.relay?.label ?? null, subtotal_cents: lines.reduce((n, l) => n + l.unit_price_cents * l.quantity, 0),
    shipping_cents: ship.cents, stripe_expires_at: now + Number(settings.stripe_session_seconds || 1830),
  };
  order.total_cents = order.subtotal_cents + order.shipping_cents;
  const statements = [
    sql(db, `INSERT INTO orders (id, reference, source, status, idempotency_key, request_fingerprint, shipping_method,
        relay_id, relay_label, subtotal_cents, shipping_cents, total_cents, terms_version, stripe_expires_at,
        created_at, expires_at, updated_at)
      VALUES (?, ?, 'storefront', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    order.id, order.reference, idempotencyKey, fingerprint, order.shipping_method, order.relay_id, order.relay_label,
    order.subtotal_cents, order.shipping_cents, order.total_cents, body.terms_version, order.stripe_expires_at,
    now, now + holdSeconds, now),
  ];
  lines.forEach((l, i) => {
    statements.push(sql(db, `INSERT INTO order_items (order_id, line, product_id, sku, quantity, unit_price_cents)
      VALUES (?, ?, ?, ?, ?, ?)`, order.id, i + 1, l.product_id, l.sku, l.quantity, l.unit_price_cents));
    statements.push(sql(db, `INSERT INTO reservations (id, order_id, sku, quantity, client_hash, status, expires_at,
        created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'held', ?, ?, ?)`,
    uuid(), order.id, l.sku, l.quantity, clientHash, now + holdSeconds, now, now));
  });
  try {
    await batch(db, statements);
  } catch (error) {
    const code = error.dbCode;
    if (code === 'unique_failed') {
      const twin = await one(db, 'SELECT * FROM orders WHERE idempotency_key = ?', idempotencyKey);
      if (twin) {
        if (twin.request_fingerprint !== fingerprint) throw fail('idempotency_conflict');
        throw fail('checkout_in_progress', { retryAfter: 2 });
      }
    }
    if (code === 'insufficient_stock') throw fail(await explainShortage(db, items));
    if (code === 'paused') throw fail('paused');
    if (code === 'stock_unverified') throw fail('stock_unavailable');
    if (code === 'not_published') throw fail('invalid_items');
    if (code === 'hold_limit') throw fail('hold_limit');
    throw fail('service_unavailable');
  }
  return openSession(env, await orderRow(db, order.id), deps);
}

async function resumeCheckout(env, order, fingerprint, deps) {
  if (order.request_fingerprint !== fingerprint) throw fail('idempotency_conflict');
  const now = deps.now();
  if (order.status !== 'pending' || now >= order.stripe_expires_at) {
    throw fail('attempt_closed', { order_reference: order.reference });
  }
  if (order.stripe_session_id && order.stripe_session_url) {
    return { url: order.stripe_session_url, order_reference: order.reference, expires_at: iso(order.stripe_expires_at) };
  }
  return openSession(env, order, deps);
}

// Création (ou reprise) de la session Stripe. Toute réponse incertaine garde la réservation :
// seul le balayage, après confirmation par Stripe, pourra la libérer. Les URL de retour viennent
// toujours de PUBLIC_ORIGIN : une reprise envoie exactement les mêmes paramètres à Stripe.
async function openSession(env, order, deps) {
  const { db } = env;
  const now = deps.now();
  const items = await orderItems(db, order.id);
  let session;
  try {
    session = await deps.stripe.createCheckoutSession(sessionParams(order, items, env.PUBLIC_ORIGIN), `sayless-checkout-${order.id}`);
  } catch (error) {
    if (error.definite) {
      // Stripe a explicitement refusé : aucune session n'existe pour cette clé, la pièce peut revenir.
      await batch(db, [...releaseStatements(db, order.id, now, 'expired'),
        audit(db, now, 'system', 'checkout_session_refused', order.reference, `stripe_${error.status}`)]);
      await deps.notify({ kind: 'technical', ref: `stripe_refused:${order.id}`, level: 'critical',
        title: 'Stripe a refusé une session de paiement', body: `Commande ${order.reference} : code ${error.status}. Pièce remise en vente.` });
      throw fail('service_unavailable');
    }
    await batch(db, [sql(db, 'UPDATE orders SET needs_stripe_check = 1, updated_at = ? WHERE id = ?', now, order.id)]).catch(() => {});
    throw fail('service_unavailable', { retryAfter: 3 });
  }
  const valid = typeof session?.url === 'string' && /^https:\/\/checkout\.stripe\.com\//.test(session.url)
    && session.client_reference_id === order.id && session.amount_total === order.total_cents;
  if (!valid) {
    await batch(db, [sql(db, 'UPDATE orders SET needs_stripe_check = 1, updated_at = ? WHERE id = ?', now, order.id)]).catch(() => {});
    await deps.notify({ kind: 'technical', ref: `session_mismatch:${order.id}`, level: 'critical',
      title: 'Session Stripe incohérente', body: `Commande ${order.reference} : montant ou référence inattendus.` });
    throw fail('service_unavailable');
  }
  await batch(db, [sql(db, `UPDATE orders SET stripe_session_id = ?, stripe_session_url = ?, needs_stripe_check = 0,
      updated_at = ? WHERE id = ? AND (stripe_session_id IS NULL OR stripe_session_id = ?)`,
  session.id, session.url, now, order.id, session.id)]);
  return { url: session.url, order_reference: order.reference, expires_at: iso(order.stripe_expires_at) };
}

// Page /merci : référence + session Stripe exigées ensemble ; aucune donnée personnelle renvoyée.
export async function checkoutStatus(env, body, deps) {
  const { db } = env;
  const reference = body?.order_reference;
  const sessionId = body?.session_id;
  if (typeof reference !== 'string' || typeof sessionId !== 'string' || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    throw fail('invalid_request');
  }
  let order = await one(db, 'SELECT * FROM orders WHERE reference = ?', reference);
  if (!order || !order.stripe_session_id || !timingSafeEqual(order.stripe_session_id, sessionId)) throw fail('not_found');
  if (['pending', 'awaiting_payment'].includes(order.status) && deps.stripe && deps.reconcile) {
    try {
      await deps.reconcile(await deps.stripe.retrieveSession(order.stripe_session_id));
      order = await orderRow(db, order.id);
    } catch {
      // Stripe muet : on répond avec l'état connu, le webhook ou le balayage trancheront.
    }
  }
  const map = { pending: 'pending', awaiting_payment: 'processing', paid: 'paid', paid_no_stock: 'review', review: 'review',
    expired: 'expired', failed: 'failed', refunded: 'refunded', partially_refunded: 'paid' };
  return { order_reference: order.reference, payment_status: map[order.status] ?? 'pending', updated_at: iso(order.updated_at) };
}
