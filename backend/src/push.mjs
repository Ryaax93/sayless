// Notifications sur l'iPhone (Web Push standard : RFC 8030, chiffrement RFC 8291, VAPID RFC 8292),
// sans service payant ni bibliothèque : Web Crypto suffit (signature et chiffrement natifs du moteur,
// aucune arithmétique sur une clé secrète dans notre code). Fonctionne quand STUDIO est installé sur
// l'écran d'accueil (iOS 16.4 et suivants) et que le fondateur a accepté les notifications.
// Clés : VAPID_PUBLIC_KEY (publique), VAPID_PRIVATE_KEY (secrète, saisie dans Cloudflare),
// VAPID_SUBJECT (mailto: ou https:). Les messages ne contiennent jamais de donnée personnelle.
// Exigences d'Apple (documentation « Sending web push notifications in web apps and browsers ») :
// en-têtes TTL, Urgency et Topic valides, jeton VAPID d'au plus un jour, renouvelé au plus une fois
// par heure, clé publique identique à celle de l'abonnement ; réponse 201 si accepté, sinon un code
// HTTP et une raison (« reason ») gardés pour le diagnostic. Aucune adresse d'abonnement ni clé n'est
// jamais affichée ou journalisée : seulement le service (apple…), le code et une empreinte courte.
import { all, audit, b64url, batch, fromB64url, sql } from './lib.mjs';
import { vapidStore } from './vapid-store.mjs';

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

// Empreinte courte (12 caractères hexadécimaux du SHA-256) : compare une clé ou un abonnement sans
// jamais montrer la valeur elle-même.
export async function fingerprint(text) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(text))));
  return [...digest.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Clé privée VAPID au format JWK (d seul, ou JWK complet) complétée par la clé publique brute.
async function vapidKey(env) {
  const pub = fromB64url(env.VAPID_PUBLIC_KEY);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC_KEY invalide');
  const raw = env.VAPID_PRIVATE_KEY.trim();
  const d = raw.startsWith('{') ? JSON.parse(raw).d : raw;
  return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33)), d, ext: false },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

// Jeton VAPID : signé par Web Crypto (ECDSA P-256, signature native), puis partagé par toutes les
// instances du Worker par la base D1 (table vapid_tokens, migration 0011). Apple : jamais plus d'un
// renouvellement par heure, jamais plus d'un jour de validité.
// - Validité 12 h ; réutilisation 6 h au moins après l'émission, par toute instance (à froid, en
//   parallèle, de part et d'autre d'une heure pile) : le délai part de la première émission.
// - Rotation atomique : le nouveau jeton ne remplace l'ancien que si l'ancien a 6 h ou expire dans
//   moins d'une heure, condition vérifiée par la base au moment même de l'écriture ; une seule
//   instance gagne, toutes relisent le jeton enregistré. Une horloge en avance de quelques minutes
//   renouvelle au plus quelques minutes plus tôt ; une horloge en retard réutilise le jeton.
// - Base injoignable ou absente : aucun jeton, l'envoi attend (nouvel essai de la file). Un jeton
//   signé mais non enregistré n'est jamais utilisé.
// - Chaque jeton est vérifié avec la clé publique avant d'être enregistré ou réutilisé : une clé
//   privée qui ne correspond pas à la clé publique ne produit jamais de jeton.
// Cache de l'instance : un jeton déjà enregistré dans la base, sans relire celle-ci, jusqu'à dix
// minutes avant sa date de renouvellement ; ensuite chaque envoi relit la base, pour qu'une
// instance à l'horloge en retard (moins de dix minutes) prenne aussitôt le jeton renouvelé par une
// autre, sans revenir à l'ancien.
export const VAPID_REUSE = 6 * 3600;
export const VAPID_LIFETIME = 12 * 3600;
const VAPID_MARGIN = 3600;
const LOCAL_GUARD = 600;
const reusable = (row, now) => now < row.issued_at + VAPID_REUSE && now < row.expires_at - VAPID_MARGIN;
const cached = (row, now) => now < row.issued_at + VAPID_REUSE - LOCAL_GUARD && now < row.expires_at - VAPID_MARGIN;
const issued = new Map();
const pending = new Map();
export async function vapidAuthorization(env, endpoint, now) {
  const audience = new URL(endpoint).origin;
  const db = vapidStore(env);
  if (!db) throw new PushError('vapid_sans_base', { permanent: true });
  const config = await fingerprint(`${env.VAPID_PUBLIC_KEY} ${env.VAPID_SUBJECT}`);
  const key = `${audience} ${config}`;
  let row = issued.get(key);
  if (!row || !cached(row, now)) {
    const flight = `${key} ${now}`; // appels simultanés au même instant : une seule lecture de la base
    if (!pending.has(flight)) pending.set(flight, sharedToken(db, env, audience, config, now).finally(() => pending.delete(flight)));
    row = await pending.get(flight);
    // Lectures simultanées de part et d'autre d'une rotation : le jeton le plus récent l'emporte,
    // jamais de retour à l'ancien dans cette instance.
    const current = issued.get(key);
    if (!current || current.issued_at <= row.issued_at) issued.set(key, row);
    else row = current;
  }
  return `vapid t=${row.token}, k=${env.VAPID_PUBLIC_KEY}`;
}
const SELECT_TOKEN = 'SELECT token, issued_at, expires_at FROM vapid_tokens WHERE audience = ? AND config = ?';
async function sharedToken(db, env, audience, config, now) {
  let row;
  try {
    row = await db.prepare(SELECT_TOKEN).bind(audience, config).first();
  } catch {
    throw new PushError('vapid_base_indisponible');
  }
  if (row && reusable(row, now) && await verifyToken(env, row.token, audience)) return row;
  const token = await signToken(env, audience, now + VAPID_LIFETIME);
  let stored;
  try {
    // Remplacement conditionnel puis relecture, dans le même lot (une transaction) : le jeton rendu
    // est toujours celui de la base, le nôtre seulement si notre écriture l'a emporté.
    const [, read] = await db.batch([
      db.prepare(`INSERT INTO vapid_tokens (audience, config, token, issued_at, expires_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (audience, config) DO UPDATE SET token = excluded.token, issued_at = excluded.issued_at, expires_at = excluded.expires_at
        WHERE vapid_tokens.issued_at <= ? OR vapid_tokens.expires_at <= ? OR vapid_tokens.token = ?`)
        .bind(audience, config, token, now, now + VAPID_LIFETIME, now - VAPID_REUSE, now + VAPID_MARGIN, row?.token ?? ''),
      db.prepare(SELECT_TOKEN).bind(audience, config),
    ]);
    stored = read?.results?.[0];
  } catch {
    throw new PushError('vapid_base_indisponible');
  }
  if (!stored) throw new PushError('vapid_base_indisponible');
  if (stored.token !== token && !(await verifyToken(env, stored.token, audience))) throw new PushError('vapid_cle_invalide', { permanent: true });
  return stored;
}
async function signToken(env, audience, exp) {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(enc.encode(JSON.stringify({ aud: audience, exp, sub: env.VAPID_SUBJECT })));
  let signature;
  try {
    signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidKey(env), enc.encode(`${header}.${claims}`)));
  } catch {
    throw new PushError('vapid_cle_invalide', { permanent: true });
  }
  const token = `${header}.${claims}.${b64url(signature)}`;
  if (!(await verifyToken(env, token, audience))) throw new PushError('vapid_cle_invalide', { permanent: true }); // paire incohérente
  return token;
}
// Signature vérifiée avec la clé publique configurée, et audience attendue.
async function verifyToken(env, token, audience) {
  try {
    const [header, claims, signature] = String(token).split('.');
    if (JSON.parse(new TextDecoder().decode(fromB64url(claims))).aud !== audience) return false;
    const pub = await crypto.subtle.importKey('raw', fromB64url(env.VAPID_PUBLIC_KEY), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, fromB64url(signature), enc.encode(`${header}.${claims}`));
  } catch {
    return false;
  }
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

// Service de notification d'après l'hôte de l'abonnement (jamais l'adresse complète).
const SERVICES = [[/(^|\.)push\.apple\.com$/, 'apple'], [/^fcm\.googleapis\.com$/, 'google'],
  [/^updates\.push\.services\.mozilla\.com$/, 'mozilla'], [/\.notify\.windows\.com$/, 'windows']];
export const pushService = (endpoint) => {
  const host = new URL(endpoint).hostname;
  return SERVICES.find(([pattern]) => pattern.test(host))?.[1] ?? 'autre';
};

// Réponse d'un service de notification : remis, abonnement expiré (404, 410), abonnement créé avec une
// autre clé (VapidPkHashMismatch), panne passagère (408, 429, 5xx, réseau) ou refus à corriger
// (400, 403, 405, 413 : réessayer n'y change rien).
export function classifyPush(status, reason = null) {
  if (status >= 200 && status < 300) return 'ok';
  if (reason === 'VapidPkHashMismatch') return 'mismatch';
  if (status === 404 || status === 410) return 'expired';
  if (status === 0 || status === 408 || status === 429 || status >= 500) return 'transient';
  return 'permanent';
}

// Explication en français d'un code d'échec (service_statut_raison, ou code interne), pour STUDIO et
// les alertes. Raisons d'Apple : documentation citée plus haut.
const REASONS = {
  BadJwtToken: 'Apple refuse le jeton VAPID (signature, sujet https: ou mailto:, audience ou expiration)',
  BadVapidPublicKey: 'Apple refuse la clé publique VAPID (absente, mal encodée ou d’un autre type)',
  VapidPkHashMismatch: 'l’iPhone s’est abonné avec une autre clé VAPID : réactive les notifications sur l’iPhone',
  BadAuthorizationHeader: 'en-tête Authorization non conforme',
  BadTtl: 'en-tête TTL absent ou invalide',
  BadUrgency: 'en-tête Urgency invalide',
  BadWebPushTopic: 'en-tête Topic non conforme',
  BadWebPushRequest: 'chiffrement du message non conforme',
  PayloadTooLarge: 'message de plus de 4 Ko',
  TooManyRequests: 'trop d’envois vers cet appareil, nouvel essai plus tard',
  BadPath: 'adresse d’abonnement invalide',
  MethodNotAllowed: 'méthode refusée',
  IdleTimeout: 'connexion expirée chez Apple',
  InternalServerError: 'panne passagère chez Apple',
  ServiceUnavailable: 'service Apple indisponible',
  Shutdown: 'service Apple en redémarrage',
};
const CODES = {
  aucun_appareil: 'aucun iPhone abonné : active les notifications depuis STUDIO sur l’iPhone',
  reseau: 'service de notification injoignable (réseau)',
  delai: 'aucune réponse du service de notification en 8 secondes',
  vapid_cle_invalide: 'clé VAPID du Worker illisible ou incohérente',
  vapid_base_indisponible: 'base de données injoignable : aucun jeton VAPID partagé, nouvel essai automatique',
  vapid_sans_base: 'base de données absente : aucun jeton VAPID ne peut être émis',
  abonnement_invalide: 'abonnement de l’appareil illisible : réactive les notifications sur l’iPhone',
  canal_non_configure: 'canal non configuré',
  salon_discord_absent: 'aucun webhook Discord pour ce salon',
  discord_reseau: 'Discord injoignable (réseau)',
};
export function explainCode(code) {
  const text = String(code ?? '');
  if (CODES[text]) return CODES[text];
  const push = /^(apple|google|mozilla|windows|autre)_(\d{3})(?:_([A-Za-z]+))?$/.exec(text);
  if (push) {
    const [, service, status, reason] = push;
    const who = service === 'apple' ? 'Apple' : 'le service de notification';
    if (reason && REASONS[reason]) return `${REASONS[reason]} (${status} ${reason})`;
    if (status === '404' || status === '410') return `abonnement expiré chez ${who} (${status}) : réactive les notifications sur l’iPhone`;
    if (status === '429') return `${who} demande d’attendre (429)`;
    if (Number(status) >= 500) return `panne passagère chez ${who} (${status})`;
    return `${who} refuse le message (${status})`;
  }
  const discord = /^discord_(\d{3})$/.exec(text);
  if (discord) {
    const status = Number(discord[1]);
    if (status === 401 || status === 403 || status === 404) return `webhook Discord refusé ou supprimé (${status}) : recrée-le (docs/DISCORD.md)`;
    if (status === 429) return 'Discord demande d’attendre (429)';
    return status >= 500 ? `panne passagère de Discord (${status})` : `Discord refuse le message (${status})`;
  }
  return text || 'erreur inconnue';
}

// Erreur d'envoi push : `code` sans donnée personnelle ; `noDevice` (aucun appareil actif : pas une
// panne), `permanent` (réessayer ne sert à rien), `retryAfter` (secondes demandées par le service).
export class PushError extends Error {
  constructor(code, extra = {}) {
    super(code);
    this.code = code;
    Object.assign(this, extra);
  }
}

async function readReason(response) {
  try {
    const reason = JSON.parse((await response.text()).slice(0, 512))?.reason;
    return typeof reason === 'string' && /^[A-Za-z]{2,40}$/.test(reason) ? reason : null;
  } catch {
    return null;
  }
}

// Un envoi vers un appareil. Ne lève que si le budget de l'invocation est épuisé (la suite attend).
// Tentative réservée sur l'appareil juste avant l'appel au service (numéro attempt_seq, et identifiant
// d'essai s'il s'agit d'un essai depuis STUDIO) : son résultat ne sera écrit que si aucun envoi plus
// récent n'a été réservé entre-temps (même seconde, autre client STUDIO, tâche planifiée).
// Échec avant toute réservation (jeton VAPID indisponible, clé illisible) : rien n'est écrit sur
// l'appareil, qui n'a pas été contacté (`local`).
async function sendToDevice(env, transport, sub, message, now) {
  const service = pushService(sub.endpoint);
  const done = (result, extra = {}) => ({ endpoint: sub.endpoint, label: sub.label ?? null, service, status: 0, reason: null, code: null, retryAfter: null,
    attempt: null, local: false, result, ...extra });
  let authorization;
  try {
    authorization = await vapidAuthorization(env, sub.endpoint, now);
  } catch (error) {
    const known = error instanceof PushError ? error : new PushError('vapid_cle_invalide', { permanent: true });
    return done(known.permanent ? 'permanent' : 'transient', { code: known.code, local: true });
  }
  const test = typeof message.test === 'string' ? message.test : null;
  const claimed = await sql(env.DB, test
    ? `UPDATE push_subscriptions SET attempt_seq = attempt_seq + 1, test_id = ?, test_sent_at = ?, received_at = NULL
        WHERE endpoint = ? AND expired_at IS NULL RETURNING attempt_seq`
    : 'UPDATE push_subscriptions SET attempt_seq = attempt_seq + 1 WHERE endpoint = ? AND expired_at IS NULL RETURNING attempt_seq',
  ...(test ? [test, now, sub.endpoint] : [sub.endpoint])).first();
  if (!claimed) return null; // expiré entre-temps : plus utilisé, rien à envoyer
  const attempt = claimed.attempt_seq;
  let body;
  try {
    body = await encryptPush(sub, { title: message.title, body: message.body, level: message.level, kind: message.kind, ...(test ? { test } : {}) });
  } catch {
    return done('expired', { code: 'abonnement_invalide', attempt });
  }
  let response;
  try {
    response = await transport(sub.endpoint, {
      method: 'POST', signal: AbortSignal.timeout(8000),
      headers: { Authorization: authorization, TTL: '86400', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
        Urgency: message.level === 'critical' ? 'high' : 'normal', Topic: String(message.kind ?? 'studio').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'studio' },
      body,
    });
  } catch (error) {
    if (error?.code === 'budget_exhausted') throw error;
    return done('transient', { code: error?.name === 'TimeoutError' ? 'delai' : 'reseau', attempt });
  }
  const status = response.status;
  const reason = response.ok ? null : await readReason(response);
  const result = classifyPush(status, reason);
  const wait = Number(response.headers.get('Retry-After'));
  return done(result, { status, reason, code: result === 'ok' ? null : `${service}_${status}${reason ? `_${reason}` : ''}`, attempt,
    retryAfter: result === 'transient' && Number.isFinite(wait) && wait > 0 ? Math.min(Math.ceil(wait), 3600) : null });
}

// Résultat d'un appareil enregistré sur son abonnement, seulement si c'est encore sa dernière
// tentative (aucune suppression : un abonnement expiré reste visible dans le diagnostic, il n'est
// simplement plus utilisé).
const deviceUpdate = (db, r, now) => {
  const mine = 'WHERE endpoint = ? AND attempt_seq = ?';
  if (r.result === 'ok') {
    return sql(db, `UPDATE push_subscriptions SET last_ok_at = ?, last_attempt_at = ?, last_status = ?, last_error = NULL, failures = 0 ${mine}`,
      now, now, r.status, r.endpoint, r.attempt);
  }
  if (r.result === 'expired' || r.result === 'mismatch') {
    return sql(db, `UPDATE push_subscriptions SET expired_at = COALESCE(expired_at, ?), last_attempt_at = ?, last_status = ?, last_error = ? ${mine}`,
      now, now, r.status, r.code, r.endpoint, r.attempt);
  }
  return sql(db, `UPDATE push_subscriptions SET failures = failures + 1, last_attempt_at = ?, last_status = ?, last_error = ? ${mine}`,
    now, r.status, r.code, r.endpoint, r.attempt);
};

// Envoi à tous les appareils actifs (ou à un seul : essai depuis STUDIO). Renvoie le détail par
// appareil, avec `applied` : vrai si ce résultat est devenu l'état de l'appareil, faux s'il est
// arrivé après une tentative plus récente (seulement noté dans l'historique, sans rien écraser).
export async function sendToDevices(env, transport, message, now, { endpoint = null } = {}) {
  const subs = await all(env.DB, `SELECT endpoint, p256dh, auth, label FROM push_subscriptions WHERE expired_at IS NULL
    ${endpoint ? 'AND endpoint = ?' : ''} ORDER BY created_at`, ...(endpoint ? [endpoint] : []));
  const results = [];
  for (const sub of subs) {
    const r = await sendToDevice(env, transport, sub, message, now);
    if (r) results.push(r);
  }
  const attempted = results.filter((r) => !r.local);
  if (attempted.length) {
    const written = await batch(env.DB, attempted.map((r) => deviceUpdate(env.DB, r, now)));
    attempted.forEach((r, i) => { r.applied = written[i].meta.changes === 1; });
    const late = attempted.filter((r) => !r.applied);
    if (late.length) {
      await batch(env.DB, late.map((r) => audit(env.DB, now, 'system', 'push_reponse_tardive', r.label ?? 'Appareil',
        `${r.code ?? `${r.service}_${r.status}`} (tentative ${r.attempt}, remplacée)`.slice(0, 120))));
    }
  }
  for (const r of results) r.applied ??= false;
  return results;
}

// Expéditeur de la file : remis si au moins un appareil a accepté. Aucun appareil actif (jamais
// abonné, ou tous expirés) : `noDevice`, ce n'est pas une panne et rien n'est réessayé. Sinon
// l'erreur porte le code du premier échec, passager (réessai, Retry-After respecté) ou à corriger.
// `current` : remises qui sont aussi le dernier résultat de leur appareil ; à zéro, la file note le
// message comme remis sans déclarer le canal rétabli (un essai plus récent a eu le dernier mot).
export function pushSender(env, transport = fetch, clock = () => Math.floor(Date.now() / 1000)) {
  return async (message) => {
    const results = await sendToDevices(env, transport, message, clock());
    const expired = results.filter((r) => r.result === 'expired' || r.result === 'mismatch');
    const notice = { expired: await Promise.all(expired.filter((r) => r.applied).map(async (r) => ({ fp: await fingerprint(r.endpoint), label: r.label, code: r.code }))) };
    const delivered = results.filter((r) => r.result === 'ok');
    if (delivered.length) return { id: null, delivered: delivered.length, current: delivered.filter((r) => r.applied).length, devices: results.length, ...notice };
    if (!results.length || expired.length === results.length) {
      throw new PushError('aucun_appareil', { noDevice: true, detail: expired[0]?.code ?? null, ...notice });
    }
    const transient = results.filter((r) => r.result === 'transient');
    if (transient.length) {
      const waits = transient.map((r) => r.retryAfter).filter((w) => w !== null);
      throw new PushError(transient[0].code, { retryAfter: waits.length ? Math.max(...waits) : undefined, ...notice });
    }
    throw new PushError(results.find((r) => r.result === 'permanent').code, { permanent: true, ...notice });
  };
}

// Contrôle des clés sans rien envoyer : la clé privée signe, la clé publique vérifie (une paire
// incohérente donne « BadJwtToken » chez Apple), et le sujet est une adresse https: ou mailto:.
export async function vapidSelfCheck(env) {
  const checks = { configured: pushReady(env), subject: /^(mailto:[^\s<>]+@[^\s<>]+|https:\/\/[^\s<>]+)$/.test(env.VAPID_SUBJECT ?? ''), keypair: false, key_fp: null };
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return checks;
  try {
    checks.key_fp = await fingerprint(env.VAPID_PUBLIC_KEY);
    const sample = enc.encode('sayless-vapid-check');
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidKey(env), sample);
    const pub = await crypto.subtle.importKey('raw', fromB64url(env.VAPID_PUBLIC_KEY), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    checks.keypair = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, signature, sample);
  } catch {
    checks.keypair = false;
  }
  return checks;
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
