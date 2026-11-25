// Notifications sur l'iPhone (Web Push standard : RFC 8030, chiffrement RFC 8291, VAPID RFC 8292),
// sans service payant ni bibliothèque : WebCrypto suffit. Fonctionne quand STUDIO est installé sur
// l'écran d'accueil (iOS 16.4 et suivants) et que le fondateur a accepté les notifications.
// Clés : VAPID_PUBLIC_KEY (publique), VAPID_PRIVATE_KEY (secrète, saisie dans Cloudflare),
// VAPID_SUBJECT (mailto: ou https:). Les messages ne contiennent jamais de donnée personnelle.
import { all, b64url, batch, fromB64url, sql } from './lib.mjs';

const enc = new TextEncoder();
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};
const hkdf = async (salt, ikm, info, bytes) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info },
  await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), bytes * 8));

export const pushReady = (env) => Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && /^(mailto:|https:)/.test(env.VAPID_SUBJECT ?? ''));

// Clé privée VAPID au format JWK (d seul, ou JWK complet) complétée par la clé publique brute.
async function vapidKey(env) {
  const pub = fromB64url(env.VAPID_PUBLIC_KEY);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC_KEY invalide');
  const raw = env.VAPID_PRIVATE_KEY.trim();
  const d = raw.startsWith('{') ? JSON.parse(raw).d : raw;
  return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33)), d, ext: false },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

export async function vapidAuthorization(env, endpoint, now) {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: now + 12 * 3600, sub: env.VAPID_SUBJECT })));
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidKey(env), enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${env.VAPID_PUBLIC_KEY}`;
}

// Chiffrement « aes128gcm » d'un message pour un abonnement (clé p256dh et secret auth du navigateur).
export async function encryptPush(subscription, payload) {
  const uaPublic = fromB64url(subscription.p256dh);
  const authSecret = fromB64url(subscription.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const peer = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc.encode(JSON.stringify(payload)), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // taille d'enregistrement 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, data);
}

// Envoi à tous les appareils abonnés. Abonnement expiré (404/410) : retiré. Aucun appareil joint :
// erreur, pour que la file réessaie plus tard au lieu de marquer le message comme envoyé.
export function pushSender(env, transport = fetch) {
  return async (message) => {
    const now = Math.floor(Date.now() / 1000);
    const subs = await all(env.DB, 'SELECT endpoint, p256dh, auth FROM push_subscriptions');
    if (!subs.length) throw new Error('aucun appareil abonné');
    let delivered = 0;
    for (const sub of subs) {
      const response = await transport(sub.endpoint, {
        method: 'POST', signal: AbortSignal.timeout(8000),
        headers: { Authorization: await vapidAuthorization(env, sub.endpoint, now), TTL: '86400', 'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream', Urgency: message.level === 'critical' ? 'high' : 'normal', Topic: String(message.kind ?? 'studio').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'studio' },
        body: await encryptPush(sub, { title: message.title, body: message.body, level: message.level, kind: message.kind }),
      }).catch(() => null);
      if (response && (response.status === 404 || response.status === 410)) {
        await batch(env.DB, [sql(env.DB, 'DELETE FROM push_subscriptions WHERE endpoint = ?', sub.endpoint)]);
      } else if (response?.ok) {
        delivered += 1;
        await batch(env.DB, [sql(env.DB, 'UPDATE push_subscriptions SET last_ok_at = ?, failures = 0 WHERE endpoint = ?', now, sub.endpoint)]);
      } else {
        await batch(env.DB, [sql(env.DB, 'UPDATE push_subscriptions SET failures = failures + 1 WHERE endpoint = ?', sub.endpoint)]);
      }
    }
    if (!delivered) throw new Error('aucune notification remise');
  };
}

// Abonnement envoyé par STUDIO : seulement des services de notification connus, clés au bon format.
const PUSH_HOSTS = /^https:\/\/(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)\//;
export function validSubscription(body) {
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (typeof endpoint !== 'string' || endpoint.length > 1024 || !PUSH_HOSTS.test(endpoint)) return null;
  try {
    if (fromB64url(p256dh).length !== 65 || fromB64url(auth).length !== 16) return null;
  } catch {
    return null;
  }
  return { endpoint, p256dh, auth };
}
