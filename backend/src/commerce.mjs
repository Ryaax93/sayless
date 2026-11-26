// Parcours d'achat côté serveur : devis signé sans donnée personnelle, checkout idempotent avec
// réservation atomique, statut de confirmation. Le navigateur n'envoie jamais de prix.
import {
  all, audit, batch, fail, fromB64url, getSettings, hmacB64, iso, newReference, one, sha256Hex, sql,
  timingSafeEqual, uuid, b64url,
} from './lib.mjs';
import { explainShortage } from './stock.mjs';
import { sessionParams } from './stripe.mjs';
import { piiReady } from './security.mjs';
import { termsDocument } from './terms.mjs';

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

// Inventaire vérifié pour TOUTES les tailles du produit (même règle que le stock public et que la
// base au moment de la réservation), puis quantité libre pour chaque ligne demandée.
async function stockCheck(db, items) {
  for (const item of items) {
    const unverified = await one(db, `SELECT COUNT(*) AS n FROM variants v LEFT JOIN inventory i ON i.sku = v.sku
      WHERE v.product_id = (SELECT product_id FROM variants WHERE sku = ?) AND (i.sku IS NULL OR i.confirmed_at IS NULL)`, item.sku);
    if (unverified.n > 0) throw fail('stock_unavailable');
    const row = await one(db, 'SELECT on_hand, reserved FROM inventory WHERE sku = ?', item.sku);
    if (!row) throw fail('stock_unavailable');
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
  if (typeof relayId !== 'string' || !relayId.trim() || relayId.length > 80) throw fail('relay_required');
  if (!deps.relays) throw fail('relay_unavailable');
  const relay = normalizeRelay(await deps.relays.find(relayId));
  if (!relay || relay.open === false) throw fail('invalid_relay');
  assertZone(settings, relay.address.country, relay.address.postcode);
  return { method: 'relay', cents: rate.cents, relay: { id: relay.id, label: relay.name, network: relay.network,
    postcode: relay.address.postcode, city: relay.address.city, address: relay.address },
  zone: { country: relay.address.country, postcode: relay.address.postcode } };
}

// Point relais du fournisseur, sous une forme stable : identifiant, nom, réseau, adresse complète.
// Aucune donnée personnelle. Le même objet est montré au client, signé dans le devis et figé dans
// la commande (relay_snapshot) pour l'étiquette et STUDIO.
export function normalizeRelay(raw) {
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
  const text = (v, max = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const a = raw.address ?? {};
  const address = { line1: text(a.line1 ?? raw.line1), line2: text(a.line2 ?? raw.line2), postcode: text(a.postcode ?? raw.postcode, 10),
    city: text(a.city ?? raw.city, 80), country: text(a.country ?? raw.country, 2) ?? 'FR' };
  return { id: raw.id.slice(0, 80), name: text(raw.name) ?? 'Point relais', network: text(raw.network, 40), address,
    open: raw.open !== false };
}

// Recherche de points relais : mêmes refus de destination que le devis, points hors zone écartés.
export async function searchRelays(env, deps, { postcode, country = 'FR' }) {
  if (!deps.relays) throw fail('relay_unavailable');
  const settings = await getSettings(env.db).catch(() => { throw fail('service_unavailable'); });
  assertZone(settings, country, postcode);
  const points = [];
  for (const raw of (await deps.relays.search(postcode)) ?? []) {
    const relay = normalizeRelay(raw);
    if (!relay || !relay.open) continue;
    try {
      assertZone(settings, relay.address.country, relay.address.postcode);
    } catch {
      continue;
    }
    points.push({ id: relay.id, name: relay.name, network: relay.network, postcode: relay.address.postcode,
      city: relay.address.city, address: relay.address });
  }
  return { points };
}

// ---------- devis ----------
// Le devis est un jeton signé (HMAC APP_SECRET) : aucune écriture en base, aucune coordonnée.
// Il porte la version des CGV en vigueur ET l'empreinte du document archivé : le paiement exige
// ce même document. Sans document archivé, aucun devis (une version seule ne suffit pas).
export async function createQuote(env, body, deps) {
  const { db } = env;
  const now = deps.now();
  if (!env.APP_SECRET) throw fail('not_configured');
  const settings = await getSettings(db).catch(() => { throw fail('service_unavailable'); });
  if (settings.shop_mode !== 'open') throw fail('paused');
  const terms = await termsDocument(db).catch(() => { throw fail('service_unavailable'); });
  if (!terms?.intact) throw fail('not_configured'); // absent de l'archive, ou texte différent de son empreinte
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
    t: terms.version, h: terms.sha256,
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
    terms_version: terms.version,
    terms_sha256: terms.sha256,
    terms_url: `/api/terms/${terms.version}`,
    expires_at: iso(expires),
  };
}

// Signature toujours vérifiée. L'expiration n'est ignorée que pour retrouver une tentative déjà
// enregistrée avec la même clé (allowExpired) : un devis expiré n'ouvre jamais un nouvel achat.
export async function readQuote(env, id, now, { allowExpired = false } = {}) {
  if (typeof id !== 'string' || id.length > 4096) throw fail('quote_invalid');
  const [version, encoded, signature] = id.split('.');
  if (version !== 'q1' || !encoded || !signature) throw fail('quote_invalid');
  if (!timingSafeEqual(signature, await hmacB64(env.APP_SECRET, `quote:${encoded}`))) throw fail('quote_invalid');
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromB64url(encoded)));
  } catch {
    throw fail('quote_invalid');
  }
  if (payload?.v !== 1) throw fail('quote_invalid');
  if (!allowExpired && !(payload.exp > now)) throw fail('quote_expired');
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

// État public d'une commande (page /merci, tentative close).
export const PUBLIC_STATUS = { pending: 'pending', awaiting_payment: 'processing', paid: 'paid', paid_no_stock: 'review',
  review: 'review', expired: 'expired', failed: 'failed', refunded: 'refunded', partially_refunded: 'paid' };

export async function startCheckout(env, input, deps) {
  const { db } = env;
  const now = deps.now();
  const { body, idempotencyKey, clientHash, ip } = input;
  if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) throw fail('invalid_request');
  if (!env.APP_SECRET || !env.PUBLIC_ORIGIN) throw fail('not_configured');
  const quote = await readQuote(env, body.quote_id, now, { allowExpired: true });
  const settings = await getSettings(db).catch(() => { throw fail('service_unavailable'); });
  const items = normalizeItems(body.items, Number(settings.max_items_per_order || 1));
  const relayId = body.shipping === 'relay' ? body.relay_id : null;
  if (typeof body.terms_version !== 'string' || !body.terms_version || body.terms_version.length > 40) throw fail('invalid_request');
  // Empreinte du document affiché (contrat v1.4) : facultative pour les clients v1.3, vérifiée si fournie.
  if (body.terms_sha256 !== undefined && (typeof body.terms_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(body.terms_sha256))) throw fail('invalid_request');
  const fingerprint = await sha256Hex(JSON.stringify({ items, shipping: body.shipping, relayId, quote: body.quote_id, terms: body.terms_version,
    ...(body.terms_sha256 ? { terms_sha256: body.terms_sha256 } : {}) }));

  // 1. Reprise : la tentative est retrouvée par sa clé avant tout contrôle du devis ou des CGV.
  //    Même contenu : même session Stripe et même réservation, sans nouveau contrôle anti-abus.
  const existing = await one(db, 'SELECT * FROM orders WHERE idempotency_key = ?', idempotencyKey);
  if (existing) return resumeCheckout(env, existing, fingerprint, deps);

  // 2. Nouvelle tentative : devis valide et identique, CGV en vigueur, chiffrement prêt, ventes ouvertes.
  if (!(quote.exp > now)) throw fail('quote_expired');
  const sameItems = JSON.stringify(items.map((i) => [i.sku, i.quantity])) === JSON.stringify(quote.items.map(([s, q]) => [s, q]));
  if (!sameItems || body.shipping !== quote.shipping || (relayId ?? null) !== (quote.relay?.id ?? null)) throw fail('quote_mismatch');
  // CGV : document archivé en vigueur, même version et même empreinte que le devis (et que le
  // document affiché, si le client l'indique). La base refait ce contrôle au moment de réserver.
  const terms = await termsDocument(db).catch(() => { throw fail('service_unavailable'); });
  if (!terms?.intact) throw fail('not_configured');
  if (body.terms_version !== terms.version || quote.t !== terms.version || (quote.h !== undefined && quote.h !== terms.sha256)
    || (body.terms_sha256 !== undefined && body.terms_sha256 !== terms.sha256)) throw fail('terms_outdated');
  if (settings.shop_mode !== 'open') throw fail('paused');
  if (settings.payments_enabled !== '1' || !deps.stripe) throw fail('payments_disabled');
  // Coordonnées de livraison chiffrées obligatoires : sans clé valide, aucun paiement n'est ouvert.
  if (!(await piiReady(env))) throw fail('not_configured');
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
    relay_snapshot: ship.relay ? JSON.stringify({ id: ship.relay.id, name: ship.relay.label, network: ship.relay.network, address: ship.relay.address }) : null,
  };
  order.total_cents = order.subtotal_cents + order.shipping_cents;
  const statements = [
    sql(db, `INSERT INTO orders (id, reference, source, status, idempotency_key, request_fingerprint, shipping_method,
        relay_id, relay_label, relay_snapshot, subtotal_cents, shipping_cents, total_cents, terms_version, terms_sha256, stripe_expires_at,
        created_at, expires_at, updated_at)
      VALUES (?, ?, 'storefront', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    order.id, order.reference, idempotencyKey, fingerprint, order.shipping_method, order.relay_id, order.relay_label,
    order.relay_snapshot, order.subtotal_cents, order.shipping_cents, order.total_cents, terms.version, terms.sha256, order.stripe_expires_at,
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
    if (code === 'terms_unpublished') throw fail('not_configured');
    if (code === 'terms_outdated') throw fail('terms_outdated');
    if (code === 'not_published') throw fail('invalid_items');
    if (code === 'hold_limit') throw fail('hold_limit');
    throw fail('service_unavailable');
  }
  return openSession(env, await orderRow(db, order.id), deps);
}

// Tentative close : sa référence, son état public et, si elle en a une, sa session Stripe (le
// client qui détient la clé et le contenu exact peut ainsi afficher la page de suivi /merci).
function closedAttempt(order) {
  return fail('attempt_closed', { order_reference: order.reference, payment_status: PUBLIC_STATUS[order.status] ?? 'expired',
    ...(order.stripe_session_id ? { session_id: order.stripe_session_id } : {}) });
}

async function resumeCheckout(env, order, fingerprint, deps) {
  if (order.request_fingerprint !== fingerprint) throw fail('idempotency_conflict');
  const now = deps.now();
  if (order.status !== 'pending' || now >= order.stripe_expires_at) throw closedAttempt(order);
  if (order.stripe_session_id && order.stripe_session_url) {
    return { url: order.stripe_session_url, order_reference: order.reference, expires_at: iso(order.stripe_expires_at) };
  }
  return openSession(env, order, deps, { resume: true });
}

// Création (ou reprise) de la session Stripe. Clé d'idempotence et paramètres identiques à chaque
// essai : Stripe renvoie la session déjà créée au lieu d'en ouvrir une seconde. Toute réponse
// incertaine garde la réservation ; seul un refus explicite de Stripe la rend.
async function openSession(env, order, deps, { resume = false } = {}) {
  const { db } = env;
  const now = deps.now();
  const items = await orderItems(db, order.id);
  let session;
  try {
    session = await deps.stripe.createCheckoutSession(sessionParams(order, items, env.PUBLIC_ORIGIN), `sayless-checkout-${order.id}`);
  } catch (error) {
    if (error.definite) {
      // Refus explicite : aucune session n'existe pour cette clé, la pièce peut revenir.
      await batch(db, [...releaseStatements(db, order.id, now, 'expired'),
        audit(db, now, 'system', resume ? 'checkout_resume_refused' : 'checkout_session_refused', order.reference, `stripe_${error.status}`)]);
      // Reprise après plus de 30 s d'une tentative jamais reçue par Stripe : la date d'expiration
      // d'origine n'est plus acceptée. Situation attendue, sans alerte : la tentative est close.
      if (resume && now - order.created_at > 30) throw closedAttempt(await orderRow(db, order.id));
      await deps.notify({ kind: 'technical', ref: `stripe_refused:${order.id}`, level: 'critical',
        title: 'Stripe a refusé une session de paiement', body: `Commande ${order.reference} : code ${error.status}. Pièce remise en vente.` });
      throw fail('service_unavailable');
    }
    await batch(db, [sql(db, 'UPDATE orders SET needs_stripe_check = 1, updated_at = ? WHERE id = ?', now, order.id)]).catch(() => {});
    throw fail('service_unavailable', { retryAfter: 3 });
  }
  if (!validSession(session, order)) {
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

export const validSession = (session, order) => typeof session?.url === 'string' && /^https:\/\/checkout\.stripe\.com\//.test(session.url)
  && session.client_reference_id === order.id && session.amount_total === order.total_cents;

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
  return { order_reference: order.reference, payment_status: PUBLIC_STATUS[order.status] ?? 'pending', updated_at: iso(order.updated_at) };
}
