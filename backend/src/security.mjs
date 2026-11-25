// Protections transverses : origine, corps JSON borné, limitation d'abus, Turnstile, empreinte
// client sans adresse IP en clair, chiffrement des coordonnées de livraison.
import { b64url, batch, fail, fromB64url, hmacB64, one, sql } from './lib.mjs';

export const isProduction = (env) => env.ENVIRONMENT === 'production';

// Écritures publiques : même origine que l'API, JSON uniquement, 16 Ko maximum.
export function assertSameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin) throw fail('invalid_origin');
}
export async function readJson(request, maxBytes = 16384) {
  const type = request.headers.get('Content-Type') ?? '';
  if (!/^application\/json\b/i.test(type)) throw fail('unsupported_media_type');
  const declared = Number(request.headers.get('Content-Length') ?? 0);
  if (declared > maxBytes) throw fail('payload_too_large');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw fail('payload_too_large');
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
  } catch {
    throw fail('invalid_json');
  }
}

// Empreinte du client : HMAC(APP_SECRET, jour + IP). Aucune IP stockée ; change chaque jour.
export async function clientHash(env, ip, now) {
  if (!env.APP_SECRET) throw fail('not_configured');
  const day = new Date(now * 1000).toISOString().slice(0, 10);
  return (await hmacB64(env.APP_SECRET, `client:${day}:${ip || 'unknown'}`)).slice(0, 32);
}

// Fenêtre fixe dans D1. Une panne de la base bloque l'action (jamais d'ouverture par défaut).
export async function rateLimit(db, key, limit, windowSeconds, now) {
  const win = Math.floor(now / windowSeconds);
  await batch(db, [sql(db, `INSERT INTO rate_limits (k, win, n) VALUES (?, ?, 1)
    ON CONFLICT (k, win) DO UPDATE SET n = n + 1`, key, win)]);
  const row = await one(db, 'SELECT n FROM rate_limits WHERE k = ? AND win = ?', key, win);
  if (!row || row.n > limit) throw fail('rate_limited', { retryAfter: (win + 1) * windowSeconds - now });
}

// Turnstile : validé côté serveur. Contournement possible uniquement hors production et
// seulement si TURNSTILE_BYPASS vaut exactement « test-only ».
export async function verifyTurnstile(env, token, ip, transport = fetch) {
  if (!env.TURNSTILE_SECRET) {
    if (!isProduction(env) && env.TURNSTILE_BYPASS === 'test-only') return true;
    throw fail('challenge_unavailable');
  }
  if (typeof token !== 'string' || !token.trim() || token.length > 2048) throw fail('challenge_required');
  const form = new FormData();
  form.set('secret', env.TURNSTILE_SECRET);
  form.set('response', token);
  if (ip) form.set('remoteip', ip);
  let outcome;
  try {
    const response = await transport('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body: form, signal: AbortSignal.timeout(5000),
    });
    outcome = await response.json();
  } catch {
    throw fail('challenge_unavailable');
  }
  if (outcome?.success !== true) throw fail('challenge_failed');
  return true;
}

// ---------- coordonnées scellées (AES-GCM 256, clé PII_KEY en secret Cloudflare) ----------
// v2 : le chiffré est lié à sa commande (données associées) ; un chiffré copié sur une autre
// commande ne s'ouvre pas. Le chiffrement est obligatoire : sans clé valide, aucun paiement.
async function piiKey(env) {
  if (!env.PII_KEY) return null;
  const raw = fromB64url(env.PII_KEY.trim());
  if (raw.length !== 32) throw new Error('PII_KEY invalide : 32 octets attendus');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function piiReady(env) {
  try {
    return Boolean(await piiKey(env));
  } catch {
    return false;
  }
}
const aad = (orderId) => new TextEncoder().encode(`order:${orderId}`);
export async function sealContact(env, contact, orderId) {
  let key;
  try {
    key = await piiKey(env);
  } catch {
    return null;
  }
  if (!key || typeof orderId !== 'string' || !orderId) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(contact));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(orderId) }, key, data);
  return `v2.${b64url(iv)}.${b64url(sealed)}`;
}
export async function openContact(env, sealed, orderId) {
  const key = await piiKey(env);
  const [version, iv, data] = String(sealed).split('.');
  if (!key || version !== 'v2') throw fail('not_configured');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv), additionalData: aad(orderId) }, key, fromB64url(data));
  return JSON.parse(new TextDecoder().decode(plain));
}
