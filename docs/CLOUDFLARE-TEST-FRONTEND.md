# Boutique : préparation Cloudflare TEST — API v1.4

La procédure principale de Claude reste dans `CLOUDFLARE-TEST.md`. Les [commandes PowerShell Work](POWERSHELL-TEST-V1-4.md) distinguent vérifications locales, déploiement soumis à accord, puis connecteurs TEST. Aucun déploiement effectué dans cette livraison.

## Build local fermé

```sh
SAYLESS_TEST_ORIGIN=https://sayless-boutique-test.pages.dev npm run build:storefront:test
```

`dist-storefront/` contient la boutique, ses ressources, `_headers`, `_routes.json` et une configuration publique fermée. Aucun secret, aucun accès distant. Les routes API sont prises en charge par Pages Functions ; le Worker d'exploitation utilise le même code métier et la même D1 TEST.

Après création autorisée de l'environnement par l'assistant Claude, `node scripts/prepare-pages-test.mjs` transforme son état local en `wrangler.json` local ignoré par Git. Aucun déploiement dans ce générateur : nom du projet et de la base fixes, origine workers.dev TEST contrôlée, aucun secret recopié. Il refuse d'écraser une configuration étrangère. Wrangler Pages découvre ce nom standard sans option `-c`.

## Prérequis avant ouverture du paiement TEST

- Accord explicite, environnement séparé, mode staging, aucune clé réelle. Variante et stock de recette confirmés, boutique ouverte uniquement dans D1 TEST.
- Transporteur TEST et relais vérifiables ; aucun paiement relais tant que le sélecteur n'a pas de fournisseur réel validé.
- CGV TEST archivées via STUDIO : `/api/terms` et `/api/terms/{version}` doivent répondre avec le texte exact et son hash. La boutique charge le document du devis, vérifie SHA-256 et refuse toute divergence. **Plus de SAYLESS_TEST_TERMS_VERSION ni de version codée dans config.js.**
- Stripe TEST pour Pages et Worker selon leurs rôles, webhook TEST signé côté Worker, APP_SECRET/PII_KEY cohérents, Turnstile sur l'origine TEST exacte.
- `SAYLESS_TEST_TURNSTILE_SITE_KEY` : clé publique TEST. `SAYLESS_TEST_CHECKOUT=enabled` : uniquement après cet accord et les prérequis. Hors de `https://sayless-boutique-test.pages.dev`, le build reste fermé. Les contrôles serveur restent indépendants.

Ne jamais mettre STRIPE_SECRET_KEY, APP_SECRET, PII_KEY, clé privée de sauvegarde, secret Turnstile, token Resend ou webhook Discord dans une variable frontend. Ne pas créer d'intégration Git Cloudflare automatique.

## Recette hébergée restant à faire

Retour Stripe `/merci` et `/commande-annulee`, suivi `/#/suivi?t=…` puis jeton retiré de l'URL, no-store/no-referrer, CSP/Turnstile, code postal refusé, stock en pause/panne/épuisé/réservé, deux clients sur la dernière pièce, tentative existante après changement de CGV, absence de consentement, devis expiré, erreurs réseau, notifications dupliquées, totaux 79,90 €/83,50 €, vrais relais, e-mails reçus et rapprochement V14-R1. Vérifier Safari/iPhone, VoiceOver, PWA et métriques CPU/quotas sans changer de forfait.

Le site TEST reste noindex. Les captures locales n'attestent ni Stripe, ni Boxtal, ni Resend, ni Face ID réel.
