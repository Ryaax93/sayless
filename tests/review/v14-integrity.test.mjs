// Contre-audit indépendant. Véritable routeur et D1 locale ; aucun fournisseur réel.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bench, event, startDatabases, stopDatabases, emptyDatabase } from '../backend/helpers.mjs';
import { processMailIntents } from '../../backend/src/intents.mjs';
import { dumpDatabase, restoreDatabase, checkDump } from '../../backend/src/backup.mjs';
import { publishTerms } from '../../backend/src/terms.mjs';
import { createHash } from 'node:crypto';
before(startDatabases); after(stopDatabases);
const mail = b => { b.env.RESEND_API_KEY = 'fixture-only'; b.env.EMAIL_FROM = 'fixture@example.invalid'; };
const delivery = { items: [{ sku: 'TEST-M', quantity: 1 }], shipping: 'home', postcode: '75011', country: 'FR' };
test('v1.4 B1 : panne de création de l’intention annule la vente entière, puis le webhook réussit une fois', async () => {
  const b = await bench({ 'TEST-M': 2 }); mail(b); const c = await b.checkout('TEST-M','10.196.0.1'); b.stripe.pay(c.sid); const ev = event('checkout.session.completed', c.sid);
  await b.real.prepare("CREATE TRIGGER test_intent_abort BEFORE INSERT ON mail_intents BEGIN SELECT RAISE(ABORT,'fixture_intent_failure'); END").run();
  assert.equal(await b.webhook(ev), 500); assert.equal(await b.count('SELECT status FROM orders'), 'pending'); assert.deepEqual(await b.inv('TEST-M'), [2,1]);
  assert.equal(await b.count('SELECT COUNT(*) FROM processed_events'), 0);
  await b.real.prepare('DROP TRIGGER test_intent_abort').run(); assert.equal(await b.webhook(ev), 200); assert.equal(await b.webhook(ev), 200);
  assert.deepEqual(await b.inv('TEST-M'), [1,0]); assert.equal(await b.count('SELECT COUNT(*) FROM mail_intents'), 1);
});
test('v1.4 B1 : panne après insertion dans la file, reprise concurrente sans second message', async () => {
  const b = await bench({ 'TEST-M': 2 }); mail(b); const c = await b.checkout('TEST-M','10.196.0.2'); b.stripe.pay(c.sid);
  await b.real.prepare("CREATE TRIGGER test_mark_abort BEFORE UPDATE OF queued_at ON mail_intents BEGIN SELECT RAISE(ABORT,'fixture_mark_failure'); END").run();
  assert.equal(await b.webhook(event('checkout.session.completed',c.sid)), 200);
  assert.equal(await b.count("SELECT COUNT(*) FROM outbox WHERE channel='email'"), 1); assert.equal(await b.count('SELECT queued_at FROM mail_intents'), null);
  await b.real.prepare('DROP TRIGGER test_mark_abort').run(); b.clock.t += 600;
  await Promise.all(Array.from({length:6}, () => processMailIntents({ ...b.env, db:b.db }, b.deps)));
  assert.equal(await b.count("SELECT COUNT(*) FROM outbox WHERE channel='email'"), 1); assert.ok(await b.count('SELECT queued_at FROM mail_intents'));
});
test('v1.4 B1 : une demande et son intention sont atomiques même avant toute mise en file', async () => {
  const b = await bench({ 'TEST-M': 1 }); mail(b);
  await b.real.prepare("CREATE TRIGGER test_ack_abort BEFORE INSERT ON mail_intents BEGIN SELECT RAISE(ABORT,'fixture_intent_failure'); END").run();
  const r = await b.api('POST','/api/requests',{body:{type:'withdrawal',email:'fixture@example.invalid',turnstile:'fixture'}});
  assert.equal(r.status,503); assert.equal(await b.count('SELECT COUNT(*) FROM customer_requests'),0);
});
test('v1.4 B2/C1 : texte exact, version archivée immuable, empreinte erronée refusée sans stock réservé', async () => {
  const b = await bench({ 'TEST-M': 2 });
  const body = 'TEST — document non contractuel.\r\n  Espaces et accents. <b>Texte brut</b>\n'.repeat(5);
  const published = await publishTerms(b.real,{version:'v14-fixture',body,actor:'recette',now:b.clock.t});
  const q = await b.api('POST','/api/quote',{body:delivery}); assert.equal(q.status,200);
  const d = await b.api('GET',q.body.terms_url); assert.equal(d.body.body, body); assert.equal(d.body.sha256,createHash('sha256').update(body).digest('hex'));
  assert.equal(q.body.terms_sha256, published.sha256);
  await assert.rejects(b.real.prepare("UPDATE terms_documents SET body='altération' WHERE version='v14-fixture'").run());
  const r = await b.api('POST','/api/checkout',{headers:{'Idempotency-Key':'test-hash-incoherent'},body:{...delivery,quote_id:q.body.id,terms_version:q.body.terms_version,terms_sha256:'0'.repeat(64),turnstile:'fixture'}});
  assert.equal(r.status,409); assert.equal(r.body.error,'terms_outdated'); assert.equal(await b.count('SELECT COUNT(*) FROM reservations'),0);
});
test('v1.4 B2 : archive altérée entre devis et paiement ferme les deux accès', async () => {
  const b = await bench({ 'TEST-M': 2 }); const q = (await b.quote(delivery.items)).body;
  await b.real.prepare('DROP TRIGGER terms_final_u').run(); await b.real.prepare("UPDATE terms_documents SET body=body||'altéré'").run();
  assert.equal((await b.api('GET',q.terms_url)).status,503);
  assert.equal((await b.api('POST','/api/quote',{body:delivery})).status,503);
  const r = await b.api('POST','/api/checkout',{headers:{'Idempotency-Key':'test-archive-alteree'},body:{...delivery,quote_id:q.id,terms_version:q.terms_version,terms_sha256:q.terms_sha256,turnstile:'fixture'}});
  assert.equal(r.status,503); assert.equal(await b.count('SELECT COUNT(*) FROM reservations'),0);
});
test('v1.4 sauvegarde : intention en attente et archive CGV restaurées puis e-mail repris une seule fois', async () => {
  const b = await bench({ 'TEST-M': 2 }); mail(b); const c = await b.checkout('TEST-M','10.196.0.4'); b.stripe.pay(c.sid);
  await b.real.prepare("CREATE TRIGGER test_queue_abort BEFORE INSERT ON outbox WHEN NEW.channel='email' BEGIN SELECT RAISE(ABORT,'fixture_queue_failure'); END").run();
  await b.webhook(event('checkout.session.completed',c.sid)); await b.real.prepare('DROP TRIGGER test_queue_abort').run();
  const dump = await dumpDatabase(b.real); assert.deepEqual(checkDump(dump),[]); assert.equal(dump.tables.mail_intents.length,1); assert.ok(dump.tables.terms_documents.length);
  const target = await emptyDatabase();
  assert.deepEqual(await restoreDatabase(target,dump),[]); b.clock.t+=600;
  await processMailIntents({...b.env,db:target},b.deps); await processMailIntents({...b.env,db:target},b.deps);
  assert.equal((await target.prepare("SELECT COUNT(*) AS n FROM outbox WHERE channel='email'").first()).n,1);
});
