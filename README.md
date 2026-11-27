# SAYLESS 2.0

Cette branche prépare le raccordement de la boutique SAYLESS au serveur et à STUDIO livrés par Claude. Elle conserve la direction artistique et les ressources validées. Elle consomme maintenant le contrat API v1.4. Les paiements sont fermés.

**Avant toute fusion**, lire la [contre-revue v1.4](docs/REVUE-V1-4-WORK.md) et la [passation à Claude](docs/HANDOFF-CLAUDE.md). Base commune `f6332555b44f8c3441a29d804d8bb013b2800522`, contenant Claude `7102f43`. Les deux PR ciblent `v2` et restent en brouillon, soumises à l’autorisation du fondateur. [Procédure PowerShell complète](docs/POWERSHELL-TEST-V1-4.md).

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
npm run test:review:v13
npm run test:review:v14
```

| Commande | Portée |
| --- | --- |
| `npm test` | Client de la boutique, parcours et rendu, retours Stripe, ancien inventaire, backend/STUDIO et tests croisés frontend/routeur/D1 locale. |
| `npm run test:integration` | Le véritable client HTTP et le contrôleur de la boutique appellent le véritable routeur de Claude sur D1 locale. Stripe et le transporteur sont simulés. |
| `npm run test:review` | Quatre régressions indépendantes de l’audit précédent, désormais réussies. |
| `npm run test:review:v13` | Deux anciennes anomalies corrigées par Claude : 2/2 réussies. |
| `npm run test:review:v14` | Six nouvelles régressions transactionnelles, CGV et restauration : 6/6. |
| `npm run test:review:risks` | Une régression encore en échec : doublon Resend possible après réponse perdue et reprise au-delà de 24 h. |
| `npm run build:storefront:test` | Build fermé et limité à l’origine Cloudflare TEST ; voir `docs/CLOUDFLARE-TEST-FRONTEND.md`. |
| `npm run build:storefront` | Produit `dist-storefront/` avec les ressources et le catalogue. |
| `npm run check:cloudflare` | Construit STUDIO, compile les Pages Functions et vérifie le Worker par Wrangler en `--dry-run`. |

Aucun accès de production n’est nécessaire. Les tests créent des bases éphémères avec des données de recette. Les commandes ci-dessus n’effectuent aucun déploiement.

## Organisation du code

| Chemin | Rôle |
| --- | --- |
| `public/store/` | Boutique et design validé, guide, pages d’aide et pages légales. |
| `public/store/api-client.js`, `catalog.js`, `inventory*.js` | Contrat v1.4, catalogue et SKU publiés, stock confirmé, règles d’affichage. |
| `public/store/checkout-flow.js`, `checkout.js`, `config.js` | Devis, consentement, anti-abus, tentative idempotente, retour Stripe et réglages publics. |
| `public/store/customer-service.js` | Suivi sécurisé en mémoire, contact, retour et rétractation, références de demandes. |
| `data/products.json`, `public/store/assets/` | Fiche éditoriale, logo, photographies et typographies. |
| `functions/api/`, `backend/`, `ops/` | API de même origine, logique métier commune, migrations et opérations de Claude. |
| `studio/` | Interface administrateur et application web de Claude. |
| `tests/frontend-integration.test.mjs`, `tests/review/` | Raccordement sur D1 locale et critères de correction. |
| `tests/legacy-fixtures/` | Référence isolée pour les 16 tests historiques. Aucun point d’entrée ni déploiement ; ancien gabarit retiré. |

Le gilet unisexe rose pastel est proposé en S, M et L à 75 € TTC hors livraison. Pour une pièce, les tarifs prévus de 4,90 € en relais et 8,50 € à domicile donnent 79,90 € et 83,50 €. Le total présenté avant paiement provient de `POST /api/quote`. Le lancement est prévu en France métropolitaine hors Corse. Comptage physique déclaré le 26 novembre 2026 : S 8, M 14, L 5, soit 27 pièces. Cette déclaration n’est pas un stock actif : confirmation dans STUDIO et contrôle des ventes V1 intervenues depuis requis.

Le client choisit son mode de livraison et son éventuel relais sur SAYLESS. Stripe doit recueillir ses coordonnées. La carte, Apple Pay et Google Pay sont prévus selon compatibilité. Le choix du relais d’un vrai transporteur, les paiements Stripe, le suivi et les e-mails attendent leur recette externe.

## Documentation

- [État de la boutique](docs/STATUS.md), [plan et résultats de tests](docs/TEST-PLAN.md), [changelog](CHANGELOG.md).
- [Architecture](docs/ARCHITECTURE.md), [contrat API v1.4](docs/API-CONTRACT.md), [responsabilités](docs/OWNERSHIP.md).
- [Architecture serveur](backend/README.md), [STUDIO](studio/README.md), [protection des données](docs/DONNEES-ET-SAUVEGARDES.md).
- [Direction artistique commune](docs/DESIGN-SYSTEM.md), [informations à compléter](INFORMATIONS-A-COMPLETER.md), [empreintes de l’aperçu d’origine](docs/source-snapshot.json).

Le gabarit Next/Vinext et ses dépendances inutilisées ont été retirés après examen des imports et des builds. Aucun paquet npm n’est nécessaire à l’exécution de la boutique ou du backend actuel ; Wrangler et Miniflare restent des outils de construction et de tests. Audit npm complet et hors développement : zéro vulnérabilité au 26 novembre 2026. Le logo et les photos sont les ressources de la marque. Les notices des polices sont dans `public/store/assets/`. Le rapport d’automatisation privé et les données d’exploitation ne sont pas publiés.
