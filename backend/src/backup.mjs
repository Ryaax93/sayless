// Sauvegarde logique et restauration contrôlée de la base D1 (procédure testée, cf. tests).
// Restauration : tables, puis données, puis index et déclencheurs — les déclencheurs de stock ne
// doivent pas rejouer les mouvements déjà appliqués. La copie restaurée garde ses protections.
import { invariants } from './stock.mjs';

const internal = (name) => name.startsWith('sqlite_') || name.startsWith('_cf_') || name === 'd1_migrations';

export async function dumpDatabase(db) {
  const objects = (await db.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master
    WHERE sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, rowid`).all()).results
    .filter((o) => !internal(o.name) && !internal(o.tbl_name));
  const tables = {};
  for (const o of objects.filter((x) => x.type === 'table')) {
    tables[o.name] = (await db.prepare(`SELECT * FROM "${o.name}"`).all()).results;
  }
  return { version: 1, objects, tables };
}

export async function restoreDatabase(db, dump) {
  const run = (text) => db.prepare(text).run();
  for (const o of dump.objects.filter((x) => x.type === 'table')) await run(o.sql);
  for (const [name, rows] of Object.entries(dump.tables)) {
    for (let i = 0; i < rows.length; i += 50) {
      const chunk = rows.slice(i, i + 50);
      await db.batch(chunk.map((row) => {
        const cols = Object.keys(row);
        return db.prepare(`INSERT INTO "${name}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
          .bind(...cols.map((c) => row[c]));
      }));
    }
  }
  for (const o of dump.objects.filter((x) => x.type !== 'table')) await run(o.sql);
  return invariants(db);
}
