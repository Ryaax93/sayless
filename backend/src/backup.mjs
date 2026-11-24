// Sauvegardes : copie logique de la base, compressée puis chiffrée avec la clé PUBLIQUE du fondateur,
// rangée hors de la base principale (Workers KV, offre gratuite), puis restaurable dans une base vide.
// La clé privée n'existe que chez le fondateur : ni Cloudflare, ni GitHub, ni le chat ne peuvent
// relire une sauvegarde. Restauration : tables, données, puis index et déclencheurs (les
// déclencheurs de stock ne doivent pas rejouer les mouvements déjà appliqués).
import { invariants } from './stock.mjs';
import { b64url, batch, fromB64url, getSettings, sha256Hex, sql } from './lib.mjs';
import { parisClock } from './notify.mjs';

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

// ---------- chiffrement : AES-256-GCM, clé enveloppée en RSA-OAEP-256 (clé publique du fondateur) ----------
const enc = new TextEncoder();
const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' };

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
export async function keyId(publicJwk) {
  return (await sha256Hex(`${publicJwk.kty}:${publicJwk.n}:${publicJwk.e}`)).slice(0, 16);
}

export async function sealBackup(dump, publicJwk, createdAt) {
  const publicKey = await crypto.subtle.importKey('jwk', publicJwk, RSA, false, ['encrypt']);
  const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', aes));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const packed = await pipe(enc.encode(JSON.stringify(dump)), new CompressionStream('gzip'));
  const header = { v: 1, alg: 'RSA-OAEP-256+A256GCM', zip: 'gzip', kid: await keyId(publicJwk), created_at: createdAt };
  const aad = enc.encode(JSON.stringify(header));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, aes, packed);
  const key = await crypto.subtle.encrypt(RSA, publicKey, raw);
  raw.fill(0);
  return JSON.stringify({ ...header, key: b64url(key), iv: b64url(iv), data: b64url(data) });
}

export async function openBackup(text, privateJwk) {
  const box = JSON.parse(text);
  if (box.v !== 1 || box.alg !== 'RSA-OAEP-256+A256GCM') throw new Error('format de sauvegarde inconnu');
  const privateKey = await crypto.subtle.importKey('jwk', privateJwk, RSA, false, ['decrypt']);
  const raw = await crypto.subtle.decrypt(RSA, privateKey, fromB64url(box.key));
  const aes = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  const header = { v: box.v, alg: box.alg, zip: box.zip, kid: box.kid, created_at: box.created_at };
  const packed = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(box.iv), additionalData: enc.encode(JSON.stringify(header)) },
    aes, fromB64url(box.data));
  return JSON.parse(new TextDecoder().decode(await pipe(new Uint8Array(packed), new DecompressionStream('gzip'))));
}

// ---------- sauvegarde quotidienne (après 3 h, heure de Paris) avec rotation ----------
// 30 copies quotidiennes et 12 mensuelles (le 1er du mois) dans le KV `BACKUPS`.
export async function maybeDailyBackup(env, deps) {
  const { db } = env;
  const now = deps.now();
  const clock = parisClock(now);
  if (clock.hour < 3) return null;
  if (!env.BACKUPS || !env.BACKUP_PUBLIC_KEY) {
    await deps.notify({ kind: 'backup_not_configured', ref: 'once', level: 'warning', title: 'Sauvegarde externe non configurée',
      body: 'La copie chiffrée quotidienne attend sa clé publique et son espace de stockage.' });
    return null;
  }
  const settings = await getSettings(db);
  if (settings.backup_last_date === clock.date) return null;
  const claimed = await batch(db, [sql(db, `UPDATE settings SET value = ? WHERE key = 'backup_last_date' AND value <> ?`, clock.date, clock.date)]);
  if (!claimed[0].meta.changes) return null;
  try {
    const publicJwk = JSON.parse(env.BACKUP_PUBLIC_KEY);
    const sealed = await sealBackup(await dumpDatabase(db), publicJwk, now);
    const metadata = { created_at: now, kid: await keyId(publicJwk), bytes: sealed.length };
    await env.BACKUPS.put(`daily/${clock.date}`, sealed, { metadata });
    if (clock.date.endsWith('-01')) await env.BACKUPS.put(`monthly/${clock.date.slice(0, 7)}`, sealed, { metadata });
    await rotate(env.BACKUPS, 'daily/', Number(settings.backup_daily_keep || 30));
    await rotate(env.BACKUPS, 'monthly/', Number(settings.backup_monthly_keep || 12));
    return clock.date;
  } catch (error) {
    await batch(db, [sql(db, `UPDATE settings SET value = '' WHERE key = 'backup_last_date'`)]).catch(() => {});
    await deps.notify({ kind: 'backup_failed', ref: clock.date, level: 'critical', title: 'Sauvegarde du jour échouée',
      body: 'La copie chiffrée n’a pas pu être écrite. Nouvel essai à la prochaine heure.' });
    throw error;
  }
}

async function rotate(kv, prefix, keep) {
  const names = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor });
    names.push(...page.keys.map((k) => k.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  names.sort();
  for (const name of names.slice(0, Math.max(names.length - keep, 0))) await kv.delete(name);
}

export async function listBackups(kv) {
  const out = [];
  for (const prefix of ['daily/', 'monthly/']) {
    const page = await kv.list({ prefix });
    out.push(...page.keys.map((k) => ({ name: k.name, ...k.metadata })));
  }
  return out;
}
