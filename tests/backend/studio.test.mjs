// SAYLESS STUDIO : connexion par passkey (Face ID), sessions, codes de secours, confirmation Face ID,
// protections d'écriture et inventaire guidé. Un authentificateur LOGICIEL simule l'iPhone : les
// signatures, les données d'authentificateur et le CBOR sont réels ; seul le capteur Face ID est simulé.
// Porte le scénario t28 de la preuve de concept.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabases, stopDatabases } from './helpers.mjs';
import { publicStock } from '../../backend/src/stock.mjs';
import { SETUP, SoftAuthenticator, studio } from './studio-helpers.mjs';
import { _test } from '../../backend/src/admin.mjs';

before(startDatabases);
after(stopDatabases);
test('S01 inscription Face ID : code d’installation, passkey, 10 codes de secours affichés une fois, cookie sûr', async () => {
  const b = await studio();
  assert.deepEqual((await b.call('GET', '/api/admin/state')).body, { enrolled: false, authenticated: false, enrollment_open: false, recovering: false, stepup_valid_until: null });
  assert.equal((await b.call('POST', '/api/admin/setup/options', { setup_code: 'mauvais' })).body.error, 'invalid_setup_code');
  const { res, opts } = await b.enroll();
  assert.deepEqual([opts.body.publicKey.rp.id, opts.body.publicKey.attestation, opts.body.publicKey.authenticatorSelection.userVerification], ['studio.test', 'none', 'required']);
  assert.equal(res.status, 200);
  assert.equal(new Set(res.body.recovery_codes).size, 10);
  assert.match(res.setCookie, /^__Host-sl_studio=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=604800$/);
  assert.equal((await b.call('GET', '/api/admin/state')).body.authenticated, true);
  assert.equal((await b.call('POST', '/api/admin/setup/options', { setup_code: SETUP })).body.error, 'already_enrolled');
  assert.equal(await b.count('SELECT COUNT(*) FROM recovery_codes WHERE code_hash LIKE ?', `%${res.body.recovery_codes[0]}%`), 0, 'codes stockés en empreinte');
  assert.equal(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'studio_passkey_added'"), 1);
});

test('S02 connexion : refus si origine, domaine, Face ID, signature ou défi incorrects ; compteur qui recule = alerte', async () => {
  const b = await studio();
  const { auth } = await b.enroll(new SoftAuthenticator({ step: 5 }));
  b.forget();
  assert.equal((await b.login(auth)).status, 200);
  b.forget();
  assert.equal((await b.call('GET', '/api/admin/state')).body.authenticated, false);
  const results = [];
  results.push((await b.login(auth, { origin: 'https://exemple-malveillant.test' })).body.error);
  results.push((await b.login(auth, { uv: false })).body.error);
  results.push((await b.login(auth, { tamper: true })).body.error);
  const wrongDomain = new SoftAuthenticator({ rpId: 'autre.test' });
  wrongDomain.keys = auth.keys; wrongDomain.id = auth.id; wrongDomain.counter = 100;
  results.push((await b.login(wrongDomain)).body.error);
  assert.deepEqual(results, ['passkey_rejected', 'passkey_rejected', 'passkey_rejected', 'passkey_rejected']);
  const opts = await b.call('POST', '/api/admin/login/options', {});
  const first = await b.call('POST', '/api/admin/login/verify', { challenge_id: opts.body.challenge_id, credential: await auth.get(opts.body.publicKey) });
  const replay = await b.call('POST', '/api/admin/login/verify', { challenge_id: opts.body.challenge_id, credential: await auth.get(opts.body.publicKey) });
  assert.deepEqual([first.status, replay.body.error], [200, 'challenge_expired']);
  b.forget();
  auth.counter -= 20;
  assert.equal((await b.login(auth)).body.error, 'passkey_rejected');
  assert.equal(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'studio_counter_regressed' AND level = 'critical'"), 1);
  assert.ok(await b.count("SELECT COUNT(*) FROM audit_log WHERE action = 'session_failed'") >= 5);
  const synced = await studio();
  const passkey = new SoftAuthenticator({ step: 0 });
  await synced.enroll(passkey);
  synced.forget();
  assert.deepEqual([(await synced.login(passkey)).status, (await synced.login(passkey)).status], [200, 200], 'passkey synchronisée : compteur 0/0 accepté');
});

test('S03 sessions : inactivité 12 h, durée 7 jours, déconnexion, tout fermer avec confirmation Face ID', async () => {
  const b = await studio();
  const { auth } = await b.enroll();
  b.clock.t += 12 * 3600 + 60;
  assert.equal((await b.call('GET', '/api/admin/state')).body.authenticated, false);
  b.forget();
  await b.login(auth);
  for (let i = 0; i < 15; i += 1) { b.clock.t += 11 * 3600; await b.call('GET', '/api/admin/state'); }
  assert.equal((await b.call('GET', '/api/admin/state')).body.authenticated, true);
  b.clock.t += 11 * 3600;
  assert.equal((await b.call('GET', '/api/admin/state')).body.authenticated, false, 'expirée après 7 jours');
  b.forget();
  await b.login(auth);
  const second = b.cookie();
  b.forget();
  await b.login(auth);
  b.clock.t += 600;
  assert.equal((await b.call('POST', '/api/admin/sessions/revoke-all', {})).body.error, 'stepup_required');
  assert.equal((await b.stepUp(auth)).status, 200);
  assert.equal((await b.call('POST', '/api/admin/sessions/revoke-all', {})).status, 200);
  assert.equal((await b.call('GET', '/api/admin/state', undefined, { cookie: second })).body.authenticated, false);
  await b.login(auth);
  await b.call('POST', '/api/admin/logout', {});
  assert.equal((await b.call('GET', '/api/admin/state')).body.authenticated, false);
});

test('S04 code de secours : une fois, ferme tout, rouvre l’inscription 15 min, alerte ; mauvais codes limités', async () => {
  const b = await studio();
  const { res } = await b.enroll();
  const before = b.cookie();
  b.forget();
  const bad = [];
  for (let i = 0; i < 6; i += 1) bad.push((await b.call('POST', '/api/admin/recover', { code: 'AAAA-AAAA' }, { ip: '10.91.0.1' })).status);
  assert.deepEqual(bad, [403, 403, 403, 403, 403, 429]);
  const ok = await b.call('POST', '/api/admin/recover', { code: res.body.recovery_codes[3].toLowerCase() });
  assert.equal(ok.status, 200);
  assert.equal((await b.call('GET', '/api/admin/state', undefined, { cookie: before })).body.authenticated, false);
  const intruder = await b.call('POST', '/api/admin/setup/options', {}, { ip: '10.92.0.1' });
  assert.equal(intruder.body.error, 'already_enrolled', 'la fenêtre de 15 minutes ne sert qu’à l’appareil qui a saisi le code');
  const replacement = new SoftAuthenticator();
  const done = await b.call('POST', '/api/admin/setup/verify', { challenge_id: ok.body.challenge_id, credential: await replacement.create(ok.body.publicKey) });
  assert.deepEqual([done.status, done.body.recovery_codes.length], [200, 10]);
  assert.equal((await b.call('POST', '/api/admin/recover', { code: res.body.recovery_codes[3] })).body.error, 'invalid_recovery_code');
  assert.equal(await b.count('SELECT COUNT(*) FROM passkeys WHERE revoked_at IS NULL'), 1, 'l’ancien appareil est retiré après la récupération');
  assert.equal(await b.count('SELECT COUNT(*) FROM passkeys WHERE revoked_at IS NOT NULL'), 1, 'trace de l’ancien appareil conservée, inutilisable');
  assert.equal(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'studio_recovery_used' AND level = 'critical'"), 1);
  b.clock.t += 16 * 60;
  assert.equal((await b.call('POST', '/api/admin/setup/options', {})).body.error, 'already_enrolled');
});

test('S05 écritures STUDIO : origine étrangère ou en-tête manquant refusés ; lecture sans session = 401', async () => {
  const b = await studio();
  await b.enroll();
  assert.equal((await b.call('POST', '/api/admin/logout', {}, { origin: 'https://exemple-malveillant.test' })).status, 403);
  assert.equal((await b.call('POST', '/api/admin/logout', {}, { header: false })).status, 403);
  b.forget();
  const r = await b.call('GET', '/api/admin/inventory');
  assert.deepEqual([r.status, r.body.error], [401, 'unauthenticated']);
});

test('S06 inventaire guidé : confirmation Face ID, stock vérifié, écart avec 26, limite Stripe proposée, conflit détecté', async () => {
  const b = await studio();
  const { auth } = await b.enroll();
  const first = await b.call('GET', '/api/admin/inventory');
  assert.ok(first.body.variants.every((v) => !v.confirmed));
  b.clock.t += 6 * 60;
  const body = { counts: { 'TEST-S': 2, 'TEST-M': 4, 'TEST-L': 1 }, set_aside: { unshipped: 1, promised: 1, damaged: 0 },
    expected: Object.fromEntries(first.body.variants.map((v) => [v.sku, v.revision])) };
  assert.equal((await b.call('POST', '/api/admin/inventory', body)).body.error, 'stepup_required');
  await b.stepUp(auth);
  const saved = await b.call('POST', '/api/admin/inventory', body);
  assert.equal(saved.status, 200);
  assert.deepEqual([saved.body.gap, saved.body.stripe_limit_proposal], [-18, 9]);
  assert.ok(saved.body.variants.every((v) => v.confirmed));
  const stock = await publicStock(b.real, 'test-001', b.clock.now());
  assert.deepEqual([stock.verified, stock.total_available], [true, 7]);
  assert.match(await b.count("SELECT note FROM stock_movements WHERE reason = 'inventory_count' AND note LIKE 'Inventaire guidé%' LIMIT 1"), /payées non expédiées 1 ; promises 1/);
  const stale = await b.call('POST', '/api/admin/inventory', body);
  assert.deepEqual([stale.status, stale.body.error], [409, 'stale_revision']);
});

// Régression demandée par la revue de Work : après un code de secours, une session, un défi ou une
// connexion de l'ancienne génération ne doit plus jamais donner accès à l'inventaire.
test('S07 récupération : sessions, défis et passkeys de l’ancienne génération invalidés atomiquement ; seule la nouvelle génération lit l’inventaire', async () => {
  const b = await studio({ 'TEST-S': 1, 'TEST-M': 1, 'TEST-L': 1 });
  const { auth: lost, res } = await b.enroll();
  const lostId = Buffer.from(lost.id).toString('base64url');
  const oldSession = b.cookie();
  const pendingLogin = await b.call('POST', '/api/admin/login/options', {}, { cookie: '' });
  const pendingStepup = await b.call('POST', '/api/admin/stepup/options', {});
  assert.equal((await b.call('GET', '/api/admin/inventory', undefined, { cookie: oldSession })).status, 200);

  b.forget(); // le code de secours est saisi sur un nouvel appareil
  const rec = await b.call('POST', '/api/admin/recover', { code: res.body.recovery_codes[0] });
  assert.equal(rec.status, 200);
  assert.equal(await b.count("SELECT value FROM settings WHERE key = 'studio_generation'"), '2');
  assert.equal((await b.call('GET', '/api/admin/inventory', undefined, { cookie: oldSession })).status, 401, 'ancienne session fermée');
  const late = await b.call('POST', '/api/admin/login/verify', { challenge_id: pendingLogin.body.challenge_id,
    credential: await lost.get(pendingLogin.body.publicKey) }, { cookie: '' });
  assert.equal(late.body.error, 'challenge_expired', 'défi de connexion émis avant la récupération annulé');
  const lateStepup = await b.call('POST', '/api/admin/stepup/verify', { challenge_id: pendingStepup.body.challenge_id,
    credential: await lost.get(pendingStepup.body.publicKey) }, { cookie: oldSession });
  assert.equal(lateStepup.status, 401, 'confirmation Face ID de l’ancienne session refusée');
  assert.equal((await b.call('POST', '/api/admin/login/options', {}, { cookie: '' })).body.error, 'not_enrolled',
    'aucune passkey active pendant la fenêtre : l’ancien appareil ne peut pas se reconnecter');

  // Course : une connexion vérifiée juste avant la récupération écrit sa session après. La base refuse.
  const t = b.clock.now();
  for (const generation of [1, 2]) {
    await assert.rejects(b.real.prepare(`INSERT INTO auth_sessions (token_hash, passkey_id, generation, created_at, last_seen_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(`course-${generation}`, lostId, generation, t, t, t + 600).run(), /session_refused/);
  }
  // Défense en profondeur : même une session forcée hors des déclencheurs est refusée à la lecture.
  await b.real.prepare('DROP TRIGGER studio_session_admission').run();
  const token = 'x'.repeat(43);
  await b.real.prepare(`INSERT INTO auth_sessions (token_hash, passkey_id, generation, created_at, last_seen_at, expires_at)
    VALUES (?, ?, 2, ?, ?, ?)`).bind(await _test.tokenHash(b.env, token), lostId, t, t, t + 600).run();
  assert.equal((await b.call('GET', '/api/admin/inventory', undefined, { cookie: `${_test.COOKIE}=${token}` })).status, 401,
    'session rattachée à une passkey retirée : refusée');

  // Autre appareil sans le cookie de récupération : aucune inscription possible pendant la fenêtre.
  const intruder = new SoftAuthenticator();
  const stolen = await b.call('POST', '/api/admin/setup/verify', { challenge_id: rec.body.challenge_id,
    credential: await intruder.create(rec.body.publicKey) }, { cookie: '' });
  assert.equal(stolen.body.error, 'already_enrolled');
  // L'appareil qui a saisi le code inscrit la nouvelle génération ; elle seule lit l'inventaire.
  const fresh = new SoftAuthenticator();
  const done = await b.call('POST', '/api/admin/setup/verify', { challenge_id: rec.body.challenge_id, credential: await fresh.create(rec.body.publicKey) });
  assert.equal(done.status, 200);
  assert.equal((await b.call('GET', '/api/admin/inventory')).status, 200);
  assert.equal((await b.call('GET', '/api/admin/inventory', undefined, { cookie: oldSession })).status, 401);
  b.forget();
  assert.equal((await b.login(lost)).body.error, 'unknown_credential', 'ancienne passkey définitivement refusée');
  assert.equal((await b.login(fresh)).status, 200);
  assert.deepEqual((await b.rows('SELECT DISTINCT generation FROM auth_sessions WHERE revoked_at IS NULL')).map((r) => r.generation), [2]);
});

test('S08 récupération : page rechargée = nouveau défi pour le même appareil ; un second code invalide le premier appareil', async () => {
  const b = await studio();
  const { res } = await b.enroll();
  b.forget();
  const first = await b.call('POST', '/api/admin/recover', { code: res.body.recovery_codes[1] });
  const deviceA = b.cookie();
  assert.equal((await b.call('GET', '/api/admin/state')).body.recovering, true);
  const again = await b.call('POST', '/api/admin/recover/options', {});
  assert.ok(again.body.challenge_id && again.body.challenge_id !== first.body.challenge_id);
  assert.equal((await b.call('POST', '/api/admin/recover/options', {}, { cookie: '' })).body.error, 'already_enrolled');
  b.forget(); // un second code est saisi ailleurs : l'appareil A perd son droit d'inscription
  await b.call('POST', '/api/admin/recover', { code: res.body.recovery_codes[2] });
  assert.equal((await b.call('GET', '/api/admin/state', undefined, { cookie: deviceA })).body.recovering, false);
  const auth = new SoftAuthenticator();
  const lateA = await b.call('POST', '/api/admin/setup/verify', { challenge_id: again.body.challenge_id, credential: await auth.create(again.body.publicKey) }, { cookie: deviceA });
  assert.equal(lateA.body.error, 'already_enrolled');
  const opts = await b.call('POST', '/api/admin/recover/options', {});
  const ok = await b.call('POST', '/api/admin/setup/verify', { challenge_id: opts.body.challenge_id, credential: await auth.create(opts.body.publicKey) });
  assert.equal(ok.status, 200);
  assert.equal(await b.count("SELECT value FROM settings WHERE key = 'studio_recovery_hash'"), '');
  b.clock.t += 16 * 60;
  assert.equal((await b.call('POST', '/api/admin/recover/options', {})).body.error, 'already_enrolled');
});

test('S09 codes tapés sur l’iPhone : casse, espaces, tirets et O/0, I/L/1 tolérés ; code d’installation trop court refusé', async () => {
  const b = await studio();
  b.env.ADMIN_SETUP_CODE = '7K3D-0W1Q-ZX9M-4HTB';
  assert.equal((await b.call('POST', '/api/admin/setup/options', { setup_code: '7K3D-0W1Q-ZX9M-4HTC' })).body.error, 'invalid_setup_code');
  assert.equal((await b.call('POST', '/api/admin/setup/options', { setup_code: ' 7k3d oW lq zx9m 4htb ' })).status, 200, 'minuscules, espaces, O pour 0 et l pour 1');
  const weak = await studio();
  weak.env.ADMIN_SETUP_CODE = 'abc-123';
  assert.equal((await weak.call('POST', '/api/admin/setup/options', { setup_code: 'abc-123' })).body.error, 'invalid_setup_code', 'moins de 12 caractères utiles : jamais accepté');

  const c = await studio();
  const { res } = await c.enroll();
  c.forget();
  const typed = res.body.recovery_codes[5].replace(/0/g, 'O').replace(/1/g, 'l').toLowerCase().replace('-', ' - ');
  assert.equal((await c.call('POST', '/api/admin/recover', { code: typed })).status, 200);
});
