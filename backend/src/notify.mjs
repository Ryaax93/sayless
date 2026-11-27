// Notifications : centre STUDIO, file d'envoi Discord / push, alertes de stock, rapport quotidien.
// Les messages ne contiennent jamais de nom, d'e-mail, de téléphone ni d'adresse : seuls des
// champs de la liste blanche (numéro, référence, taille, montant, mode de livraison) sont lus.
import { all, batch, getSettings, one, pad4, sql } from './lib.mjs';
import { pushReady } from './push.mjs';
import { COST, fits } from './budget.mjs';
import { emailEnvelope } from './email.mjs';

const euros = (cents) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

// Une notification par (kind, ref) ; les canaux externes configurés reçoivent la même entrée.
// Canaux : ceux configurés ici, plus ceux que le Worker d'exploitation a déclarés dans la base
// (settings.notify_channels) : une alerte née dans la boutique part aussi sur Discord et l'iPhone
// sans copier leurs secrets dans le projet de la boutique.
// Salons Discord du serveur privé SAYLESS : un webhook par salon (secret du Worker), choisi côté
// serveur d'après le type d'événement, jamais d'après une donnée reçue du navigateur. Un salon sans
// webhook dédié reçoit ses messages par le webhook unique DISCORD_WEBHOOK_URL s'il existe (mode
// d'avant, toujours valable) ; sinon ses messages restent dans STUDIO et sur l'iPhone. Les textes
// ne portent que des références, montants agrégés et états : aucune donnée de client.
export const DISCORD_ROUTES = Object.freeze({
  commandes: ['order_paid', 'legacy_link_sale', 'legacy_link_review', 'address_out_of_zone', 'request_contact'],
  expeditions: ['parcel_shipped', 'parcel_at_relay', 'parcel_picked_up', 'parcel_delivered', 'parcel_not_collected'],
  retours: ['parcel_returned', 'request_return', 'request_withdrawal', 'refund'],
  stock: ['low_stock', 'size_sold_out', 'drop_sold_out', 'paid_without_stock', 'legacy_link_without_stock'],
  finances: ['payment_mismatch', 'payment_failed', 'dispute', 'unknown_refund', 'unknown_session'],
  rapport: ['daily_report'],
  alertes: ['technical', 'mail_intent_stuck', 'email_uncertain', 'contact_not_sealed', 'terms_integrity'],
  securite: ['studio_passkey_added', 'studio_recovery_used', 'studio_counter_regressed', 'studio_codes_regenerated'],
  site: ['shop_opened', 'shop_paused'],
  sauvegardes: ['backup_failed', 'backup_not_configured'],
});
const ROUTE_OF = new Map(Object.entries(DISCORD_ROUTES).flatMap(([route, kinds]) => kinds.map((kind) => [kind, route])));
export const discordRoute = (kind) => ROUTE_OF.get(kind) ?? 'alertes'; // type nouveau ou imprévu : alertes
export const discordSecretName = (route) => `DISCORD_WEBHOOK_${route.toUpperCase()}`;
// Adresse de webhook Discord seulement (aucun autre hôte joignable par ce biais).
export const validWebhook = (url) => typeof url === 'string' && /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url);
export function discordUrl(env, route) {
  const own = env[discordSecretName(route)];
  if (validWebhook(own)) return own;
  return validWebhook(env.DISCORD_WEBHOOK_URL) ? env.DISCORD_WEBHOOK_URL : null;
}
export const discordConfigured = (env) => validWebhook(env.DISCORD_WEBHOOK_URL)
  || Object.keys(DISCORD_ROUTES).some((route) => validWebhook(env[discordSecretName(route)]));
// Salons et destination effective, sans aucune adresse (écran Santé de STUDIO).
export const discordRouting = (env) => Object.keys(DISCORD_ROUTES).map((route) => ({ route,
  target: validWebhook(env[discordSecretName(route)]) ? 'dedicated' : validWebhook(env.DISCORD_WEBHOOK_URL) ? 'shared' : 'none' }));

export function createNotifier(env, deps) {
  return async function notify({ kind, ref, level = 'info', title, body }) {
    const { db } = env;
    const now = deps.now();
    const statements = [sql(db, `INSERT INTO notifications (kind, ref, level, title, body, at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (kind, ref) DO NOTHING`, kind, ref, level, title, body, now)];
    const payload = JSON.stringify({ kind, level, title, body });
    const declared = String((await one(db, `SELECT value FROM settings WHERE key = 'notify_channels'`).catch(() => null))?.value ?? '')
      .split(',').filter((c) => ['discord', 'push'].includes(c));
    const route = discordRoute(kind);
    for (const channel of new Set([...(deps.channels ?? []), ...declared])) {
      // Discord configuré, mais ni salon dédié ni webhook unique pour cet événement : rien à envoyer.
      if (channel === 'discord' && discordConfigured(env) && !discordUrl(env, route)) continue;
      statements.push(sql(db, `INSERT INTO outbox (channel, dedupe, payload, at, route) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (dedupe) DO NOTHING`, channel, `${channel}:${kind}:${ref}`, payload, now, channel === 'discord' ? route : null));
    }
    await batch(db, statements);
  };
}

export function configuredChannels(env) {
  const channels = [];
  if (discordConfigured(env)) channels.push('discord');
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

// Envoi au moins une fois : réservation de la ligne (bail de 2 min), essais espacés, ligne « morte »
// et alerte technique après 5 échecs certains.
// E-mails (Resend, clé d'idempotence gardée 24 h à partir du premier appel) : un échec ambigu
// (réseau, délai, 408, 409, 5xx, arrêt pendant l'envoi) peut cacher un e-mail déjà accepté. On ne
// le renvoie automatiquement que pendant EMAIL_SAFE_WINDOW après le premier essai, où la clé
// protège encore contre un doublon. Passé ce délai, ou après EMAIL_MAX_ATTEMPTS essais, l'e-mail
// passe « à vérifier » (uncertain) : alerte critique, rapprochement dans STUDIO avant tout nouvel
// envoi. Pas de promesse d'envoi « exactement une fois » au-delà de cette fenêtre. Un refus net de
// Resend (4xx) n'a rien envoyé : échec ordinaire. Enveloppe figée au premier essai ; contenu
// chiffré figé dès la mise en file ; référence Resend conservée.
// `only` : envoyer tout de suite une entrée précise (accusé de réception), sans attendre la tâche.
export const EMAIL_SAFE_WINDOW = 23 * 3600; // une heure de marge sur les 24 h de Resend
export const EMAIL_MAX_ATTEMPTS = 25;

const outboxRef = (row) => row.dedupe.replace(/^email:/, '');

async function parkUncertain(db, deps, row, since, reason) {
  const parked = await batch(db, [sql(db, `UPDATE outbox SET status = 'uncertain', uncertain_since = ?, last_error = ?
    WHERE id = ? AND status = ? AND attempts = ?`, since, reason, row.id, row.status, row.attempts)]);
  if (!parked[0].meta.changes) return false;
  await deps.notify?.({ kind: 'email_uncertain', ref: outboxRef(row), level: 'critical', title: 'E-mail client à vérifier',
    body: `${emailLabel(row.dedupe)} : Resend n'a pas confirmé l'envoi et la protection contre les doublons a expiré. `
      + 'Vérifie dans Resend s\'il est parti, puis dans STUDIO (Santé du site) choisis « Il est parti » ou « Renvoyer ».' });
  return true;
}

// Libellé sans donnée personnelle (la référence de la commande ou de la demande seulement).
export function emailLabel(dedupe) {
  const [, kind, id] = /^email:([a-z_]+):(.+)$/.exec(dedupe) ?? [];
  const names = { order_confirmation: 'Confirmation de commande', request_ack: 'Accusé de demande', shipped: 'Avis d\'expédition' };
  return `${names[kind] ?? 'E-mail client'} ${id ?? ''}`.trim();
}

export async function deliverOutbox(env, senders, deps, { maxAttempts = 5, limit = 25, only = null } = {}) {
  const { db } = env;
  const now = deps.now();
  const rows = await all(db, `SELECT id, channel, dedupe, payload, status, attempts, at, first_attempt_at, last_attempt_at,
    uncertain_since, envelope, route FROM outbox
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
    const email = row.channel === 'email';
    // Bail expiré pendant un envoi d'e-mail : l'essai s'est arrêté sans issue connue.
    const since = email && row.status === 'sending' ? (row.uncertain_since ?? row.last_attempt_at ?? row.at) : row.uncertain_since;
    if (email && since !== null && (now >= (row.first_attempt_at ?? row.at) + EMAIL_SAFE_WINDOW || row.attempts >= EMAIL_MAX_ATTEMPTS)) {
      await parkUncertain(db, deps, row, since, now >= (row.first_attempt_at ?? row.at) + EMAIL_SAFE_WINDOW ? 'idempotence_expiree' : 'essais_epuises');
      continue;
    }
    const envelope = email ? (row.envelope ?? JSON.stringify(emailEnvelope(env))) : null;
    const claim = await batch(db, [sql(db, `UPDATE outbox SET status = 'sending', attempts = attempts + 1, next_at = ?,
      first_attempt_at = COALESCE(first_attempt_at, ?), last_attempt_at = ?, uncertain_since = ?, envelope = COALESCE(envelope, ?)
      WHERE id = ? AND status IN ('pending', 'sending') AND next_at <= ?`, now + 120, now, now, since, envelope, row.id, now)]);
    if (!claim[0].meta.changes) continue;
    const send = senders[row.channel];
    const attempts = row.attempts + 1;
    try {
      if (!send) throw new Error('canal non configuré');
      // E-mails : contenu chiffré, ouvert par l'expéditeur seulement au moment de l'envoi.
      const receipt = await send(email ? row.payload : JSON.parse(row.payload),
        { ...row, attempts, envelope: email ? JSON.parse(envelope) : null });
      await batch(db, [sql(db, `UPDATE outbox SET status = 'sent', provider_ref = ?, last_error = NULL WHERE id = ?`,
        typeof receipt?.id === 'string' ? receipt.id : null, row.id)]);
      sent += 1;
    } catch (error) {
      // Échec ambigu d'un e-mail : peut-être parti ; l'incertitude date de cet essai (ou d'avant).
      const uncertain = email && (since !== null || error?.ambiguous === true) ? (since ?? now) : null;
      const code = String(error?.message ?? 'erreur').slice(0, 40);
      if (uncertain !== null && attempts >= EMAIL_MAX_ATTEMPTS) {
        await parkUncertain(db, deps, { ...row, status: 'sending', attempts }, uncertain, 'essais_epuises');
        continue;
      }
      // Échec certain : rien n'est parti. Demande d'attente (429) : ni abandon ni échec compté.
      const wait = Number.isInteger(error?.retryAfter) ? error.retryAfter : null;
      const dead = uncertain === null && wait === null && attempts >= maxAttempts;
      await batch(db, [sql(db, `UPDATE outbox SET status = ?, next_at = ?, uncertain_since = ?, last_error = ?, attempts = attempts - ? WHERE id = ?`,
        dead ? 'dead' : 'pending', now + (wait ?? Math.min(60 * 2 ** attempts, 3600)), uncertain, code, wait === null ? 0 : 1, row.id)]);
      if (dead) {
        await deps.notify({ kind: 'technical', ref: `outbox:${row.id}`, level: 'critical',
          title: 'Notification non distribuée', body: `Canal ${row.channel} : échec après ${maxAttempts} essais.` });
      }
    }
  }
  return sent;
}

// Après le rapprochement par le fondateur (STUDIO) : « parti » clôt la ligne ; « renvoyer » la remet
// en file avec une nouvelle fenêtre (même clé : si Resend la connaît encore, aucun doublon).
export async function reconcileEmail(db, id, decision, now) {
  const ok = await batch(db, [decision === 'delivered'
    ? sql(db, `UPDATE outbox SET status = 'sent', last_error = 'confirme_par_le_fondateur' WHERE id = ? AND status = 'uncertain'`, id)
    : sql(db, `UPDATE outbox SET status = 'pending', attempts = 0, next_at = ?, first_attempt_at = NULL, last_attempt_at = NULL,
        uncertain_since = NULL, last_error = 'renvoi_demande' WHERE id = ? AND status = 'uncertain'`, now, id)]);
  return ok[0].meta.changes === 1;
}

// Sauvegarde restaurée : un e-mail non confirmé a pu partir après la copie. Sa fenêtre de protection
// court au plus tard depuis l'instant de la copie ; passé ce délai, il sera « à vérifier ».
export async function markRestoredEmails(db, createdAt) {
  const r = await db.prepare(`UPDATE outbox SET first_attempt_at = MIN(COALESCE(first_attempt_at, ?), ?),
    uncertain_since = COALESCE(uncertain_since, ?) WHERE channel = 'email' AND status IN ('pending', 'sending')`)
    .bind(createdAt, createdAt, createdAt).run();
  return r.meta?.changes ?? 0;
}

// Discord : webhook entrant (gratuit, aucun bot). Aucune mention possible (@everyone neutralisé).
// Salon choisi à l'envoi d'après la destination logique enregistrée dans la file (route) : un
// webhook ajouté ou corrigé entre-temps sert aussi aux messages déjà en attente.
// 429 : Discord demande d'attendre (Retry-After) ; le message repart ensuite, sans compter comme échec.
// Discord n'a pas de clé d'idempotence : une réponse perdue peut, rarement, doubler un message.
export function discordSender(env, transport = fetch) {
  return async (message, row = {}) => {
    const url = discordUrl(env, row.route ?? discordRoute(message.kind));
    if (!url) throw new Error('salon_discord_absent');
    const colors = { info: 0xf0a6bf, warning: 0xf0c674, critical: 0xd9534f };
    const response = await transport(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ username: 'SAYLESS STUDIO', allowed_mentions: { parse: [] },
        embeds: [{ title: String(message.title).slice(0, 250), description: String(message.body).slice(0, 2000),
          color: colors[message.level] ?? colors.info }] }),
    });
    if (response.status === 429) {
      const wait = Number(response.headers.get('Retry-After'));
      throw Object.assign(new Error('discord_429'), { retryAfter: Number.isFinite(wait) && wait > 0 ? Math.min(Math.ceil(wait), 3600) : 60 });
    }
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
