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
| `src/admin.mjs` | API de SAYLESS STUDIO : passkeys, sessions, codes de secours, confirmation Face ID, inventaire guidé |
| `src/webauthn.mjs` | Vérification WebAuthn sans dépendance (ES256, RS256, attestation « none ») |
| `migrations/0004_studio_auth.sql` | Passkeys, défis, sessions, codes de secours |
| `migrations/0005_revue_work.sql` | Corrections de la revue de Work : générations de passkeys (invalidation atomique après un code de secours), lien 1.0 reconnu, CGV versionnées, relais figé, inventaire de tout le produit à la réservation |
| `migrations/0006_studio_ecrans.sql` | Drops déclarés, suivi des commandes, demandes des clients, liens de suivi, abonnements iPhone, inventaires guidés |
| `src/studio.mjs` | Routes métier de STUDIO : aujourd’hui, commandes, stock, finances, notifications, santé, historique, réglages, drops, performances, demandes, sauvegardes |
| `src/terms.mjs` | CGV publiées et versionnées (texte conservé, jamais modifié) |
| `src/requests.mjs` | `POST /api/requests`, `POST /api/order/lookup`, `GET /api/order` (actifs quand l’e-mail est configuré) |
| `src/email.mjs` | E-mails clients par Resend, chiffrés dans la file d’envoi |
| `src/push.mjs` | Notifications sur l’iPhone (Web Push, RFC 8291, VAPID), sans service payant |
| `src/routes.mjs` | Routage HTTP et tâches planifiées |

## Commandes

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run test:backend      # D1 locale (Miniflare), services externes simulés
npm run check:cloudflare  # compilation du Worker et des Functions, sans envoi
```

## État réel

- Testé : D1 locale et moteur Cloudflare local (workerd) ; STUDIO dans Chrome avec un authentificateur Face ID virtuel (`tests/browser/studio_e2e.py`). Stripe, transporteur, points relais, Discord, Resend et les services de notification sont **simulés** dans les tests.
- Non testé : Cloudflare réel, Stripe en mode test réel, transporteur, e-mails réels, notifications sur un vrai iPhone, Safari. Rien n’est déployé.
- Fermé par défaut : boutique en pause, paiements coupés, inventaire non confirmé.

## Règles

- Aucun secret, aucune quantité réelle, aucun montant encaissé ni donnée client dans Git. Les ventes passées et l’inventaire sont saisis par le fondateur dans STUDIO.
- Secrets saisis par le fondateur dans Cloudflare (générés sur son ordinateur par `scripts/generate-secrets.mjs`, procédure `docs/CLOUDFLARE-TEST.md`) : `APP_SECRET` et `PII_KEY` (identiques pour la boutique et le Worker), `ADMIN_SETUP_CODE`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TURNSTILE_SECRET`, `DISCORD_WEBHOOK_URL`, `VAPID_PRIVATE_KEY`, `RESEND_API_KEY`. Variables : `ENVIRONMENT`, `PUBLIC_ORIGIN`, `STUDIO_ORIGIN`, `STUDIO_RP_ID`, `BACKUP_PUBLIC_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `EMAIL_FROM`, `EMAIL_REPLY_TO`. Liaisons : `DB` (D1), `BACKUPS` (KV).
- Restauration d’une sauvegarde, sur l’ordinateur du fondateur seulement : `scripts/restore-backup.mjs`.
- Une clé Stripe de production n’est acceptée qu’avec `ENVIRONMENT = production`, et une clé de test qu’en dehors.
- Jamais d’`INSERT OR IGNORE` ni d’`OR REPLACE` sur une table qui déclenche un mouvement de stock : un test le vérifie.
