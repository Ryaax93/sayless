// Critères d'acceptation indépendants : volontairement rouges sur be0bb9b.
// Ne modifie ni le backend, ni STUDIO. Aucun appel réel à Apple, Discord ou Cloudflare.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { startDatabases, stopDatabases, T0 } from '../backend/helpers.mjs';
import { studio } from '../backend/studio-helpers.mjs';
import { deliverOutbox } from '../../backend/src/notify.mjs';
import { vapidAuthorization } from '../../backend/src/push.mjs';
import { keys, device, setup, ENDPOINT } from './push-review-helpers.mjs';

before(startDatabases);
after(stopDatabases);

test('PUSH-R1a : un nouveau contexte serveur conserve le JWT VAPID pendant au moins une heure', async (t) => {
  const env = await keys();
  const first = await vapidAuthorization(env, ENDPOINT, T0);
  // Module isolé : nouvelle Map, comme un démarrage à froid / autre isolate Cloudflare.
  const fresh = await import(`../../backend/src/push.mjs?audit-cold=${crypto.randomUUID()}`);
  const second = await fresh.vapidAuthorization(env, ENDPOINT, T0 + 60);
  t.diagnostic(`Deux contextes à 60 s d'écart : ${new Set([first, second]).size} JWT distincts ; attendu 1.`);
  assert.equal(second === first, true, 'Le cache doit survivre à un démarrage à froid ; ne jamais imprimer le JWT.');
});

test('PUSH-R1b : plusieurs premiers envois simultanés partagent le même JWT', async (t) => {
  const env = await keys();
  const results = await Promise.all(Array.from({ length: 8 }, () => vapidAuthorization(env, ENDPOINT, T0)));
  t.diagnostic(`Premiers appels concurrents : ${new Set(results).size} JWT distincts ; attendu 1.`);
  assert.equal(new Set(results).size, 1);
});

test('PUSH-R2 : une clôture Face ID pendant un envoi empêche toute nouvelle tentative', async (t) => {
  const b = await studio();
  const { auth } = await b.enroll();
  b.clock.t += 400;
  await b.real.prepare('DELETE FROM outbox').run();
  await b.real.prepare(`INSERT INTO outbox (channel, dedupe, payload, status, attempts, next_at, at)
    VALUES ('push', 'push:technical:outbox:123', ?, 'pending', 2, 0, ?)`)
    .bind(JSON.stringify({ kind: 'technical', title: 'Ancienne boucle', body: 'Recette' }), b.clock.now()).run();
  let unblock;
  let entered;
  const waiting = new Promise((r) => { unblock = r; });
  const started = new Promise((r) => { entered = r; });
  const c = b.context();
  const job = deliverOutbox(c.ctx, { push: async () => { entered(); await waiting; throw new TypeError('reseau'); } }, c.deps);
  await started;
  assert.equal((await b.call('POST', '/api/admin/outbox/close', { scope: 'failed' })).body.error, 'stepup_required');
  assert.equal((await b.stepUp(auth)).status, 200);
  const closed = await b.call('POST', '/api/admin/outbox/close', { scope: 'failed' });
  assert.equal(closed.body.closed, 1);
  unblock();
  await job;
  const [row] = await b.rows("SELECT status, closed_at, close_reason FROM outbox WHERE channel = 'push'");
  let resent = 0;
  b.clock.t += 3600;
  const later = b.context();
  await deliverOutbox(later.ctx, { push: async () => { resent += 1; } }, later.deps);
  t.diagnostic(`Après clôture et réponse réseau tardive : status=${row.status}, closed_at présent=${row.closed_at !== null}, nouvel envoi=${resent}.`);
  assert.equal(resent, 0, 'Une réponse tardive ne doit pas remettre une ligne clôturée en pending.');
});

test('PUSH-R3 : Activer remplace aussi un abonnement expiré qui utilise encore la bonne clé', async (t) => {
  const b = await studio();
  await b.enroll();
  Object.assign(b.env, await keys());
  const k = await device(b.real, b.clock.now());
  await b.real.prepare("UPDATE push_subscriptions SET expired_at = ?, last_error = 'apple_410'").bind(b.clock.now()).run();
  b.deps.transport = async () => new Response(null, { status: 410 });
  let unsubscribed = 0;
  let subscribed = 0;
  const stale = { endpoint: ENDPOINT, options: { applicationServerKey: b.env.VAPID_PUBLIC_KEY },
    unsubscribe: async () => { unsubscribed += 1; }, toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: k.p256dh, auth: k.auth } }) };
  const registration = { pushManager: { getSubscription: async () => stale,
    subscribe: async () => { subscribed += 1; return stale; } } };
  // Exécution de la véritable action de STUDIO, avec les interfaces navigateur simulées.
  const source = await readFile(new URL('../../studio/app.js', import.meta.url), 'utf8');
  const from = source.indexOf("  'push-enable': ") + "  'push-enable': ".length;
  const to = source.indexOf("\n  'push-test':", from);
  const action = source.slice(from, to).trim().replace(/,$/, '');
  const context = { pushSupported: () => true, set: () => {}, guarded: (f) => f(),
    Notification: { requestPermission: async () => 'granted' },
    navigator: { serviceWorker: { register: async () => registration, ready: Promise.resolve(registration) } },
    state: { pushHere: true, data: { notifications: { channels: { push: { public_key: b.env.VAPID_PUBLIC_KEY,
      device_list: [{ active: false, last_error: 'apple_410' }] } } } } },
    subscriptionKey: (sub) => sub?.options?.applicationServerKey,
    b64: { dec: (x) => x }, deviceLabel: () => 'Recette', checkPush: async () => {}, load: async () => {},
    api: async (path, body) => { const r = await b.call('POST', path, body); assert.equal(r.status, 200); return r.body; } };
  await vm.runInNewContext(`(${action})()`, context);
  const reactivated = await b.count('SELECT COUNT(*) FROM push_subscriptions WHERE expired_at IS NULL');
  const tried = await b.call('POST', '/api/admin/push/test', { endpoint: ENDPOINT });
  t.diagnostic(`Activer : unsubscribe=${unsubscribed}, subscribe=${subscribed}, ancien endpoint réactivé=${reactivated}, prochain essai=${tried.body.devices[0]?.status}.`);
  assert.deepEqual([unsubscribed, subscribed], [1, 1], 'Ne pas réactiver uniquement en base un endpoint déjà refusé par Apple.');
});

test('PUSH-R4 : un salon Discord sain ne clôt pas la panne persistante d’un autre salon', async (t) => {
  const b = await setup({ subscribed: false });
  delete b.env.DISCORD_WEBHOOK_URL;
  b.env.DISCORD_WEBHOOK_COMMANDES = 'https://discord.com/api/webhooks/1/COMMANDES_RECETTE';
  b.env.DISCORD_WEBHOOK_STOCK = 'https://discord.com/api/webhooks/2/STOCK_RECETTE';
  b.env.DISCORD_WEBHOOK_ALERTES = 'https://discord.com/api/webhooks/3/ALERTES_RECETTE';
  b.responses.discord = (url) => new Response(null, { status: url.endsWith('/COMMANDES_RECETTE') ? 404 : 204 });
  for (let i = 0; i < 4; i += 1) {
    await b.notify('order_paid', `order-${i}`);
    await b.drain();
    await b.notify('low_stock', `stock-${i}`);
    await b.drain();
    b.clock.t += 60;
  }
  const n = await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'channel_failure'");
  const [health] = await b.rows("SELECT state FROM channel_health WHERE channel = 'discord'");
  t.diagnostic(`Webhook commandes toujours 404 : ${n} alertes en 4 min, diagnostic global=${health.state}.`);
  assert.equal(n, 1, 'Une panne du même webhook doit rester un incident, malgré les autres salons sains.');
});

test('PUSH-R5 : le diagnostic Santé reflète un refus Apple observé pendant l’essai manuel', async (t) => {
  const b = await studio();
  await b.enroll();
  Object.assign(b.env, await keys());
  await device(b.real, b.clock.now());
  b.deps.transport = async () => new Response('{"reason":"BadJwtToken"}', { status: 403 });
  const result = await b.call('POST', '/api/admin/push/test', { endpoint: ENDPOINT });
  assert.equal(result.body.devices[0].status, 403);
  const health = (await b.call('GET', '/api/admin/health')).body.checks.find((x) => x.name === 'Notifications iPhone');
  t.diagnostic(`Essai manuel refusé 403 BadJwtToken ; Santé=${health.state}, « ${health.detail} ».`);
  assert.equal(health.state, 'alert', 'La santé du canal doit tenir compte du dernier échec diagnostiqué.');
});
