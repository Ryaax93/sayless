// Notifications : centre STUDIO, file d'envoi Discord / push, alertes de stock, rapport quotidien.
// Les messages ne contiennent jamais de nom, d'e-mail, de téléphone ni d'adresse : seuls des
// champs de la liste blanche (numéro, référence, taille, montant, mode de livraison) sont lus.
import { all, batch, getSettings, one, pad4, sql } from './lib.mjs';
import { pushReady } from './push.mjs';
import { COST, fits } from './budget.mjs';

const euros = (cents) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

// Une notification par (kind, ref) ; les canaux externes configurés reçoivent la même entrée.
// Canaux : ceux configurés ici, plus ceux que le Worker d'exploitation a déclarés dans la base
// (settings.notify_channels) : une alerte née dans la boutique part aussi sur Discord et l'iPhone
// sans copier leurs secrets dans le projet de la boutique.
export function createNotifier(env, deps) {
  return async function notify({ kind, ref, level = 'info', title, body }) {
    const { db } = env;
    const now = deps.now();
    const statements = [sql(db, `INSERT INTO notifications (kind, ref, level, title, body, at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (kind, ref) DO NOTHING`, kind, ref, level, title, body, now)];
    const payload = JSON.stringify({ kind, level, title, body });
    const declared = String((await one(db, `SELECT value FROM settings WHERE key = 'notify_channels'`).catch(() => null))?.value ?? '')
      .split(',').filter((c) => ['discord', 'push'].includes(c));
    for (const channel of new Set([...(deps.channels ?? []), ...declared])) {
      statements.push(sql(db, `INSERT INTO outbox (channel, dedupe, payload, at) VALUES (?, ?, ?, ?)
        ON CONFLICT (dedupe) DO NOTHING`, channel, `${channel}:${kind}:${ref}`, payload, now));
    }
    await batch(db, statements);
  };
}

export function configuredChannels(env) {
  const channels = [];
  if (/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(env.DISCORD_WEBHOOK_URL ?? '')) channels.push('discord');
  if (pushReady(env)) channels.push('push');
  return channels;
}

// Après une vente : nouvelle commande, stock faible (chaque palier une fois), taille épuisée,
// fin du drop. Une pièce réservée n'est jamais comptée comme épuisée.
export async function afterSale(env, orderId, deps, { announce = true } = {}) {
  const { db } = env;
  const order = await one(db, 'SELECT id, number, reference, total_cents, shipping_method, source FROM orders WHERE id = ?', orderId);
  const items = await all(db, `SELECT oi.sku, oi.quantity, v.size, v.product_id, p.drop_id FROM order_items oi
    LEFT JOIN variants v ON v.sku = oi.sku LEFT JOIN products p ON p.id = v.product_id WHERE oi.order_id = ?`, orderId);
  const mode = order.shipping_method === 'relay' ? 'point relais' : order.shipping_method === 'home' ? 'domicile' : 'lien 1.0';
  if (announce) await deps.notify({ kind: 'order_paid', ref: order.id, level: 'info',
    title: `Nouvelle commande ${order.number ? pad4(order.number) : order.reference}`,
    body: `${items.map((i) => `${i.quantity} × taille ${i.size ?? '?'}`).join(', ')} · ${euros(order.total_cents)} · ${mode}. À préparer.` });
  const settings = await getSettings(db);
  const threshold = Number(settings.low_stock_threshold || 2);
  const drops = new Set();
  for (const item of items) {
    if (!item.sku) continue;
    drops.add(item.drop_id);
    const inv = await one(db, 'SELECT on_hand FROM inventory WHERE sku = ?', item.sku);
    if (inv.on_hand === 0) {
      await deps.notify({ kind: 'size_sold_out', ref: item.sku, level: 'warning',
        title: `Taille ${item.size} épuisée`, body: `Plus aucune pièce en taille ${item.size}.` });
    } else if (inv.on_hand <= threshold) {
      await deps.notify({ kind: 'low_stock', ref: `${item.sku}:${inv.on_hand}`, level: 'warning',
        title: `Stock faible : taille ${item.size}`, body: `${inv.on_hand} pièce(s) restante(s) en taille ${item.size}.` });
    }
  }
  for (const dropId of drops) {
    const row = await one(db, `SELECT COUNT(*) AS n, SUM(i.on_hand) AS left_, SUM(CASE WHEN i.confirmed_at IS NULL THEN 1 ELSE 0 END) AS unconfirmed
      FROM products p JOIN variants v ON v.product_id = p.id JOIN inventory i ON i.sku = v.sku
      WHERE p.drop_id = ? AND p.status = 'published'`, dropId);
    if (row.n > 0 && row.unconfirmed === 0 && row.left_ === 0) {
      const drop = await one(db, 'SELECT name FROM drops WHERE id = ?', dropId);
      await deps.notify({ kind: 'drop_sold_out', ref: dropId, level: 'info',
        title: `${(drop?.name ?? dropId).toUpperCase()} — SOLD OUT`, body: 'Toutes les pièces sont vendues. Le message de fin de drop peut s’afficher.' });
    }
  }
}

// Envoi au moins une fois, sans doublon : réservation de la ligne (bail de 2 min), essais
// espacés, ligne « morte » et alerte technique après 5 échecs.
// `only` : envoyer tout de suite une entrée précise (accusé de réception), sans attendre la tâche.
export async function deliverOutbox(env, senders, deps, { maxAttempts = 5, limit = 25, only = null } = {}) {
  const { db } = env;
  const now = deps.now();
  const rows = await all(db, `SELECT id, channel, dedupe, payload FROM outbox
    WHERE status IN ('pending', 'sending') AND next_at <= ? ${only ? 'AND dedupe = ?' : ''} ORDER BY id LIMIT ?`,
  ...(only ? [now, only, limit] : [now, limit]));
  let sent = 0;
  let devices = null; // appareils abonnés, lus une fois si un message push attend (coût par appareil)
  for (const row of rows) {
    if (deps.budget) {
      const push = row.channel === 'push';
      if (push && devices === null) {
        if (!fits(deps, { queries: 1 })) break;
        devices = (await one(db, 'SELECT COUNT(*) AS n FROM push_subscriptions'))?.n ?? 0;
      }
      // Push : lecture des abonnements, puis une requête et un appel par appareil.
      if (!fits(deps, push ? { queries: COST.outboxMessage.queries + 1 + devices * COST.pushDevice.queries, external: devices * COST.pushDevice.external }
        : COST.outboxMessage)) break; // la suite à la minute suivante
    }
    const claim = await batch(db, [sql(db, `UPDATE outbox SET status = 'sending', attempts = attempts + 1, next_at = ?
      WHERE id = ? AND status IN ('pending', 'sending') AND next_at <= ?`, now + 120, row.id, now)]);
    if (!claim[0].meta.changes) continue;
    const send = senders[row.channel];
    try {
      if (!send) throw new Error('canal non configuré');
      // E-mails : contenu chiffré, ouvert par l'expéditeur seulement au moment de l'envoi.
      await send(row.channel === 'email' ? row.payload : JSON.parse(row.payload), row);
      await batch(db, [sql(db, `UPDATE outbox SET status = 'sent' WHERE id = ?`, row.id)]);
      sent += 1;
    } catch {
      const after = await one(db, 'SELECT attempts FROM outbox WHERE id = ?', row.id);
      const dead = after.attempts >= maxAttempts;
      await batch(db, [sql(db, `UPDATE outbox SET status = ?, next_at = ? WHERE id = ?`,
        dead ? 'dead' : 'pending', now + Math.min(60 * 2 ** after.attempts, 3600), row.id)]);
      if (dead) {
        await deps.notify({ kind: 'technical', ref: `outbox:${row.id}`, level: 'critical',
          title: 'Notification non distribuée', body: `Canal ${row.channel} : échec après ${maxAttempts} essais.` });
      }
    }
  }
  return sent;
}

// Discord : webhook entrant (gratuit, aucun bot). Aucune mention possible (@everyone neutralisé).
export function discordSender(url, transport = fetch) {
  return async (message) => {
    const colors = { info: 0xf0a6bf, warning: 0xf0c674, critical: 0xd9534f };
    const response = await transport(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ username: 'SAYLESS STUDIO', allowed_mentions: { parse: [] },
        embeds: [{ title: String(message.title).slice(0, 250), description: String(message.body).slice(0, 2000),
          color: colors[message.level] ?? colors.info }] }),
    });
    if (!response.ok) throw new Error(`discord_${response.status}`);
  };
}

// Rapport quotidien à 10 h (heure de Paris), déclenché par la tâche de chaque minute : la date du
// dernier envoi évite tout doublon et l'heure locale suit automatiquement l'heure d'été.
export function parisClock(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(now * 1000)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

export async function maybeDailyReport(env, deps) {
  const { db } = env;
  const now = deps.now();
  const clock = parisClock(now);
  if (clock.hour < 10) return null;
  const settings = await getSettings(db);
  if (settings.report_last_date === clock.date) return null;
  if (!fits(deps, COST.dailyReport)) return null; // budget de la minute épuisé : rapport à la minute suivante
  const claimed = await batch(db, [sql(db, `UPDATE settings SET value = ? WHERE key = 'report_last_date' AND value <> ?`,
    clock.date, clock.date)]);
  if (!claimed[0].meta.changes) return null;
  const since = now - 86400;
  const sales = await one(db, `SELECT COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS cents FROM orders
    WHERE paid_at >= ? AND status IN ('paid', 'partially_refunded')`, since);
  const toPrepare = await one(db, `SELECT COUNT(*) AS n FROM orders o WHERE o.status = 'paid'
    AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id AND s.label_status = 'bought')`);
  const stock = await all(db, `SELECT v.size, i.on_hand - i.reserved AS available, i.reserved, i.confirmed_at
    FROM variants v JOIN inventory i ON i.sku = v.sku JOIN products p ON p.id = v.product_id
    WHERE p.status = 'published' ORDER BY v.position`);
  const open = await one(db, `SELECT COUNT(*) AS n FROM notifications WHERE level = 'critical' AND resolved_at IS NULL`);
  const review = await one(db, `SELECT COUNT(*) AS n FROM orders WHERE status IN ('review', 'paid_no_stock')`);
  const dead = await one(db, `SELECT COUNT(*) AS n FROM outbox WHERE status = 'dead'`);
  const requests = await one(db, `SELECT COUNT(*) AS n FROM customer_requests WHERE status = 'received'`);
  const stockText = stock.map((s) => (s.confirmed_at === null ? `${s.size} à confirmer` : `${s.size} ${s.available}${s.reserved ? ` (+${s.reserved} réservée)` : ''}`)).join(' · ');
  const backup = Number(settings.backup_last_verified_at || 0);
  const health = [settings.backup_last_error ? 'sauvegarde en échec' : backup ? `sauvegarde vérifiée le ${parisClock(backup).date}` : 'sauvegarde non configurée',
    dead.n ? `${dead.n} message(s) non distribué(s)` : null].filter(Boolean).join(', ');
  await deps.notify({ kind: 'daily_report', ref: clock.date, level: 'info', title: `Rapport du ${clock.date}`,
    body: `24 h : ${sales.n} vente(s), ${euros(sales.cents)} encaissés (frais Stripe non déduits). À préparer : ${toPrepare.n}. À vérifier : ${review.n}. `
      + `Demandes à traiter : ${requests.n}. Stock : ${stockText || 'aucun'}. Alertes ouvertes : ${open.n}. Santé : ${health}.` });
  return clock.date;
}
