// Outils de contre-audit Work. Tous les services externes sont simulés et les clés éphémères.
import { bench } from '../backend/helpers.mjs';
import { b64url } from '../../backend/src/lib.mjs';
import { deliverOutbox } from '../../backend/src/notify.mjs';

export const ENDPOINT = 'https://web.push.apple.com/RECETTE-WORK-NON-REELLE';
export async function keys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { VAPID_PUBLIC_KEY: b64url(await crypto.subtle.exportKey('raw', pair.publicKey)),
    VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', pair.privateKey)).d,
    VAPID_SUBJECT: 'https://example.invalid', pair };
}
export async function device(db, now, endpoint = ENDPOINT) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = b64url(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = b64url(crypto.getRandomValues(new Uint8Array(16)));
  await db.prepare('INSERT INTO push_subscriptions (endpoint, p256dh, auth, label, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(endpoint, p256dh, auth, 'Appareil de recette', now).run();
  return { pair, p256dh, auth };
}
export async function setup({ subscribed = true } = {}) {
  const b = await bench();
  Object.assign(b.env, await keys(), { DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/RECETTE_NON_REELLE' });
  b.deps.channels = ['discord', 'push'];
  if (subscribed) b.device = await device(b.real, b.clock.now());
  b.sent = [];
  b.responses = { apple: () => new Response(null, { status: 201 }), discord: () => new Response(null, { status: 204 }) };
  b.deps.transport = async (url, init) => {
    const host = new URL(url).hostname;
    const channel = host === 'web.push.apple.com' ? 'apple' : host === 'discord.com' ? 'discord' : null;
    if (!channel) throw new Error('Réseau inattendu interdit');
    b.sent.push({ channel, at: b.clock.now(), url, init });
    return b.responses[channel](url, init);
  };
  b.notify = (kind, ref) => b.context().deps.notify({ kind, ref, level: 'info', title: 'Recette indépendante', body: 'Aucune donnée réelle.' });
  b.deliver = () => { const c = b.context(); return deliverOutbox(c.ctx, c.deps.senders, c.deps); };
  // Avance l'horloge au prochain travail : ni attente réelle, ni appels externes.
  b.drain = async (max = 80) => {
    for (let i = 0; i < max; i += 1) {
      const row = (await b.rows("SELECT MIN(next_at) AS at FROM outbox WHERE status IN ('pending','sending')"))[0];
      if (row.at === null) return;
      b.clock.t = Math.max(b.clock.t, row.at);
      await b.deliver();
    }
    throw new Error('La file ne se stabilise pas');
  };
  return b;
}
