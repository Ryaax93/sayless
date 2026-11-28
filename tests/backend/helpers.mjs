// Banc d'essai du backend : D1 locale éphémère (Miniflare, moteur workerd), Stripe, transporteur et
// points relais SIMULÉS. Données de test uniquement (SKU TEST-*, montants fictifs, faux clients).
// Ces tests ne prouvent rien sur Cloudflare, Stripe ou un transporteur réels : ils devront être
// rejoués sur D1 de test, Stripe en mode test et le bac à sable du transporteur.
import { readFile } from 'node:fs/promises';
import { createHmac, randomBytes } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { availableParallelism, release, type } from 'node:os';
import { handleOps, handlePublicApi, createContext } from '../../backend/src/routes.mjs';
import { StripeError } from '../../backend/src/stripe.mjs';
import { recordInventory } from '../../backend/src/stock.mjs';
import { publishTerms } from '../../backend/src/terms.mjs';

const MIGRATIONS = ['0001_commerce.sql', '0002_catalog_drop01.sql', '0003_decisions_fondateur.sql', '0004_studio_auth.sql',
  '0005_revue_work.sql', '0006_studio_ecrans.sql', '0007_intentions_cgv.sql', '0008_envois_rapprochement.sql', '0009_notifications_fiables.sql', '0010_destinations_reception.sql'];
// Texte de CGV de TEST uniquement (jamais publié) : sert à vérifier la version signée dans le devis.
export const TEST_TERMS = { version: '2026-11', body: `CGV DE TEST — document fictif utilisé par les essais automatiques. ${'Clause de test. '.repeat(20)}` };
export const TEST_LINK = { id: 'plink_test', price: 'price_test_lien' };
const WITHOUT_CATALOG = MIGRATIONS.filter((m) => m !== '0002_catalog_drop01.sql');
export const T0 = 1_800_000_000; // horloge simulée (secondes)
export const ORIGIN = 'https://boutique.test';
export const PII = { name: 'Client Test', email: 'client.test@example.invalid', phone: '+33100000000',
  address: { line1: '1 rue du Test', postal_code: '75000', city: 'Testville', country: 'FR' } };

// Aucun appel réseau réel pendant les tests : Stripe, Resend, Discord, le push et Turnstile sont
// simulés. Un appel vers l'extérieur échoue tout de suite, comme une panne réseau, et il est noté
// (le moteur D1 local, sur 127.0.0.1, reste joignable).
const realFetch = globalThis.fetch;
export const blockedNetwork = [];
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return realFetch(input, init);
  blockedNetwork.push(url.host);
  return Promise.reject(new TypeError(`réseau externe bloqué pendant les tests : ${url.host}`));
};

const MINIFLARE_VERSION = (() => {
  try { return createRequire(import.meta.url)('miniflare/package.json').version; } catch { return 'inconnue'; }
})();
let mf;
let next = 0;
const SLOTS = 120;
export async function startDatabases() {
  // Miniflare 5 (celui de wrangler 4.168) : connexions locales réutilisées (keep-alive). Miniflare 4
  // ouvrait une connexion par requête SQL, ce qui épuisait les ports de Windows (EADDRINUSE).
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default {fetch(){return new Response("ok")}}',
    d1Databases: Object.fromEntries(Array.from({ length: SLOTS }, (_, i) => [`DB${i}`, `test-db-${i}`])),
    kvNamespaces: ['BACKUPS'], compatibilityDate: '2026-05-15' }));
}
// Échecs de connexion au moteur D1 local (ports épuisés, connexion coupée) : environnement, pas
// résultat métier. Jamais réessayés ni masqués : l'erreur remonte au code testé, elle est comptée,
// et chaque occurrence est notée dans un journal technique (fichier de test, opération SQL sans
// aucune valeur, endroit de l'appel, chaîne complète des causes réseau, versions), pour qu'un
// avertissement sur un PC puisse être expliqué au lieu d'être supposé.
const engineFailures = new Map();
const engineJournal = [];
const started = Date.now();
const causes = (error) => {
  const chain = [];
  for (let e = error, depth = 0; e && depth < 5; e = e.cause, depth += 1) {
    chain.push({ name: e.name ?? null, code: e.code ?? null, errno: e.errno ?? null, syscall: e.syscall ?? null,
      message: String(e.message ?? '').replace(/https?:\/\/\S+/g, 'adresse').slice(0, 160) });
  }
  return chain;
};
const callSite = () => (new Error().stack ?? '').split('\n').map((l) => l.trim())
  .find((l) => /tests[\/\\](backend|review)[\/\\](?!helpers)/.test(l))?.replace(/^at /, '').replace(/^.*[\/\\](tests[\/\\])/, '$1') ?? null;
export const engineFailure = (error, sqlText = null) => {
  const chain = causes(error);
  const pattern = /EADDRINUSE|EADDRNOTAVAIL|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|UND_ERR_[A-Z_]+|fetch failed|other side closed|socket/i;
  // Cause la plus profonde d'abord (ECONNRESET plutôt que « fetch failed ») : c'est elle qui explique.
  const code = [...chain].reverse().map((c) => (pattern.test(c.code ?? '') ? c.code : pattern.exec(c.message)?.[0])).find(Boolean);
  if (code) {
    engineFailures.set(code, (engineFailures.get(code) ?? 0) + 1);
    if (engineJournal.length < 500) {
      engineJournal.push({ ms: Date.now() - started, code, operation: sqlText ? String(sqlText).trim().split(/\s+/).slice(0, 3).join(' ') : 'lot', where: callSite(), causes: chain });
    }
  }
  return code ?? null;
};
export const engineFailureSummary = () => [...engineFailures].map(([code, n]) => `${code} ×${n}`).join(', ');
export async function stopDatabases() {
  await mf?.dispose();
  if (blockedNetwork.length) console.error(`\n[banc] Appels réseau externes bloqués : ${[...new Set(blockedNetwork)].join(', ')} (×${blockedNetwork.length}).`);
  if (engineFailures.size) {
    const file = (process.argv.find((a) => /\.test\.mjs$/.test(a)) ?? 'suite').replace(/^.*[\/\\]/, '');
    const dir = new URL('../../.journaux-tests/', import.meta.url);
    const target = new URL(`d1-transport-${file.replace(/\.test\.mjs$/, '')}-${process.pid}.jsonl`, dir);
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    const head = { fichier: file, node: process.version, plateforme: `${process.platform} ${process.arch}`, systeme: `${type()} ${release()}`,
      processeurs: availableParallelism(), miniflare: MINIFLARE_VERSION, summary: engineFailureSummary() };
    writeFileSync(target, [head, ...engineJournal].map((x) => JSON.stringify(x)).join('\n') + '\n');
    console.error(`\n[banc] Moteur D1 local : échecs de connexion dans ${file} (${engineFailureSummary()}). Cause d’environnement`
      + ' (ports locaux, charge de la machine), à distinguer d’un défaut métier, mais validation SOUS RÉSERVE du transport local.'
      + `\n[banc] Journal technique (sans aucune donnée) : ${fileURLToPath(target)}`);
  }
}
// KV en mémoire pour les sauvegardes : `corrupt` simule une écriture altérée par le stockage.
export function createKV() {
  const store = new Map();
  return {
    corrupt: false,
    async put(name, value, { metadata } = {}) { store.set(name, { value: this.corrupt ? `${value.slice(0, -8)}AAAAAAAA` : value, metadata }); },
    async get(name) { return store.get(name)?.value ?? null; },
    async delete(name) { store.delete(name); },
    async list({ prefix = '' } = {}) {
      return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name, metadata: store.get(name).metadata })), list_complete: true };
    },
  };
}
export const backupStore = () => mf.getKVNamespace('BACKUPS');

// Une migration = un lot D1 (une seule requête vers le moteur local, comme une transaction de
// `wrangler d1 migrations apply`). Statement par statement, chaque base de test coûtait près de
// 90 connexions locales : assez pour épuiser les ports de Windows sur la suite complète.
export async function migrate(db, files = WITHOUT_CATALOG) {
  for (const file of files) {
    const text = await readFile(new URL(`../../backend/migrations/${file}`, import.meta.url), 'utf8');
    const parts = text.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean);
    await db.batch(parts.map((part) => db.prepare(part)));
  }
}
export async function emptyDatabase() {
  if (next >= SLOTS) throw new Error('plus de base de test disponible');
  return mf.getD1Database(`DB${next++}`);
}

// Base « débranchable » : simule une panne D1, ou une réponse perdue après validation d'un lot
// (loseResponseWhen reçoit les requêtes SQL du lot ; une seule fois). beforeBatch(textes) : action
// concurrente exécutée juste avant un lot (une seule fois si elle renvoie true).
// `state.queries` : requêtes envoyées à D1, comptées comme Cloudflare (un lot = une requête), pour
// vérifier la limite de 50 requêtes par invocation de l'offre gratuite.
export function downable(real) {
  const state = { down: false, loseResponseWhen: null, beforeBatch: null, queries: 0 };
  const fail = () => Promise.reject(new Error('D1 indisponible (simulé)'));
  const watch = (promise, sqlText = null) => promise.catch((error) => { engineFailure(error, sqlText); throw error; });
  const query = (run, sqlText) => { state.queries += 1; return state.down ? fail() : watch(run(), sqlText); };
  const wrap = (stmt, text) => ({
    inner: stmt,
    text,
    bind: (...a) => wrap(stmt.bind(...a), text),
    first: (...a) => query(() => stmt.first(...a), text),
    all: (...a) => query(() => stmt.all(...a), text),
    run: (...a) => query(() => stmt.run(...a), text),
  });
  return {
    state,
    prepare: (text) => wrap(real.prepare(text), text),
    batch: async (stmts) => {
      state.queries += 1;
      if (state.down) throw new Error('D1 indisponible (simulé)');
      if (state.beforeBatch && (await state.beforeBatch(stmts.map((s) => s.text ?? '')))) state.beforeBatch = null;
      const result = await watch(real.batch(stmts.map((s) => s.inner ?? s)), stmts.map((s) => s.text ?? '').find(Boolean) ?? 'lot');
      if (state.loseResponseWhen?.(stmts.map((s) => s.text ?? ''))) {
        state.loseResponseWhen = null;
        throw new Error('réponse D1 perdue après validation (simulé)');
      }
      return result;
    },
  };
}

// ---------- Stripe simulé (états réels d'une Checkout Session) ----------
let seq = 0;
const rid = (p) => `${p}_${(++seq).toString(36)}${randomBytes(4).toString('hex')}`;
export class FakeStripe {
  constructor(clock) {
    this.clock = clock;
    this.live = false;
    this.sessions = new Map();
    this.keys = new Map();
    this.charges = new Map();
    this.created = 0;
    this.down = false;
    this.loseResponse = false;
  }
  view(sid) {
    const s = this.sessions.get(sid);
    return structuredClone({ ...s, line_items: { has_more: false, data: s.lines.map((l) => ({ quantity: l.quantity,
      price: { id: l.price ?? null, unit_amount: l.unit, currency: l.currency ?? 'eur', product: { metadata: l.sku ? { sku: l.sku } : {} } } })) },
    payment_intent: s.pi ? { id: s.pi.id, status: s.pi.status, latest_charge: s.pi.charge ?? null } : null });
  }
  async createCheckoutSession(params, key) {
    if (this.down) throw new StripeError('network');
    const body = new URLSearchParams(params).toString();
    const prev = this.keys.get(key);
    if (prev) {
      if (prev.body !== body) throw new StripeError('api', 400, 'idempotency_error');
      if (prev.error) throw prev.error;
      return this.view(prev.sid);
    }
    const p = Object.fromEntries(params);
    if (Number(p.expires_at) < this.clock.now() + 1800) {
      const error = new StripeError('api', 400, 'invalid_request_error');
      this.keys.set(key, { body, error });
      throw error;
    }
    const lines = [];
    for (let i = 0; p[`line_items[${i}][quantity]`]; i += 1) {
      lines.push({ quantity: Number(p[`line_items[${i}][quantity]`]), unit: Number(p[`line_items[${i}][price_data][unit_amount]`]),
        sku: p[`line_items[${i}][price_data][product_data][metadata][sku]`] });
    }
    const shipping = Number(p['shipping_options[0][shipping_rate_data][fixed_amount][amount]'] ?? 0);
    const sid = rid('cs_test');
    this.created += 1;
    this.sessions.set(sid, { id: sid, object: 'checkout.session', livemode: false, status: 'open', payment_status: 'unpaid',
      client_reference_id: p.client_reference_id, metadata: { sayless_order_id: p['metadata[sayless_order_id]'] },
      amount_total: lines.reduce((n, l) => n + l.unit * l.quantity, 0) + shipping, currency: 'eur',
      url: `https://checkout.stripe.com/c/pay/${sid}`, expires_at: Number(p.expires_at), created: this.clock.now(),
      lines, pi: null, customer_details: null, payment_link: null, params: p });
    this.keys.set(key, { body, sid });
    if (this.loseResponse) throw new StripeError('network');
    return this.view(sid);
  }
  async retrieveSession(sid) {
    if (this.down) throw new StripeError('network');
    if (!this.sessions.has(sid)) throw new StripeError('api', 404, 'invalid_request_error');
    return this.view(sid);
  }
  async expireSession(sid) {
    if (this.down) throw new StripeError('network');
    const s = this.sessions.get(sid);
    if (!s) throw new StripeError('api', 404, 'invalid_request_error');
    if (s.status !== 'open') throw new StripeError('api', 400, 'invalid_request_error');
    s.status = 'expired';
    return this.view(sid);
  }
  pay(sid, { method = 'card', customer = PII } = {}) {
    const s = this.sessions.get(sid);
    s.status = 'complete';
    s.customer_details = { name: customer.name, email: customer.email, phone: customer.phone };
    if (s.params?.['shipping_address_collection[allowed_countries][0]']) s.shipping_details = { name: customer.name, address: customer.address };
    if (s.params?.['custom_fields[0][key]'] === 'recipient_name') s.custom_fields = [{ key: 'recipient_name', type: 'text', text: { value: customer.name } }];
    // Frais simulés (1,5 % + 0,25 €) : chiffres de test, pas un tarif Stripe garanti.
    s.pi = { id: rid('pi'), status: method === 'card' ? 'succeeded' : 'processing',
      charge: { id: rid('ch'), created: this.clock.now(), balance_transaction: { fee: Math.round(s.amount_total * 0.015) + 25 } } };
    s.payment_status = method === 'card' ? 'paid' : 'unpaid';
  }
  asyncResult(sid, ok) {
    const s = this.sessions.get(sid);
    s.pi.status = ok ? 'succeeded' : 'requires_payment_method';
    s.payment_status = ok ? 'paid' : 'unpaid';
  }
  // Vente par le lien 1.0 (réglée à l'instant de l'horloge simulée, ou à `settledAt`).
  linkSession(size, amount = 7500, customer = PII, { link = TEST_LINK.id, price = TEST_LINK.price, quantity = 1, currency = 'eur',
    settledAt = this.clock.now(), lines = null } = {}) {
    const sid = rid('cs_live_lien');
    this.sessions.set(sid, { id: sid, object: 'checkout.session', livemode: false, status: 'complete', payment_status: 'paid',
      payment_link: link, amount_total: amount * quantity, amount_subtotal: amount * quantity, currency, created: this.clock.now(),
      custom_fields: [{ key: 'choisistataille', dropdown: { value: size } }], metadata: {},
      lines: lines ?? [{ quantity, unit: amount, price, currency, sku: null }],
      pi: { id: rid('pi'), status: 'succeeded', charge: settledAt === null ? null : { id: rid('ch'), created: settledAt } },
      customer_details: { name: customer.name, email: customer.email, phone: customer.phone } });
    return sid;
  }
  refund(sid, amount) {
    const s = this.sessions.get(sid);
    const cid = rid('ch');
    const prev = [...this.charges.values()].find((c) => c.payment_intent === s.pi.id);
    const charge = prev ?? { id: cid, object: 'charge', livemode: false, payment_intent: s.pi.id, amount: s.amount_total,
      amount_refunded: 0, refunds: { data: [] } };
    charge.amount_refunded += amount;
    charge.refunds.data.push({ id: rid('re'), amount, status: 'succeeded', created: this.clock.now() });
    this.charges.set(charge.id, charge);
    return charge.id;
  }
  async retrieveCharge(cid) {
    if (this.down) throw new StripeError('network');
    return structuredClone(this.charges.get(cid));
  }
  async listLinkSessions(link, startingAfter = null) {
    if (this.down) throw new StripeError('network');
    const all = [...this.sessions.values()].filter((s) => s.payment_link === link && s.status === 'complete');
    const from = startingAfter ? all.findIndex((s) => s.id === startingAfter) + 1 : 0;
    const page = all.slice(from, from + 20);
    return { data: page.map((s) => ({ id: s.id })), has_more: from + 20 < all.length };
  }
  // Remboursement simulé : même clé = même remboursement (idempotence Stripe).
  async createRefund(paymentIntent, amount, key) {
    if (this.down) throw new StripeError('network');
    this.refunds ??= new Map();
    if (this.refunds.has(key)) return this.refunds.get(key);
    const session = [...this.sessions.values()].find((x) => x.pi?.id === paymentIntent);
    if (!session) throw new StripeError('api', 404, 'invalid_request_error');
    const chargeId = this.refund(session.id, amount);
    const refund = { id: this.charges.get(chargeId).refunds.data.at(-1).id, status: 'succeeded', amount, charge: chargeId };
    this.refunds.set(key, refund);
    return refund;
  }
  async retrieveBalance() {
    if (this.down) throw new StripeError('network');
    return { available: [{ currency: 'eur', amount: 0 }], pending: [{ currency: 'eur', amount: 0 }] };
  }
}

// Envoi d'e-mails simulé (aucun e-mail réel) : garde les requêtes faites à « Resend ».
export function fakeMail() {
  const sent = [];
  const transport = async (url, init) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return new Response('{"id":"email_test"}', { status: 200 });
  };
  return { sent, transport };
}

export class FakeCarrier {
  constructor() { this.labels = new Map(); this.purchases = 0; this.loseResponse = false; }
  async find(ref) { return this.labels.get(ref) ?? null; }
  async create(ref) {
    await new Promise((r) => setTimeout(r, 1));
    this.purchases += 1;
    const label = `LBL-${ref}`;
    this.labels.set(ref, label);
    if (this.loseResponse) throw new Error('réponse transporteur perdue (simulé)');
    return label;
  }
}
// Points relais simulés : un à Paris, un en Corse (hors zone), un fermé. Aucun point réel.
const RELAYS = {
  'TEST-RELAY-1': { postcode: '75016', city: 'Paris', line1: '1 rue du Relais Test' },
  'TEST-RELAY-CORSE': { postcode: '20000', city: 'Ajaccio', line1: '2 rue du Relais Test' },
  'TEST-RELAY-CLOSED': { postcode: '69001', city: 'Lyon', line1: '3 rue du Relais Test', open: false },
};
export const fakeRelays = {
  async find(id) { return RELAYS[id] ? { id, name: 'Relais Test', network: 'TEST', country: 'FR', open: true, ...RELAYS[id] } : null; },
  // Le fournisseur simulé renvoie aussi un point corse proche et un point fermé : le serveur les écarte.
  async search() {
    return ['TEST-RELAY-1', 'TEST-RELAY-CORSE', 'TEST-RELAY-CLOSED'].map((id) => ({ id, name: 'Relais Test', network: 'TEST', country: 'FR', ...RELAYS[id] }));
  },
};

export const sign = (raw, t, secret) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
export const event = (type, objectId, object = 'checkout.session') => ({ id: rid('evt'), type, livemode: false,
  data: { object: { id: objectId, object } } });

// ---------- banc : une base, une horloge, des services simulés ----------
export async function bench(stocks = { 'TEST-M': 1 }, { mode = 'open', productStatus = 'published', threshold = 2,
  payments = true, catalogSeed = false } = {}) {
  const real = await emptyDatabase();
  await migrate(real, catalogSeed ? MIGRATIONS : WITHOUT_CATALOG);
  const db = downable(real);
  const clock = { t: T0, now() { return this.t; } };
  const stripe = new FakeStripe(clock);
  const env = { DB: db, APP_SECRET: 'secret-de-test-uniquement', PUBLIC_ORIGIN: ORIGIN, ENVIRONMENT: 'test',
    TURNSTILE_BYPASS: 'test-only', STRIPE_WEBHOOK_SECRET: 'whsec_test_fixture',
    PII_KEY: Buffer.from(randomBytes(32)).toString('base64url'),
    // Vérification Face ID par la bibliothèque (npm run test:webauthn:bibliotheque).
    ...(process.env.SAYLESS_WEBAUTHN_ENGINE ? { WEBAUTHN_ENGINE: process.env.SAYLESS_WEBAUTHN_ENGINE } : {}) };
  const b = { real, db, clock, stripe, env, carrier: new FakeCarrier(), sent: [] };
  b.deps = { now: () => clock.now(), stripe, relays: fakeRelays, channels: ['discord'] };
  b.context = () => createContext(env, b.deps);
  if (!catalogSeed) {
    // Catalogue de test en un seul lot (une requête vers le moteur local, voir migrate()).
    const setup = [real.prepare(`INSERT INTO products (id, drop_id, name, price_cents, status) VALUES ('test-001', 'drop-test', 'Produit Test', 7500, ?)`)
      .bind(productStatus)];
    let pos = 0;
    for (const sku of Object.keys(stocks)) {
      setup.push(real.prepare(`INSERT INTO variants (sku, product_id, color, size, position) VALUES (?, 'test-001', 'test', ?, ?)`)
        .bind(sku, sku.split('-').pop(), pos += 1));
      setup.push(real.prepare('INSERT INTO inventory (sku) VALUES (?)').bind(sku));
      const size = sku.split('-').pop().toLowerCase();
      if (['s', 'm', 'l'].includes(size)) setup.push(real.prepare('INSERT INTO legacy_link_sizes (value, sku) VALUES (?, ?)').bind(size, sku));
    }
    setup.push(real.prepare(`INSERT INTO shipping_rates (method, cents, label) VALUES ('relay', 490, 'Point relais'), ('home', 850, 'Colissimo domicile')`));
    await real.batch(setup);
    const counted = Object.fromEntries(Object.entries(stocks).filter(([, q]) => q !== null));
    if (Object.keys(counted).length) await recordInventory(real, { counts: counted, actor: 'test', note: 'fixture', now: T0 });
  }
  await publishTerms(real, { ...TEST_TERMS, actor: 'test', now: T0 });
  const setting = (key, value) => real.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(value, key);
  await real.batch([setting('legacy_payment_link_id', TEST_LINK.id), setting('legacy_link_price_id', TEST_LINK.price), setting('shop_mode', mode),
    setting('payments_enabled', payments ? '1' : '0'), setting('low_stock_threshold', String(threshold))]);
  return Object.assign(b, helpersFor(b));
}

function helpersFor(b) {
  const call = async (handler, method, path, { body, ip = '10.0.0.1', headers = {} } = {}) => {
    const request = new Request(`${ORIGIN}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': ip, ...headers } });
    const response = await handler(request);
    return { status: response.status, body: await response.json() };
  };
  const api = (method, path, opts) => call((r) => handlePublicApi(r, b.env, { deps: b.deps, catalog: opts?.catalog }), method, path, opts);
  return {
    api,
    async quote(items, { ip, shipping = 'home', relay_id = null, postcode = '75011', country } = {}) {
      return api('POST', '/api/quote', { body: { items, shipping, relay_id, postcode: shipping === 'home' ? postcode : undefined, country }, ip });
    },
    async checkout(sku, ip = '10.0.0.1', { shipping = 'home', relay_id = null, key = randomBytes(12).toString('hex'), quote = null, quantity = 1, items = null, postcode = '75011' } = {}) {
      const lines = items ?? [{ sku, quantity }];
      const q = quote ?? (await api('POST', '/api/quote', { body: { items: lines, shipping, relay_id, postcode: shipping === 'home' ? postcode : undefined }, ip }));
      if (q.status !== 200) return { ...q, stage: 'quote' };
      const res = await api('POST', '/api/checkout', { ip, headers: { 'Idempotency-Key': key },
        body: { items: lines, shipping, relay_id, quote_id: q.body.id, terms_version: '2026-11', terms_sha256: q.body.terms_sha256, turnstile: 'jeton-test' } });
      const sid = res.body.url ? res.body.url.split('/').pop() : null;
      return { ...res, sid, key, quote: q };
    },
    async webhook(ev, { tOffset = 0, secret = b.env.STRIPE_WEBHOOK_SECRET, tamper = false } = {}) {
      const raw = JSON.stringify(ev);
      const header = sign(raw, b.clock.now() + tOffset, secret);
      const request = new Request(`${ORIGIN}/webhooks/stripe`, { method: 'POST', body: tamper ? raw.replace('"type"', '"type" ') : raw,
        headers: { 'Stripe-Signature': header } });
      return (await handleOps(request, b.env, { deps: b.deps })).status;
    },
    async buy(sku, ip, { method = 'card', deliveries = 1, customer = PII, shipping = 'home', relay_id = null } = {}) {
      const res = await this.checkout(sku, ip, { shipping, relay_id });
      if (res.status !== 200) return res;
      b.stripe.pay(res.sid, { method, customer });
      const ev = event('checkout.session.completed', res.sid);
      for (let i = 0; i < deliveries; i += 1) await this.webhook(ev);
      return res;
    },
    async inv(sku) {
      const r = await b.real.prepare('SELECT on_hand, reserved FROM inventory WHERE sku = ?').bind(sku).first();
      return [r.on_hand, r.reserved];
    },
    async count(text, ...args) {
      return Object.values(await b.real.prepare(text).bind(...args).first())[0];
    },
    rows: async (text, ...args) => (await b.real.prepare(text).bind(...args).all()).results,
  };
}

export const parallel = (n, fn) => Promise.all(Array.from({ length: n }, (_, i) => fn(i)));

// Resend simulé : une clé d'idempotence protège 24 h à partir de son premier appel ; même clé avec
// un autre contenu = 409 ; `lose` : e-mail accepté mais réponse perdue ; `refuse` : réponse d'erreur
// renvoyée avant acceptation. Aucun e-mail réel.
export function resendSimulator(clock) {
  const keys = new Map();
  const sim = { deliveries: 0, requests: [], lose: false, refuse: null };
  sim.transport = async (url, init) => {
    const key = init.headers['Idempotency-Key'];
    sim.requests.push({ key, from: JSON.parse(init.body).from });
    if (sim.refuse) return new Response('{"name":"erreur_simulee"}', { status: sim.refuse });
    const known = keys.get(key);
    if (known && clock.t - known.at < 86400) {
      if (known.body !== init.body) return new Response('{"name":"invalid_idempotent_request"}', { status: 409 });
    } else {
      keys.set(key, { at: clock.t, body: init.body, id: `re_test_${keys.size + 1}` });
      sim.deliveries += 1;
    }
    if (sim.lose) throw new TypeError('fetch failed');
    return new Response(JSON.stringify({ id: keys.get(key).id }), { status: 200 });
  };
  return sim;
}
