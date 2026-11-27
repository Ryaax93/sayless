// Notifications : centre STUDIO, file d'envoi Discord / push, alertes de stock, rapport quotidien.
// Les messages ne contiennent jamais de nom, d'e-mail, de téléphone ni d'adresse : seuls des
// champs de la liste blanche (numéro, référence, taille, montant, mode de livraison) sont lus.
import { all, batch, getSettings, one, pad4, sql } from './lib.mjs';
import { explainCode, pushReady } from './push.mjs';
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
  alertes: ['technical', 'channel_failure', 'push_device_expired', 'mail_intent_stuck', 'email_uncertain', 'contact_not_sealed', 'terms_integrity'],
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

// `exclude` : canaux à ne pas utiliser (une alerte sur une panne de canal ne repart jamais par ce canal).
// iPhone : un message n'est mis en file que si un appareil est abonné ; sans appareil, la notification
// reste dans STUDIO et rien n'échoue (l'absence d'appareil n'est pas une panne).
export function createNotifier(env, deps) {
  return async function notify({ kind, ref, level = 'info', title, body, exclude = [] }) {
    const { db } = env;
    const now = deps.now();
    const statements = [sql(db, `INSERT INTO notifications (kind, ref, level, title, body, at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (kind, ref) DO NOTHING`, kind, ref, level, title, body, now)];
    const payload = JSON.stringify({ kind, level, title, body });
    const declared = String((await one(db, `SELECT value FROM settings WHERE key = 'notify_channels'`).catch(() => null))?.value ?? '')
      .split(',').filter((c) => ['discord', 'push'].includes(c));
    const route = discordRoute(kind);
    for (const channel of new Set([...(deps.channels ?? []), ...declared])) {
      if (exclude.includes(channel)) continue;
      // Discord configuré, mais ni salon dédié ni webhook unique pour cet événement : rien à envoyer.
      if (channel === 'discord' && discordConfigured(env) && !discordUrl(env, route)) continue;
      statements.push(channel === 'push'
        ? sql(db, `INSERT INTO outbox (channel, dedupe, payload, at, route) SELECT 'push', ?, ?, ?, NULL
            WHERE EXISTS (SELECT 1 FROM push_subscriptions WHERE expired_at IS NULL) ON CONFLICT (dedupe) DO NOTHING`, `push:${kind}:${ref}`, payload, now)
        : sql(db, `INSERT INTO outbox (channel, dedupe, payload, at, route) VALUES (?, ?, ?, ?, ?)
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

// Pannes de canal (Discord, iPhone, e-mail client) : un incident par canal (table channel_health).
// Alerte au premier message abandonné, puis au plus une par jour tant que la panne dure, jamais par
// le canal en panne. Une alerte sur une panne (ou une notice d'abonnement expiré) qui échoue à son
// tour n'en déclenche aucune autre : aucune boucle, même si Discord et l'iPhone tombent ensemble.
// Les alertes de l'ancienne file (« technical » sur outbox:N, avant la migration 0009) comptent
// comme telles. Premier envoi réussi : canal rétabli, alerte ouverte résolue.
export const ALERT_REPEAT = 24 * 3600;
const META_KINDS = new Set(['channel_failure', 'push_device_expired']);
export function isMetaAlert(row) {
  if (/:technical:outbox:\d+$/.test(row.dedupe)) return true;
  try {
    return META_KINDS.has(JSON.parse(row.payload)?.kind);
  } catch {
    return false; // e-mail chiffré : jamais une alerte
  }
}
const CHANNEL_TITLES = { push: 'Notifications iPhone', discord: 'Notifications Discord', email: 'E-mails clients' };
const CHANNEL_HINTS = { email: 'Vérifie Resend (clé et domaine). Détail : Santé du site et historique.' };

// Code d'erreur court, sans adresse ni secret (un webhook Discord porte un jeton dans son adresse).
export function errorCode(error) {
  const own = typeof error?.code === 'string' && /^[A-Za-z0-9_:.-]{1,60}$/.test(error.code) ? error.code : null;
  return (own ?? String(error?.message ?? 'erreur')).replace(/https?:\/\/\S+/g, 'adresse').replace(/[^A-Za-z0-9 _:.'’-]/g, '').slice(0, 60) || 'erreur';
}

const channelFailing = (db, channel, code, now) => sql(db, `INSERT INTO channel_health (channel, state, since, failures, last_error)
  VALUES (?, 'failing', ?, 1, ?) ON CONFLICT (channel) DO UPDATE SET
    failures = CASE WHEN channel_health.state = 'failing' THEN channel_health.failures + 1 ELSE 1 END,
    since = CASE WHEN channel_health.state = 'failing' THEN channel_health.since ELSE excluded.since END,
    alerted_at = CASE WHEN channel_health.state = 'failing' THEN channel_health.alerted_at ELSE NULL END,
    state = 'failing', last_error = excluded.last_error
  RETURNING since, alerted_at, failures`, channel, now, code);
const channelOk = (db, channel, now) => sql(db, `INSERT INTO channel_health (channel, state, since, last_ok_at) VALUES (?, 'ok', ?, ?)
  ON CONFLICT (channel) DO UPDATE SET
    since = CASE WHEN channel_health.state = 'failing' THEN excluded.since ELSE channel_health.since END,
    failures = CASE WHEN channel_health.state = 'failing' THEN 0 ELSE channel_health.failures END,
    state = 'ok', last_ok_at = excluded.last_ok_at`, channel, now, now);
const resolveChannelAlerts = (db, channel, now) => sql(db, `UPDATE notifications SET resolved_at = ?
  WHERE kind = 'channel_failure' AND ref >= ? AND ref < ? AND resolved_at IS NULL`, now, `${channel}:`, `${channel};`);
// Envoi réussi par un canal (file ou essai depuis STUDIO) : canal rétabli, alerte ouverte résolue.
export const channelRecovered = (db, channel, now) => [channelOk(db, channel, now), resolveChannelAlerts(db, channel, now)];

function parisWhen(t) {
  const c = parisClock(t);
  return `${c.date.slice(8, 10)}/${c.date.slice(5, 7)} à ${String(c.hour).padStart(2, '0')} h ${String(c.minute).padStart(2, '0')}`;
}

async function alertChannel(db, deps, channel, health, code, now) {
  if (!health || (health.alerted_at !== null && health.alerted_at > now - ALERT_REPEAT)) return;
  const claimed = await batch(db, [sql(db, `UPDATE channel_health SET alerted_at = ? WHERE channel = ? AND state = 'failing'
    AND (alerted_at IS NULL OR alerted_at <= ?)`, now, channel, now - ALERT_REPEAT)]);
  if (!claimed[0].meta.changes) return;
  const again = health.alerted_at !== null;
  await deps.notify({ kind: 'channel_failure', ref: `${channel}:${health.since}${again ? `:${now}` : ''}`, level: 'critical',
    title: `${CHANNEL_TITLES[channel] ?? channel} ${again ? 'toujours ' : ''}en échec`,
    body: `${health.failures} message(s) non remis depuis le ${parisWhen(health.since)}. Cause : ${explainCode(code)}. `
      + (CHANNEL_HINTS[channel] ?? 'Les messages restent dans STUDIO. Diagnostic et essai : Santé du site et historique.'), exclude: [channel] });
}

// Abonnements iPhone expirés pendant un envoi : une notice (jamais par l'iPhone) pour réactiver.
async function noticeExpired(deps, receipt) {
  const expired = receipt?.expired ?? [];
  if (!expired.length || !deps.notify) return;
  await deps.notify({ kind: 'push_device_expired', ref: expired.map((d) => d.fp).sort().join('+').slice(0, 100), level: 'warning',
    title: 'Notifications iPhone à réactiver',
    body: `${expired.length} abonnement(s) refusé(s) par le service de notification (${explainCode(expired[0].code)}). `
      + 'Ouvre STUDIO depuis l’icône de l’iPhone, puis la cloche et « Activer ».', exclude: ['push'] });
}

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
        devices = (await one(db, 'SELECT COUNT(*) AS n FROM push_subscriptions WHERE expired_at IS NULL'))?.n ?? 0;
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
        typeof receipt?.id === 'string' ? receipt.id : null, row.id), ...channelRecovered(db, row.channel, now)]);
      sent += 1;
      await noticeExpired(deps, receipt);
    } catch (error) {
      // Échec ambigu d'un e-mail : peut-être parti ; l'incertitude date de cet essai (ou d'avant).
      const uncertain = email && (since !== null || error?.ambiguous === true) ? (since ?? now) : null;
      const code = errorCode(error);
      if (uncertain !== null && attempts >= EMAIL_MAX_ATTEMPTS) {
        await parkUncertain(db, deps, { ...row, status: 'sending', attempts }, uncertain, 'essais_epuises');
        continue;
      }
      // iPhone sans appareil abonné actif : rien à remettre, ce n'est pas une panne. Ligne close et
      // gardée dans l'historique, sans alerte ni nouvel essai.
      if (!email && error?.noDevice === true) {
        await batch(db, [sql(db, `UPDATE outbox SET status = 'dead', closed_at = ?, close_reason = 'aucun_appareil', last_error = ? WHERE id = ?`,
          now, error.detail ? errorCode({ code: error.detail }) : code, row.id)]);
        await noticeExpired(deps, error);
        continue;
      }
      // Échec certain : rien n'est parti. Demande d'attente (429) : ni abandon ni échec compté.
      // Refus à corriger (permanent : clé, en-tête, webhook supprimé) : abandon sans réessais inutiles.
      const wait = Number.isInteger(error?.retryAfter) ? error.retryAfter : null;
      const dead = uncertain === null && wait === null && (attempts >= maxAttempts || (!email && error?.permanent === true));
      const written = await batch(db, [sql(db, `UPDATE outbox SET status = ?, next_at = ?, uncertain_since = ?, last_error = ?, attempts = attempts - ? WHERE id = ?`,
        dead ? 'dead' : 'pending', now + (wait ?? Math.min(60 * 2 ** attempts, 3600)), uncertain, code, wait === null ? 0 : 1, row.id),
      ...(dead ? [channelFailing(db, row.channel, code, now)] : [])]);
      if (dead && !isMetaAlert(row)) await alertChannel(db, deps, row.channel, written[1]?.results?.[0] ?? null, code, now);
      await noticeExpired(deps, error);
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
// Webhook absent, refusé ou supprimé (400, 401, 403, 404) : refus à corriger, aucun réessai inutile.
// Erreur réseau : code « discord_reseau », jamais l'adresse (elle contient le jeton du webhook).
// Discord n'a pas de clé d'idempotence : une réponse perdue peut, rarement, doubler un message.
const discordError = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });
export function discordSender(env, transport = fetch) {
  return async (message, row = {}) => {
    const url = discordUrl(env, row.route ?? discordRoute(message.kind));
    if (!url) throw discordError('salon_discord_absent', { permanent: true });
    const colors = { info: 0xf0a6bf, warning: 0xf0c674, critical: 0xd9534f };
    let response;
    try {
      response = await transport(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000),
        body: JSON.stringify({ username: 'SAYLESS STUDIO', allowed_mentions: { parse: [] },
          embeds: [{ title: String(message.title).slice(0, 250), description: String(message.body).slice(0, 2000),
            color: colors[message.level] ?? colors.info }] }),
      });
    } catch (error) {
      if (error?.code === 'budget_exhausted') throw error;
      throw discordError('discord_reseau');
    }
    if (response.status === 429) {
      const wait = Number(response.headers.get('Retry-After'));
      throw discordError('discord_429', { retryAfter: Number.isFinite(wait) && wait > 0 ? Math.min(Math.ceil(wait), 3600) : 60 });
    }
    if (!response.ok) throw discordError(`discord_${response.status}`, { permanent: [400, 401, 403, 404].includes(response.status) });
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
  const dead = await one(db, `SELECT COUNT(*) AS n FROM outbox WHERE status = 'dead' AND closed_at IS NULL`);
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
