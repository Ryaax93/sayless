// Automatisations : rapport de 10 h (heure de Paris, été comme hiver), tâche de chaque minute
// (sauvegarde seule à la minute 5, battement pour l'écran Santé). Données de test uniquement.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  assert.deepEqual(Object.keys(five), ['backup', 'budget']);
  b.clock.t = at('2027-01-15T10:06:00Z');
  const six = await runScheduled(b.env, { deps: b.deps });
  assert.deepEqual(Object.keys(six), ['sweep', 'daily_report', 'mail', 'outbox', 'channels', 'heartbeat', 'budget']);
  assert.ok(six.budget.queries <= 50 && six.budget.external <= 50, 'requêtes et appels comptés, dans l’offre gratuite');
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

// Assistant d'installation du test Cloudflare, lancé comme le fondateur le lancera, contre un
// Wrangler simulé (aucun compte) ; les contrôles en ligne interrogent le vrai code du Worker.
test('T04 assistant de l’environnement de test : étapes vérifiées, reprise après l’adresse workers.dev, secrets envoyés une fois et jamais affichés', async () => {
  const work = mkdtempSync(join(tmpdir(), 'sayless-assistant-'));
  const secrets = join(work, 'secrets');
  const cloudDir = join(work, 'cloud');
  const local = join(work, 'local');
  for (const d of [cloudDir, local]) mkdirSync(d);
  const url = 'https://sayless-ops-test.sayless-essai.workers.dev';
  const b = await bench({ 'TEST-M': 1 }, { payments: false });
  Object.assign(b.env, { ENVIRONMENT: 'staging', STUDIO_ORIGIN: url, STUDIO_RP_ID: new URL(url).hostname });
  const server = createServer(async (req, res) => {
    const reply = await handleOps(new Request(`${url}${req.url}`), b.env, { deps: b.deps });
    res.writeHead(reply.status, { 'Content-Type': 'application/json' });
    res.end(await reply.text());
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const script = fileURLToPath(new URL('../../scripts/test-env.mjs', import.meta.url));
  const run = (args = [], extra = {}) => new Promise((ok) => {
    const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, SAYLESS_WRANGLER: fileURLToPath(new URL('./fixtures/fake-wrangler.mjs', import.meta.url)),
      FAKE_WRANGLER_DIR: cloudDir, SAYLESS_SECRETS_DIR: secrets, SAYLESS_TEST_ENV_LOCAL_DIR: local,
      SAYLESS_TEST_FETCH_BASE: `http://127.0.0.1:${server.address().port}`, ...extra } });
    let text = '';
    child.stdout.on('data', (d) => { text += d; });
    child.stderr.on('data', (d) => { text += d; });
    child.on('close', (code) => ok({ code, text }));
  });
  const calls = () => readFileSync(join(cloudDir, 'calls.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  try {
    const out = await run([], { FAKE_LOGGED_OUT: '1' });
    assert.equal(out.code, 1);
    assert.match(out.text, /npx wrangler login/);

    const first = await run();
    assert.equal(first.code, 1, 'arrêt propre tant que le compte n’a pas d’adresse workers.dev');
    assert.match(first.text, /dash\.cloudflare\.com\/0123456789abcdef0123456789abcdef\/workers\/onboarding/);
    assert.match(first.text, /\[5\] Tables de la base[\s\S]*OK : appliquées/);

    const second = await run([], { FAKE_SUBDOMAIN: 'sayless-essai' });
    assert.equal(second.code, 0, second.text);
    assert.match(second.text, new RegExp(`STUDIO est en ligne : ${url.replace(/[.]/g, '\\.')}`));
    assert.match(second.text, /prêt pour la première inscription/);
    assert.match(second.text, /CODE-STUDIO\.txt/);
    const cloud = JSON.parse(readFileSync(join(cloudDir, 'cloud.json'), 'utf8'));
    const worker = cloud.workers['sayless-ops-test'];
    assert.deepEqual(Object.keys(worker.secrets).sort(), ['ADMIN_SETUP_CODE', 'APP_SECRET', 'PII_KEY', 'VAPID_PRIVATE_KEY']);
    assert.equal(worker.vars.STUDIO_ORIGIN, url);
    assert.equal(worker.vars.STUDIO_RP_ID, 'sayless-ops-test.sayless-essai.workers.dev');
    assert.equal(worker.vars.ENVIRONMENT, 'staging');
    assert.ok(worker.vars.VAPID_PUBLIC_KEY && worker.vars.BACKUP_PUBLIC_KEY);
    for (const value of Object.values(worker.secrets)) {
      assert.ok(![first.text, second.text].some((t) => t.includes(value)), 'aucun secret affiché');
    }
    const config = readFileSync(join(local, 'wrangler.test.local.toml'), 'utf8');
    assert.match(config, /^preview_urls = false$/m);
    assert.doesNotMatch(config, /APP_SECRET|PII_KEY|ADMIN_SETUP_CODE|VAPID_PRIVATE_KEY/, 'aucun secret dans le fichier de configuration');
    assert.match(readFileSync(join(secrets, 'CODE-STUDIO.txt'), 'utf8'), new RegExp(worker.secrets.ADMIN_SETUP_CODE));

    const third = await run([], { FAKE_SUBDOMAIN: 'sayless-essai' });
    assert.equal(third.code, 0, third.text);
    assert.match(third.text, /déjà à jour/);
    const log = calls();
    assert.equal(log.filter((c) => c.args[0] === 'd1' && c.args[1] === 'create').length, 1, 'base créée une seule fois');
    assert.equal(log.filter((c) => c.args[0] === 'kv' && c.args[2] === 'create').length, 1, 'espace créé une seule fois');
    const create = log.find((c) => c.args[1] === 'create');
    assert.deepEqual([create.args.includes('weur'), create.args.includes(tmpdir())], [true, true], 'Europe de l’Ouest, hors du dossier du projet');
    const deploys = log.filter((c) => c.args[0] === 'deploy');
    assert.equal(deploys.filter((c) => c.args.includes('--secrets-file')).length, 2, 'secrets joints au premier envoi seulement (tentative refusée comprise)');
    assert.equal(deploys.length, 4, 'refusé, envoi avec secrets, envoi avec l’adresse de STUDIO, mise à jour');
    assert.ok(log.filter((c) => c.args[0] !== 'whoami').every((c) => c.account === '0123456789abcdef0123456789abcdef'), 'compte toujours désigné');

    const state = await run(['etat']);
    assert.equal(state.code, 0, state.text);
    assert.match(state.text, /Base : ok ; tâche planifiée : never ; paiement Stripe : test/, 'lu sur le vrai code du Worker (Stripe simulé du banc)');
    const setting = await run(['reglage', 'EMAIL_FROM', 'SAYLESS <onboarding@resend.dev>'], { FAKE_SUBDOMAIN: 'sayless-essai' });
    assert.equal(setting.code, 0, setting.text);
    assert.equal(JSON.parse(readFileSync(join(cloudDir, 'cloud.json'), 'utf8')).workers['sayless-ops-test'].vars.EMAIL_FROM, 'SAYLESS <onboarding@resend.dev>');
    assert.equal((await run(['secret', 'STRIPE_PUBLISHABLE'])).code, 1, 'seuls les secrets prévus');
  } finally {
    server.close();
    rmSync(work, { recursive: true, force: true });
  }
});
