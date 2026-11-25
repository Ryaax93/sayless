# SAYLESS 2.0

Cette branche prépare le raccordement de la boutique SAYLESS au serveur et à STUDIO livrés par Claude. Elle reprend la direction artistique et les ressources de l’aperçu v4. Les paiements sont fermés.

**Avant toute fusion**, lire la [revue de la PR nº 1](docs/REVUE-PR-1-WORK.md) et les [corrections attendues de Claude](docs/HANDOFF-CLAUDE.md). La branche de préparation contient déjà les trois commits examinés. Les deux PR ciblent `v2` et restent soumises à l’autorisation du fondateur.

## Consulter la boutique

Avec Git, Node 22.13 ou ultérieur et npm :

```sh
git clone --branch work/frontend-api-v1-2 --single-branch https://github.com/Ryaax93/sayless.git
cd sayless
npm run dev:storefront
```

Ouvrir `http://127.0.0.1:5173/`. La consultation statique fonctionne sans installer de paquet. Elle sert le site et les routes de retour `/merci`, `/commande-annulee` et `/suivi`. Dans ce mode, les API répondent `503 backend_not_connected` et la boutique indique « Stock à confirmer ». Les photos, les polices, le logo et le lookbook sont inclus dans le dépôt.

## Installer et tester le raccordement

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run build:storefront
npm run check:cloudflare
npm run test:review
```

| Commande | Portée |
| --- | --- |
| `npm test` | Client de la boutique, parcours et rendu, retours Stripe, ancien inventaire, backend/STUDIO et tests croisés frontend/routeur/D1 locale. |
| `npm run test:integration` | Le véritable client HTTP et le contrôleur de la boutique appellent le véritable routeur de Claude sur D1 locale. Stripe et le transporteur sont simulés. |
| `npm run test:review` | Trois critères commerciaux non satisfaits par le commit Claude examiné. Cette suite séparée doit devenir verte après ses corrections. |
| `npm run build:storefront` | Produit `dist-storefront/` avec les ressources et le catalogue. |
| `npm run check:cloudflare` | Construit STUDIO, compile les Pages Functions et vérifie le Worker par Wrangler en `--dry-run`. |

Aucun accès de production n’est nécessaire. Les tests créent des bases éphémères avec des données de recette. Les commandes ci-dessus n’effectuent aucun déploiement.

## Organisation du code

| Chemin | Rôle |
| --- | --- |
| `public/store/` | Boutique et design validé, guide, pages d’aide et pages légales. |
| `public/store/api-client.js`, `catalog.js`, `inventory*.js` | Contrat v1.2, catalogue et SKU publiés, stock confirmé, règles d’affichage. |
| `public/store/checkout-flow.js`, `checkout.js`, `config.js` | Devis, consentement, anti-abus, tentative idempotente, retour Stripe et réglages publics. |
| `data/products.json`, `public/store/assets/` | Fiche éditoriale, logo, photographies et typographies. |
| `functions/api/`, `backend/`, `ops/` | API de même origine, logique métier commune, migrations et opérations de Claude. |
| `studio/` | Interface administrateur et application web de Claude. |
| `tests/frontend-integration.test.mjs`, `tests/review/` | Raccordement sur D1 locale et critères de correction. |
| `server/`, `drizzle/`, `db/`, `app/api/`, `worker/`, `public/store/admin.js` | Prototype d’origine conservé pour référence. L’ancien écran de gestion est exclu de la boutique servie. |

Le gilet unisexe rose pastel est proposé en S, M et L à 75 € TTC hors livraison. Pour une pièce, les tarifs prévus de 4,90 € en relais et 8,50 € à domicile donnent 79,90 € et 83,50 €. Le total présenté avant paiement provient de `POST /api/quote`. Le lancement est prévu en France métropolitaine hors Corse. Le comptage physique reste à effectuer. Les 26 pièces théoriques ne servent jamais à initialiser le stock.

Le client choisit son mode de livraison et son éventuel relais sur SAYLESS. Stripe doit recueillir ses coordonnées. La carte, Apple Pay et Google Pay sont prévus selon compatibilité. Le choix du relais d’un vrai transporteur, les paiements Stripe, le suivi et les e-mails attendent leur recette externe.

## Documentation

- [État de la boutique](docs/STATUS.md), [plan et résultats de tests](docs/TEST-PLAN.md), [changelog](CHANGELOG.md).
- [Architecture](docs/ARCHITECTURE.md), [contrat API v1.2](docs/API-CONTRACT.md), [responsabilités](docs/OWNERSHIP.md).
- [Architecture serveur](backend/README.md), [STUDIO](studio/README.md), [protection des données](docs/DONNEES-ET-SAUVEGARDES.md).
- [Direction artistique commune](docs/DESIGN-SYSTEM.md), [informations à compléter](INFORMATIONS-A-COMPLETER.md), [empreintes de l’aperçu d’origine](docs/source-snapshot.json).

Les scripts `*:legacy` restent disponibles pour l’étude du prototype. Le logo et les photos sont les ressources de la marque. Les notices des polices sont dans `public/store/assets/`. Le rapport d’automatisation privé et les données d’exploitation ne sont pas publiés.
