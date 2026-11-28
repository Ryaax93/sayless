// Construit SAYLESS STUDIO dans dist-studio/ (non versionné) : fichiers de studio/ + polices et logo
// officiels repris de public/store/assets (aucune copie dans Git). Version = empreinte du contenu.
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const out = new URL('dist-studio/', root);
await rm(out, { recursive: true, force: true });
await mkdir(new URL('assets/', out), { recursive: true });
await cp(new URL('studio/', root), out, { recursive: true });
await rm(new URL('README.md', out), { force: true }); // notes internes : jamais servies
for (const file of ['display.ttf', 'body.ttf', 'body-semibold.ttf', 'logo.webp', 'hoodie-front.webp', 'FONT-LICENSE.txt', 'LICENSE-APACHE-2.0.txt']) {
  await cp(new URL(`public/store/assets/${file}`, root), new URL(`assets/${file}`, out));
}
const hash = createHash('sha256');
for (const name of (await readdir(new URL('studio/', root))).sort()) {
  if (/\.(js|css)$/.test(name)) hash.update(await readFile(new URL(`studio/${name}`, root)));
}
const version = hash.digest('hex').slice(0, 12);
const index = new URL('index.html', out);
await writeFile(index, (await readFile(index, 'utf8')).replaceAll('__VERSION__', version));
console.log(`STUDIO construit dans dist-studio/ (version ${version})`);
