// Troisième contre-audit Work : résultats par appareil et santé du canal doivent rester cohérents.
// Routeurs réels, D1 locale, Apple simulé. Aucun accès ni secret réels.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabases, stopDatabases } from '../backend/helpers.mjs';
import { studio } from '../backend/studio-helpers.mjs';
import { deliverOutbox } from '../../backend/src/notify.mjs';
import { keys, device, ENDPOINT } from './push-review-helpers.mjs';

before(startDatabases);
after(stopDatabases);
const notify = (b, ref) => b.context().deps.notify({ kind: 'order_paid', ref, level: 'info', title: 'Recette', body: 'Données synthétiques.' });
const deliver = (b) => { const { ctx, deps } = b.context(); return deliverOutbox(ctx, deps.senders, deps); };
const health = async (b) => (await b.call('GET', '/api/admin/health')).body.checks.find((c) => c.name === 'Notifications iPhone');
async function ready() {
  const b = await studio();
  await b.enroll();
  Object.assign(b.env, await keys());
  b.deps.channels = ['push'];
  await device(b.real, b.clock.now());
  return b;
}

test('P3-R1a : ancien échec automatique après un essai reçu, aucune fausse panne du canal', async (t) => {
  const b = await ready();
  let release, entered;
  const hold = new Promise((r) => { release = r; });
  const started = new Promise((r) => { entered = r; });
  let calls = 0;
  b.deps.transport = async () => {
    if (++calls === 1) { entered(); await hold; return new Response('{"reason":"BadJwtToken"}', { status: 403 }); }
    return new Response(null, { status: 201 });
  };
  await notify(b, 'ancien-refus');
  const old = deliver(b);
  await started;
  b.clock.t += 1;
  const recent = await b.call('POST', '/api/admin/push/test', { endpoint: ENDPOINT });
  assert.equal(recent.body.devices[0].current, true);
  const id = await b.count('SELECT test_id FROM push_subscriptions');
  assert.equal((await b.call('POST', '/api/admin/push/receipt', { test: id })).body.received, true);
  assert.equal((await health(b)).state, 'ok');
  release();
  await old;
  assert.equal(await b.count('SELECT last_status FROM push_subscriptions'), 201, 'le résultat appareil récent est bien conservé');
  assert.equal(await b.count("SELECT status FROM outbox WHERE dedupe = 'push:order_paid:ancien-refus'"), 'dead', 'le message ancien a réellement échoué');
  const state = await b.count("SELECT state FROM channel_health WHERE channel = 'push'");
  const check = await health(b);
  const alerts = await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'channel_failure' AND resolved_at IS NULL");
  t.diagnostic(`Ancien 403 après nouvel essai reçu : appareil=201, canal=${state}, Santé=${check.state}, incidents ouverts=${alerts}.`);
  assert.equal(state, 'ok', 'Une erreur dépassée doit être conservée pour son message sans déclarer le canal actuellement en panne.');
  assert.equal(check.state, 'ok');
  assert.equal(alerts, 0);
});

test('P3-R1b : nouvel échec entre résultat appareil et rétablissement du canal, aucune résolution périmée', async (t) => {
  const b = await ready();
  let calls = 0, injected = false;
  b.deps.transport = async () => ++calls === 1 ? new Response(null, { status: 201 }) : new Response('{"reason":"BadJwtToken"}', { status: 403 });
  b.env.DB.state.beforeBatch = async (statements) => {
    if (injected || !statements.some((s) => s.includes('INSERT INTO delivery_health') && s.includes('last_ok_at'))) return false;
    injected = true;
    b.env.DB.state.beforeBatch = null;
    b.clock.t += 1;
    await notify(b, 'nouveau-refus');
    await deliver(b);
    assert.equal(await b.count("SELECT state FROM channel_health WHERE channel = 'push'"), 'failing');
    return true;
  };
  const first = await b.call('POST', '/api/admin/push/test', { endpoint: ENDPOINT });
  assert.equal(injected, true, 'le nouvel envoi s’intercale juste avant le lot de rétablissement');
  assert.equal(first.body.devices[0].status, 201);
  assert.equal(await b.count('SELECT last_status FROM push_subscriptions'), 403);
  const state = await b.count("SELECT state FROM channel_health WHERE channel = 'push'");
  const alerts = await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'channel_failure' AND resolved_at IS NULL");
  t.diagnostic(`Ancien succès appliqué, puis nouveau 403, puis résolution tardive : appareil=403, canal=${state}, incidents ouverts=${alerts}.`);
  assert.equal(state, 'failing', 'Le booléen applied lu avant la transaction ne suffit pas : garder la condition de tentative dans le lot de rétablissement.');
  assert.equal(alerts, 1);
});
