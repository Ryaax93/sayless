// Corrections de la revue de Work (25 novembre 2026) et gardes avant l'ouverture des ventes.
// Données de test uniquement : SKU TEST-*, faux clients, Stripe et transporteur simulés.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bench, createKV, emptyDatabase, event, parallel, PII, startDatabases, stopDatabases, T0, TEST_TERMS } from './helpers.mjs';
import { checkDump, dumpDatabase, listBackups, maybeDailyBackup, openBackup, restoreDatabase } from '../../backend/src/backup.mjs';
import { buyLabel, viewContact } from '../../backend/src/operations.mjs';
import { publishTerms } from '../../backend/src/terms.mjs';
import { sweep } from '../../backend/src/payments.mjs';

before(startDatabases);
after(stopDatabases);
const DAY = 86400;
const run = (b, fn) => { const { ctx, deps } = b.context(); return fn(ctx, deps); };

// ---------- 1. ventes du lien 1.0 ----------
test('R01 lien 1.0 : lien et prix reconnus, instant réel du règlement, deux côtés de l’inventaire, cas ambigus soumis au fondateur', async () => {
  const b = await bench({ 'TEST-S': 3, 'TEST-M': 3, 'TEST-L': 3 }); // inventaire confirmé à T0
  const sale = async (size, { openedAt, ...opts } = {}) => {
    const sid = b.stripe.linkSession(size, 7500, PII, opts);
    if (openedAt !== undefined) b.stripe.sessions.get(sid).created = openedAt;
    assert.equal(await b.webhook(event('checkout.session.completed', sid)), 200);
    return sid;
  };
  const row = (sid) => b.real.prepare('SELECT status, review_reason, paid_at FROM orders WHERE stripe_session_id = ?').bind(sid).first();
  b.clock.t = T0 + 600;

  // Ouverte avant l'inventaire, réglée après (cas de la revue) : décomptée, sans revue.
  const after = await sale('s', { openedAt: T0 - 300, settledAt: T0 + 60 });
  assert.deepEqual(await row(after), { status: 'paid', review_reason: null, paid_at: T0 + 60 });
  assert.deepEqual(await b.inv('TEST-S'), [2, 0]);
  // Réglée plus de 24 h avant l'inventaire : déjà reflétée par le comptage.
  const old = await sale('m', { openedAt: T0 - 3 * DAY, settledAt: T0 - 2 * DAY });
  assert.equal((await row(old)).status, 'paid');
  assert.deepEqual(await b.inv('TEST-M'), [3, 0]);
  // Réglée 10 minutes avant l'inventaire : pièce retirée par prudence, décision du fondateur.
  const near = await sale('m', { openedAt: T0 - 900, settledAt: T0 - 600 });
  assert.deepEqual([(await row(near)).status, (await row(near)).review_reason], ['review', 'settled_near_inventory']);
  assert.deepEqual(await b.inv('TEST-M'), [2, 0]);
  // Instant du règlement inconnu (aucune charge) et ouverture avant l'inventaire : même prudence.
  const unknown = await sale('m', { openedAt: T0 - 900, settledAt: null });
  assert.deepEqual([(await row(unknown)).status, (await row(unknown)).review_reason], ['review', 'settlement_unknown']);
  assert.deepEqual(await b.inv('TEST-M'), [1, 0]);

  // Lien, prix, quantité ou devise non conformes : à vérifier, pièces retirées si elles sont libres.
  assert.equal((await row(await sale('l', { link: 'plink_inconnu' }))).review_reason, 'unknown_link');
  assert.equal((await row(await sale('l', { price: 'price_autre' }))).review_reason, 'price');
  assert.deepEqual(await b.inv('TEST-L'), [1, 0]);
  const two = await sale('s', { quantity: 2 });
  assert.equal((await row(two)).review_reason, 'quantity');
  assert.deepEqual(await b.inv('TEST-S'), [0, 0], 'deux pièces payées, deux pièces retirées');
  const usd = await sale('l', { currency: 'usd' });
  assert.equal((await row(usd)).review_reason, 'currency');
  assert.deepEqual(await b.inv('TEST-L'), [0, 0]);
  const noSize = await sale('xl');
  assert.deepEqual([(await row(noSize)).status, (await row(noSize)).review_reason], ['review', 'size']);
  // Plus de pièce libre en S : « payée sans pièce », alerte, jamais de stock négatif.
  const empty = await sale('s');
  assert.equal((await row(empty)).status, 'paid_no_stock');
  assert.deepEqual(await b.inv('TEST-S'), [0, 0]);

  // Renvois et événements simultanés d'une même session : une commande, un seul mouvement.
  const twin = b.stripe.linkSession('l', 7500, PII);
  b.clock.t += 1;
  const rev = await b.count("SELECT revision FROM inventory WHERE sku = 'TEST-L'");
  await b.real.prepare(`INSERT INTO stock_movements (sku, d_on_hand, d_reserved, reason, ref, note, actor, at)
    VALUES ('TEST-L', 1, 0, 'adjustment', 'adjust:test-r01', 'pièce retrouvée (test)', 'test', ?)`).bind(b.clock.now()).run();
  assert.equal(rev + 1, await b.count("SELECT revision FROM inventory WHERE sku = 'TEST-L'"));
  const ev = event('checkout.session.completed', twin);
  const codes = await Promise.all([b.webhook(ev), b.webhook({ ...ev, id: `${ev.id}_bis` }), b.webhook(ev),
    b.webhook(event('checkout.session.async_payment_succeeded', twin))]);
  assert.ok(codes.every((c) => c === 200));
  assert.equal(await b.count('SELECT COUNT(*) FROM orders WHERE stripe_session_id = ?', twin), 1);
  assert.equal(await b.count('SELECT COUNT(*) FROM stock_movements WHERE ref = ?', `link:${twin}`), 1);
  assert.deepEqual(await b.inv('TEST-L'), [0, 0]);
  assert.equal(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'legacy_link_review' AND level = 'critical'"), 7);
  assert.equal(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'legacy_link_without_stock'"), 1);
});

test('R02 lien 1.0 : inventaire non confirmé = historique sans effet ; lien non enregistré dans STUDIO = tout à vérifier', async () => {
  const b = await bench({ 'TEST-S': null, 'TEST-M': null, 'TEST-L': null });
  const sid = b.stripe.linkSession('m');
  await b.webhook(event('checkout.session.completed', sid));
  assert.deepEqual([await b.count('SELECT status FROM orders'), await b.count("SELECT reason FROM stock_movements WHERE ref = ?", `link:${sid}`)],
    ['paid', 'imported_sale']);
  assert.deepEqual(await b.inv('TEST-M'), [0, 0]);
  await b.real.prepare("UPDATE settings SET value = '' WHERE key = 'legacy_payment_link_id'").run();
  const other = b.stripe.linkSession('m');
  await b.webhook(event('checkout.session.completed', other));
  assert.equal(await b.count('SELECT review_reason FROM orders WHERE stripe_session_id = ?', other), 'link_not_configured');
});

// ---------- 2. reprise d'une tentative ----------
test('R03 reprise : tentative retrouvée par sa clé après l’expiration du devis ; même session et même réservation ; nouvel achat = devis valide', async () => {
  const b = await bench({ 'TEST-M': 2 });
  const quote = await b.quote([{ sku: 'TEST-M', quantity: 1 }]);
  b.stripe.loseResponse = true;
  const first = await b.checkout('TEST-M', undefined, { quote, key: 'reprise-apres-devis-0001' });
  b.stripe.loseResponse = false;
  assert.equal(first.status, 503);
  b.clock.t += 660; // devis de 10 minutes expiré ; réservation (32 min) et session Stripe (30,5 min) ouvertes
  b.deps.turnstile = async () => { throw new Error('aucun nouveau contrôle anti-abus pour une reprise'); };
  await publishTerms(b.real, { version: '2026-12', body: TEST_TERMS.body, actor: 'test', now: b.clock.now() });
  const retry = await b.checkout('TEST-M', undefined, { quote, key: 'reprise-apres-devis-0001' });
  assert.equal(retry.status, 200, retry.body.error);
  const again = await b.checkout('TEST-M', undefined, { quote, key: 'reprise-apres-devis-0001' });
  assert.deepEqual([again.sid, b.stripe.created], [retry.sid, 1], 'une seule session Stripe');
  assert.deepEqual(await b.inv('TEST-M'), [2, 1]);
  assert.equal(await b.count('SELECT COUNT(*) FROM reservations'), 1, 'une seule réservation');
  const fresh = await b.checkout('TEST-M', undefined, { quote, key: 'nouvelle-tentative-0001' });
  assert.equal(fresh.body.error, 'quote_expired', 'un devis expiré n’ouvre jamais un nouvel achat');
  // Tentative payée : état terminal et session renvoyés, pour afficher la page de suivi.
  b.stripe.pay(retry.sid);
  await b.webhook(event('checkout.session.completed', retry.sid));
  const closed = await b.checkout('TEST-M', undefined, { quote, key: 'reprise-apres-devis-0001' });
  assert.equal(closed.status, 409);
  assert.deepEqual({ ...closed.body, order_reference: typeof closed.body.order_reference },
    { error: 'attempt_closed', order_reference: 'string', payment_status: 'paid', session_id: retry.sid });
  const other = await b.checkout('TEST-M', undefined, { quote, key: 'reprise-apres-devis-0001', items: [{ sku: 'TEST-M', quantity: 1 }], shipping: 'relay', relay_id: 'TEST-RELAY-1' });
  assert.equal(other.body.error, 'idempotency_conflict');
});

test('R04 reprise d’une tentative jamais reçue par Stripe, plus de 30 s après : tentative close sans fausse alerte, pièce rendue', async () => {
  const b = await bench({ 'TEST-M': 1 });
  const quote = await b.quote([{ sku: 'TEST-M', quantity: 1 }]);
  b.stripe.down = true;
  assert.equal((await b.checkout('TEST-M', undefined, { quote, key: 'jamais-recue-stripe-01' })).status, 503);
  b.stripe.down = false;
  b.clock.t += 120;
  const retry = await b.checkout('TEST-M', undefined, { quote, key: 'jamais-recue-stripe-01' });
  assert.deepEqual([retry.status, retry.body.error, retry.body.payment_status], [409, 'attempt_closed', 'expired']);
  assert.deepEqual([await b.inv('TEST-M'), b.stripe.created], [[1, 0], 0]);
  assert.equal(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'technical'"), 0);
  assert.equal(await b.count("SELECT COUNT(*) FROM audit_log WHERE action = 'checkout_resume_refused'"), 1);
});

// ---------- 3. sauvegardes ----------
test('R05 sauvegardes pendant des ventes simultanées : chaque image est cohérente et restaurable ; une lecture table par table serait détectée', async () => {
  const b = await bench({ 'TEST-S': 20, 'TEST-M': 20, 'TEST-L': 20 });
  const dumps = [];
  await Promise.all([
    parallel(30, (i) => b.buy(['TEST-S', 'TEST-M', 'TEST-L'][i % 3], `10.105.${i}.1`)),
    parallel(10, (i) => b.checkout(['TEST-S', 'TEST-M', 'TEST-L'][i % 3], `10.106.${i}.1`)),
    (async () => { for (let i = 0; i < 12; i += 1) dumps.push(await dumpDatabase(b.real)); })(),
  ]);
  for (const dump of dumps) assert.deepEqual(checkDump(dump), []);
  assert.deepEqual(await restoreDatabase(await emptyDatabase(), dumps.at(-1)), []);
  // Contrôle négatif : l'ancienne lecture séparée, traversée par une vente, donne une image fausse.
  const inventory = (await b.real.prepare('SELECT * FROM inventory').all()).results;
  await b.buy('TEST-S', '10.107.0.1');
  const torn = await dumpDatabase(b.real);
  torn.tables.inventory = inventory;
  assert.ok(checkDump(torn).some((p) => p.includes('stock')), 'incohérence détectée avant toute écriture');
});

test('R06 copie défectueuse ou image incohérente : jamais comptée, aucune rotation, copies précédentes intactes', async () => {
  const b = await bench({ 'TEST-M': 4 });
  const keys = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
  const pub = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const priv = await crypto.subtle.exportKey('jwk', keys.privateKey);
  const kv = createKV();
  Object.assign(b.env, { BACKUPS: kv, BACKUP_PUBLIC_KEY: JSON.stringify(pub) });
  await b.real.prepare("UPDATE settings SET value = '3' WHERE key = 'backup_daily_keep'").run();
  b.clock.t = Date.UTC(2027, 2, 10, 4, 5) / 1000;
  for (let i = 0; i < 3; i += 1) { assert.ok(await run(b, maybeDailyBackup)); b.clock.t += DAY; }
  const before = (await listBackups(kv)).map((x) => x.name);
  assert.deepEqual(before, ['daily/2027-03-10', 'daily/2027-03-11', 'daily/2027-03-12']);
  // 1. Écriture altérée par le stockage : relecture différente → copie retirée, aucune rotation.
  kv.corrupt = true;
  await assert.rejects(run(b, maybeDailyBackup));
  kv.corrupt = false;
  assert.deepEqual((await listBackups(kv)).map((x) => x.name), before);
  assert.match(await b.count("SELECT value FROM settings WHERE key = 'backup_last_error'"), /readback_mismatch/);
  assert.equal(await b.count("SELECT value FROM settings WHERE key = 'backup_last_date'"), '', 'nouvel essai à l’heure suivante');
  // 2. Image incohérente (stock ≠ registre) : rien n'est écrit.
  const real = b.env.DB;
  b.env.DB = { prepare: (q) => real.prepare(q), batch: async (stmts) => {
    const res = await real.batch(stmts);
    for (const r of res) for (const row of r.results ?? []) if (row && 'on_hand' in row && 'revision' in row) row.on_hand += 1;
    return res;
  } };
  await assert.rejects(run(b, maybeDailyBackup));
  b.env.DB = real;
  assert.deepEqual((await listBackups(kv)).map((x) => x.name), before);
  assert.match(await b.count("SELECT value FROM settings WHERE key = 'backup_last_error'"), /dump_inconsistent/);
  assert.equal(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'backup_failed' AND level = 'critical'"), 1);
  // 3. Essai suivant réussi : vérifié, puis rotation (les 3 plus récentes), restauration complète.
  b.clock.t += 3600;
  assert.equal(await run(b, maybeDailyBackup), '2027-03-13');
  const list = await listBackups(kv);
  assert.deepEqual(list.map((x) => x.name), ['daily/2027-03-11', 'daily/2027-03-12', 'daily/2027-03-13']);
  assert.ok(list.every((x) => x.checks === 'ok' && /^[a-f0-9]{64}$/.test(x.sha256)));
  const copy = await emptyDatabase();
  assert.deepEqual(await restoreDatabase(copy, await openBackup(await kv.get('daily/2027-03-13'), priv)), []);
  assert.ok(Number(await b.count("SELECT value FROM settings WHERE key = 'backup_last_verified_at'")) > 0);
});

// ---------- 4. gardes avant l'ouverture des ventes ----------
test('R07 ouverture : inventaire de TOUT le produit, CGV publiées et versionnées, chiffrement des coordonnées obligatoire', async () => {
  const partial = await bench({ 'TEST-S': 2, 'TEST-M': 2, 'TEST-L': null });
  assert.equal((await partial.quote([{ sku: 'TEST-M', quantity: 1 }])).body.error, 'stock_unavailable');
  const t = partial.clock.now();
  await partial.real.prepare(`INSERT INTO orders (id, reference, source, status, subtotal_cents, shipping_cents, total_cents, created_at, updated_at)
    VALUES ('o-test', 'SL-TEST-0001', 'storefront', 'pending', 7500, 0, 7500, ?, ?)`).bind(t, t).run();
  await assert.rejects(partial.real.prepare(`INSERT INTO reservations (id, order_id, sku, quantity, client_hash, status, expires_at, created_at, updated_at)
    VALUES ('r-test', 'o-test', 'TEST-M', 1, 'c', 'held', ?, ?, ?)`).bind(t + 60, t, t).run(), /stock_unverified/, 'la base refuse aussi');

  const b = await bench({ 'TEST-M': 3 });
  const q = await b.quote([{ sku: 'TEST-M', quantity: 1 }]);
  assert.equal(q.body.terms_version, TEST_TERMS.version, 'version des CGV signée dans le devis');
  await assert.rejects(b.real.prepare("UPDATE terms_documents SET body = 'modifié'").run(), /terms_final/);
  await assert.rejects(b.real.prepare('DELETE FROM terms_documents').run(), /terms_final/);
  await assert.rejects(publishTerms(b.real, { ...TEST_TERMS, actor: 'test', now: b.clock.now() }), (e) => e.code === 'terms_version_exists');
  await publishTerms(b.real, { version: '2027-01', body: TEST_TERMS.body, actor: 'test', now: b.clock.now() });
  assert.equal((await b.checkout('TEST-M', '10.120.0.1', { quote: q })).body.error, 'terms_outdated');
  await b.real.prepare("UPDATE settings SET value = '' WHERE key = 'terms_version'").run();
  assert.equal((await b.quote([{ sku: 'TEST-M', quantity: 1 }])).body.error, 'not_configured', 'aucune CGV publiée : aucun devis');
  await b.real.prepare("UPDATE settings SET value = ? WHERE key = 'terms_version'").bind(TEST_TERMS.version).run();

  const key = b.env.PII_KEY;
  for (const value of ['', 'cle-invalide']) {
    b.env.PII_KEY = value;
    const r = await b.checkout('TEST-M', '10.121.0.1');
    assert.equal(r.body.error, 'not_configured', `chiffrement absent (${value || 'vide'}) : aucun paiement ouvert`);
  }
  b.env.PII_KEY = key;
  assert.equal(await b.count('SELECT COUNT(*) FROM reservations'), 0);
});

test('R08 coordonnées : liées à leur commande ; clé retirée après le paiement = commande à vérifier, aucune étiquette', async () => {
  const b = await bench({ 'TEST-M': 3 });
  await b.buy('TEST-M', '10.122.0.1');
  await b.buy('TEST-M', '10.122.0.2');
  const [a, c] = (await b.rows('SELECT id FROM orders ORDER BY created_at')).map((r) => r.id);
  const { ctx, deps } = b.context();
  assert.equal((await viewContact(ctx, a, 'test', deps)).email, PII.email);
  const sealedA = await b.count('SELECT sealed FROM order_contacts WHERE order_id = ?', a);
  await b.real.prepare('UPDATE order_contacts SET sealed = ? WHERE order_id = ?').bind(sealedA, c).run();
  await assert.rejects(viewContact(ctx, c, 'test', deps), 'un chiffré copié sur une autre commande ne s’ouvre pas');

  const r = await b.checkout('TEST-M', '10.122.0.3');
  b.env.PII_KEY = '';
  b.stripe.pay(r.sid);
  await b.webhook(event('checkout.session.completed', r.sid));
  const order = await b.real.prepare('SELECT id, status, review_reason FROM orders WHERE stripe_session_id = ?').bind(r.sid).first();
  assert.deepEqual([order.status, order.review_reason], ['review', 'contact_not_sealed']);
  assert.deepEqual(await b.inv('TEST-M'), [0, 0], 'pièce gardée pour cette commande');
  assert.equal(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'contact_not_sealed' AND level = 'critical'"), 1);
  assert.equal((await run(b, (cx, dp) => buyLabel(cx, order.id, b.carrier, 'test', dp))).result, 'order_not_payable');
});

test('R09 destination : recherche de relais et devis appliquent les mêmes refus ; relais choisi figé dans la commande', async () => {
  const b = await bench({ 'TEST-M': 2 });
  const corse = await b.api('GET', '/api/relay-points?postcode=20000');
  assert.deepEqual([corse.status, corse.body.error], [422, 'destination_not_supported']);
  assert.equal((await b.api('GET', '/api/relay-points?postcode=abc')).body.error, 'postcode_required');
  const paris = await b.api('GET', '/api/relay-points?postcode=75016');
  assert.deepEqual(paris.body.points.map((p) => p.id), ['TEST-RELAY-1'], 'point corse et point fermé écartés');
  assert.deepEqual(paris.body.points[0].address, { line1: '1 rue du Relais Test', line2: null, postcode: '75016', city: 'Paris', country: 'FR' });
  const r = await b.checkout('TEST-M', '10.123.0.1', { shipping: 'relay', relay_id: 'TEST-RELAY-1' });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(await b.count('SELECT relay_snapshot FROM orders')), { id: 'TEST-RELAY-1', name: 'Relais Test', network: 'TEST',
    address: { line1: '1 rue du Relais Test', line2: null, postcode: '75016', city: 'Paris', country: 'FR' } });
  assert.equal((await b.quote([{ sku: 'TEST-M', quantity: 1 }], { shipping: 'relay', relay_id: 'TEST-RELAY-CORSE' })).body.error, 'destination_not_supported');
});

test('R10 balayage : session incertaine retrouvée pendant la réservation et gardée ; refus explicite de Stripe = pièce rendue', async () => {
  const b = await bench({ 'TEST-M': 2 });
  b.stripe.loseResponse = true;
  const lost = await b.checkout('TEST-M', '10.124.0.1');
  b.stripe.loseResponse = false;
  b.stripe.down = true;
  const neverSent = await b.checkout('TEST-M', '10.124.0.2');
  b.stripe.down = false;
  b.clock.t += 120; // la seconde tentative n'a jamais atteint Stripe : sa date d'expiration n'est plus acceptée
  const swept = await run(b, sweep);
  assert.deepEqual([swept.recovered, swept.released], [1, 1]);
  assert.deepEqual(await b.inv('TEST-M'), [2, 1]);
  const resumed = await b.checkout('TEST-M', '10.124.0.1', { quote: lost.quote, key: lost.key });
  assert.deepEqual([resumed.status, b.stripe.created], [200, 1]);
  void neverSent;
});
