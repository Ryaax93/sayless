// Copie chiffrée de TEST pour la recette navigateur : base jetable (schéma et catalogue, aucune
// vente ni donnée personnelle), paire de clés générée à chaque exécution dans un dossier temporaire.
//   node tests/browser/make_backup.mjs <dossier> <date AAAA-MM-JJ>
// Écrit : public.json, private.json, copie.json (copie scellée), metadata.json.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { checkDump, dumpDatabase, sealBackup } from '../../backend/src/backup.mjs';

const [dir, date] = process.argv.slice(2);
if (!dir || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('usage : make_backup.mjs <dossier> <AAAA-MM-JJ>');
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', d1Databases: ['DB'], compatibilityDate: '2026-05-15' }));
try {
  const db = await mf.getD1Database('DB');
  const folder = new URL('../../backend/migrations/', import.meta.url);
  for (const file of (await readdir(folder)).filter((f) => f.endsWith('.sql')).sort()) {
    const text = await readFile(new URL(file, folder), 'utf8');
    for (const part of text.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) await db.prepare(part).run();
  }
  const dump = await dumpDatabase(db);
  const problems = checkDump(dump);
  if (problems.length) throw new Error(problems.join(' ; '));
  const keys = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['encrypt', 'decrypt']);
  const pub = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const priv = await crypto.subtle.exportKey('jwk', keys.privateKey);
  const now = Math.floor(Date.parse(`${date}T03:05:00Z`) / 1000);
  const sealed = await sealBackup(dump, pub, now);
  const rows = Object.values(dump.tables).reduce((n, r) => n + r.length, 0);
  await writeFile(join(dir, 'public.json'), JSON.stringify(pub), { mode: 0o600 });
  await writeFile(join(dir, 'private.json'), JSON.stringify(priv), { mode: 0o600 });
  await writeFile(join(dir, 'copie.json'), sealed, { mode: 0o600 });
  await writeFile(join(dir, 'metadata.json'), JSON.stringify({ created_at: now, bytes: sealed.length, tables: Object.keys(dump.tables).length, rows, checks: 'ok' }));
} finally {
  await mf.dispose();
}
