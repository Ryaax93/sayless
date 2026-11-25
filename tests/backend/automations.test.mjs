// Automatisations : rapport de 10 h (heure de Paris, été comme hiver), tâche de chaque minute
// (sauvegarde seule à la minute 5, battement pour l'écran Santé). Données de test uniquement.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bench, PII, startDatabases, stopDatabases } from './helpers.mjs';
import { maybeDailyReport } from '../../backend/src/notify.mjs';
import { handleOps, runScheduled } from '../../backend/src/routes.mjs';

before(startDatabases);
after(stopDatabases);
const run = (b, fn) => { const { ctx, deps } = b.context(); return fn(ctx, deps); };
const at = (iso) => Date.parse(iso) / 1000;

test('T01 rapport quotidien : 10 h à Paris en hiver (9 h UTC) et en été (8 h UTC), une seule fois par jour, sans donnée personnelle', async () => {
  const b = await bench({ 'TEST-M': 3 });
  b.clock.t = at('2027-01-15T07:00:00Z');
  await b.buy('TEST-M', '10.150.0.1');
  for (const [iso, expected] of [['2027-01-15T08:59:00Z', null], ['2027-01-15T09:00:00Z', '2027-01-15'], ['2027-01-15T15:00:00Z', null],
    ['2027-07-15T07:59:00Z', null], ['2027-07-15T08:00:00Z', '2027-07-15']]) {
    b.clock.t = at(iso);
    assert.equal(await run(b, maybeDailyReport), expected, iso);
  }
  const reports = await b.rows("SELECT body FROM notifications WHERE kind = 'daily_report' ORDER BY ref");
  assert.equal(reports.length, 2);
  assert.match(reports[0].body, /^24 h : 1 vente\(s\), 83,50 € encaissés .* À vérifier : 0\. Demandes à traiter : 0\. Stock : M 2\. .*Santé : sauvegarde non configurée\.$/);
  assert.ok(reports.every((r) => !r.body.includes(PII.name) && !r.body.includes(PII.email)));
});

test('T02 tâche de chaque minute : minute 5 = sauvegarde seule (limites de l’offre gratuite) ; sinon balayage, envois et battement', async () => {
  const b = await bench({ 'TEST-M': 1 });
  b.clock.t = at('2027-01-15T10:05:00Z');
  const five = await runScheduled(b.env, { deps: b.deps });
  assert.deepEqual(Object.keys(five), ['backup']);
  b.clock.t = at('2027-01-15T10:06:00Z');
  const six = await runScheduled(b.env, { deps: b.deps });
  assert.deepEqual(Object.keys(six), ['sweep', 'daily_report', 'outbox', 'channels', 'heartbeat']);
  assert.equal(await b.count("SELECT value FROM settings WHERE key = 'notify_channels'"), 'discord', 'canaux du Worker déclarés pour la boutique');
  assert.equal(await b.count("SELECT value FROM settings WHERE key = 'cron_last_run'"), String(b.clock.now()));
});

test('T03 /health pour une surveillance externe : tâche planifiée jamais lancée, à jour, puis en retard ; aucune donnée sensible', async () => {
  const b = await bench({ 'TEST-M': 1 });
  const health = async () => (await handleOps(new Request('https://ops.test/health'), b.env, { deps: b.deps })).json();
  b.clock.t = at('2027-01-15T10:06:00Z');
  assert.equal((await health()).scheduler, 'never');
  await runScheduled(b.env, { deps: b.deps });
  assert.deepEqual(await health(), { ok: true, database: 'ok', scheduler: 'ok', stripe: 'test' });
  b.clock.t += 600;
  assert.equal((await health()).scheduler, 'late');
});
