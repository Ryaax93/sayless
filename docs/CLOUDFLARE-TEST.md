# Environnement de test Cloudflare — procédure pas à pas

**But** : essayer SAYLESS STUDIO sur ton iPhone, puis la boutique 2.0 complète avec Stripe en mode test, dans un environnement **entièrement séparé** de la boutique actuelle. Tout reste gratuit. Le domaine saylessbrand.fr, la boutique 1.0, le lien de paiement 1.0 et le Stripe réel ne sont **pas touchés**.

Règles : une étape à la fois, vérifiée avant la suivante. Aucune clé secrète dans le chat, par e-mail ou dans GitHub : les secrets sont créés sur ton ordinateur et envoyés directement à Cloudflare. Rien n’est déployé sans ton accord.

| | Test (cette procédure) | Production (plus tard, sur autorisation) |
| --- | --- | --- |
| STUDIO | `https://sayless-ops-test.<ton-sous-domaine>.workers.dev` | `https://studio.saylessbrand.fr` |
| Boutique | `https://sayless-boutique-test.pages.dev` | `https://saylessbrand.fr` |
| Base | D1 `sayless-test` | D1 `sayless-production` |
| Stripe | Mode test (aucun vrai paiement) | Mode réel |
| Coût | 0 € (offres gratuites) | 0 € au départ |

Offres gratuites utilisées : Workers et Pages Functions (100 000 requêtes par jour, 10 ms de calcul par requête), D1 (500 Mo par base), Workers KV pour les sauvegardes, une tâche planifiée sur les 5 offertes. Aucun moyen de paiement n’est demandé pour ces offres.

## Étape 0 — Préparer l’ordinateur (10 min)

1. Installer Node.js 22.13 ou plus récent (nodejs.org, version LTS).
2. Récupérer le dépôt et la branche de vérification :
   ```sh
   git clone https://github.com/Ryaax93/sayless.git && cd sayless
   git checkout claude/verification-v2
   npm ci
   ```
3. Vérifier : `npm run test:backend` doit afficher `fail 0`.

## Étape 1 — Compte Cloudflare (5 min)

1. Créer un compte gratuit sur dash.cloudflare.com (ou utiliser le tien). **N’ajoute aucun domaine** à cette étape.
2. Dans le terminal : `npx wrangler login` (une page s’ouvre dans le navigateur : accepte). Aucun jeton à copier.
3. Vérifier : `npx wrangler whoami` affiche ton adresse et ton compte.

## Étape 2 — Base et espace de sauvegarde de test (5 min)

```sh
npx wrangler d1 create sayless-test
npx wrangler kv namespace create sayless-test-backups
```

Recopie les deux identifiants affichés (`database_id`, puis `id`) dans `ops/wrangler.toml`, section `[env.test]`, à la place des zéros. Ce ne sont pas des secrets. Puis applique le schéma :

```sh
npx wrangler d1 migrations apply sayless-test --remote --env test -c ops/wrangler.toml
```

Vérifier : la commande liste les 6 migrations, toutes « ✅ ».

## Étape 3 — Secrets de test, créés sur ton ordinateur (5 min)

```sh
node scripts/generate-secrets.mjs --env test
```

Le script écrit dans `~/sayless-secrets-test/` (hors du dépôt, lisible par toi seul) : les secrets du Worker et de la boutique, les deux valeurs publiques, et la **clé privée des sauvegardes**. Lis `LISEZ-MOI.txt`.

```sh
npx wrangler secret bulk ~/sayless-secrets-test/worker-secrets.json --env test -c ops/wrangler.toml
```

Dans `ops/wrangler.toml`, section `[env.test.vars]`, ajoute les deux lignes de `public-values.txt` (`VAPID_PUBLIC_KEY`, `BACKUP_PUBLIC_KEY`). Elles sont publiques.

Copie `CLE-PRIVEE-SAUVEGARDES.json` hors ligne (clé USB rangée, coffre), puis efface-la de l’ordinateur. Sans elle, personne, pas même Cloudflare ou moi, ne peut relire une sauvegarde.

## Étape 4 — STUDIO en ligne, puis sur ton iPhone (10 min)

```sh
npm run build:studio
npx wrangler deploy --env test -c ops/wrangler.toml
```

La commande affiche l’adresse du Worker, par exemple `https://sayless-ops-test.ton-sous-domaine.workers.dev`. Recopie-la dans `[env.test.vars]` : `STUDIO_ORIGIN` (adresse complète) et `STUDIO_RP_ID` (la même, sans `https://`). Redéploie avec la même commande : sans ces deux valeurs, STUDIO refuse de démarrer en recette.

Vérifier : `https://…workers.dev/health` affiche `"ok": true`.

Sur l’iPhone, dans Safari :
1. Ouvre l’adresse du Worker. Saisis le code d’installation (`ADMIN_SETUP_CODE` dans `worker-secrets.json`), touche « Vérifier le code », puis « Autoriser cet appareil » : Face ID.
2. Note les 10 codes de secours **sur papier**. Ils ne seront plus affichés.
3. Partager → « Sur l’écran d’accueil » : STUDIO s’ouvre ensuite comme une app.
4. Essaie : inventaire guidé, réglages, notifications (« Activer » demande l’autorisation de l’iPhone).

Le code d’installation ne sert qu’une fois. Tu peux ensuite le retirer : `npx wrangler secret delete ADMIN_SETUP_CODE --env test -c ops/wrangler.toml`.

## Étape 5 — Stripe en mode test (15 min)

1. Dans Stripe, bascule sur **Mode test** (interrupteur en haut à droite). Rien ne touche le compte réel.
2. Développeurs → Clés API → **Clé restreinte** « SAYLESS test » avec les droits : Checkout Sessions (écriture), Refunds (écriture), Charges (lecture), Balance (lecture), Payment Links (lecture).
3. Développeurs → Webhooks → Ajouter un point de terminaison : `https://…workers.dev/webhooks/stripe`, événements `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`, `charge.dispute.created`.
4. Saisis les deux valeurs **directement dans le terminal** (elles ne s’affichent pas) :
   ```sh
   npx wrangler secret put STRIPE_SECRET_KEY --env test -c ops/wrangler.toml
   npx wrangler secret put STRIPE_WEBHOOK_SECRET --env test -c ops/wrangler.toml
   ```

Vérifier : dans STUDIO, Santé du site → « Paiement Stripe : mode test ».

## Étape 6 — Boutique de test (Work, 15 min)

À faire avec le projet de Work une fois sa branche validée :

```sh
npx wrangler pages project create sayless-boutique-test --production-branch main
npx wrangler pages secret bulk ~/sayless-secrets-test/pages-secrets.json --project-name sayless-boutique-test
npm run build:storefront
npx wrangler pages deploy dist-storefront --project-name sayless-boutique-test --branch main
```

Dans le tableau de bord Cloudflare (Workers & Pages → sayless-boutique-test → Paramètres) : liaison D1 `DB` = `sayless-test` ; variables `ENVIRONMENT = staging`, `PUBLIC_ORIGIN = https://sayless-boutique-test.pages.dev`, `TURNSTILE_BYPASS = test-only` tant que Turnstile n’est pas créé. Ajoute aussi `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` (mêmes valeurs de test) en secrets. Redéploie.

La boutique de test et STUDIO partagent la même base de test : une commande de test apparaît dans STUDIO.

## Étape 7 — Ouvrir la boutique de test

1. STUDIO → Réglages : publie une version de test des CGV, enregistre l’inventaire, puis « Ouverte ». STUDIO refuse tant qu’un prérequis bloquant manque, et dit lequel.
2. Paiement test avec la carte `4242 4242 4242 4242`, date future, CVC quelconque. Aucun argent ne circule.
3. Rejouer la recette de `docs/TEST-PLAN.md`, y compris sur l’iPhone et avec VoiceOver.

## Étapes facultatives (chacune séparément)

- **Discord** : salon privé → Intégrations → Webhook → `npx wrangler secret put DISCORD_WEBHOOK_URL --env test -c ops/wrangler.toml`.
- **Turnstile** (gratuit) : créer un widget pour `sayless-boutique-test.pages.dev` ; clé secrète en secret Pages `TURNSTILE_SECRET` ; clé publique dans la configuration de la boutique (Work) ; retirer `TURNSTILE_BYPASS`.
- **E-mails clients (Resend, offre gratuite)** : demande un domaine vérifié. Sans domaine, Resend n’envoie qu’à ta propre adresse : pratique pour un premier essai. Secrets `RESEND_API_KEY`, variable `EMAIL_FROM`, dans le Worker **et** la boutique.

## Sauvegardes : vérifier qu’elles se relisent (une fois par mois)

1. STUDIO → Santé du site → Sauvegardes chiffrées → Télécharger.
2. Sur l’ordinateur, avec la clé privée branchée :
   ```sh
   node scripts/restore-backup.mjs --backup ~/Téléchargements/sayless-sauvegarde-….json --key /Volumes/CLE/CLE-PRIVEE-SAUVEGARDES.json
   ```
   Résultat attendu : « Contrôle réussi ».

## Ce que cette procédure ne fait pas

Aucun changement DNS, aucun domaine ajouté, aucune clé Stripe réelle, aucune modification du lien 1.0, aucune dépense. Le passage en production fera l’objet d’une procédure séparée, soumise à ton autorisation.
