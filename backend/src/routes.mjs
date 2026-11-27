// Points d'entrée HTTP et tâches planifiées. Un seul backend : la boutique (Pages Functions, même
// origine /api) et le Worker d'exploitation (webhooks, tâches, STUDIO) appellent ce même code.
import { ApiError, errorResponse, fail, json, systemClock, getSettings } from './lib.mjs';
import { assertSameOrigin, clientHash, rateLimit, readJson, verifyTurnstile } from './security.mjs';
import { publicStock } from './stock.mjs';
import { checkoutStatus, createQuote, searchRelays, startCheckout } from './commerce.mjs';
import { handleStripeWebhook, reconcileSession, sweep } from './payments.mjs';
import { configuredChannels, createNotifier, deliverOutbox, discordSender, maybeDailyReport } from './notify.mjs';
import { relayOverdue } from './operations.mjs';
import { applyRetention } from './retention.mjs';
import { maybeDailyBackup } from './backup.mjs';
import { createStripeClient } from './stripe.mjs';
import { handleAdmin } from './admin.mjs';
import { lookupOrder, readOrder, submitRequest } from './requests.mjs';
import { emailReady, resendSender } from './email.mjs';
import { pushSender } from './push.mjs';
import { termsDocument } from './terms.mjs';
import { processMailIntents } from './intents.mjs';
import { createBudget, meteredClient, meteredDb, meteredTransport } from './budget.mjs';

// Contexte d'exécution : liaisons Cloudflare + dépendances injectables (horloge, Stripe, relais).
// `transport` : fetch utilisé pour Stripe et les envois (compté dans une invocation budgétée).
export function createContext(env, overrides = {}) {
  const ctx = { ...env, db: env.DB };
  const transport = overrides.transport ?? fetch;
  const deps = {
    now: systemClock,
    stripe: createStripeClient(env, transport),
    relays: null, // aucun fournisseur de points relais raccordé : le mode relais est refusé (503)
    channels: configuredChannels(env),
    ...overrides,
  };
  deps.notify = overrides.notify ?? createNotifier(ctx, deps);
  deps.rateLimit = overrides.rateLimit ?? ((key, limit, windowSeconds) => rateLimit(ctx.db, key, limit, windowSeconds, deps.now()));
  deps.turnstile = overrides.turnstile ?? ((token, ip) => verifyTurnstile(env, token, ip));
  deps.reconcile = (session) => reconcileSession(ctx, session, deps);
  deps.senders = overrides.senders ?? sendersFor(env, transport, deps.now);
  deps.sendNow = overrides.sendNow ?? ((dedupe) => deliverOutbox(ctx, deps.senders, deps, { only: dedupe }));
  return { ctx, deps };
}

// Canaux d'envoi réellement configurés (secrets saisis dans Cloudflare) ; aucun autre.
export function sendersFor(env, transport = fetch, clock = undefined) {
  const senders = {};
  if (configuredChannels(env).includes('discord')) senders.discord = discordSender(env, transport);
  if (configuredChannels(env).includes('push')) senders.push = pushSender(env, transport, clock);
  if (emailReady(env)) senders.email = resendSender(env, transport);
  return senders;
}

// Invocation comptée (tâche planifiée, webhook Stripe) : requêtes D1 et appels externes passent par
// le budget de l'offre gratuite (budget.mjs). `reserve` : requêtes gardées pour les dernières écritures.
function budgetedContext(env, options = {}, { reserve = 0 } = {}) {
  const budget = createBudget({ reserve });
  const base = options.deps ?? {};
  const overrides = { ...base, budget, transport: meteredTransport(base.transport ?? fetch, budget) };
  if (base.stripe) overrides.stripe = meteredClient(base.stripe, budget); // client fourni tout fait (tests)
  if (base.senders) overrides.senders = meteredClient(base.senders, budget);
  const { ctx, deps } = createContext({ ...env, DB: meteredDb(env.DB, budget) }, overrides);
  return { ctx, deps, budget };
}

// Catalogue éditorial (data/products.json) ; prix et publication relus dans D1, qui fait foi.
async function catalogResponse(ctx, catalog) {
  if (!catalog) throw fail('not_configured');
  const rows = (await ctx.db.prepare('SELECT id, price_cents, status FROM products').all()).results ?? [];
  const live = new Map(rows.map((r) => [r.id, r]));
  const products = (catalog.products ?? []).filter((p) => live.get(p.id)?.status === 'published')
    .map((p) => ({ ...p, price_cents: live.get(p.id).price_cents }));
  return { ...catalog, products };
}

export async function handlePublicApi(request, env, options = {}) {
  const { ctx, deps } = createContext(env, options.deps);
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname.replace(/\/+$/, '')}`;
  const ip = request.headers.get('CF-Connecting-IP') ?? '';
  try {
    if (request.method === 'POST') assertSameOrigin(request);
    switch (route) {
      case 'GET /api/stock': {
        const productId = url.searchParams.get('product_id') ?? '';
        if (!/^[a-z0-9-]{1,40}$/.test(productId)) throw fail('invalid_request');
        return json(await publicStock(ctx.db, productId, deps.now()));
      }
      case 'GET /api/catalog':
        return json(await catalogResponse(ctx, options.catalog));
      case 'POST /api/quote': {
        const body = await readJson(request);
        await deps.rateLimit(`quote:${await clientHash(env, ip, deps.now())}`, 30, 600);
        return json(await createQuote(ctx, body, deps));
      }
      case 'POST /api/checkout': {
        const body = await readJson(request);
        const result = await startCheckout(ctx, { body, idempotencyKey: request.headers.get('Idempotency-Key'),
          clientHash: await clientHash(env, ip, deps.now()), ip }, deps);
        return json(result);
      }
      case 'POST /api/checkout/status': {
        const body = await readJson(request);
        await deps.rateLimit(`status:${await clientHash(env, ip, deps.now())}`, 60, 600);
        return json(await checkoutStatus(ctx, body, deps));
      }
      // Mêmes refus de destination que le devis (postcode_required, destination_not_supported).
      case 'GET /api/relay-points': {
        if (!deps.relays) throw fail('relay_unavailable');
        const postcode = (url.searchParams.get('postcode') ?? '').trim();
        const country = (url.searchParams.get('country') ?? 'FR').trim().toUpperCase();
        if (postcode.length > 10 || country.length !== 2) throw fail('invalid_request');
        await deps.rateLimit(`relay:${await clientHash(env, ip, deps.now())}`, 30, 600);
        return json(await searchRelays(ctx, deps, { postcode, country }));
      }
      // Suivi, recherche de commande et demandes : 503 not_configured tant que l'envoi d'e-mails
      // (accusé sur support durable) et le chiffrement ne sont pas configurés. Jamais de faux « envoyé ».
      case 'POST /api/order/lookup': {
        const body = await readJson(request);
        const client = await clientHash(env, ip, deps.now());
        await deps.rateLimit(`lookup:${client}`, 10, 600);
        return json(await lookupOrder(ctx, body, deps));
      }
      case 'GET /api/order': {
        await deps.rateLimit(`order:${await clientHash(env, ip, deps.now())}`, 60, 600);
        return json(await readOrder(ctx, request, deps));
      }
      case 'POST /api/requests': {
        const body = await readJson(request);
        await deps.rateLimit(`requests:${await clientHash(env, ip, deps.now())}`, 5, 600);
        return json(await submitRequest(ctx, body, deps, { ip }));
      }
      // CGV archivées (contrat v1.4) : le texte exact du document accepté, sa version et son empreinte.
      case 'GET /api/terms':
        return await termsResponse(ctx, null, deps);
      default: {
        const version = request.method === 'GET' && /^GET \/api\/terms\/([A-Za-z0-9._-]{1,40})$/.exec(route)?.[1];
        if (version) return await termsResponse(ctx, version, deps);
        return json({ error: 'not_found' }, 404);
      }
    }
  } catch (error) {
    return errorResponse(error);
  }
}

// Lecture seule, sans cookie ni donnée personnelle. Une version précise est immuable (cache long) ;
// la version en vigueur peut changer (revalidation). Texte brut : jamais interprété comme du HTML.
async function termsResponse(ctx, version, deps) {
  const doc = await termsDocument(ctx.db, version).catch(() => { throw fail('service_unavailable'); });
  if (!doc) throw fail(version ? 'not_found' : 'not_configured');
  if (!doc.intact) {
    await deps.notify({ kind: 'terms_integrity', ref: doc.version, level: 'critical', title: 'CGV : texte et empreinte différents',
      body: `Le texte archivé des CGV ${doc.version} ne correspond plus à son empreinte. Devis et affichage bloqués ; vérifier l’archive.` });
    throw fail('not_configured');
  }
  const res = json({ version: doc.version, sha256: doc.sha256, published_at: new Date(doc.published_at * 1000).toISOString(),
    current: doc.current, format: 'text/plain', body: doc.body });
  res.headers.set('Cache-Control', version ? 'public, max-age=86400, immutable' : 'public, max-age=0, must-revalidate');
  res.headers.set('ETag', `"${doc.sha256}"`);
  return res;
}

// Worker d'exploitation : API de SAYLESS STUDIO, webhook Stripe et santé.
export async function handleOps(request, env, options = {}) {
  const { ctx, deps } = createContext(env, options.deps);
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/admin/')) {
    // STUDIO : chaque appel est une invocation comptée (offre gratuite) ; une action longue s'arrête
    // avant la limite et indique où reprendre.
    const counted = budgetedContext(env, options);
    return handleAdmin(request, counted.ctx, counted.deps);
  }
  if (request.method === 'POST' && url.pathname === '/webhooks/stripe') {
    const raw = await request.text();
    // Budget compté : les e-mails en attente ne sont repris que s'il reste de quoi les traiter.
    const counted = budgetedContext(env, options);
    try {
      const result = await handleStripeWebhook(counted.ctx, raw, request.headers.get('Stripe-Signature') ?? '', counted.deps);
      return json({ received: true, ...result });
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) return json({ error: error.code }, error.status);
      return json({ error: 'retry_later' }, 500); // Stripe renverra l'événement
    }
  }
  if (request.method === 'GET' && url.pathname === '/health') {
    // Lisible par un service de surveillance externe gratuit : une tâche planifiée arrêtée
    // (« late ») ne peut pas envoyer elle-même d'alerte.
    // `environment` et `payments` (ouverts ou fermés) : publics, lus par l'assistant de TEST pour
    // vérifier qu'il parle au bon Worker et que les paiements restent fermés par défaut.
    let database = 'ok';
    let scheduler = 'unknown';
    let payments = 'unknown';
    try {
      const settings = await getSettings(ctx.db);
      const last = Number(settings.cron_last_run || 0);
      scheduler = !last ? 'never' : deps.now() - last < 300 ? 'ok' : 'late';
      payments = settings.shop_mode === 'open' && settings.payments_enabled === '1' ? 'open' : 'closed';
    } catch {
      database = 'unavailable';
    }
    return json({ ok: database === 'ok', database, scheduler, environment: env.ENVIRONMENT ?? 'local', payments,
      stripe: deps.stripe ? (deps.stripe.live ? 'live' : 'test') : 'absent' });
  }
  return json({ error: 'not_found' }, 404);
}

// Tâche de chaque minute : balayage, envois, rapport de 10 h ; chaque heure : relances de relais,
// sauvegarde chiffrée (une fois par jour après 3 h) et conservation des données.
export async function runScheduled(env, options = {}) {
  // Offre gratuite : 50 requêtes D1 et 50 appels externes au plus ; 2 requêtes gardées pour la
  // déclaration des canaux et le battement, qui passent toujours. Le travail restant attend la minute suivante.
  const { ctx, deps, budget } = budgetedContext(env, options, { reserve: 2 });
  const report = {};
  const step = async (name, fn) => {
    try {
      report[name] = await fn();
    } catch (error) {
      report[name] = `erreur: ${error.message}`;
    }
  };
  const minute = Math.floor(deps.now() / 60) % 60;
  // Minute 5 : sauvegarde seule, pour rester sous les limites de l'offre gratuite (50 requêtes et
  // 10 ms de calcul par invocation). Le balayage reprend à la minute suivante.
  if (minute === 5) {
    await step('backup', () => maybeDailyBackup(ctx, deps));
    report.budget = { ...budget.used };
    return report;
  }
  await step('sweep', () => sweep(ctx, deps));
  await step('daily_report', () => maybeDailyReport(ctx, deps));
  if (minute === 0) await step('relay_overdue', () => relayOverdue(ctx, deps));
  if (minute === 10) await step('retention', () => applyRetention(ctx, deps));
  // E-mails clients dont la mise en file a échoué (V13-B1) : 3 au plus par minute (budget de requêtes).
  await step('mail', () => processMailIntents(ctx, deps, { limit: 3 }));
  await step('outbox', () => deliverOutbox(ctx, deps.senders, deps));
  budget.finish();
  // Canaux réellement configurés sur ce Worker, déclarés pour la boutique (écriture seulement s'ils changent).
  await step('channels', () => ctx.db.prepare(`UPDATE settings SET value = ? WHERE key = 'notify_channels' AND value <> ?`)
    .bind(deps.channels.join(','), deps.channels.join(',')).run());
  // Battement de la tâche planifiée (écran Santé) : une écriture par minute, dans l'offre gratuite.
  await step('heartbeat', () => ctx.db.prepare(`UPDATE settings SET value = ? WHERE key = 'cron_last_run'`).bind(String(deps.now())).run());
  report.budget = { ...budget.used };
  return report;
}
