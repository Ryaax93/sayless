// Véritable Wrangler LOCAL, dans un dossier temporaire. Aucune liaison distante utilisée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, cp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

test('P2-A6 Wrangler local : base 0008 peuplée, 0009 puis 0010, dix migrations et seconde application sans effet', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const dir = await mkdtemp(join(tmpdir(), 'sayless-push2-migrations-'));
  const migrations = join(dir, 'migrations');
  const config = join(dir, 'wrangler.json');
  await mkdir(migrations);
  await writeFile(config, JSON.stringify({ name: 'sayless-audit-local', compatibility_date: '2026-05-15',
    d1_databases: [{ binding: 'DB', database_name: 'sayless-audit-local', database_id: '11111111-2222-4333-8444-555555555555', migrations_dir: migrations }] }));
  const run = (args) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', ...args, '--local', '-c', config, '--persist-to', join(dir, 'state')],
      { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => { try { assert.equal(code, 0, out + err); resolve(out); } catch (e) { reject(e); } });
  });
  const apply = () => run(['migrations', 'apply', 'DB']);
  const sql = async (query) => JSON.parse(await run(['execute', 'DB', '--json', '--command', query]))[0].results;
  try {
    for (const name of (await readdir(join(root, 'backend/migrations'))).filter((n) => /^000[1-8]_.*\.sql$/.test(n))) await cp(join(root, 'backend/migrations', name), join(migrations, name));
    await apply();
    await sql("INSERT INTO push_subscriptions (endpoint,p256dh,auth,label,created_at,failures) VALUES ('https://web.push.apple.com/recette','cle-recette','auth-recette','iPhone recette',1800000000,176)");
    await cp(join(root, 'backend/migrations/0009_notifications_fiables.sql'), join(migrations, '0009_notifications_fiables.sql'));
    await apply();
    await sql("INSERT INTO channel_health (channel,state,since,failures,last_error) VALUES ('push','failing',1800000000,7,'apple_403_BadJwtToken')");
    await cp(join(root, 'backend/migrations/0010_destinations_reception.sql'), join(migrations, '0010_destinations_reception.sql'));
    await apply();
    const read = () => sql('SELECT failures, expired_at, test_id, test_sent_at, received_at, (SELECT COUNT(*) FROM d1_migrations) AS migrations FROM push_subscriptions');
    const before = await read();
    assert.deepEqual(before, [{ failures: 176, expired_at: null, test_id: null, test_sent_at: null, received_at: null, migrations: 10 }]);
    assert.deepEqual(await sql('SELECT channel,destination,state,failures FROM delivery_health'), [{ channel: 'push', destination: 'iphone', state: 'failing', failures: 7 }]);
    await apply();
    assert.deepEqual(await read(), before);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
