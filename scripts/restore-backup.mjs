#!/usr/bin/env node
// Exercice de restauration, SUR L'ORDINATEUR DU FONDATEUR : déchiffre une copie avec la clé privée,
// contrôle l'image, la restaure dans une base D1 locale et jetable, puis vérifie le stock contre son
// registre. Rien n'est envoyé nulle part ; aucun fichier n'est écrit.
//
//   node scripts/restore-backup.mjs --backup sayless-sauvegarde-daily-2026-12-01.json --key /chemin/CLE-PRIVEE-SAUVEGARDES.json
//
// Copie : téléchargée depuis STUDIO (Santé du site > Sauvegardes chiffrées), ou par
//   npx wrangler kv key get --binding BACKUPS "daily/AAAA-MM-JJ" -c ops/wrangler.toml --remote > copie.json
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { checkDump, openBackup, restoreDatabase } from '../backend/src/backup.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith('--') ? [...acc, [v.slice(2), a[i + 1]]] : acc), []));
if (!args.backup || !args.key) {
  console.error('Usage : node scripts/restore-backup.mjs --backup copie.json --key CLE-PRIVEE-SAUVEGARDES.json');
  process.exit(1);
}
const box = await readFile(args.backup, 'utf8');
const dump = await openBackup(box, JSON.parse(await readFile(args.key, 'utf8')));
const created = new Date(JSON.parse(box).created_at * 1000).toISOString();
const problems = checkDump(dump);
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', d1Databases: ['DB'], compatibilityDate: '2026-05-15' }));
try {
  const db = await mf.getD1Database('DB');
  const after = await restoreDatabase(db, dump, { createdAt: JSON.parse(box).created_at });
  const counts = {};
  for (const table of ['orders', 'order_items', 'inventory', 'stock_movements', 'reservations', 'notifications', 'audit_log']) {
    if (dump.tables[table]) counts[table] = Object.values(await db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).first())[0];
  }
  const stock = (await db.prepare(`SELECT v.size, i.on_hand, i.reserved, i.confirmed_at FROM variants v JOIN inventory i ON i.sku = v.sku ORDER BY v.position`).all()).results;
  console.log(`Copie du ${created} déchiffrée et restaurée dans une base locale jetable.`);
  console.log(`Lignes : ${Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(', ')}`);
  console.log(`Stock : ${stock.map((s) => (s.confirmed_at === null ? `${s.size} à confirmer` : `${s.size} ${s.on_hand - s.reserved} libre(s)`)).join(' · ')}`);
  if (dump.tables.outbox) {
    const waiting = Object.values(await db.prepare(`SELECT COUNT(*) AS n FROM outbox WHERE channel = 'email' AND status IN ('pending', 'sending')`).first())[0];
    if (waiting) console.log(`E-mails non confirmés dans la copie : ${waiting}. Après une vraie restauration, ils repartent dans les 23 h suivant la copie, sinon ils passent « à vérifier » dans STUDIO.`);
  }
  const all = [...problems, ...after];
  if (all.length) {
    console.error(`ÉCHEC du contrôle : ${all.join(' ; ')}`);
    process.exitCode = 2;
  } else {
    console.log('Contrôle réussi : stock égal au registre, réservations et ventes cohérentes, aucune ligne orpheline.');
  }
} finally {
  await mf.dispose();
}
