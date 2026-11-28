// Comparaison différentielle : vérification WebAuthn actuelle de SAYLESS (backend/src/webauthn.mjs)
// contre @simplewebauthn/server 14.1.0, sur les mêmes réponses construites octet par octet
// (ES256 et RS256, inscription et connexion, 46 cas). Voir docs/WEBAUTHN-BIBLIOTHEQUE.md.
// La bibliothèque n'est PAS une dépendance du projet (décision commune en attente) : ce test est
// ignoré si elle est absente. Pour le lancer sans toucher à package.json ni au verrou :
//   npm install --no-save @simplewebauthn/server@14.1.0
//   node --test tests/backend/webauthn-bibliotheque.test.mjs
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { verifyRegistration, verifyAssertion } from '../../backend/src/webauthn.mjs';

const library = await import('@simplewebauthn/server').catch(() => null);

const enc = new TextEncoder();
const ORIGIN = 'https://studio.test';
const RP = 'studio.test';
const CHALLENGE = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const b64 = (bytes) => Buffer.from(bytes).toString('base64url');
const sha = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const UP = 0x01, UV = 0x04, BE = 0x08, BS = 0x10, AT = 0x40;

function cbor(value) {
  const out = [];
  const head = (major, n) => { if (n < 24) out.push((major << 5) | n); else if (n < 256) out.push((major << 5) | 24, n); else out.push((major << 5) | 25, n >> 8, n & 255); };
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
async function keyPair(alg) {
  if (alg === -7) {
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
    return { alg, cose: new Map([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))], [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))]]),
      sign: async (d) => rawToDer(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, d))) };
  }
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  return { alg, cose: new Map([[1, 3], [3, -257], [-1, new Uint8Array(Buffer.from(jwk.n, 'base64url'))], [-2, new Uint8Array(Buffer.from(jwk.e, 'base64url'))]]),
    sign: async (d) => new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, d)) };
}
// Clé enregistrée par SAYLESS (JWK) -> COSE attendu par la bibliothèque.
function jwkToCose(jwk, alg) {
  const bytes = (s) => new Uint8Array(Buffer.from(s, 'base64url'));
  if (alg === -7 && jwk.kty === 'EC' && jwk.crv === 'P-256') return cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, bytes(jwk.x)], [-3, bytes(jwk.y)]]));
  if (alg === -257 && jwk.kty === 'RSA') return cbor(new Map([[1, 3], [3, -257], [-1, bytes(jwk.n)], [-2, bytes(jwk.e)]]));
  throw new Error('algorithme non pris en charge');
}
async function authData({ rp = RP, flags, counter = 0, id = null, cose = null, trailing = [] }) {
  const head = [...(await sha(enc.encode(rp))), flags, counter >>> 24, (counter >> 16) & 255, (counter >> 8) & 255, counter & 255];
  const cred = id ? [...new Uint8Array(16), id.length >> 8, id.length & 255, ...id, ...cbor(cose)] : [];
  return new Uint8Array([...head, ...cred, ...trailing]);
}
async function registration(key, { flags = UP | UV | AT, client = {}, fmt = 'none', rp, trailing, idOverride } = {}) {
  const id = crypto.getRandomValues(new Uint8Array(32));
  const data = await authData({ rp, flags, id, cose: key.cose, trailing });
  const cd = enc.encode(JSON.stringify({ type: 'webauthn.create', challenge: CHALLENGE, origin: ORIGIN, crossOrigin: false, ...client }));
  const attestation = cbor(new Map([['fmt', fmt], ['attStmt', new Map()], ['authData', data]]));
  return { id: idOverride ?? b64(id), rawId: b64(id), type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: b64(cd), attestationObject: b64(attestation), transports: ['internal'] } };
}
const outcome = async (promise, okOf = (r) => r) => {
  try { const r = await promise; return okOf(r) ? 'accepte' : 'refuse'; } catch (e) { return `refuse (${String(e.reason ?? e.message).slice(0, 70)})`; }
};
const rows = [];
const compare = async (label, ours, lib) => {
  const a = await ours; const b = await lib;
  rows.push({ cas: label, sayless: a, bibliotheque: b, accord: a.startsWith('accepte') === b.startsWith('accepte') ? 'oui' : 'NON' });
};

test('W01 SAYLESS et @simplewebauthn/server 14.1.0 : mêmes décisions sur 46 cas, sauf les réponses d’une autre origine (iframe) que SAYLESS seul refuse', { skip: library ? false : 'bibliothèque non installée (npm install --no-save @simplewebauthn/server@14.1.0)' }, async () => {
const { verifyRegistrationResponse, verifyAuthenticationResponse } = library;
const installed = JSON.parse(await readFile(new URL('../package.json', import.meta.resolve('@simplewebauthn/server')), 'utf8'));
assert.equal(installed.version, '14.1.0', 'version comparée');
for (const alg of [-7, -257]) {
  const name = alg === -7 ? 'ES256' : 'RS256';
  const key = await keyPair(alg);
  const reg = (response) => [
    outcome(verifyRegistration({ response, expectedChallenge: CHALLENGE, origin: ORIGIN, rpId: RP })),
    outcome(verifyRegistrationResponse({ response, expectedChallenge: CHALLENGE, expectedOrigin: ORIGIN, expectedRPID: RP, requireUserVerification: true, supportedAlgorithmIDs: [-7, -257] }), (r) => r.verified),
  ];
  await compare(`${name} inscription valide`, ...reg(await registration(key)));
  await compare(`${name} inscription : autre origine`, ...reg(await registration(key, { client: { origin: 'https://exemple.test' } })));
  await compare(`${name} inscription : autre domaine (RP ID)`, ...reg(await registration(key, { rp: 'autre.test' })));
  await compare(`${name} inscription : sans présence (UP)`, ...reg(await registration(key, { flags: UV | AT })));
  await compare(`${name} inscription : sans vérification (UV)`, ...reg(await registration(key, { flags: UP | AT })));
  await compare(`${name} inscription : autre défi`, ...reg(await registration(key, { client: { challenge: b64(new Uint8Array(32)) } })));
  await compare(`${name} inscription : mauvais type`, ...reg(await registration(key, { client: { type: 'webauthn.get' } })));
  await compare(`${name} inscription : crossOrigin true`, ...reg(await registration(key, { client: { crossOrigin: true } })));
  await compare(`${name} inscription : topOrigin présent`, ...reg(await registration(key, { client: { topOrigin: 'https://exemple.test' } })));
  await compare(`${name} inscription : BS sans BE`, ...reg(await registration(key, { flags: UP | UV | AT | BS })));
  await compare(`${name} inscription : format packed sans preuve`, ...reg(await registration(key, { fmt: 'packed' })));
  await compare(`${name} inscription : id différent de rawId`, ...reg(await registration(key, { idOverride: b64(new Uint8Array(32)) })));
  await compare(`${name} inscription : octets en trop`, ...reg(await registration(key, { trailing: [0, 1, 2] })));

  // Connexion avec la clé enregistrée par SAYLESS (JWK) convertie en COSE pour la bibliothèque.
  const saved = await verifyRegistration({ response: await registration(key), expectedChallenge: CHALLENGE, origin: ORIGIN, rpId: RP });
  const jwk = JSON.parse(saved.publicKey);
  const cose = jwkToCose(jwk, saved.alg);
  const assertion = async ({ counter = 6, flags = UP | UV, client = {}, tamper = false, rp } = {}) => {
    const data = await authData({ rp, flags, counter });
    const cd = enc.encode(JSON.stringify({ type: 'webauthn.get', challenge: CHALLENGE, origin: ORIGIN, crossOrigin: false, ...client }));
    const sig = await key.sign(new Uint8Array([...data, ...(await sha(cd))]));
    if (tamper) sig[sig.length - 5] ^= 0xff;
    return { id: saved.credentialId, rawId: saved.credentialId, type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: b64(cd), authenticatorData: b64(data), signature: b64(sig), userHandle: undefined } };
  };
  const auth = (response, count = 5) => [
    outcome(verifyAssertion({ response, expectedChallenge: CHALLENGE, origin: ORIGIN, rpId: RP, credential: { id: saved.credentialId, public_key: saved.publicKey, alg: saved.alg, sign_count: count } }), (r) => r.ok),
    outcome(verifyAuthenticationResponse({ response, expectedChallenge: CHALLENGE, expectedOrigin: ORIGIN, expectedRPID: RP, requireUserVerification: true,
      credential: { id: saved.credentialId, publicKey: cose, counter: count } }), (r) => r.verified),
  ];
  await compare(`${name} connexion valide (clé JWK convertie en COSE)`, ...auth(await assertion()));
  await compare(`${name} connexion : signature altérée`, ...auth(await assertion({ tamper: true })));
  await compare(`${name} connexion : autre origine`, ...auth(await assertion({ client: { origin: 'https://exemple.test' } })));
  await compare(`${name} connexion : autre domaine (RP ID)`, ...auth(await assertion({ rp: 'autre.test' })));
  await compare(`${name} connexion : sans présence (UP)`, ...auth(await assertion({ flags: UV })));
  await compare(`${name} connexion : sans vérification (UV)`, ...auth(await assertion({ flags: UP })));
  await compare(`${name} connexion : mauvais type`, ...auth(await assertion({ client: { type: 'webauthn.create' } })));
  await compare(`${name} connexion : crossOrigin true`, ...auth(await assertion({ client: { crossOrigin: true } })));
  await compare(`${name} connexion : compteur qui recule`, ...auth(await assertion({ counter: 5 })));
  await compare(`${name} connexion : passkey synchronisée (0/0, BE+BS)`, ...auth(await assertion({ counter: 0, flags: UP | UV | BE | BS }), 0));
}
console.table(rows);
assert.equal(rows.length, 46);
// Seuls désaccords admis : la bibliothèque accepte une inscription ou une connexion venue d'une
// autre origine (crossOrigin, topOrigin). SAYLESS les refuse : ce contrôle reste côté SAYLESS.
assert.deepEqual(rows.filter((r) => r.accord === 'NON').map((r) => r.cas), ['ES256 inscription : crossOrigin true', 'ES256 inscription : topOrigin présent',
  'ES256 connexion : crossOrigin true', 'RS256 inscription : crossOrigin true', 'RS256 inscription : topOrigin présent', 'RS256 connexion : crossOrigin true']);
assert.ok(rows.filter((r) => r.accord === 'NON').every((r) => r.sayless.startsWith('refuse')), 'SAYLESS est toujours le plus strict');
});
