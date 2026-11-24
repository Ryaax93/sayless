// Points d'entrée HTTP et tâches planifiées. Un seul backend : la boutique (Pages Functions, même
// origine /api) et le Worker d'exploitation (webhooks, tâches, STUDIO) appellent ce même code.
import { ApiError, errorResponse, fail, json, systemClock, getSettings } from './lib.mjs';
import { assertSameOrigin, clientHash, rateLimit, readJson, verifyTurnstile } from './security.mjs';
import { publicStock } from './stock.mjs';
import { checkoutStatus, createQuote, startCheckout } from './commerce.mjs';
import { handleStripeWebhook, reconcileSession, sweep } from './payments.mjs';
import { configuredChannels, createNotifier, deliverOutbox, discordSender, maybeDailyReport } from './notify.mjs';
import { relayOverdue } from './operations.mjs';
import { applyRetention } from './retention.mjs';
import { maybeDailyBackup } from './backup.mjs';
import { createStripeClient } from './stripe.mjs';

// Contexte d'exécution : liaisons Cloudflare + dépendances injectables (horloge, Stripe, relais).
export function createContext(env, overrides = {}) {
  const ctx = { ...env, db: env.DB };
  const deps = {
    now: systemClock,
    stripe: createStripeClient(env),
    relays: null, // aucun fournisseur de points relais raccordé : le mode relais est refusé (503)
    channels: configuredChannels(env),
    ...overrides,
  };
  deps.notify = overrides.notify ?? createNotifier(ctx, deps);
  deps.rateLimit = overrides.rateLimit ?? ((key, limit, windowSeconds) => rateLimit(ctx.db, key, limit, windowSeconds, deps.now()));
  deps.turnstile = overrides.turnstile ?? ((token, ip) => verifyTurnstile(env, token, ip));
  deps.reconcile = (session) => reconcileSession(ctx, session, deps);
  return { ctx, deps };
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
      case 'GET /api/relay-points': {
        if (!deps.relays) throw fail('relay_unavailable');
        const postcode = url.searchParams.get('postcode') ?? '';
        if (!/^\d{5}$/.test(postcode) || (url.searchParams.get('country') ?? 'FR') !== 'FR') throw fail('invalid_request');
        await deps.rateLimit(`relay:${await clientHash(env, ip, deps.now())}`, 30, 600);
        return json({ points: await deps.relays.search(postcode) });
      }
      // Suivi, recherche de commande et demandes : refusés tant que l'envoi d'e-mails et le
      // stockage des demandes ne sont pas raccordés et testés. Jamais de faux « envoyé ».
      case 'POST /api/order/lookup':
      case 'GET /api/order':
      case 'POST /api/requests':
        throw fail('not_configured');
      default:
        return json({ error: 'not_found' }, 404);
    }
  } catch (error) {
    return errorResponse(error);
  }
}

// Worker d'exploitation : webhook Stripe et santé. (L'API STUDIO arrivera dans ce Worker.)
export async function handleOps(request, env, options = {}) {
  const { ctx, deps } = createContext(env, options.deps);
  const url = new URL(request.url);
  if (request.method === 'POST' && url.pathname === '/webhooks/stripe') {
    const raw = await request.text();
    try {
      const result = await handleStripeWebhook(ctx, raw, request.headers.get('Stripe-Signature') ?? '', deps);
      return json({ received: true, ...result });
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) return json({ error: error.code }, error.status);
      return json({ error: 'retry_later' }, 500); // Stripe renverra l'événement
    }
  }
  if (request.method === 'GET' && url.pathname === '/health') {
    let database = 'ok';
    try {
      await getSettings(ctx.db);
    } catch {
      database = 'unavailable';
    }
    return json({ ok: database === 'ok', database, stripe: deps.stripe ? (deps.stripe.live ? 'live' : 'test') : 'absent' });
  }
  return json({ error: 'not_found' }, 404);
}

// Tâche de chaque minute : balayage, envois, rapport de 10 h ; chaque heure : relances de relais,
// sauvegarde chiffrée (une fois par jour après 3 h) et conservation des données.
export async function runScheduled(env, options = {}) {
  const { ctx, deps } = createContext(env, options.deps);
  const report = {};
  const step = async (name, fn) => {
    try {
      report[name] = await fn();
    } catch (error) {
      report[name] = `erreur: ${error.message}`;
    }
  };
  const minute = Math.floor(deps.now() / 60) % 60;
  await step('sweep', () => sweep(ctx, deps));
  await step('daily_report', () => maybeDailyReport(ctx, deps));
  if (minute === 0) await step('relay_overdue', () => relayOverdue(ctx, deps));
  if (minute === 5) await step('backup', () => maybeDailyBackup(ctx, deps));
  if (minute === 10) await step('retention', () => applyRetention(ctx, deps));
  const senders = {};
  if (deps.channels.includes('discord')) senders.discord = discordSender(env.DISCORD_WEBHOOK_URL);
  await step('outbox', () => deliverOutbox(ctx, senders, deps));
  return report;
}
