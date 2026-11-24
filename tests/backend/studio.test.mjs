// SAYLESS STUDIO : connexion par passkey (Face ID), sessions, codes de secours, confirmation Face ID,
// protections d'écriture et inventaire guidé. Un authentificateur LOGICIEL simule l'iPhone : les
// signatures, les données d'authentificateur et le CBOR sont réels ; seul le capteur Face ID est simulé.
// Porte le scénario t28 de la preuve de concept.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bench, startDatabases, stopDatabases } from './helpers.mjs';
import { handleOps } from '../../backend/src/routes.mjs';
import { publicStock } from '../../backend/src/stock.mjs';

before(startDatabases);
after(stopDatabases);
const STUDIO = 'https://studio.test';
const SETUP = 'code-installation-de-test';
const enc = new TextEncoder();
const b64 = (bytes) => Buffer.from(bytes).toString('base64url');
const sha = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));

// ---------- CBOR minimal (encodeur de test) ----------
function cbor(value) {
  const out = [];
  const head = (major, n) => {
    if (n < 24) out.push((major << 5) | n);
    else if (n < 256) out.push((major << 5) | 24, n);
    else out.push((major << 5) | 25, n >> 8, n & 255);
  };
  const walk = (v) => {
    if (v instanceof Map) { head(5, v.size); for (const [k, x] of v) { walk(k); walk(x); } }
    else if (v instanceof Uint8Array) { head(2, v.length); out.push(...v); }
    else if (typeof v === 'string') { const b = enc.encode(v); head(3, b.length); out.push(...b); }
    else if (Number.isInteger(v)) { if (v >= 0) head(0, v); else head(1, -1 - v); }
    else throw new Error('type CBOR non géré');
  };
  walk(value);
  return new Uint8Array(out);
}
function rawToDer(raw) {
  const int = (b) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i += 1; let v = b.slice(i); if (v[0] & 0x80) v = new Uint8Array([0, ...v]); return [0x02, v.length, ...v]; };
  const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))];
  return new Uint8Array([0x30, body.length, ...body]);
}

class SoftAuthenticator {
  constructor({ rpId = 'studio.test', origin = STUDIO, counter = 0, step = 1 } = {}) { Object.assign(this, { rpId, origin, counter, step }); }
  async authData(flags, extra = []) {
    const c = this.counter;
    return new Uint8Array([...(await sha(enc.encode(this.rpId))), flags, c >>> 24, (c >> 16) & 255, (c >> 8) & 255, c & 255, ...extra]);
  }
  async create(publicKey) {
    this.keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', this.keys.publicKey);
    this.id = crypto.getRandomValues(new Uint8Array(32));
    const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]].map(([k, v]) => [k, v instanceof Buffer ? new Uint8Array(v) : v])));
    const authData = await this.authData(0x45, [...new Uint8Array(16), 0, 32, ...this.id, ...cose]);
    const clientData = enc.encode(JSON.stringify({ type: 'webauthn.create', challenge: publicKey.challenge, origin: this.origin, crossOrigin: false }));
    const attestation = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
    return { id: b64(this.id), rawId: b64(this.id), type: 'public-key', response: { clientDataJSON: b64(clientData), attestationObject: b64(attestation), transports: ['internal'] } };
  }
  async get(publicKey, { origin = this.origin, uv = true, tamper = false } = {}) {
    this.counter += this.step;
    const authData = await this.authData(uv ? 0x05 : 0x01);
    const clientData = enc.encode(JSON.stringify({ type: 'webauthn.get', challenge: publicKey.challenge, origin, crossOrigin: false }));
    const signed = new Uint8Array([...authData, ...(await sha(clientData))]);
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.keys.privateKey, signed));
    if (tamper) raw[10] ^= 0xff;
    return { id: b64(this.id), rawId: b64(this.id), type: 'public-key', response: { clientDataJSON: b64(clientData), authenticatorData: b64(authData), signature: b64(rawToDer(raw)), userHandle: null } };
  }
}

async function studio(stocks = { 'TEST-S': null, 'TEST-M': null, 'TEST-L': null }) {
  const b = await bench(stocks);
  Object.assign(b.env, { STUDIO_ORIGIN: STUDIO, STUDIO_RP_ID: 'studio.test', ADMIN_SETUP_CODE: SETUP });
  let jar = '';
  b.call = async (method, path, body, { origin = STUDIO, header = true, cookie = jar, ip = '10.90.0.1' } = {}) => {
    const headers = { 'CF-Connecting-IP': ip };
    if (cookie) headers.Cookie = cookie;
    if (method !== 'GET') Object.assign(headers, { 'Content-Type': 'application/json', Origin: origin }, header ? { 'X-Studio-Request': '1' } : {});
    const res = await handleOps(new Request(`${STUDIO}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), b.env, { deps: b.deps });
    const set = res.headers.get('Set-Cookie');
    if (set && cookie === jar) jar = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    return { status: res.status, body: await res.json(), setCookie: set };
  };
  b.cookie = () => jar;
  b.forget = () => { jar = ''; };
  b.enroll = async (auth = new SoftAuthenticator()) => {
    const opts = await b.call('POST', '/api/admin/setup/options', { setup_code: SETUP });
    const res = await b.call('POST', '/api/admin/setup/verify', { challenge_id: opts.body.challenge_id, credential: await auth.create(opts.body.publicKey) });
    return { auth, res, opts };
  };
  b.login = async (auth, options = {}) => {
    const opts = await b.call('POST', '/api/admin/login/options', {});
    return b.call('POST', '/api/admin/login/verify', { challenge_id: opts.body.challenge_id, credential: await auth.get(opts.body.publicKey, options) });
  };
  b.stepUp = async (auth) => {
    const opts = await b.call('POST', '/api/admin/stepup/options', {});
    return b.call('POST', '/api/admin/stepup/verify', { challenge_id: opts.body.challenge_id, credential: await auth.get(opts.body.publicKey) });
  };
  return b;
}

test('S01 inscription Face ID : code d’installation, passkey, 10 codes de secours affichés une fois, cookie sûr', async () => {
  const b = await studio();
  assert.deepEqual((await b.call('GET', '/api/admin/state')).body, { enrolled: false, authenticated: false, enrollment_open: false, stepup_valid_until: null });
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
  assert.equal(await b.count('SELECT COUNT(*) FROM passkeys'), 1, 'l’ancien appareil est retiré après la récupération');
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
