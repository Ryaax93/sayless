// WebAuthn (passkeys) côté serveur, sans dépendance : vérification d'une inscription (attestation
// « none ») et d'une connexion, pour les clés ES256 (iPhone, Mac) et RS256 (Windows Hello).
// Contrôles : type, défi à usage unique, origine exacte, empreinte du domaine (rpId), présence et
// vérification de l'utilisateur (Face ID exigé), signature, compteur qui ne recule jamais.
import { b64url, fromB64url } from './lib.mjs';

export class WebAuthnError extends Error {
  constructor(reason) {
    super(`webauthn_${reason}`);
    this.reason = reason;
  }
}
const refuse = (reason) => { throw new WebAuthnError(reason); };
const enc = new TextEncoder();
const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---------- CBOR (sous-ensemble utilisé par WebAuthn) ----------
export function cborDecode(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  const length = (info) => {
    if (info < 24) return info;
    if (info === 24) return view.getUint8(pos++);
    if (info === 25) { const v = view.getUint16(pos); pos += 2; return v; }
    if (info === 26) { const v = view.getUint32(pos); pos += 4; return v; }
    if (info === 27) { const v = Number(view.getBigUint64(pos)); pos += 8; return v; }
    return refuse('cbor_length');
  };
  const item = (depth = 0) => {
    if (depth > 16 || pos >= bytes.length) refuse('cbor_malformed');
    const head = view.getUint8(pos++);
    const major = head >> 5;
    const info = head & 31;
    switch (major) {
      case 0: return length(info);
      case 1: return -1 - length(info);
      case 2: { const n = length(info); if (pos + n > bytes.length) refuse('cbor_malformed'); const v = bytes.slice(pos, pos + n); pos += n; return v; }
      case 3: { const n = length(info); if (pos + n > bytes.length) refuse('cbor_malformed'); const v = new TextDecoder().decode(bytes.slice(pos, pos + n)); pos += n; return v; }
      case 4: { const n = length(info); return Array.from({ length: n }, () => item(depth + 1)); }
      case 5: { const n = length(info); const m = new Map(); for (let i = 0; i < n; i += 1) { const k = item(depth + 1); m.set(k, item(depth + 1)); } return m; }
      case 7: if (info === 20) return false; if (info === 21) return true; if (info === 22) return null; return refuse('cbor_simple');
      default: return refuse('cbor_type');
    }
  };
  const value = item();
  return { value, end: pos };
}

// ---------- données de l'authentificateur ----------
export function parseAuthData(bytes) {
  if (bytes.length < 37) refuse('authdata_short');
  const flagsByte = bytes[32];
  const flags = { up: !!(flagsByte & 0x01), uv: !!(flagsByte & 0x04), be: !!(flagsByte & 0x08), bs: !!(flagsByte & 0x10),
    at: !!(flagsByte & 0x40), ed: !!(flagsByte & 0x80) };
  const signCount = new DataView(bytes.buffer, bytes.byteOffset + 33, 4).getUint32(0);
  const out = { rpIdHash: bytes.slice(0, 32), flags, signCount };
  if (flags.at) {
    if (bytes.length < 55) refuse('authdata_short');
    const idLength = (bytes[53] << 8) | bytes[54];
    if (idLength < 16 || idLength > 1023 || 55 + idLength > bytes.length) refuse('credential_id');
    const id = bytes.slice(55, 55 + idLength);
    const { value, end } = cborDecode(bytes.slice(55 + idLength));
    out.credential = { aaguid: bytes.slice(37, 53), id, publicKey: value };
    out.trailing = bytes.length - (55 + idLength + end);
  }
  return out;
}

// Clé publique COSE → JWK importable par WebCrypto.
export function coseToJwk(cose) {
  if (!(cose instanceof Map)) refuse('cose_key');
  const kty = cose.get(1);
  const alg = cose.get(3);
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) {
    const x = cose.get(-2);
    const y = cose.get(-3);
    if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) refuse('cose_key');
    return { alg: -7, jwk: { kty: 'EC', crv: 'P-256', x: b64url(x), y: b64url(y), ext: true } };
  }
  if (kty === 3 && alg === -257) {
    const n = cose.get(-1);
    const e = cose.get(-2);
    if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array) || n.length < 256) refuse('cose_key');
    return { alg: -257, jwk: { kty: 'RSA', n: b64url(n), e: b64url(e), alg: 'RS256', ext: true } };
  }
  return refuse('unsupported_algorithm');
}

// Signature ECDSA de WebAuthn (DER) → format brut r||s attendu par WebCrypto.
export function derToRaw(der) {
  if (der[0] !== 0x30) refuse('signature_format');
  let pos = 2;
  const part = () => {
    if (der[pos] !== 0x02) refuse('signature_format');
    const len = der[pos + 1];
    let value = der.slice(pos + 2, pos + 2 + len);
    pos += 2 + len;
    while (value.length > 32 && value[0] === 0) value = value.slice(1);
    if (value.length > 32) refuse('signature_format');
    const out = new Uint8Array(32);
    out.set(value, 32 - value.length);
    return out;
  };
  const r = part();
  const s = part();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

function checkClientData(clientDataJSON, type, expectedChallenge, origin) {
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(clientDataJSON));
  } catch {
    return refuse('client_data');
  }
  if (data.type !== type) refuse('type');
  if (typeof data.challenge !== 'string' || data.challenge !== expectedChallenge) refuse('challenge');
  if (data.origin !== origin) refuse('origin');
  if (data.crossOrigin === true || data.topOrigin !== undefined) refuse('cross_origin');
}

async function checkAuthenticator(auth, rpId, requireUV) {
  if (!same(auth.rpIdHash, await sha256(enc.encode(rpId)))) refuse('rp_id');
  if (!auth.flags.up) refuse('user_presence');
  if (requireUV && !auth.flags.uv) refuse('user_verification');
}

const bytesOf = (value, name) => {
  if (typeof value !== 'string' || value.length > 16384) refuse(name);
  try {
    return fromB64url(value);
  } catch {
    return refuse(name);
  }
};

export async function verifyRegistration({ response, expectedChallenge, origin, rpId, requireUV = true }) {
  const r = response?.response ?? {};
  const clientDataJSON = bytesOf(r.clientDataJSON, 'client_data');
  checkClientData(clientDataJSON, 'webauthn.create', expectedChallenge, origin);
  const { value: attestation } = cborDecode(bytesOf(r.attestationObject, 'attestation'));
  if (!(attestation instanceof Map) || !(attestation.get('authData') instanceof Uint8Array)) refuse('attestation');
  const fmt = attestation.get('fmt');
  const stmt = attestation.get('attStmt');
  if (fmt !== 'none' || !(stmt instanceof Map) || stmt.size !== 0) refuse('attestation_format');
  const auth = parseAuthData(attestation.get('authData'));
  await checkAuthenticator(auth, rpId, requireUV);
  if (!auth.credential || auth.trailing !== 0) refuse('credential');
  const credentialId = b64url(auth.credential.id);
  if (response.id !== credentialId || response.type !== 'public-key') refuse('credential_id');
  const { alg, jwk } = coseToJwk(auth.credential.publicKey);
  await importKey(jwk, alg); // clé importable, sinon refus
  return { credentialId, alg, publicKey: JSON.stringify(jwk), signCount: auth.signCount, backedUp: auth.flags.bs,
    transports: Array.isArray(r.transports) ? r.transports.filter((t) => typeof t === 'string').slice(0, 6).join(',') : null };
}

function importKey(jwk, alg) {
  return alg === -7
    ? crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    : crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

// Connexion : signature sur authenticatorData || SHA-256(clientDataJSON). Compteur : s'il est
// utilisé, il doit augmenter (une valeur qui recule signale une clé clonée). 0/0 = passkey synchronisée.
export async function verifyAssertion({ response, expectedChallenge, origin, rpId, credential, requireUV = true }) {
  const r = response?.response ?? {};
  if (response?.type !== 'public-key' || response.id !== credential.id) refuse('credential_id');
  const clientDataJSON = bytesOf(r.clientDataJSON, 'client_data');
  checkClientData(clientDataJSON, 'webauthn.get', expectedChallenge, origin);
  const authData = bytesOf(r.authenticatorData, 'authdata');
  const auth = parseAuthData(authData);
  await checkAuthenticator(auth, rpId, requireUV);
  const signed = new Uint8Array([...authData, ...(await sha256(clientDataJSON))]);
  let signature = bytesOf(r.signature, 'signature');
  const key = await importKey(JSON.parse(credential.public_key), credential.alg);
  if (credential.alg === -7) signature = derToRaw(signature);
  const params = credential.alg === -7 ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' };
  if (!(await crypto.subtle.verify(params, key, signature, signed))) refuse('signature');
  const counterUsed = auth.signCount > 0 || credential.sign_count > 0;
  if (counterUsed && auth.signCount <= credential.sign_count) return { ok: false, counterRegressed: true, signCount: auth.signCount };
  return { ok: true, counterRegressed: false, signCount: auth.signCount, backedUp: auth.flags.bs };
}

export const newChallenge = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
