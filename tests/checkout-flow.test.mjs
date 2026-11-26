import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const load = async (file) => {
  const c = vm.createContext({
    module: { exports: {} },
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch,
    crypto,
  });
  vm.runInContext(await readFile(new URL('../public/store/' + file, import.meta.url), 'utf8'), c);
  return c.module.exports;
};
const contract = await load('api-client.js'),
  flowApi = await load('checkout-flow.js'),
  policy = await load('inventory-policy.js');
const input = {
  items: [{ sku: 'ZH-PINK-M', quantity: 1 }],
  shipping: 'home',
  country: 'FR',
  postcode: '75011',
  relay_id: null,
};
function harness() {
  const clock = { t: Date.now() },
    calls = [],
    saved = new Map();
  let error = null,
    resolve = null,
    delay = false,
    stock = { status: 'available', checkoutEnabled: true };
  const quote = {
    id: 'signed-test-only',
    currency: 'EUR',
    terms_version: 'test',
    items: [{ sku: 'ZH-PINK-M', quantity: 1, unit_price_cents: 7500, line_total_cents: 7500 }],
    shipping: 'home',
    relay: null,
    subtotal_cents: 7500,
    shipping_cents: 850,
    total_cents: 8350,
    expires_at: new Date(clock.t + 600000).toISOString(),
  };
  const api = {
    quote: async () => ({ ...quote }),
    checkout: async (i, o) => {
      calls.push({ i, o });
      if (delay)
        await new Promise((r) => {
          resolve = r;
        });
      if (error) throw error;
      return { url: 'https://checkout.stripe.com/c/pay/test', order_reference: 'SL-TEST-TEST' };
    },
  };
  const options = {
    api,
    contract,
    getStock: async () => stock,
    now: () => clock.t,
    newKey: () => `test-only-attempt-${calls.length}`,
    storage: {
      getItem: (k) => saved.get(k),
      setItem: (k, v) => saved.set(k, v),
      removeItem: (k) => saved.delete(k),
    },
  };
  const flow = flowApi.createFlow(options);
  return {
    flow,
    options,
    clock,
    quote,
    calls,
    saved,
    setError: (e) => {
      error = e;
    },
    setStock: (s) => {
      stock = s;
    },
    delay: () => {
      delay = true;
    },
    release: () => resolve(),
    ready: async () => {
      flow.select(input);
      await flow.quote();
      flow.accept(true);
    },
  };
}
test('devis serveur intégral, aucune coordonnée personnelle, acceptation explicite avant paiement', async () => {
  const h = harness();
  h.flow.select(input);
  await h.flow.quote();
  assert.equal(h.flow.state.quote.total_cents, 8350);
  await assert.rejects(h.flow.submit({ termsVersion: 'test' }), (e) => e.code === 'terms_required');
  assert.equal(h.calls.length, 0);
});
test('double clic : une seule mutation et une clé unique', async () => {
  const h = harness();
  await h.ready();
  h.delay();
  const one = h.flow.submit({ termsVersion: 'test', turnstile: 'fixture' }),
    two = h.flow.submit({ termsVersion: 'test', turnstile: 'fixture' });
  assert.equal(one, two);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(h.calls.length, 1);
  h.release();
  await one;
});
test('réponse perdue : reprise explicite, même clé, même devis et aucun nouveau Turnstile', async () => {
  const h = harness();
  await h.ready();
  h.setError(new contract.ApiError('service_unavailable', 503));
  await assert.rejects(h.flow.submit({ termsVersion: 'test', turnstile: 'fixture' }));
  assert.equal(h.flow.state.phase, 'uncertain');
  assert.throws(
    () => h.flow.select({ ...input, postcode: '69001' }),
    (e) => e.code === 'attempt_pending',
  );
  h.setError(null);
  h.setStock({ status: 'held', checkoutEnabled: false });
  await h.flow.submit();
  assert.equal(h.calls[0].o.idempotencyKey, h.calls[1].o.idempotencyKey);
  assert.equal(h.calls[1].o.retry, true);
  assert.equal(h.calls[1].i.turnstile, undefined);
  assert.equal(h.calls[0].o.quote.id, h.calls[1].o.quote.id);
});
test('rechargement après coupure : tentative retrouvée sans jeton anti-abus ni coordonnées stockées', async () => {
  const h = harness();
  await h.ready();
  h.setError(new contract.ApiError('service_unavailable'));
  await assert.rejects(h.flow.submit({ termsVersion: 'test', turnstile: 'NEVER-PERSIST-TOKEN' }));
  const restored = flowApi.createFlow(h.options);
  assert.equal(restored.state.phase, 'uncertain');
  assert.equal(restored.state.attempt.key, h.flow.state.attempt.key);
  assert.ok(![...h.saved.values()].join().includes('NEVER-PERSIST-TOKEN'));
});
test('devis expiré avant toute tentative : aucun checkout, nouveau devis et CGV requis', async () => {
  const h = harness();
  await h.ready();
  h.clock.t += 600001;
  await assert.rejects(
    h.flow.submit({ termsVersion: 'test', turnstile: 'fixture' }),
    (e) => e.code === 'quote_expired',
  );
  assert.equal(h.calls.length, 0);
  assert.equal(h.flow.state.accepted, false);
  assert.equal(h.flow.state.quote, null);
});
test('reprise expirée côté backend : conserve la tentative incertaine, ne crée pas une deuxième réservation', async () => {
  const h = harness();
  await h.ready();
  h.setError(new contract.ApiError('service_unavailable'));
  await assert.rejects(h.flow.submit({ termsVersion: 'test', turnstile: 'fixture' }));
  const key = h.flow.state.attempt.key;
  h.setError(new contract.ApiError('quote_expired'));
  await assert.rejects(h.flow.submit());
  assert.equal(h.flow.state.attempt.key, key);
  assert.equal(h.flow.state.phase, 'uncertain');
});
test('devis modifié ou montant incohérent refusé avant affichage comme payable', async () => {
  const h = harness();
  h.quote.total_cents = 1;
  h.flow.select(input);
  await assert.rejects(h.flow.quote(), (e) => e.code === 'invalid_quote');
  assert.equal(h.flow.state.quote, null);
  assert.equal(h.calls.length, 0);
});
test('pause, rupture et réservation empêchent un nouveau checkout', async () => {
  for (const status of ['paused', 'sold_out', 'held', 'unavailable']) {
    const h = harness();
    await h.ready();
    h.setStock({ status, checkoutEnabled: false });
    await assert.rejects(h.flow.submit({ termsVersion: 'test', turnstile: 'fixture' }));
    assert.equal(h.calls.length, 0);
    assert.equal(h.flow.state.attempt, null);
  }
});
test('Retry-After respecté ; une tentative en cours conserve sa clé', async () => {
  const h = harness();
  await h.ready();
  h.setError(new contract.ApiError('checkout_in_progress', 409, {}, 2000));
  await assert.rejects(h.flow.submit({ termsVersion: 'test', turnstile: 'fixture' }));
  const key = h.flow.state.attempt.key;
  await assert.rejects(h.flow.submit(), (e) => e.code === 'rate_limited');
  assert.equal(h.calls.length, 1);
  h.clock.t += 2001;
  h.setError(null);
  await h.flow.submit();
  assert.equal(h.calls[1].o.idempotencyKey, key);
});
test('CGV obsolètes : nouvelle acceptation et nouveau devis obligatoires', async () => {
  const h = harness();
  await h.ready();
  h.setError(new contract.ApiError('terms_outdated', 409));
  await assert.rejects(h.flow.submit({ termsVersion: 'old', turnstile: 'fixture' }));
  assert.equal(h.flow.state.accepted, false);
  assert.equal(h.flow.state.quote, null);
  assert.equal(h.flow.state.attempt, null);
});
test('France métropolitaine : Corse, outre-mer et Monaco refusés ; CP obligatoire', () => {
  for (const cp of ['20000', '97400', '98000'])
    assert.throws(
      () => contract.destination(cp),
      (e) => e.code === 'destination_not_supported',
    );
  assert.throws(() => contract.destination('75011', 'MC'));
  assert.throws(() => contract.destination('751'));
  assert.equal(contract.destination('75011'), '75011');
});
test('une pièce maximum même si un ancien panier contient plusieurs tailles', async () => {
  const h = harness();
  h.flow.select({ ...input, items: [...input.items, { sku: 'ZH-PINK-S', quantity: 1 }] });
  await assert.rejects(h.flow.quote(), (e) => e.code === 'quantity_not_supported');
  assert.equal(h.calls.length, 0);
});
test('arrêt lecture stock : écran caché, hors achat, 10 minutes inactif et Retry-After', () => {
  const s = { route: 'produit', lastActivity: 1000, now: 2000, hidden: false, cartOpen: false };
  assert.equal(policy.mayRead(s), true);
  for (const change of [
    { hidden: true },
    { route: 'accueil' },
    { route: 'suivi' },
    { now: 601001 },
    { retryAt: 2001 },
  ])
    assert.equal(policy.mayRead({ ...s, ...change }), false);
  assert.equal(policy.mayRead({ ...s, route: 'accueil', cartOpen: true }), true);
});
test('retour Stripe : seule une réponse serveur explicite paid confirme la commande', () => {
  for (const status of ['pending', 'processing', 'paid', 'review', 'expired', 'failed', 'refunded'])
    assert.equal(flowApi.returnState({ payment_status: status, updated_at: new Date().toISOString() }), status);
  for (const input of [
    { session_id: 'cs_test_x' },
    { payment_status: 'paid' },
    { payment_status: 'success', updated_at: new Date().toISOString() },
  ])
    assert.equal(flowApi.returnState(input), 'unavailable');
});

test('une reprise qui réclame une nouvelle vérification conserve sa clé et utilise un jeton neuf', async () => {
  const h = harness();
  await h.ready();
  h.setError(new contract.ApiError('service_unavailable'));
  await assert.rejects(h.flow.submit({ termsVersion: 'test', turnstile: 'premier-jeton' }));
  h.setError(new contract.ApiError('challenge_required'));
  await assert.rejects(h.flow.submit());
  assert.equal(h.flow.state.needsChallenge, true);
  await assert.rejects(h.flow.submit(), (e) => e.code === 'challenge_required');
  h.setError(null);
  await h.flow.submit({ turnstile: 'nouveau-jeton' });
  assert.equal(new Set(h.calls.map((c) => c.o.idempotencyKey)).size, 1);
  assert.equal(h.calls.at(-1).i.turnstile, 'nouveau-jeton');
  assert.equal(h.calls.at(-1).o.retry, false);
});

test('v1.3 : tentative payée, à vérifier ou en traitement conservée ; jamais transformée en nouvel achat', async () => {
  for (const status of ['paid', 'review', 'processing', 'pending', 'refunded']) {
    const h = harness(); await h.ready();
    h.setError(new contract.ApiError('service_unavailable'));
    await assert.rejects(h.flow.submit({ termsVersion: 'test', turnstile: 'fixture' }));
    h.setError(new contract.ApiError('attempt_closed', 409, { order_reference: 'SL-TEST-TEST', payment_status: status, session_id: 'cs_test_fixture' }));
    await assert.rejects(h.flow.submit());
    assert.equal(h.flow.state.closed.payment_status, status);
    assert.equal(h.flow.state.attempt.order_reference, 'SL-TEST-TEST');
    assert.equal(h.flow.state.phase, 'closed');
    assert.throws(() => h.flow.select(input), e => e.code === 'attempt_pending');
  }
});
test('v1.3 : seules une expiration ou un échec explicites autorisent un nouveau devis', async () => {
  for (const status of ['expired', 'failed']) {
    const h = harness(); await h.ready();
    h.setError(new contract.ApiError('attempt_closed', 409, { order_reference: 'SL-TEST-TEST', payment_status: status }));
    await assert.rejects(h.flow.submit({ termsVersion: 'test', turnstile: 'fixture' }));
    assert.equal(h.flow.state.attempt, null); assert.equal(h.flow.state.quote, null); assert.equal(h.flow.state.accepted, false);
  }
});
test('v1.3 : réponse de clôture incomplète conserve la tentative par prudence', async () => {
  const h = harness(); await h.ready(); h.setError(new contract.ApiError('attempt_closed', 409, {}));
  await assert.rejects(h.flow.submit({ termsVersion: 'test', turnstile: 'fixture' }));
  assert.ok(h.flow.state.attempt); assert.equal(h.flow.state.phase, 'uncertain');
});
test('v1.3 : reprise après onze minutes avec la même clé et les CGV initiales, même si les CGV changent', async () => {
  const h = harness(); await h.ready(); h.setError(new contract.ApiError('service_unavailable'));
  await assert.rejects(h.flow.submit({ termsVersion: 'test', turnstile: 'fixture' }));
  h.clock.t += 660000; h.setError(null);
  await h.flow.submit({ termsVersion: 'nouvelle-version' });
  assert.equal(h.calls[1].i.terms_version, 'test'); assert.equal(h.calls[0].o.idempotencyKey, h.calls[1].o.idempotencyKey);
});
test('v1.3 : les anciennes tentatives v1.2 restent récupérables sans devenir de nouveaux devis', async () => {
  const h = harness(); await h.ready(); h.setError(new contract.ApiError('service_unavailable'));
  await assert.rejects(h.flow.submit({ termsVersion: 'test', turnstile: 'fixture' }));
  const a = JSON.parse(h.saved.get(flowApi.STORAGE_KEY)); delete a.quote.terms_version;
  h.saved.set(flowApi.STORAGE_KEY, JSON.stringify(a));
  const restored = flowApi.createFlow(h.options);
  assert.equal(restored.state.attempt.key, a.key); assert.equal(restored.state.quote.terms_version, 'test');
});
test('v1.3 : devis sans version des CGV ou relais incomplet refusé', async () => {
  const h = harness(); delete h.quote.terms_version; h.flow.select(input);
  await assert.rejects(h.flow.quote(), e => e.code === 'invalid_quote');
  const relay = { ...h.quote, terms_version: 'test', shipping: 'relay', relay: { id: 'test-only', label: 'RELAIS DE TEST' } };
  assert.equal(contract.validQuote(relay, { ...input, shipping: 'relay', relay_id: 'test-only' }), false);
});
