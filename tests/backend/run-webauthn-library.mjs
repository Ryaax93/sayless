#!/usr/bin/env node
// Rejoue les tests de Face ID et de STUDIO avec la vérification supplémentaire par
// @simplewebauthn/server 14.1.0 (WEBAUTHN_ENGINE=simplewebauthn), sans changer leurs attentes.
// Fonctionne sous Windows comme sous Linux (variable posée ici, pas dans la commande npm).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = (f) => fileURLToPath(new URL(f, import.meta.url));
const files = ['webauthn.test.mjs', 'webauthn-bibliotheque.test.mjs', 'studio.test.mjs', 'studio-screens.test.mjs'].map(here);
const run = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', env: { ...process.env, SAYLESS_WEBAUTHN_ENGINE: 'simplewebauthn' } });
process.exit(run.status ?? 1);
