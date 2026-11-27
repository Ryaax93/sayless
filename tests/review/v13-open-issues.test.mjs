// Régressions de la revue v1.3, corrigées par Claude et conservées contre les récidives.
// Services externes simulés, base locale éphémère. Aucun correctif backend dans cette branche Work.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bench, event, startDatabases, stopDatabases } from '../backend/helpers.mjs';
before(startDatabases); after(stopDatabases);
test('V13-B1 : une confirmation e-mail perdue lors de la mise en file est réparée au renvoi du webhook', async () => {
  const b = await bench({ 'TEST-S': 1, 'TEST-M': 1, 'TEST-L': 1 });
  b.env.RESEND_API_KEY = 'fixture-only'; b.env.EMAIL_FROM = 'recette@example.invalid';
  const checkout = await b.checkout('TEST-M', '10.198.0.1'); assert.equal(checkout.status, 200);
  b.stripe.pay(checkout.sid);
  await b.real.prepare("CREATE TRIGGER fixture_mail_failure BEFORE INSERT ON outbox WHEN NEW.channel='email' BEGIN SELECT RAISE(ABORT, 'fixture_network_failure'); END").run();
  await b.webhook(event('checkout.session.completed', checkout.sid));
  await b.real.prepare('DROP TRIGGER fixture_mail_failure').run(); b.clock.t += 60;
  await b.webhook(event('checkout.session.completed', checkout.sid));
  assert.equal(await b.count("SELECT COUNT(*) FROM outbox WHERE channel='email' AND dedupe LIKE 'email:order_confirmation:%'"), 1);
});
test('V13-B2 : un devis exige un document de CGV archivé, pas seulement une version dans settings', async () => {
  const b = await bench({ 'TEST-S': 1, 'TEST-M': 1, 'TEST-L': 1 });
  await b.real.prepare("UPDATE settings SET value='version-sans-document' WHERE key='terms_version'").run();
  const result = await b.api('POST', '/api/quote', { body: { items: [{ sku: 'TEST-M', quantity: 1 }], shipping: 'home', country: 'FR', postcode: '75011' } });
  assert.equal(result.status, 503); assert.equal(result.body.error, 'not_configured');
});
