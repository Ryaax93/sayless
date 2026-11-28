// Expérience indépendante, aucune modification du moteur cryptographique de SAYLESS.
// Référence isolée, installée uniquement pour cette expérience :
// npm install --prefix work/push-audit-2/crypto-reference --ignore-scripts --no-audit --no-fund --save-exact @noble/curves@2.3.0
// Les temps locaux ne représentent PAS les compteurs CPU de Cloudflare hébergé.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPublicKey, verify } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { signDeterministic } from '../../backend/src/es256.mjs';
import { vapidAuthorization } from '../../backend/src/push.mjs';

const root = new URL('../../', import.meta.url);
const reference = new URL('work/push-audit-2/crypto-reference/node_modules/@noble/curves/nist.js', root);
const { p256 } = await import(reference.href);
const b64 = (b) => Buffer.from(b).toString('base64url');
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const scalar = (n) => new Uint8Array(Buffer.from(n.toString(16).padStart(64, '0'), 'hex'));
const cases = [1n, N - 1n].flatMap((n) => [new Uint8Array(), new TextEncoder().encode('SAYLESS — contrôle indépendant')].map((message) => ({ d: scalar(n), message })));
for (let i = 0; i < 48; i += 1) cases.push({ d: p256.keygen().secretKey, message: crypto.getRandomValues(new Uint8Array(i ? 17 * i : 4096)) });

for (const { d, message } of cases) {
  const got = await signDeterministic(d, message);
  const expected = p256.sign(message, d, { lowS: false, prehash: true, extraEntropy: false });
  assert.deepEqual(got, expected);
  const raw = Buffer.from(p256.getPublicKey(d, false));
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64(raw.subarray(1, 33)), y: b64(raw.subarray(33)) }, format: 'jwk' });
  assert.equal(verify('sha256', message, { key, dsaEncoding: 'ieee-p1363' }, got), true);
}
for (const d of [new Uint8Array(31), new Uint8Array(33), scalar(0n), scalar(N)]) await assert.rejects(signDeterministic(d, new Uint8Array()));

// Instrumentation d'une copie EN MÉMOIRE du module : compte les tours de l'inversion secrète,
// sans imprimer la clé, le nonce ou la signature. Aucun fichier produit n'est modifié.
let source = await readFile(new URL('backend/src/es256.mjs', root), 'utf8');
source = source.replace("'./lib.mjs'", JSON.stringify(new URL('backend/src/lib.mjs', root).href))
  .replace('function invert(a, m) {', 'function invert(a, m) { let auditCount = 0;')
  .replace('while (r1) {', 'while (r1) { auditCount += 1;')
  .replace("if (r0 !== 1n)", 'globalThis.__saylessAuditIterations.push(auditCount); if (r0 !== 1n)');
globalThis.__saylessAuditIterations = [];
const instrumented = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
for (const { d, message } of cases) await instrumented.signDeterministic(d, message);
const iterations = globalThis.__saylessAuditIterations;
delete globalThis.__saylessAuditIterations;
assert.equal(iterations.length, cases.length);
const distinct = new Set(iterations).size;

// Échantillons Node : CPU de tout le processus (inclut le natif), durée écoulée séparée.
const percentile = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * p) - 1)];
const measure = async (fn, n = 40) => {
  const cpu = [], wall = [];
  for (let i = 0; i < n; i += 1) {
    const c = process.cpuUsage(), start = performance.now();
    await fn(i);
    const used = process.cpuUsage(c);
    cpu.push((used.user + used.system) / 1000); wall.push(performance.now() - start);
  }
  const round = (n) => Math.round(n * 1000) / 1000;
  return { samples: n, cpu_median_ms: round(percentile(cpu, .5)), cpu_p95_ms: round(percentile(cpu, .95)),
    wall_median_ms: round(percentile(wall, .5)), wall_p95_ms: round(percentile(wall, .95)) };
};
const sample = cases.at(-1);
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const env = { VAPID_PUBLIC_KEY: b64(await crypto.subtle.exportKey('raw', pair.publicKey)),
  VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', pair.privateKey)).d, VAPID_SUBJECT: 'https://example.invalid' };
const timing = {
  custom_signature: await measure(() => signDeterministic(sample.d, sample.message)),
  noble_signature: await measure(() => p256.sign(sample.message, sample.d, { lowS: false, extraEntropy: false })),
  native_signature: await measure(() => crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, sample.message)),
  vapid_cache_miss: await measure((i) => vapidAuthorization(env, 'https://web.push.apple.com/RECETTE', 1800000000 + i * 3600)),
  vapid_cache_hit: await measure(() => vapidAuthorization(env, 'https://web.push.apple.com/RECETTE', 1800000000 + 39 * 3600)),
};

// Compatibilité locale de la référence avec workerd, sans nodejs_compat ni accès externe.
const bundle = await build({ bundle: true, write: false, format: 'esm', platform: 'neutral', stdin: { resolveDir: fileURLToPath(root), loader: 'js', contents: `
  import { signDeterministic } from './backend/src/es256.mjs';
  import { p256 } from './work/push-audit-2/crypto-reference/node_modules/@noble/curves/nist.js';
  export default { async fetch(request) {
    const cases = await request.json(); let equal = 0;
    for (const c of cases) {
      const d = new Uint8Array(c.d), message = new Uint8Array(c.message);
      const a = await signDeterministic(d, message);
      const b = p256.sign(message, d, { lowS: false, extraEntropy: false });
      if (a.length === b.length && a.every((x, i) => x === b[i])) equal += 1;
    }
    return Response.json({ equal });
  } };` } });
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-05-15' }));
let workerd;
try {
  workerd = await (await mf.dispatchFetch('http://local/', { method: 'POST', body: JSON.stringify(cases.slice(0, 8).map((c) => ({ d: [...c.d], message: [...c.message] }))) })).json();
  assert.equal(workerd.equal, 8);
} finally { await mf.dispose(); }

console.log(JSON.stringify({ node: process.version, reference: '@noble/curves@2.3.0', differential_cases: cases.length,
  invalid_scalars_rejected: 4, workerd_equal_cases: workerd.equal,
  secret_inversion_iterations: { min: Math.min(...iterations), max: Math.max(...iterations), distinct_counts: distinct },
  interpretation: 'Contrôle fonctionnel réussi. La boucle dépend du nonce secret ; ces mesures ne démontrent ni une extraction de clé ni une résistance aux canaux auxiliaires. CPU local seulement.',
  timing }, null, 2));
