# Dépendances npm, audit et version de Node — analyse et proposition commune

**Auteur : Claude, 26 novembre 2026, à valider par Work** (fichiers communs `package.json` et `package-lock.json`, voir `OWNERSHIP.md`). Aucun `npm audit fix --force`. Rien n’est déployé.

## 1. Ce qui est réellement déployé

Les trois éléments mis en ligne n’embarquent **aucun paquet npm** :

| Élément | Contenu | Paquets npm à l’exécution |
| --- | --- | --- |
| Boutique (`dist-storefront`) | copie de `public/` et `data/` | aucun |
| API de la boutique (Pages Functions, `functions/api`) | `backend/src` | aucun |
| Worker d’exploitation et STUDIO (`ops/`, `dist-studio`) | `backend/src`, `studio/` | aucun |

Vérifié par lecture de tous les `import` de `backend/src`, `functions`, `ops`, `studio` et `public/store` : seuls des modules intégrés `node:` dans les scripts de construction. Les paquets npm servent aux outils (wrangler, tests) et à l’ancien gabarit Next/vinext.

## 2. Audit

| État | Total | Critiques | Élevées | Modérées | Faibles |
| --- | --- | --- | --- | --- | --- |
| Avant : rapport du fondateur (même résultat mesuré sur 397bb43) | 33 | 2 | 14 | 16 | 1 |
| Après la mise à jour des outils Cloudflare (ee54ed1) | **27** | 2 | 8 | 16 | 1 |
| … dont dépendances de production (`npm audit --omit=dev`) | 5 | 1 | 2 | 2 | 0 |
| Essai 1 : `npm audit fix` **sans** `--force` (copie de travail) | 12 | 2 | 4 | 6 | 0 |
| Essai 2 : essai 1 + montées de version ciblées (copie de travail) | 9 | 0 | 1 | 8 | 0 |

**Corrigées par Claude** (périmètre outils Cloudflare) : wrangler 4.92.0 → 4.168.0, miniflare 4 → 5.20261123.1-beta (version embarquée par wrangler 4.168.0 lui-même, une seule copie installée), @cloudflare/workers-types 5.20261125.1, @cloudflare/vite-plugin 1.70.2. Six vulnérabilités élevées disparaissent : wrangler, miniflare, undici, ws, sharp, @cloudflare/vite-plugin. Aucune nouvelle.

**Restantes (27)** : toutes dans l’ancien gabarit Next/vinext et ses outils, aucune dans le code déployé.

| Paquet | Gravité | Origine | Correction |
| --- | --- | --- | --- |
| next | critique | gabarit (dépendance directe) | 16.4.6 |
| react-server-dom-webpack | critique | gabarit | 19.3.1 (avec react et react-dom 19.3.1) |
| vinext, image-size, satori, @vercel/og | élevée, modérée | gabarit | vinext 1.4.6 (exige @vitejs/plugin-rsc 0.5.39) ; satori et @vercel/og restent modérées |
| vite | élevée | gabarit, serveur de développement | 8.3.8 |
| zod | élevée | `scripts/connector-preview` du gabarit | 4.x : version majeure, code à adapter |
| drizzle-kit, esbuild, @esbuild-kit/* | modérée | ancien `db/`, `drizzle.config.ts` | aucune correction compatible (npm propose un retour en 0.18) |
| brace-expansion, browserslist, js-yaml, source-map-js, fast-uri, fflate, minimatch, baseline-browser-mapping, @babel/core, typescript-eslint | élevée à faible | outils (ESLint, Babel, PostCSS) | `npm audit fix` sans `--force` |

**Risque réel aujourd’hui** : aucun pour les clients ni pour les données (rien de tout cela n’est déployé). Il existe sur un poste de développement qui lance `npm run dev:legacy` (serveur de développement Next/vite exposé localement) ou qui installe des outils compromis. Recommandation immédiate : ne pas lancer `dev:legacy` ni `build:legacy`.

## 3. Proposition à Work (périmètre boutique et gabarit)

1. **Commit dédié A** : `npm audit fix` sans `--force` → 27 à 12, aucune version directe modifiée. Essayé sur une copie de travail ; suites à rejouer.
2. **Commit dédié B** : next 16.4.6, eslint-config-next 16.4.6, react et react-dom 19.3.1, react-server-dom-webpack 19.3.1, vinext 1.4.6, @vitejs/plugin-rsc 0.5.39, vite 8.3.8 → 9 restantes, aucune critique. Résolution vérifiée (`npm install --package-lock-only`, sans `--force` ni `--legacy-peer-deps`) ; **construction du gabarit non vérifiée**.
3. **Décision à prendre ensemble** : si la boutique 2.0 n’utilise plus le gabarit Next/vinext (elle est servie depuis `public/` et `data/`), retirer ses dépendances et ses scripts (`dev:legacy`, `build:legacy`, `start:legacy`, `db:generate`, `scripts/connector-preview`) supprimerait aussi zod, drizzle-kit et leurs chaînes. Côté Claude, l’ancien backend (`server/`, `db/`, `drizzle/`, `worker/`, `app/api/`) est remplacé par `backend/` : accord de Claude pour le retirer dans le même mouvement. Résultat attendu : 0, à confirmer par l’audit.

## 4. Propriété de `package.json` et `package-lock.json` (proposition)

- **Claude** : outils Cloudflare et banc d’essai (wrangler, miniflare, @cloudflare/*), scripts `test:backend`, `test:inventory`, `check:cloudflare`, `build:studio`.
- **Work** : boutique et gabarit (next, react, vinext, vite, radix, ESLint…), scripts `test:frontend`, `test:integration`, `test:review*`, `build:storefront*`, `dev*`, `install:ci`.
- **Règles communes** :
  - un changement de dépendance = un commit dédié qui contient `package.json` et `package-lock.json` ensemble, produit par `npm install` (jamais `--force`, `--legacy-peer-deps` ni `npm audit fix --force`) ;
  - le message ou la PR donne `npm ci`, les suites rejouées et l’audit avant et après ;
  - l’autre partie relit avant toute fusion vers `v2` ;
  - conflit sur le verrou : régénérer depuis le `package.json` fusionné avec `npm install`, jamais de fusion à la main ;
  - versions exactes pour les outils qui produisent ce qui est déployé (wrangler, et toute future dépendance d’exécution).

## 5. Version de Node

- **Node 26 LTS** (LTS active depuis le 28 octobre 2026) pour les tests locaux et la CI : `.nvmrc` = `26`, utilisé par la CI Linux et Windows. Le PC du fondateur a Node 26.13.1 : conforme.
- Exigences des outils : wrangler 4.168 et miniflare 5 demandent Node ≥ 22.12 ; le champ `engines` actuel (`>=22.13.0`) reste valable. Les suites passent aussi sous Node 22 (poste de travail de Claude).
- Cloudflare n’exécute pas Node : Workers et Pages Functions tournent dans workerd ; la version de Node ne concerne que les outils.

## 6. Non vérifié

- Construction et fonctionnement du gabarit après les montées de version de l’essai 2.
- Audit après retrait du gabarit (dépend de la décision commune).
