// Second contre-audit : migrations, restauration et accusé de réception.
// Un authentificateur logiciel et un service worker simulé ne valident pas Face ID/Safari réels.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createPublicKey, createPrivateKey, diffieHellman, hkdfSync, createDecipheriv } from 'node:crypto';
import { startDatabases, stopDatabases, emptyDatabase, migrate, T0 } from '../backend/helpers.mjs';
import { studio } from '../backend/studio-helpers.mjs';
import { dumpDatabase, restoreDatabase, sealBackup, openBackup } from '../../backend/src/backup.mjs';
import { keys, device, ENDPOINT } from './push-review-helpers.mjs';

before(startDatabases);
after(stopDatabases);
const previous = ['0001_commerce.sql', '0002_catalog_drop01.sql', '0003_decisions_fondateur.sql', '0004_studio_auth.sql',
  '0005_revue_work.sql', '0006_studio_ecrans.sql', '0007_intentions_cgv.sql', '0008_envois_rapprochement.sql'];

test('P2-A1 migrations 0009 + 0010 : données préexistantes identiques, santé reprise, sauvegarde chiffrée restaurable', async () => {
  const db = await emptyDatabase();
  await migrate(db, previous);
  await device(db, T0);
  const k = await keys();
  await db.batch([
    db.prepare('UPDATE push_subscriptions SET failures = 176'),
    db.prepare("INSERT INTO passkeys (id, public_key, alg, sign_count, label, created_at, generation) VALUES ('PASSKEY-RECETTE', ?, -7, 9, 'iPhone recette', ?, 1)")
      .bind(JSON.stringify(await crypto.subtle.exportKey('jwk', k.pair.publicKey)), T0),
    db.prepare("INSERT INTO auth_sessions (token_hash, passkey_id, created_at, last_seen_at, expires_at, stepup_at, generation) VALUES ('hash-session-recette', 'PASSKEY-RECETTE', ?, ?, ?, ?, 1)").bind(T0, T0, T0 + 604800, T0),
    ...Array.from({ length: 10 }, (_, i) => db.prepare("INSERT INTO recovery_codes (code_hash, batch, created_at) VALUES (?, 'recette', ?)").bind(`hash-recette-${i}`, T0)),
    ...Array.from({ length: 38 }, (_, i) => db.prepare("INSERT INTO outbox (channel, dedupe, payload, status, attempts, at) VALUES ('push', ?, ?, ?, ?, ?)")
      .bind(`push:technical:outbox:${i}`, JSON.stringify({ kind: 'technical', title: 'Recette', body: 'Historique synthétique' }), i < 36 ? 'dead' : 'pending', i < 36 ? 5 : 1, T0)),
    db.prepare("UPDATE settings SET value = ? WHERE key = 'backup_last_verified_at'").bind(String(T0)),
  ]);
  const pre9 = await dumpDatabase(db);
  await migrate(db, ['0009_notifications_fiables.sql']);
  for (const channel of ['push', 'email', 'discord']) {
    await db.prepare("INSERT INTO channel_health (channel, state, since, failures, last_error, alerted_at, last_ok_at) VALUES (?, 'failing', ?, 7, 'reseau', ?, ?)").bind(channel, T0, T0, T0 - 1).run();
  }
  await db.prepare("UPDATE outbox SET closed_at = ?, close_reason = 'cloture_fondateur' WHERE id <= 2").bind(T0).run();
  const pre10 = await dumpDatabase(db);
  await migrate(db, ['0010_destinations_reception.sql']);
  const final = await dumpDatabase(db);
  for (const [name, rows] of Object.entries(pre10.tables)) {
    const cols = rows.length ? Object.keys(rows[0]) : [];
    assert.deepEqual(final.tables[name].map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))), rows, name);
  }
  for (const name of ['passkeys', 'auth_sessions', 'recovery_codes', 'settings']) assert.deepEqual(final.tables[name], pre9.tables[name]);
  assert.equal(final.tables.outbox.length, 38);
  assert.equal(final.tables.push_subscriptions[0].failures, 176);
  assert.deepEqual(final.tables.delivery_health.map((r) => [r.channel, r.destination, r.state, r.failures]).sort(),
    [['email', 'resend', 'failing', 7], ['push', 'iphone', 'failing', 7]]);
  assert.equal(final.tables.push_subscriptions[0].received_at, null);
  const rsa = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
  const sealed = await sealBackup(final, await crypto.subtle.exportKey('jwk', rsa.publicKey), T0);
  const opened = await openBackup(sealed, await crypto.subtle.exportKey('jwk', rsa.privateKey));
  const restored = await emptyDatabase();
  assert.deepEqual(await restoreDatabase(restored, opened.dump ?? opened), []);
  assert.deepEqual((await dumpDatabase(restored)).tables, final.tables);
});

test('P2-A2 migration 0010 interrompue : aucune table ou colonne partiellement ajoutée', async () => {
  const db = await emptyDatabase();
  await migrate(db, [...previous, '0009_notifications_fiables.sql']);
  await db.prepare('ALTER TABLE push_subscriptions ADD COLUMN test_sent_at INTEGER').run();
  const snapshot = await dumpDatabase(db);
  await assert.rejects(migrate(db, ['0010_destinations_reception.sql']));
  assert.deepEqual(await dumpDatabase(db), snapshot);
});

// Déchiffrement indépendant du vrai corps Web Push : Node/OpenSSL, pas la fonction du producteur.
async function decryptMessage(binary, subscription) {
  const body = Buffer.from(binary);
  const rawPublic = body.subarray(21, 86);
  const server = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: rawPublic.subarray(1, 33).toString('base64url'), y: rawPublic.subarray(33).toString('base64url') }, format: 'jwk' });
  const client = createPrivateKey({ key: await crypto.subtle.exportKey('jwk', subscription.pair.privateKey), format: 'jwk' });
  const shared = diffieHellman({ privateKey: client, publicKey: server });
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), Buffer.from(subscription.p256dh, 'base64url'), rawPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, Buffer.from(subscription.auth, 'base64url'), info, 32));
  const salt = body.subarray(0, 16);
  const key = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = createDecipheriv('aes-128-gcm', key, nonce);
  decipher.setAuthTag(body.subarray(-16));
  const clear = Buffer.concat([decipher.update(body.subarray(86, -16)), decipher.final()]);
  assert.equal(clear.at(-1), 2);
  return JSON.parse(clear.subarray(0, -1).toString());
}

async function receiptBench() {
  const b = await studio();
  await b.enroll();
  Object.assign(b.env, await keys());
  const sub = await device(b.real, b.clock.now());
  b.payloads = [];
  b.deps.transport = async (url, init) => {
    assert.equal(url, ENDPOINT);
    b.payloads.push(await decryptMessage(init.body, sub));
    return new Response(null, { status: 201 });
  };
  b.send = () => b.call('POST', '/api/admin/push/test', { endpoint: ENDPOINT });
  b.health = async () => (await b.call('GET', '/api/admin/health')).body.checks.find((c) => c.name === 'Notifications iPhone');
  return b;
}

test('P2-A3 message chiffré → service worker → reçu authentifié : accepté distinct de reçu, rejeu refusé', async () => {
  const b = await receiptBench();
  const sent = await b.send();
  assert.equal(sent.body.devices[0].status, 201);
  assert.equal((await b.health()).state, 'wait');
  const handlers = new Map(), order = [];
  vm.runInNewContext(await readFile(new URL('../../studio/sw.js', import.meta.url), 'utf8'), {
    self: { addEventListener: (name, fn) => handlers.set(name, fn), registration: { showNotification: async () => { order.push('shown'); } } },
    fetch: async (path, init) => {
      order.push('receipt');
      assert.equal(init.credentials, 'same-origin');
      const r = await b.call('POST', path, JSON.parse(init.body));
      assert.equal(r.body.received, true);
      return new Response(JSON.stringify(r.body), { status: r.status });
    },
  });
  let pending;
  handlers.get('push')({ data: { json: () => b.payloads[0] }, waitUntil: (p) => { pending = p; } });
  await pending;
  assert.deepEqual(order, ['shown', 'receipt']);
  assert.equal((await b.health()).state, 'ok');
  assert.equal((await b.call('POST', '/api/admin/push/receipt', { test: b.payloads[0].test })).body.received, false);
});

test('P2-A4 reçu : session/origine/en-tête requis, ancien essai et abonnement expiré refusés', async () => {
  const b = await receiptBench();
  await b.send();
  const first = b.payloads[0].test;
  assert.equal((await b.call('POST', '/api/admin/push/receipt', { test: first }, { cookie: '' })).status, 401);
  assert.equal((await b.call('POST', '/api/admin/push/receipt', { test: first }, { origin: 'https://example.invalid' })).status, 403);
  assert.equal((await b.call('POST', '/api/admin/push/receipt', { test: first }, { header: false })).status, 403);
  assert.equal((await b.call('POST', '/api/admin/push/receipt', { test: '0'.repeat(32) })).body.received, false);
  b.clock.t += 1;
  await b.send();
  assert.equal((await b.call('POST', '/api/admin/push/receipt', { test: first })).body.received, false);
  await b.real.prepare('UPDATE push_subscriptions SET expired_at = ?').bind(b.clock.now()).run();
  assert.equal((await b.call('POST', '/api/admin/push/receipt', { test: b.payloads[1].test })).body.received, false);
});

test('P2-A5 refus d’affichage et coupure réseau : aucun faux accusé de réception', async () => {
  const source = await readFile(new URL('../../studio/sw.js', import.meta.url), 'utf8');
  for (const mode of ['display-failed', 'network-failed']) {
    const b = await receiptBench();
    await b.send();
    let fetches = 0;
    const handlers = new Map();
    vm.runInNewContext(source, {
      self: { addEventListener: (name, fn) => handlers.set(name, fn), registration: { showNotification: async () => {
        if (mode === 'display-failed') throw new Error('Affichage refusé simulé');
      } } },
      fetch: async () => { fetches += 1; throw new TypeError('Réseau coupé simulé'); },
    });
    let pending;
    handlers.get('push')({ data: { json: () => b.payloads[0] }, waitUntil: (p) => { pending = p; } });
    await pending;
    assert.equal(fetches, mode === 'display-failed' ? 0 : 1);
    assert.equal((await b.health()).state, 'wait');
    assert.equal(await b.count('SELECT received_at FROM push_subscriptions'), null);
  }
});
