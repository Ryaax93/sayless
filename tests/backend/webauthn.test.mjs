// Audit de la vérification WebAuthn (backend/src/webauthn.mjs) contre les étapes de la
// spécification W3C Web Authentication niveau 3 (§7.1 inscription, §7.2 connexion).
// Chaque refus attendu correspond à une étape ; les réponses sont construites octet par octet
// (CBOR, données d'authentificateur, signatures réelles ES256 et RS256).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cbor, rawToDer } from './studio-helpers.mjs';
import { cborDecode, verifyAssertion, verifyRegistration, WebAuthnError } from '../../backend/src/webauthn.mjs';

const enc = new TextEncoder();
const ORIGIN = 'https://studio.test';
const RP = 'studio.test';
const CHALLENGE = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const b64 = (bytes) => Buffer.from(bytes).toString('base64url');
const sha = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const UP = 0x01, UV = 0x04, BE = 0x08, BS = 0x10, AT = 0x40, ED = 0x80;

async function keyPair(alg) {
  if (alg === -7) {
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
    return { keys, alg, cose: new Map([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))], [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))]]),
      sign: async (data) => rawToDer(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, data))) };
  }
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  return { keys, alg, cose: new Map([[1, 3], [3, -257], [-1, new Uint8Array(Buffer.from(jwk.n, 'base64url'))], [-2, new Uint8Array(Buffer.from(jwk.e, 'base64url'))]]),
    sign: async (data) => new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, data)) };
}

async function authData({ rp = RP, flags, counter = 0, id = null, cose = null, extensions = null, trailing = [] }) {
  const head = [...(await sha(enc.encode(rp))), flags, counter >>> 24, (counter >> 16) & 255, (counter >> 8) & 255, counter & 255];
  const cred = id ? [...new Uint8Array(16), id.length >> 8, id.length & 255, ...id, ...cbor(cose)] : [];
  return new Uint8Array([...head, ...cred, ...(extensions ? cbor(extensions) : []), ...trailing]);
}
const clientData = (over = {}) => enc.encode(JSON.stringify({ type: 'webauthn.create', challenge: CHALLENGE, origin: ORIGIN, crossOrigin: false, ...over }));

async function registration(key, { flags = UP | UV | AT, client = {}, fmt = 'none', attStmt = new Map(), rp, extensions, trailing, idOverride } = {}) {
  const id = crypto.getRandomValues(new Uint8Array(32));
  const data = await authData({ rp, flags, id, cose: key.cose, extensions, trailing });
  const attestation = cbor(new Map([['fmt', fmt], ['attStmt', attStmt], ['authData', data]]));
  return { id: idOverride ?? b64(id), rawId: b64(id), type: 'public-key', response: { clientDataJSON: b64(clientData(client)), attestationObject: b64(attestation) } };
}
const register = (response) => verifyRegistration({ response, expectedChallenge: CHALLENGE, origin: ORIGIN, rpId: RP });
const refused = async (promise, reason) => assert.rejects(promise, (e) => e instanceof WebAuthnError && e.reason === reason, `refus attendu : ${reason}`);

test('A01 inscription : ES256 et RS256 acceptés ; chaque étape de la spécification refuse ce qui doit l’être', async () => {
  for (const alg of [-7, -257]) {
    const key = await keyPair(alg);
    const ok = await register(await registration(key));
    assert.equal(ok.alg, alg);
  }
  const key = await keyPair(-7);
  await refused(register(await registration(key, { client: { type: 'webauthn.get' } })), 'type');                 // §7.1 étape 7
  await refused(register(await registration(key, { client: { challenge: 'autre' } })), 'challenge');              // étape 8
  await refused(register(await registration(key, { client: { origin: 'https://studio.test.evil.test' } })), 'origin'); // étape 9
  await refused(register(await registration(key, { client: { crossOrigin: true } })), 'cross_origin');            // étape 10
  await refused(register(await registration(key, { client: { topOrigin: ORIGIN } })), 'cross_origin');
  await refused(register(await registration(key, { rp: 'autre.test' })), 'rp_id');                               // étape 13
  await refused(register(await registration(key, { flags: UV | AT })), 'user_presence');                          // étape 14
  await refused(register(await registration(key, { flags: UP | AT })), 'user_verification');                      // étape 15
  await refused(register(await registration(key, { flags: UP | UV | AT | BS })), 'backup_state');                 // étapes 16-17
  await refused(register(await registration(key, { fmt: 'packed' })), 'attestation_format');                      // politique : « none » seulement
  await refused(register(await registration(key, { attStmt: new Map([['alg', -7]]) })), 'attestation_format');
  await refused(register(await registration(key, { trailing: [0] })), 'credential');                              // données en trop
  await refused(register(await registration(key, { idOverride: b64(new Uint8Array(32)) })), 'credential_id');
  const ed25519 = { cose: new Map([[1, 1], [3, -8], [-1, 6], [-2, new Uint8Array(32)]]) };
  await refused(register(await registration(ed25519)), 'unsupported_algorithm');                                  // alg non proposé
  // Extensions de l'authentificateur (drapeau ED) : lues correctement, sans données en trop.
  assert.ok(await register(await registration(key, { flags: UP | UV | AT | ED, extensions: new Map([['credProtect', 2]]) })));
  await refused(register(await registration(key, { flags: UP | UV | AT | ED, extensions: new Map([['credProtect', 2]]), trailing: [1] })), 'credential');
});

test('A02 connexion : signature, compteur, identifiant d’utilisateur et drapeaux vérifiés', async () => {
  for (const alg of [-7, -257]) {
    const key = await keyPair(alg);
    const reg = await register(await registration(key));
    const credential = { id: reg.credentialId, public_key: reg.publicKey, alg: reg.alg, sign_count: 5 };
    const assertion = async ({ counter = 6, flags = UP | UV, client = {}, tamper = false, id = reg.credentialId, userHandle = null, rp } = {}) => {
      const data = await authData({ rp, flags, counter });
      const cd = enc.encode(JSON.stringify({ type: 'webauthn.get', challenge: CHALLENGE, origin: ORIGIN, crossOrigin: false, ...client }));
      const sig = await key.sign(new Uint8Array([...data, ...(await sha(cd))]));
      if (tamper) sig[sig.length - 5] ^= 0xff;
      return { id, rawId: id, type: 'public-key', response: { clientDataJSON: b64(cd), authenticatorData: b64(data), signature: b64(sig), userHandle } };
    };
    const check = (response, extra = {}) => verifyAssertion({ response, expectedChallenge: CHALLENGE, origin: ORIGIN, rpId: RP, credential, userHandle: 'poignee-du-fondateur', ...extra });
    assert.deepEqual((await check(await assertion())).ok, true);
    assert.equal((await check(await assertion({ userHandle: 'poignee-du-fondateur' }))).ok, true);
    await refused(check(await assertion({ userHandle: 'autre-utilisateur' })), 'user_handle');
    await refused(check(await assertion({ tamper: true })), alg === -7 ? 'signature' : 'signature');
    await refused(check(await assertion({ client: { type: 'webauthn.create' } })), 'type');
    await refused(check(await assertion({ client: { origin: 'https://exemple.test' } })), 'origin');
    await refused(check(await assertion({ rp: 'autre.test' })), 'rp_id');
    await refused(check(await assertion({ flags: UP })), 'user_verification');
    await refused(check(await assertion({ id: b64(new Uint8Array(32)) })), 'credential_id');
    const back = await check(await assertion({ counter: 5 }));
    assert.deepEqual([back.ok, back.counterRegressed], [false, true], 'compteur qui ne progresse pas : clone possible');
    const synced = { ...credential, sign_count: 0 };
    assert.equal((await verifyAssertion({ response: await assertion({ counter: 0, flags: UP | UV | BE | BS }), expectedChallenge: CHALLENGE, origin: ORIGIN, rpId: RP, credential: synced })).ok, true,
      'passkey synchronisée (iCloud) : compteur toujours à 0, acceptée');
  }
});

test('A03 lecteur CBOR : entrées malformées, imbrication excessive, clés en double et longueurs impossibles refusées', () => {
  const cases = [
    [new Uint8Array([0xbf]), 'cbor_length'],                     // carte de longueur indéfinie
    [new Uint8Array([0x5a, 0xff, 0xff, 0xff, 0xff]), 'cbor_malformed'], // chaîne plus longue que l'entrée
    [new Uint8Array(Array(40).fill(0x81)), 'cbor_malformed'],      // tableaux imbriqués à l'excès
    [cbor(new Map([[1, 2], [3, -7]])).map((b, i, a) => (i === 3 ? a[1] : b)), 'cbor_duplicate_key'],
    [new Uint8Array([0xf9, 0x3c, 0x00]), 'cbor_simple'],           // flottant : non attendu dans WebAuthn
  ];
  for (const [bytes, reason] of cases) assert.throws(() => cborDecode(bytes), (e) => e instanceof WebAuthnError && e.reason === reason, reason);
});
