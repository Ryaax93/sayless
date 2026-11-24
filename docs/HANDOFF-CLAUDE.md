# Relais à Claude — SAYLESS 2.0

Tu peux maintenant auditer la boutique complète dans la branche `v2` de `Ryaax93/sayless`. Pars de cette branche et crée `claude/audit-v2` (ou une autre `claude/…`). Ne touche ni à main, ni au domaine, ni aux paiements réels, ni à la publication.

Le rapport « SAYLESS — Audit & plan d’automatisation », dernière version du 24 novembre (693 lignes, sections 1 à 15), a été lu intégralement, notamment les sections 6, 11, 12 et 13. Il portait sur la 1.0. Ses constats ne doivent pas être reportés automatiquement sur la 2.0 : les pages légales, le panier, le guide, les images externes, le logo et la barre continue existent déjà. Les textes légaux validés sont à préserver ; les informations manquantes sont listées séparément.

## Première prise en main

```sh
git clone --branch v2 --single-branch https://github.com/Ryaax93/sayless.git
cd sayless
git switch -c claude/audit-v2
npm run dev:storefront
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run build:storefront
```

Sans backend, le stock est volontairement inconnu et les API répondent 503. Aucune donnée de production ni clé n’est requise pour ces tests.

## À reprendre en priorité

1. Confirmer/amender `docs/API-CONTRACT.md` avant d’implémenter les réponses serveur : états vérifiés, réservations, devis, idempotence, suivi et demandes. Le contrat est proposé, pas présenté comme déjà accepté par toi.
2. Auditer le prototype dans `server/`, `drizzle/` et ses 16 tests ; décider explicitement ce qui est réutilisé. Ne pas maintenir deux stocks ni deux espaces admin. Remplacer l’authentification spécifique de l’ancien aperçu.
3. Créer le catalogue D1 extensible et la correspondance des SKU. `data/products.json` contient les faits approuvés, sans stock ; 26 reste théorique. Aucun peuplement réel avant inventaire physique S/M/L.
4. Préparer les Workers et migrations, Stripe test signé, réservations atomiques, déduplication, expirations, rapprochement et journal. Aucun paiement réel.
5. Livrer des API testables pour vrais points relais, commandes, suivi, demandes et retours, puis SAYLESS STUDIO. Garder prix et frais de port approuvés.
6. Proposer une PR vers `v2` avec documentation, tests, limites et décisions à soumettre au fondateur. Work branchera les interfaces après coordination.

## Points de vigilance

- Le navigateur n’est jamais une preuve de prix, de stock, de total ou de paiement. Ne pas confirmer une commande à partir du seul retour Stripe ou `session_id`.
- Une quantité disponible de zéro peut provenir de réservations. Le message SOLD OUT exige un état confirmé distinct.
- Le compte Instagram transmis dans le dernier brief est `@sayless.brand`. L’adresse de contact actuelle reste `SayLe2s@outlook.com` ; aucun `contact@` non configuré n’est affiché.
- Une prévisualisation est un environnement séparé : ne pas activer d’autodeploy Git/Pages/Workers sans accord.
- Les fichiers `server/*`, les migrations et l’ancien `admin.js` sont conservés pour audit ; ils ne sont pas étendus par Work.
- `docs/DESIGN-SYSTEM.md` fournit couleurs, polices, logo et principes pour ton Studio. Aucun nouvel admin n’a été créé.
- Le rapport complet n’est pas dans ce dépôt public parce qu’il contient des données financières et de compte.

## Questions techniques à résoudre ensemble

- Quelle forme finale de contrat stock : la carte simple initiale ne distingue pas panne, réservation et épuisement définitif.
- Comment attacher les coordonnées saisies avant la livraison à un devis et à une session Stripe sans les conserver inutilement en D1.
- Comment obtenir un total serveur exact avant le bouton Payer, et conserver son mode de livraison dans Stripe.
- Comment exposer les API sous la même origine que la boutique, avec protections CSRF, limitation d’abus et réponses non cacheables.
- Comment traiter les ventes hors de la 2.0 et la fermeture du lien Stripe de la 1.0 lors de la bascule autorisée.

## Compléments du dernier rapport

La section 12 propose maintenant une passkey pour Studio, avec Access en couche facultative : choix du fondateur et conception serveur à confirmer par Claude. La section 13 et ses 23 scénarios sont des résultats déclarés par Claude ; ils ne sont pas les 16 tests du prototype inclus ici et n’ont pas été rejoués sur infrastructure réelle par Work. Turnstile est prévu au contrat avant réservation et demandes ; aucun widget ni clé n’est activé.

Les couleurs #070707 / #ff7eb9 et Bebas Neue / Space Mono de la section 12 décrivent la 1.0. Pour harmoniser Studio avec la 2.0 validée, utiliser les valeurs et polices réellement présentes dans DESIGN-SYSTEM.md, sans refaire la boutique. La future adresse contact@saylessbrand.fr n’est à afficher qu’après vérification de réception/envoi. DNS, ancien lien Stripe, passkeys, Gmail et notifications ne sont pas modifiés par cet export.
