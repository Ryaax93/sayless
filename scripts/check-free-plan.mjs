#!/usr/bin/env node
// Limites de l'offre gratuite Cloudflare vérifiables sans compte, après « npm run check:cloudflare » :
// taille des bundles (limite Cloudflare : 64 Mio non compressés ; marge SAYLESS : 4 Mio, pour un
// démarrage rapide) et aucun indicateur de compatibilité Node exigé. Les limites par invocation
// (50 requêtes D1, 50 appels externes) sont vérifiées par les tests R17, R18, U11 et T06 ; le temps
// de calcul (10 ms) ne se mesure que sur Cloudflare.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const MARGIN = 4 * 1024 * 1024;
const bundles = [['Worker d’exploitation et STUDIO', 'ops/.wrangler/check-ops/worker.js'], ['Fonctions Pages de la boutique', '.wrangler/check-pages/index.js']];
let failed = false;
for (const [name, path] of bundles) {
  const file = `${root}${path}`;
  if (!existsSync(file)) { console.error(`${name} : bundle absent (${path}). Lance d’abord : npm run check:cloudflare`); failed = true; continue; }
  const size = statSync(file).size;
  const ok = size <= MARGIN;
  console.log(`${ok ? 'OK' : 'TROP GROS'} ${name} : ${(size / 1024).toFixed(0)} Kio (marge ${MARGIN / 1024 / 1024} Mio, limite Cloudflare 64 Mio)`);
  if (!ok) failed = true;
}
const configs = ['ops/wrangler.toml'].map((p) => readFileSync(`${root}${p}`, 'utf8'));
if (configs.some((text) => /nodejs_compat/.test(text))) { console.error('Indicateur nodejs_compat présent : non prévu.'); failed = true; }
else console.log('OK Aucun indicateur nodejs_compat');
process.exit(failed ? 1 : 0);
