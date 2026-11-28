# Fichiers livrés dans v2

Inventaire historique du dépôt initial du 24 novembre. Pour la préparation, utiliser `git ls-files` et `git diff --name-status c6c9db1...HEAD`.

Le dépôt initial comptait 90 fichiers versionnés. Les 70 chemins suivis de la source v4 sont conservés ; les ajouts et adaptations figurent dans CHANGELOG.md. Aucun CNAME, workflow de publication, secret, node_modules, état D1 ni build n’est inclus.

## (racine) — 13

- `.gitignore`
- `AGENTS.md`
- `CHANGELOG.md`
- `INFORMATIONS-A-COMPLETER.md`
- `README.md`
- `cloudflare-env.d.ts`
- `drizzle.config.ts`
- `next.config.ts`
- `package-lock.json`
- `package.json`
- `postcss.config.mjs`
- `tsconfig.json`
- `vite.config.ts`

## .openai — 1

- `.openai/hosting.json`

## app — 3

- `app/api/[...path]/route.ts`
- `app/layout.tsx`
- `app/route.ts`

## data — 1

- `data/products.json`

## db — 2

- `db/index.ts`
- `db/schema.ts`

## docs — 11

- `docs/API-CONTRACT.md`
- `docs/ARCHITECTURE.md`
- `docs/DESIGN-SYSTEM.md`
- `docs/FILES.md`
- `docs/HANDOFF-CLAUDE.md`
- `docs/OWNERSHIP.md`
- `docs/PREVIEW-V4.md`
- `docs/STATUS.md`
- `docs/TEST-PLAN.md`
- `docs/VALIDATION.md`
- `docs/source-snapshot.json`

## drizzle — 5

- `drizzle/0000_sweet_warbird.sql`
- `drizzle/0001_inventory_guards.sql`
- `drizzle/meta/0000_snapshot.json`
- `drizzle/meta/0001_snapshot.json`
- `drizzle/meta/_journal.json`

## lib — 6

- `lib/connector-context.ts`
- `lib/connector-contract.mts`
- `lib/connector-errors.mts`
- `lib/connector-preview.d.ts`
- `lib/connectors.ts`
- `lib/utils.ts`

## public — 19

- `public/store/admin.js`
- `public/store/api-client.js`
- `public/store/app.js`
- `public/store/assets/FONT-LICENSE.txt`
- `public/store/assets/LICENSE-APACHE-2.0.txt`
- `public/store/assets/body-semibold.ttf`
- `public/store/assets/body.ttf`
- `public/store/assets/campaign.webp`
- `public/store/assets/display.ttf`
- `public/store/assets/favicon.svg`
- `public/store/assets/hoodie-back.webp`
- `public/store/assets/hoodie-front.webp`
- `public/store/assets/logo.webp`
- `public/store/checkout.js`
- `public/store/commerce.js`
- `public/store/index.html`
- `public/store/inventory.js`
- `public/store/legal.js`
- `public/store/styles.css`

## scripts — 20

- `scripts/build-storefront.mjs`
- `scripts/build-verified.sh`
- `scripts/connector-preview/connector-preview-session.mjs`
- `scripts/connector-preview/host-binding.mjs`
- `scripts/connector-preview/protocol.mjs`
- `scripts/connector-preview/worker.mjs`
- `scripts/dev-storefront.mjs`
- `scripts/execution-profile.mjs`
- `scripts/install-ci.mjs`
- `scripts/install-ci.sh`
- `scripts/install-pnpm.sh`
- `scripts/npm-install.mjs`
- `scripts/pnpm-install.mjs`
- `scripts/run-framework.mjs`
- `scripts/sites-env.mjs`
- `scripts/sites-env.sh`
- `scripts/tool-environment.mjs`
- `scripts/vite/connector-preview-plugin.mjs`
- `scripts/vite/sites-vite-plugin.LICENSE`
- `scripts/vite/sites-vite-plugin.ts`

## server — 3

- `server/api.mjs`
- `server/inventory.mjs`
- `server/stripe.mjs`

## tests — 5

- `tests/api-client.test.mjs`
- `tests/commerce.test.cjs`
- `tests/inventory.test.mjs`
- `tests/portable.test.mjs`
- `tests/stock-display.test.mjs`

## worker — 1

- `worker/index.ts`
