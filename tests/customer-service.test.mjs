import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const load = async name => { const c = vm.createContext({ module: { exports: {} }, URL, URLSearchParams, AbortController, setTimeout, clearTimeout }); vm.runInContext(await readFile(new URL('../public/store/'+name, import.meta.url), 'utf8'), c); return c.module.exports; };
const service = await load('customer-service.js'), contract = await load('api-client.js');
test('suivi : jeton unique dans le fragment, jamais dans les paramètres de requête', () => {
  const token = 'a'.repeat(43);
  assert.equal(service.trackingToken('#/suivi?t='+token), token);
  for (const hash of ['?t='+token, '#/suivi?t=bad', '#/suivi?t='+token+'&t='+token, '#/contact?t='+token]) assert.equal(service.trackingToken(hash), null);
});
test('suivi : jeton transmis uniquement dans Authorization, réponse sans données personnelles validée', async () => {
  let sent;
  const data = { order_reference: 'SL-TEST-TEST', payment_status: 'paid', items: [{ size: 'M', quantity: 1 }], shipping: 'home', relay: null, steps: [], tracking: null, updated_at: new Date().toISOString() };
  const api = contract.createClient({ fetchImpl: async (url, options) => { sent = { url, options }; return { ok: true, json: async () => data }; } });
  await api.order('a'.repeat(43)); assert.equal(sent.url, '/api/order'); assert.equal(sent.options.headers.Authorization, 'Bearer '+'a'.repeat(43)); assert.equal(sent.options.cache, 'no-store');
  data.payment_status = 'invented'; await assert.rejects(api.order('a'.repeat(43)), e => e.code === 'invalid_response');
});
test('demandes : double clic partagé et aucune reprise aveugle après résultat réseau incertain', async () => {
  let finish, calls = 0;
  const flow = service.createRequests({ api: { request: () => { calls++; return new Promise((_, reject) => { finish = reject; }); } } });
  const a = flow.send({}), b = flow.send({}); assert.equal(a, b);
  finish({ code: 'service_unavailable' }); await assert.rejects(a);
  await assert.rejects(flow.send({}), e => e.code === 'request_uncertain'); assert.equal(calls, 1);
});
test('demandes : Retry-After bloque les renvois et refus de configuration sans faux succès', async () => {
  let now = 1, calls = 0;
  const flow = service.createRequests({ now: () => now, api: { request: async () => { calls++; throw { code: 'rate_limited', retryAfterMs: 5000 }; } } });
  await assert.rejects(flow.send({})); await assert.rejects(flow.send({})); assert.equal(calls, 1);
  now += 5001; await assert.rejects(flow.send({})); assert.equal(calls, 2);
});
test('demandes : référence et date exigées ; un booléen accepted ne prouve pas l’enregistrement', async () => {
  const input = { type: 'withdrawal', name: 'RECETTE', email: 'test@example.invalid', message: '', turnstile: 'fixture', extraneous: 'excluded' };
  let payload, data = { accepted: true };
  const api = contract.createClient({ fetchImpl: async (_, init) => { payload = JSON.parse(init.body); return { ok: true, json: async () => data }; } });
  await assert.rejects(api.request(input), e => e.code === 'invalid_response'); assert.ok(!('extraneous' in payload));
  data = { reference: 'R-TEST-TEST', type: 'withdrawal', received_at: new Date().toISOString() };
  assert.equal((await api.request(input)).reference, data.reference);
});
test('relais : adresse complète, cohérence du code postal et zone vérifiées', () => {
  const p = { id: 'test-only', name: 'RELAIS DE RECETTE', postcode: '75011', city: 'Paris', address: { line1: 'ADRESSE DE TEST', line2: 'COMPLÉMENT DE TEST', postcode: '75011', city: 'Paris', country: 'FR' } };
  assert.equal(contract.validRelay(p), true);
  for (const change of [{ address: { ...p.address, line1: null } }, { postcode: '69001' }, { address: { ...p.address, country: 'MC' } }, { open: false }]) assert.equal(contract.validRelay({ ...p, ...change }), false);
});
test('demandes : une autre demande ne reçoit pas l’accusé d’un formulaire déjà en cours', async () => {
  let finish;
  const flow = service.createRequests({ api: { request: () => new Promise(resolve => { finish = resolve; }) } });
  const first = flow.send({ type: 'contact', message: 'test' });
  await assert.rejects(flow.send({ type: 'withdrawal', message: '' }), e => e.code === 'request_pending');
  finish({ reference: 'R-TEST-TEST' }); await first;
});

test('suivi : champs hérités inconnus explicitement null, sans taille ni livraison inventée', () => {
  const data = { order_reference: 'SL-TEST-TEST', payment_status: 'review', items: [{ size: null, quantity: 1 }], shipping: null, relay: null, steps: [], tracking: null, updated_at: new Date().toISOString() };
  assert.equal(contract.validOrder(data), true);
  assert.equal(contract.validOrder({ ...data, shipping: 'invented' }), false);
});
