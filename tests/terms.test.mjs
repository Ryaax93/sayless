import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
const context = vm.createContext({ module: { exports: {} }, URL, URLSearchParams, TextEncoder, crypto, AbortController, setTimeout, clearTimeout });
vm.runInContext(await readFile('public/store/api-client.js', 'utf8'), context);
const contract = context.module.exports;
context.module = { exports: {} };
vm.runInContext(await readFile('public/store/checkout-flow.js', 'utf8'), context);
const { createFlow } = context.module.exports;
const body = 'TEST UNIQUEMENT — CGV\r\n\r\n  Les espaces et accents restent identiques.\n<script>alert("texte")</script>\n' + 'Clause de recette sans valeur contractuelle.\n'.repeat(7);
const hash = (s) => createHash('sha256').update(s).digest('hex');
const doc = { version: 'test-v14', sha256: hash(body), current: true, format: 'text/plain', published_at: new Date().toISOString(), body };
const selection = { items: [{ sku: 'ZH-PINK-M', quantity: 1 }], shipping: 'home', postcode: '75011', country: 'FR', relay_id: null };
const quote = { id: 'signed-fixture', currency: 'EUR', terms_version: doc.version, terms_sha256: doc.sha256, terms_url: '/api/terms/' + doc.version,
  items: [{ sku: 'ZH-PINK-M', quantity: 1, unit_price_cents: 7500, line_total_cents: 7500 }], shipping: 'home', relay: null,
  subtotal_cents: 7500, shipping_cents: 850, total_cents: 8350, expires_at: new Date(Date.now() + 600000).toISOString() };
function fixture() {
  const calls = [], storage = new Map(); let document = { ...doc }, responseFailure = false;
  const api = contract.createClient({ checkoutEnabled: true, fetchImpl: async (path, init) => {
    calls.push({ path, init });
    if (path.startsWith('/api/terms')) return new Response(JSON.stringify(document), { status: responseFailure ? 503 : 200 });
    if (path === '/api/quote') return new Response(JSON.stringify(quote));
    return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/test', order_reference: 'SL-TEST-TEST', expires_at: quote.expires_at }));
  } });
  const options = { api, contract, storage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
    newKey: () => 'fixture-same-key-0001', getStock: async () => ({ status: 'available', checkoutEnabled: true, updatedAt: Date.now(), variants: [{ sku: 'ZH-PINK-M', state: 'available', orderable: 1 }] }) };
  const flow = createFlow(options);
  return { api, flow, calls, options, storage, change: d => { document = { ...doc, ...d }; }, fail: () => { responseFailure = true; },
    ready: async () => { flow.select(selection); await flow.quote(); flow.accept(true); } };
}
test('v1.4 : document exact, SHA-256 Web Crypto et requête sans cache sur la version du devis', async () => {
  const f = fixture(); const d = await f.api.termsForQuote(quote);
  assert.equal(d.body, body); assert.equal(d.sha256, hash(body));
  assert.equal(f.calls[0].path, quote.terms_url); assert.equal(f.calls[0].init.cache, 'no-store');
  assert.equal((await f.api.terms()).version, doc.version); assert.equal(f.calls[1].path, '/api/terms');
});
for (const [name, change] of Object.entries({ texte: { body: body + ' ' }, empreinte: { sha256: '0'.repeat(64) }, version: { version: 'autre' }, format: { format: 'text/html' }, vide: { body: '' }, trop_long: { body: 'a'.repeat(200001) }, date: { published_at: 'invalide' }, etat: { current: null } })) {
  test('v1.4 : refus du document invalide — ' + name, async () => { const f = fixture(); f.change(change); await assert.rejects(f.api.termsForQuote(quote), e => e.code === 'terms_invalid'); assert.equal(f.calls.filter(c => c.path === '/api/checkout').length, 0); });
}
test('v1.4 : empreinte cohérente avec le document mais différente du devis refusée', async () => {
  const f = fixture(); f.change({ body: body + 'test', sha256: hash(body + 'test') }); await assert.rejects(f.api.termsForQuote(quote), e => e.code === 'terms_invalid');
});
test('v1.4 : aucune URL externe, relative détournée ou autre version n’est téléchargée', async () => {
  const f = fixture(); for (const url of ['https://evil.invalid/doc', '//evil.invalid', '/api/terms/other', quote.terms_url + '?x=1', '/api/terms/../stock'])
    await assert.rejects(f.api.termsForQuote({ ...quote, terms_url: url }), e => e.code === 'terms_invalid');
  assert.equal(f.calls.length, 0);
});
test('v1.4 : Web Crypto absent bloque proprement le consentement', async () => {
  const c = contract.createClient({ cryptoImpl: null, fetchImpl: async () => new Response(JSON.stringify(doc)) });
  await assert.rejects(c.terms(), e => e.code === 'terms_unverifiable');
});
test('v1.4 : CGV indisponibles, changées ou consentement retiré avant réservation bloquent le paiement', async () => {
  for (const failure of ['changed','unavailable']) {
    const f = fixture(); await f.ready(); if (failure === 'changed') f.change({ current: false }); else f.fail();
    await assert.rejects(f.flow.submit({ termsVersion: doc.version, turnstile: 'fixture' }));
    assert.equal(f.flow.state.accepted, false); assert.equal(f.flow.state.attempt, null); assert.equal(f.flow.state.terms, null);
    assert.equal(f.calls.filter(c => c.path === '/api/checkout').length, 0);
  }
  const f = fixture();
  const flow = createFlow({ ...f.options, getStock: async () => { flow.accept(false); return f.options.getStock(); } });
  flow.select(selection); await flow.quote(); flow.accept(true);
  await assert.rejects(flow.submit({ termsVersion: doc.version, turnstile: 'fixture' }), e => e.code === 'terms_required');
  assert.equal(flow.state.attempt, null); assert.equal(f.calls.filter(c => c.path === '/api/checkout').length, 0);
});
test('v1.4 : version et empreinte transmises, double clic partagé et reprise sans relire les nouvelles CGV', async () => {
  const f = fixture(); await f.ready();
  const a = f.flow.submit({ termsVersion: doc.version, turnstile: 'fixture' });
  const b = f.flow.submit({ termsVersion: doc.version, turnstile: 'fixture' }); assert.equal(a,b); await a;
  const first = f.calls.find(c => c.path === '/api/checkout'); const sent = JSON.parse(first.init.body);
  assert.equal(sent.terms_sha256, doc.sha256); assert.equal(sent.terms_version, doc.version);
  f.fail(); const count = f.calls.length; const restored = createFlow(f.options); await restored.submit();
  assert.equal(f.calls.length, count + 1); const retry = f.calls.at(-1);
  assert.equal(retry.path, '/api/checkout'); assert.equal(retry.init.headers['Idempotency-Key'], first.init.headers['Idempotency-Key']);
  const expected = { ...sent }; delete expected.turnstile; assert.deepEqual(JSON.parse(retry.init.body), expected);
});
test('v1.4 : résultat CGV tardif après changement de livraison ignoré', async () => {
  const f = fixture(); let resolve;
  const flow = createFlow({ ...f.options, api: { ...f.api, termsForQuote: () => new Promise(r => { resolve = r; }) } });
  flow.select(selection); const pending = flow.quote(); await new Promise(r => setTimeout(r, 0));
  flow.select({ ...selection, postcode: '69001' }); resolve(doc); assert.equal(await pending, null); assert.equal(flow.state.terms, null); assert.equal(flow.state.accepted, false);
});
test('v1.4 : un nouveau devis sans empreinte est refusé ; une tentative ancienne conserve sa forme originale', async () => {
  const f = fixture(); assert.equal(contract.validQuote({ ...quote, terms_sha256: undefined }, selection), false);
  await f.ready(); await f.flow.submit({ termsVersion: doc.version, turnstile: 'fixture' });
  const [key, raw] = [...f.storage][0]; const a = JSON.parse(raw); delete a.input.terms_sha256; delete a.quote.terms_sha256; delete a.quote.terms_url;
  f.storage.set(key, JSON.stringify(a)); const restored = createFlow(f.options); f.fail(); await restored.submit();
  assert.ok(!('terms_sha256' in JSON.parse(f.calls.at(-1).init.body)));
});
test('v1.4 : page CGV rend le texte brut sans injection, même pour une archive ancienne', async () => {
  const nodes = { '#terms-document': { textContent: '', isConnected: true }, '#terms-status': { textContent: '' }, '[data-reload-terms]': { hidden: false } };
  let requested;
  const c = vm.createContext({ document: { querySelector: s => nodes[s], addEventListener() {} }, URLSearchParams,
    location: { hash: '#/cgv?v=test-v14' }, window: { SaylessAPI: { terms: async v => { requested = v; return { ...doc, current: false }; } } } });
  vm.runInContext(await readFile('public/store/legal.js', 'utf8'), c); await c.mountTermsDocument();
  assert.equal(requested, doc.version); assert.equal(nodes['#terms-document'].textContent, body); assert.match(nodes['#terms-status'].textContent, /archivé/);
  assert.ok(!('innerHTML' in nodes['#terms-document']));
});
