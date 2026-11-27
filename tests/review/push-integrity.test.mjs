// Contre-audit Work : vrais modules et moteur D1 local ; Apple/Discord simulés.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createPublicKey, createPrivateKey, diffieHellman, hkdfSync, createDecipheriv, verify } from 'node:crypto';
import { startDatabases, stopDatabases, emptyDatabase, migrate, T0 } from '../backend/helpers.mjs';
import { studio } from '../backend/studio-helpers.mjs';
import { dumpDatabase, restoreDatabase, sealBackup, openBackup } from '../../backend/src/backup.mjs';
import { encryptPush, vapidAuthorization, sendToDevices } from '../../backend/src/push.mjs';
import { keys, device, setup, ENDPOINT } from './push-review-helpers.mjs';

before(startDatabases);
after(stopDatabases);

const prior = ['0001_commerce.sql', '0002_catalog_drop01.sql', '0003_decisions_fondateur.sql', '0004_studio_auth.sql',
  '0005_revue_work.sql', '0006_studio_ecrans.sql', '0007_intentions_cgv.sql', '0008_envois_rapprochement.sql'];

test('PUSH-A1 migration 0009 : base peuplée, 38 envois, 176 échecs, identité et historique intacts ; sauvegarde restaurable', async () => {
  const db = await emptyDatabase();
  await migrate(db, prior);
  await device(db, T0);
  await db.prepare('UPDATE push_subscriptions SET failures = 176').run();
  const env = await keys();
  await db.batch([
    db.prepare("INSERT INTO passkeys (id, public_key, alg, sign_count, label, created_at, generation) VALUES ('RECETTE-PASSKEY', ?, -7, 9, 'iPhone de recette', ?, 1)")
      .bind(JSON.stringify(await crypto.subtle.exportKey('jwk', env.pair.publicKey)), T0),
    db.prepare("INSERT INTO auth_sessions (token_hash, passkey_id, created_at, last_seen_at, expires_at, stepup_at, generation) VALUES ('hash-session-recette', 'RECETTE-PASSKEY', ?, ?, ?, ?, 1)").bind(T0, T0, T0 + 604800, T0),
    ...Array.from({ length: 10 }, (_, i) => db.prepare("INSERT INTO recovery_codes (code_hash, batch, created_at) VALUES (?, 'recette', ?)").bind(`hash-recette-${i}`, T0)),
    ...Array.from({ length: 38 }, (_, i) => db.prepare(`INSERT INTO outbox (channel, dedupe, payload, status, attempts, next_at, at, last_error)
      VALUES ('push', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(`push:technical:outbox:${i}`, JSON.stringify({ kind: 'technical', title: 'Recette', body: 'Historique synthétique' }),
        i < 36 ? 'dead' : 'pending', i < 36 ? 5 : 1, T0, T0, i < 2 ? 'aucun appareil abonné' : 'aucune notification remise')),
    ...Array.from({ length: 36 }, (_, i) => db.prepare("INSERT INTO notifications (kind, ref, level, title, body, at) VALUES ('technical', ?, 'critical', 'Recette', 'Historique synthétique', ?)").bind(`outbox:${i}`, T0)),
    db.prepare("UPDATE settings SET value = ? WHERE key = 'backup_last_verified_at'").bind(String(T0)),
  ]);
  const before = await dumpDatabase(db);
  await migrate(db, ['0009_notifications_fiables.sql']);
  const after = await dumpDatabase(db);
  for (const [name, rows] of Object.entries(before.tables)) {
    const cols = rows.length ? Object.keys(rows[0]) : [];
    assert.deepEqual(after.tables[name].map((r) => Object.fromEntries(cols.map((col) => [col, r[col]]))), rows, name);
  }
  assert.equal(after.tables.outbox.length, 38);
  assert.equal(after.tables.push_subscriptions[0].expired_at, null);
  assert.equal(after.tables.push_subscriptions[0].failures, 176);
  assert.deepEqual(after.tables.channel_health, []);
  await db.prepare("INSERT INTO channel_health (channel, state, since, failures, last_error) VALUES ('push', 'failing', ?, 38, 'apple_403_BadJwtToken')").bind(T0).run();
  const full = await dumpDatabase(db);
  const rsa = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
  const sealed = await sealBackup(full, await crypto.subtle.exportKey('jwk', rsa.publicKey), T0);
  const opened = await openBackup(sealed, await crypto.subtle.exportKey('jwk', rsa.privateKey));
  const restored = await emptyDatabase();
  assert.deepEqual(await restoreDatabase(restored, opened.dump ?? opened), []);
  assert.deepEqual((await dumpDatabase(restored)).tables, full.tables);
});

test('PUSH-A2 migration 0009 : transaction annulée en entier si une colonne existe déjà', async () => {
  const db = await emptyDatabase();
  await migrate(db, prior);
  await db.prepare('ALTER TABLE push_subscriptions ADD COLUMN last_status INTEGER').run();
  await assert.rejects(migrate(db, ['0009_notifications_fiables.sql']));
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'channel_health'").first()).n, 0);
  const cols = (await db.prepare('PRAGMA table_info(push_subscriptions)').all()).results.map((x) => x.name);
  assert.equal(cols.includes('expired_at'), false);
});

test('PUSH-A3 panne simultanée Apple/Discord et anciennes alertes : point fixe sans génération récursive', async (t) => {
  const b = await setup();
  b.responses.apple = () => new Response(null, { status: 503 });
  b.responses.discord = () => { throw new TypeError('Réseau simulé indisponible'); };
  for (const ref of ['1', '2']) await b.notify('order_paid', ref);
  await b.notify('technical', 'outbox:998');
  await b.drain();
  assert.equal(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'channel_failure'"), 2);
  assert.equal(await b.count('SELECT COUNT(*) FROM outbox'), 8);
  assert.equal(await b.count("SELECT COUNT(*) FROM outbox WHERE status <> 'dead'"), 0);
  const calls = b.sent.length;
  for (let day = 0; day < 7; day += 1) { b.clock.t += 86400; await b.deliver(); }
  assert.equal(b.sent.length, calls);
  assert.equal(await b.count('SELECT COUNT(*) FROM outbox'), 8);
  t.diagnostic(`Sept jours sans nouvel événement : ${calls} appels initiaux, puis 0 ; 2 alertes de canal.`);
});

test('PUSH-A4 zéro abonné et 410 : pas de réessai ; expiration conservée, une notice hors push', async () => {
  const b = await setup({ subscribed: false });
  await b.notify('daily_report', 'sans-abonne');
  await b.drain();
  assert.equal(b.sent.filter((x) => x.channel === 'apple').length, 0);
  await device(b.real, b.clock.now());
  b.responses.apple = () => new Response(null, { status: 410 });
  await b.notify('daily_report', 'avec-abonne');
  await b.drain();
  const [sub] = await b.rows('SELECT expired_at, last_status FROM push_subscriptions');
  assert.equal(sub.last_status, 410);
  assert.notEqual(sub.expired_at, null);
  assert.equal(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'push_device_expired'"), 1);
  await b.notify('daily_report', 'apres-expiration');
  await b.drain();
  assert.equal(b.sent.filter((x) => x.channel === 'apple').length, 1);
});

test('PUSH-A5 chiffrement : déchiffrement indépendant OpenSSL/Node et signature JWT ES256', async () => {
  const b = await setup();
  const payload = { title: 'Essai SAYLESS', body: 'Aucune donnée de client', kind: 'push_test', level: 'info' };
  const binary = Buffer.from(await encryptPush(b.device, payload));
  assert.equal(binary.readUInt32BE(16), 4096);
  assert.equal(binary[20], 65);
  const rawPublic = binary.subarray(21, 86);
  const server = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: rawPublic.subarray(1, 33).toString('base64url'), y: rawPublic.subarray(33).toString('base64url') }, format: 'jwk' });
  const client = createPrivateKey({ key: await crypto.subtle.exportKey('jwk', b.device.pair.privateKey), format: 'jwk' });
  const shared = diffieHellman({ privateKey: client, publicKey: server });
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), Buffer.from(b.device.p256dh, 'base64url'), rawPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, Buffer.from(b.device.auth, 'base64url'), info, 32));
  const salt = binary.subarray(0, 16);
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(binary.subarray(-16));
  const clear = Buffer.concat([decipher.update(binary.subarray(86, -16)), decipher.final()]);
  assert.equal(clear.at(-1), 2);
  assert.deepEqual(JSON.parse(clear.subarray(0, -1).toString()), payload);
  const authorization = await vapidAuthorization(b.env, ENDPOINT, T0);
  const [, jwt, pub] = authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  const [header, claims, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { typ: 'JWT', alg: 'ES256' });
  const parsed = JSON.parse(Buffer.from(claims, 'base64url'));
  assert.deepEqual(parsed, { aud: 'https://web.push.apple.com', exp: T0 + 43200, sub: 'https://example.invalid' });
  assert.equal(pub, b.env.VAPID_PUBLIC_KEY);
  const key = createPublicKey({ key: await crypto.subtle.exportKey('jwk', b.env.pair.publicKey), format: 'jwk' });
  assert.equal(verify('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')), true);
});

test('PUSH-A6 essai manuel : session/origine requises, 6 essais maximum, diagnostic expurgé', async () => {
  const b = await studio();
  Object.assign(b.env, await keys());
  const k = await device(b.real, b.clock.now());
  let calls = 0;
  b.deps.transport = async () => { calls += 1; return new Response('{"reason":"BadJwtToken"}', { status: 403 }); };
  assert.equal((await b.call('POST', '/api/admin/push/test', { endpoint: ENDPOINT })).status, 401);
  await b.enroll();
  assert.equal((await b.call('POST', '/api/admin/push/test', { endpoint: ENDPOINT }, { origin: 'https://example.invalid' })).status, 403);
  assert.equal((await b.call('POST', '/api/admin/push/test', { endpoint: ENDPOINT }, { header: false })).status, 403);
  for (let i = 0; i < 6; i += 1) {
    const r = await b.call('POST', '/api/admin/push/test', { endpoint: ENDPOINT });
    assert.equal(r.body.devices[0].status, 403);
    assert.match(r.body.devices[0].explanation, /VAPID/);
    for (const secret of [ENDPOINT, k.auth, k.p256dh, b.env.VAPID_PRIVATE_KEY]) assert.equal(JSON.stringify(r.body).includes(secret), false);
  }
  assert.equal((await b.call('POST', '/api/admin/push/test', { endpoint: ENDPOINT })).status, 429);
  assert.equal(calls, 6);
  assert.equal(await b.count("SELECT COUNT(*) FROM audit_log WHERE action = 'push_test'"), 6);
});

test('PUSH-A7 service worker : chaque message affiche une notification, même si le JSON est invalide', async () => {
  const handlers = new Map();
  const shown = [];
  const source = await readFile(new URL('../../studio/sw.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, { self: { addEventListener: (name, fn) => handlers.set(name, fn),
    registration: { showNotification: async (...args) => shown.push(args) } } });
  for (const data of [null, { json: () => { throw new Error('invalid'); } }, { json: () => ({ title: 'Recette', body: 'Texte', kind: 'push_test' }) }]) {
    let promise;
    handlers.get('push')({ data, waitUntil: (p) => { promise = p; } });
    await promise;
  }
  assert.equal(shown.length, 3);
  assert.equal(shown[0][0], 'SAYLESS STUDIO');
  assert.equal(shown[2][0], 'Recette');
});
