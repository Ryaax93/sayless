// Notifications push et alertes de canal (correctif du 27 novembre 2026, essais réels sur
// Cloudflare TEST) : plus de boucle ni de spam, même si Discord et l'iPhone tombent ensemble ;
// l'absence d'appareil n'est pas une panne ; réponse d'Apple exploitable sans secret ni donnée
// personnelle ; essai manuel et clôture des envois échoués depuis STUDIO. Services SIMULÉS : Apple
// (web.push.apple.com) et Discord répondent selon le scénario ; aucun appel réseau réel.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bench, emptyDatabase, migrate, startDatabases, stopDatabases, T0 } from './helpers.mjs';
import { studio } from './studio-helpers.mjs';
import { ALERT_REPEAT, deliverOutbox } from '../../backend/src/notify.mjs';
import { fingerprint, vapidAuthorization } from '../../backend/src/push.mjs';
import { createContext, runScheduled } from '../../backend/src/routes.mjs';
import { b64url, fromB64url } from '../../backend/src/lib.mjs';

before(startDatabases);
after(stopDatabases);

const SECRET_ENDPOINT = 'https://web.push.apple.com/QJETON-APPAREIL-SECRET-0001';

async function vapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { VAPID_PUBLIC_KEY: b64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
    VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', pair.privateKey)).d, VAPID_SUBJECT: 'https://saylessbrand.fr' };
}
async function deviceKeys() {
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { p256dh: b64url(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey))), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) };
}
async function addDevice(b, endpoint = SECRET_ENDPOINT) {
  const k = await deviceKeys();
  await b.real.prepare(`INSERT INTO push_subscriptions (endpoint, p256dh, auth, label, created_at) VALUES (?, ?, ?, 'iPhone', ?)`)
    .bind(endpoint, k.p256dh, k.auth, b.clock.now()).run();
  return k;
}

// Réseau simulé : Apple répond b.apple ({ status, reason, retryAfter } ou { down: true }) ; Discord
// répond b.discord (statut, ou panne réseau). Chaque appel est noté (hôte, heure, en-têtes, corps).
function simulate(b) {
  b.apple = { status: 201 };
  b.discord = { status: 204 };
  b.net = [];
  b.deps.transport = async (url, init) => {
    const host = new URL(url).host;
    b.net.push({ host, at: b.clock.now(), headers: init.headers, body: typeof init.body === 'string' ? init.body : null });
    const side = host === 'web.push.apple.com' ? b.apple : host === 'discord.com' ? b.discord : null;
    if (!side) throw new Error('hôte inattendu');
    if (side.down) throw new TypeError('Network connection lost');
    return new Response(side.reason ? JSON.stringify({ reason: side.reason }) : null,
      { status: side.status, headers: side.retryAfter ? { 'Retry-After': String(side.retryAfter) } : {} });
  };
}
async function pushBench({ devices = 1 } = {}) {
  const b = await bench();
  Object.assign(b.env, await vapidKeys(), { DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/jeton-webhook-secret' });
  b.deps.channels = ['discord', 'push'];
  simulate(b);
  for (let i = 0; i < devices; i += 1) await addDevice(b, i ? `${SECRET_ENDPOINT}-${i}` : SECRET_ENDPOINT);
  b.notify = (kind, ref) => b.context().deps.notify({ kind, ref, level: 'info', title: `Événement ${kind}`, body: `Référence ${ref}` });
  b.deliver = () => { const { ctx, deps } = b.context(); return deliverOutbox(ctx, deps.senders, deps); };
  b.minutes = async (n, step = 1) => { for (let i = 0; i < n; i += step) { await b.deliver(); b.clock.t += 60 * step; } };
  b.discordTitles = () => b.net.filter((c) => c.host === 'discord.com').map((c) => JSON.parse(c.body).embeds[0].title);
  b.apples = () => b.net.filter((c) => c.host === 'web.push.apple.com').length;
  return b;
}
const failureAlerts = (b) => b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'channel_failure'");

test('N01 iPhone refusé par Apple, Discord en marche : une seule alerte, aucune boucle, au plus un rappel par jour', async () => {
  const b = await pushBench();
  b.apple = { status: 403, reason: 'BadJwtToken' };
  await b.notify('daily_report', '2026-11-27');
  await b.notify('backup_not_configured', 'x');
  await b.minutes(8 * 60, 10);
  // Avant le correctif : 30 alertes « Canal push : échec après 5 essais » en 8 h, deux toutes les 31 min.
  assert.deepEqual(b.discordTitles(), ['Événement daily_report', 'Événement backup_not_configured', 'Notifications iPhone en échec']);
  assert.equal(b.apples(), 2, 'un refus à corriger : un seul essai par message, aucun réessai inutile chez Apple');
  assert.deepEqual(await b.rows("SELECT channel, status, last_error FROM outbox WHERE channel = 'push' ORDER BY id"),
    [{ channel: 'push', status: 'dead', last_error: 'apple_403_BadJwtToken' }, { channel: 'push', status: 'dead', last_error: 'apple_403_BadJwtToken' }]);
  assert.equal(await b.count("SELECT COUNT(*) FROM outbox WHERE status IN ('pending', 'sending')"), 0, 'file vide : point fixe');
  assert.equal(await b.count('SELECT COUNT(*) FROM outbox'), 5, '2 événements × 2 canaux + 1 alerte, jamais par l’iPhone');
  const [alert] = await b.rows("SELECT title, body, level FROM notifications WHERE kind = 'channel_failure'");
  assert.equal(alert.level, 'critical');
  assert.match(alert.body, /^1 message\(s\) non remis depuis le .*Apple refuse le jeton VAPID.*\(403 BadJwtToken\)/, 'alerte dès le premier message abandonné');
  assert.equal(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'technical'"), 0);
  // Trois jours de panne avec un événement par heure : un message, un seul essai chez Apple, et
  // une alerte de rappel par jour au plus (avant : une alerte toutes les 31 min, sans fin).
  for (let h = 0; h < 72; h += 1) {
    await b.notify('order_paid', `cmd-${h}`);
    await b.minutes(60, 10);
  }
  assert.equal(b.apples(), 74);
  const alerts = await failureAlerts(b);
  assert.ok(alerts >= 3 && alerts <= 4, `alertes en 3 jours : ${alerts}`);
  assert.equal(b.discordTitles().filter((t) => /iPhone (toujours )?en échec/.test(t)).length, alerts);
  assert.equal(await b.count("SELECT COUNT(*) FROM outbox WHERE status IN ('pending', 'sending')"), 0);
  const gaps = (await b.rows("SELECT at FROM notifications WHERE kind = 'channel_failure' ORDER BY at")).map((r, i, l) => (i ? r.at - l[i - 1].at : null)).slice(1);
  assert.ok(gaps.every((g) => g >= ALERT_REPEAT), `rappels espacés d’au moins 24 h : ${gaps}`);
});

test('N02 Discord ET iPhone en panne en même temps : une alerte par canal, aucune alerte sur une alerte, nombre d’essais borné', async () => {
  const b = await pushBench();
  b.apple = { status: 503 };
  b.discord = { down: true };
  for (const ref of ['a', 'b', 'c']) await b.notify('order_paid', ref);
  await b.minutes(12 * 60);
  assert.equal(await failureAlerts(b), 2, 'une alerte pour l’iPhone, une pour Discord');
  // Alerte « iPhone en panne » partie seulement vers Discord (en panne), et inversement : aucune
  // n'en déclenche une autre en mourant.
  assert.equal(await b.count("SELECT COUNT(*) FROM outbox WHERE dedupe LIKE 'push:channel_failure:push:%' OR dedupe LIKE 'discord:channel_failure:discord:%'"), 0);
  assert.deepEqual([await b.count('SELECT COUNT(*) FROM outbox'), await b.count("SELECT COUNT(*) FROM outbox WHERE status = 'dead'")], [8, 8]);
  const [apple, discord] = [b.apples(), b.net.filter((c) => c.host === 'discord.com').length];
  assert.deepEqual([apple, discord], [20, 20], '(3 messages + 1 alerte) × 5 essais par canal, puis plus rien');
  await b.minutes(24 * 60, 30);
  assert.deepEqual([b.apples(), await failureAlerts(b), await b.count('SELECT COUNT(*) FROM outbox')], [20, 2, 8], 'point fixe : rien ne se crée tout seul');
  const health = await b.rows('SELECT channel, state, failures FROM channel_health ORDER BY channel');
  assert.deepEqual(health, [{ channel: 'discord', state: 'failing', failures: 4 }, { channel: 'push', state: 'failing', failures: 4 }]);
});

test('N03 aucun appareil abonné : rien en file pour l’iPhone, aucune alerte ; abonnement expiré = ligne close et une seule notice', async () => {
  const b = await pushBench({ devices: 0 });
  for (let i = 0; i < 5; i += 1) await b.notify('order_paid', `cmd-${i}`);
  await b.minutes(3 * 60, 5);
  assert.equal(await b.count("SELECT COUNT(*) FROM outbox WHERE channel = 'push'"), 0);
  assert.deepEqual([b.apples(), await failureAlerts(b), await b.count('SELECT COUNT(*) FROM notifications')], [0, 0, 5], 'messages gardés dans STUDIO');
  // Un iPhone abonné, puis Apple déclare l'abonnement expiré (410) avant l'envoi.
  await addDevice(b);
  await b.notify('order_paid', 'cmd-5');
  b.apple = { status: 410 };
  await b.minutes(10);
  assert.deepEqual(await b.rows("SELECT status, close_reason, last_error FROM outbox WHERE channel = 'push'"),
    [{ status: 'dead', close_reason: 'aucun_appareil', last_error: 'apple_410' }]);
  assert.equal(await failureAlerts(b), 0, 'un abonnement expiré n’est pas une panne');
  assert.deepEqual([await b.count('SELECT COUNT(*) FROM push_subscriptions'), await b.count('SELECT COUNT(*) FROM push_subscriptions WHERE expired_at IS NOT NULL')], [1, 1]);
  assert.deepEqual(b.discordTitles().filter((t) => t === 'Notifications iPhone à réactiver').length, 1);
  await b.notify('order_paid', 'cmd-6');
  await b.minutes(60, 5);
  assert.deepEqual([await b.count("SELECT COUNT(*) FROM outbox WHERE channel = 'push'"), b.apples()], [1, 1], 'plus aucun envoi vers un abonnement expiré');
});

test('N04 diagnostic Apple : refus, attente, panne passagère, autre clé ; codes sans adresse, clé ni donnée personnelle', async () => {
  const b = await pushBench();
  const keys = await b.rows('SELECT p256dh, auth FROM push_subscriptions');
  b.apple = { status: 429, reason: 'TooManyRequests', retryAfter: 120 };
  await b.notify('order_paid', 'r1');
  await b.deliver();
  assert.deepEqual(await b.rows("SELECT status, attempts, next_at - ? AS wait, last_error FROM outbox WHERE dedupe = 'push:order_paid:r1'", b.clock.now()),
    [{ status: 'pending', attempts: 0, wait: 120, last_error: 'apple_429_TooManyRequests' }], 'Retry-After respecté, essai non compté');
  b.apple = { status: 500 };
  b.clock.t += 121;
  await b.deliver();
  assert.deepEqual(await b.rows("SELECT status, attempts, last_error FROM outbox WHERE dedupe = 'push:order_paid:r1'"), [{ status: 'pending', attempts: 1, last_error: 'apple_500' }]);
  b.apple = { down: true };
  b.clock.t += 121;
  await b.deliver();
  assert.equal(await b.count("SELECT last_error FROM outbox WHERE dedupe = 'push:order_paid:r1'"), 'reseau');
  b.apple = { status: 413, reason: 'PayloadTooLarge' };
  b.clock.t += 241;
  await b.deliver();
  assert.deepEqual(await b.rows("SELECT status, last_error FROM outbox WHERE dedupe = 'push:order_paid:r1'"), [{ status: 'dead', last_error: 'apple_413_PayloadTooLarge' }]);
  // Abonnement créé avec une autre clé VAPID : appareil à réabonner, pas une panne du canal.
  b.apple = { status: 403, reason: 'VapidPkHashMismatch' };
  await b.notify('order_paid', 'r2');
  await b.deliver();
  assert.deepEqual(await b.rows("SELECT status, close_reason, last_error FROM outbox WHERE dedupe = 'push:order_paid:r2'"),
    [{ status: 'dead', close_reason: 'aucun_appareil', last_error: 'apple_403_VapidPkHashMismatch' }]);
  assert.equal(await b.count('SELECT last_error FROM push_subscriptions'), 'apple_403_VapidPkHashMismatch');
  // Rien de secret ni de personnel dans ce qui est gardé ou envoyé à Discord.
  const kept = JSON.stringify([await b.rows('SELECT last_error, payload FROM outbox'), await b.rows('SELECT title, body FROM notifications'),
    await b.rows('SELECT * FROM channel_health'), await b.rows('SELECT last_error FROM push_subscriptions'), b.discordTitles(),
    b.net.filter((c) => c.host === 'discord.com').map((c) => c.body)]);
  for (const secret of ['QJETON-APPAREIL-SECRET', keys[0].p256dh, keys[0].auth, b.env.VAPID_PRIVATE_KEY, 'jeton-webhook-secret']) {
    assert.ok(!kept.includes(secret), `fuite : ${secret.slice(0, 12)}…`);
  }
});

test('N05 jeton VAPID conforme à Apple : réutilisé au moins une heure, valable moins d’un jour, en-têtes valides', async () => {
  const b = await pushBench();
  await b.notify('order_paid', 't1');
  await b.deliver();
  b.clock.t += 1800;
  await b.notify('order_paid', 't2');
  await b.deliver();
  b.clock.t += 7 * 3600;
  await b.notify('order_paid', 't3');
  await b.deliver();
  const calls = b.net.filter((c) => c.host === 'web.push.apple.com');
  assert.equal(calls.length, 3);
  const auth = calls.map((c) => c.headers.Authorization);
  assert.equal(auth[0], auth[1], 'même jeton 30 min plus tard');
  assert.notEqual(auth[1], auth[2], 'nouveau jeton après 7 h');
  for (const [i, header] of auth.entries()) {
    const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(jwt.split('.')[1])));
    assert.equal(k, b.env.VAPID_PUBLIC_KEY);
    assert.equal(claims.aud, 'https://web.push.apple.com');
    assert.match(claims.sub, /^(https:\/\/|mailto:)\S+$/);
    assert.ok(claims.exp - calls[i].at <= 86400 && claims.exp > calls[i].at, 'expiration à moins d’un jour');
    assert.ok(Number(calls[i].headers.TTL) > 0 && ['very-low', 'low', 'normal', 'high'].includes(calls[i].headers.Urgency));
    assert.match(calls[i].headers.Topic, /^[A-Za-z0-9_-]{1,32}$/);
    assert.equal(calls[i].headers['Content-Encoding'], 'aes128gcm');
  }
  const direct = await vapidAuthorization(b.env, SECRET_ENDPOINT, b.clock.now() + 60);
  assert.equal(direct, auth[2]);
});

async function signedIn() {
  const b = await studio({}, { catalogSeed: true });
  const { auth } = await b.enroll();
  b.clock.t += 400;
  b.sensitive = async (method, path, body) => {
    await b.stepUp(auth);
    return b.call(method, path, body);
  };
  return b;
}

test('N06 essai manuel depuis STUDIO : réponse d’Apple expliquée, clés contrôlées, aucun secret renvoyé, fréquence limitée', async () => {
  const b = await signedIn();
  Object.assign(b.env, await vapidKeys());
  simulate(b);
  let health = (await b.call('GET', '/api/admin/health')).body.checks.find((c) => c.name === 'Notifications iPhone');
  assert.deepEqual([health.state, /Aucun iPhone abonné/.test(health.detail)], ['wait', true], 'sans appareil : en attente, pas en panne');
  const keys = await deviceKeys();
  const sub = { endpoint: SECRET_ENDPOINT, keys };
  assert.equal((await b.call('POST', '/api/admin/push/subscribe', { ...sub, key: (await vapidKeys()).VAPID_PUBLIC_KEY })).body.error, 'push_key_mismatch');
  const subscribed = (await b.call('POST', '/api/admin/push/subscribe', { ...sub, key: b.env.VAPID_PUBLIC_KEY, label: 'iPhone' })).body;
  assert.deepEqual(subscribed, { subscribed: true, fp: await fingerprint(SECRET_ENDPOINT) });
  let r = (await b.call('POST', '/api/admin/push/test', { endpoint: SECRET_ENDPOINT })).body;
  assert.deepEqual([r.keys.keypair, r.keys.subject, r.this_device, r.devices[0].result, r.devices[0].status], [true, true, 'known', 'ok', 201]);
  assert.match(r.devices[0].explanation, /Accepté/);
  health = (await b.call('GET', '/api/admin/health')).body.checks.find((c) => c.name === 'Notifications iPhone');
  assert.equal(health.state, 'ok');
  b.apple = { status: 403, reason: 'BadJwtToken' };
  r = (await b.call('POST', '/api/admin/push/test', { endpoint: SECRET_ENDPOINT })).body;
  assert.deepEqual([r.devices[0].result, r.devices[0].status, r.devices[0].reason], ['permanent', 403, 'BadJwtToken']);
  assert.match(r.devices[0].explanation, /jeton VAPID/);
  assert.equal((await b.call('POST', '/api/admin/push/test', { endpoint: `${SECRET_ENDPOINT}-inconnu` })).body.this_device, 'unknown');
  const n = (await b.call('GET', '/api/admin/notifications')).body.channels.push;
  assert.deepEqual([n.devices, n.device_list[0].fp, n.device_list[0].last_error], [1, await fingerprint(SECRET_ENDPOINT), 'apple_403_BadJwtToken']);
  const exposed = JSON.stringify([r, n, (await b.call('GET', '/api/admin/audit')).body]);
  for (const secret of ['QJETON-APPAREIL-SECRET', keys.p256dh, keys.auth, b.env.VAPID_PRIVATE_KEY]) assert.ok(!exposed.includes(secret), `fuite : ${secret.slice(0, 12)}…`);
  assert.ok((await b.call('GET', '/api/admin/audit')).body.entries.some((e) => e.action === 'push_test' && /apple_403_BadJwtToken/.test(e.result)));
  for (let i = 0; i < 3; i += 1) await b.call('POST', '/api/admin/push/test', {});
  assert.equal((await b.call('POST', '/api/admin/push/test', {})).body.error, 'rate_limited', 'six essais par 10 minutes');
  // Paire de clés incohérente (clé privée d'une autre paire) : signalée, aucun appel à Apple.
  b.clock.t += 700;
  b.env.VAPID_PRIVATE_KEY = (await vapidKeys()).VAPID_PRIVATE_KEY;
  const before = b.net.length;
  r = (await b.call('POST', '/api/admin/push/test', {})).body;
  assert.deepEqual([r.keys.keypair, r.devices.length, b.net.length - before], [false, 0, 0]);
  health = (await b.call('GET', '/api/admin/health')).body.checks.find((c) => c.name === 'Notifications iPhone');
  assert.deepEqual([health.state, /incohérentes/.test(health.detail)], ['alert', true]);
});

test('N07 clôture des envois échoués : Face ID, historique conservé, e-mails clients jamais touchés, plus aucun essai', async () => {
  const b = await signedIn();
  Object.assign(b.env, await vapidKeys());
  simulate(b);
  await addDevice(b);
  const now = b.clock.now();
  // État laissé par l'ancienne boucle : alertes « technical » sur outbox:N, en attente et mortes.
  const insert = (channel, dedupe, status, attempts = 5) => b.real.prepare(`INSERT INTO outbox (channel, dedupe, payload, status, attempts, next_at, at, last_error)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?)`).bind(channel, dedupe, JSON.stringify({ kind: dedupe.split(':')[1], title: 'Notification non distribuée', body: 'Canal push : échec après 5 essais.' }),
    status, attempts, now - 3600, status === 'dead' ? 'aucune notification remise' : null).run();
  for (let i = 1; i <= 6; i += 1) {
    await insert('push', `push:technical:outbox:${i}`, i <= 4 ? 'dead' : 'pending', i <= 4 ? 5 : 2);
    await insert('discord', `discord:technical:outbox:${i}`, 'sent', 1);
    await b.real.prepare(`INSERT INTO notifications (kind, ref, level, title, body, at) VALUES ('technical', ?, 'critical', 'Notification non distribuée', 'Canal push : échec après 5 essais.', ?)`).bind(`outbox:${i}`, now - 3600).run();
  }
  await insert('push', 'push:order_paid:vrai', 'dead');
  await b.real.prepare(`INSERT INTO outbox (channel, dedupe, payload, status, attempts, next_at, at) VALUES ('email', 'email:order_confirmation:x', 'chiffré', 'dead', 5, 0, ?),
    ('email', 'email:shipped:y', 'chiffré', 'uncertain', 3, 0, ?)`).bind(now, now).run();
  const counts = async () => [await b.count('SELECT COUNT(*) FROM outbox'), await b.count('SELECT COUNT(*) FROM notifications')];
  const start = await counts();
  let h = (await b.call('GET', '/api/admin/health')).body;
  assert.equal(h.outbox.closable, 7, '5 mortes (iPhone) + 2 alertes de boucle en attente');
  assert.equal((await b.call('POST', '/api/admin/outbox/close', { scope: 'failed' })).body.error, 'stepup_required');
  assert.equal(await b.count('SELECT COUNT(*) FROM outbox WHERE closed_at IS NOT NULL'), 0);
  const closed = (await b.sensitive('POST', '/api/admin/outbox/close', { scope: 'failed' })).body;
  assert.deepEqual(closed, { closed: 7, failed: 5, pending: 2, alerts: 6 });
  assert.deepEqual(await counts(), start, 'aucune ligne effacée');
  assert.deepEqual(await b.rows("SELECT channel, status, closed_at IS NOT NULL AS closed FROM outbox WHERE channel = 'email' ORDER BY id"),
    [{ channel: 'email', status: 'dead', closed: 0 }, { channel: 'email', status: 'uncertain', closed: 0 }], 'e-mails clients intacts');
  assert.equal(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'technical' AND resolved_at IS NULL"), 0);
  h = (await b.call('GET', '/api/admin/health')).body;
  assert.equal(h.outbox.closable, 0);
  assert.match(h.checks.find((c) => c.name === 'File d’envoi').detail, /^1 message\(s\) non distribué\(s\) \(email/);
  assert.ok((await b.call('GET', '/api/admin/audit')).body.entries.some((e) => e.action === 'outbox_closed'));
  const { ctx, deps } = b.context();
  await deliverOutbox(ctx, deps.senders, deps);
  assert.equal(b.net.length, 0, 'aucun essai sur une ligne clôturée');
});

test('N08 migration 0009 sur une base en pleine boucle : rien de perdu, et plus aucune alerte en chaîne après la mise à jour', async () => {
  const real = await emptyDatabase();
  await migrate(real, ['0001_commerce.sql', '0003_decisions_fondateur.sql', '0004_studio_auth.sql', '0005_revue_work.sql',
    '0006_studio_ecrans.sql', '0007_intentions_cgv.sql', '0008_envois_rapprochement.sql']);
  const k = await deviceKeys();
  await real.batch([
    real.prepare(`INSERT INTO push_subscriptions (endpoint, p256dh, auth, label, created_at, failures) VALUES (?, ?, ?, 'iPhone', ?, 12)`).bind(SECRET_ENDPOINT, k.p256dh, k.auth, T0),
    ...[1, 2, 3].map((i) => real.prepare(`INSERT INTO outbox (channel, dedupe, payload, status, attempts, next_at, at, last_error) VALUES ('push', ?, ?, ?, ?, 0, ?, ?)`)
      .bind(`push:technical:outbox:${i}`, JSON.stringify({ kind: 'technical', level: 'critical', title: 'Notification non distribuée', body: 'Canal push : échec après 5 essais.' }),
        i < 3 ? 'dead' : 'pending', i < 3 ? 5 : 4, T0, 'aucune notification remise')),
    real.prepare(`INSERT INTO notifications (kind, ref, level, title, body, at) VALUES ('technical', 'outbox:1', 'critical', 'Notification non distribuée', 'x', ?)`).bind(T0),
  ]);
  const before = JSON.stringify([await real.prepare('SELECT * FROM outbox ORDER BY id').all(), await real.prepare('SELECT endpoint, p256dh, auth, failures FROM push_subscriptions').all()].map((r) => r.results));
  await migrate(real, ['0009_notifications_fiables.sql']);
  const after = JSON.stringify([await real.prepare('SELECT id, channel, dedupe, payload, status, attempts, next_at, at, first_attempt_at, last_attempt_at, uncertain_since, envelope, provider_ref, last_error, route FROM outbox ORDER BY id').all(),
    await real.prepare('SELECT endpoint, p256dh, auth, failures FROM push_subscriptions').all()].map((r) => r.results));
  assert.equal(after, before, 'lignes et colonnes existantes inchangées');
  assert.deepEqual((await real.prepare('SELECT COUNT(*) AS n FROM outbox WHERE closed_at IS NOT NULL').first()).n, 0);
  // Nouveau code sur cette base : Apple refuse toujours ; l'alerte de boucle en attente meurt en
  // silence, aucune nouvelle notification n'est créée.
  const clock = { t: T0 + 60, now() { return this.t; } };
  const net = [];
  const env = { DB: real, ...(await vapidKeys()), DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/jeton-webhook-secret' };
  const deps = { now: () => clock.now(), channels: ['discord', 'push'], transport: async (url) => { net.push(new URL(url).host); return new Response('{"reason":"BadJwtToken"}', { status: 403 }); } };
  for (let i = 0; i < 6 * 60; i += 5) {
    const c = createContext(env, deps);
    await deliverOutbox(c.ctx, c.deps.senders, c.deps);
    clock.t += 300;
  }
  assert.deepEqual([(await real.prepare('SELECT COUNT(*) AS n FROM notifications').first()).n, (await real.prepare('SELECT COUNT(*) AS n FROM outbox').first()).n], [1, 3]);
  assert.deepEqual([net.length, (await real.prepare("SELECT status FROM outbox WHERE dedupe = 'push:technical:outbox:3'").first()).status], [1, 'dead']);
});

test('N09 canal rétabli : alerte résolue au premier envoi accepté ; nouvelle panne plus tard = nouvelle alerte', async () => {
  const b = await pushBench();
  b.apple = { status: 403, reason: 'BadJwtToken' };
  await b.notify('order_paid', 'p1');
  await b.minutes(5);
  assert.equal(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'channel_failure' AND resolved_at IS NULL"), 1);
  b.apple = { status: 201 };
  await b.notify('order_paid', 'p2');
  await b.minutes(5);
  assert.deepEqual(await b.rows("SELECT state, failures FROM channel_health WHERE channel = 'push'"), [{ state: 'ok', failures: 0 }]);
  assert.equal(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'channel_failure' AND resolved_at IS NULL"), 0);
  b.clock.t += 3600;
  b.apple = { status: 403, reason: 'BadVapidPublicKey' };
  await b.notify('order_paid', 'p3');
  await b.minutes(5);
  const open = await b.rows("SELECT body FROM notifications WHERE kind = 'channel_failure' AND resolved_at IS NULL");
  assert.equal(open.length, 1);
  assert.match(open[0].body, /clé publique VAPID/);
  assert.equal(await failureAlerts(b), 2);
});

test('N10 tâche planifiée réelle : panne iPhone avec 40 messages en attente, budget de l’offre gratuite tenu, file vidée, une alerte', async () => {
  const b = await pushBench();
  b.apple = { status: 403, reason: 'BadJwtToken' };
  for (let i = 0; i < 40; i += 1) await b.notify('order_paid', `lot-${i}`);
  let minutes = 0;
  while (await b.count("SELECT COUNT(*) FROM outbox WHERE status IN ('pending', 'sending')")) {
    assert.ok(minutes < 30, 'file non vidée en 30 minutes');
    const report = await runScheduled(b.env, { deps: b.deps });
    assert.ok(report.budget.queries <= 50 && report.budget.external <= 50, `minute ${minutes} : ${JSON.stringify(report.budget)}`);
    b.clock.t += 60;
    minutes += 1;
  }
  // 40 messages, plus ceux de la tâche elle-même (sauvegarde non configurée) : un seul essai chacun.
  const pushRows = await b.count("SELECT COUNT(*) FROM outbox WHERE channel = 'push'");
  assert.ok(pushRows >= 40);
  assert.deepEqual([await failureAlerts(b), b.apples(), await b.count("SELECT MAX(attempts) FROM outbox WHERE channel = 'push'")], [1, pushRows, 1]);
  assert.equal(await b.count("SELECT COUNT(*) FROM outbox WHERE channel = 'discord' AND status = 'sent'"), pushRows + 1, 'chaque message et une seule alerte sur Discord');
});
