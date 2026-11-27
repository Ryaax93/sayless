// Stock : lecture publique (contrat GET /api/stock), inventaire guidé, ajustements, contrôles.
// Disponible = on_hand - reserved. Une pièce seulement réservée n'est jamais « épuisée ».
import { all, audit, batch, fail, getSettings, iso, one, sql, uuid } from './lib.mjs';

export function variantState(row) {
  if (row.confirmed_at === null || row.confirmed_at === undefined) return 'unavailable';
  const available = row.on_hand - row.reserved;
  if (available > 0) return 'available';
  return row.reserved > 0 ? 'held' : 'sold_out';
}

// Réponse du contrat commun (v1.2, minimisée) : le navigateur reçoit l'état de chaque taille et la
// quantité qu'il peut commander (plafonnée au maximum par commande), jamais le stock exact par
// taille. Seul le total du drop, affiché par la boutique, est exact.
export async function publicStock(db, productId, now) {
  let rows;
  let settings;
  try {
    settings = await getSettings(db);
    rows = await all(db, `SELECT p.id AS product_id, p.drop_id, p.status, v.sku, i.on_hand, i.reserved, i.confirmed_at
      FROM products p JOIN variants v ON v.product_id = p.id JOIN inventory i ON i.sku = v.sku
      WHERE p.id = ? ORDER BY v.position, v.sku`, productId);
  } catch {
    throw fail('stock_unavailable');
  }
  if (!rows.length || rows[0].status !== 'published') throw fail('unknown_product');
  const cap = Math.max(Number(settings.max_items_per_order || 1), 1);
  let total = 0;
  const variants = rows.map((r) => {
    const state = variantState(r);
    const free = state === 'available' ? r.on_hand - r.reserved : 0;
    total += free;
    const orderable = Math.min(free, cap);
    return { sku: r.sku, state, orderable, available: orderable }; // « available » : alias transitoire de « orderable »
  });
  const verified = variants.every((v) => v.state !== 'unavailable');
  let dropStatus = 'unavailable';
  if (verified) {
    if (total > 0) dropStatus = 'available';
    else if (variants.some((v) => v.state === 'held')) dropStatus = 'held';
    else if (await dropSoldOut(db, rows[0].drop_id)) dropStatus = 'sold_out';
  }
  const mode = settings.shop_mode === 'open' ? 'open' : 'paused';
  return {
    verified,
    mode,
    updated_at: iso(now),
    checkout_enabled: verified && mode === 'open' && settings.payments_enabled === '1' && dropStatus === 'available',
    drop_status: dropStatus,
    total_available: verified ? total : null,
    max_items_per_order: cap,
    variants,
  };
}

// SOLD OUT du drop : toutes les tailles publiées du drop confirmées et à zéro pièce présente.
export async function dropSoldOut(db, dropId) {
  const row = await one(db, `SELECT COUNT(*) AS n, SUM(i.on_hand) AS on_hand,
      SUM(CASE WHEN i.confirmed_at IS NULL THEN 1 ELSE 0 END) AS unconfirmed
    FROM products p JOIN variants v ON v.product_id = p.id JOIN inventory i ON i.sku = v.sku
    WHERE p.drop_id = ? AND p.status = 'published'`, dropId);
  return row.n > 0 && row.unconfirmed === 0 && row.on_hand === 0;
}

// Pourquoi une réservation a été refusée : réservée temporairement ou réellement épuisée.
export async function explainShortage(db, items) {
  for (const item of items) {
    const row = await one(db, 'SELECT on_hand, reserved FROM inventory WHERE sku = ?', item.sku);
    if (row && row.on_hand - row.reserved < item.quantity) {
      return row.on_hand >= item.quantity && row.reserved > 0 ? 'held' : 'sold_out';
    }
  }
  return 'held';
}

// Inventaire guidé (STUDIO) : quantités vendables comptées par taille, avec la révision lue à
// l'ouverture du formulaire. Aucun total imposé : l'écart avec la déclaration théorique est noté.
export async function recordInventory(db, { counts, expected = {}, actor, note = null, now }) {
  const entries = Object.entries(counts ?? {});
  if (!entries.length || !actor) throw fail('invalid_request');
  const statements = [];
  const batchId = uuid();
  for (const [sku, count] of entries) {
    if (!Number.isSafeInteger(count) || count < 0 || count > 10000) throw fail('invalid_request');
    const row = await one(db, 'SELECT on_hand, reserved, revision FROM inventory WHERE sku = ?', sku);
    if (!row) throw fail('invalid_items');
    if (count < row.reserved) throw fail('quantity_below_reservations');
    const revision = Number.isSafeInteger(expected[sku]) ? expected[sku] : row.revision;
    statements.push(sql(db, `INSERT INTO assertions (code) SELECT 'stale_revision'
      WHERE (SELECT revision FROM inventory WHERE sku = ?) <> ?`, sku, revision));
    if (count !== row.on_hand) {
      statements.push(sql(db, `INSERT INTO stock_movements (sku, d_on_hand, d_reserved, reason, ref, note, actor, at)
        SELECT sku, ? - on_hand, 0, 'inventory_count', ?, ?, ?, ? FROM inventory WHERE sku = ?`,
      count, `inventory:${batchId}:${sku}`, note, actor, now, sku));
    }
    statements.push(sql(db, 'UPDATE inventory SET confirmed_at = ? WHERE sku = ?', now, sku));
  }
  statements.push(audit(db, now, actor, 'inventory_count', entries.map(([s, c]) => `${s}=${c}`).join(' '), 'ok'));
  try {
    await batch(db, statements);
  } catch (error) {
    if (error.dbCode === 'stale_revision') throw fail('stale_revision');
    if (error.dbCode === 'check_failed') throw fail('quantity_below_reservations');
    throw error;
  }
  return inventorySnapshot(db);
}

// Ajustement manuel motivé, en compare-and-swap sur la révision (deux écrans ouverts = un seul gagne).
export async function adjustStock(db, { sku, delta, expectedRevision, actor, note, now }) {
  if (!Number.isSafeInteger(delta) || delta === 0 || !Number.isSafeInteger(expectedRevision) || !note || !actor) {
    throw fail('invalid_request');
  }
  try {
    await batch(db, [
      sql(db, `INSERT INTO assertions (code) SELECT 'stale_revision'
        WHERE (SELECT revision FROM inventory WHERE sku = ?) IS NOT ?`, sku, expectedRevision),
      sql(db, `INSERT INTO stock_movements (sku, d_on_hand, d_reserved, reason, ref, note, actor, at)
        VALUES (?, ?, 0, 'adjustment', ?, ?, ?, ?)`, sku, delta, `adjust:${uuid()}`, note, actor, now),
      audit(db, now, actor, 'stock_adjustment', sku, `delta=${delta}`),
    ]);
  } catch (error) {
    if (error.dbCode === 'stale_revision') throw fail('stale_revision');
    if (error.dbCode === 'check_failed') throw fail('quantity_below_reservations');
    if (error.dbCode === 'unknown_sku') throw fail('invalid_items');
    throw error;
  }
  return one(db, 'SELECT sku, on_hand, reserved, revision FROM inventory WHERE sku = ?', sku);
}

export async function inventorySnapshot(db) {
  return all(db, `SELECT v.sku, v.product_id, v.size, i.on_hand, i.reserved, i.on_hand - i.reserved AS available,
      i.confirmed_at, i.revision
    FROM variants v JOIN inventory i ON i.sku = v.sku ORDER BY v.product_id, v.position, v.sku`);
}

// Rapprochement : le stock doit égaler la somme du registre, les réservations actives et les ventes.
export async function invariants(db) {
  const problems = [];
  const rows = await all(db, `SELECT i.sku, i.on_hand, i.reserved,
      COALESCE((SELECT SUM(d_on_hand) FROM stock_movements m WHERE m.sku = i.sku), 0) AS ledger_on_hand,
      COALESCE((SELECT SUM(d_reserved) FROM stock_movements m WHERE m.sku = i.sku), 0) AS ledger_reserved,
      COALESCE((SELECT SUM(quantity) FROM reservations r WHERE r.sku = i.sku AND r.status IN ('held','awaiting_payment')), 0) AS active
    FROM inventory i`);
  for (const r of rows) {
    if (r.on_hand !== r.ledger_on_hand) problems.push(`${r.sku}: stock ${r.on_hand} ≠ registre ${r.ledger_on_hand}`);
    if (r.reserved !== r.ledger_reserved) problems.push(`${r.sku}: réservé ${r.reserved} ≠ registre ${r.ledger_reserved}`);
    if (r.reserved !== r.active) problems.push(`${r.sku}: réservé ${r.reserved} ≠ réservations actives ${r.active}`);
  }
  const sold = await all(db, `SELECT r.sku, SUM(r.quantity) AS q FROM reservations r
    WHERE r.status = 'converted' GROUP BY r.sku`);
  for (const s of sold) {
    const m = await one(db, `SELECT COALESCE(-SUM(d_on_hand), 0) AS q FROM stock_movements
      WHERE sku = ? AND reason IN ('sale', 'late_sale')`, s.sku);
    if (m.q !== s.q) problems.push(`${s.sku}: ventes ${s.q} ≠ sorties ${m.q}`);
  }
  return problems;
}
