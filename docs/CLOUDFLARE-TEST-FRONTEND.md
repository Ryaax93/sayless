# Boutique : préparation de Cloudflare TEST

Complément Work à la procédure de Claude `CLOUDFLARE-TEST.md`, sans modification de cette procédure ni du Worker. Ne pas confondre préparation locale, aperçu privé et environnement Cloudflare hébergé.

## Construire sans activer les ventes

```sh
SAYLESS_TEST_ORIGIN=https://sayless-boutique-test.pages.dev npm run build:storefront:test
```

La sortie `dist-storefront/` embarque une configuration publique fermée, sans clé ni version inventée. La commande ne crée aucune ressource et ne déploie rien. Les retours sont servis via le fallback SPA ; `/api/*` est confié aux Pages Functions. Les autres fichiers restent statiques. Ne pas joindre l'ancien serveur ou `admin.js` au déploiement.

## Lorsque la recette de paiement TEST sera autorisée

Après B1/B2 et coordination du texte CGV, le build accepte :

- `SAYLESS_TEST_ORIGIN` : exactement `https://sayless-boutique-test.pages.dev` ; toute autre origine est refusée.
- `SAYLESS_TEST_TERMS_VERSION` : identifiant de la version dont le texte identique est publié côté boutique et archivé côté serveur.
- `SAYLESS_TEST_TURNSTILE_SITE_KEY` : clé **publique** du site TEST.
- `SAYLESS_TEST_CHECKOUT=enabled` : autorisation explicite du build de recette. Ne pas la renseigner avant la validation du fondateur et les prérequis ci-dessus.

La configuration générée revérifie l'origine dans le navigateur. Hors de cette origine elle reste fermée. Les verrous serveur sont indépendants : stock vérifié, CGV, secrets Stripe TEST, chiffrement, anti-abus et mode de boutique. La présence d'un prix ou d'une quantité dans le client ne les remplace jamais.

Aucun secret Stripe/Resend/Discord/transporteur/APP_SECRET dans ces variables publiques. Suivre la procédure Claude pour D1, KV, migrations et secrets de TEST. Aucun lien Git automatique susceptible de publier `main` ou `v2` n'est mis en place.

## Avant validation hébergée

- Tester les retours `/merci`, `/commande-annulee` et `/#/suivi?t=…`, le retrait du jeton de l'URL, les en-têtes no-store des APIs et no-referrer.
- Vérifier que Turnstile charge avec la CSP et le domaine TEST. La CSP statique ne remplace pas la protection des routes API.
- Rejouer stock bloqué, deux achats concurrents de la dernière pièce, doublons de webhook, expiration et réseau interrompu ; aucun nouveau paiement après une tentative paid/review.
- Vérifier les documents de CGV, 79,90 €/83,50 €, point réel, e-mails réellement reçus et identifiants TEST. Un statut HTTP réussi ne prouve pas qu'un message est livré.
- Vérifier iPhone/Safari, VoiceOver, wallets et quotas/CPU sans changer d'offre ni engager de dépense.

Les `_headers` gardent les pages de TEST en noindex ; leur adaptation pour un lancement commercial relèvera d'une validation distincte. Ce fichier n'autorise aucun déploiement.
