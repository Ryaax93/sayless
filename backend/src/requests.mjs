// Demandes des clients (contact, retour, rétractation) et suivi de commande par lien e-mail.
// Prérequis : envoi d'e-mails configuré (accusé de réception sur support durable) et chiffrement
// des coordonnées. Sans eux, ces routes répondent 503 not_configured : jamais de faux « envoyé ».
import { audit, b64url, batch, fail, hmacB64, iso, one, all, randomCode, sql, timingSafeEqual, uuid } from './lib.mjs';
import { emailHash, piiReady, sealPayload } from './security.mjs';
import { emailReady, lookupEmail, queueEmail, validEmail } from './email.mjs';
import { intentStatement, processMailIntents } from './intents.mjs';
import { PUBLIC_STATUS } from './commerce.mjs';

const TYPES = new Set(['contact', 'return', 'withdrawal']);
const REF = /^SL-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
const TOKEN_TTL = 1800;
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function ready(env) {
  if (!emailReady(env) || !(await piiReady(env)) || !env.APP_SECRET || !env.PUBLIC_ORIGIN) throw fail('not_configured');
}

// Demande enregistrée (coordonnées et message chiffrés), puis accusé de réception par e-mail.
// La référence n'est renvoyée qu'une fois la demande stockée : c'est la prise en charge.
export async function submitRequest(env, body, deps, { ip }) {
  await ready(env);
  const type = body?.type;
  if (!TYPES.has(type)) throw fail('invalid_request', { field: 'type' });
  const email = text(body.email, 254);
  const name = text(body.name, 120);
  const message = text(body.message, 4000);
  const orderReference = text(body.order_reference, 20).toUpperCase() || null;
  if (!validEmail(email)) throw fail('invalid_request', { field: 'email' });
  if (orderReference && !REF.test(orderReference)) throw fail('invalid_request', { field: 'order_reference' });
  if (type !== 'withdrawal' && message.length < 2) throw fail('invalid_request', { field: 'message' }); // rétractation : sans motif
  await deps.turnstile(body.turnstile, ip);
  const now = deps.now();
  const id = uuid();
  const request = { id, reference: `R-${randomCode(4)}-${randomCode(4)}`, type, order_reference: orderReference };
  const sealed = await sealPayload(env, { name, email, message }, `request:${id}`);
  if (!sealed) throw fail('not_configured');
  const dedupe = `request_ack:${id}`;
  // Demande et intention d'accusé dans la même transaction (V13-B1) : l'accusé ne peut plus être
  // perdu entre l'enregistrement de la demande et sa mise en file.
  await batch(env.db, [
    sql(env.db, `INSERT INTO customer_requests (id, reference, type, order_reference, sealed, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, id, request.reference, type, orderReference, sealed, now, now),
    intentStatement(env.db, { kind: 'request_ack', dedupe, ref: id, now }),
    audit(env.db, now, 'client', 'request_received', request.reference, type),
  ]);
  const titles = { contact: 'Nouveau message client', return: 'Demande de retour', withdrawal: 'Demande de rétractation' };
  await deps.notify({ kind: `request_${type}`, ref: request.reference, level: type === 'withdrawal' ? 'warning' : 'info', title: titles[type],
    body: `Demande ${request.reference}${orderReference ? ` (commande ${orderReference})` : ''}. À traiter dans STUDIO.` });
  // Accusé mis en file puis envoyé tout de suite ; en cas d'échec, l'intention ou la file
  // réessaient à la minute suivante. La demande est enregistrée dans tous les cas.
  await processMailIntents(env, deps, { only: dedupe });
  if (deps.sendNow) await deps.sendNow(`email:${dedupe}`).catch(() => {});
  return { reference: request.reference, type, received_at: iso(now) };
}

// Suivi : réponse identique que la commande existe ou non (aucune énumération). Si la référence
// et l'adresse correspondent, un lien valable 30 minutes part par e-mail. Le jeton est placé
// dans le fragment de l'URL (#…) : il n'est jamais envoyé au serveur dans une adresse.
export async function lookupOrder(env, body, deps) {
  await ready(env);
  const reference = text(body?.reference, 20).toUpperCase();
  const email = text(body?.email, 254);
  if (!REF.test(reference) || !validEmail(email)) throw fail('invalid_request');
  const now = deps.now();
  const order = await one(env.db, `SELECT o.id, o.reference, c.email_hash FROM orders o JOIN order_contacts c ON c.order_id = o.id
    WHERE o.reference = ? AND o.paid_at IS NOT NULL`, reference);
  const hash = await emailHash(env, email);
  if (order?.email_hash && timingSafeEqual(order.email_hash, hash)) {
    const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
    await batch(env.db, [
      sql(env.db, 'INSERT INTO order_access_tokens (token_hash, order_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
        await hmacB64(env.APP_SECRET, `order-access:${token}`), order.id, now, now + TOKEN_TTL),
      sql(env.db, 'DELETE FROM order_access_tokens WHERE expires_at < ?', now),
    ]);
    const link = `${env.PUBLIC_ORIGIN}/#/suivi?t=${token}`;
    await queueEmail(env, { dedupe: `lookup:${order.id}:${now}`, to: email, ...lookupEmail({ order, link }) }, now);
    if (deps.sendNow) await deps.sendNow(`email:lookup:${order.id}:${now}`).catch(() => {});
  }
  return { accepted: true };
}

// Lecture du suivi avec le jeton du lien (en-tête Authorization). Aucune donnée personnelle.
export async function readOrder(env, request, deps) {
  if (!env.APP_SECRET || !emailReady(env)) throw fail('not_configured'); // aucun lien ne peut exister sans e-mail
  const token = (request.headers.get('Authorization') ?? '').match(/^Bearer ([A-Za-z0-9_-]{40,60})$/)?.[1];
  if (!token) throw fail('unauthenticated');
  const now = deps.now();
  const row = await one(env.db, 'SELECT order_id FROM order_access_tokens WHERE token_hash = ? AND expires_at > ?',
    await hmacB64(env.APP_SECRET, `order-access:${token}`), now);
  if (!row) throw fail('unauthenticated');
  const order = await one(env.db, 'SELECT * FROM orders WHERE id = ?', row.order_id);
  const items = await all(env.db, `SELECT v.size, oi.quantity FROM order_items oi LEFT JOIN variants v ON v.sku = oi.sku WHERE oi.order_id = ?`, order.id);
  const events = await all(env.db, `SELECT kind, detail, at FROM order_events WHERE order_id = ? AND kind IN ('prepared', 'shipped', 'delivered', 'returned') ORDER BY at`, order.id);
  const shipped = events.find((e) => e.kind === 'shipped');
  const detail = shipped?.detail ? JSON.parse(shipped.detail) : {};
  const relay = order.relay_snapshot ? JSON.parse(order.relay_snapshot) : null;
  return {
    order_reference: order.reference,
    payment_status: PUBLIC_STATUS[order.status] ?? 'pending',
    items: items.map((i) => ({ size: i.size ?? null, quantity: i.quantity })),
    shipping: order.shipping_method,
    relay: relay ? { name: relay.name, city: relay.address?.city ?? null, postcode: relay.address?.postcode ?? null } : null,
    steps: events.map((e) => ({ step: e.kind, at: iso(e.at) })),
    tracking: shipped ? { carrier: detail.carrier ?? null, number: detail.tracking ?? null } : null,
    updated_at: iso(order.updated_at),
  };
}
