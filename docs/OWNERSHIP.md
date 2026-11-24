# Responsabilités et coordination

| Périmètre | Responsable | Règle |
| --- | --- | --- |
| `public/store/` hors `admin.js`, images, CSS, pages, animations | ChatGPT Work | Préserver la direction artistique et les textes validés |
| `public/store/api-client.js`, `inventory.js`, parcours client | Work | Consommer le contrat commun ; aucune logique de confiance côté navigateur |
| `server/`, `db/`, `drizzle/`, `app/api/`, `worker/` | Claude | Code hérité transmis pour audit et migration, aucune évolution backend par Work |
| Futurs `/functions`, `/ops`, `/admin` | Claude | Réservés au backend, automatisations et SAYLESS STUDIO ; ne pas développer de doublon |
| `public/store/admin.js` | Claude | Ancien prototype à remplacer/migrer ; pas d’extension par Work |
| `tests/inventory.test.mjs` | Claude | Tests historiques à réutiliser et compléter sur D1/Stripe réels de test |
| Tests frontend et script de consultation statique | Work | Couvrir les erreurs de service et les états clients |
| `data/products.json`, contrat API, configuration/build/dépendances | Commun | Proposition documentée, accord du responsable concerné avant changement incompatible |
| Prix, inventaire initial, dépenses, remboursements, mise en production | Fondateur | Validation explicite |

Cette répartition est celle demandée par le fondateur. Le contrat API est une **proposition de raccordement**, pas un accord déjà reçu de Claude. Sa première PR doit confirmer ou corriger ce contrat dans `docs/API-CONTRACT.md`, puis Work adaptera le client.

Procédure : créer une branche depuis v2 ; limiter le périmètre ; documenter dans CHANGELOG.md ; ouvrir une PR vers v2 avec problème, comportement et validation. Pour toucher un fichier de l’autre responsable, décrire d’abord la proposition et obtenir sa coordination dans cette PR ou la documentation. Ne pas auto-fusionner, ne pas déployer.

Le dépôt initial ne modifie aucun code backend hérité. Les instructions du fondateur priment sur toute proposition du rapport.
