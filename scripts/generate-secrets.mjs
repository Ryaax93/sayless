#!/usr/bin/env node
// Génère, SUR L'ORDINATEUR DU FONDATEUR, les secrets d'un environnement SAYLESS (test ou production).
// Rien ne passe par le chat ni par GitHub. Les fichiers sont écrits dans un dossier privé HORS du
// dépôt (droits 600), puis envoyés à Cloudflare avec `wrangler secret bulk` (voir docs/CLOUDFLARE-TEST.md).
//
//   node scripts/generate-secrets.mjs --env test [--out ~/sayless-secrets-test]
//
// Contenu :
//  - worker-secrets.json : APP_SECRET, PII_KEY, ADMIN_SETUP_CODE, VAPID_PRIVATE_KEY (Worker « ops »)
//  - pages-secrets.json  : APP_SECRET, PII_KEY (projet Pages de la boutique : mêmes valeurs)
//  - public-values.txt   : VAPID_PUBLIC_KEY et BACKUP_PUBLIC_KEY (non secrètes, variables du Worker)
//  - CLE-PRIVEE-SAUVEGARDES.json : clé privée des sauvegardes. À copier hors ligne (clé USB, coffre),
//    puis à effacer de l'ordinateur. Sans elle, aucune sauvegarde ne peut être relue.
// Les clés Stripe, Turnstile, Resend et le webhook Discord ne sont pas générées ici : elles viennent
// de chaque service et se saisissent de la même façon (voir la procédure).
import { mkdir, writeFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith('--') ? [...acc, [v.slice(2), a[i + 1]]] : acc), []));
const env = args.env;
if (!['test', 'production'].includes(env)) {
  console.error('Usage : node scripts/generate-secrets.mjs --env test|production [--out dossier]');
  process.exit(1);
}
const out = resolve(args.out ?? join(homedir(), `sayless-secrets-${env}`));
const repo = fileURLToPath(new URL('..', import.meta.url));
const inside = (dir) => { const rel = relative(dir, out); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)); };
if (inside(repo) || inside(process.cwd())) {
  console.error('Refus : le dossier de sortie doit être HORS du dépôt (jamais de secret dans Git).');
  process.exit(1);
}
try {
  await access(out);
  console.error(`Refus : ${out} existe déjà. Rien n'est écrasé.`);
  process.exit(1);
} catch { /* dossier absent : on continue */ }

const b64 = (bytes) => Buffer.from(bytes).toString('base64url');
const random = (n) => b64(crypto.getRandomValues(new Uint8Array(n)));
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const setupCode = Array.from({ length: 4 }, () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => CROCKFORD[b & 31]).join('')).join('-');

const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const vapidPublic = b64(new Uint8Array(await crypto.subtle.exportKey('raw', vapid.publicKey)));
const vapidPrivate = (await crypto.subtle.exportKey('jwk', vapid.privateKey)).d;
const backup = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['encrypt', 'decrypt']);
const backupPublic = await crypto.subtle.exportKey('jwk', backup.publicKey);
const backupPrivate = await crypto.subtle.exportKey('jwk', backup.privateKey);
for (const jwk of [backupPublic, backupPrivate]) { delete jwk.key_ops; delete jwk.ext; }

const shared = { APP_SECRET: random(32), PII_KEY: random(32) };
await mkdir(out, { recursive: true, mode: 0o700 });
const write = (name, content) => writeFile(join(out, name), content, { mode: 0o600 });
await write('worker-secrets.json', `${JSON.stringify({ ...shared, ADMIN_SETUP_CODE: setupCode, VAPID_PRIVATE_KEY: vapidPrivate }, null, 2)}\n`);
await write('pages-secrets.json', `${JSON.stringify(shared, null, 2)}\n`);
await write('public-values.txt', `VAPID_PUBLIC_KEY=${vapidPublic}\nBACKUP_PUBLIC_KEY=${JSON.stringify(backupPublic)}\n`);
await write('CLE-PRIVEE-SAUVEGARDES.json', `${JSON.stringify(backupPrivate, null, 2)}\n`);
await write('LISEZ-MOI.txt', [
  `Secrets SAYLESS (${env}) générés le ${new Date().toISOString()}.`,
  '1. Envoyer les secrets : voir docs/CLOUDFLARE-TEST.md (wrangler secret bulk).',
  '2. Code d’installation de STUDIO (à saisir une seule fois sur l’iPhone) : dans worker-secrets.json, ADMIN_SETUP_CODE.',
  '3. Copier CLE-PRIVEE-SAUVEGARDES.json hors ligne (clé USB rangée, coffre), puis l’effacer de cet ordinateur.',
  '4. Effacer ce dossier une fois les secrets envoyés : ils restent chez Cloudflare.',
  'Ne jamais envoyer ces fichiers par e-mail, messagerie, chat ou GitHub.',
].join('\n'));
console.log(`Secrets écrits dans ${out} (lisibles par toi seul). Suis docs/CLOUDFLARE-TEST.md pour les envoyer à Cloudflare.`);
