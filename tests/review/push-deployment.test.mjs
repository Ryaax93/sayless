// Vérification de l'assistant et de Wrangler LOCAL. Aucune commande distante réelle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const execute = (args, env = {}) => new Promise((resolve, reject) => {
  const proc = spawn(process.execPath, args, { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let stdout = '';
  proc.stdout.on('data', (s) => { output += s; stdout += s; });
  proc.stderr.on('data', (s) => { output += s; });
  proc.on('error', reject);
  proc.on('close', (code) => resolve({ code, output, stdout }));
});

test('PUSH-D1 assistant : installation existante, 10 salons et connecteurs, aucune rotation des secrets ni changement de liaison', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sayless-push-update-'));
  const local = join(dir, 'local');
  const cloud = join(dir, 'cloud');
  await mkdir(local); await mkdir(cloud);
  const account = '0123456789abcdef0123456789abcdef';
  const db = '11111111-2222-4333-8444-555555555555';
  const kv = 'abcdef0123456789abcdef0123456789';
  const url = 'https://sayless-ops-test.audit-local.workers.dev';
  const names = ['APP_SECRET', 'ADMIN_SETUP_CODE', 'PII_KEY', 'VAPID_PRIVATE_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY',
    ...['COMMANDES', 'EXPEDITIONS', 'RETOURS', 'STOCK', 'FINANCES', 'RAPPORT', 'ALERTES', 'SECURITE', 'SITE', 'SAUVEGARDES'].map((s) => `DISCORD_WEBHOOK_${s}`)];
  const secrets = Object.fromEntries(names.map((name) => [name, `VAL-${name}-RECETTE-NON-REELLE`]));
  const original = { account_id: account, database_id: db, kv_id: kv, url, secrets_uploaded: true,
    public: { VAPID_PUBLIC_KEY: 'CLE-PUBLIQUE-DE-RECETTE', BACKUP_PUBLIC_KEY: 'CLE-SAUVEGARDE-DE-RECETTE' },
    settings: { EMAIL_FROM: 'SAYLESS <recette@example.invalid>', WEBAUTHN_ENGINE: 'sayless' } };
  await writeFile(join(local, 'test-env.local.json'), JSON.stringify(original));
  await writeFile(join(cloud, 'cloud.json'), JSON.stringify({ d1: [{ uuid: db, name: 'sayless-test', migrated: true }],
    kv: [{ id: kv, title: 'sayless-test-backups' }], workers: { 'sayless-ops-test': { deployments: 9, secrets } } }));
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url === '/health' ? { ok: true, database: 'ok', environment: 'staging', payments: 'closed', stripe: 'test', scheduler: 'ok' } : { enrolled: true }));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const r = await execute([join(root, 'scripts/test-env.mjs')], { SAYLESS_WRANGLER: join(root, 'tests/backend/fixtures/fake-wrangler.mjs'),
      FAKE_WRANGLER_DIR: cloud, FAKE_SUBDOMAIN: 'audit-local', SAYLESS_TEST_ENV_LOCAL_DIR: local,
      SAYLESS_SECRETS_DIR: join(dir, 'absent-intentionnellement'), SAYLESS_TEST_ENV_CONFIRM: 'OUI',
      SAYLESS_TEST_FETCH_BASE: `http://127.0.0.1:${server.address().port}` });
    assert.equal(r.code, 0, r.output);
    const updated = JSON.parse(await readFile(join(cloud, 'cloud.json'), 'utf8'));
    assert.deepEqual(updated.workers['sayless-ops-test'].secrets, secrets);
    const state = JSON.parse(await readFile(join(local, 'test-env.local.json'), 'utf8'));
    for (const key of ['account_id', 'database_id', 'kv_id', 'url', 'public', 'settings']) assert.deepEqual(state[key], original[key], key);
    const calls = (await readFile(join(cloud, 'calls.log'), 'utf8')).trim().split('\n').map((s) => JSON.parse(s).args);
    assert.equal(calls.some((a) => a.includes('create') || a.includes('delete') || a.includes('secret') || a.includes('--secrets-file')), false);
    assert.ok(calls.findIndex((a) => a.includes('time-travel')) < calls.findIndex((a) => a.includes('migrations')));
    assert.equal(calls.filter((a) => a[0] === 'deploy').length, 1);
    const config = await readFile(join(local, 'wrangler.test.local.toml'), 'utf8');
    for (const value of Object.values(secrets)) assert.equal((r.output + config).includes(value), false);
    assert.match(r.output, /iPhone déjà inscrit/);
  } finally { await new Promise((r) => server.close(r)); await rm(dir, { recursive: true, force: true }); }
});

test('PUSH-D2 vrai Wrangler --local : 0001–0008 puis 0009, registre des migrations et seconde exécution sans effet', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sayless-push-migration-'));
  const migrations = join(dir, 'migrations');
  await mkdir(migrations);
  const config = join(dir, 'wrangler.json');
  const store = join(dir, 'state');
  await writeFile(config, JSON.stringify({ name: 'sayless-audit-local', compatibility_date: '2026-05-15',
    d1_databases: [{ binding: 'DB', database_name: 'sayless-audit-local', database_id: '11111111-2222-4333-8444-555555555555', migrations_dir: migrations }] }));
  const run = async (args) => {
    const r = await execute([join(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', ...args, '--local', '-c', config, '--persist-to', store]);
    assert.equal(r.code, 0, r.output);
    return args.includes('--json') ? r.stdout : r.output;
  };
  try {
    for (const name of (await readdir(join(root, 'backend/migrations'))).filter((n) => /^000[1-8]_.*\.sql$/.test(n))) await cp(join(root, 'backend/migrations', name), join(migrations, name));
    await run(['migrations', 'apply', 'DB']);
    await run(['execute', 'DB', '--command', "INSERT INTO push_subscriptions (endpoint,p256dh,auth,label,created_at,failures) VALUES ('https://web.push.apple.com/recette','cle-recette','auth-recette','iPhone recette',1800000000,176)"]);
    await cp(join(root, 'backend/migrations/0009_notifications_fiables.sql'), join(migrations, '0009_notifications_fiables.sql'));
    await run(['migrations', 'apply', 'DB']);
    const read = async () => JSON.parse(await run(['execute', 'DB', '--json', '--command', 'SELECT failures, expired_at, last_status, (SELECT COUNT(*) FROM d1_migrations) AS migrations FROM push_subscriptions']))[0].results;
    const first = await read();
    assert.deepEqual(first, [{ failures: 176, expired_at: null, last_status: null, migrations: 9 }]);
    await run(['migrations', 'apply', 'DB']);
    assert.deepEqual(await read(), first);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
