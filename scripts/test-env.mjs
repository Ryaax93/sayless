#!/usr/bin/env node
// Assistant de l'environnement de TEST Cloudflare de SAYLESS (offre gratuite, sans domaine ni DNS).
// À lancer sur l'ordinateur du fondateur, dans le dossier du projet, après `npx wrangler login` :
//
//   node scripts/test-env.mjs               installe ou met à jour l'environnement de test
//   node scripts/test-env.mjs etat          adresse de STUDIO et contrôle de santé
//   node scripts/test-env.mjs secret NOM    saisit un secret (Discord, Resend, Stripe test) sans l'afficher
//   node scripts/test-env.mjs reglage NOM valeur    règle une valeur non secrète (EMAIL_FROM, EMAIL_REPLY_TO)
//   node scripts/test-env.mjs compte ID     choisit le compte Cloudflare s'il y en a plusieurs
//
// Ce que l'assistant fait : une base D1 « sayless-test », un espace de sauvegarde, le Worker
// « sayless-ops-test » sur une adresse *.workers.dev. Rien d'autre : ni domaine, ni DNS, ni
// Stripe réel, ni boutique publique. Les secrets sont créés sur cet ordinateur et envoyés
// directement à Cloudflare ; aucun n'est affiché. Chaque étape est vérifiée avant la suivante.
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OPS = join(ROOT, 'ops');
// Fichiers locaux, ignorés par Git. SAYLESS_TEST_ENV_LOCAL_DIR ne sert qu'aux tests automatiques.
const LOCAL = process.env.SAYLESS_TEST_ENV_LOCAL_DIR ?? OPS;
const CONFIG = join(LOCAL, 'wrangler.test.local.toml');
const STATE = join(LOCAL, 'test-env.local.json');
const SECRETS = process.env.SAYLESS_SECRETS_DIR ?? join(homedir(), 'sayless-secrets-test');
const WRANGLER = process.env.SAYLESS_WRANGLER ?? join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const WORKER = 'sayless-ops-test';
const DATABASE = 'sayless-test';
const NAMESPACE = 'sayless-test-backups';
// Discord : webhook unique (DISCORD_WEBHOOK_URL) et/ou un webhook par salon (docs/DISCORD.md).
const DISCORD_SALONS = ['COMMANDES', 'EXPEDITIONS', 'RETOURS', 'STOCK', 'FINANCES', 'RAPPORT', 'ALERTES', 'SECURITE', 'SITE', 'SAUVEGARDES'];
const SECRET_NAMES = ['DISCORD_WEBHOOK_URL', ...DISCORD_SALONS.map((s) => `DISCORD_WEBHOOK_${s}`),
  'RESEND_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'TURNSTILE_SECRET'];
// WEBAUTHN_ENGINE : « simplewebauthn » ajoute la vérification Face ID par la bibliothèque, SEULEMENT
// après la validation du fondateur ; « sayless » revient à la vérification seule de SAYLESS.
const SETTING_NAMES = ['EMAIL_FROM', 'EMAIL_REPLY_TO', 'WEBAUTHN_ENGINE'];

class Stop extends Error {}
const say = (line = '') => console.log(line);
const stop = (...lines) => { throw new Stop(lines.join('\n')); };
const step = (n, title) => say(`\n[${n}] ${title}`);
const done = (detail) => say(`    OK : ${detail}`);

// Accord explicite avant toute création ou mise en ligne chez Cloudflare (SAYLESS_TEST_ENV_CONFIRM :
// réponse fournie d'avance, pour les tests automatiques seulement).
async function confirm(question) {
  let answer = process.env.SAYLESS_TEST_ENV_CONFIRM;
  if (answer === undefined) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try { answer = await rl.question(`${question} Tape OUI pour continuer : `); } finally { rl.close(); }
  }
  if (String(answer).trim().toUpperCase() !== 'OUI') stop('Rien n’a été fait.');
}

let state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
const save = () => writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);

// Wrangler du projet (version figée par package-lock), lancé sans terminal interactif : les
// confirmations prennent leur valeur par défaut et la sortie peut être lue.
function wrangler(args, { cwd = ROOT, interactive = false } = {}) {
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', FORCE_COLOR: '0', NO_COLOR: '1' };
  if (state.account_id) env.CLOUDFLARE_ACCOUNT_ID = state.account_id;
  const run = spawnSync(process.execPath, [WRANGLER, ...args], { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    stdio: interactive ? 'inherit' : 'pipe' });
  if (run.error) stop(`Impossible de lancer Wrangler (${run.error.code ?? run.error.message}). As-tu lancé « npm ci » dans ce dossier ?`);
  return { code: run.status, out: `${run.stdout ?? ''}`, err: `${run.stderr ?? ''}` };
}
const parseJson = (text, open) => {
  const start = text.indexOf(open);
  const end = text.lastIndexOf(open === '[' ? ']' : '}');
  if (start < 0 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
};
const tail = (r) => `${r.err}\n${r.out}`.trim().split('\n').slice(-12).join('\n');

const toml = (value) => JSON.stringify(String(value));
function writeConfig() {
  const vars = {
    ENVIRONMENT: 'staging',
    PUBLIC_ORIGIN: 'https://sayless-boutique-test.pages.dev',
    VAPID_SUBJECT: 'https://saylessbrand.fr',
    ...state.public,
    ...(state.url ? { STUDIO_ORIGIN: state.url, STUDIO_RP_ID: new URL(state.url).hostname } : {}),
    ...state.settings,
  };
  writeFileSync(CONFIG, [
    '# Fichier LOCAL généré par scripts/test-env.mjs : environnement de TEST seulement (adresse *.workers.dev).',
    '# Jamais versionné : identifiants propres à ton compte Cloudflare. Ne pas modifier à la main.',
    `name = ${toml(WORKER)}`,
    'main = "worker.mjs"',
    'compatibility_date = "2026-05-15"',
    'workers_dev = true',
    'preview_urls = false',
    '',
    '[assets]',
    'directory = "../dist-studio"',
    'run_worker_first = ["/api/*", "/webhooks/*", "/health"]',
    '',
    '[vars]',
    ...Object.entries(vars).map(([k, v]) => `${k} = ${toml(v)}`),
    '',
    '[triggers]',
    'crons = ["* * * * *"]',
    '',
    '# Journaux du Worker (offre gratuite) : erreurs visibles dans Workers & Pages > sayless-ops-test > Journaux.',
    '[observability]',
    'enabled = true',
    '',
    '[[d1_databases]]',
    'binding = "DB"',
    `database_name = ${toml(DATABASE)}`,
    `database_id = ${toml(state.database_id)}`,
    'migrations_dir = "../backend/migrations"',
    '',
    '[[kv_namespaces]]',
    'binding = "BACKUPS"',
    `id = ${toml(state.kv_id)}`,
    '',
  ].join('\n'));
}

async function check(url) {
  const base = process.env.SAYLESS_TEST_FETCH_BASE ?? url;
  try {
    const health = await (await fetch(`${base}/health`, { signal: AbortSignal.timeout(15000) })).json();
    const studio = await fetch(`${base}/api/admin/state`, { signal: AbortSignal.timeout(15000) });
    return { health, studio: studio.ok ? await studio.json() : { status: studio.status } };
  } catch {
    return null;
  }
}

function requireLogin() {
  const who = wrangler(['whoami', '--json']);
  const info = parseJson(who.out, '{');
  if (who.code !== 0 || !info?.loggedIn) {
    stop('Tu n’es pas connecté à Cloudflare sur cet ordinateur.', 'Lance : npx wrangler login', 'puis accepte dans la page qui s’ouvre, et relance : node scripts/test-env.mjs');
  }
  const accounts = info.accounts ?? [];
  if (!state.account_id) {
    if (accounts.length === 1) state.account_id = accounts[0].id;
    else {
      stop('Plusieurs comptes Cloudflare sont accessibles. Choisis celui du test :',
        ...accounts.map((a) => `  node scripts/test-env.mjs compte ${a.id}    (${a.name})`));
    }
  }
  const account = accounts.find((a) => a.id === state.account_id);
  if (!account) stop('Le compte choisi n’est plus accessible avec cette connexion. Relance : npx wrangler login');
  state.account_name = account.name;
  save();
  return { email: info.email, account };
}

async function install() {
  say('Environnement de TEST SAYLESS : adresse *.workers.dev, sans domaine, sans DNS, sans Stripe réel.');
  await confirm('Cette commande crée ou met à jour la base, l’espace de sauvegarde et le Worker de TEST sur ton compte Cloudflare (offre gratuite).');

  step(1, 'Ordinateur et connexion Cloudflare');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) stop(`Node.js ${process.versions.node} est trop ancien : installe la version LTS depuis nodejs.org.`);
  if (!existsSync(WRANGLER)) stop('Les outils du projet ne sont pas installés. Lance d’abord : npm ci');
  const { email, account } = requireLogin();
  done(`connecté (${email}), compte « ${account.name} »`);

  step(2, 'Secrets de test (créés sur cet ordinateur, jamais affichés)');
  if (!state.public) {
    if (!existsSync(join(SECRETS, 'worker-secrets.json'))) {
      const gen = spawnSync(process.execPath, [join(ROOT, 'scripts', 'generate-secrets.mjs'), '--env', 'test', '--out', SECRETS], { encoding: 'utf8' });
      if (gen.status !== 0) stop(`Création des secrets impossible : ${`${gen.stderr}`.trim()}`);
    }
    const lines = readFileSync(join(SECRETS, 'public-values.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
    state.public = Object.fromEntries(lines.map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    if (!state.public.VAPID_PUBLIC_KEY || !state.public.BACKUP_PUBLIC_KEY) stop(`Fichier incomplet : ${join(SECRETS, 'public-values.txt')}`);
    save();
  }
  done(`dossier privé ${SECRETS}`);

  step(3, `Base de données « ${DATABASE} » (D1, Europe de l’Ouest)`);
  const findDatabase = () => (parseJson(wrangler(['d1', 'list', '--json']).out, '[') ?? []).find((d) => d.name === DATABASE);
  let database = findDatabase();
  if (!database) {
    const created = wrangler(['d1', 'create', DATABASE, '--location', 'weur', '--cwd', tmpdir()]);
    if (created.code !== 0) stop('Création de la base refusée par Cloudflare :', tail(created));
    database = findDatabase();
  }
  if (!database?.uuid) stop('Base introuvable après sa création. Relance la commande dans une minute.');
  state.database_id = database.uuid;
  save();
  done(`base ${DATABASE}`);

  step(4, `Espace des sauvegardes chiffrées « ${NAMESPACE} » (Workers KV)`);
  const findNamespace = () => (parseJson(wrangler(['kv', 'namespace', 'list']).out, '[') ?? []).find((n) => n.title === NAMESPACE);
  let namespace = findNamespace();
  if (!namespace) {
    const created = wrangler(['kv', 'namespace', 'create', NAMESPACE, '--cwd', tmpdir()]);
    if (created.code !== 0) stop('Création de l’espace refusée par Cloudflare :', tail(created));
    namespace = findNamespace();
  }
  if (!namespace?.id) stop('Espace introuvable après sa création. Relance la commande dans une minute.');
  state.kv_id = namespace.id;
  save();
  writeConfig();
  done(`espace ${NAMESPACE}`);

  step(5, 'Tables de la base (migrations)');
  const migrated = wrangler(['d1', 'migrations', 'apply', DATABASE, '--remote', '-c', CONFIG]);
  if (migrated.code !== 0) stop('Les migrations ont échoué :', tail(migrated));
  done(/No migrations to apply/.test(migrated.out) ? 'déjà à jour' : 'appliquées');

  step(6, 'Construction de SAYLESS STUDIO');
  const built = spawnSync(process.execPath, [join(OPS, 'build-studio.mjs')], { cwd: ROOT, encoding: 'utf8' });
  if (built.status !== 0) stop('Construction impossible :', `${built.stderr}`.trim());
  done('prête');

  step(7, `Mise en ligne du Worker « ${WORKER} » (environ 30 secondes)`);
  let firstSecrets = null;
  if (!state.secrets_uploaded) {
    const listed = wrangler(['secret', 'list', '-c', CONFIG]);
    const names = (listed.code === 0 ? parseJson(listed.out, '[') ?? [] : []).map((s) => s.name);
    if (names.includes('APP_SECRET')) {
      state.secrets_uploaded = true; // déjà envoyés lors d'une installation précédente : jamais remplacés
    } else {
      firstSecrets = join(SECRETS, 'worker-secrets.json');
      if (!existsSync(firstSecrets)) stop(`Secrets introuvables : ${firstSecrets}. Ne supprime pas ce dossier avant la fin de l’installation.`);
    }
  }
  const deploy = () => {
    const r = wrangler(['deploy', '-c', CONFIG, ...(firstSecrets ? ['--secrets-file', firstSecrets] : [])]);
    if (r.code !== 0) {
      const onboarding = `${r.err}\n${r.out}`.match(/https:\/\/dash\.cloudflare\.com\/\S+\/workers\/onboarding/);
      if (onboarding || /workers\.dev subdomain/.test(`${r.err}${r.out}`)) {
        stop('Ton compte n’a pas encore d’adresse workers.dev.', `Ouvre ${onboarding?.[0] ?? 'Workers & Pages dans le tableau de bord Cloudflare'}, choisis ton sous-domaine,`, 'puis relance : node scripts/test-env.mjs');
      }
      stop('La mise en ligne a échoué :', tail(r));
    }
    if (firstSecrets) { state.secrets_uploaded = true; firstSecrets = null; save(); }
    return r.out.match(new RegExp(`https://${WORKER}\\.[a-z0-9-]+\\.workers\\.dev`, 'i'))?.[0]?.toLowerCase() ?? null;
  };
  const url = deploy() ?? state.url;
  if (!url) stop('Mise en ligne faite, mais l’adresse n’a pas été lue. Ouvre Workers & Pages > sayless-ops-test dans Cloudflare et donne-moi l’adresse affichée (elle n’est pas secrète).');
  if (url !== state.url) {
    state.url = url;
    save();
    writeConfig();
    deploy(); // STUDIO n'accepte que son adresse exacte : seconde mise en ligne avec cette adresse
  }
  done(url);

  step(8, 'Contrôle en ligne');
  if (await report(url)) {
    say('\nInstallation terminée et vérifiée.');
    return true;
  }
  say('\nInstallation INCOMPLÈTE : l’environnement de test n’est pas encore opérationnel. Ne passe pas à la suite.');
  return false;
}

async function report(url) {
  const seen = await check(url);
  if (!seen) {
    say('    En attente : la toute première fois, l’adresse peut mettre quelques minutes à répondre.');
    say('    Relance dans 2 minutes : node scripts/test-env.mjs etat');
    return false;
  }
  const { health, studio } = seen;
  // Isolation : ce Worker doit être celui de TEST (staging), sans clé Stripe réelle.
  const isolated = health.environment === 'staging' && health.stripe !== 'live';
  const ok = health.ok === true && health.database === 'ok' && typeof studio.enrolled === 'boolean' && isolated;
  say(`    Base : ${health.database} ; tâche planifiée : ${health.scheduler} ; paiement Stripe : ${health.stripe}`);
  say(`    Environnement : ${health.environment ?? 'inconnu'} ; paiements : ${health.payments === 'closed' ? 'fermés' : health.payments === 'open' ? 'OUVERTS' : 'inconnus'}`);
  say(`    STUDIO : ${studio.enrolled ? 'iPhone déjà inscrit' : typeof studio.enrolled === 'boolean' ? 'prêt pour la première inscription' : `réponse ${studio.status}`}`);
  if (!isolated) say('    Ce Worker n’est pas un environnement de TEST isolé (ou porte une clé Stripe réelle) : arrêt.');
  if (!ok) { say('    Contrôle incomplet : copie-moi ces lignes (elles ne contiennent aucun secret).'); return false; }
  if (health.payments !== 'closed') say('    Attention : les paiements de test sont ouverts. Ils restent fermés tant que tu ne les ouvres pas dans STUDIO.');
  say(`\nSTUDIO est en ligne : ${url}`);
  if (!studio.enrolled) {
    say(`Code d’installation : dans le fichier ${join(SECRETS, 'CODE-STUDIO.txt')} (ouvre-le avec le Bloc-notes).`);
    say('Ne le colle jamais dans un chat ni un e-mail : tape-le directement sur ton iPhone.');
  }
  return true;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) return install();
  if (command === 'compte') {
    if (!/^[0-9a-f]{32}$/.test(rest[0] ?? '')) stop('Usage : node scripts/test-env.mjs compte <identifiant du compte (32 caractères)>');
    state.account_id = rest[0];
    save();
    return say('Compte enregistré. Relance : node scripts/test-env.mjs');
  }
  if (!state.url || !existsSync(CONFIG)) stop('Environnement pas encore installé. Lance : node scripts/test-env.mjs');
  if (command === 'etat') {
    say(`Compte « ${state.account_name} » ; Worker ${WORKER} ; base ${DATABASE}`);
    const ok = await report(state.url);
    say(ok ? '\nEnvironnement de TEST opérationnel.' : '\nEnvironnement de TEST NON opérationnel : ne passe pas à la suite.');
    return ok;
  }
  if (command === 'secret') {
    const name = rest[0];
    if (!SECRET_NAMES.includes(name)) stop(`Secrets possibles : ${SECRET_NAMES.join(', ')}`);
    say(`Colle la valeur de ${name} quand Wrangler la demande : elle ne s’affiche pas et part directement chez Cloudflare.`);
    if (name.startsWith('STRIPE_')) say('Mode TEST uniquement (clé sk_test_ ou rk_test_) : une clé réelle est refusée par l’environnement de test.');
    if (name.startsWith('DISCORD_')) say('Adresse complète du webhook (https://discord.com/api/webhooks/…). Une adresse d’un autre site est ignorée par le serveur.');
    const r = wrangler(['secret', 'put', name, '-c', CONFIG], { interactive: true });
    if (r.code !== 0) stop('Secret non enregistré.');
    return say(`${name} enregistré. Contrôle : node scripts/test-env.mjs etat`);
  }
  if (command === 'reglage') {
    const [name, ...value] = rest;
    if (!SETTING_NAMES.includes(name) || !value.length) stop(`Usage : node scripts/test-env.mjs reglage ${SETTING_NAMES.join('|')} "valeur"`);
    if (name === 'WEBAUTHN_ENGINE' && !['simplewebauthn', 'sayless'].includes(value.join(' '))) stop('WEBAUTHN_ENGINE : « simplewebauthn » ou « sayless ».');
    await confirm(`${name} sera réglé et le Worker de TEST remis en ligne.`);
    state.settings = { ...state.settings, [name]: value.join(' ') };
    save();
    writeConfig();
    const r = wrangler(['deploy', '-c', CONFIG]);
    if (r.code !== 0) stop('Mise en ligne refusée :', tail(r));
    return say(`${name} réglé et mis en ligne.`);
  }
  stop('Commandes : (aucune), etat, secret NOM, reglage NOM valeur, compte ID');
}

main().then((ok) => { if (ok === false) process.exitCode = 1; }).catch((e) => {
  if (e instanceof Stop) {
    console.error(`\nArrêt : ${e.message}`);
    process.exitCode = 1;
  } else {
    throw e;
  }
});
