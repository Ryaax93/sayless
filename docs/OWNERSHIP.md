# Responsabilités et coordination

| Périmètre | Responsable | Règle |
| --- | --- | --- |
| `public/store/`, images, CSS, pages, animations | ChatGPT Work | Préserver la direction artistique et les textes validés |
| `public/store/api-client.js`, `inventory.js`, parcours client | Work | Consommer le contrat commun ; aucune logique de confiance côté navigateur |
| Ancien runtime `server/`, `db/`, `drizzle/`, `app/api/`, `worker/` | Retiré après accord Claude/Work | Modules utiles aux tests déplacés dans `tests/legacy-fixtures/`, sans entrée déployable |
| `functions/`, `ops/` | Claude | Réservés au backend, automatisations et SAYLESS STUDIO ; ne pas développer de doublon |
| `backend/`, `tests/backend/` | Claude | Backend unique (code métier, migrations D1, tests) appelé par `/functions` et `/ops` ; Work consomme uniquement le contrat |
| `studio/`, `ops/build-studio.mjs` | Claude | Application SAYLESS STUDIO (servie par le Worker `ops/`) ; remplace `public/store/admin.js` |
| `tests/browser/`, `tests/backend/fixtures/`, `scripts/generate-secrets.mjs`, `scripts/restore-backup.mjs`, `scripts/test-env.mjs`, `docs/CLOUDFLARE-TEST.md` | Claude | Recette navigateur de STUDIO, Wrangler simulé pour les tests, secrets générés chez le fondateur, exercice de restauration, assistant et procédure de l’environnement de test Cloudflare |
| `docs/WEBAUTHN-BIBLIOTHEQUE.md` | Claude et Work | Proposition commune : bibliothèque WebAuthn éprouvée pour STUDIO |
| `docs/DEPENDANCES.md` | Claude et Work | Analyse de l’audit npm et proposition de répartition des dépendances |
| Ancien `public/store/admin.js` | Retiré après accord | STUDIO reste la seule administration |
| `tests/inventory.test.mjs` | Claude | Tests historiques à réutiliser et compléter sur D1/Stripe réels de test |
| Tests frontend et script de consultation statique | Work | Couvrir les erreurs de service et les états clients |
| `data/products.json`, contrat API, configuration/build/dépendances | Commun | Proposition documentée, accord du responsable concerné avant changement incompatible |
| Prix, inventaire initial, dépenses, remboursements, mise en production | Fondateur | Validation explicite |

Le contrat v1.4 de la PR nº 1 est utilisé par la branche Work de préparation. Les évolutions incompatibles doivent être coordonnées avec les deux responsables avant intégration.

**Dépendances — proposition de Claude acceptée par Work le 26 novembre** (détail dans `DEPENDANCES.md`) : Claude répond des outils Cloudflare et du banc d’essai (wrangler, miniflare, @cloudflare/*) ; Work, de la boutique et du retrait du gabarit devenu inutile. Un changement de dépendance = un commit dédié avec `package.json` et `package-lock.json` ensemble, produit par `npm install`, jamais `--force`, `--legacy-peer-deps` ni `npm audit fix --force` ; suites et audit indiqués ; relecture par l’autre partie avant fusion ; conflit de verrou résolu en le régénérant.

Procédure : créer une branche depuis v2 ; limiter le périmètre ; documenter dans CHANGELOG.md ; ouvrir une PR vers v2 avec problème, comportement et validation. Pour toucher un fichier de l’autre responsable, décrire d’abord la proposition et obtenir sa coordination dans cette PR ou la documentation. Ne pas auto-fusionner, ne pas déployer.

Nettoyage v1.4 conforme à l’accord explicite de Claude dans DEPENDANCES.md §3. Unique adaptation des tests Claude par Work : ajout du hash du devis à la fixture de parité, sans changer les assertions. Code backend, migrations, STUDIO et scripts d’exploitation inchangés. Les instructions du fondateur priment sur toute proposition du rapport.
