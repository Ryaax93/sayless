// Sauvegardes : image logique de la base, compressée puis chiffrée avec la clé PUBLIQUE du fondateur,
// rangée hors de la base principale (Workers KV, offre gratuite), restaurable dans une base vide.
// La clé privée n'existe que chez le fondateur : ni Cloudflare, ni GitHub, ni le chat ne peuvent
// relire une sauvegarde.
//
// Cohérence : le schéma et toutes les tables sont lus dans UN SEUL lot D1. D1 exécute un lot d'un
// seul tenant, comme une transaction : aucune vente ne peut s'intercaler entre la lecture de
// l'inventaire et celle du registre. Le lot compte pour une seule requête (limite de 50 requêtes
// par invocation sur l'offre gratuite).
//
// Une copie n'est comptée comme réussie (et la rotation des anciennes n'a lieu) qu'après :
//  1. le contrôle de l'image en mémoire (tables présentes, stock = registre, réservations,
//     ventes, références entre tables) ;
//  2. la relecture de la copie stockée, identique octet pour octet (empreinte SHA-256).
// En cas d'échec, la copie défectueuse est retirée et les copies précédentes restent intactes.
import { b64url, batch, fromB64url, getSettings, sha256Hex, sql } from './lib.mjs';
import { invariants } from './stock.mjs';
import { parisClock } from './notify.mjs';

const internal = (name) => name.startsWith('sqlite_') || name.startsWith('_cf_') || name === 'd1_migrations';
const SCHEMA = `SELECT type, name, tbl_name, sql FROM sqlite_master
  WHERE sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, rowid`;
// Tables sans lesquelles une restauration n'a pas de sens.
export const REQUIRED_TABLES = ['settings', 'products', 'variants', 'inventory', 'stock_movements', 'orders', 'order_items',
  'reservations', 'audit_log'];

export async function dumpDatabase(db) {
  const names = (await db.prepare(SCHEMA).all()).results
    .filter((o) => o.type === 'table' && !internal(o.name)).map((o) => o.name);
  // Un seul lot : schéma + tables, image cohérente de la base à un instant donné.
  const results = await db.batch([db.prepare(SCHEMA), ...names.map((n) => db.prepare(`SELECT * FROM "${n}"`))]);
  const objects = results[0].results.filter((o) => !internal(o.name) && !internal(o.tbl_name));
  const listed = objects.filter((o) => o.type === 'table').map((o) => o.name);
  if (listed.join('|') !== names.join('|')) throw new Error('schéma modifié pendant la sauvegarde');
  const tables = Object.fromEntries(names.map((n, i) => [n, results[i + 1].results]));
  return { version: 1, objects, tables };
}

// Contrôle de l'image, sans base : les mêmes invariants que la base vérifie elle-même.
export function checkDump(dump) {
  const problems = [];
  const t = dump?.tables ?? {};
  for (const name of REQUIRED_TABLES) if (!Array.isArray(t[name])) problems.push(`table ${name} absente`);
  if (problems.length) return problems;
  const ledger = new Map();
  for (const m of t.stock_movements) {
    const e = ledger.get(m.sku) ?? { on_hand: 0, reserved: 0, n: 0, sold: 0 };
    e.on_hand += m.d_on_hand;
    e.reserved += m.d_reserved;
    e.n += 1;
    if (m.reason === 'sale' || m.reason === 'late_sale') e.sold -= m.d_on_hand;
    ledger.set(m.sku, e);
  }
  const active = new Map();
  const converted = new Map();
  for (const r of t.reservations) {
    if (r.status === 'held' || r.status === 'awaiting_payment') active.set(r.sku, (active.get(r.sku) ?? 0) + r.quantity);
    if (r.status === 'converted') converted.set(r.sku, (converted.get(r.sku) ?? 0) + r.quantity);
  }
  for (const i of t.inventory) {
    const e = ledger.get(i.sku) ?? { on_hand: 0, reserved: 0, n: 0, sold: 0 };
    if (i.on_hand !== e.on_hand) problems.push(`${i.sku}: stock ${i.on_hand} ≠ registre ${e.on_hand}`);
    if (i.reserved !== e.reserved) problems.push(`${i.sku}: réservé ${i.reserved} ≠ registre ${e.reserved}`);
    if (i.reserved !== (active.get(i.sku) ?? 0)) problems.push(`${i.sku}: réservé ${i.reserved} ≠ réservations actives ${active.get(i.sku) ?? 0}`);
    if (i.revision !== e.n) problems.push(`${i.sku}: révision ${i.revision} ≠ ${e.n} mouvements`);
    if ((converted.get(i.sku) ?? 0) !== e.sold) problems.push(`${i.sku}: ventes ${converted.get(i.sku) ?? 0} ≠ sorties ${e.sold}`);
  }
  const orders = new Set(t.orders.map((o) => o.id));
  for (const [table, rows] of [['order_items', t.order_items], ['reservations', t.reservations], ['order_contacts', t.order_contacts ?? []],
    ['shipments', t.shipments ?? []], ['refunds', t.refunds ?? []]]) {
    const orphans = rows.filter((r) => !orders.has(r.order_id)).length;
    if (orphans) problems.push(`${table}: ${orphans} ligne(s) sans commande`);
  }
  return problems;
}

// Restauration dans une base vide : tables, données, puis index et déclencheurs (les déclencheurs de
// stock ne doivent pas rejouer les mouvements déjà appliqués). Par lots : peu de requêtes.
export async function restoreDatabase(db, dump, { chunk = 200 } = {}) {
  const tables = dump.objects.filter((x) => x.type === 'table');
  if (tables.length) await db.batch(tables.map((o) => db.prepare(o.sql)));
  for (const [name, rows] of Object.entries(dump.tables)) {
    for (let i = 0; i < rows.length; i += chunk) {
      await db.batch(rows.slice(i, i + chunk).map((row) => {
        const cols = Object.keys(row);
        return db.prepare(`INSERT INTO "${name}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
          .bind(...cols.map((c) => row[c]));
      }));
    }
  }
  const rest = dump.objects.filter((x) => x.type !== 'table');
  if (rest.length) await db.batch(rest.map((o) => db.prepare(o.sql)));
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
  const plain = JSON.stringify(dump);
  const packed = await pipe(enc.encode(plain), new CompressionStream('gzip'));
  // Empreinte du contenu en clair : vérifiée par l'outil de restauration après déchiffrement.
  const header = { v: 1, alg: 'RSA-OAEP-256+A256GCM', zip: 'gzip', kid: await keyId(publicJwk), created_at: createdAt,
    content_sha256: await sha256Hex(plain) };
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
  const header = { v: box.v, alg: box.alg, zip: box.zip, kid: box.kid, created_at: box.created_at,
    ...(box.content_sha256 ? { content_sha256: box.content_sha256 } : {}) };
  const packed = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(box.iv), additionalData: enc.encode(JSON.stringify(header)) },
    aes, fromB64url(box.data));
  const plain = new TextDecoder().decode(await pipe(new Uint8Array(packed), new DecompressionStream('gzip')));
  if (box.content_sha256 && (await sha256Hex(plain)) !== box.content_sha256) throw new Error('empreinte du contenu différente');
  return JSON.parse(plain);
}

class BackupError extends Error {
  constructor(reason, details = []) {
    super(reason);
    this.reason = reason;
    this.details = details;
  }
}

async function putVerified(kv, name, sealed, metadata) {
  await kv.put(name, sealed, { metadata });
  const stored = await kv.get(name);
  if (stored === null || (await sha256Hex(stored)) !== metadata.sha256) {
    await kv.delete(name).catch(() => {});
    throw new BackupError('readback_mismatch');
  }
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
    const dump = await dumpDatabase(db);
    const problems = checkDump(dump);
    if (problems.length) throw new BackupError('dump_inconsistent', problems);
    const publicJwk = JSON.parse(env.BACKUP_PUBLIC_KEY);
    const sealed = await sealBackup(dump, publicJwk, now);
    const rows = Object.values(dump.tables).reduce((n, r) => n + r.length, 0);
    const metadata = { created_at: now, kid: await keyId(publicJwk), bytes: sealed.length, sha256: await sha256Hex(sealed),
      tables: Object.keys(dump.tables).length, rows, checks: 'ok' };
    await putVerified(env.BACKUPS, `daily/${clock.date}`, sealed, metadata);
    if (clock.date.endsWith('-01')) await putVerified(env.BACKUPS, `monthly/${clock.date.slice(0, 7)}`, sealed, metadata);
    // Rotation uniquement après une copie vérifiée : une copie défectueuse ne chasse jamais une bonne.
    await rotate(env.BACKUPS, 'daily/', Number(settings.backup_daily_keep || 30));
    await rotate(env.BACKUPS, 'monthly/', Number(settings.backup_monthly_keep || 12));
    await batch(db, [sql(db, `UPDATE settings SET value = ? WHERE key = 'backup_last_verified_at'`, String(now)),
      sql(db, `UPDATE settings SET value = '' WHERE key = 'backup_last_error'`)]);
    return clock.date;
  } catch (error) {
    const reason = error instanceof BackupError ? error.reason : 'write_failed';
    await batch(db, [sql(db, `UPDATE settings SET value = '' WHERE key = 'backup_last_date'`),
      sql(db, `UPDATE settings SET value = ? WHERE key = 'backup_last_error'`, `${clock.date}:${reason}`)]).catch(() => {});
    const detail = error instanceof BackupError && error.details.length ? ` Contrôle : ${error.details.slice(0, 3).join(' ; ')}.` : '';
    await deps.notify({ kind: 'backup_failed', ref: clock.date, level: 'critical', title: 'Sauvegarde du jour échouée',
      body: `La copie chiffrée n’a pas été validée (${reason}). Les copies précédentes sont conservées. Nouvel essai à la prochaine heure.${detail}` });
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
  for (const name of names.slice(0, Math.max(names.length - Math.max(keep, 1), 0))) await kv.delete(name);
}

export async function listBackups(kv) {
  const out = [];
  for (const prefix of ['daily/', 'monthly/']) {
    let cursor;
    do {
      const page = await kv.list({ prefix, cursor });
      out.push(...page.keys.map((k) => ({ name: k.name, ...k.metadata })));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  }
  return out;
}
