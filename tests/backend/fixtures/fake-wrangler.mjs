// Wrangler SIMULÉ pour tester scripts/test-env.mjs sans compte Cloudflare : mêmes commandes et
// mêmes formats de sortie que Wrangler 4.92 (JSON pour les listes), état du « nuage » dans un fichier.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.FAKE_WRANGLER_DIR;
const file = join(dir, 'cloud.json');
const cloud = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { d1: [], kv: [], workers: {}, subdomain: null };
const args = process.argv.slice(2);
appendFileSync(join(dir, 'calls.log'), `${JSON.stringify({ args, account: process.env.CLOUDFLARE_ACCOUNT_ID ?? null, cwd: process.cwd() })}\n`);
const save = () => writeFileSync(file, JSON.stringify(cloud));
const out = (text) => process.stdout.write(`${text}\n`);
const fail = (text) => { process.stderr.write(`✘ [ERROR] ${text}\n`); process.exit(1); };
const opt = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const VALUED = ['-c', '--location', '--cwd', '--secrets-file'];
const words = args.filter((x, i) => !x.startsWith('-') && !VALUED.includes(args[i - 1]));
const ACCOUNT = { name: 'SAYLESS', id: '0123456789abcdef0123456789abcdef' };
const config = () => readFileSync(opt('-c'), 'utf8');
const var_ = (text, key) => text.match(new RegExp(`^${key} = "(.*)"$`, 'm'))?.[1] ?? null;
cloud.subdomain = process.env.FAKE_SUBDOMAIN ?? null;

const [a, b, c] = words;
if (a === 'whoami') {
  if (process.env.FAKE_LOGGED_OUT) { out('{"loggedIn":false}'); process.exit(1); }
  out(JSON.stringify({ loggedIn: true, authType: 'OAuth Token', email: 'fondateur@example.test', accounts: [ACCOUNT] }));
} else if (a === 'd1' && b === 'list') {
  out(JSON.stringify(cloud.d1));
} else if (a === 'd1' && b === 'create') {
  cloud.d1.push({ uuid: `db-${cloud.d1.length + 1}-0000-0000-0000-000000000000`, name: c });
  save();
  out(`✅ Successfully created DB '${c}' in region WEUR`);
} else if (a === 'kv' && b === 'namespace' && c === 'list') {
  out(JSON.stringify(cloud.kv));
} else if (a === 'kv' && b === 'namespace' && c === 'create') {
  cloud.kv.push({ id: `kv${cloud.kv.length + 1}`.padEnd(32, '0'), title: words[3] });
  save();
  out(`🌀 Creating namespace with title "${words[3]}"\n✨ Success!`);
} else if (a === 'd1' && b === 'migrations' && c === 'apply') {
  const text = config();
  const db = cloud.d1.find((d) => d.name === words[3]);
  if (!db || var_(text, 'database_id') !== db.uuid) fail(`Couldn't find a D1 DB with the name or binding '${words[3]}'`);
  if (process.env.FAKE_MIGRATIONS_FAIL) fail('A request to the Cloudflare API failed (simulé : connexion coupée)');
  if (db.migrated) out('✅ No migrations to apply!');
  else { db.migrated = true; save(); out('Migrations to be applied:\n│ 0001_init.sql │\n✅ Applied 6 migrations'); }
} else if (a === 'secret' && b === 'list') {
  const w = cloud.workers[var_(config(), 'name')];
  if (!w) fail('This Worker does not exist on your account. [code: 10007]');
  out(JSON.stringify(Object.keys(w.secrets).map((name) => ({ name, type: 'secret_text' }))));
} else if (a === 'deploy') {
  const text = config();
  const name = var_(text, 'name');
  if (!cloud.subdomain) fail(`You need to register a workers.dev subdomain before publishing to workers.dev\nhttps://dash.cloudflare.com/${ACCOUNT.id}/workers/onboarding`);
  const w = cloud.workers[name] ?? { secrets: {}, deployments: 0 };
  const secrets = opt('--secrets-file');
  if (secrets) for (const [k, v] of Object.entries(JSON.parse(readFileSync(secrets, 'utf8')))) w.secrets[k] = v;
  w.deployments += 1;
  w.vars = Object.fromEntries([...text.matchAll(/^([A-Z_]+) = "(.*)"$/gm)].map((m) => [m[1], m[2]]));
  cloud.workers[name] = w;
  save();
  out(`Total Upload: 175.63 KiB / gzip: 45.82 KiB\nUploaded ${name} (3.1 sec)\nDeployed ${name} triggers (0.8 sec)\n  https://${name}.${cloud.subdomain}.workers.dev\n  schedule: * * * * *`);
} else {
  fail(`commande non simulée : ${args.join(' ')}`);
}
