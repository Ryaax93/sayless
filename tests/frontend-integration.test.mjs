import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { bench, startDatabases, stopDatabases, ORIGIN, event } from './backend/helpers.mjs';
import { recordInventory } from '../backend/src/stock.mjs';
import { publishTerms } from '../backend/src/terms.mjs';
import { handlePublicApi } from '../backend/src/routes.mjs';

async function loadClient(name) {
  const context = vm.createContext({
    module: { exports: {} },
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    crypto, TextEncoder,
  });
  vm.runInContext(await readFile(new URL('../public/store/' + name, import.meta.url), 'utf8'), context);
  return context.module.exports;
}
const [contract, controller, catalogClient] = await Promise.all(
  ['api-client.js', 'checkout-flow.js', 'catalog.js'].map(loadClient),
);
const catalog = JSON.parse(await readFile(new URL('../data/products.json', import.meta.url)));
const skus = catalog.products[0].variants.map((v) => v.sku);
const selection = {
  items: [{ sku: skus[1], quantity: 1 }],
  shipping: 'home',
  country: 'FR',
  postcode: '75011',
};
const terms = 'recette-locale';
const credentials = { termsVersion: terms, turnstile: 'jeton-de-recette' };
before(startDatabases);
after(stopDatabases);

// Le client expédie du HTTP au vrai routeur de la PR. Seuls les services externes et les unités de recette sont simulés.
async function fixture({ counted = true, payments = true, dropResponse = false } = {}) {
  const b = await bench({}, { catalogSeed: true, payments });
  b.clock.t = Math.floor(Date.now() / 1000);
  const now = () => b.clock.now() * 1000;
  if (counted)
    await recordInventory(b.real, {
      counts: Object.fromEntries(skus.map((sku, i) => [sku, [2, 1, 0][i]])),
      actor: 'recette',
      note: 'Base éphémère uniquement',
      now: b.clock.t,
    });
  await publishTerms(b.real, { version: terms, body: 'Conditions de recette uniquement. '.repeat(10), actor: 'recette', now: b.clock.t });
  const requests = [];
  const fetchImpl = async (path, init) => {
    const headers = new Headers(init.headers);
    headers.set('Origin', ORIGIN);
    const req = new Request(ORIGIN + path, { ...init, headers });
    requests.push({
      path,
      method: req.method,
      key: headers.get('Idempotency-Key'),
      body: init.body && JSON.parse(init.body),
    });
    const result = await handlePublicApi(req, b.env, { deps: b.deps, catalog });
    if (dropResponse && path === '/api/checkout' && result.ok) {
      dropResponse = false;
      throw new Error('Réponse perdue en transit dans le banc de recette');
    }
    return result;
  };
  const api = contract.createClient({ now, fetchImpl, checkoutEnabled: true });
  const product = catalogClient.dropProduct(await api.catalog());
  const stock = async () =>
    contract.normalizeStock(await api.stock(product.id), [...product.variants.values()], now());
  const flow = controller.createFlow({ api, contract, now, getStock: stock });
  async function quote(input = selection) {
    flow.select(input);
    return flow.quote();
  }
  return { b, api, product, stock, flow, quote, requests };
}

test('catalogue publié, total disponible non plafonné et refus des variantes hors catalogue', async () => {
  const { b, api, product, stock } = await fixture();
  assert.equal(product.priceCents, 7500);
  assert.equal((await stock()).total, 3);
  assert.equal((await stock()).variants.find((v) => v.sku === skus[0]).orderable, 1);
  assert.equal((await stock()).variants.find((v) => v.sku === skus[2]).state, 'sold_out');
  await b.real.prepare("UPDATE products SET status='draft' WHERE id='pink-001'").run();
  assert.equal(catalogClient.dropProduct(await api.catalog()), null);
});

test('inventaire non confirmé, pause et panne D1 ferment le parcours', async () => {
  const { stock, b } = await fixture({ counted: false });
  assert.equal((await stock()).total, null);
  await b.real.prepare("UPDATE settings SET value='paused' WHERE key='shop_mode'").run();
  assert.equal((await stock()).status, 'paused');
  b.db.state.down = true;
  await assert.rejects(stock, (e) => e.status === 503);
});

test('domicile, devis signé à 83,50 €, CGV et coordonnées demandées uniquement sur Stripe', async () => {
  const { quote, flow, requests, b } = await fixture();
  const q = await quote();
  assert.deepEqual([q.subtotal_cents, q.shipping_cents, q.total_cents], [7500, 850, 8350]);
  await assert.rejects(flow.submit(credentials), (e) => e.code === 'terms_required');
  flow.accept(true);
  await assert.rejects(flow.submit({ termsVersion: terms }), (e) => e.code === 'challenge_required');
  const result = await flow.submit(credentials);
  const params = b.stripe.sessions.get(result.url.split('/').at(-1)).params;
  assert.equal(params['shipping_address_collection[allowed_countries][0]'], 'FR');
  assert.equal(params['payment_method_types[0]'], 'card');
  const sent = requests.find((r) => r.path === '/api/checkout');
  assert.deepEqual(Object.keys(sent.body).sort(), [
    'items',
    'quote_id',
    'relay_id',
    'shipping',
    'terms_sha256',
    'terms_version',
    'turnstile',
  ]);
  assert.equal(sent.body.quote_id, q.id);
  assert.deepEqual(await b.inv(skus[1]), [1, 1]);
});

test('relais du fournisseur, devis à 79,90 €, revalidation du point et panne sans solution fictive', async () => {
  const { b, api, quote, flow } = await fixture();
  const { points } = await api.relayPoints({ postcode: '75016' });
  assert.ok(points[0].id);
  const input = { ...selection, shipping: 'relay', relay_id: points[0].id, postcode: '75016' };
  const q = await quote(input);
  assert.equal(q.relay.id, points[0].id);
  assert.equal(q.total_cents, 7990);
  flow.accept(true);
  const result = await flow.submit(credentials);
  assert.equal(
    b.stripe.sessions.get(result.url.split('/').at(-1)).params['custom_fields[0][key]'],
    'recipient_name',
  );
  b.deps.relays = null;
  await assert.rejects(api.relayPoints({ postcode: '75016' }), (e) => e.code === 'relay_unavailable');
  await assert.rejects(api.quote(input), (e) => e.code === 'relay_unavailable' || e.code === 'held');
});

test('le client et le serveur refusent hors zone, deux pièces et une taille épuisée', async () => {
  const { api, quote, requests } = await fixture();
  await assert.rejects(
    quote({ ...selection, postcode: '20000' }),
    (e) => e.code === 'destination_not_supported',
  );
  assert.ok(!requests.some((r) => r.path === '/api/quote'));
  await assert.rejects(
    api.quote({ ...selection, postcode: '97400' }),
    (e) => e.code === 'destination_not_supported',
  );
  await assert.rejects(
    api.quote({ ...selection, items: [{ sku: skus[1], quantity: 2 }] }),
    (e) => e.code === 'quantity_not_supported',
  );
  await assert.rejects(
    api.quote({ ...selection, items: [{ sku: skus[2], quantity: 1 }] }),
    (e) => e.code === 'sold_out',
  );
});

test('double clic puis perte de la réponse, même tentative et une seule réservation', async () => {
  const { b, quote, flow, requests } = await fixture({ dropResponse: true });
  await quote();
  flow.accept(true);
  const first = flow.submit(credentials);
  assert.equal(flow.submit(credentials), first);
  await assert.rejects(first, (e) => e.code === 'service_unavailable');
  const result = await flow.submit();
  assert.match(result.order_reference, contract.orderRef);
  const attempts = requests.filter((r) => r.path === '/api/checkout');
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].key, attempts[1].key);
  assert.equal(attempts[1].body.turnstile, undefined);
  assert.equal(b.stripe.created, 1);
  assert.deepEqual(await b.inv(skus[1]), [1, 1]);
});

test('confirmation avec la paire attendue, statut en attente puis paiement confirmé une seule fois', async () => {
  const { b, quote, flow, api } = await fixture();
  await quote();
  flow.accept(true);
  const result = await flow.submit(credentials);
  const sid = result.url.split('/').at(-1);
  const pair = { order_reference: result.order_reference, session_id: sid };
  await assert.rejects(
    api.checkoutStatus({ ...pair, session_id: 'cs_test_sans_commande' }),
    (e) => e.code === 'not_found',
  );
  assert.equal(controller.returnState(await api.checkoutStatus(pair)), 'pending');
  b.stripe.pay(sid, { method: 'simulation_en_traitement' });
  assert.equal(controller.returnState(await api.checkoutStatus(pair)), 'processing');
  b.stripe.asyncResult(sid, true);
  const notice = event('checkout.session.async_payment_succeeded', sid);
  assert.equal(await b.webhook(notice), 200);
  assert.equal(await b.webhook(notice), 200);
  const status = await api.checkoutStatus(pair);
  assert.equal(controller.returnState(status), 'paid');
  assert.deepEqual(Object.keys(status).sort(), ['order_reference', 'payment_status', 'updated_at']);
  assert.deepEqual(await b.inv(skus[1]), [0, 0]);
});

test('paramètres désactivés, CGV obsolètes et suivi indisponible donnent des refus explicites', async () => {
  const closed = await fixture({ payments: false });
  await closed.quote();
  closed.flow.accept(true);
  await assert.rejects(closed.flow.submit(credentials), (e) => e.code === 'stock_unavailable');
  assert.equal(closed.b.stripe.created, 0);
  const { api, quote, flow } = await fixture();
  await quote();
  flow.accept(true);
  await assert.rejects(
    flow.submit({ ...credentials, termsVersion: 'ancienne-version' }),
    (e) => e.code === 'terms_outdated',
  );
  await assert.rejects(
    api.lookupOrder({ reference: 'SL-TEST-TEST', email: 'recette@example.invalid' }),
    (e) => e.code === 'not_configured',
  );
});

test('v1.3 : changement serveur des CGV entre devis et paiement, nouveau consentement requis', async () => {
  const { b, flow, quote, requests } = await fixture();
  const q = await quote(); assert.equal(q.terms_version, terms); flow.accept(true);
  await b.real.prepare("UPDATE settings SET value='version-suivante' WHERE key='terms_version'").run();
  await assert.rejects(flow.submit(credentials), e => e.code === 'terms_outdated');
  assert.equal(flow.state.accepted, false); assert.equal(b.stripe.created, 0);
  assert.equal(requests.filter(r => r.path === '/api/checkout').length, 0, 'changement détecté avant toute réservation');
});
test('v1.3 : réponse perdue et devis expiré, puis tentative payée retrouvée sans nouveau stock', async () => {
  const { b, flow, quote } = await fixture({ dropResponse: true });
  await quote(); flow.accept(true); await assert.rejects(flow.submit(credentials));
  b.clock.t += 660;
  const result = await flow.submit(); assert.equal(b.stripe.created, 1);
  const sid = result.url.split('/').at(-1); b.stripe.pay(sid);
  await b.webhook(event('checkout.session.completed', sid));
  await assert.rejects(flow.submit(), e => e.code === 'attempt_closed');
  assert.equal(flow.state.closed.payment_status, 'paid'); assert.equal(flow.state.closed.session_id, sid);
  assert.equal(flow.state.attempt.order_reference, result.order_reference);
  assert.equal(b.stripe.created, 1); assert.deepEqual(await b.inv(skus[1]), [0, 0]);
});
test('v1.3 : adresses des relais identiques dans la recherche, le devis et la commande', async () => {
  const { b, api, quote, flow } = await fixture();
  const point = (await api.relayPoints({ postcode: '75016' })).points[0];
  assert.equal(contract.validRelay(point), true);
  const q = await quote({ ...selection, shipping: 'relay', relay_id: point.id, postcode: point.postcode });
  assert.deepEqual(q.relay.address, point.address); flow.accept(true); await flow.submit(credentials);
  const row = await b.real.prepare('SELECT relay_snapshot FROM orders LIMIT 1').first();
  assert.deepEqual(JSON.parse(row.relay_snapshot).address, point.address);
});
test('v1.3 : suivi authentifié, jeton expiré et lien non énumérable avec e-mails simulés', async () => {
  const { b, api, quote, flow } = await fixture();
  b.env.RESEND_API_KEY = 'fixture-only'; b.env.EMAIL_FROM = 'recette@example.invalid';
  const sent = [];
  b.deps.senders = { email: async (payload, row) => {
    const { openPayload } = await import('../backend/src/security.mjs');
    sent.push(await openPayload({ ...b.env, db: b.db }, payload, 'outbox:'+row.dedupe));
  } };
  await quote(); flow.accept(true); const result = await flow.submit(credentials);
  const sid = result.url.split('/').at(-1); b.stripe.pay(sid); await b.webhook(event('checkout.session.completed', sid));
  const valid = await api.lookupOrder({ reference: result.order_reference, email: 'client.test@example.invalid' });
  const invalid = await api.lookupOrder({ reference: result.order_reference, email: 'unknown@example.invalid' });
  assert.deepEqual(valid, invalid); assert.equal(valid.accepted, true);
  const linkMail = sent.find(m => m.text.includes('/#/suivi?t=')); assert.ok(linkMail);
  const token = linkMail.text.match(/\/\#\/suivi\?t=([A-Za-z0-9_-]+)/)[1];
  const order = await api.order(token); assert.equal(order.order_reference, result.order_reference); assert.equal(order.payment_status, 'paid');
  assert.ok(!JSON.stringify(order).includes('client.test@example.invalid'));
  b.clock.t += 1801; await assert.rejects(api.order(token), e => e.code === 'unauthenticated');
});
test('v1.3 : contact, retour et rétractation enregistrés chiffrés, accusés en file sans vrai envoi', async () => {
  const { b, api } = await fixture();
  b.env.RESEND_API_KEY = 'fixture-only'; b.env.EMAIL_FROM = 'recette@example.invalid'; b.deps.sendNow = async () => {};
  for (const type of ['contact', 'return', 'withdrawal']) {
    const receipt = await api.request({ type, name: 'RECETTE UNIQUEMENT', email: 'recette@example.invalid', message: type === 'withdrawal' ? '' : 'Message de recette uniquement', turnstile: 'fixture' });
    assert.match(receipt.reference, /^R-/); assert.equal(receipt.type, type);
  }
  const rows = await b.rows('SELECT * FROM customer_requests'); assert.equal(rows.length, 3); assert.ok(!JSON.stringify(rows).includes('recette@example.invalid'));
  assert.equal(await b.count("SELECT COUNT(*) FROM outbox WHERE channel='email' AND dedupe LIKE 'email:request_ack:%'"), 3);
  await assert.rejects(api.request({ type: 'contact', email: 'not-an-email', message: 'Test', turnstile: 'fixture' }), e => e.code === 'invalid_request' && e.details.field === 'email');
});
