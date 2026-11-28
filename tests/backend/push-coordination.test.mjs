// Second contre-audit de Work (P2-R1 à P2-R4) : cas complémentaires qu'il demande (même seconde,
// tâche planifiée, deux clients STUDIO, horloges décalées, panne de la base, webhook partagé,
// migration 0011, vrai Wrangler local). Apple et Discord simulés ; aucune donnée ni clé réelle.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bench, emptyDatabase, migrate, startDatabases, stopDatabases, T0 } from './helpers.mjs';
import { studio } from './studio-helpers.mjs';
import { deliverOutbox } from '../../backend/src/notify.mjs';
import { VAPID_LIFETIME, VAPID_REUSE, vapidAuthorization } from '../../backend/src/push.mjs';
import { setVapidStore, vapidStore } from '../../backend/src/vapid-store.mjs';
import { dumpDatabase, restoreDatabase } from '../../backend/src/backup.mjs';
import { COST } from '../../backend/src/budget.mjs';
import { b64url } from '../../backend/src/lib.mjs';

before(startDatabases);
after(stopDatabases);

const ENDPOINT = 'https://web.push.apple.com/QJETON-APPAREIL-SECRET-0002';
const UP_TO_0010 = ['0001_commerce.sql', '0003_decisions_fondateur.sql', '0004_studio_auth.sql', '0005_revue_work.sql', '0006_studio_ecrans.sql',
  '0007_intentions_cgv.sql', '0008_envois_rapprochement.sql', '0009_notifications_fiables.sql', '0010_destinations_reception.sql'];

async function vapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { VAPID_PUBLIC_KEY: b64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
    VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', pair.privateKey)).d, VAPID_SUBJECT: 'https://saylessbrand.fr' };
}
async function subscriptionKeys() {
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { p256dh: b64url(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey))), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) };
}
async function addDevice(db, now, endpoint = ENDPOINT) {
  const k = await subscriptionKeys();
  await db.prepare(`INSERT INTO push_subscriptions (endpoint, p256dh, auth, label, created_at) VALUES (?, ?, ?, 'iPhone', ?)`)
    .bind(endpoint, k.p256dh, k.auth, now).run();
  return k;
}
// Réponses d'Apple programmées, dans l'ordre des appels : immédiates, ou retenues jusqu'à `release()`.
function scripted(b) {
  const queue = [];
  const calls = [];
  b.deps.transport = async (url, init) => {
    calls.push(init.headers.Authorization);
    const step = queue.shift();
    if (!step) throw new Error('appel inattendu');
    if (step.gate) {
      step.entered();
      await step.gate;
    }
    return new Response(step.reason ? JSON.stringify({ reason: step.reason }) : null, { status: step.status });
  };
  return {
    calls,
    now(status, reason = null) { queue.push({ status, reason }); },
    held(status, reason = null) {
      const step = { status, reason };
      let release;
      step.gate = new Promise((r) => { release = r; });
      const entered = new Promise((r) => { step.entered = r; });
      queue.push(step);
      return { release, entered };
    },
  };
}
const notifier = (b) => (kind, ref) => b.context().deps.notify({ kind, ref, level: 'info', title: 'Recette indépendante', body: 'Aucune donnée réelle.' });
const deliver = (b, options) => { const { ctx, deps } = b.context(); return deliverOutbox(ctx, deps.senders, deps, options); };
const iphone = async (b) => (await b.call('GET', '/api/admin/health')).body.checks.find((c) => c.name === 'Notifications iPhone');

// ---------- P2-R1 : jeton VAPID ----------

test('N17 jeton VAPID et base injoignable : aucun appel à Apple, appareil intact, message réessayé puis remis ; réponse perdue après validation : jeton enregistré réutilisé ; sans base : aucun jeton', async () => {
  const b = await bench();
  Object.assign(b.env, await vapidKeys());
  b.deps.channels = ['push'];
  await addDevice(b.real, b.clock.now());
  const calls = [];
  b.deps.transport = async (url, init) => { calls.push(init.headers.Authorization); return new Response(null, { status: 201 }); };
  const notify = notifier(b);
  b.env.DB.state.failWhen = (text) => text.includes('vapid_tokens');
  await notify('order_paid', 'v1');
  await deliver(b);
  assert.equal(calls.length, 0, 'aucun appel sans jeton coordonné');
  assert.deepEqual(await b.rows("SELECT status, last_error FROM outbox WHERE channel = 'push'"), [{ status: 'pending', last_error: 'vapid_base_indisponible' }],
    'message réessayé plus tard, jamais abandonné');
  assert.deepEqual(await b.rows('SELECT attempt_seq, last_attempt_at, last_error FROM push_subscriptions'), [{ attempt_seq: 0, last_attempt_at: null, last_error: null }],
    'appareil jamais contacté : rien n’est écrit sur lui');
  assert.equal(await b.count("SELECT COUNT(*) FROM channel_health WHERE channel = 'push' AND state = 'failing'"), 0);
  b.env.DB.state.failWhen = null;
  b.clock.t += 3600;
  await deliver(b);
  const stored = await b.count('SELECT token FROM vapid_tokens');
  assert.deepEqual([calls.length, calls[0]], [1, `vapid t=${stored}, k=${b.env.VAPID_PUBLIC_KEY}`], 'jeton envoyé = jeton enregistré');
  assert.equal(await b.count("SELECT status FROM outbox WHERE channel = 'push'"), 'sent');
  // Renouvellement dont la réponse se perd après validation : pas d'envoi avec un jeton non relu ; le
  // suivant utilise le jeton réellement enregistré, sans en signer un troisième.
  b.clock.t += VAPID_REUSE;
  b.env.DB.state.loseResponseWhen = (texts) => texts.some((t) => t.includes('INSERT INTO vapid_tokens'));
  await notify('order_paid', 'v2');
  await deliver(b);
  assert.equal(calls.length, 1, 'réponse perdue : aucun envoi');
  b.clock.t += 3600;
  await deliver(b);
  const rotated = await b.count('SELECT token FROM vapid_tokens');
  assert.notEqual(rotated, stored);
  assert.deepEqual([calls.length, calls[1]], [2, `vapid t=${rotated}, k=${b.env.VAPID_PUBLIC_KEY}`], 'jeton de la base, pas une seconde génération');
  assert.equal(await b.count('SELECT COUNT(*) FROM vapid_tokens'), 1);
  // Sans aucune base : refus, jamais de jeton local.
  const saved = vapidStore({});
  setVapidStore(null);
  try {
    await assert.rejects(vapidAuthorization(await vapidKeys(), ENDPOINT, T0), (e) => e.code === 'vapid_sans_base');
  } finally {
    setVapidStore(saved);
  }
});

test('N18 jeton VAPID : réutilisé six heures depuis l’émission (et non selon l’heure civile), relu par une instance en retard d’horloge, renouvelé une fois ; nouvelle configuration = nouveau jeton ; jamais dans une sauvegarde', async () => {
  const b = await bench();
  const keys = await vapidKeys();
  const env = { ...keys, DB: b.env.DB };
  const t0 = Math.floor(T0 / 3600) * 3600 + 3599; // une seconde avant une heure pile
  const first = await vapidAuthorization(env, ENDPOINT, t0);
  for (const dt of [1, 2, 3601, VAPID_REUSE - 601, VAPID_REUSE - 1]) assert.equal(await vapidAuthorization(env, ENDPOINT, t0 + dt), first, `réutilisé à +${dt} s`);
  const other = await import(`../../backend/src/push.mjs?autre-instance=${crypto.randomUUID()}`);
  const rotated = await other.vapidAuthorization(env, ENDPOINT, t0 + VAPID_REUSE);
  assert.notEqual(rotated, first, 'renouvelé à six heures, par une autre instance');
  assert.equal(await vapidAuthorization(env, ENDPOINT, t0 + VAPID_REUSE - 30), rotated, 'instance en retard de 30 s : jeton renouvelé, jamais l’ancien');
  assert.equal(await other.vapidAuthorization(env, ENDPOINT, t0 + VAPID_REUSE + 3600), rotated);
  const claims = JSON.parse(Buffer.from(rotated.match(/^vapid t=[^.]+\.([^.]+)\./)[1], 'base64url'));
  assert.equal(claims.exp, t0 + VAPID_REUSE + VAPID_LIFETIME, 'validité de 12 h depuis l’émission');
  // Clés remplacées : nouveau jeton signé par la nouvelle clé ; l'ancien reste lié à l'ancienne.
  const renewed = await vapidKeys();
  const next = await vapidAuthorization({ ...renewed, DB: b.env.DB }, ENDPOINT, t0 + VAPID_REUSE + 10);
  assert.notEqual(next, rotated);
  assert.ok(next.endsWith(`, k=${renewed.VAPID_PUBLIC_KEY}`));
  assert.equal(await b.count('SELECT COUNT(*) FROM vapid_tokens'), 2);
  // Sauvegarde : table copiée vide, jamais le jeton ; restaurée vide.
  const dump = await dumpDatabase(b.real);
  assert.deepEqual(dump.tables.vapid_tokens, []);
  for (const token of [rotated, next]) assert.ok(!JSON.stringify(dump).includes(token.split('.')[2].slice(0, 40)), 'aucun jeton dans la sauvegarde');
  const restored = await emptyDatabase();
  assert.deepEqual(await restoreDatabase(restored, dump), []);
  assert.equal((await restored.prepare('SELECT COUNT(*) AS n FROM vapid_tokens').first()).n, 0);
});

// ---------- P2-R2 : destinations Discord ----------

test('N19 Discord : webhook partagé encore utilisé jamais retiré ; panne réelle toujours visible ; ancien webhook retiré avec son historique ; de nouveau actif s’il revient', async () => {
  const b = await bench();
  b.deps.channels = ['discord'];
  const [A, B, C] = ['1/secours_recette', '2/commandes_recette', '3/secours_nouveau'].map((p) => `https://discord.com/api/webhooks/${p}`);
  b.env.DISCORD_WEBHOOK_URL = A;
  b.deps.transport = async (url) => new Response(null, { status: url === A ? 404 : 204 });
  const notify = notifier(b);
  const drain = async () => { for (let i = 0; i < 6; i += 1) { await deliver(b); b.clock.t += 600; } };
  const state = () => b.count("SELECT state FROM channel_health WHERE channel = 'discord'");
  await notify('order_paid', 'c1');
  await drain();
  assert.equal(await state(), 'failing', 'webhook de secours en panne');
  // Commandes reçoit son propre webhook ; le secours sert encore les autres salons : jamais retiré.
  b.env.DISCORD_WEBHOOK_COMMANDES = B;
  await notify('order_paid', 'c2');
  await drain();
  assert.equal(await b.count("SELECT status FROM outbox WHERE dedupe = 'discord:order_paid:c2'"), 'sent');
  assert.equal(await state(), 'failing', 'ancien webhook encore utilisé ailleurs : la panne reste visible');
  assert.equal(await b.count("SELECT COUNT(*) FROM delivery_health WHERE channel = 'discord' AND retired_at IS NOT NULL"), 0);
  // Panne réelle d'une destination actuelle : toujours en échec.
  await notify('parcel_shipped', 'e1');
  await drain();
  assert.equal(await state(), 'failing');
  // Secours remplacé : l'ancien n'est plus configuré nulle part, il est retiré, avec son historique.
  b.env.DISCORD_WEBHOOK_URL = C;
  await notify('parcel_shipped', 'e2');
  await drain();
  assert.equal(await state(), 'ok', 'aucune destination actuelle en échec');
  const [old] = await b.rows("SELECT label, state, failures FROM delivery_health WHERE channel = 'discord' AND retired_at IS NOT NULL");
  assert.deepEqual([old.label, old.state, old.failures >= 2], ['webhook unique', 'failing', true], 'historique de la panne conservé');
  assert.equal(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'channel_failure' AND resolved_at IS NULL"), 0, 'alerte de l’ancien webhook résolue');
  assert.equal(await b.count("SELECT COUNT(*) FROM audit_log WHERE action = 'discord_destination_retiree'"), 1);
  // Retour à l'ancien webhook, toujours en panne : de nouveau actif, en échec, et nouvelle alerte.
  b.env.DISCORD_WEBHOOK_URL = A;
  await notify('parcel_shipped', 'e3');
  await drain();
  assert.equal(await state(), 'failing');
  assert.equal(await b.count("SELECT COUNT(*) FROM audit_log WHERE action = 'discord_destination_reprise'"), 1);
  assert.equal(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'channel_failure' AND resolved_at IS NULL"), 1, 'nouvelle alerte pour la panne revenue');
  const text = JSON.stringify([await b.rows('SELECT * FROM delivery_health'), await b.rows('SELECT * FROM audit_log'), await b.rows('SELECT * FROM notifications')]);
  for (const url of [A, B, C]) assert.ok(!text.includes(url.split('/').at(-1)), 'aucun jeton de webhook stocké');
});

test('N20 Santé du site après remplacement d’un webhook : ancien salon retiré dès l’affichage, sans attendre un nouvel envoi ; aucune adresse affichée', async () => {
  const b = await studio();
  // Deux salons configurés avant la connexion : les autres salons, sans webhook, ne reçoivent rien.
  b.deps.channels = ['discord'];
  Object.assign(b.env, { DISCORD_WEBHOOK_COMMANDES: 'https://discord.com/api/webhooks/1/commandes_ancien', DISCORD_WEBHOOK_ALERTES: 'https://discord.com/api/webhooks/2/alertes_recette' });
  await b.enroll();
  b.deps.transport = async (url) => new Response(null, { status: url.endsWith('/commandes_ancien') ? 404 : 204 });
  await notifier(b)('order_paid', 's1');
  await deliver(b);
  const discord = async () => (await b.call('GET', '/api/admin/health')).body.checks.find((c) => c.name === 'Notifications Discord');
  let check = await discord();
  assert.equal(check.state, 'alert');
  assert.match(check.detail, /salon commandes en échec/);
  b.env.DISCORD_WEBHOOK_COMMANDES = 'https://discord.com/api/webhooks/3/commandes_nouveau';
  check = await discord();
  assert.equal(check.state, 'ok', 'Santé suit la configuration actuelle');
  assert.doesNotMatch(check.detail, /en échec/);
  assert.doesNotMatch(JSON.stringify(check), /commandes_nouveau|commandes_ancien|discord\.com/);
});

// ---------- P2-R3 : inscription ----------

test('N21 inscription : deux inscriptions simultanées admises chacune, une seule ligne ; abonnement expiré refusé sans retirer l’ancien ; journal fidèle', async () => {
  const b = await studio();
  await b.enroll();
  Object.assign(b.env, await vapidKeys());
  const k = await subscriptionKeys();
  const body = { endpoint: ENDPOINT, keys: k, key: b.env.VAPID_PUBLIC_KEY };
  const [r1, r2] = await Promise.all([b.call('POST', '/api/admin/push/subscribe', body), b.call('POST', '/api/admin/push/subscribe', body)]);
  assert.deepEqual([r1.body.subscribed, r2.body.subscribed], [true, true]);
  assert.equal(await b.count('SELECT COUNT(*) FROM push_subscriptions'), 1);
  assert.equal(await b.count("SELECT COUNT(*) FROM audit_log WHERE action = 'push_subscribed'"), 2);
  // Abonnement expiré (410) avant une nouvelle inscription qui devait remplacer un ancien : refus,
  // et l'ancien reste actif (rien n'est retiré pour un remplacement qui n'a pas eu lieu).
  const OLD = `${ENDPOINT}-ancien`;
  await addDevice(b.real, b.clock.now(), OLD);
  await b.real.prepare("UPDATE push_subscriptions SET expired_at = ?, last_error = 'apple_410' WHERE endpoint = ?").bind(b.clock.now(), ENDPOINT).run();
  const refused = await b.call('POST', '/api/admin/push/subscribe', { ...body, replaces: OLD });
  assert.deepEqual([refused.body.subscribed, refused.body.reason, refused.body.code], [false, 'push_subscription_expired', 'apple_410']);
  assert.equal(await b.count('SELECT expired_at IS NULL FROM push_subscriptions WHERE endpoint = ?', OLD), 1);
  assert.equal(await b.count("SELECT result FROM audit_log WHERE action = 'push_subscribe_refused'"), 'apple_410');
  assert.equal(await b.count("SELECT COUNT(*) FROM audit_log WHERE action = 'push_subscribed'"), 2, 'aucun succès journalisé pour un refus');
  // Nouvelle inscription admise avec remplacement : l'ancien est retiré dans le même lot.
  const ok = await b.call('POST', '/api/admin/push/subscribe', { ...body, endpoint: `${ENDPOINT}-nouveau`, replaces: OLD });
  assert.equal(ok.body.subscribed, true);
  assert.deepEqual(await b.rows('SELECT expired_at IS NOT NULL AS expired, last_error FROM push_subscriptions WHERE endpoint = ?', OLD), [{ expired: 1, last_error: 'remplace' }]);
});

// ---------- P2-R4 : tentatives par appareil ----------

test('N22 essais dans la même seconde, depuis deux clients STUDIO, dans les deux ordres : seul le dernier essai fait l’état de l’appareil ; réponse tardive notée, montrée comme dépassée', async () => {
  const b = await studio();
  const { auth } = await b.enroll();
  const first = b.cookie();
  b.forget();
  await b.login(auth);
  const second = b.cookie();
  assert.notEqual(first, second, 'deux sessions STUDIO');
  Object.assign(b.env, await vapidKeys());
  await addDevice(b.real, b.clock.now());
  const net = scripted(b);
  const test = (cookie) => b.call('POST', '/api/admin/push/test', { endpoint: ENDPOINT }, { cookie });
  // Client 1 retenu (201), client 2 dans la même seconde (403) : le refus reste affiché.
  let held = net.held(201);
  net.now(403, 'BadJwtToken');
  let slow = test(first);
  await held.entered;
  assert.equal((await test(second)).body.devices[0].status, 403);
  held.release();
  let late = (await slow).body.devices[0];
  assert.deepEqual([late.status, late.current], [201, false]);
  assert.match(late.explanation, /essai plus récent/);
  assert.deepEqual(await b.rows('SELECT last_status, last_error FROM push_subscriptions'), [{ last_status: 403, last_error: 'apple_403_BadJwtToken' }]);
  assert.equal((await iphone(b)).state, 'alert');
  // Ordre inverse : client 1 retenu (403), client 2 accepté (201) : l'appareil est « accepté ».
  held = net.held(403, 'BadJwtToken');
  net.now(201);
  slow = test(first);
  await held.entered;
  assert.equal((await test(second)).body.devices[0].current, true);
  held.release();
  late = (await slow).body.devices[0];
  assert.deepEqual([late.status, late.current], [403, false]);
  assert.deepEqual(await b.rows('SELECT last_status, last_error FROM push_subscriptions'), [{ last_status: 201, last_error: null }]);
  assert.equal((await iphone(b)).state, 'wait', 'accepté par Apple, réception pas encore constatée');
  assert.deepEqual((await b.rows("SELECT result FROM audit_log WHERE action = 'push_reponse_tardive' ORDER BY id")).map((r) => r.result),
    ['apple_201 (tentative 1, remplacée)', 'apple_403_BadJwtToken (tentative 3, remplacée)']);
  assert.equal(net.calls.length, 4);
});

test('N23 envoi automatique et essai manuel simultanés : la réponse tardive de l’envoi automatique ne rétablit ni l’appareil ni le canal ; message noté remis', async () => {
  const b = await studio();
  await b.enroll();
  Object.assign(b.env, await vapidKeys());
  b.deps.channels = ['push'];
  await addDevice(b.real, b.clock.now());
  const now = b.clock.now();
  await b.real.batch([
    b.real.prepare(`INSERT INTO channel_health (channel, state, since, failures, last_error) VALUES ('push', 'failing', ?, 2, 'apple_403_BadJwtToken')`).bind(now - 600),
    b.real.prepare(`INSERT INTO delivery_health (channel, destination, label, state, since, failures, last_error) VALUES ('push', 'iphone', 'iPhone', 'failing', ?, 2, 'apple_403_BadJwtToken')`).bind(now - 600)]);
  const net = scripted(b);
  const held = net.held(201);
  net.now(403, 'BadJwtToken');
  await notifier(b)('order_paid', 'auto-1');
  const cron = deliver(b);
  await held.entered;
  assert.equal((await b.call('POST', '/api/admin/push/test', { endpoint: ENDPOINT })).body.devices[0].status, 403);
  held.release();
  await cron;
  assert.equal(await b.count("SELECT status FROM outbox WHERE dedupe = 'push:order_paid:auto-1'"), 'sent', 'Apple a accepté ce message : remis');
  assert.deepEqual(await b.rows('SELECT last_status, last_error FROM push_subscriptions'), [{ last_status: 403, last_error: 'apple_403_BadJwtToken' }]);
  assert.equal(await b.count("SELECT state FROM channel_health WHERE channel = 'push'"), 'failing', 'pas « rétabli » par une réponse dépassée');
  assert.equal((await iphone(b)).state, 'alert');
  assert.equal(await b.count("SELECT COUNT(*) FROM audit_log WHERE action = 'push_reponse_tardive'"), 1);
});

test('N24 offre gratuite : un message push (jeton créé, deux appareils) tient dans son coût prévu', async () => {
  const b = await bench();
  Object.assign(b.env, await vapidKeys());
  b.deps.channels = ['push'];
  await addDevice(b.real, b.clock.now());
  await addDevice(b.real, b.clock.now(), `${ENDPOINT}-2`);
  b.deps.transport = async () => new Response(null, { status: 201 });
  await notifier(b)('order_paid', 'budget-1');
  const q0 = b.env.DB.state.queries;
  await deliver(b, { limit: 1 });
  const used = b.env.DB.state.queries - q0;
  const planned = 2 + COST.outboxMessage.queries + COST.pushMessage.queries + 2 * COST.pushDevice.queries; // lecture de la file et nombre d'appareils
  assert.equal(await b.count("SELECT status FROM outbox WHERE channel = 'push'"), 'sent');
  assert.ok(used <= planned, `message push : ${used} requêtes pour ${planned} prévues`);
  console.log(`[N24] message push, jeton créé, deux appareils : ${used} requêtes D1 (prévu ${planned}, limite 50 par invocation)`);
});

// ---------- Migration 0011 ----------

test('N25 migration 0011 sur une base peuplée : lignes existantes identiques, nouvelles colonnes vides ; interrompue, rien d’ajouté', async () => {
  const db = await emptyDatabase();
  await migrate(db, UP_TO_0010);
  const k = await subscriptionKeys();
  await db.batch([
    db.prepare(`INSERT INTO push_subscriptions (endpoint, p256dh, auth, label, created_at, failures, test_id, test_sent_at, received_at, last_error)
      VALUES (?, ?, ?, 'iPhone', ?, 176, ?, ?, ?, 'apple_403_BadJwtToken')`).bind(ENDPOINT, k.p256dh, k.auth, T0, 'a'.repeat(32), T0, T0 + 4),
    db.prepare(`INSERT INTO delivery_health (channel, destination, label, state, since, failures, last_error) VALUES ('discord', 'w0123456789ab', 'salon commandes', 'failing', ?, 3, 'discord_404')`).bind(T0),
    db.prepare(`INSERT INTO channel_health (channel, state, since, failures, last_error) VALUES ('discord', 'failing', ?, 3, 'discord_404')`).bind(T0),
    db.prepare("INSERT INTO recovery_codes (code_hash, batch, created_at) VALUES ('hash-recette', 'recette', ?)").bind(T0),
    db.prepare("INSERT INTO audit_log (at, actor, action, target, result) VALUES (?, 'fondateur', 'push_test', '1 appareil(s)', 'ok')").bind(T0),
  ]);
  const before = await dumpDatabase(db);
  await migrate(db, ['0011_jeton_vapid_tentatives.sql']);
  const after = await dumpDatabase(db);
  for (const [name, rows] of Object.entries(before.tables)) {
    const cols = rows.length ? Object.keys(rows[0]) : [];
    assert.deepEqual(after.tables[name].map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))), rows, name);
  }
  assert.deepEqual(after.tables.vapid_tokens, []);
  assert.deepEqual(after.tables.push_subscriptions.map((r) => [r.attempt_seq, r.admitted_at]), [[0, null]]);
  assert.deepEqual(after.tables.delivery_health.map((r) => r.retired_at), [null]);
  // Interrompue (une colonne existe déjà) : tout est annulé, rien d'ajouté à moitié.
  const other = await emptyDatabase();
  await migrate(other, UP_TO_0010);
  await other.prepare('ALTER TABLE delivery_health ADD COLUMN retired_at INTEGER').run();
  const snapshot = await dumpDatabase(other);
  await assert.rejects(migrate(other, ['0011_jeton_vapid_tentatives.sql']));
  assert.deepEqual(await dumpDatabase(other), snapshot);
});

test('N26 vrai Wrangler local : base 0010 peuplée, 0011 appliquée, onze migrations, seconde application sans effet', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const dir = await mkdtemp(join(tmpdir(), 'sayless-0011-'));
  const migrations = join(dir, 'migrations');
  const config = join(dir, 'wrangler.json');
  await mkdir(migrations);
  await writeFile(config, JSON.stringify({ name: 'sayless-0011-local', compatibility_date: '2026-05-15',
    d1_databases: [{ binding: 'DB', database_name: 'sayless-0011-local', database_id: '11111111-2222-4333-8444-666666666666', migrations_dir: migrations }] }));
  const run = (args) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', ...args, '--local', '-c', config, '--persist-to', join(dir, 'state')],
      { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`wrangler ${args[0]} : code ${code}\n${out}${err}`))));
  });
  const apply = () => run(['migrations', 'apply', 'DB']);
  const sql = async (query) => JSON.parse(await run(['execute', 'DB', '--json', '--command', query]))[0].results;
  try {
    for (const name of (await readdir(join(root, 'backend/migrations'))).filter((n) => /^00(0\d|10)_.*\.sql$/.test(n))) await cp(join(root, 'backend/migrations', name), join(migrations, name));
    await apply();
    await sql("INSERT INTO push_subscriptions (endpoint,p256dh,auth,label,created_at,failures,test_sent_at,received_at) VALUES ('https://web.push.apple.com/recette','cle-recette','auth-recette','iPhone recette',1800000000,176,1800000000,1800000004)");
    await sql("INSERT INTO delivery_health (channel,destination,label,state,since,failures,last_error) VALUES ('discord','w0123456789ab','salon commandes','failing',1800000000,3,'discord_404')");
    await cp(join(root, 'backend/migrations/0011_jeton_vapid_tentatives.sql'), join(migrations, '0011_jeton_vapid_tentatives.sql'));
    await apply();
    const read = () => sql(`SELECT failures, received_at, attempt_seq, admitted_at, (SELECT retired_at FROM delivery_health) AS retired,
      (SELECT COUNT(*) FROM vapid_tokens) AS tokens, (SELECT COUNT(*) FROM d1_migrations) AS migrations FROM push_subscriptions`);
    const state = await read();
    assert.deepEqual(state, [{ failures: 176, received_at: 1800000004, attempt_seq: 0, admitted_at: null, retired: null, tokens: 0, migrations: 11 }]);
    await apply();
    assert.deepEqual(await read(), state, 'seconde application sans effet');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
