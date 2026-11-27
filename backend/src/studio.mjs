// Routes métier de SAYLESS STUDIO, appelées par admin.mjs une fois la session vérifiée.
// Lecture : session valide. Écriture sensible (stock, argent, réglages, données personnelles,
// appareils) : confirmation Face ID de moins de 5 minutes (requireStepUp). Tout est journalisé.
// Aucune donnée inventée : un chiffre inconnu est renvoyé `null` et l'écran l'affiche comme tel.
import { all, audit, batch, fail, getSettings, iso, json, one, pad4, sql } from './lib.mjs';
import { piiReady, openPayload, readJson } from './security.mjs';
import { adjustStock, invariants, recordInventory } from './stock.mjs';
import { stripeMode, stripeReady } from './stripe.mjs';
import { currentTerms, publishTerms, termsDocument } from './terms.mjs';
import { exportRecettes, csvSafe, inspectReturn, viewContact } from './operations.mjs';
import { legacyReviewText, recordLegacyLinkSale } from './payments.mjs';
import { configuredChannels, deliverOutbox, discordRouting, emailLabel, reconcileEmail } from './notify.mjs';
import { emailReady } from './email.mjs';
import { intentStatement, pendingIntents, processMailIntents } from './intents.mjs';
import { pushReady, validSubscription } from './push.mjs';
import { listBackups } from './backup.mjs';
import { COST, fits } from './budget.mjs';

const DEFAULT_REFERENCE_TOTAL = 26; // déclaration théorique du DROP 01, jamais imposée au stock
const PAID_LIKE = `('paid', 'paid_no_stock', 'review', 'partially_refunded', 'refunded')`;
const label = (o) => (o.number ? pad4(o.number) : o.reference);
const safeJson = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
const int = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;

// ---------- états de commande vus par STUDIO ----------
const REVIEW_TEXT = {
  address_out_of_zone: 'Adresse saisie sur Stripe hors de la zone livrée',
  contact_not_sealed: 'Coordonnées non enregistrées (clé de chiffrement absente) : adresse à relire dans Stripe',
  payment_mismatch: 'Paiement différent de la commande (montant, devise ou lignes)',
};
const capital = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const reviewText = (o) => capital(o.review_reason ? (REVIEW_TEXT[o.review_reason] ?? legacyReviewText(o.review_reason)) : (o.status === 'paid_no_stock'
  ? 'Payée alors qu’aucune pièce n’était libre' : o.status === 'review' ? 'Paiement à vérifier' : null));

function stage(o) {
  if (['pending', 'awaiting_payment'].includes(o.status)) return { group: 'pending', text: 'Paiement en cours' };
  if (['expired', 'failed'].includes(o.status)) return { group: 'closed', text: 'Abandonnée' };
  if (['review', 'paid_no_stock'].includes(o.status)) return { group: 'review', text: 'À vérifier' };
  if (o.status === 'refunded') return { group: 'ret', text: 'Remboursée' };
  if (o.returned_at || o.tracking === 'returned') return { group: 'ret', text: 'Retour' };
  if (o.delivered_at || o.tracking === 'delivered') return { group: 'done', text: o.shipping_method === 'relay' ? 'Retirée' : 'Livrée' };
  if (o.tracking === 'available_at_relay') return { group: 'way', text: 'Au point relais' };
  if (o.shipped_at || o.tracking === 'in_transit') return { group: 'way', text: 'En route' };
  if (o.source !== 'storefront') return { group: 'confirm', text: 'Envoi à confirmer' };
  return { group: 'prep', text: o.prepared_at ? 'Préparée' : 'À préparer' };
}

const ORDER_SELECT = `SELECT o.*, s.tracking, s.label_status, s.carrier_ref,
    (SELECT MAX(at) FROM order_events e WHERE e.order_id = o.id AND e.kind = 'prepared') AS prepared_at,
    (SELECT MAX(at) FROM order_events e WHERE e.order_id = o.id AND e.kind = 'shipped') AS shipped_at,
    (SELECT MAX(at) FROM order_events e WHERE e.order_id = o.id AND e.kind = 'delivered') AS delivered_at,
    (SELECT MAX(at) FROM order_events e WHERE e.order_id = o.id AND e.kind = 'returned') AS returned_at,
    (SELECT GROUP_CONCAT(COALESCE(v.size, '?') || ':' || oi.quantity, ',') FROM order_items oi LEFT JOIN variants v ON v.sku = oi.sku
      WHERE oi.order_id = o.id) AS sizes
  FROM orders o LEFT JOIN shipments s ON s.order_id = o.id`;

function orderSummary(o) {
  const st = stage(o);
  return { id: o.id, label: label(o), number: o.number, reference: o.reference, status: o.status, group: st.group, stage: st.text,
    source: o.source, shipping: o.shipping_method, total_cents: o.total_cents, refunded_cents: o.amount_refunded_cents,
    paid_at: o.paid_at ? iso(o.paid_at) : null, created_at: iso(o.created_at), customer_name: o.customer_name ?? null,
    sizes: (o.sizes ?? '').split(',').filter(Boolean).map((x) => { const [size, q] = x.split(':'); return { size: size === '?' ? null : size, quantity: Number(q) }; }),
    review: reviewText(o) };
}

async function orderDetail(ctx, id) {
  const o = await one(ctx.db, `${ORDER_SELECT} WHERE o.id = ?`, id);
  if (!o) throw fail('not_found');
  const items = await all(ctx.db, `SELECT oi.sku, oi.quantity, oi.unit_price_cents, v.size, p.name, p.drop_id FROM order_items oi
    JOIN products p ON p.id = oi.product_id LEFT JOIN variants v ON v.sku = oi.sku WHERE oi.order_id = ? ORDER BY oi.line`, id);
  const events = await all(ctx.db, 'SELECT kind, detail, actor, at FROM order_events WHERE order_id = ? ORDER BY at, id', id);
  const refunds = await all(ctx.db, 'SELECT amount_cents, created_at FROM refunds WHERE order_id = ? ORDER BY created_at', id);
  const contact = await one(ctx.db, 'SELECT archived_at FROM order_contacts WHERE order_id = ?', id);
  const returns = await all(ctx.db, 'SELECT sku, quantity, resellable, at FROM return_checks WHERE order_id = ?', id);
  const held = await one(ctx.db, `SELECT -d_on_hand AS q FROM stock_movements WHERE ref = ? AND reason = 'legacy_link_sale'`, `link:${o.stripe_session_id}`);
  const fee = o.stripe_fee_cents;
  return { ...orderSummary(o), relay: safeJson(o.relay_snapshot) ?? (o.relay_id ? { id: o.relay_id, name: o.relay_label } : null),
    items: items.map((i) => ({ sku: i.sku, size: i.size ?? null, quantity: i.quantity, unit_price_cents: i.unit_price_cents, name: i.name })),
    subtotal_cents: o.subtotal_cents, shipping_cents: o.shipping_cents, fee_cents: fee ?? null,
    net_cents: fee === null || fee === undefined ? null : o.total_cents - fee - o.amount_refunded_cents,
    refunds: refunds.map((r) => ({ amount_cents: r.amount_cents, at: iso(r.created_at) })),
    events: events.map((e) => ({ kind: e.kind, detail: safeJson(e.detail), at: iso(e.at) })),
    shipment: o.label_status ? { label_status: o.label_status, tracking: o.tracking, carrier_ref: o.carrier_ref } : null,
    contact: contact ? { stored: true, archived: Boolean(contact.archived_at) } : { stored: false, archived: false },
    returns: returns.map((r) => ({ sku: r.sku, quantity: r.quantity, resellable: Boolean(r.resellable), at: iso(r.at) })),
    held_quantity: held?.q ?? 0, terms_version: o.terms_version ?? null,
    actions: {
      resolve: ['review', 'paid_no_stock'].includes(o.status),
      restore_piece: o.status === 'review' && o.source === 'legacy_link' && (held?.q ?? 0) > 0,
      fulfil: ['paid', 'partially_refunded'].includes(o.status),
      refund: ['paid', 'paid_no_stock', 'review', 'partially_refunded'].includes(o.status) && Boolean(o.stripe_payment_intent)
        && o.amount_refunded_cents < o.total_cents,
      // Contrôle d'un retour : seulement pour un colis parti (ou revenu), jamais avant l'expédition.
      // Annulation remboursée avant envoi : la pièce, jamais partie, peut aussi être remise en stock après contrôle.
      return_check: ['paid', 'refunded', 'partially_refunded'].includes(o.status) && items.some((i) => i.sku)
        && Boolean(o.shipped_at || o.returned_at || ['in_transit', 'available_at_relay', 'delivered', 'returned'].includes(o.tracking)
          || ['refunded', 'partially_refunded'].includes(o.status)),
    } };
}

// ---------- prérequis d'ouverture des ventes ----------
export async function readiness(ctx, deps) {
  const settings = await getSettings(ctx.db);
  const unverified = (await one(ctx.db, `SELECT COUNT(*) AS n FROM products p JOIN variants v ON v.product_id = p.id
    LEFT JOIN inventory i ON i.sku = v.sku WHERE p.status = 'published' AND (i.sku IS NULL OR i.confirmed_at IS NULL)`)).n;
  const published = (await one(ctx.db, `SELECT COUNT(*) AS n FROM products WHERE status = 'published'`)).n;
  const rates = (await one(ctx.db, 'SELECT COUNT(*) AS n FROM shipping_rates')).n;
  const terms = await termsDocument(ctx.db);
  const production = ctx.ENVIRONMENT === 'production';
  const turnstile = Boolean(ctx.TURNSTILE_SECRET) || (!production && ctx.TURNSTILE_BYPASS === 'test-only');
  const checks = [
    { id: 'inventory', ok: published > 0 && unverified === 0, blocker: true, text: published ? (unverified ? `${unverified} taille(s) sans inventaire confirmé` : 'Inventaire confirmé pour toutes les tailles en ligne') : 'Aucun produit en ligne' },
    { id: 'terms', ok: Boolean(terms?.intact), blocker: true, text: terms?.intact ? `CGV ${terms.version} publiées (empreinte ${terms.sha256.slice(0, 8)})`
      : terms ? `CGV ${terms.version} : texte différent de son empreinte` : 'CGV à publier (version et texte)' },
    { id: 'pii', ok: await piiReady(ctx), blocker: true, text: (await piiReady(ctx)) ? 'Chiffrement des coordonnées actif' : 'Clé de chiffrement des coordonnées à saisir' },
    { id: 'stripe', ok: stripeReady(ctx), blocker: true, text: stripeReady(ctx) ? `Stripe en mode ${stripeMode(ctx) === 'live' ? 'réel' : 'test'}` : 'Clés Stripe et secret du webhook à saisir (mode adapté à l’environnement)' },
    { id: 'turnstile', ok: turnstile, blocker: true, text: ctx.TURNSTILE_SECRET ? 'Contrôle anti-abus actif' : turnstile ? 'Contrôle anti-abus simulé (test uniquement)' : 'Clé Turnstile à saisir' },
    { id: 'origin', ok: Boolean(ctx.PUBLIC_ORIGIN && ctx.APP_SECRET), blocker: true, text: ctx.PUBLIC_ORIGIN ? `Boutique : ${ctx.PUBLIC_ORIGIN}` : 'Adresse de la boutique à configurer' },
    { id: 'rates', ok: rates > 0, blocker: true, text: rates ? 'Tarifs de livraison enregistrés' : 'Tarifs de livraison manquants' },
    { id: 'relays', ok: Boolean(deps.relays), blocker: false, text: deps.relays ? 'Points relais raccordés' : 'Transporteur non raccordé : livraison à domicile seulement' },
    { id: 'email', ok: emailReady(ctx), blocker: false, text: emailReady(ctx) ? 'E-mails clients actifs' : 'E-mails clients à configurer (Resend)' },
    { id: 'backups', ok: Boolean(ctx.BACKUPS && ctx.BACKUP_PUBLIC_KEY), blocker: false, text: ctx.BACKUP_PUBLIC_KEY ? 'Sauvegarde chiffrée configurée' : 'Sauvegarde chiffrée à configurer' },
    { id: 'legacy', ok: Boolean(settings.legacy_payment_link_id && settings.legacy_link_price_id), blocker: false, text: settings.legacy_payment_link_id ? 'Lien 1.0 reconnu' : 'Lien de paiement 1.0 à enregistrer' },
  ];
  return { ready: checks.every((c) => c.ok || !c.blocker), checks };
}

// ---------- drop courant et bande des pièces ----------
async function dropView(ctx, dropId) {
  const drop = await one(ctx.db, 'SELECT * FROM drops WHERE id = ?', dropId);
  const product = await one(ctx.db, `SELECT id, name, price_cents, status FROM products WHERE drop_id = ? ORDER BY CASE status WHEN 'published' THEN 0 ELSE 1 END, id LIMIT 1`, dropId);
  const variants = await all(ctx.db, `SELECT v.sku, v.size, i.on_hand, i.reserved, i.confirmed_at FROM products p JOIN variants v ON v.product_id = p.id
    JOIN inventory i ON i.sku = v.sku WHERE p.drop_id = ? ORDER BY p.id, v.position`, dropId);
  const soldRows = await all(ctx.db, `SELECT oi.sku, v.size, SUM(oi.quantity) AS q FROM order_items oi JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id LEFT JOIN variants v ON v.sku = oi.sku
    WHERE p.drop_id = ? AND o.paid_at IS NOT NULL AND o.status IN ('paid', 'paid_no_stock', 'review', 'partially_refunded') GROUP BY oi.sku`, dropId);
  const sold = soldRows.reduce((n, r) => n + r.q, 0);
  const confirmed = variants.length > 0 && variants.every((v) => v.confirmed_at !== null);
  const available = variants.reduce((n, v) => n + Math.max(v.on_hand - v.reserved, 0), 0);
  const reserved = variants.reduce((n, v) => n + v.reserved, 0);
  const count = await one(ctx.db, 'SELECT promised, damaged, unshipped, at FROM inventory_counts WHERE drop_id IS ? ORDER BY at DESC, id DESC LIMIT 1', dropId);
  const setAside = count ? count.promised + count.damaged : 0;
  const gifted = drop?.gifted_total ?? 0;
  const received = drop?.received_total ?? null;
  const reference = drop?.reference_total ?? (dropId === 'drop-01' ? DEFAULT_REFERENCE_TOTAL : null);
  const bars = [{ kind: 'sold', n: sold }, { kind: 'gift', n: gifted }];
  let gap = null;
  if (confirmed) {
    bars.push({ kind: 'held', n: reserved }, { kind: 'available', n: available }, { kind: 'aside', n: setAside });
    if (received !== null) {
      gap = received - (sold + gifted + reserved + available + setAside);
      if (gap > 0) bars.push({ kind: 'gap', n: gap });
    }
  } else {
    bars.push({ kind: 'todo', n: received !== null ? Math.max(received - sold - gifted, 0) : (reference ?? 0) });
  }
  return { id: dropId, name: drop?.name ?? dropId, product: product ? { id: product.id, name: product.name, price_cents: product.price_cents, status: product.status } : null,
    received_total: received, gifted_total: drop?.gifted_total ?? null, reference_total: reference, confirmed, sold, available, reserved,
    set_aside: setAside, gap, bars: bars.filter((b) => b.n > 0),
    sizes: variants.map((v) => ({ sku: v.sku, size: v.size, confirmed: v.confirmed_at !== null, on_hand: v.on_hand, reserved: v.reserved,
      available: Math.max(v.on_hand - v.reserved, 0), sold: soldRows.find((r) => r.sku === v.sku)?.q ?? 0 })),
    sold_unknown_size: soldRows.filter((r) => !r.sku).reduce((n, r) => n + r.q, 0), last_count: count ? { ...count, at: iso(count.at) } : null };
}
async function currentDropId(ctx) {
  return (await one(ctx.db, `SELECT drop_id FROM products ORDER BY CASE status WHEN 'published' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, id LIMIT 1`))?.drop_id ?? null;
}

// ---------- finances (chiffres réels de la base ; frais Stripe inconnus signalés) ----------
async function financeView(ctx, deps) {
  const settings = await getSettings(ctx.db);
  const rows = await all(ctx.db, `SELECT paid_at, total_cents, stripe_fee_cents, amount_refunded_cents FROM orders
    WHERE paid_at IS NOT NULL AND status IN ${PAID_LIKE} ORDER BY paid_at`);
  const collected = rows.reduce((n, r) => n + r.total_cents, 0);
  const fees = rows.reduce((n, r) => n + (r.stripe_fee_cents ?? 0), 0);
  const unknownFees = rows.filter((r) => r.stripe_fee_cents === null).length;
  const refunds = rows.reduce((n, r) => n + r.amount_refunded_cents, 0);
  const net = collected - fees - refunds;
  const investment = settings.investment_cents === '' ? null : Number(settings.investment_cents);
  const rate = settings.contribution_rate_bp === '' ? null : Number(settings.contribution_rate_bp);
  let cumulative = 0;
  const months = new Map();
  for (const r of rows) {
    cumulative += r.total_cents - (r.stripe_fee_cents ?? 0) - r.amount_refunded_cents;
    months.set(iso(r.paid_at).slice(0, 7), cumulative);
  }
  let stripe = null;
  if (deps.stripe?.retrieveBalance) {
    try {
      const balance = await deps.stripe.retrieveBalance();
      const sum = (list) => (list ?? []).filter((x) => x.currency === 'eur').reduce((n, x) => n + x.amount, 0);
      stripe = { available_cents: sum(balance.available), pending_cents: sum(balance.pending) };
    } catch {
      stripe = null;
    }
  }
  return { sales: rows.length, collected_cents: collected, fees_cents: fees, fees_unknown: unknownFees, refunds_cents: refunds, net_cents: net,
    investment_cents: investment, recovered_ratio: investment ? net / investment : null,
    remaining_cents: investment !== null ? Math.max(investment - net, 0) : null,
    contribution_rate_bp: rate, contribution_estimate_cents: rate !== null ? Math.round((collected - refunds) * rate / 10000) : null,
    cumulative: [...months].map(([month, cents]) => ({ month, net_cents: cents })), stripe };
}

// Sauvegardes : en erreur, en retard (aucune copie vérifiée depuis 36 h), à jour, en attente de la
// première copie (après 3 h, heure de Paris), ou à configurer.
function backupCheck({ error, verified, now, configured, kept }) {
  const name = 'Sauvegardes';
  if (error) return { name, state: 'alert', detail: `Dernière erreur : ${error}` };
  if (verified && now - verified > 36 * 3600) return { name, state: 'alert', detail: `Aucune copie vérifiée depuis le ${iso(verified).slice(0, 10)}` };
  if (verified) return { name, state: 'ok', detail: `Dernière copie vérifiée : ${iso(verified).slice(0, 10)}${kept === null ? '' : ` ; ${kept} copie(s) conservée(s)`}` };
  if (configured) return { name, state: 'wait', detail: 'Configurées ; première copie après 3 h du matin' };
  return { name, state: 'todo', detail: 'Clé publique et espace à configurer' };
}

async function readJsonBody(request, size) {
  return readJson(request, size);
}

// Salons Discord : destinations effectives, jamais les adresses des webhooks.
function discordCheck(ctx) {
  const routes = discordRouting(ctx);
  const names = { commandes: 'commandes', expeditions: 'expéditions', retours: 'retours', stock: 'stock', finances: 'finances', rapport: 'rapport quotidien',
    alertes: 'alertes', securite: 'sécurité', site: 'état du site', sauvegardes: 'sauvegardes' };
  const of = (target) => routes.filter((r) => r.target === target).map((r) => names[r.route]);
  const [own, shared, none] = [of('dedicated'), of('shared'), of('none')];
  if (!own.length && !shared.length) return { name: 'Notifications Discord', state: 'todo', detail: 'Webhooks des salons privés à saisir' };
  return { name: 'Notifications Discord', state: 'ok', detail: [own.length ? `Salons dédiés : ${own.join(', ')}` : null,
    shared.length ? `${own.length ? 'Autres salons' : 'Tous les salons'} par le webhook unique` : null,
    none.length ? `Sans destination Discord : ${none.join(', ')}` : null].filter(Boolean).join(' ; ') };
}

export async function handleStudio(request, ctx, { route, url, session, settings, requireStepUp, deps, now, config }) {
  const path = url.pathname.replace(/\/+$/, '');
  const orderMatch = path.match(/^\/api\/admin\/orders\/([0-9a-f-]{36})(\/[a-z-]+)?$/);
  if (orderMatch) return orderRoutes(request, ctx, { method: request.method, id: orderMatch[1], action: orderMatch[2] ?? '', requireStepUp, deps, now });

  switch (route) {
    // ---- Aujourd'hui ----
    case 'GET /api/admin/overview': {
      const dropId = await currentDropId(ctx);
      const counts = await one(ctx.db, `SELECT
          SUM(CASE WHEN status IN ('review', 'paid_no_stock') THEN 1 ELSE 0 END) AS review,
          SUM(CASE WHEN status IN ('pending', 'awaiting_payment') THEN 1 ELSE 0 END) AS paying
        FROM orders`);
      const toShip = await all(ctx.db, `${ORDER_SELECT} WHERE o.status IN ('paid', 'partially_refunded')`);
      const pendingShip = toShip.filter((o) => ['prep', 'confirm'].includes(stage(o).group));
      const unread = (await one(ctx.db, 'SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL')).n;
      const critical = (await one(ctx.db, `SELECT COUNT(*) AS n FROM notifications WHERE level = 'critical' AND resolved_at IS NULL AND read_at IS NULL`)).n;
      const latest = await all(ctx.db, 'SELECT id, kind, level, title, at, read_at FROM notifications ORDER BY at DESC, id DESC LIMIT 4');
      const ready = await readiness(ctx, deps);
      const drop = dropId ? await dropView(ctx, dropId) : null;
      const finance = await financeView(ctx, { stripe: null });
      const todo = [];
      if (drop && !drop.confirmed) todo.push({ id: 'inventory', title: 'Compter les pièces par taille', detail: 'Inventaire guidé, environ 20 minutes', screen: 'inventory' });
      if (counts.review) todo.push({ id: 'review', title: `Vérifier ${counts.review} commande${counts.review > 1 ? 's' : ''}`, detail: 'Décision à prendre avant toute préparation', screen: 'orders', filter: 'review' });
      const prep = pendingShip.filter((o) => stage(o).group === 'prep').length;
      const confirm = pendingShip.length - prep;
      if (prep) todo.push({ id: 'prep', title: `Préparer ${prep} commande${prep > 1 ? 's' : ''}`, detail: 'Payée(s), pas encore expédiée(s)', screen: 'orders', filter: 'prep' });
      if (confirm) todo.push({ id: 'confirm', title: `Confirmer l’envoi de ${confirm} commande${confirm > 1 ? 's' : ''}`, detail: 'Venues du lien 1.0 ou importées, statut d’envoi inconnu', screen: 'orders', filter: 'confirm' });
      if (!settings.legacy_payment_link_id) todo.push({ id: 'legacy', title: 'Enregistrer le lien de paiement 1.0', detail: 'Pour reconnaître ses ventes sans erreur', screen: 'settings' });
      if (drop?.confirmed && settings.legacy_payment_link_id) todo.push({ id: 'stripe_limit', title: 'Valider la limite du lien 1.0 chez Stripe', detail: `Proposition : ${drop.available + 2} paiements (2 déjà comptés + pièces libres). À faire par toi dans Stripe.`, wait: true });
      const blockers = ready.checks.filter((c) => c.blocker && !c.ok).length;
      if (settings.shop_mode !== 'open' && blockers) todo.push({ id: 'readiness', title: 'Préparer l’ouverture de la boutique 2.0', detail: `${blockers} étape${blockers > 1 ? 's' : ''} restante${blockers > 1 ? 's' : ''}`, screen: 'health' });
      return json({ now: iso(now), shop: { mode: settings.shop_mode, payments_enabled: settings.payments_enabled === '1' },
        drop, todo, notifications: { unread, critical, latest: latest.map((n) => ({ ...n, at: iso(n.at), read: Boolean(n.read_at) })) },
        finance: { net_cents: finance.net_cents, collected_cents: finance.collected_cents, investment_cents: finance.investment_cents,
          recovered_ratio: finance.recovered_ratio, fees_unknown: finance.fees_unknown }, paying: counts.paying ?? 0 });
    }

    // ---- commandes ----
    case 'GET /api/admin/orders': {
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 60);
      const rows = await all(ctx.db, `${ORDER_SELECT} WHERE o.paid_at IS NOT NULL OR o.status IN ('review', 'paid_no_stock')
        ORDER BY COALESCE(o.paid_at, o.created_at) DESC LIMIT 500`);
      const list = rows.map(orderSummary).filter((o) => !q || o.label.toLowerCase().includes(q.replace(/^0+/, ''))
        || o.reference.toLowerCase().includes(q) || (o.customer_name ?? '').toLowerCase().includes(q));
      const counts = list.reduce((acc, o) => ({ ...acc, [o.group]: (acc[o.group] ?? 0) + 1 }), {});
      const paying = (await one(ctx.db, `SELECT COUNT(*) AS n FROM orders WHERE status IN ('pending', 'awaiting_payment')`)).n;
      return json({ orders: list, counts: { all: list.length, ...counts }, paying });
    }

    // ---- stock ----
    case 'GET /api/admin/stock': {
      const dropId = await currentDropId(ctx);
      const movements = await all(ctx.db, 'SELECT reason, COUNT(*) AS n, SUM(d_on_hand) AS d FROM stock_movements GROUP BY reason');
      const returnsPending = (await one(ctx.db, `SELECT COUNT(*) AS n FROM shipments s WHERE s.tracking = 'returned'
        AND NOT EXISTS (SELECT 1 FROM return_checks r WHERE r.order_id = s.order_id)`)).n
        + (await one(ctx.db, `SELECT COUNT(*) AS n FROM order_events e WHERE e.kind = 'returned'
        AND NOT EXISTS (SELECT 1 FROM return_checks r WHERE r.order_id = e.order_id)`)).n;
      return json({ drop: dropId ? await dropView(ctx, dropId) : null, low_stock_threshold: Number(settings.low_stock_threshold || 2),
        returns_pending: returnsPending, movements: movements.map((m) => ({ reason: m.reason, count: m.n, delta: m.d })),
        problems: await invariants(ctx.db) });
    }
    case 'GET /api/admin/stock/movements': {
      const before = Number(url.searchParams.get('before') ?? 0) || Number.MAX_SAFE_INTEGER;
      const rows = await all(ctx.db, `SELECT m.id, m.sku, v.size, m.d_on_hand, m.d_reserved, m.reason, m.note, m.actor, m.at FROM stock_movements m
        LEFT JOIN variants v ON v.sku = m.sku WHERE m.id < ? ORDER BY m.id DESC LIMIT 50`, before);
      return json({ movements: rows.map((m) => ({ ...m, at: iso(m.at) })), next: rows.length === 50 ? rows.at(-1).id : null });
    }
    case 'POST /api/admin/stock/adjust': {
      const body = await readJsonBody(request);
      requireStepUp();
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';
      if (!int(body.delta, -50, 50) || body.delta === 0 || note.length < 3) throw fail('invalid_request');
      const row = await adjustStock(ctx.db, { sku: String(body.sku ?? ''), delta: body.delta, expectedRevision: body.expected_revision, actor: 'fondateur', note, now });
      return json({ variant: row });
    }

    // ---- inventaire guidé ----
    case 'GET /api/admin/inventory':
      return json(await inventoryView(ctx));
    case 'POST /api/admin/inventory': {
      const body = await readJsonBody(request);
      requireStepUp();
      const counts = body.counts ?? {};
      const aside = body.set_aside ?? {};
      for (const v of [...Object.values(counts), aside.unshipped ?? 0, aside.promised ?? 0, aside.damaged ?? 0]) {
        if (!int(v, 0, 10000)) throw fail('invalid_request');
      }
      const view = await inventoryView(ctx);
      const counted = Object.values(counts).reduce((n, v) => n + v, 0);
      const reference = view.reference_total;
      const gap = reference === null ? null : counted + (aside.promised ?? 0) + (aside.damaged ?? 0) - reference;
      const note = `Inventaire guidé : à vendre ${counted} ; payées non expédiées ${aside.unshipped ?? 0} ; promises ${aside.promised ?? 0} ; abîmées ${aside.damaged ?? 0}${gap === null ? '' : ` ; écart avec ${reference} théoriques ${gap >= 0 ? '+' : ''}${gap}`}.`;
      await recordInventory(ctx.db, { counts, expected: body.expected ?? {}, actor: 'fondateur', note, now });
      await batch(ctx.db, [sql(ctx.db, `INSERT INTO inventory_counts (drop_id, counted, unshipped, promised, damaged, reference_total, actor, at)
        VALUES (?, ?, ?, ?, ?, ?, 'fondateur', ?)`, view.drop_id, counted, aside.unshipped ?? 0, aside.promised ?? 0, aside.damaged ?? 0, reference, now)]);
      return json({ ...(await inventoryView(ctx)), gap, stripe_limit_proposal: 2 + counted });
    }

    // ---- finances et exports ----
    case 'GET /api/admin/finances':
      return json(await financeView(ctx, deps));
    case 'POST /api/admin/finances/settings': {
      const body = await readJsonBody(request);
      requireStepUp();
      const statements = [];
      if (body.investment_cents !== undefined) {
        if (body.investment_cents !== null && !int(body.investment_cents, 0, 100_000_000)) throw fail('invalid_request');
        statements.push(sql(ctx.db, `UPDATE settings SET value = ? WHERE key = 'investment_cents'`, body.investment_cents === null ? '' : String(body.investment_cents)));
      }
      if (body.contribution_rate_bp !== undefined) {
        if (body.contribution_rate_bp !== null && !int(body.contribution_rate_bp, 0, 5000)) throw fail('invalid_request');
        statements.push(sql(ctx.db, `UPDATE settings SET value = ? WHERE key = 'contribution_rate_bp'`, body.contribution_rate_bp === null ? '' : String(body.contribution_rate_bp)));
      }
      if (!statements.length) throw fail('invalid_request');
      statements.push(audit(ctx.db, now, 'fondateur', 'finance_settings', null, 'ok'));
      await batch(ctx.db, statements);
      return json(await financeView(ctx, deps));
    }
    case 'POST /api/admin/exports/recettes': {
      await readJsonBody(request);
      requireStepUp();
      const { csv, sha256 } = await exportRecettes(ctx, 'fondateur', deps);
      return json({ filename: `sayless-livre-des-recettes-${iso(now).slice(0, 10)}.csv`, csv, sha256 });
    }
    case 'POST /api/admin/exports/orders': {
      await readJsonBody(request);
      requireStepUp();
      const rows = (await all(ctx.db, `${ORDER_SELECT} WHERE o.paid_at IS NOT NULL ORDER BY o.paid_at`)).map(orderSummary);
      const money = (c) => (c / 100).toFixed(2).replace('.', ',');
      const lines = [['Numéro', 'Référence', 'Date', 'Origine', 'Livraison', 'Tailles', 'Montant TTC (€)', 'Remboursé (€)', 'État'],
        ...rows.map((o) => [o.label, o.reference, (o.paid_at ?? '').slice(0, 10), o.source === 'storefront' ? 'Boutique' : o.source === 'legacy_link' ? 'Lien 1.0' : 'Import',
          o.shipping === 'relay' ? 'Point relais' : o.shipping === 'home' ? 'Domicile' : '', o.sizes.map((x) => `${x.size ?? '?'}×${x.quantity}`).join(' '),
          money(o.total_cents), money(o.refunded_cents), o.stage])];
      const csv = `﻿${lines.map((l) => l.map((v) => (/^-?\d+,\d{2}$/.test(v) ? v : csvSafe(v))).join(';')).join('\r\n')}\r\n`;
      await batch(ctx.db, [audit(ctx.db, now, 'fondateur', 'export_orders', `${rows.length} lignes`, 'ok')]);
      return json({ filename: `sayless-commandes-${iso(now).slice(0, 10)}.csv`, csv });
    }

    // ---- notifications ----
    case 'GET /api/admin/notifications': {
      const before = Number(url.searchParams.get('before') ?? 0) || Number.MAX_SAFE_INTEGER;
      const rows = await all(ctx.db, 'SELECT id, kind, ref, level, title, body, at, read_at, resolved_at FROM notifications WHERE id < ? ORDER BY id DESC LIMIT 50', before);
      const unread = (await one(ctx.db, 'SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL')).n;
      const devices = (await one(ctx.db, 'SELECT COUNT(*) AS n FROM push_subscriptions')).n;
      const channels = configuredChannels(ctx);
      return json({ notifications: rows.map((n) => ({ ...n, at: iso(n.at), read: Boolean(n.read_at), resolved: Boolean(n.resolved_at),
        order_id: /^[0-9a-f-]{36}$/.test(n.ref) ? n.ref : null })), unread, next: rows.length === 50 ? rows.at(-1).id : null,
      channels: { discord: channels.includes('discord'), push: { configured: pushReady(ctx), devices, public_key: pushReady(ctx) ? ctx.VAPID_PUBLIC_KEY : null },
        email: emailReady(ctx) }, report_hour: 10 });
    }
    case 'POST /api/admin/notifications/read': {
      const body = await readJsonBody(request);
      const ids = Array.isArray(body.ids) ? body.ids.filter((x) => int(x, 1, Number.MAX_SAFE_INTEGER)).slice(0, 100) : [];
      if (body.all === true) await batch(ctx.db, [sql(ctx.db, 'UPDATE notifications SET read_at = ? WHERE read_at IS NULL', now)]);
      else if (ids.length) await batch(ctx.db, ids.map((id) => sql(ctx.db, 'UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ?', now, id)));
      else throw fail('invalid_request');
      return json({ unread: (await one(ctx.db, 'SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL')).n });
    }
    case 'POST /api/admin/notifications/resolve': {
      const body = await readJsonBody(request);
      if (!int(body.id, 1, Number.MAX_SAFE_INTEGER)) throw fail('invalid_request');
      await batch(ctx.db, [sql(ctx.db, 'UPDATE notifications SET resolved_at = COALESCE(resolved_at, ?), read_at = COALESCE(read_at, ?) WHERE id = ?', now, now, body.id),
        audit(ctx.db, now, 'fondateur', 'notification_resolved', String(body.id), 'ok')]);
      return json({ resolved: true });
    }
    case 'POST /api/admin/push/subscribe': {
      const body = await readJsonBody(request);
      if (!pushReady(ctx)) throw fail('not_configured');
      const sub = validSubscription(body);
      if (!sub) throw fail('invalid_request');
      const labelText = typeof body.label === 'string' ? body.label.slice(0, 40) : 'iPhone';
      await batch(ctx.db, [sql(ctx.db, `INSERT INTO push_subscriptions (endpoint, p256dh, auth, label, created_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, failures = 0`, sub.endpoint, sub.p256dh, sub.auth, labelText, now),
      audit(ctx.db, now, 'fondateur', 'push_subscribed', labelText, 'ok')]);
      return json({ subscribed: true });
    }
    case 'POST /api/admin/push/unsubscribe': {
      const body = await readJsonBody(request);
      if (typeof body.endpoint !== 'string') throw fail('invalid_request');
      await batch(ctx.db, [sql(ctx.db, 'DELETE FROM push_subscriptions WHERE endpoint = ?', body.endpoint)]);
      return json({ subscribed: false });
    }

    // ---- santé et historique ----
    case 'GET /api/admin/health': {
      const ready = await readiness(ctx, deps);
      const lastEvent = (await one(ctx.db, 'SELECT MAX(at) AS t FROM processed_events')).t;
      const dead = (await one(ctx.db, `SELECT COUNT(*) AS n FROM outbox WHERE status = 'dead'`)).n;
      const queued = (await one(ctx.db, `SELECT COUNT(*) AS n FROM outbox WHERE status IN ('pending', 'sending')`)).n;
      // E-mails à rapprocher (V14-R1) : référence de commande ou de demande seulement, aucune adresse.
      const uncertain = (await all(ctx.db, `SELECT o.id, o.dedupe, o.first_attempt_at, o.last_attempt_at, o.attempts, o.provider_ref, o.last_error,
        (SELECT reference FROM orders WHERE id = substr(o.dedupe, instr(substr(o.dedupe, 7), ':') + 7)) AS reference
        FROM outbox o WHERE o.status = 'uncertain' ORDER BY o.id LIMIT 20`)).map((r) => ({ id: r.id, label: emailLabel(r.dedupe).replace(/ [^ ]+$/, ''),
        reference: r.reference ?? null, first_attempt_at: r.first_attempt_at ? iso(r.first_attempt_at) : null, last_attempt_at: r.last_attempt_at ? iso(r.last_attempt_at) : null,
        attempts: r.attempts, provider_ref: r.provider_ref, reason: r.last_error }));
      const stuck = await pendingIntents(ctx.db, now); // e-mails clients pas encore mis en file depuis 10 min
      const cron = Number(settings.cron_last_run || 0);
      const backups = ctx.BACKUPS ? await listBackups(ctx.BACKUPS).catch(() => null) : null;
      const verified = Number(settings.backup_last_verified_at || 0);
      const problems = await invariants(ctx.db);
      const checks = [
        { name: 'Boutique 2.0', state: settings.shop_mode === 'open' ? 'ok' : 'wait', detail: settings.shop_mode === 'open' ? 'Ouverte aux achats' : 'En pause (aucun paiement possible)' },
        { name: 'Base de données', state: problems.length ? 'alert' : 'ok', detail: problems.length ? `${problems.length} écart(s) de stock : ${problems[0]}` : 'Joignable ; stock égal au registre' },
        { name: 'Tâches automatiques', state: cron && now - cron < 300 ? 'ok' : 'alert', detail: cron ? `Dernier passage il y a ${Math.round((now - cron) / 60)} min` : 'Aucun passage enregistré' },
        { name: 'Paiement Stripe', state: stripeReady(ctx) ? 'ok' : 'todo', detail: stripeReady(ctx) ? `Mode ${stripeMode(ctx) === 'live' ? 'réel' : 'test'}${lastEvent ? `, dernier événement ${iso(lastEvent).slice(0, 16).replace('T', ' ')} UTC` : ', aucun événement reçu'}` : 'Clés à saisir' },
        discordCheck(ctx),
        { name: 'Notifications iPhone', state: pushReady(ctx) ? 'ok' : 'todo', detail: pushReady(ctx) ? 'Clés configurées' : 'Clés VAPID à saisir' },
        { name: 'E-mails clients', state: emailReady(ctx) ? 'ok' : 'todo', detail: emailReady(ctx) ? `Expéditeur ${ctx.EMAIL_FROM}` : 'Resend et domaine vérifié à configurer' },
        { name: 'File d’envoi', state: dead || stuck || uncertain.length ? 'alert' : 'ok', detail: [dead ? `${dead} message(s) non distribué(s)` : `${queued} message(s) en attente`,
          ...(uncertain.length ? [`${uncertain.length} e-mail(s) client à vérifier dans Resend (voir plus bas)`] : []),
          ...(stuck ? [`${stuck} e-mail(s) client à mettre en file (nouvel essai automatique)`] : [])].join(' ; ') },
        backupCheck({ error: settings.backup_last_error, verified, now, configured: Boolean(ctx.BACKUPS && ctx.BACKUP_PUBLIC_KEY), kept: backups?.length ?? null }),
        { name: 'Conservation des données', state: settings.retention_enabled === '1' ? 'ok' : 'wait', detail: settings.retention_enabled === '1' ? 'Purge automatique active' : 'Purge coupée, en attente de ta validation des durées' },
      ];
      return json({ checks, readiness: ready, uncertain, environment: ctx.ENVIRONMENT ?? 'local', origins: { shop: ctx.PUBLIC_ORIGIN ?? null, studio: config.origin } });
    }
    // Rapprochement d'un e-mail « à vérifier » : décision du fondateur après contrôle dans Resend.
    // « delivered » clôt la ligne ; « resend » la renvoie (même clé d'idempotence). Face ID requis.
    case 'POST /api/admin/outbox/reconcile': {
      requireStepUp();
      const body = await readJsonBody(request);
      if (!Number.isInteger(body.id) || !['delivered', 'resend'].includes(body.decision)) throw fail('invalid_request');
      if (!(await reconcileEmail(ctx.db, body.id, body.decision, now))) throw fail('not_found');
      await batch(ctx.db, [audit(ctx.db, now, 'fondateur', 'email_reconciled', `outbox:${body.id}`, body.decision)]);
      if (body.decision === 'resend') await deliverOutbox(ctx, deps.senders, deps, { only: (await one(ctx.db, 'SELECT dedupe FROM outbox WHERE id = ?', body.id)).dedupe });
      return json({ ok: true, decision: body.decision });
    }
    // Copies chiffrées : liste, et téléchargement (copie hors ligne hebdomadaire). Illisibles sans
    // la clé privée du fondateur ; le téléchargement est tout de même confirmé par Face ID et noté.
    case 'GET /api/admin/backups': {
      if (!ctx.BACKUPS) return json({ configured: false, backups: [] });
      const list = await listBackups(ctx.BACKUPS);
      return json({ configured: Boolean(ctx.BACKUP_PUBLIC_KEY), backups: list.sort((a, b) => b.name.localeCompare(a.name))
        .map((x) => ({ name: x.name, created_at: x.created_at ? iso(x.created_at) : null, bytes: x.bytes ?? null, checks: x.checks ?? null, rows: x.rows ?? null })) });
    }
    case 'POST /api/admin/backups/download': {
      const body = await readJsonBody(request);
      requireStepUp();
      if (!ctx.BACKUPS || typeof body.name !== 'string' || !/^(daily\/\d{4}-\d{2}-\d{2}|monthly\/\d{4}-\d{2})$/.test(body.name)) throw fail('invalid_request');
      const sealed = await ctx.BACKUPS.get(body.name);
      if (sealed === null) throw fail('not_found');
      await batch(ctx.db, [audit(ctx.db, now, 'fondateur', 'backup_downloaded', body.name, 'ok')]);
      return json({ filename: `sayless-sauvegarde-${body.name.replace('/', '-')}.json`, content: sealed });
    }
    case 'GET /api/admin/audit': {
      const before = Number(url.searchParams.get('before') ?? 0) || Number.MAX_SAFE_INTEGER;
      const rows = await all(ctx.db, 'SELECT id, at, actor, action, target, result FROM audit_log WHERE id < ? ORDER BY id DESC LIMIT 50', before);
      return json({ entries: rows.map((r) => ({ ...r, at: iso(r.at) })), next: rows.length === 50 ? rows.at(-1).id : null });
    }

    // ---- réglages ----
    case 'GET /api/admin/settings':
      return json(await settingsView(ctx, session, deps));
    case 'POST /api/admin/settings': {
      const body = await readJsonBody(request);
      requireStepUp();
      const statements = [];
      if (body.low_stock_threshold !== undefined) {
        if (!int(body.low_stock_threshold, 0, 20)) throw fail('invalid_request');
        statements.push(sql(ctx.db, `UPDATE settings SET value = ? WHERE key = 'low_stock_threshold'`, String(body.low_stock_threshold)));
      }
      for (const [key, prefix] of [['legacy_payment_link_id', 'plink'], ['legacy_link_price_id', 'price']]) {
        if (body[key] === undefined) continue;
        if (body[key] !== '' && !new RegExp(`^${prefix}_[A-Za-z0-9]{8,64}$`).test(body[key])) throw fail('invalid_request', { field: key });
        statements.push(sql(ctx.db, 'UPDATE settings SET value = ? WHERE key = ?', body[key], key));
      }
      if (!statements.length) throw fail('invalid_request');
      statements.push(audit(ctx.db, now, 'fondateur', 'settings_changed', Object.keys(body).join(','), 'ok'));
      await batch(ctx.db, statements);
      return json(await settingsView(ctx, session, deps));
    }
    case 'POST /api/admin/shop': {
      const body = await readJsonBody(request);
      requireStepUp();
      if (!['open', 'paused'].includes(body.mode)) throw fail('invalid_request');
      if (body.mode === 'open') {
        const ready = await readiness(ctx, deps);
        if (!ready.ready) throw fail('not_ready', { checks: ready.checks.filter((c) => c.blocker && !c.ok).map((c) => c.id) });
      }
      await batch(ctx.db, [sql(ctx.db, `UPDATE settings SET value = ? WHERE key = 'shop_mode'`, body.mode),
        sql(ctx.db, `UPDATE settings SET value = ? WHERE key = 'payments_enabled'`, body.mode === 'open' ? '1' : '0'),
        audit(ctx.db, now, 'fondateur', body.mode === 'open' ? 'shop_opened' : 'shop_paused', null, 'ok')]);
      await deps.notify({ kind: body.mode === 'open' ? 'shop_opened' : 'shop_paused', ref: String(now), level: 'warning',
        title: body.mode === 'open' ? 'Boutique ouverte' : 'Boutique en pause', body: body.mode === 'open' ? 'Les paiements sont ouverts.' : 'Les paiements sont fermés ; le message de pause s’affiche.' });
      return json(await settingsView(ctx, session, deps));
    }
    case 'POST /api/admin/terms': {
      const body = await readJsonBody(request, 220000);
      requireStepUp();
      const published = await publishTerms(ctx.db, { version: body.version, body: body.body, actor: 'fondateur', now });
      return json({ terms: published });
    }
    case 'POST /api/admin/legacy/sync': {
      const body = await readJsonBody(request);
      requireStepUp();
      if (!deps.stripe?.listLinkSessions || !settings.legacy_payment_link_id) throw fail('not_configured');
      const page = await deps.stripe.listLinkSessions(settings.legacy_payment_link_id, typeof body.after === 'string' ? body.after : null);
      const sessions = (page.data ?? []).slice(0, 20);
      const results = [];
      for (const s of sessions) {
        // Offre gratuite : on s'arrête avant la limite de l'invocation (journal compris) ; STUDIO
        // relance aussitôt la lecture à partir de la dernière vente traitée.
        if (!fits(deps, { queries: COST.legacySale.queries + 1, external: COST.legacySale.external })) break;
        const full = await deps.stripe.retrieveSession(s.id);
        results.push((await recordLegacyLinkSale(ctx, full, deps)).status);
      }
      await batch(ctx.db, [audit(ctx.db, now, 'fondateur', 'legacy_sync', settings.legacy_payment_link_id, results.join(',') || 'none')]);
      const stopped = results.length < sessions.length;
      if (!results.length && stopped) throw fail('service_unavailable'); // rien n'a pu être relu : nouvel essai plus tard
      return json({ checked: results.length, recorded: results.filter((r) => !['duplicate', 'ignored'].includes(r)).length,
        duplicates: results.filter((r) => r === 'duplicate').length,
        next: stopped || page.has_more ? sessions[results.length - 1].id : null });
    }

    // ---- drops et produits ----
    case 'GET /api/admin/drops': {
      const drops = await all(ctx.db, `SELECT DISTINCT p.drop_id AS id FROM products p UNION SELECT id FROM drops`);
      const products = await all(ctx.db, `SELECT p.id, p.drop_id, p.name, p.price_cents, p.status,
          (SELECT GROUP_CONCAT(v.size, ',') FROM variants v WHERE v.product_id = p.id ORDER BY v.position) AS sizes FROM products p ORDER BY p.drop_id, p.id`);
      return json({ drops: await Promise.all(drops.map(async (d) => ({ ...(await dropView(ctx, d.id)),
        products: products.filter((p) => p.drop_id === d.id).map((p) => ({ ...p, sizes: (p.sizes ?? '').split(',').filter(Boolean) })) }))),
      promo: { supported: false, note: 'Les codes promo de la boutique 2.0 demandent d’abord leur prise en charge dans le devis signé (à coordonner avec Work).' } });
    }
    case 'POST /api/admin/drops/declare': {
      const body = await readJsonBody(request);
      requireStepUp();
      const id = String(body.drop_id ?? '');
      if (!/^[a-z0-9-]{2,40}$/.test(id)) throw fail('invalid_request');
      for (const k of ['received_total', 'gifted_total']) if (body[k] !== null && !int(body[k], 0, 100000)) throw fail('invalid_request', { field: k });
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 40) : null;
      await batch(ctx.db, [sql(ctx.db, `INSERT INTO drops (id, name, received_total, gifted_total, reference_total, created_at, updated_at)
          VALUES (?, COALESCE(?, ?), ?, ?, NULL, ?, ?)
        ON CONFLICT (id) DO UPDATE SET received_total = excluded.received_total, gifted_total = excluded.gifted_total,
          name = COALESCE(?, drops.name), updated_at = excluded.updated_at`, id, name, id, body.received_total, body.gifted_total, now, now, name),
      audit(ctx.db, now, 'fondateur', 'drop_declared', id, `recues=${body.received_total} offertes=${body.gifted_total}`)]);
      return json(await dropView(ctx, id));
    }
    case 'POST /api/admin/products': {
      const body = await readJsonBody(request);
      requireStepUp();
      const id = String(body.id ?? '');
      const dropId = String(body.drop_id ?? '');
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
      const sizes = Array.isArray(body.sizes) ? [...new Set(body.sizes.map((s) => String(s).trim().toUpperCase()))].filter((s) => /^[A-Z0-9]{1,6}$/.test(s)) : [];
      if (!/^[a-z0-9-]{3,40}$/.test(id) || !/^[a-z0-9-]{2,40}$/.test(dropId) || name.length < 2 || !int(body.price_cents, 100, 1_000_000) || !sizes.length || sizes.length > 10) {
        throw fail('invalid_request');
      }
      const prefix = id.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
      const statements = [sql(ctx.db, `INSERT INTO products (id, drop_id, name, price_cents, status) VALUES (?, ?, ?, ?, 'draft')`, id, dropId, name, body.price_cents),
        sql(ctx.db, `INSERT INTO drops (id, name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`, dropId, dropId, now, now)];
      sizes.forEach((size, i) => {
        statements.push(sql(ctx.db, `INSERT INTO variants (sku, product_id, color, size, position) VALUES (?, ?, 'standard', ?, ?)`, `${prefix}-${size}`, id, size, i + 1));
        statements.push(sql(ctx.db, 'INSERT INTO inventory (sku) VALUES (?)', `${prefix}-${size}`));
      });
      statements.push(audit(ctx.db, now, 'fondateur', 'product_drafted', id, `prix=${body.price_cents}`));
      try {
        await batch(ctx.db, statements);
      } catch (error) {
        if (error.dbCode === 'unique_failed') throw fail('invalid_request', { field: 'id' });
        throw error;
      }
      return json({ product: { id, drop_id: dropId, name, price_cents: body.price_cents, status: 'draft', sizes } });
    }
    case 'POST /api/admin/products/status': {
      const body = await readJsonBody(request);
      requireStepUp();
      if (!['draft', 'published', 'archived'].includes(body.status) || typeof body.id !== 'string') throw fail('invalid_request');
      const res = await batch(ctx.db, [sql(ctx.db, 'UPDATE products SET status = ? WHERE id = ?', body.status, body.id),
        audit(ctx.db, now, 'fondateur', 'product_status', body.id, body.status)]);
      if (!res[0].meta.changes) throw fail('not_found');
      return json({ id: body.id, status: body.status });
    }
    case 'POST /api/admin/products/price': {
      const body = await readJsonBody(request);
      requireStepUp();
      if (typeof body.id !== 'string' || !int(body.price_cents, 100, 1_000_000)) throw fail('invalid_request');
      const res = await batch(ctx.db, [sql(ctx.db, 'UPDATE products SET price_cents = ? WHERE id = ?', body.price_cents, body.id),
        audit(ctx.db, now, 'fondateur', 'price_changed', body.id, `prix=${body.price_cents}`)]);
      if (!res[0].meta.changes) throw fail('not_found');
      return json({ id: body.id, price_cents: body.price_cents });
    }

    // ---- performances (commandes réelles uniquement) ----
    case 'GET /api/admin/performance': {
      const since = (await one(ctx.db, 'SELECT MIN(created_at) AS t FROM orders')).t;
      const totals = await one(ctx.db, `SELECT
          SUM(CASE WHEN paid_at IS NOT NULL AND status IN ${PAID_LIKE} THEN 1 ELSE 0 END) AS sales,
          SUM(CASE WHEN source = 'storefront' THEN 1 ELSE 0 END) AS attempts,
          SUM(CASE WHEN source = 'storefront' AND paid_at IS NOT NULL THEN 1 ELSE 0 END) AS storefront_paid,
          SUM(CASE WHEN status IN ('expired', 'failed') AND paid_at IS NULL THEN 1 ELSE 0 END) AS abandoned,
          SUM(CASE WHEN source = 'legacy_link' THEN 1 ELSE 0 END) AS legacy,
          SUM(CASE WHEN shipping_method = 'relay' AND paid_at IS NOT NULL THEN 1 ELSE 0 END) AS relay,
          SUM(CASE WHEN shipping_method = 'home' AND paid_at IS NOT NULL THEN 1 ELSE 0 END) AS home
        FROM orders`);
      const sizes = await all(ctx.db, `SELECT COALESCE(v.size, '?') AS size, SUM(oi.quantity) AS q FROM order_items oi JOIN orders o ON o.id = oi.order_id
        LEFT JOIN variants v ON v.sku = oi.sku WHERE o.paid_at IS NOT NULL AND o.status IN ${PAID_LIKE} GROUP BY COALESCE(v.size, '?') ORDER BY MIN(COALESCE(v.position, 99))`);
      return json({ since: since ? iso(since) : null, sales: totals.sales ?? 0, attempts: totals.attempts ?? 0, abandoned: totals.abandoned ?? 0,
        conversion: totals.attempts ? (totals.storefront_paid ?? 0) / totals.attempts : null, legacy_sales: totals.legacy ?? 0,
        shipping: { relay: totals.relay ?? 0, home: totals.home ?? 0 },
        by_size: sizes.map((s) => ({ size: s.size === '?' ? null : s.size, quantity: s.q })),
        visits: null, visits_note: 'La mesure des visites (sans cookies) démarre avec le domaine chez Cloudflare.' });
    }

    // ---- demandes des clients ----
    case 'GET /api/admin/requests': {
      const rows = await all(ctx.db, 'SELECT id, reference, type, order_reference, status, ack_sent_at, created_at FROM customer_requests ORDER BY created_at DESC LIMIT 200');
      return json({ requests: rows.map((r) => ({ ...r, created_at: iso(r.created_at) })) });
    }
    case 'POST /api/admin/requests/open': {
      const body = await readJsonBody(request);
      requireStepUp();
      const row = await one(ctx.db, 'SELECT id, sealed FROM customer_requests WHERE id = ?', String(body.id ?? ''));
      if (!row) throw fail('not_found');
      await batch(ctx.db, [audit(ctx.db, now, 'fondateur', 'view_customer_contact', `request:${row.id}`, 'ok')]);
      return json({ request: await openPayload(ctx, row.sealed, `request:${row.id}`) });
    }
    case 'POST /api/admin/requests/status': {
      const body = await readJsonBody(request);
      if (!['answered', 'closed'].includes(body.status)) throw fail('invalid_request');
      const res = await batch(ctx.db, [sql(ctx.db, 'UPDATE customer_requests SET status = ?, updated_at = ? WHERE id = ?', body.status, now, String(body.id ?? '')),
        audit(ctx.db, now, 'fondateur', 'request_status', String(body.id ?? ''), body.status)]);
      if (!res[0].meta.changes) throw fail('not_found');
      return json({ status: body.status });
    }
    default:
      return json({ error: 'not_found' }, 404);
  }
}

async function inventoryView(ctx) {
  const dropId = await currentDropId(ctx);
  const drop = dropId ? await one(ctx.db, 'SELECT reference_total FROM drops WHERE id = ?', dropId) : null;
  const rows = await all(ctx.db, `SELECT v.sku, v.size, i.on_hand, i.reserved, i.on_hand - i.reserved AS available, i.confirmed_at, i.revision
    FROM products p JOIN variants v ON v.product_id = p.id JOIN inventory i ON i.sku = v.sku
    WHERE p.drop_id IS ? ORDER BY p.id, v.position, v.sku`, dropId);
  const settings = await getSettings(ctx.db);
  return { drop_id: dropId, variants: rows.map((r) => ({ sku: r.sku, size: r.size, on_hand: r.on_hand, reserved: r.reserved, available: r.available,
    confirmed: r.confirmed_at !== null, revision: r.revision })),
  reference_total: drop ? drop.reference_total : DEFAULT_REFERENCE_TOTAL,
  low_stock_threshold: Number(settings.low_stock_threshold || 2) };
}

async function settingsView(ctx, session, deps) {
  const settings = await getSettings(ctx.db);
  const passkeys = await all(ctx.db, `SELECT id, label, created_at, last_used_at, backed_up FROM passkeys WHERE revoked_at IS NULL
    AND generation = CAST((SELECT value FROM settings WHERE key = 'studio_generation') AS INTEGER) ORDER BY created_at`);
  const sessions = await all(ctx.db, `SELECT s.created_at, s.last_seen_at, s.passkey_id, s.token_hash FROM auth_sessions s
    WHERE s.revoked_at IS NULL AND s.expires_at > ? ORDER BY s.last_seen_at DESC`, Math.floor(Date.now() / 1000) - 1);
  const codes = (await one(ctx.db, 'SELECT COUNT(*) AS n FROM recovery_codes WHERE used_at IS NULL')).n;
  return {
    shop: { mode: settings.shop_mode, payments_enabled: settings.payments_enabled === '1' },
    low_stock_threshold: Number(settings.low_stock_threshold || 2), report_hour: 10,
    legacy: { payment_link_id: settings.legacy_payment_link_id || '', price_id: settings.legacy_link_price_id || '' },
    terms: await currentTerms(ctx.db),
    retention: { enabled: settings.retention_enabled === '1', archive_days: Number(settings.contact_archive_days), delete_days: Number(settings.contact_delete_days) },
    devices: passkeys.map((p) => ({ id: p.id, label: p.label, created_at: iso(p.created_at), last_used_at: p.last_used_at ? iso(p.last_used_at) : null,
      synced: Boolean(p.backed_up), sessions: sessions.filter((s) => s.passkey_id === p.id).length })),
    current_device: session.passkey_id, recovery_codes_left: codes, readiness: await readiness(ctx, deps),
  };
}

// ---------- actions sur une commande ----------
async function orderRoutes(request, ctx, { method, id, action, requireStepUp, deps, now }) {
  if (method === 'GET' && action === '') return json(await orderDetail(ctx, id));
  if (method !== 'POST') return json({ error: 'not_found' }, 404);
  const body = await readJson(request);
  const order = await one(ctx.db, 'SELECT * FROM orders WHERE id = ?', id);
  if (!order) throw fail('not_found');
  switch (action) {
    // Coordonnées : confirmation Face ID, chaque consultation journalisée.
    case '/contact': {
      requireStepUp();
      return json({ contact: await viewContact(ctx, id, 'fondateur', deps, { archived: body.archived === true }) });
    }
    // Préparation, expédition, remise : saisies manuelles en attendant le transporteur.
    case '/fulfil': {
      const step = body.step;
      if (!['prepared', 'shipped', 'delivered'].includes(step)) throw fail('invalid_request');
      const carrier = typeof body.carrier === 'string' ? body.carrier.trim().slice(0, 40) : null;
      const tracking = typeof body.tracking === 'string' ? body.tracking.trim().replace(/\s+/g, '').slice(0, 40) : null;
      if (tracking && !/^[A-Za-z0-9-]{6,40}$/.test(tracking)) throw fail('invalid_request', { field: 'tracking' });
      // E-mail d'expédition : intention durable écrite avec l'événement « expédiée » (V13-B1).
      const shippedMail = step === 'shipped' && order.source === 'storefront' && ctx.PUBLIC_ORIGIN && emailReady(ctx);
      try {
        await batch(ctx.db, [sql(ctx.db, 'INSERT INTO order_events (order_id, kind, detail, actor, at) VALUES (?, ?, ?, ?, ?)', id, step,
          step === 'shipped' ? JSON.stringify({ carrier, tracking }) : null, 'fondateur', now),
        ...(shippedMail ? [intentStatement(ctx.db, { kind: 'order_shipped', dedupe: `shipped:${id}`, ref: id, now })] : []),
        audit(ctx.db, now, 'fondateur', `order_${step}`, label(order), 'ok')]);
      } catch (error) {
        if (error.dbCode === 'order_not_shippable') throw fail('order_not_shippable');
        if (error.dbCode === 'unique_failed') return json(await orderDetail(ctx, id)); // déjà fait : sans effet
        throw error;
      }
      if (shippedMail) await processMailIntents(ctx, deps, { only: `shipped:${id}` });
      return json(await orderDetail(ctx, id));
    }
    // Commande « à vérifier » : décision du fondateur (Face ID).
    case '/resolve': {
      requireStepUp();
      const decision = body.decision;
      if (!['confirm', 'restore_piece'].includes(decision)) throw fail('invalid_request');
      if (!['review', 'paid_no_stock'].includes(order.status)) throw fail('order_not_reviewable');
      const items = await all(ctx.db, 'SELECT sku, quantity FROM order_items WHERE order_id = ? AND sku IS NOT NULL', id);
      const statements = [];
      if (decision === 'restore_piece') {
        // Vente 1.0 retirée par prudence alors que la pièce était déjà comptée à part : elle revient en vente.
        const held = await one(ctx.db, `SELECT sku, -d_on_hand AS q FROM stock_movements WHERE ref = ? AND reason = 'legacy_link_sale'`, `link:${order.stripe_session_id}`);
        if (order.status !== 'review' || !held?.q) throw fail('order_not_reviewable');
        statements.push(sql(ctx.db, `INSERT INTO stock_movements (sku, d_on_hand, d_reserved, reason, ref, note, actor, at)
          VALUES (?, ?, 0, 'adjustment', ?, 'Vente 1.0 déjà mise de côté lors de l’inventaire', 'fondateur', ?)`, held.sku, held.q, `restore:${id}`, now));
      }
      if (order.status === 'paid_no_stock') {
        // Pièce retrouvée : prise sur le stock libre, sinon refus (jamais de stock négatif).
        for (const it of items) {
          statements.push(sql(ctx.db, `INSERT INTO assertions (code) SELECT 'insufficient_stock' WHERE (SELECT on_hand - reserved FROM inventory WHERE sku = ?) < ?`, it.sku, it.quantity));
          statements.push(sql(ctx.db, `INSERT INTO stock_movements (sku, d_on_hand, d_reserved, reason, ref, note, actor, at)
            VALUES (?, ?, 0, 'adjustment', ?, 'Pièce attribuée à une commande payée sans stock', 'fondateur', ?)`, it.sku, -it.quantity, `assign:${id}:${it.sku}`, now));
        }
      }
      statements.push(sql(ctx.db, `UPDATE orders SET status = 'paid', updated_at = ? WHERE id = ? AND status IN ('review', 'paid_no_stock')`, now, id));
      statements.push(sql(ctx.db, 'INSERT INTO order_events (order_id, kind, detail, actor, at) VALUES (?, ?, ?, ?, ?)', id, 'review_resolved',
        JSON.stringify({ decision, reason: order.review_reason ?? order.status }), 'fondateur', now));
      statements.push(audit(ctx.db, now, 'fondateur', 'order_review_resolved', label(order), decision));
      try {
        await batch(ctx.db, statements);
      } catch (error) {
        if (error.dbCode === 'assertion_failed' || error.dbCode === 'check_failed') throw fail('insufficient_stock');
        if (error.dbCode === 'unique_failed') throw fail('order_not_reviewable');
        throw error;
      }
      return json(await orderDetail(ctx, id));
    }
    // Remboursement décidé par le fondateur (Face ID). Jamais de remise en stock ici.
    case '/refund': {
      requireStepUp();
      if (!deps.stripe?.createRefund) throw fail('not_configured');
      const amount = body.amount_cents;
      if (!['paid', 'paid_no_stock', 'review', 'partially_refunded'].includes(order.status) || !order.stripe_payment_intent) throw fail('refund_not_allowed');
      if (!int(amount, 1, order.total_cents - order.amount_refunded_cents)) throw fail('invalid_request', { field: 'amount_cents' });
      const key = `sayless-refund-${id}-${order.amount_refunded_cents}-${amount}`;
      const refund = await deps.stripe.createRefund(order.stripe_payment_intent, amount, key);
      await batch(ctx.db, [sql(ctx.db, 'INSERT INTO order_events (order_id, kind, detail, actor, at) VALUES (?, ?, ?, ?, ?)', id, 'refund',
        JSON.stringify({ amount_cents: amount, stripe_refund: refund.id, status: refund.status }), 'fondateur', now),
      audit(ctx.db, now, 'fondateur', 'refund_requested', label(order), `montant=${amount}`)]);
      return json({ refund: { id: refund.id, status: refund.status, amount_cents: amount }, order: await orderDetail(ctx, id) });
    }
    // Retour contrôlé physiquement : seule une pièce revendable revient en stock, une fois.
    case '/return': {
      requireStepUp();
      const result = await inspectReturn(ctx, { orderId: id, sku: String(body.sku ?? ''), quantity: body.quantity, resellable: body.resellable,
        actor: 'fondateur', note: typeof body.note === 'string' ? body.note.slice(0, 200) : null }, deps);
      await batch(ctx.db, [sql(ctx.db, `INSERT INTO order_events (order_id, kind, detail, actor, at) SELECT ?, 'returned', ?, 'fondateur', ?
        WHERE NOT EXISTS (SELECT 1 FROM order_events WHERE order_id = ? AND kind = 'returned')`, id, JSON.stringify({ result }), now, id)]);
      return json({ result, order: await orderDetail(ctx, id) });
    }
    default:
      return json({ error: 'not_found' }, 404);
  }
}

export const _test = { stage, readiness, dropView, financeView };
