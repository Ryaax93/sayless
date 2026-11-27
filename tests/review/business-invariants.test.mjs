// Recette séparée des corrections attendues de Claude. Les échecs restent visibles.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bench, event, startDatabases, stopDatabases, emptyDatabase } from '../backend/helpers.mjs';
import { dumpDatabase, restoreDatabase } from '../../backend/src/backup.mjs';
before(startDatabases);
after(stopDatabases);

test('Vente 1.0 réglée après comptage : sa pièce est retirée de la disponibilité', async () => {
  const b = await bench({ 'TEST-M': 1 });
  const sid = b.stripe.linkSession('m');
  b.stripe.sessions.get(sid).created = b.clock.t - 60; // ouverture avant le comptage, paiement reçu après
  b.clock.t += 60;
  assert.equal(await b.webhook(event('checkout.session.completed', sid)), 200);
  assert.equal(await b.count('SELECT status FROM orders'), 'paid');
  assert.deepEqual(await b.inv('TEST-M'), [0, 0]);
});

test('Une tentative déjà réservée retrouve sa session ouverte après l’expiration du devis', async () => {
  const b = await bench({ 'TEST-M': 1 });
  const quote = await b.quote([{ sku: 'TEST-M', quantity: 1 }]);
  b.stripe.loseResponse = true;
  const first = await b.checkout('TEST-M', undefined, { quote, key: 'review-reprise-identique' });
  assert.equal(first.status, 503);
  b.stripe.loseResponse = false;
  b.clock.t += 660;
  const retry = await b.checkout('TEST-M', undefined, { quote, key: 'review-reprise-identique' });
  assert.equal(retry.status, 200, retry.body.error);
  assert.equal(b.stripe.created, 1);
  assert.deepEqual(await b.inv('TEST-M'), [1, 1]);
});

test('La restauration après une vente concomitante conserve les invariants de stock', async () => {
  const b = await bench({ 'TEST-M': 1 });
  let interleaved = false;
  const db = {
    prepare(sql) {
      const statement = b.real.prepare(sql);
      // Le double de lecture ne modifie aucun résultat. Il autorise une vente normale
      // entre deux lectures hors transaction. Un lot D1 se termine d'un seul tenant.
      return {
        all: async () => {
          const rows = await statement.all();
          if (sql === 'SELECT * FROM "inventory"' && !interleaved) {
            interleaved = true;
            assert.equal((await b.buy('TEST-M')).status, 200);
          }
          return rows;
        },
        inner: statement,
      };
    },
    batch(statements) {
      return b.real.batch(statements.map((s) => s.inner ?? s));
    },
  };
  const dump = await dumpDatabase(db);
  const errors = await restoreDatabase(await emptyDatabase(), dump);
  assert.deepEqual(errors, []);
});
