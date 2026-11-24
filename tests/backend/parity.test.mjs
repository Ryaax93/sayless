// Parité avec les 16 tests historiques de Work (tests/inventory.test.mjs, prototype server/) et
// contrat commun : le vrai client de la boutique (public/store/api-client.js) parle au vrai serveur.
// Wnn renvoie au test historique n° nn ; Cnn aux vérifications du contrat.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { bench, event, parallel, sign, startDatabases, stopDatabases, ORIGIN } from './helpers.mjs';
import { adjustStock, publicStock, recordInventory } from '../../backend/src/stock.mjs';
import { inspectReturn } from '../../backend/src/operations.mjs';
import { stripeReady } from '../../backend/src/stripe.mjs';
import { handleOps, handlePublicApi } from '../../backend/src/routes.mjs';

before(startDatabases);
after(stopDatabases);
const catalog = JSON.parse(await readFile(new URL('../../data/products.json', import.meta.url), 'utf8'));
const run = async (b, fn) => { const { ctx, deps } = b.context(); return fn(ctx, deps); };

test('W01 stock invendable tant que l’inventaire physique n’est pas confirmé ; aucun total imposé (26 reste théorique)', async () => {
  const b = await bench({ 'TEST-S': null, 'TEST-M': null, 'TEST-L': null });
  let stock = await publicStock(b.real, 'test-001', b.clock.now());
  assert.deepEqual([stock.verified, stock.drop_status, stock.checkout_enabled], [false, 'unavailable', false]);
  assert.ok(stock.variants.every((v) => v.state === 'unavailable' && v.available === 0));
  const q = await b.quote([{ sku: 'TEST-M', quantity: 1 }]);
  assert.deepEqual([q.status, q.body.error], [503, 'stock_unavailable']);
  await recordInventory(b.real, { counts: { 'TEST-S': 2, 'TEST-M': 4, 'TEST-L': 1 }, actor: 'fondateur', note: 'écart avec la déclaration théorique noté', now: b.clock.now() });
  stock = await publicStock(b.real, 'test-001', b.clock.now());
  assert.deepEqual([stock.verified, stock.drop_status, stock.variants.reduce((n, v) => n + v.available, 0)], [true, 'available', 7]);
});

test('W02 20 acheteurs simultanés ne réservent jamais plus de 3 pièces', async () => {
  const b = await bench({ 'TEST-M': 3 });
  const res = await parallel(20, (i) => b.checkout('TEST-M', `10.40.0.${i}`));
  assert.equal(res.filter((r) => r.status === 200).length, 3);
  assert.deepEqual(await b.inv('TEST-M'), [3, 3]);
});

test('W03 panier de plusieurs tailles : tout est annulé si une ligne n’est plus disponible', async () => {
  const b = await bench({ 'TEST-S': 1, 'TEST-M': 1 });
  await b.real.prepare("UPDATE settings SET value = '2' WHERE key = 'max_items_per_order'").run();
  const items = [{ sku: 'TEST-S', quantity: 1 }, { sku: 'TEST-M', quantity: 1 }];
  const quote = await b.api('POST', '/api/quote', { body: { items, shipping: 'home' }, ip: '10.41.0.1' });
  assert.equal(quote.status, 200);
  assert.equal((await b.checkout('TEST-M', '10.41.0.2')).status, 200); // un autre client prend la M
  const res = await b.checkout(null, '10.41.0.1', { items, quote });
  assert.deepEqual([res.status, res.body.error], [409, 'held']);
  assert.deepEqual(await b.inv('TEST-S'), [1, 0], 'la S n’est pas restée bloquée');
  assert.equal(await b.count("SELECT COUNT(*) FROM orders WHERE status = 'pending'"), 1);
});

test('W04 doublons simultanés : une seule réservation ; contenu modifié avec la même clé refusé', async () => {
  const b = await bench({ 'TEST-M': 3 });
  const quote = await b.quote([{ sku: 'TEST-M', quantity: 1 }], { ip: '10.42.0.1' });
  const res = await parallel(5, () => b.checkout('TEST-M', '10.42.0.1', { quote, key: 'cle-identique-0001' }));
  assert.ok(res.some((r) => r.status === 200));
  assert.ok(res.every((r) => r.status === 200 || r.body.error === 'checkout_in_progress'));
  assert.deepEqual(await b.inv('TEST-M'), [3, 1]);
  const again = await b.checkout('TEST-M', '10.42.0.1', { quote, key: 'cle-identique-0001' });
  assert.equal(again.status, 200);
  assert.equal(new Set(res.filter((r) => r.status === 200).map((r) => r.body.url).concat(again.body.url)).size, 1);
  const otherQuote = await b.quote([{ sku: 'TEST-M', quantity: 1 }], { ip: '10.42.0.1', shipping: 'relay', relay_id: 'TEST-RELAY-1' });
  const changed = await b.checkout('TEST-M', '10.42.0.1', { quote: otherQuote, shipping: 'relay', relay_id: 'TEST-RELAY-1', key: 'cle-identique-0001' });
  assert.deepEqual([changed.status, changed.body.error], [409, 'idempotency_conflict']);
  assert.equal(b.stripe.created, 1);
});

test('W05 signature : corps brut, tolérance, plusieurs signatures v1 (une seule valide suffit)', async () => {
  const b = await bench({ 'TEST-M': 1 });
  const { sid } = await b.checkout('TEST-M', '10.43.0.1');
  b.stripe.pay(sid);
  const raw = JSON.stringify(event('checkout.session.completed', sid));
  const good = sign(raw, b.clock.now(), b.env.STRIPE_WEBHOOK_SECRET);
  const header = `${good},v1=${'0'.repeat(64)}`;
  const send = (h, body = raw) => handleOps(new Request(`${ORIGIN}/webhooks/stripe`, { method: 'POST', body, headers: { 'Stripe-Signature': h } }), b.env, { deps: b.deps });
  assert.equal((await send(`t=${b.clock.now()},v1=${'0'.repeat(64)}`)).status, 400);
  assert.equal((await send(header, raw.replace('completed', 'expired'))).status, 400);
  assert.equal((await send(header)).status, 200);
});

test('W07 montant, devise ou lignes inattendus : la commande passe « à vérifier », aucune pièce attribuée', async () => {
  const b = await bench({ 'TEST-M': 1 });
  const { sid } = await b.checkout('TEST-M', '10.44.0.1');
  b.stripe.pay(sid);
  b.stripe.sessions.get(sid).amount_total = 100;
  await b.webhook(event('checkout.session.completed', sid));
  assert.equal(await b.count('SELECT status FROM orders'), 'review');
  assert.equal(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'payment_mismatch' AND level = 'critical'"), 1);
  assert.deepEqual(await b.inv('TEST-M'), [1, 1], 'pièce gardée jusqu’à la décision du fondateur');
});

test('W09 réponse Stripe incertaine : la reprise avec la même clé retrouve la même session', async () => {
  const b = await bench({ 'TEST-M': 1 });
  const quote = await b.quote([{ sku: 'TEST-M', quantity: 1 }], { ip: '10.45.0.1' });
  b.stripe.loseResponse = true;
  const first = await b.checkout('TEST-M', '10.45.0.1', { quote, key: 'cle-reprise-000001' });
  b.stripe.loseResponse = false;
  const retry = await b.checkout('TEST-M', '10.45.0.1', { quote, key: 'cle-reprise-000001' });
  assert.deepEqual([first.status, retry.status, b.stripe.created], [503, 200, 1]);
  assert.deepEqual(await b.inv('TEST-M'), [1, 1]);
});

test('W10 réponse de la base perdue après validation : la reprise ne réserve pas une seconde fois', async () => {
  const b = await bench({ 'TEST-M': 2 });
  const quote = await b.quote([{ sku: 'TEST-M', quantity: 1 }], { ip: '10.46.0.1' });
  b.db.state.loseResponseWhen = (texts) => texts.some((t) => t.includes('INSERT INTO reservations'));
  const first = await b.checkout('TEST-M', '10.46.0.1', { quote, key: 'cle-base-perdue-01' });
  const retry = await b.checkout('TEST-M', '10.46.0.1', { quote, key: 'cle-base-perdue-01' });
  assert.deepEqual([first.status, retry.status], [503, 200]);
  assert.deepEqual(await b.inv('TEST-M'), [2, 1]);
  assert.equal(await b.count('SELECT COUNT(*) FROM reservations'), 1);
});

test('W11 webhook avec Stripe injoignable : 500, rien d’enregistré, puis traité au renvoi', async () => {
  const b = await bench({ 'TEST-M': 1 });
  const { sid } = await b.checkout('TEST-M', '10.47.0.1');
  b.stripe.pay(sid);
  const ev = event('checkout.session.completed', sid);
  b.stripe.down = true;
  assert.equal(await b.webhook(ev), 500);
  assert.equal(await b.count('SELECT COUNT(*) FROM processed_events'), 0);
  b.stripe.down = false;
  assert.equal(await b.webhook(ev), 200);
  assert.equal(await b.count("SELECT COUNT(*) FROM orders WHERE status = 'paid'"), 1);
});

test('W13 retour borné : impossible de remettre en stock plus que la quantité vendue', async () => {
  const b = await bench({ 'TEST-M': 2 });
  await b.buy('TEST-M', '10.48.0.1');
  const oid = await b.count('SELECT id FROM orders');
  await assert.rejects(run(b, (ctx, deps) => inspectReturn(ctx, { orderId: oid, sku: 'TEST-M', quantity: 2, resellable: true, actor: 'fondateur' }, deps)),
    (e) => e.extra?.reason === 'return_quantity_exceeded');
  assert.deepEqual(await b.inv('TEST-M'), [1, 0]);
});

test('W14 ajustements : jamais sous les réservations ; deux écrans simultanés = un seul gagne', async () => {
  const b = await bench({ 'TEST-M': 2 });
  await b.checkout('TEST-M', '10.49.0.1');
  const rev = await b.count("SELECT revision FROM inventory WHERE sku = 'TEST-M'");
  await assert.rejects(adjustStock(b.real, { sku: 'TEST-M', delta: -2, expectedRevision: rev, actor: 'f', note: 'casse', now: 1 }), (e) => e.code === 'quantity_below_reservations');
  const res = await parallel(5, (i) => adjustStock(b.real, { sku: 'TEST-M', delta: 1, expectedRevision: rev, actor: 'f', note: `écran ${i}`, now: 1 }).then(() => 'ok', (e) => e.code));
  assert.deepEqual(res.sort(), ['ok', 'stale_revision', 'stale_revision', 'stale_revision', 'stale_revision']);
  assert.deepEqual(await b.inv('TEST-M'), [3, 1]);
});

test('W15 écritures publiques : autre origine, sans origine, mauvais type ou corps trop gros refusés', async () => {
  const b = await bench({ 'TEST-M': 1 });
  const post = (headers, body = '{"items":[]}') => handlePublicApi(new Request(`${ORIGIN}/api/quote`, { method: 'POST', body, headers }), b.env, { deps: b.deps });
  assert.equal((await post({ 'Content-Type': 'application/json', Origin: 'https://exemple-malveillant.test' })).status, 403);
  assert.equal((await post({ 'Content-Type': 'application/json' })).status, 403);
  assert.equal((await post({ 'Content-Type': 'text/plain', Origin: ORIGIN })).status, 415);
  assert.equal((await post({ 'Content-Type': 'application/json', Origin: ORIGIN }, JSON.stringify({ pad: 'x'.repeat(20000) }))).status, 413);
});

test('W16 paiements réels et quantités non vérifiées : tout reste fermé par défaut', async () => {
  assert.equal(stripeReady({ STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x', ENVIRONMENT: 'staging' }), false);
  assert.equal(stripeReady({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x', ENVIRONMENT: 'production' }), false);
  assert.equal(stripeReady({ STRIPE_SECRET_KEY: 'sk_test_x', ENVIRONMENT: 'staging' }), false);
  const b = await bench({ 'TEST-M': 1 }, { payments: false });
  const r = await b.checkout('TEST-M', '10.50.0.1');
  assert.deepEqual([r.status, r.body.error, b.stripe.created], [403, 'payments_disabled', 0]);
  const fresh = await bench({ 'TEST-M': 1 }, { mode: 'paused' });
  const stock = await fresh.api('GET', '/api/stock?product_id=test-001');
  assert.deepEqual([stock.body.mode, stock.body.checkout_enabled], ['paused', false]);
  const migrated = await bench({}, { catalogSeed: true, mode: 'paused', payments: false });
  await migrated.real.prepare("UPDATE settings SET value = 'paused' WHERE key = 'shop_mode'").run();
  const seeded = await publicStock(migrated.real, 'pink-001', migrated.clock.now());
  assert.deepEqual([seeded.verified, seeded.drop_status, seeded.checkout_enabled], [false, 'unavailable', false]);
  const settings = Object.fromEntries((await migrated.rows('SELECT key, value FROM settings')).map((s) => [s.key, s.value]));
  assert.deepEqual([settings.payments_enabled], ['0']);
});

// ---------- contrat commun ----------
async function workClient(b) {
  const source = await readFile(new URL('../../public/store/api-client.js', import.meta.url), 'utf8');
  const fetchImpl = (path, init) => handlePublicApi(new Request(new URL(path, ORIGIN), { ...init,
    headers: { ...init.headers, Origin: ORIGIN, 'CF-Connecting-IP': '10.60.0.1' } }), b.env, { deps: b.deps, catalog });
  const context = vm.createContext({ module: { exports: {} }, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, fetch: fetchImpl });
  vm.runInContext(source, context);
  const api = context.module.exports;
  return { api, client: api.createClient({ fetchImpl, checkoutEnabled: true }) };
}

test('C01 le lecteur de stock de la boutique accepte la réponse du serveur (disponible, réservé, SOLD OUT, inconnu)', async () => {
  const b = await bench({ 'TEST-S': 1, 'TEST-M': 0, 'TEST-L': 0 });
  b.clock.t = Math.floor(Date.now() / 1000);
  const { api, client } = await workClient(b);
  const skus = ['TEST-S', 'TEST-M', 'TEST-L'];
  let view = api.normalizeStock(await client.stock('test-001'), skus);
  assert.deepEqual([view.status, view.total], ['available', 1]);
  await b.checkout('TEST-S', '10.61.0.1');
  view = api.normalizeStock(await client.stock('test-001'), skus);
  assert.deepEqual([view.status, view.total], ['held', 0]);
  const { sid } = (await b.rows("SELECT stripe_session_id AS sid FROM orders"))[0];
  b.stripe.pay(sid);
  await b.webhook(event('checkout.session.completed', sid));
  view = api.normalizeStock(await client.stock('test-001'), skus);
  assert.deepEqual([view.status, view.total], ['sold_out', 0]);
  const unknown = await bench({ 'TEST-S': null, 'TEST-M': 0, 'TEST-L': 0 });
  unknown.clock.t = b.clock.t;
  const other = await workClient(unknown);
  assert.equal(other.api.normalizeStock(await other.client.stock('test-001'), skus).total, null);
});

test('C02 parcours complet avec le vrai client : devis serveur, checkout idempotent, redirection Stripe', async () => {
  const b = await bench({ 'TEST-M': 2 });
  b.clock.t = Math.floor(Date.now() / 1000);
  const { api, client } = await workClient(b);
  const stock = api.normalizeStock(await client.stock('test-001'), ['TEST-M']);
  const input = { items: [{ sku: 'TEST-M', quantity: 1 }], shipping: 'home', terms_version: '2026-11', turnstile: 'jeton-test' };
  const quote = await client.quote({ items: input.items, shipping: 'home' });
  assert.deepEqual([quote.currency, quote.total_cents, quote.shipping_cents], ['EUR', 8350, 850]);
  const result = await client.checkout(input, { stock, quote, idempotencyKey: 'cle-client-boutique-01' });
  assert.match(result.url, /^https:\/\/checkout\.stripe\.com\//);
  assert.match(result.order_reference, /^SL-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  const again = await client.checkout(input, { stock, quote, idempotencyKey: 'cle-client-boutique-01' });
  assert.equal(again.url, result.url);
  await assert.rejects(client.checkout({ ...input, shipping: 'relay', relay_id: 'TEST-RELAY-1' }, { stock, quote, idempotencyKey: 'cle-client-boutique-02' }),
    (e) => e.code === 'quote_mismatch');
  assert.deepEqual(await b.inv('TEST-M'), [2, 1]);
});

test('C03 catalogue : la base (prix, tailles, livraison) correspond à data/products.json', async () => {
  const b = await bench({}, { catalogSeed: true });
  const product = catalog.products[0];
  assert.equal(await b.count('SELECT price_cents FROM products WHERE id = ?', product.id), product.price_cents);
  assert.deepEqual((await b.rows('SELECT sku FROM variants ORDER BY position')).map((r) => r.sku), product.variants.map((v) => v.sku));
  for (const rate of catalog.shipping_reference) assert.equal(await b.count('SELECT cents FROM shipping_rates WHERE method = ?', rate.id), rate.price_cents);
  const res = await b.api('GET', '/api/catalog', { catalog });
  assert.equal(res.body.products[0].price_cents, product.price_cents);
  assert.equal(await b.count('SELECT COUNT(*) FROM inventory WHERE confirmed_at IS NOT NULL OR on_hand <> 0'), 0, 'aucune quantité dans les migrations');
});

test('C04 suivi, recherche de commande et demandes : refus explicite tant que non raccordés (jamais de faux succès)', async () => {
  const b = await bench({ 'TEST-M': 1 });
  for (const [method, path] of [['POST', '/api/order/lookup'], ['POST', '/api/requests'], ['GET', '/api/order']]) {
    const r = await b.api(method, path, method === 'POST' ? { body: { type: 'contact' } } : undefined);
    assert.deepEqual([r.status, r.body.error], [503, 'not_configured']);
  }
  const relays = await b.api('GET', '/api/relay-points?postcode=75016&country=FR');
  assert.equal(relays.status, 200);
  b.deps.relays = null;
  const none = await b.api('GET', '/api/relay-points?postcode=75016&country=FR');
  assert.deepEqual([none.status, none.body.error], [503, 'relay_unavailable']);
});
