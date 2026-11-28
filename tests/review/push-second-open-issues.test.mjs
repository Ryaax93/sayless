// Second contre-audit Work sur 56d960b. Critères non satisfaits : ne pas les ignorer.
// Vrais routeurs et D1 locale ; fournisseurs simulés, aucune donnée ni clé réelle.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabases, stopDatabases, T0 } from '../backend/helpers.mjs';
import { studio } from '../backend/studio-helpers.mjs';
import { vapidAuthorization } from '../../backend/src/push.mjs';
import { keys, device, setup, ENDPOINT } from './push-review-helpers.mjs';

before(startDatabases);
after(stopDatabases);

test('P2-R1 : un premier JWT émis juste avant une frontière horaire reste réutilisé une heure', async (t) => {
  const env = await keys();
  const boundary = Math.floor(T0 / 3600) * 3600 + 3600;
  const first = await vapidAuthorization(env, ENDPOINT, boundary - 1);
  const fresh = await import(`../../backend/src/push.mjs?second-audit=${crypto.randomUUID()}`);
  const second = await fresh.vapidAuthorization(env, ENDPOINT, boundary + 1);
  t.diagnostic(`Deux démarrages à froid séparés de 2 secondes : ${new Set([first, second]).size} JWT. Aucun jeton journalisé.`);
  assert.equal(first === second, true, 'Une fenêtre civile ne garantit pas un délai minimal de réutilisation après la première émission.');
});

test('P2-R2 : remplacement effectif du webhook défaillant, diagnostic rétabli et incident historique conservé', async (t) => {
  const b = await setup({ subscribed: false });
  delete b.env.DISCORD_WEBHOOK_URL;
  b.env.DISCORD_WEBHOOK_COMMANDES = 'https://discord.com/api/webhooks/1/ancien_recette';
  b.env.DISCORD_WEBHOOK_ALERTES = 'https://discord.com/api/webhooks/2/alertes_recette';
  b.responses.discord = (url) => new Response(null, { status: url.endsWith('/ancien_recette') ? 404 : 204 });
  await b.notify('order_paid', 'avant-correction');
  await b.drain();
  assert.equal(await b.count("SELECT state FROM channel_health WHERE channel = 'discord'"), 'failing');
  // Même opération que corriger le secret du salon puis créer un nouveau contexte Worker.
  b.env.DISCORD_WEBHOOK_COMMANDES = 'https://discord.com/api/webhooks/3/remplacement_recette';
  b.clock.t += 60;
  await b.notify('order_paid', 'apres-correction');
  await b.drain();
  const failed = await b.count("SELECT COUNT(*) FROM outbox WHERE channel = 'discord' AND dedupe = 'discord:order_paid:apres-correction' AND status <> 'sent'");
  assert.equal(failed, 0, 'le nouveau webhook a réellement accepté le message simulé');
  const state = await b.count("SELECT state FROM channel_health WHERE channel = 'discord'");
  const old = await b.count("SELECT COUNT(*) FROM delivery_health WHERE channel = 'discord' AND state = 'failing'");
  t.diagnostic(`Après remplacement accepté : agrégat=${state}, ancienne destination en échec=${old}.`);
  assert.equal(state, 'ok', 'Une destination retirée ne doit pas bloquer indéfiniment la santé des destinations actuelles.');
});

test('P2-R3 : expiration concurrente à l’enregistrement, aucun faux succès « abonné »', async (t) => {
  const b = await studio();
  await b.enroll();
  Object.assign(b.env, await keys());
  const sub = await device(b.real, b.clock.now());
  b.env.DB.state.beforeBatch = async (statements) => {
    if (!statements.some((s) => s.includes('INSERT INTO push_subscriptions'))) return false;
    await b.real.prepare("UPDATE push_subscriptions SET expired_at = ?, last_error = 'apple_410' WHERE endpoint = ?")
      .bind(b.clock.now(), ENDPOINT).run();
    return true;
  };
  const result = await b.call('POST', '/api/admin/push/subscribe', { endpoint: ENDPOINT, keys: { p256dh: sub.p256dh, auth: sub.auth }, key: b.env.VAPID_PUBLIC_KEY });
  const expired = await b.count('SELECT expired_at IS NOT NULL FROM push_subscriptions WHERE endpoint = ?', ENDPOINT);
  t.diagnostic(`Expiration pendant l’inscription : subscribed=${result.body.subscribed}, expired=${expired}.`);
  assert.equal(expired, 1, 'l’expiration doit rester conservée');
  assert.equal(result.body.subscribed, false, 'Le résultat doit refléter la ligne effective, pas la lecture précédant la transaction.');
});

test('P2-R4 : une ancienne réponse Apple acceptée ne masque pas le refus d’un essai plus récent', async (t) => {
  const b = await studio();
  await b.enroll();
  Object.assign(b.env, await keys());
  await device(b.real, b.clock.now());
  let unblock, started;
  const gate = new Promise((r) => { unblock = r; });
  const entered = new Promise((r) => { started = r; });
  let calls = 0;
  b.deps.transport = async () => {
    calls += 1;
    if (calls === 1) { started(); await gate; return new Response(null, { status: 201 }); }
    return new Response('{"reason":"BadJwtToken"}', { status: 403 });
  };
  const oldTest = b.call('POST', '/api/admin/push/test', { endpoint: ENDPOINT });
  await entered;
  b.clock.t += 1;
  const recent = await b.call('POST', '/api/admin/push/test', { endpoint: ENDPOINT });
  assert.equal(recent.body.devices[0].status, 403);
  unblock();
  await oldTest;
  const [row] = await b.rows('SELECT last_status, last_error, last_attempt_at, test_sent_at FROM push_subscriptions');
  const health = (await b.call('GET', '/api/admin/health')).body.checks.find((c) => c.name === 'Notifications iPhone');
  t.diagnostic(`Dernier essai refusé 403, ancienne réponse 201 tardive : status=${row.last_status}, erreur=${row.last_error}, santé=${health.state}.`);
  assert.equal(row.last_status, 403, 'Les résultats par appareil doivent être liés à leur tentative, comme ceux de la file.');
  assert.equal(health.state, 'alert');
});
