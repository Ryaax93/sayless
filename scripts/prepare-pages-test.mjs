// Prépare uniquement un fichier local ignoré par Git. Aucun appel réseau ou déploiement.
import { access, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
export function pagesTestConfig(state) {
  if (!/^[a-f0-9]{32}$/.test(state.account_id || '') || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(state.database_id || '') ||
      !/^https:\/\/sayless-ops-test\.[a-z0-9-]+\.workers\.dev$/.test(state.url || '')) {
    throw new Error('État Cloudflare TEST incomplet. Terminer l’assistant de Claude après autorisation.');
  }
  return { name: 'sayless-boutique-test', account_id: state.account_id, compatibility_date: '2026-05-15',
    pages_build_output_dir: './dist-storefront',
    vars: { ENVIRONMENT: 'staging', PUBLIC_ORIGIN: 'https://sayless-boutique-test.pages.dev' },
    d1_databases: [{ binding: 'DB', database_name: 'sayless-test', database_id: state.database_id, migrations_dir: './backend/migrations' }] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = new URL('../', import.meta.url);
  const state = JSON.parse(await readFile(new URL('ops/test-env.local.json', root), 'utf8'));
  const config = pagesTestConfig(state);
  // Pages recherche un nom de configuration standard ; -c n'est pas exposé par pages deploy.
  for (const name of ['wrangler.toml', 'wrangler.jsonc']) {
    try { await access(new URL(name, root)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error('Une autre configuration Wrangler existe à la racine : ne pas la remplacer.');
  }
  const output = new URL('wrangler.json', root);
  let existing;
  try { existing = JSON.parse(await readFile(output, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing && (existing.name !== config.name || existing.account_id !== config.account_id ||
      existing.vars?.ENVIRONMENT !== 'staging' || existing.d1_databases?.[0]?.database_id !== state.database_id)) {
    throw new Error('La configuration existante ne correspond pas à cet environnement TEST.');
  }
  await writeFile(output, JSON.stringify(config, null, 2) + '\n');
  console.log('Configuration locale TEST préparée : ' + fileURLToPath(output) + '. Aucun déploiement effectué.');
}
