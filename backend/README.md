# Backend SAYLESS 2.0 (Claude)

Code métier unique, partagé par l’API de la boutique (`functions/api/[[path]].js`, Cloudflare Pages Functions) et par le Worker d’exploitation (`ops/worker.mjs` : webhooks Stripe, tâche de chaque minute, puis STUDIO).

| Fichier | Rôle |
| --- | --- |
| `migrations/0001_commerce.sql` | Schéma D1 : stock piloté par un registre en ajout seul, réservations, commandes, transitions gardées, notifications, journal |
| `migrations/0002_catalog_drop01.sql` | Catalogue du DROP 01 (prix validé, tailles, tarifs de livraison). Aucune quantité |
| `src/stock.mjs` | `GET /api/stock`, inventaire guidé, ajustements en compare-and-swap, contrôles de cohérence |
| `src/commerce.mjs` | Devis signé sans donnée personnelle, checkout idempotent, statut de confirmation |
| `src/stripe.mjs` | Client Stripe (fetch), signature des webhooks, paramètres de session déterministes |
| `src/payments.mjs` | Webhooks, rapprochement, balayage, lien 1.0, remboursements, import des ventes passées |
| `src/notify.mjs` | Centre de notifications, file Discord/push, alertes de stock, rapport de 10 h |
| `src/operations.mjs` | Étiquettes, suivi, retours, livre des recettes, coordonnées et purge |
| `src/security.mjs` | Origine, corps JSON, limites d’abus, Turnstile, chiffrement AES-GCM des coordonnées |
| `src/backup.mjs` | Sauvegarde logique chiffrée (clé publique du fondateur), rotation dans KV, restauration contrôlée |
| `src/retention.mjs` | Conservation des données : archivage, purge, anonymisation (coupée tant que non validée) |
| `migrations/0003_decisions_fondateur.sql` | Zones livrées, durées de conservation, réglages de sauvegarde |
| `src/routes.mjs` | Routage HTTP et tâches planifiées |

## Commandes

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run test:backend      # D1 locale (Miniflare), services externes simulés
npm run check:cloudflare  # compilation du Worker et des Functions, sans envoi
```

## État réel

- Testé : D1 locale et moteur Cloudflare local (workerd). Stripe, transporteur, points relais et Discord sont **simulés** dans les tests.
- Non testé : Cloudflare réel, Stripe en mode test réel, transporteur, e-mails, iPhone. Rien n’est déployé.
- Fermé par défaut : boutique en pause, paiements coupés, inventaire non confirmé.

## Règles

- Aucun secret, aucune quantité réelle, aucun montant encaissé ni donnée client dans Git. Les ventes passées et l’inventaire sont saisis par le fondateur dans STUDIO.
- Secrets saisis par le fondateur dans Cloudflare : `APP_SECRET`, `PII_KEY` (32 octets en base64url), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TURNSTILE_SECRET`, `DISCORD_WEBHOOK_URL`. Variables : `ENVIRONMENT`, `PUBLIC_ORIGIN`, `BACKUP_PUBLIC_KEY` (clé publique, non secrète). Liaisons : `DB` (D1), `BACKUPS` (KV).
- Une clé Stripe de production n’est acceptée qu’avec `ENVIRONMENT = production`, et une clé de test qu’en dehors.
- Jamais d’`INSERT OR IGNORE` ni d’`OR REPLACE` sur une table qui déclenche un mouvement de stock : un test le vérifie.
