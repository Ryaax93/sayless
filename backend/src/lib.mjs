// Outils communs du backend SAYLESS 2.0 : erreurs, réponses, identifiants, hachage, accès D1.
// Fonctionne à l'identique sur Cloudflare Workers / Pages Functions et sous Node (tests).

export const ERROR_STATUS = Object.freeze({
  invalid_request: 400, invalid_json: 400, invalid_signature: 400, invalid_event: 400,
  challenge_required: 403, challenge_failed: 403, payments_disabled: 403, invalid_origin: 403,
  not_found: 404, unknown_product: 404,
  sold_out: 409, held: 409, quote_expired: 409, quote_invalid: 409, price_changed: 409, quote_mismatch: 409,
  idempotency_conflict: 409, checkout_in_progress: 409, attempt_closed: 409, terms_outdated: 409,
  stale_revision: 409, quantity_below_reservations: 409,
  payload_too_large: 413, unsupported_media_type: 415,
  invalid_items: 422, quantity_not_supported: 422, relay_required: 422, invalid_relay: 422,
  destination_not_supported: 422,
  rate_limited: 429, hold_limit: 429,
  stock_unavailable: 503, service_unavailable: 503, paused: 503, unavailable: 503,
  relay_unavailable: 503, challenge_unavailable: 503, not_configured: 503,
});

export class ApiError extends Error {
  constructor(code, status = ERROR_STATUS[code] ?? 400, extra = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}
export const fail = (code, extra = {}) => new ApiError(code, ERROR_STATUS[code] ?? 400, extra);

const SECURITY_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...SECURITY_HEADERS, ...headers } });
}
export function errorResponse(error) {
  if (error instanceof ApiError) {
    const headers = error.extra?.retryAfter ? { 'Retry-After': String(error.extra.retryAfter) } : {};
    const { retryAfter, ...rest } = error.extra ?? {};
    return json({ error: error.code, ...rest }, error.status, headers);
  }
  return json({ error: 'service_unavailable' }, 503);
}

// ---------- temps ----------
export const iso = (seconds) => new Date(seconds * 1000).toISOString();
export const systemClock = () => Math.floor(Date.now() / 1000);

// ---------- identifiants ----------
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function randomCode(length, random = crypto.getRandomValues.bind(crypto)) {
  const bytes = random(new Uint8Array(length));
  let out = '';
  for (const b of bytes) out += CROCKFORD[b & 31];
  return out;
}
// Référence publique : 40 bits aléatoires, sans caractère ambigu (pas de I, L, O, U).
export const newReference = () => `SL-${randomCode(4)}-${randomCode(4)}`;
export const uuid = () => crypto.randomUUID();
export const pad4 = (n) => String(n).padStart(4, '0');

// ---------- encodages et hachage ----------
const enc = new TextEncoder();
export function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export function fromB64url(text) {
  const s = atob(text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (text.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function sha256Hex(text) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}
export async function hmacB64(secret, text) {
  return b64url(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(text)));
}
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- D1 ----------
const DB_CODES = ['not_held', 'paused', 'not_published', 'stock_unverified', 'insufficient_stock', 'hold_limit',
  'unknown_sku', 'ledger_append_only', 'audit_append_only', 'reservation_transition_forbidden',
  'order_transition_forbidden', 'return_not_allowed', 'return_quantity_exceeded', 'return_check_final',
  'inventory_via_ledger_only', 'stale_revision', 'assertion_failed'];
export function dbCode(error) {
  const message = String(error?.message ?? error);
  for (const code of DB_CODES) if (new RegExp(`\\b${code}\\b`).test(message)) return code;
  if (/CHECK constraint failed/i.test(message)) return 'check_failed';
  if (/UNIQUE constraint failed/i.test(message)) return 'unique_failed';
  return null;
}
const clean = (args) => args.map((v) => (v === undefined ? null : v));
export const sql = (db, text, ...args) => db.prepare(text).bind(...clean(args));
export async function one(db, text, ...args) {
  return sql(db, text, ...args).first();
}
export async function all(db, text, ...args) {
  return (await sql(db, text, ...args).all()).results ?? [];
}
// Lot atomique : tout ou rien. L'erreur porte le code métier levé par la base (dbCode).
export async function batch(db, statements) {
  try {
    return await db.batch(statements);
  } catch (error) {
    error.dbCode = dbCode(error);
    throw error;
  }
}
export async function getSettings(db) {
  const rows = await all(db, 'SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
export function audit(db, now, actor, action, target, result) {
  return sql(db, 'INSERT INTO audit_log (at, actor, action, target, result) VALUES (?, ?, ?, ?, ?)',
    now, actor, action, target, result);
}
