// Troisième contre-audit Work : contrôles indépendants avec DB explicite, sans repli du banc.
// Sources et routeurs réels, Miniflare local, transport simulé. Rien n'est déployé.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { createPublicKey, verify } from 'node:crypto';
import { bench, startDatabases, stopDatabases, emptyDatabase, migrate, T0 } from '../backend/helpers.mjs';
import { studio } from '../backend/studio-helpers.mjs';
import { setVapidStore } from '../../backend/src/vapid-store.mjs';
import { vapidAuthorization, VAPID_REUSE } from '../../backend/src/push.mjs';
import { runScheduled } from '../../backend/src/routes.mjs';
import { dumpDatabase, restoreDatabase, sealBackup, openBackup } from '../../backend/src/backup.mjs';
import { keys, device, ENDPOINT } from './push-review-helpers.mjs';

before(async () => { await startDatabases(); setVapidStore(null); });
after(stopDatabases);

test('P3-A1 DB explicite, sans repli : réponse de validation perdue et concurrence, jeton réellement stocké réutilisé', async (t) => {
  const b = await bench();
  const env = { ...await keys(), DB: b.env.DB };
  await assert.rejects(vapidAuthorization(await keys(), ENDPOINT, T0), (e) => e.code === 'vapid_sans_base');
  const modules = await Promise.all(Array.from({ length: 4 }, () => import(`../../backend/src/push.mjs?audit3=${crypto.randomUUID()}`)));
  b.env.DB.state.loseResponseWhen = (texts) => texts.some((s) => s.includes('INSERT INTO vapid_tokens'));
  const attempts = await Promise.allSettled(modules.map((m, i) => m.vapidAuthorization(env, ENDPOINT, T0 + i)));
  const accepted = attempts.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  assert.equal(attempts.filter((r) => r.status === 'rejected' && r.reason.code === 'vapid_base_indisponible').length, 1);
  assert.equal(new Set(accepted).size, 1);
  const row = (await b.rows('SELECT token, issued_at, expires_at FROM vapid_tokens'))[0];
  assert.equal(await b.count('SELECT COUNT(*) FROM vapid_tokens'), 1);
  assert.equal(accepted[0], `vapid t=${row.token}, k=${env.VAPID_PUBLIC_KEY}`);
  const cold = await import(`../../backend/src/push.mjs?audit3=${crypto.randomUUID()}`);
  assert.equal(await cold.vapidAuthorization(env, ENDPOINT, T0 + 5), accepted[0]);
  const boundary = Math.floor(T0 / 3600) * 3600 + 3600;
  assert.equal(await modules[0].vapidAuthorization(env, ENDPOINT, boundary - 1), await modules[1].vapidAuthorization(env, ENDPOINT, boundary + 1));
  const rotated = await modules[2].vapidAuthorization(env, ENDPOINT, row.issued_at + VAPID_REUSE);
  assert.notEqual(rotated, accepted[0]);
  assert.equal(await cold.vapidAuthorization(env, ENDPOINT, row.issued_at + VAPID_REUSE - 300), rotated);
  const stored = (await b.rows('SELECT token, issued_at, expires_at FROM vapid_tokens'))[0];
  const [header, claims, signature] = stored.token.split('.');
  const pub = Buffer.from(env.VAPID_PUBLIC_KEY, 'base64url');
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.equal(verify('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')), true);
  assert.equal(JSON.parse(Buffer.from(claims, 'base64url')).exp, stored.expires_at);
  assert.equal(stored.expires_at - stored.issued_at, 12 * 3600);
  t.diagnostic('Repli désactivé ; 1 réponse perdue, 3 succès identiques, reprise froide et rotation vérifiées. Aucun jeton affiché.');
});

test('P3-A2 migration 0011 : session et passkey existantes utilisables, sauvegarde chiffrée restaurée sans jeton VAPID', async () => {
  const b = await studio();
  const old = await emptyDatabase();
  const migrations = (await readdir(new URL('../../backend/migrations/', import.meta.url))).filter((p) => /^\d{4}_.*\.sql$/.test(p) && p < '0011').sort();
  await migrate(old, migrations);
  // Le navigateur du banc s'inscrit vraiment sur le schéma 0010, avant toute migration 0011.
  b.real = old;
  b.env.DB = old;
  const { auth, res } = await b.enroll();
  assert.equal(res.status, 200);
  Object.assign(b.env, await keys());
  await device(old, T0);
  await old.prepare('UPDATE push_subscriptions SET failures = 176, test_id = ?, test_sent_at = ?, received_at = ?').bind('a'.repeat(32), T0, T0 + 3).run();
  await old.prepare("INSERT INTO delivery_health (channel,destination,label,state,since,failures,last_error) VALUES ('discord','wrecette','Commandes','failing',?,34,'discord_404')").bind(T0).run();
  const snapshot = await dumpDatabase(old);
  await migrate(old, ['0011_jeton_vapid_tentatives.sql']);
  const migrated = await dumpDatabase(old);
  for (const [name, rows] of Object.entries(snapshot.tables)) {
    const cols = rows.length ? Object.keys(rows[0]) : [];
    assert.deepEqual(migrated.tables[name].map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))), rows, name);
  }
  assert.equal((await b.stepUp(auth)).status, 200, 'session et signature de passkey conservées après migration');
  await vapidAuthorization(b.env, ENDPOINT, T0);
  assert.equal(await b.count('SELECT COUNT(*) FROM vapid_tokens'), 1);
  const dump = await dumpDatabase(old);
  assert.deepEqual(dump.tables.vapid_tokens, []);
  const pair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
  const sealed = await sealBackup(dump, await crypto.subtle.exportKey('jwk', pair.publicKey), T0);
  const opened = await openBackup(sealed, await crypto.subtle.exportKey('jwk', pair.privateKey));
  const restored = await emptyDatabase();
  assert.deepEqual(await restoreDatabase(restored, opened.dump ?? opened), []);
  assert.deepEqual((await dumpDatabase(restored)).tables, dump.tables);
  b.real = restored;
  b.env.DB = restored;
  b.forget();
  assert.equal((await b.login(auth)).status, 200, 'authentification logicielle avec la même passkey après restauration');
  assert.equal(await b.count('SELECT COUNT(*) FROM recovery_codes'), 10);
  assert.equal(await b.count('SELECT failures FROM push_subscriptions'), 176);
});

test('P3-A3 cron réel : quatre services push, succès et refus mêlés, budget gratuit et absence de cascade', async (t) => {
  const b = await bench();
  Object.assign(b.env, await keys());
  b.deps.channels = ['push'];
  const endpoints = [ENDPOINT, 'https://fcm.googleapis.com/RECETTE', 'https://updates.push.services.mozilla.com/RECETTE', 'https://recette.notify.windows.com/RECETTE'];
  for (const endpoint of endpoints) await device(b.real, T0, endpoint);
  let calls = 0;
  b.deps.transport = async (url) => { calls += 1; return new Response(null, { status: url.includes('googleapis') ? 201 : 403 }); };
  for (let i = 0; i < 12; i += 1) await b.context().deps.notify({ kind: 'order_paid', ref: `mix-${i}`, level: 'info', title: 'Recette', body: 'Aucune donnée réelle.' });
  let maxQueries = 0, maxExternal = 0;
  for (let tick = 0; tick < 16; tick += 1) {
    b.clock.t = T0 + tick * 60;
    const r = await runScheduled(b.env, { deps: b.deps });
    assert.ok(Object.values(r).every((v) => typeof v !== 'string' || !v.startsWith('erreur:')), JSON.stringify(r));
    assert.ok(r.budget.queries <= 50 && r.budget.external <= 50);
    maxQueries = Math.max(maxQueries, r.budget.queries);
    maxExternal = Math.max(maxExternal, r.budget.external);
  }
  assert.equal(await b.count("SELECT COUNT(*) FROM outbox WHERE status IN ('pending','sending')"), 0);
  // La minute 5 signale une seule fois l'absence de KV dans cette fixture : un treizième message
  // légitime. On exige la liste exacte pour distinguer cette notice d'une cascade de notifications.
  assert.deepEqual(await b.rows('SELECT dedupe, status FROM outbox ORDER BY id'), [
    ...Array.from({ length: 12 }, (_, i) => ({ dedupe: `push:order_paid:mix-${i}`, status: 'sent' })),
    { dedupe: 'push:backup_not_configured:once', status: 'sent' },
  ]);
  assert.equal(calls, 52);
  assert.equal(await b.count('SELECT COUNT(*) FROM vapid_tokens'), 4);
  assert.equal(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'channel_failure'"), 0, 'une remise acceptée suffit selon la règle existante');
  t.diagnostic(`Quatre audiences, 12 messages et 1 notice de configuration, 52 appels simulés ; max ${maxQueries} requêtes D1 et ${maxExternal} appels externes par cron. CPU hébergé non mesuré.`);
});
