// Opérations STUDIO : étiquettes (jamais deux achats), suivi des colis, contrôle des retours,
// livre des recettes, accès journalisé aux coordonnées et purge des données personnelles.
import { all, audit, batch, fail, iso, one, pad4, sha256Hex, sql } from './lib.mjs';
import { openContact } from './security.mjs';

// ---------- étiquettes ----------
// Une commande payée réserve son étiquette en base avant tout appel transporteur. Après une
// réponse perdue, on recherche d'abord l'étiquette existante chez le transporteur.
export async function buyLabel(env, orderId, carrier, actor, deps) {
  const { db } = env;
  const now = deps.now();
  const claim = await batch(db, [sql(db, `INSERT INTO shipments (order_id, method, label_status, attempts, updated_at)
      SELECT id, COALESCE(shipping_method, 'home'), 'pending', 1, ? FROM orders WHERE id = ? AND status = 'paid'
    ON CONFLICT (order_id) DO UPDATE SET label_status = 'pending', attempts = attempts + 1, updated_at = excluded.updated_at
      WHERE shipments.label_status = 'failed'`, now, orderId)]);
  if (!claim[0].meta.changes) {
    const row = await one(db, 'SELECT label_status, carrier_ref FROM shipments WHERE order_id = ?', orderId);
    if (!row) return { result: 'order_not_payable' };
    return { result: row.label_status === 'pending' ? 'in_progress' : 'already_bought', carrier_ref: row.carrier_ref };
  }
  const order = await one(db, 'SELECT number, reference FROM orders WHERE id = ?', orderId);
  const ref = order.number ? `SL-${pad4(order.number)}` : order.reference;
  let label;
  try {
    label = (await carrier.find(ref)) ?? (await carrier.create(ref));
  } catch {
    await batch(db, [
      sql(db, `UPDATE shipments SET label_status = 'failed', updated_at = ? WHERE order_id = ? AND label_status = 'pending'`, now, orderId),
      audit(db, now, actor, 'label_purchase', ref, 'failed_retry_safe'),
    ]);
    return { result: 'failed_retry' };
  }
  await batch(db, [
    sql(db, `UPDATE shipments SET label_status = 'bought', carrier_ref = ?, updated_at = ? WHERE order_id = ? AND label_status = 'pending'`,
      label, now, orderId),
    audit(db, now, actor, 'label_purchase', ref, 'ok'),
  ]);
  return { result: 'bought', carrier_ref: label };
}

// ---------- suivi ----------
const RANK = { label: 0, in_transit: 1, available_at_relay: 2, delivered: 3, returned: 3 };
const RANK_SQL = (c) => `CASE ${c} WHEN 'label' THEN 0 WHEN 'in_transit' THEN 1 WHEN 'available_at_relay' THEN 2
  WHEN 'delivered' THEN 3 WHEN 'returned' THEN 3 END`;

// Les statuts n'avancent que dans un sens ; en point relais, « livré » signifie « retiré ».
export async function trackingUpdate(env, orderId, status, deps) {
  const { db } = env;
  const now = deps.now();
  if (!(status in RANK)) throw fail('invalid_request');
  const done = await batch(db, [sql(db, `UPDATE shipments SET tracking = ?, tracking_at = ?, updated_at = ?
    WHERE order_id = ? AND label_status = 'bought' AND ${RANK_SQL('tracking')} < ${RANK_SQL('?')}`,
  status, now, now, orderId, status)]);
  if (!done[0].meta.changes) return 0;
  const row = await one(db, `SELECT s.method, o.number, o.reference FROM shipments s JOIN orders o ON o.id = s.order_id
    WHERE s.order_id = ?`, orderId);
  const name = row.number ? pad4(row.number) : row.reference;
  const texts = {
    in_transit: ['parcel_shipped', `Colis ${name} expédié`, 'Pris en charge par le transporteur.'],
    available_at_relay: ['parcel_at_relay', `Colis ${name} disponible en point relais`, 'En attente de retrait par le client.'],
    delivered: row.method === 'relay'
      ? ['parcel_picked_up', `Colis ${name} retiré`, 'Le client a retiré son colis au point relais.']
      : ['parcel_delivered', `Colis ${name} livré`, 'Livraison confirmée par le transporteur.'],
    returned: ['parcel_returned', `Colis ${name} retourné`, 'Retour à l’expéditeur : contrôle à prévoir.'],
  };
  const [kind, title, body] = texts[status];
  await deps.notify({ kind, ref: orderId, level: status === 'returned' ? 'warning' : 'info', title, body });
  return 1;
}

// Colis disponible en relais depuis plus de N jours : une seule relance.
export async function relayOverdue(env, deps, days = 7) {
  const { db } = env;
  const now = deps.now();
  const rows = await all(db, `SELECT s.order_id, o.number, o.reference FROM shipments s JOIN orders o ON o.id = s.order_id
    WHERE s.tracking = 'available_at_relay' AND s.tracking_at <= ?`, now - days * 86400);
  for (const r of rows) {
    await deps.notify({ kind: 'parcel_not_collected', ref: r.order_id, level: 'warning',
      title: `Colis ${r.number ? pad4(r.number) : r.reference} non retiré`, body: `Disponible en relais depuis plus de ${days} jours.` });
  }
  return rows.length;
}

// ---------- retours ----------
// Contrôle physique explicite, une seule fois par ligne, borné par la quantité vendue.
export async function inspectReturn(env, { orderId, sku, quantity, resellable, actor, note = null }, deps) {
  const { db } = env;
  const now = deps.now();
  if (!Number.isSafeInteger(quantity) || quantity < 1 || typeof resellable !== 'boolean' || !actor) throw fail('invalid_request');
  try {
    await batch(db, [
      sql(db, `INSERT INTO return_checks (order_id, sku, quantity, resellable, actor, note, at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        orderId, sku, quantity, resellable ? 1 : 0, actor, note, now),
      audit(db, now, actor, 'return_check', `${orderId}:${sku}`, resellable ? 'restocked' : 'not_resellable'),
    ]);
    return resellable ? 'restocked' : 'not_resellable';
  } catch (error) {
    if (error.dbCode === 'unique_failed') {
      await batch(db, [audit(db, now, actor, 'return_check', `${orderId}:${sku}`, 'ignored_already_done')]);
      return 'already_done';
    }
    if (error.dbCode === 'return_quantity_exceeded' || error.dbCode === 'return_not_allowed') throw fail('invalid_request', { reason: error.dbCode });
    throw error;
  }
}

// ---------- livre des recettes (micro-entreprise) ----------
// CSV « ; », virgule décimale, UTF-8 avec BOM. Une ligne par encaissement et par remboursement.
// Toute cellule commençant par = + - @ est neutralisée (injection de formule dans le tableur).
export function csvSafe(value) {
  const text = String(value ?? '');
  const neutral = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[;"\n\r]/.test(neutral) ? `"${neutral.replaceAll('"', '""')}"` : neutral;
}
const money = (cents) => (cents / 100).toFixed(2).replace('.', ',');
// Montants produits par le code (format strict) : laissés numériques ; tout le reste est neutralisé.
const cell = (value) => (/^-?\d+,\d{2}$/.test(String(value)) ? String(value) : csvSafe(value));

export async function exportRecettes(env, actor, deps) {
  const { db } = env;
  const now = deps.now();
  const sales = await all(db, `SELECT number, reference, customer_name, total_cents, paid_at, source FROM orders
    WHERE paid_at IS NOT NULL AND status IN ('paid', 'paid_no_stock', 'review', 'refunded', 'partially_refunded')
    ORDER BY paid_at, number`);
  const refunds = await all(db, `SELECT r.amount_cents, r.created_at, o.number, o.reference, o.customer_name
    FROM refunds r JOIN orders o ON o.id = r.order_id ORDER BY r.created_at`);
  const rows = [
    ...sales.map((s) => ({ at: s.paid_at, line: [iso(s.paid_at).slice(0, 10), s.number ? pad4(s.number) : s.reference,
      s.customer_name ?? '', money(s.total_cents), 'Carte bancaire (Stripe)', s.source === 'storefront' ? 'Vente boutique' : 'Vente lien 1.0'] })),
    ...refunds.map((r) => ({ at: r.created_at, line: [iso(r.created_at).slice(0, 10), `${r.number ? pad4(r.number) : r.reference}-R`,
      r.customer_name ?? '', money(-r.amount_cents), 'Remboursement Stripe', 'Remboursement'] })),
  ].sort((a, b) => a.at - b.at);
  const header = ['Date', 'Référence', 'Client', 'Montant TTC (€)', 'Mode de règlement', 'Nature'];
  const csv = `﻿${[header, ...rows.map((r) => r.line)].map((line) => line.map(cell).join(';')).join('\r\n')}\r\n`;
  const digest = await sha256Hex(csv);
  await batch(db, [audit(db, now, actor, 'export_livre_recettes', `${rows.length} lignes`, digest.slice(0, 16))]);
  return { csv, sha256: digest };
}

// ---------- données personnelles ----------
export async function viewContact(env, orderId, actor, deps) {
  const { db } = env;
  const now = deps.now();
  const row = await one(db, 'SELECT sealed FROM order_contacts WHERE order_id = ?', orderId);
  await batch(db, [audit(db, now, actor, 'view_customer_contact', orderId, row ? 'ok' : 'none')]);
  return row ? openContact(env, row.sealed) : null;
}

// Purge des coordonnées des commandes payées avant une date. Le nom et le montant restent
// pour la comptabilité (conservation 10 ans) ; e-mail, téléphone et adresse disparaissent.
export async function purgeContacts(env, before, actor, deps) {
  const { db } = env;
  const now = deps.now();
  const res = await batch(db, [
    sql(db, `DELETE FROM order_contacts WHERE order_id IN (SELECT id FROM orders WHERE paid_at < ?)`, before),
    audit(db, now, actor, 'purge_customer_contacts', `paid_before=${iso(before)}`, 'ok'),
  ]);
  return res[0].meta.changes;
}
