# Vérification et conditions de lancement

## Tests automatisés livrés

`npm run test:frontend` : 15 tests Node (contrat stock, fraîcheur, ruptures/réservations, panne réseau, checkout fermé, devis et relais requis, prix navigateur ignorés, redirection autorisée, idempotence de requête, PII hors URL, rendu du stock, démarrage portable et catalogue), plus 13 assertions commerciales.

`npm run test:inventory` : 16 tests historiques sur Miniflare/D1 locale éphémère : 20 acheteurs pour 3 pièces, atomicité, déduplication, HMAC, montants/devises, ordre des notifications, expirations, échecs réseau, annulation concurrente, remboursement distinct du retour, ajustement concurrent, autorisation/CSRF et refus des paiements réels.

Ces tests utilisent exclusivement des fixtures explicitement de test. Ils ne prouvent pas une connexion Stripe, Boxtal, D1 distant, Discord ou Resend opérationnelle.

## Reproductibilité

- Copie de travail indépendante de l’atelier, sans node_modules ou état D1 préexistant.
- Processus du serveur statique lancé avec seulement PATH et PORT ; les fichiers publics répondent, les API refusent, les fichiers internes ne sont pas accessibles.
- `npm ci` depuis le lock puis suites de tests ; `npm run build:storefront` ne publie rien.
- Contrôle des références de ressources et des licences, liste exhaustive et empreintes source.
- Relecture de la branche GitHub et comparaison de tous les blobs avec la copie locale après dépôt.
- SHA de main et version de l’aperçu vérifiés avant/après ; aucun workflow de publication ajouté.

## Recette navigateur

Vues 320/390/1440 px : absence de débordement, logo et images chargés, navigation/clavier, modal panier/guide, toutes les pages légales, compteur sans détail par taille, animation continue et pause/reprise. Sur un chargement neuf, l’animation démarre ; ne pas livrer un onglet laissé en pause. Tester aussi réduction des animations et lecteurs d’écran sur les appareils cibles.

## À réaliser avec Claude, avant toute vente

- Inventaire physique S/M/L confirmé ; pas de quantité fabriquée pour faire passer un test.
- 200 tentatives simultanées sur la dernière pièce sur D1 de test ; une seule réservation ; tests multi-lignes et multi-variantes.
- Prix, quantité, frais de port et relais falsifiés dans le navigateur : refus/recalcul serveur ; devis expiré et choix modifié.
- Paiement Stripe test, webhook signé exact/corps modifié, signature expirée, notifications dupliquées/désordonnées, double clic et redirection avant webhook.
- Échec réseau après réservation et après création de session ; reprise idempotente ; état inconnu sans double réservation ni libération prématurée.
- Abandon, paiement différé, expiration, annulation et réconciliation de secours.
- Remboursement sans restock automatique ; retour physique validé une fois ; motif journalisé.
- Relais réel fermé ou non admissible, changement de mode, absence de fournisseur ; adresse et identifiant sur commande/étiquette.
- Suivi non énumérable, jeton expiré, contrôle d’accès ; aucune PII dans URLs/logs/Discord.
- Accusé de réception durable des demandes et rétractations, zéro faux succès en cas de panne.
- Chaque alerte Discord une fois ; e-mails Resend, étiquette/suivi Boxtal en test ; quotas et retries bornés.
- Authentification Studio sur iPhone et ordinateur, accès interdit sans droits, journal des actions et procédure de restauration.
- Audit juridique des renseignements réels et des textes avant vente ; vérification des zones et délais.
- SEO réel, URLs, sitemap, OG, données structurées fiables, budget performance, accessibilité et compatibilité Safari iPhone.
- Commande réelle de bout en bout uniquement après autorisation explicite du fondateur ; plan de retour vers la 1.0 en vitrine sans vente à valider, avec contrôle de l’ancien lien Stripe.
