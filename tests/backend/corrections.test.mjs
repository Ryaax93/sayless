// Corrections de la revue de Work (25 novembre 2026) et gardes avant l'ouverture des ventes.
// Données de test uniquement : SKU TEST-*, faux clients, Stripe et transporteur simulés.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bench, createKV, emptyDatabase, event, parallel, PII, startDatabases, stopDatabases, T0, TEST_TERMS } from './helpers.mjs';
import { checkDump, dumpDatabase, listBackups, maybeDailyBackup, openBackup, restoreDatabase } from '../../backend/src/backup.mjs';
import { buyLabel, viewContact } from '../../backend/src/operations.mjs';
import { publishTerms } from '../../backend/src/terms.mjs';
import { recordLegacyLinkSale, sweep } from '../../backend/src/payments.mjs';
import { handlePublicApi, runScheduled } from '../../backend/src/routes.mjs';
import { processMailIntents } from '../../backend/src/intents.mjs';
import { b64url, sha256Hex } from '../../backend/src/lib.mjs';
import { COST } from '../../backend/src/budget.mjs';
import { deliverOutbox } from '../../backend/src/notify.mjs';

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

// ---------- 5. contre-revue v1.3 de Work : e-mails durables et CGV archivées ----------
const MAIL = { RESEND_API_KEY: 're_test_uniquement', EMAIL_FROM: 'SAYLESS <commandes@example.invalid>' };
// E-mails activés avec un réseau simulé : Resend répond « accepté », chaque envoi est noté.
const mailOn = (b) => {
  Object.assign(b.env, MAIL);
  b.mails = [];
  b.deps.transport ??= async (url, init) => { b.mails.push({ url, key: init.headers?.['Idempotency-Key'] }); return new Response('{}', { status: 200 }); };
};
const FAIL_MAIL = "CREATE TRIGGER fixture_mail_failure BEFORE INSERT ON outbox WHEN NEW.channel = 'email' BEGIN SELECT RAISE(ABORT, 'fixture_network_failure'); END";
const emails = (b, kind) => b.count("SELECT COUNT(*) FROM outbox WHERE channel = 'email' AND dedupe LIKE ?", `email:${kind}:%`);

test('R11 V13-B1 confirmation : intention écrite avec la vente ; panne de file réparée par la tâche planifiée, jamais perdue ni doublée', async () => {
  const b = await bench({ 'TEST-S': 1, 'TEST-M': 2, 'TEST-L': 1 });
  mailOn(b);
  const c = await b.checkout('TEST-M', '10.211.0.1');
  assert.equal(c.status, 200);
  b.stripe.pay(c.sid);
  await b.real.prepare(FAIL_MAIL).run();
  const ev = event('checkout.session.completed', c.sid);
  assert.equal(await b.webhook(ev), 200, 'vente appliquée et acquittée malgré la panne de file');
  assert.equal(await b.count('SELECT status FROM orders WHERE stripe_session_id = ?', c.sid), 'paid');
  const [intent] = await b.rows('SELECT kind, attempts, queued_at, last_error FROM mail_intents');
  assert.deepEqual([intent.kind, intent.attempts, intent.queued_at], ['order_confirmation', 1, null], 'intention durable, en attente');
  assert.match(intent.last_error, /fixture_network_failure/);
  assert.equal(await b.webhook(ev), 200, 'renvoi du même événement pendant la panne');
  assert.equal(await emails(b, 'order_confirmation'), 0);
  await b.real.prepare('DROP TRIGGER fixture_mail_failure').run();
  b.clock.t += 61;
  const run = await runScheduled(b.env, { deps: b.deps });
  assert.deepEqual(run.mail, { queued: 1, failed: 0 }, 'reprise par la tâche planifiée, sans aucun webhook');
  assert.equal(await emails(b, 'order_confirmation'), 1);
  // Renvois, nouvel événement, passages simultanés : toujours une seule confirmation.
  await Promise.all([b.webhook(ev), b.webhook(event('checkout.session.completed', c.sid)),
    processMailIntents(b.context().ctx, b.deps, { only: `order_confirmation:${await b.count('SELECT id FROM orders')}` })]);
  assert.equal(await emails(b, 'order_confirmation'), 1);
  assert.equal(await b.count('SELECT COUNT(*) FROM mail_intents'), 1);
});

test('R12 V13-B1 webhooks simultanés et adresses : une confirmation, aucune adresse en clair ; sans envoi configuré au paiement, aucune confirmation tardive', async () => {
  const b = await bench({ 'TEST-S': 1, 'TEST-M': 2, 'TEST-L': 1 });
  mailOn(b);
  const c = await b.checkout('TEST-M', '10.212.0.1');
  b.stripe.pay(c.sid);
  await parallel(8, () => b.webhook(event('checkout.session.completed', c.sid)));
  assert.equal(await emails(b, 'order_confirmation'), 1);
  assert.equal(await b.count('SELECT COUNT(*) FROM mail_intents WHERE queued_at IS NOT NULL'), 1);
  assert.equal(await b.count('SELECT COUNT(*) FROM mail_intents WHERE dedupe LIKE ? OR ref LIKE ?', `%${PII.email}%`, `%${PII.email}%`), 0, 'aucune donnée personnelle dans l’intention');
  const quiet = await bench({ 'TEST-S': 1, 'TEST-M': 2, 'TEST-L': 1 });
  const d = await quiet.checkout('TEST-M', '10.212.0.2');
  quiet.stripe.pay(d.sid);
  await quiet.webhook(event('checkout.session.completed', d.sid));
  mailOn(quiet); // e-mails configurés après la vente
  quiet.clock.t += 120;
  await quiet.webhook(event('checkout.session.completed', d.sid));
  await runScheduled(quiet.env, { deps: quiet.deps });
  assert.deepEqual([await quiet.count('SELECT COUNT(*) FROM mail_intents'), await emails(quiet, 'order_confirmation')], [0, 0]);
});

test('R13 V13-B1 accusé des demandes : demande et intention dans la même transaction ; panne de file réparée, référence renvoyée', async () => {
  const b = await bench({ 'TEST-M': 1 });
  mailOn(b);
  await b.real.prepare(FAIL_MAIL).run();
  const res = await b.api('POST', '/api/requests', { body: { type: 'contact', name: 'Client Test', email: PII.email, message: 'Question de test', turnstile: 'jeton-test' } });
  assert.equal(res.status, 200, 'demande enregistrée malgré la panne');
  assert.match(res.body.reference, /^R-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  assert.deepEqual([await b.count('SELECT COUNT(*) FROM customer_requests'), await b.count('SELECT attempts FROM mail_intents')], [1, 1]);
  await b.real.prepare('DROP TRIGGER fixture_mail_failure').run();
  b.clock.t += 61;
  await runScheduled(b.env, { deps: b.deps });
  await runScheduled(b.env, { deps: b.deps });
  assert.equal(await emails(b, 'request_ack'), 1);
});

test('R14 V13-B1 intention bloquée : alerte critique au 5e essai, essais espacés ; commande remboursée entre-temps = rien envoyé', async () => {
  const b = await bench({ 'TEST-S': 1, 'TEST-M': 2, 'TEST-L': 1 });
  mailOn(b);
  b.sent = [];
  b.deps.notify = async (n) => { b.sent.push(n); };
  const c = await b.checkout('TEST-M', '10.214.0.1');
  b.stripe.pay(c.sid);
  await b.real.prepare(FAIL_MAIL).run();
  await b.webhook(event('checkout.session.completed', c.sid));
  const { ctx } = b.context();
  for (let attempt = 2; attempt <= 6; attempt += 1) {
    b.clock.t = await b.count('SELECT next_at FROM mail_intents');
    assert.deepEqual(await processMailIntents(ctx, b.deps, { limit: 3 }), { queued: 0, failed: 1 });
    assert.equal(await b.count('SELECT attempts FROM mail_intents'), attempt);
  }
  const stuck = b.sent.filter((n) => n.kind === 'mail_intent_stuck');
  assert.deepEqual(stuck.map((n) => n.level), ['critical'], 'une seule alerte, au 5e essai');
  assert.ok(!JSON.stringify(stuck).includes(PII.email));
  await b.real.prepare('DROP TRIGGER fixture_mail_failure').run();
  await b.real.prepare("UPDATE orders SET status = 'refunded'").run();
  b.clock.t = await b.count('SELECT next_at FROM mail_intents');
  assert.deepEqual(await processMailIntents(ctx, b.deps, { limit: 3 }), { queued: 0, failed: 0 });
  assert.deepEqual([await b.count('SELECT last_error FROM mail_intents'), await emails(b, 'order_confirmation')], ['obsolete', 0]);
});

test('R15 V13-B2 CGV : devis et réservation exigent le document archivé ; publication concurrente refusée par la base ; reprise préservée', async () => {
  const b = await bench({ 'TEST-S': 2, 'TEST-M': 3, 'TEST-L': 2 });
  const q = await b.quote([{ sku: 'TEST-M', quantity: 1 }]);
  assert.deepEqual([q.body.terms_version, q.body.terms_sha256, q.body.terms_url], [TEST_TERMS.version, await sha256Hex(TEST_TERMS.body), `/api/terms/${TEST_TERMS.version}`]);
  // Tentative ouverte, puis nouvelles CGV : la reprise rend la même session ; un nouvel achat exige le nouveau document.
  const first = await b.checkout('TEST-M', '10.215.0.1', { quote: q });
  assert.equal(first.status, 200);
  assert.equal(await b.count('SELECT terms_sha256 FROM orders'), await sha256Hex(TEST_TERMS.body), 'empreinte acceptée conservée avec la commande');
  await publishTerms(b.real, { version: '2027-01', body: `${TEST_TERMS.body} Version 2027-01.`, actor: 'test', now: b.clock.now() });
  const resumed = await b.checkout('TEST-M', '10.215.0.1', { quote: q, key: first.key });
  assert.deepEqual([resumed.status, resumed.body.url, b.stripe.created], [200, first.body.url, 1], 'reprise de la tentative existante');
  assert.equal((await b.checkout('TEST-M', '10.215.0.2', { quote: q })).body.error, 'terms_outdated');
  // Publication concurrente entre les contrôles et l'écriture : la base refuse la réservation.
  const q2 = await b.api('POST', '/api/quote', { body: { items: [{ sku: 'TEST-M', quantity: 1 }], shipping: 'home', postcode: '75011' }, ip: '10.215.0.3' });
  b.db.state.beforeBatch = async (texts) => {
    if (!texts.some((t) => t.includes('INSERT INTO reservations'))) return false;
    await publishTerms(b.real, { version: '2027-02', body: `${TEST_TERMS.body} Version 2027-02.`, actor: 'test', now: b.clock.now() });
    return true;
  };
  const raced = await b.api('POST', '/api/checkout', { ip: '10.215.0.3', headers: { 'Idempotency-Key': 'course-cgv-concurrente-0001' },
    body: { items: [{ sku: 'TEST-M', quantity: 1 }], shipping: 'home', quote_id: q2.body.id, terms_version: '2027-01', turnstile: 'jeton-test' } });
  assert.deepEqual([raced.status, raced.body.error], [409, 'terms_outdated']);
  assert.equal(await b.count("SELECT COUNT(*) FROM orders WHERE idempotency_key = 'course-cgv-concurrente-0001'"), 0, 'lot entier annulé');
  // Version citée sans document : aucun devis, aucune commande, aucune réservation (contrôles SQL).
  const before = await b.quote([{ sku: 'TEST-M', quantity: 1 }], { ip: '10.215.0.4' });
  await b.real.prepare("UPDATE settings SET value = 'version-sans-document' WHERE key = 'terms_version'").run();
  assert.equal((await b.quote([{ sku: 'TEST-M', quantity: 1 }])).body.error, 'not_configured');
  // Paiement d'un devis signé avant le changement : nouveau consentement demandé (409), rien de créé.
  const stale = await b.checkout('TEST-M', '10.215.0.4', { quote: before, key: 'cgv-changees-sans-document-01' });
  assert.deepEqual([stale.status, stale.body.error], [409, 'terms_outdated']);
  assert.equal(await b.count("SELECT COUNT(*) FROM orders WHERE idempotency_key = 'cgv-changees-sans-document-01'"), 0);
  const t = b.clock.now();
  await assert.rejects(b.real.prepare(`INSERT INTO orders (id, reference, source, status, subtotal_cents, shipping_cents, total_cents, terms_version, created_at, updated_at)
    VALUES ('o-fantome', 'SL-FANT-0001', 'storefront', 'pending', 7500, 0, 7500, 'version-sans-document', ?, ?)`).bind(t, t).run(), /terms_unpublished/);
  await b.real.prepare(`INSERT INTO orders (id, reference, source, status, subtotal_cents, shipping_cents, total_cents, created_at, updated_at)
    VALUES ('o-sans-cgv', 'SL-SANS-0001', 'storefront', 'pending', 7500, 0, 7500, ?, ?)`).bind(t, t).run();
  await assert.rejects(b.real.prepare(`INSERT INTO reservations (id, order_id, sku, quantity, client_hash, status, expires_at, created_at, updated_at)
    VALUES ('r-sans-cgv', 'o-sans-cgv', 'TEST-M', 1, 'c', 'held', ?, ?, ?)`).bind(t + 60, t, t).run(), /terms_unpublished/);
  await b.real.prepare("UPDATE settings SET value = '2027-02' WHERE key = 'terms_version'").run();
  await assert.rejects(b.real.prepare(`INSERT INTO reservations (id, order_id, sku, quantity, client_hash, status, expires_at, created_at, updated_at)
    VALUES ('r-sans-cgv', 'o-sans-cgv', 'TEST-M', 1, 'c', 'held', ?, ?, ?)`).bind(t + 60, t, t).run(), /terms_outdated/, 'commande sans CGV : jamais réservée');
});

test('R16 V13-C1 texte des CGV : route publique en lecture seule, document exact et empreinte ; empreinte vérifiée au paiement ; texte altéré jamais servi', async () => {
  const b = await bench({ 'TEST-S': 2, 'TEST-M': 3, 'TEST-L': 2 });
  b.sent = [];
  b.deps.notify = async (n) => { b.sent.push(n); };
  const get = async (path) => {
    const res = await handlePublicApi(new Request(`https://boutique.test${path}`), b.env, { deps: b.deps });
    return { status: res.status, body: await res.json(), cache: res.headers.get('Cache-Control'), etag: res.headers.get('ETag'), cookie: res.headers.get('Set-Cookie') };
  };
  const digest = await sha256Hex(TEST_TERMS.body);
  const cur = await get('/api/terms');
  assert.deepEqual([cur.status, cur.body.version, cur.body.sha256, cur.body.current, cur.body.format, cur.body.body], [200, TEST_TERMS.version, digest, true, 'text/plain', TEST_TERMS.body]);
  assert.equal(await sha256Hex(cur.body.body), cur.body.sha256, 'empreinte recalculable par la boutique');
  assert.deepEqual([cur.cache, cur.etag, cur.cookie], ['public, max-age=0, must-revalidate', `"${digest}"`, null]);
  const pinned = await get(`/api/terms/${TEST_TERMS.version}`);
  assert.deepEqual([pinned.status, pinned.cache], [200, 'public, max-age=86400, immutable']);
  assert.deepEqual([(await get('/api/terms/inconnue')).status, (await get('/api/terms/%3Cscript%3E')).status], [404, 404]);
  // Empreinte du document affiché : vérifiée si la boutique l'envoie (contrat v1.4).
  const q = await b.quote([{ sku: 'TEST-M', quantity: 1 }]);
  const pay = (key, extra) => b.api('POST', '/api/checkout', { ip: '10.216.0.1', headers: { 'Idempotency-Key': key },
    body: { items: [{ sku: 'TEST-M', quantity: 1 }], shipping: 'home', quote_id: q.body.id, terms_version: TEST_TERMS.version, turnstile: 'jeton-test', ...extra } });
  assert.equal((await pay('cgv-empreinte-fausse-0001', { terms_sha256: '0'.repeat(64) })).body.error, 'terms_outdated');
  assert.equal((await pay('cgv-empreinte-format-0001', { terms_sha256: 'pas-une-empreinte' })).body.error, 'invalid_request');
  assert.equal((await pay('cgv-empreinte-exacte-0001', { terms_sha256: digest })).status, 200);
  // Nouvelle version : l'ancienne reste lisible (immuable), marquée comme ancienne.
  await publishTerms(b.real, { version: '2027-01', body: `${TEST_TERMS.body} Version 2027-01.`, actor: 'test', now: b.clock.now() });
  assert.deepEqual([(await get('/api/terms')).body.version, (await get(`/api/terms/${TEST_TERMS.version}`)).body.current], ['2027-01', false]);
  // Texte altéré en contournant les protections : jamais servi, aucun devis, alerte critique.
  await b.real.prepare('DROP TRIGGER terms_final_u').run();
  await b.real.prepare("UPDATE terms_documents SET body = body || ' altéré' WHERE version = '2027-01'").run();
  assert.equal((await get('/api/terms')).status, 503);
  assert.equal((await b.quote([{ sku: 'TEST-M', quantity: 1 }])).body.error, 'not_configured');
  assert.deepEqual(b.sent.filter((n) => n.kind === 'terms_integrity').map((n) => n.level), ['critical']);
  await b.real.prepare("UPDATE settings SET value = '' WHERE key = 'terms_version'").run();
  assert.deepEqual([(await get('/api/terms')).status, (await get('/api/terms')).body.error], [503, 'not_configured']);
});

// ---------- 5. limites de l'offre gratuite Cloudflare (50 requêtes D1, 50 appels externes) ----------
// Les envois passent par les vrais expéditeurs (Resend, Discord, push) avec un réseau simulé, pour
// compter chaque appel comme Cloudflare le compte. Le banc compte aussi, de son côté, chaque requête
// D1 : les deux comptes doivent coïncider.
async function heavyBacklog() {
  const b = await bench({ 'TEST-U': 40 });
  const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  Object.assign(b.env, MAIL, { DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/test-uniquement',
    VAPID_PUBLIC_KEY: b64url(new Uint8Array(await crypto.subtle.exportKey('raw', vapid.publicKey))),
    VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', vapid.privateKey)).d, VAPID_SUBJECT: 'mailto:test@example.invalid' });
  for (const n of [1, 2]) {
    const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    await b.real.prepare(`INSERT INTO push_subscriptions (endpoint, p256dh, auth, label, created_at) VALUES (?, ?, ?, 'test', ?)`)
      .bind(`https://web.push.apple.com/QTEST${n}`, b64url(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey))),
        b64url(crypto.getRandomValues(new Uint8Array(16))), T0).run();
  }
  b.network = [];
  b.deps.channels = ['discord', 'push'];
  b.deps.transport = async (url, init) => {
    b.network.push({ host: new URL(url).host, key: init.headers?.['Idempotency-Key'] ?? null });
    return new Response('{}', { status: String(url).includes('push.apple.com') ? 201 : 200 });
  };
  b.stripeCalls = 0;
  for (const m of ['createCheckoutSession', 'retrieveSession', 'expireSession']) {
    const original = b.stripe[m].bind(b.stripe);
    b.stripe[m] = (...a) => { b.stripeCalls += 1; return original(...a); };
  }
  // Ouverture d'un drop : 25 paniers abandonnés, 3 ventes, 4 demandes dont l'accusé est resté en
  // attente, 30 alertes pour le fondateur ; le rapport de 10 h est dû.
  for (let i = 0; i < 25; i += 1) assert.equal((await b.checkout('TEST-U', `10.217.${i}.1`)).status, 200);
  for (let i = 0; i < 3; i += 1) await b.buy('TEST-U', `10.218.${i}.1`);
  await b.real.prepare(FAIL_MAIL).run();
  for (let i = 0; i < 4; i += 1) {
    assert.equal((await b.api('POST', '/api/requests', { ip: `10.219.0.${i}`, body: { type: 'contact', name: 'Client Test', email: PII.email, message: 'Question de test', turnstile: 'jeton-test' } })).status, 200);
  }
  await b.real.prepare('DROP TRIGGER fixture_mail_failure').run();
  for (let i = 0; i < 30; i += 1) await b.context().deps.notify({ kind: 'technical', ref: `test:${i}`, level: 'info', title: 'Alerte de test', body: 'Message de test' });
  b.clock.t = T0 + 4 * 3600 + 7 * 60; // 13 h 07 à Paris, paniers expirés
  return b;
}

test('R17 offre gratuite : tâche planifiée sous 50 requêtes D1 et 50 appels externes par minute, même après l’ouverture d’un drop ; rien perdu ni doublé', async () => {
  const b = await heavyBacklog();
  const pending = async () => [await b.count("SELECT COUNT(*) FROM orders WHERE status = 'pending'"),
    await b.count('SELECT COUNT(*) FROM mail_intents WHERE queued_at IS NULL'),
    await b.count("SELECT COUNT(*) FROM outbox WHERE status <> 'sent'")];
  const start = await pending();
  assert.ok(start[0] === 25 && start[1] === 4 && start[2] > 60, `travail en attente au départ : ${start}`);
  b.network = [];
  let minutes = 0;
  while ((await pending()).some(Boolean)) {
    assert.ok(minutes < 30, `travail restant après 30 minutes : ${await pending()}`);
    const [q0, n0, s0] = [b.db.state.queries, b.network.length, b.stripeCalls];
    const report = await runScheduled(b.env, { deps: b.deps });
    assert.ok(report.budget.queries <= 50 && report.budget.external <= 50, `minute ${minutes} : ${JSON.stringify(report.budget)}`);
    assert.equal(report.budget.queries, b.db.state.queries - q0, 'chaque requête D1 comptée');
    assert.equal(report.budget.external, b.network.length - n0 + b.stripeCalls - s0, 'chaque appel externe compté');
    assert.deepEqual(Object.entries(report).filter(([, v]) => String(v).startsWith('erreur')), [], 'aucune étape interrompue');
    if (!('backup' in report)) assert.equal(await b.count("SELECT value FROM settings WHERE key = 'cron_last_run'"), String(b.clock.now()), 'battement écrit');
    minutes += 1;
    b.clock.t += 60;
  }
  assert.ok(minutes >= 3, 'le travail a bien été réparti sur plusieurs minutes');
  console.log(`[R17] arriéré traité en ${minutes} minutes`);
  assert.deepEqual(await b.inv('TEST-U'), [37, 0], 'les 25 pièces des paniers abandonnés reviennent, les 3 vendues restent sorties');
  assert.equal(await b.count("SELECT COUNT(*) FROM outbox WHERE status = 'dead'"), 0);
  const resend = b.network.filter((c) => c.host === 'api.resend.com').map((c) => c.key);
  assert.deepEqual([resend.length, new Set(resend).size], [7, 7], '3 confirmations et 4 accusés, une fois chacun');
  const discord = await b.count("SELECT COUNT(*) FROM outbox WHERE channel = 'discord'");
  const push = await b.count("SELECT COUNT(*) FROM outbox WHERE channel = 'push'");
  assert.equal(b.network.filter((c) => c.host === 'discord.com').length, discord, 'chaque alerte Discord envoyée une fois');
  assert.equal(b.network.filter((c) => c.host === 'web.push.apple.com').length, push * 2, 'chaque alerte push envoyée une fois à chacun des 2 appareils');
  assert.ok(await b.count("SELECT COUNT(*) FROM notifications WHERE kind = 'daily_report'"), 'rapport du jour envoyé');
});

test('R18 offre gratuite : webhook de la dernière pièce (fin du drop) sous 50 requêtes ; pire coût par unité dans les marges du budget', async () => {
  // Webhook : vente de la dernière pièce, deux e-mails en attente repris au passage.
  const b = await bench({ 'TEST-S': 1, 'TEST-M': 1, 'TEST-L': 1 });
  mailOn(b);
  await b.buy('TEST-S', '10.220.0.1');
  await b.buy('TEST-L', '10.220.0.2');
  await b.real.prepare(FAIL_MAIL).run();
  for (let i = 0; i < 3; i += 1) await b.api('POST', '/api/requests', { ip: `10.220.1.${i}`, body: { type: 'contact', name: 'Client Test', email: PII.email, message: 'Question', turnstile: 'jeton-test' } });
  await b.real.prepare('DROP TRIGGER fixture_mail_failure').run();
  b.clock.t += 61;
  const c = await b.checkout('TEST-M', '10.220.0.3');
  b.stripe.pay(c.sid);
  const q0 = b.db.state.queries;
  assert.equal(await b.webhook(event('checkout.session.completed', c.sid)), 200);
  const used = b.db.state.queries - q0;
  assert.ok(used <= 50, `webhook : ${used} requêtes`);
  assert.deepEqual([await b.count("SELECT COUNT(*) FROM mail_intents WHERE kind = 'order_confirmation' AND queued_at IS NULL"),
    await b.count("SELECT COUNT(*) FROM mail_intents WHERE kind = 'request_ack' AND queued_at IS NOT NULL")], [0, 2],
  'confirmation mise en file, et deux accusés en attente repris au passage (le troisième à la minute suivante)');
  assert.ok(await b.count("SELECT COUNT(*) FROM notifications WHERE kind IN ('size_sold_out', 'drop_sold_out')") >= 1, 'alertes de fin de stock émises');
  // Pire cas par unité, mesuré : vente rattrapée par le balayage (webhook jamais reçu).
  const r = await bench({ 'TEST-S': 1, 'TEST-M': 1, 'TEST-L': 1 });
  mailOn(r);
  await r.buy('TEST-S', '10.221.0.1');
  await r.buy('TEST-L', '10.221.0.2');
  const d = await r.checkout('TEST-M', '10.221.0.3');
  r.stripe.pay(d.sid);
  r.clock.t += 2000;
  const q1 = r.db.state.queries;
  const swept = await run(r, (ctx, deps) => sweep(ctx, deps, 1));
  assert.equal(await r.count('SELECT status FROM orders WHERE stripe_session_id = ?', d.sid), 'paid', 'vente rattrapée');
  assert.ok(r.db.state.queries - q1 <= COST.sweepOrder.queries, `balayage d’une vente : ${r.db.state.queries - q1} requêtes pour ${COST.sweepOrder.queries} prévues (${JSON.stringify(swept)})`);
  // E-mail en échec au 5e essai (alerte) et message en échec définitif (alerte) : dans leur coût prévu.
  const m = await bench({ 'TEST-M': 2 });
  mailOn(m);
  await m.real.prepare(FAIL_MAIL).run();
  await m.buy('TEST-M', '10.222.0.1'); // 1er essai au paiement, en échec
  assert.equal(await m.count('SELECT attempts FROM mail_intents'), 1);
  for (let attempt = 2; attempt < 5; attempt += 1) {
    m.clock.t += 3600;
    await run(m, (ctx, deps) => processMailIntents(ctx, deps, { limit: 1 }));
  }
  m.clock.t += 3600;
  const q2 = m.db.state.queries;
  await run(m, (ctx, deps) => processMailIntents(ctx, deps, { limit: 1 }));
  assert.equal(await m.count('SELECT attempts FROM mail_intents'), 5);
  assert.equal(await m.count("SELECT COUNT(*) FROM notifications WHERE kind = 'mail_intent_stuck'"), 1, 'alerte émise au 5e essai');
  assert.ok(m.db.state.queries - q2 - 1 <= COST.mailIntent.queries, `e-mail en échec avec alerte : ${m.db.state.queries - q2 - 1} requêtes`);
  await m.real.prepare("UPDATE outbox SET attempts = 4, next_at = 0 WHERE channel = 'discord'").run();
  m.deps.senders = { discord: async () => { throw new Error('discord_500'); } };
  const q3 = m.db.state.queries;
  const { ctx, deps } = m.context();
  await deliverOutbox(ctx, deps.senders, deps, { limit: 1 });
  assert.equal(await m.count("SELECT COUNT(*) FROM outbox WHERE status = 'dead'"), 1);
  assert.ok(m.db.state.queries - q3 - 1 <= COST.outboxMessage.queries, `message en échec définitif avec alerte : ${m.db.state.queries - q3 - 1} requêtes`);
  // Vente 1.0 qui épuise la dernière taille (alertes « taille épuisée » et « fin du drop »).
  const l = await bench({ 'TEST-S': 1, 'TEST-M': 1, 'TEST-L': 1 });
  l.clock.t += 400;
  let worst = 0;
  for (const size of ['s', 'm', 'l']) {
    const full = await l.stripe.retrieveSession(l.stripe.linkSession(size, 7500, PII));
    const q4 = l.db.state.queries;
    assert.equal((await run(l, (ctx, deps) => recordLegacyLinkSale(ctx, full, deps))).status, 'paid');
    worst = Math.max(worst, l.db.state.queries - q4);
  }
  assert.ok(await l.count("SELECT COUNT(*) FROM notifications WHERE kind = 'drop_sold_out'"), 'fin du drop signalée');
  assert.ok(worst <= COST.legacySale.queries, `vente 1.0 la plus coûteuse : ${worst} requêtes pour ${COST.legacySale.queries} prévues`);
});
