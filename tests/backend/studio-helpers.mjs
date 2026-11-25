// Outils des essais STUDIO : authentificateur LOGICIEL qui simule l'iPhone (signatures, données
// d'authentificateur et CBOR réels ; seul le capteur Face ID est simulé) et navigateur à cookies.
import { bench } from './helpers.mjs';
import { handleOps } from '../../backend/src/routes.mjs';

export const STUDIO = 'https://studio.test';
export const SETUP = 'code-installation-de-test';
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

export class SoftAuthenticator {
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

export async function studio(stocks = { 'TEST-S': null, 'TEST-M': null, 'TEST-L': null }) {
  const b = await bench(stocks);
  Object.assign(b.env, { STUDIO_ORIGIN: STUDIO, STUDIO_RP_ID: 'studio.test', ADMIN_SETUP_CODE: SETUP });
  // Bocal à cookies d'un navigateur : plusieurs cookies, effacés par Max-Age=0.
  const jar = new Map();
  const jarText = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  b.call = async (method, path, body, { origin = STUDIO, header = true, cookie, ip = '10.90.0.1' } = {}) => {
    const headers = { 'CF-Connecting-IP': ip };
    const sent = cookie === undefined ? jarText() : cookie;
    if (sent) headers.Cookie = sent;
    if (method !== 'GET') Object.assign(headers, { 'Content-Type': 'application/json', Origin: origin }, header ? { 'X-Studio-Request': '1' } : {});
    const res = await handleOps(new Request(`${STUDIO}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), b.env, { deps: b.deps });
    const cookies = res.headers.getSetCookie();
    if (cookie === undefined) {
      for (const c of cookies) {
        const pair = c.split(';')[0];
        const name = pair.slice(0, pair.indexOf('='));
        const value = pair.slice(pair.indexOf('=') + 1);
        if (!value || /Max-Age=0\b/.test(c)) jar.delete(name); else jar.set(name, value);
      }
    }
    return { status: res.status, body: await res.json(), setCookie: cookies[0] ?? null, cookies };
  };
  b.cookie = () => jarText();
  b.forget = () => { jar.clear(); };
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

