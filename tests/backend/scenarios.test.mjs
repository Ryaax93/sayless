// Les 29 scénarios de la preuve de concept de Claude (Python/SQLite), portés sur le vrai code du
// backend et une D1 locale (Miniflare). Le numéro tNN renvoie au scénario d'origine.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { bench, engineFailureSummary, event, parallel, startDatabases, stopDatabases, emptyDatabase, PII } from './helpers.mjs';
import { sweep } from '../../backend/src/payments.mjs';
import { releaseStatements } from '../../backend/src/commerce.mjs';
import { adjustStock, invariants, publicStock } from '../../backend/src/stock.mjs';
import { importHistory } from '../../backend/src/payments.mjs';
import { deliverOutbox } from '../../backend/src/notify.mjs';
import { buyLabel, exportRecettes, inspectReturn, purgeContacts, relayOverdue, trackingUpdate, viewContact } from '../../backend/src/operations.mjs';
import { dumpDatabase, restoreDatabase } from '../../backend/src/backup.mjs';
import { batch } from '../../backend/src/lib.mjs';

before(startDatabases);
after(stopDatabases);
const HOLD = 1920;
const run = async (b, fn) => { const { ctx, deps } = b.context(); return fn(ctx, deps); };
// En cas d'échec : répartition des réponses et échecs du moteur local, pour distinguer un défaut
// métier (réponses métier inattendues) d'un problème d'environnement (service_unavailable + échecs de connexion).
const outcomes = (res) => {
  const counts = {};
  for (const r of res) { const k = r.status === 200 ? '200' : `${r.status} ${r.body?.error ?? '?'}`; counts[k] = (counts[k] ?? 0) + 1; }
  return `réponses ${JSON.stringify(counts)} ; moteur local : ${engineFailureSummary() || 'aucun échec de connexion'}`;
};

test('t01 dernière pièce : 200 clients simultanés, une seule réservation', async () => {
  const b = await bench({ 'TEST-M': 1 });
  const quotes = await parallel(200, (i) => b.quote([{ sku: 'TEST-M', quantity: 1 }], { ip: `10.1.${i >> 8}.${i & 255}` }));
  const res = await parallel(200, (i) => b.checkout('TEST-M', `10.1.${i >> 8}.${i & 255}`, { quote: quotes[i] }));
  const seen = outcomes(res);
  assert.equal(res.filter((r) => r.status === 200).length, 1, seen);
  assert.ok(res.filter((r) => r.status !== 200).every((r) => r.body.error === 'held'), seen);
  assert.deepEqual(await b.inv('TEST-M'), [1, 1]);
  assert.deepEqual(await invariants(b.real), []);
});

test('t02 volume et doublons : 300 clients pour 26 pièces, chaque webhook reçu 5 fois', async () => {
  const b = await bench({ 'TEST-U': 26 });
  const res = await parallel(300, (i) => b.checkout('TEST-U', `10.2.${i >> 8}.${i & 255}`));
  const ok = res.filter((r) => r.status === 200);
  assert.equal(ok.length, 26, outcomes(res));
  for (const r of ok) b.stripe.pay(r.sid);
  const evs = ok.map((r) => event('checkout.session.completed', r.sid));
  await parallel(evs.length * 5, (i) => b.webhook(evs[i % evs.length]));
  assert.equal(await b.count("SELECT COUNT(*) FROM orders WHERE status = 'paid'"), 26);
  assert.deepEqual(await b.inv('TEST-U'), [0, 0]);
  assert.deepEqual(await invariants(b.real), []);
});

test('t03 abandon : session fermée chez Stripe avant libération, pièce rendue une fois puis revendue', async () => {
  const b = await bench({ 'TEST-M': 1 });
  const { sid } = await b.checkout('TEST-M', '10.3.0.1');
  b.clock.t += HOLD + 60;
  const r1 = await run(b, sweep);
  const r2 = (await run(b, sweep)).released + (await run(b, sweep)).released;
  const ev = event('checkout.session.expired', sid);
  await b.webhook(ev);
  await b.webhook(ev);
  assert.equal(r1.released, 1);
  assert.equal(r2, 0);
  assert.equal(b.stripe.sessions.get(sid).status, 'expired');
  assert.equal((await b.buy('TEST-M', '10.3.0.2')).status, 200);
  assert.deepEqual(await b.inv('TEST-M'), [0, 0]);
});

test('t04 Stripe injoignable au balayage : pièce gardée, puis rendue au retour de Stripe', async () => {
  const b = await bench({ 'TEST-M': 1 });
  await b.checkout('TEST-M', '10.4.0.1');
  b.clock.t += HOLD + 60;
  b.stripe.down = true;
  assert.equal((await run(b, sweep)).released, 0);
  assert.deepEqual(await b.inv('TEST-M'), [1, 1]);
  b.stripe.down = false;
  assert.equal((await run(b, sweep)).released, 1);
  assert.deepEqual(await b.inv('TEST-M'), [1, 0]);
});

test('t05 payé pendant le balayage : le balayage vend au lieu de libérer, une seule commande', async () => {
  const b = await bench({ 'TEST-M': 1 });
  const { sid } = await b.checkout('TEST-M', '10.5.0.1');
  b.stripe.pay(sid);
  b.clock.t += HOLD + 60;
  await run(b, sweep);
  await b.webhook(event('checkout.session.completed', sid));
  assert.equal(await b.count("SELECT COUNT(*) FROM orders WHERE status = 'paid'"), 1);
  assert.deepEqual(await b.inv('TEST-M'), [0, 0]);
});

test('t06 paiement différé : gardé en attente, accepté = vendu, refusé = rendu une fois', async () => {
  const b = await bench({ 'TEST-M': 2 });
  const a = await b.buy('TEST-M', '10.6.0.1', { method: 'sepa' });
  const c = await b.buy('TEST-M', '10.6.0.2', { method: 'sepa' });
  b.clock.t += 7200;
  assert.equal((await run(b, sweep)).released, 0);
  assert.deepEqual(await b.inv('TEST-M'), [2, 2]);
  b.stripe.asyncResult(a.sid, true);
  await b.webhook(event('checkout.session.async_payment_succeeded', a.sid));
  b.stripe.asyncResult(c.sid, false);
  const fail = event('checkout.session.async_payment_failed', c.sid);
  await b.webhook(fail);
  await b.webhook(fail);
  assert.deepEqual(await b.inv('TEST-M'), [1, 0]);
  assert.equal(await b.count("SELECT COUNT(*) FROM orders WHERE status = 'paid'"), 1);
});

test('t07 événements dans le désordre : une vente, une pièce rendue, rien en double', async () => {
  const b = await bench({ 'TEST-M': 2 });
  const a = await b.checkout('TEST-M', '10.7.0.1');
  const c = await b.checkout('TEST-M', '10.7.0.2');
  b.stripe.pay(a.sid, { method: 'sepa' });
  b.stripe.asyncResult(a.sid, true);
  b.stripe.pay(c.sid, { method: 'sepa' });
  b.stripe.asyncResult(c.sid, false);
  for (const type of ['checkout.session.async_payment_succeeded', 'checkout.session.completed', 'checkout.session.expired', 'checkout.session.completed']) {
    await b.webhook(event(type, a.sid));
  }
  for (const type of ['checkout.session.async_payment_failed', 'checkout.session.completed']) await b.webhook(event(type, c.sid));
  assert.equal(await b.count("SELECT COUNT(*) FROM orders WHERE status = 'paid'"), 1);
  assert.deepEqual(await b.inv('TEST-M'), [1, 0]);
});

test('t08 paiement tardif sans stock : commande à traiter + alerte, jamais décomptée au renvoi', async () => {
  const b = await bench({ 'TEST-M': 1 });
  const a = await b.checkout('TEST-M', '10.8.0.1');
  const order = (await b.rows('SELECT id FROM orders WHERE stripe_session_id = ?', a.sid))[0];
  await batch(b.real, releaseStatements(b.real, order.id, b.clock.now())); // incident simulé
  await b.buy('TEST-M', '10.8.0.2');
  b.stripe.pay(a.sid);
  const ev = event('checkout.session.completed', a.sid);
  await b.webhook(ev);
  assert.equal(await b.count('SELECT status FROM orders WHERE id = ?', order.id), 'paid_no_stock');
  assert.equal(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'paid_without_stock'"), 1);
  const rev = await b.count("SELECT revision FROM inventory WHERE sku = 'TEST-M'");
  await adjustStock(b.real, { sku: 'TEST-M', delta: 1, expectedRevision: rev, actor: 'test', note: 'pièce retrouvée', now: b.clock.now() });
  await b.webhook({ ...ev, id: `${ev.id}_renvoi` });
  assert.deepEqual(await b.inv('TEST-M'), [1, 0]);
  assert.equal(await b.count('SELECT status FROM orders WHERE id = ?', order.id), 'paid_no_stock');
});

test('t09 signatures : modifiée, trop ancienne, mauvais secret refusées sans rien écrire', async () => {
  const b = await bench({ 'TEST-M': 3 });
  const { sid } = await b.checkout('TEST-M', '10.9.0.1');
  b.stripe.pay(sid);
  const ev = event('checkout.session.completed', sid);
  const bad = [await b.webhook(ev, { tamper: true }), await b.webhook(ev, { tOffset: -301 }), await b.webhook(ev, { secret: 'whsec_mauvais' })];
  assert.deepEqual(bad, [400, 400, 400]);
  assert.equal(await b.count("SELECT COUNT(*) FROM orders WHERE status = 'paid'"), 0);
  assert.equal(await b.webhook(ev), 200);
  assert.equal(await b.count("SELECT COUNT(*) FROM orders WHERE status = 'paid'"), 1);
});

test('t10 base indisponible ou boutique en pause : vente refusée, aucune session de paiement', async () => {
  const b = await bench({ 'TEST-M': 3 });
  const q = await b.quote([{ sku: 'TEST-M', quantity: 1 }]);
  b.db.state.down = true;
  const down = await b.checkout('TEST-M', '10.10.0.1', { quote: q });
  b.db.state.down = false;
  await b.real.prepare("UPDATE settings SET value = 'paused' WHERE key = 'shop_mode'").run();
  const paused = await b.checkout('TEST-M', '10.10.0.2', { quote: q });
  const pausedQuote = await b.quote([{ sku: 'TEST-M', quantity: 1 }]);
  assert.deepEqual([down.status, down.body.error], [503, 'service_unavailable']);
  assert.deepEqual([paused.status, paused.body.error], [503, 'paused']);
  assert.deepEqual([pausedQuote.status, pausedQuote.body.error], [503, 'paused']);
  assert.equal(b.stripe.created, 0);
});

test('t11 Stripe indisponible à la création : pièce gardée, session retrouvée pour la reprise, revendue à l’expiration', async () => {
  const b = await bench({ 'TEST-M': 1 });
  b.stripe.down = true;
  const r1 = await b.checkout('TEST-M', '10.11.0.1');
  assert.deepEqual([r1.status, r1.body.error], [503, 'service_unavailable']);
  assert.deepEqual(await b.inv('TEST-M'), [1, 1]);
  assert.equal((await run(b, sweep)).released, 0);
  assert.deepEqual(await b.inv('TEST-M'), [1, 1]);
  b.stripe.down = false;
  // Stripe revenu pendant la réservation : la session est retrouvée par sa clé et gardée pour le client.
  const back = await run(b, sweep);
  assert.deepEqual([back.released, back.recovered], [0, 1]);
  const resumed = await b.checkout('TEST-M', '10.11.0.1', { quote: r1.quote, key: r1.key });
  assert.deepEqual([resumed.status, b.stripe.created], [200, 1]);
  assert.equal((await b.checkout('TEST-M', '10.11.0.2')).body.error, 'held');
  // Réservation échue sans paiement : session fermée chez Stripe, pièce rendue puis revendue.
  b.clock.t += HOLD + 60;
  assert.equal((await run(b, sweep)).released, 1);
  assert.deepEqual(await b.inv('TEST-M'), [1, 0]);
  assert.equal((await b.checkout('TEST-M', '10.11.0.2')).status, 200);
});

test('t12 base en panne pendant le webhook : 500, puis traité une seule fois', async () => {
  const b = await bench({ 'TEST-M': 1 });
  const { sid } = await b.checkout('TEST-M', '10.12.0.1');
  b.stripe.pay(sid);
  const ev = event('checkout.session.completed', sid);
  b.db.state.down = true;
  const r1 = await b.webhook(ev);
  b.db.state.down = false;
  assert.deepEqual([r1, await b.webhook(ev), await b.webhook(ev)], [500, 200, 200]);
  assert.equal(await b.count("SELECT COUNT(*) FROM orders WHERE status = 'paid'"), 1);
});

test('t13 étiquettes : 30 clics = 1 achat ; réponse perdue = récupérée ; commande remboursée = refus', async () => {
  const b = await bench({ 'TEST-M': 3 });
  await b.buy('TEST-M', '10.13.0.1');
  await b.buy('TEST-M', '10.13.0.2');
  const third = await b.buy('TEST-M', '10.13.0.3');
  const [o1, o2, o3] = (await b.rows('SELECT id FROM orders ORDER BY number')).map((r) => r.id);
  const results = await run(b, (ctx, deps) => parallel(30, () => buyLabel(ctx, o1, b.carrier, 'studio', deps)));
  assert.equal(results.filter((r) => r.result === 'bought').length, 1);
  assert.equal(b.carrier.purchases, 1);
  b.carrier.loseResponse = true;
  assert.equal((await run(b, (ctx, deps) => buyLabel(ctx, o2, b.carrier, 'studio', deps))).result, 'failed_retry');
  b.carrier.loseResponse = false;
  assert.equal((await run(b, (ctx, deps) => buyLabel(ctx, o2, b.carrier, 'studio', deps))).result, 'bought');
  assert.equal(b.carrier.purchases, 2);
  const cid = b.stripe.refund(third.sid, 8350);
  await b.webhook(event('charge.refunded', cid, 'charge'));
  assert.equal((await run(b, (ctx, deps) => buyLabel(ctx, o3, b.carrier, 'studio', deps))).result, 'order_not_payable');
  assert.equal(b.carrier.purchases, 2);
});

test('t14 remboursement et retour : stock inchangé ; contrôle OK ×10 = +1 une fois ; contrôle KO = rien', async () => {
  const b = await bench({ 'TEST-M': 2 });
  const s1 = await b.buy('TEST-M', '10.14.0.1');
  const s2 = await b.buy('TEST-M', '10.14.0.2');
  const [o1, o2] = (await b.rows('SELECT id FROM orders ORDER BY number')).map((r) => r.id);
  await b.webhook(event('charge.refunded', b.stripe.refund(s1.sid, 8350), 'charge'));
  assert.deepEqual(await b.inv('TEST-M'), [0, 0]);
  const res = await run(b, (ctx, deps) => parallel(10, () => inspectReturn(ctx, { orderId: o1, sku: 'TEST-M', quantity: 1, resellable: true, actor: 'fondateur' }, deps)));
  assert.equal(res.filter((r) => r === 'restocked').length, 1);
  assert.deepEqual(await b.inv('TEST-M'), [1, 0]);
  await b.webhook(event('charge.refunded', b.stripe.refund(s2.sid, 8350), 'charge'));
  await run(b, (ctx, deps) => inspectReturn(ctx, { orderId: o2, sku: 'TEST-M', quantity: 1, resellable: false, actor: 'fondateur' }, deps));
  assert.deepEqual(await b.inv('TEST-M'), [1, 0]);
  const log = Object.fromEntries((await b.rows("SELECT result, COUNT(*) AS n FROM audit_log WHERE action = 'return_check' GROUP BY result")).map((r) => [r.result, r.n]));
  assert.deepEqual(log, { restocked: 1, ignored_already_done: 9, not_resellable: 1 });
});

test('t15 journaux non modifiables : modification ou suppression refusées par la base', async () => {
  const b = await bench({ 'TEST-M': 1 });
  let refused = 0;
  for (const text of ['UPDATE audit_log SET result = \'falsifie\'', 'DELETE FROM audit_log',
    'UPDATE stock_movements SET d_on_hand = 99', 'DELETE FROM stock_movements', "UPDATE inventory SET on_hand = 50 WHERE sku = 'TEST-M'"]) {
    await b.real.prepare(text).run().catch(() => { refused += 1; });
  }
  assert.equal(refused, 5);
  assert.deepEqual(await invariants(b.real), []);
});

test('t16 transitions interdites : une pièce vendue ne peut pas revenir en stock par erreur', async () => {
  const b = await bench({ 'TEST-M': 1 });
  await b.buy('TEST-M', '10.16.0.1');
  await assert.rejects(b.real.prepare("UPDATE reservations SET status = 'released'").run(), /reservation_transition_forbidden/);
  await assert.rejects(b.real.prepare("UPDATE orders SET status = 'pending'").run(), /order_transition_forbidden/);
  assert.deepEqual(await b.inv('TEST-M'), [0, 0]);
});

test('t17 produit en brouillon : invisible et impossible à acheter', async () => {
  const b = await bench({ 'TEST-M': 5 }, { productStatus: 'draft' });
  const q = await b.quote([{ sku: 'TEST-M', quantity: 1 }]);
  assert.deepEqual([q.status, q.body.error], [422, 'invalid_items']);
  const stock = await b.api('GET', '/api/stock?product_id=test-001');
  assert.deepEqual([stock.status, stock.body.error], [404, 'unknown_product']);
});

test('t18 anti-abus : 2 réservations par client, 6e tentative en 10 min bloquée, autre client libre', async () => {
  const b = await bench({ 'TEST-M': 50 });
  const same = [];
  for (let i = 0; i < 6; i += 1) {
    const r = await b.checkout('TEST-M', '10.18.0.1');
    same.push(`${r.status}${r.body.error ? `:${r.body.error}` : ''}`);
  }
  assert.deepEqual(same, ['200', '200', '429:hold_limit', '429:hold_limit', '429:hold_limit', '429:rate_limited']);
  assert.equal((await b.checkout('TEST-M', '10.18.0.2')).status, 200);
});

test('t19 alertes sans doublon : 12 ventes, webhooks reçus 3 fois', async () => {
  const b = await bench({ 'TEST-S': 4, 'TEST-M': 4, 'TEST-L': 4 });
  for (let i = 0; i < 12; i += 1) await b.buy(['TEST-S', 'TEST-M', 'TEST-L'][i % 3], `10.19.0.${i}`, { deliveries: 3 });
  const kinds = Object.fromEntries((await b.rows('SELECT kind, COUNT(*) AS n FROM notifications GROUP BY kind')).map((r) => [r.kind, r.n]));
  assert.deepEqual(kinds, { order_paid: 12, low_stock: 6, size_sold_out: 3, drop_sold_out: 1 });
  assert.equal(await b.count("SELECT COUNT(*) FROM outbox WHERE dedupe LIKE 'discord:order_paid:%'"), 12);
});

test('t20 Discord : aucune donnée personnelle ; panne = renvoi unique ; 5 échecs = alerte technique', async () => {
  const b = await bench({ 'TEST-M': 3 });
  await b.buy('TEST-M', '10.20.0.1', { customer: PII });
  const payloads = (await b.rows('SELECT payload FROM outbox')).map((r) => r.payload).join(' ')
    + (await b.rows('SELECT title, body FROM notifications')).map((r) => r.title + r.body).join(' ');
  for (const value of [PII.name, PII.email, PII.phone, PII.address.line1, PII.address.postal_code]) assert.ok(!payloads.includes(value));
  const calls = [];
  const down = { discord: async () => { throw new Error('Discord indisponible (simulé)'); } };
  const up = { discord: async (m) => { calls.push(m); } };
  const s0 = await run(b, (ctx, deps) => deliverOutbox(ctx, down, deps));
  b.clock.t += 3600;
  const s1 = await run(b, (ctx, deps) => deliverOutbox(ctx, up, deps));
  b.clock.t += 3600;
  const s2 = await run(b, (ctx, deps) => deliverOutbox(ctx, up, deps));
  assert.deepEqual([s0, s1, s2, calls.length], [0, 2, 0, 2]);
  await run(b, (ctx, deps) => deps.notify({ kind: 'test', ref: 'dead', title: 'test', body: 'test' }));
  for (let i = 0; i < 5; i += 1) {
    b.clock.t += 7200;
    await run(b, (ctx, deps) => deliverOutbox(ctx, down, deps));
  }
  assert.equal(await b.count("SELECT status FROM outbox WHERE dedupe = 'discord:test:dead'"), 'dead');
  assert.equal(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'technical' AND level = 'critical'"), 1);
});

test('t21 ancien lien 1.0 : vente décomptée une fois ; sans stock = alerte ; renvois sans doublon', async () => {
  const b = await bench({ 'TEST-S': 1, 'TEST-M': 1, 'TEST-L': 0 });
  const s = b.stripe.linkSession('s');
  for (let i = 0; i < 3; i += 1) await b.webhook(event('checkout.session.completed', s));
  const l = b.stripe.linkSession('l');
  const ev = event('checkout.session.completed', l);
  await b.webhook(ev);
  assert.equal(await b.count('SELECT status FROM orders WHERE stripe_session_id = ?', l), 'paid_no_stock');
  const rev = await b.count("SELECT revision FROM inventory WHERE sku = 'TEST-L'");
  await adjustStock(b.real, { sku: 'TEST-L', delta: 1, expectedRevision: rev, actor: 'test', note: 'retrouvée', now: b.clock.now() });
  await b.webhook({ ...ev, id: `${ev.id}_renvoi` });
  assert.deepEqual(await b.inv('TEST-S'), [0, 0]);
  assert.deepEqual(await b.inv('TEST-L'), [1, 0]);
  assert.equal(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'legacy_link_without_stock'"), 1);
  assert.equal(await b.count("SELECT COUNT(*) FROM orders WHERE source = 'legacy_link'"), 2);
});

test('t22 sauvegarde et restauration : base séparée, mêmes chiffres, protections actives', async () => {
  const b = await bench({ 'TEST-S': 4, 'TEST-M': 4, 'TEST-L': 4 });
  for (let i = 0; i < 7; i += 1) await b.buy(['TEST-S', 'TEST-M', 'TEST-L'][i % 3], `10.22.0.${i}`);
  await b.checkout('TEST-L', '10.22.1.1');
  const dump = await dumpDatabase(b.real);
  const copy = await emptyDatabase();
  assert.deepEqual(await restoreDatabase(copy, dump), []);
  for (const table of ['inventory', 'stock_movements', 'reservations', 'orders', 'notifications', 'outbox', 'audit_log']) {
    const a = await b.count(`SELECT COUNT(*) FROM ${table}`);
    const c = Object.values(await copy.prepare(`SELECT COUNT(*) FROM ${table}`).first())[0];
    assert.equal(c, a, table);
  }
  assert.deepEqual((await copy.prepare('SELECT * FROM inventory ORDER BY sku').all()).results, await b.rows('SELECT * FROM inventory ORDER BY sku'));
  await assert.rejects(copy.prepare('DELETE FROM audit_log').run(), /audit_append_only/);
  await assert.rejects(copy.prepare("UPDATE inventory SET on_hand = 9 WHERE sku = 'TEST-S'").run(), /inventory_via_ledger_only/);
});

test('t23 piège OR IGNORE : écriture normale refusée ; OR IGNORE sauterait le contrôle — interdit dans le code', async () => {
  const b = await bench({ 'TEST-M': 0 });
  await assert.rejects(b.real.prepare("INSERT INTO stock_movements (sku, d_on_hand, d_reserved, reason, ref, at) VALUES ('TEST-M', -1, 0, 'adjustment', 'demo:abort', 1)").run());
  const c = await bench({ 'TEST-M': 0 });
  await c.real.prepare("INSERT OR IGNORE INTO stock_movements (sku, d_on_hand, d_reserved, reason, ref, at) VALUES ('TEST-M', -1, 0, 'adjustment', 'demo:ignore', 1)").run();
  assert.ok((await invariants(c.real)).length > 0, 'avec OR IGNORE, registre et stock divergent');
  const files = [...(await readdir(new URL('../../backend/src/', import.meta.url))).map((f) => `../../backend/src/${f}`),
    ...(await readdir(new URL('../../backend/migrations/', import.meta.url))).map((f) => `../../backend/migrations/${f}`)];
  for (const file of files) {
    const text = await readFile(new URL(file, import.meta.url), 'utf8');
    const code = text.split('\n').filter((line) => !/^\s*(--|\/\/)/.test(line)).join('\n');
    assert.ok(!/\bOR\s+(IGNORE|REPLACE)\b/i.test(code), `${file} ne doit pas utiliser OR IGNORE / OR REPLACE`);
  }
});

test('t24 import des ventes passées : historique sans effet avant l’inventaire, décompte unique après', async () => {
  const b = await bench({ 'TEST-S': 3, 'TEST-M': 3, 'TEST-L': 3 });
  const T = b.clock.now();
  const past = [
    { stripe_session_id: 'cs_test_hist_a', sku: 'TEST-S', amount_cents: 1111, paid_at: T - 86400 },
    { stripe_session_id: 'cs_test_hist_b', sku: 'TEST-M', amount_cents: 1111, paid_at: T - 3600 },
    { stripe_session_id: 'cs_test_hist_c', sku: 'TEST-L', amount_cents: 1111, paid_at: T + 3600 },
    { stripe_session_id: 'cs_test_hist_d', sku: null, amount_cents: 2222, paid_at: T - 7200 },
  ];
  await run(b, (ctx, deps) => importHistory(ctx, past, 'fondateur', deps));
  await run(b, (ctx, deps) => importHistory(ctx, past, 'fondateur', deps));
  await run(b, (ctx, deps) => parallel(5, () => importHistory(ctx, past, 'fondateur', deps).catch(() => null)));
  assert.equal(await b.count("SELECT COUNT(*) FROM orders WHERE source = 'import'"), 4);
  assert.deepEqual([await b.inv('TEST-S'), await b.inv('TEST-M'), await b.inv('TEST-L')], [[3, 0], [3, 0], [2, 0]]);
  assert.deepEqual((await b.rows("SELECT number FROM orders ORDER BY paid_at")).map((r) => r.number), [1, 2, 3, 4]);
  assert.equal(await b.count('SELECT COUNT(*) FROM order_items WHERE sku IS NULL'), 1, 'taille inconnue conservée, jamais supposée');
});

test('t25 dernière pièce réservée : « réservée temporairement », jamais SOLD OUT ; SOLD OUT après la vente', async () => {
  const b = await bench({ 'TEST-M': 1 });
  await b.checkout('TEST-M', '10.25.0.1');
  let stock = await publicStock(b.real, 'test-001', b.clock.now());
  assert.deepEqual([stock.variants[0].state, stock.drop_status], ['held', 'held']);
  assert.equal(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'drop_sold_out'"), 0);
  b.clock.t += HOLD + 60;
  await run(b, sweep);
  assert.equal((await publicStock(b.real, 'test-001', b.clock.now())).variants[0].state, 'available');
  await b.buy('TEST-M', '10.25.0.2');
  stock = await publicStock(b.real, 'test-001', b.clock.now());
  assert.deepEqual([stock.variants[0].state, stock.drop_status], ['sold_out', 'sold_out']);
});

test('t26 réponse Stripe perdue : pièce gardée, session retrouvée par sa clé et gardée pour la reprise, fermée à l’échéance, aucune 2e session', async () => {
  const b = await bench({ 'TEST-M': 1 });
  b.stripe.loseResponse = true;
  const r = await b.checkout('TEST-M', '10.26.0.1');
  b.stripe.loseResponse = false;
  b.stripe.down = true;
  assert.equal((await run(b, sweep)).released, 0);
  assert.deepEqual(await b.inv('TEST-M'), [1, 1]);
  b.stripe.down = false;
  assert.deepEqual([(await run(b, sweep)).recovered, await b.count('SELECT needs_stripe_check FROM orders')], [1, 0]);
  assert.deepEqual([r.status, r.body.error, b.stripe.created], [503, 'service_unavailable', 1]);
  const resumed = await b.checkout('TEST-M', '10.26.0.1', { quote: r.quote, key: r.key });
  assert.equal(resumed.sid, [...b.stripe.sessions.keys()][0], 'même session Stripe');
  b.clock.t += HOLD + 60;
  assert.equal((await run(b, sweep)).released, 1);
  assert.deepEqual([b.stripe.created, [...b.stripe.sessions.values()][0].status], [1, 'expired']);
  assert.deepEqual(await b.inv('TEST-M'), [1, 0]);
});

test('t27 point relais : « disponible » distinct de « retiré », relance unique après 7 jours', async () => {
  const b = await bench({ 'TEST-M': 1 });
  await b.buy('TEST-M', '10.27.0.1', { shipping: 'relay', relay_id: 'TEST-RELAY-1' });
  const oid = await b.count('SELECT id FROM orders');
  assert.equal(await b.count('SELECT shipping_cents FROM orders'), 490);
  await run(b, (ctx, deps) => buyLabel(ctx, oid, b.carrier, 'studio', deps));
  const steps = [];
  for (const s of ['in_transit', 'available_at_relay', 'available_at_relay', 'in_transit']) steps.push(await run(b, (ctx, deps) => trackingUpdate(ctx, oid, s, deps)));
  assert.deepEqual(steps, [1, 1, 0, 0]);
  assert.equal(await b.count("SELECT COUNT(*) FROM notifications WHERE kind IN ('parcel_picked_up', 'parcel_delivered')"), 0);
  b.clock.t += 8 * 86400;
  await run(b, relayOverdue);
  b.clock.t += 86400;
  await run(b, relayOverdue);
  assert.equal(await run(b, (ctx, deps) => trackingUpdate(ctx, oid, 'delivered', deps)), 1);
  const kinds = (await b.rows("SELECT kind FROM notifications WHERE kind LIKE 'parcel_%' ORDER BY kind")).map((r) => r.kind);
  assert.deepEqual(kinds, ['parcel_at_relay', 'parcel_not_collected', 'parcel_picked_up', 'parcel_shipped']);
});

// t28 (connexion Face ID, sessions, codes de secours) : porté dans tests/backend/studio.test.mjs (S01 à S04).

test('t29 livre des recettes et données personnelles : export au centime, formule neutralisée, purge sans toucher à la compta', async () => {
  const b = await bench({ 'TEST-M': 4 });
  const sids = [];
  for (const [i, name] of ['Client Test Un', '=HYPERLINK("http://exemple.test")', 'Client Test Trois'].entries()) {
    sids.push((await b.buy('TEST-M', `10.29.0.${i}`, { customer: { ...PII, name } })).sid);
  }
  await b.webhook(event('charge.refunded', b.stripe.refund(sids[0], 7500), 'charge'));
  const first = await run(b, (ctx, deps) => exportRecettes(ctx, 'fondateur', deps));
  const rows = first.csv.replace('﻿', '').trim().split('\r\n').slice(1).map((l) => l.split(';'));
  const total = rows.reduce((n, r) => n + Number(r[3].replace(',', '.')), 0);
  assert.equal(Math.round(total * 100), 3 * 8350 - 7500);
  const injected = rows.filter((r) => r[2].includes('HYPERLINK'));
  assert.equal(injected.length, 1);
  assert.match(injected[0][2], /^"?'=/, 'formule neutralisée par une apostrophe');
  assert.equal(new Set(rows.map((r) => r[1])).size, rows.length);
  const oid = await b.count('SELECT id FROM orders ORDER BY number LIMIT 1');
  const contact = await run(b, (ctx, deps) => viewContact(ctx, oid, 'fondateur', deps));
  assert.equal(contact.email, PII.email);
  const sealed = (await b.rows('SELECT sealed FROM order_contacts')).map((r) => r.sealed).join(' ');
  assert.ok(!sealed.includes(PII.email) && !sealed.includes(PII.phone), 'coordonnées chiffrées au repos');
  assert.equal(await run(b, (ctx, deps) => purgeContacts(ctx, b.clock.now() + 1, 'fondateur', deps)), 3);
  assert.equal(await b.count('SELECT COUNT(*) FROM orders WHERE customer_name IS NOT NULL'), 3);
  const second = await run(b, (ctx, deps) => exportRecettes(ctx, 'fondateur', deps));
  assert.equal(second.sha256, first.sha256);
  const logs = Object.fromEntries((await b.rows("SELECT action, COUNT(*) AS n FROM audit_log WHERE action IN ('export_livre_recettes', 'view_customer_contact') GROUP BY action")).map((r) => [r.action, r.n]));
  assert.deepEqual(logs, { export_livre_recettes: 2, view_customer_contact: 1 });
});
