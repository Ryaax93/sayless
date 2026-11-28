// Signature ES256 DÉTERMINISTE (ECDSA P-256 + SHA-256, nonce de la RFC 6979) pour le jeton VAPID.
// Pourquoi : Web Crypto signe avec un nonce aléatoire, donc deux instances du Worker (isolates,
// démarrages à froid, appels simultanés) produisaient chacune un jeton différent, alors qu'Apple
// demande de ne pas renouveler le jeton plus d'une fois par heure. Avec un nonce déterministe, les
// mêmes clés et les mêmes données signées donnent partout exactement le même jeton : aucune
// coordination, aucun stockage, aucune requête D1 supplémentaire, aucune panne possible de ce côté.
// Calculs : le nonce k vient de HMAC-SHA-256 (RFC 6979 §3.2, clé privée et empreinte du message :
// jamais le même k pour deux messages différents) ; le point k·G est calculé par Web Crypto
// lui-même (clé publique de la clé privée k, importée sans sa partie publique) ; seule l'étape
// finale s = k⁻¹(z + r·d) mod n est faite ici. Vecteurs officiels de la RFC 6979 (annexe A.2.5)
// et vérification croisée par OpenSSL dans les tests ; chaque jeton est aussi vérifié avant usage.
import { fromB64url } from './lib.mjs';

const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

const mod = (a, m) => {
  const r = a % m;
  return r >= 0n ? r : r + m;
};
function invert(a, m) {
  let [r0, r1, s0, s1] = [mod(a, m), m, 1n, 0n];
  while (r1) {
    const q = r0 / r1;
    [r0, r1, s0, s1] = [r1, r0 - q * r1, s1, s0 - q * s1];
  }
  if (r0 !== 1n) throw new Error('inverse modulaire impossible');
  return mod(s0, m);
}
const toInt = (bytes) => bytes.reduce((n, b) => (n << 8n) | BigInt(b), 0n);
const toBytes = (n) => {
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i -= 1) { out[i] = Number(n & 0xffn); n >>= 8n; }
  return out;
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

// Clé privée P-256 au format PKCS#8 sans sa clé publique (RFC 5915) : Web Crypto calcule alors le
// point k·G lui-même, à la vitesse du code natif.
const PKCS8_PREFIX = Uint8Array.from([0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
  0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x04, 0x27, 0x30, 0x25, 0x02, 0x01, 0x01, 0x04, 0x20]);
async function pointX(k) {
  const key = await crypto.subtle.importKey('pkcs8', concat(PKCS8_PREFIX, toBytes(k)), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  return toInt(fromB64url((await crypto.subtle.exportKey('jwk', key)).x));
}

// Signature brute r ‖ s (64 octets, format JOSE) du message, avec la clé privée `d` (32 octets).
export async function signDeterministic(dBytes, message) {
  const d = toInt(dBytes);
  if (dBytes.length !== 32 || d <= 0n || d >= N) throw new Error('clé privée hors de la courbe');
  const z = toInt(new Uint8Array(await crypto.subtle.digest('SHA-256', message)));
  const x = toBytes(d);
  const h = toBytes(mod(z, N));
  let V = new Uint8Array(32).fill(1);
  let K = new Uint8Array(32);
  K = await hmac(K, concat(V, [0], x, h));
  V = await hmac(K, V);
  K = await hmac(K, concat(V, [1], x, h));
  V = await hmac(K, V);
  for (let round = 0; round < 64; round += 1) {
    V = await hmac(K, V);
    const k = toInt(V);
    if (k >= 1n && k < N) {
      const r = mod(await pointX(k), N);
      const s = r === 0n ? 0n : mod(invert(k, N) * (z + r * d), N);
      if (r !== 0n && s !== 0n) return concat(toBytes(r), toBytes(s));
    }
    K = await hmac(K, concat(V, [0]));
    V = await hmac(K, V);
  }
  throw new Error('signature déterministe impossible');
}
