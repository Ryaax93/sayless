import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const files = await Promise.all(
  ['api-client.js', 'checkout-flow.js', 'checkout.js'].map((name) =>
    readFile(new URL('../public/store/' + name, import.meta.url), 'utf8'),
  ),
);
const reference = 'SL-TEST-0001';
const pair = '?ref=' + reference + '&session_id=cs_test_fixture';

function page(pathname = '/merci', search = pair) {
  const calls = [],
    scheduled = [],
    history = {
      state: null,
      replaceState(state, _title, path) {
        this.state = state;
        this.path = path;
      },
    };
  let payload = { order_reference: reference, payment_status: 'pending', updated_at: new Date().toISOString() };
  const main = { innerHTML: '', dataset: {}, focus() {} };
  const document = {
    hidden: false,
    querySelector() {
      return null;
    },
    addEventListener() {},
  };
  const window = { addEventListener() {}, SaylessConfig: { checkoutEnabled: false } };
  const env = vm.createContext({
    window,
    document,
    main,
    history,
    location: { pathname, search, hash: '' },
    URL,
    URLSearchParams,
    AbortController,
    escapeHTML: (s) => String(s),
    currentRoute: () => (pathname === '/merci' ? 'confirmation' : 'commande-annulee'),
    cart: [{ size: 'M', quantity: 1 }],
    saveCart() {
      calls.push({ action: 'clear-cart' });
    },
    clearTimeout() {},
    setTimeout(fn, delay) {
      scheduled.push({ fn, delay });
      return scheduled.length;
    },
    setInterval() {},
  });
  vm.runInContext(files[0], env);
  window.SaylessAPI = {
    checkoutStatus: async (body) => {
      calls.push({ action: 'status', body: { ...body } });
      if (payload instanceof Error) throw payload;
      return payload;
    },
  };
  vm.runInContext(files[1], env);
  vm.runInContext(files[2], env);
  const ui = window.SaylessCheckoutUI;
  ui.captureReturn();
  return {
    ui,
    calls,
    scheduled,
    history,
    main,
    env,
    setStatus(status) {
      payload = { ...payload, payment_status: status };
    },
  };
}

test('le retour annulé nettoie l’adresse et ne déclenche ni vérification payante ni libération', async () => {
  const h = page('/commande-annulee', '?ref=' + reference);
  await h.ui.checkStatus();
  assert.equal(h.history.path, '/commande-annulee');
  assert.equal(h.calls.length, 0);
  assert.equal(h.env.cart.length, 1);
  assert.match(vm.runInContext('cancellationPage()', h.env), /quitté la page de paiement/);
});

test('la page de retour exige les deux identifiants et présente une confirmation en attente', async () => {
  const invalid = page('/merci', '?ref=' + reference);
  await invalid.ui.checkStatus();
  assert.equal(invalid.calls.length, 0);
  assert.match(invalid.main.innerHTML, /NON CONFIRMÉ|INDISPONIBLE|VÉRIFICATION/i);
  const h = page();
  await h.ui.checkStatus();
  assert.equal(h.history.path, '/merci');
  assert.deepEqual(h.calls, [
    { action: 'status', body: { order_reference: reference, session_id: 'cs_test_fixture' } },
  ]);
  assert.match(h.main.innerHTML, /EN COURS/);
  assert.ok(h.scheduled[0].delay >= 5000);
  assert.equal(h.env.cart.length, 1);
});

test('une confirmation payée vide uniquement le panier de la tentative correspondante', async () => {
  for (const same of [true, false]) {
    const h = page();
    h.ui.flow.state.attempt = { order_reference: same ? reference : 'SL-TEST-0002' };
    h.setStatus('paid');
    await h.ui.checkStatus();
    assert.match(h.main.innerHTML, /CONFIRMÉE/);
    assert.equal(h.env.cart.length, same ? 0 : 1);
    assert.equal(
      h.calls.some((c) => c.action === 'clear-cart'),
      same,
    );
  }
});

test('le polling de retour reste borné et ne lit pas le statut quand la page est masquée', async () => {
  const h = page();
  h.env.document.hidden = true;
  await h.ui.checkStatus();
  assert.equal(h.calls.length, 0);
  h.env.document.hidden = false;
  await h.ui.checkStatus();
  for (let n = 0; n < h.scheduled.length && n < 20; n++) await h.scheduled[n].fn();
  assert.equal(h.calls.length, 12);
  assert.equal(h.scheduled.length, 11);
  assert.match(h.main.innerHTML, /EN COURS/);
});
