# SAYLESS 2.0 — Boutique et relais technique

Branche de développement `v2` de `Ryaax93/sayless`. Aucune publication, aucun paiement réel, aucun changement de `main` ou de domaine. Cette copie conserve le design et les ressources de l’aperçu v4 puis prépare son intégration au backend de Claude.

## Démarrage indépendant

Prérequis : Git et Node.js **22.13 ou ultérieur** avec npm. Aucun compte Cloudflare, Stripe ou plateforme d’aperçu n’est nécessaire pour consulter la boutique.

```sh
git clone --branch v2 --single-branch https://github.com/Ryaax93/sayless.git
cd sayless
npm run dev:storefront
```

Ouvrir `http://127.0.0.1:5173/`. Ce mode utilise uniquement Node, sans installation de dépendances. Les fichiers publics sont servis localement. **Toutes les API répondent 503 `backend_not_connected`** : aucune quantité inventée, aucune réservation, aucun paiement, aucun envoi. Le stock affiche « Stock à confirmer » et bloque l’ajout tant que le serveur ne répond pas avec un inventaire vérifié. Le panier de démonstration et ses écrans restent dans le code, et l’aperçu privé existant reste disponible dans sa version publiée.

### Installer et tester

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run test:frontend
npm run test:inventory
npm run build:storefront
```

`test:frontend` peut être lancé sans `npm ci` : tests Node natifs, calculs commerciaux, frontière API, affichage du stock et démarrage dans un processus isolé. `test:inventory` utilise Miniflare et nécessite les dépendances : il teste le **prototype historique**, pas le futur backend de Claude. `npm test` lance les deux suites. Tous les essais utilisent des données de test en mémoire ou une base locale éphémère, sans service payant ni trafic Stripe.

`build:storefront` produit `dist-storefront/` avec le HTML, le catalogue et les ressources. Il ne déploie rien. Ce répertoire pourra alimenter Cloudflare Pages après raccordement et accord du fondateur ; il ne doit pas être publié à ce stade.

## Organisation

| Chemin | Rôle |
| --- | --- |
| `public/store/` | Boutique existante : HTML, styles, pages, galerie, panier, parcours démo, textes légaux |
| `public/store/assets/` | Logo, 3 images WebP, favicon, 3 polices et leurs licences |
| `public/store/api-client.js` | Client des futures API, sans backend et paiement bloqué par défaut |
| `public/store/inventory.js` | Affichage du stock vérifié ; panne, réservation, rupture distinctes |
| `data/products.json` | Catalogue éditorial initial, sans stock ; extensible aux futurs produits/drops/couleurs |
| `server/`, `db/`, `drizzle/`, `app/api/`, `worker/` | Prototype historique transmis à Claude, à auditer et migrer, non actif dans le lancement portable |
| `public/store/admin.js` | Ancien écran expérimental, conservé pour audit ; ce n’est pas SAYLESS STUDIO |
| `scripts/dev-storefront.mjs`, `scripts/build-storefront.mjs` | Consultation et construction locales portables |
| `tests/` | Tests frontend et du prototype historique |
| `docs/` | Architecture, contrat API, responsabilités, design, état réel et contrôles |

L’inventaire exhaustif des fichiers figure dans [docs/FILES.md](docs/FILES.md). Les empreintes de la source v4 sont dans [docs/source-snapshot.json](docs/source-snapshot.json).

## Documents à lire avec Claude

1. [docs/HANDOFF-CLAUDE.md](docs/HANDOFF-CLAUDE.md) — point d’entrée et prochaines étapes.
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — cible et incompatibilités du prototype.
3. [docs/API-CONTRACT.md](docs/API-CONTRACT.md) — contrat proposé, à valider ensemble avant branchement.
4. [docs/OWNERSHIP.md](docs/OWNERSHIP.md) et [AGENTS.md](AGENTS.md) — limites des dossiers et coordination.
5. [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md) — identité à partager avec SAYLESS STUDIO.
6. [docs/STATUS.md](docs/STATUS.md), [docs/TEST-PLAN.md](docs/TEST-PLAN.md), [CHANGELOG.md](CHANGELOG.md).
7. [INFORMATIONS-A-COMPLETER.md](INFORMATIONS-A-COMPLETER.md) — inventaire physique, mesures, administratif, transport.

## Prototype historique, uniquement pour audit

Les commandes d’origine restent conservées sous les noms `npm run dev:legacy`, `npm run build:legacy` et `npm run start:legacy`. Ces commandes historiques lancent Vinext et un Worker de prévisualisation avec D1 locale. Les commandes par défaut `dev`, `build` et `start` utilisent le parcours portable. Le code historique dépend d’un mécanisme d’identité spécifique à la plateforme de l’aperçu : ne jamais le déployer tel quel sur un Worker public. Claude reprend cette partie et décide de la réutilisation des opérations transactionnelles et tests.

`.openai/hosting.json` ne conserve que les noms de bindings, pas l’identifiant du projet privé. Les scripts d’origine sont inclus pour conserver l’intégralité du travail. Les dépendances sont verrouillées dans `package-lock.json`. Aucun `.env`, base réelle, jeton, journal client ou artefact compilé n’est fourni.

## État commercial

DROP 01 : zip hoodie unisexe rose pastel, S/M/L, 350 GSM, 80 % coton / 20 % polyester, zip YKK et capuche doublée. Prix approuvé : 75 € hors livraison ; 4,90 € relais ou 8,50 € domicile, donc 79,90 € ou 83,50 € pour une pièce.

30 produites, 2 offertes et 2 vendues : **26 théoriques**, sans répartition confirmée. Ce nombre n’est pas une autorisation d’initialiser la base. Le catalogue ne contient aucun stock. Les montants du navigateur servent à présenter l’aperçu ; seul le serveur pourra calculer et garantir une commande.

Le stock utilise le contrat proposé `/api/stock`. Les appels catalogue, devis, checkout, relais, suivi et demandes sont préparés mais leur interface complète n’est pas raccordée. Le checkout visible reste explicitement une démonstration. Paiement réel, vrais relais, suivi, notifications et e-mails ne sont pas opérationnels.

## Licence et confidentialité

Le logo et les visuels SAYLESS sont conservés tels que fournis dans le projet. Aucun droit de réutilisation de la marque n’est accordé à des tiers. Les polices embarquées déclarent Apache 2.0 : texte complet et notices dans `public/store/assets/`. Le fichier de licence du composant technique d’origine est également conservé.

Le rapport privé de Claude a été lu intégralement, mais n’est pas publié ici : il contient des informations de compte et financières. La synthèse technique ne contient ni solde, ni historique client, ni donnée d’authentification.
