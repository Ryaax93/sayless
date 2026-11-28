// Recette complémentaire : les scénarios historiques vérifient l'état final, cette variante
// vérifie aussi CHAQUE réponse de webhook et l'absence d'erreur de transport D1 locale.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bench, event, parallel, startDatabases, stopDatabases, engineFailureSummary } from '../backend/helpers.mjs';
import { invariants } from '../../backend/src/stock.mjs';

before(startDatabases);
after(stopDatabases);

test('D1-W1 300 clients / 26 pièces / 130 webhooks : contrôler toutes les réponses, pas seulement le stock final', async (t) => {
  const b = await bench({ 'TEST-U': 26 });
  const candidates = await parallel(300, (i) => b.checkout('TEST-U', `10.222.${i >> 8}.${i & 255}`));
  const ok = candidates.filter((r) => r.status === 200);
  const purchases = Object.fromEntries([...new Set(candidates.map((r) => `${r.status}:${r.body.error ?? 'ok'}`))]
    .map((code) => [code, candidates.filter((r) => `${r.status}:${r.body.error ?? 'ok'}` === code).length]));
  assert.equal(ok.length, 26, JSON.stringify(purchases));
  assert.equal(candidates.some((r) => r.status >= 500), false, JSON.stringify(purchases));
  for (const row of ok) b.stripe.pay(row.sid);
  const events = ok.map((r) => event('checkout.session.completed', r.sid));
  const responses = await parallel(events.length * 5, (i) => b.webhook(events[i % events.length]));
  const statuses = Object.fromEntries([...new Set(responses)].map((s) => [s, responses.filter((x) => x === s).length]));
  t.diagnostic(`Checkout ${JSON.stringify(purchases)} ; webhook ${JSON.stringify(statuses)} ; transport D1 : ${engineFailureSummary() || '0 erreur'}.`);
  assert.equal(responses.every((s) => s === 200), true, `Réponses webhook : ${JSON.stringify(statuses)}`);
  assert.equal(engineFailureSummary(), '', 'Une suite réussie ne doit pas masquer un transport D1 défaillant.');
  assert.equal(await b.count("SELECT COUNT(*) FROM orders WHERE status = 'paid'"), 26);
  assert.deepEqual(await b.inv('TEST-U'), [0, 0]);
  assert.deepEqual(await invariants(b.real), []);
});
