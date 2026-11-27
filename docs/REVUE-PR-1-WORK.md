# Revue de la PR nº 1 et raccordement de la boutique

25 novembre 2026. **Avis de Work : garder les deux PR en brouillon.** Le parcours d’achat consomme le contrat v1.2 et fonctionne en recette locale. Quatre défauts exigent une correction côté Claude avant la fusion proposée vers `v2`.

[Revue déposée sur la PR nº 1](https://github.com/Ryaax93/sayless/pull/1#pullrequestreview-6050400248) · [Contrat v1.2](API-CONTRACT.md) · [Plan commun](INTEGRATION-PLAN.md) · [Passation à Claude](HANDOFF-CLAUDE.md)

## Périmètre examiné

La branche de préparation `work/frontend-api-v1-2` part du dernier commit de Claude. Celui-ci contient déjà `v2` au commit `3dc079b`. La PR de préparation cible `v2` conformément aux règles du dépôt. Son diff cumule les trois commits de la PR nº 1 et le commit Work. Pour isoler Work, utiliser `git diff c6c9db1...HEAD` sur la branche de préparation.

| Commit de Claude | Éléments examinés |
| --- | --- |
| `3e666f9` | Audit initial, contrat v1.1, routeur, devis, couche Stripe, migrations, réservations, notifications et tests D1. |
| `91fc7c4` | Contrat v1.2, zone de livraison, coordonnées Stripe, stock public plafonné par taille, conservation, export chiffré et restauration. |
| `c6c9db1` | Passkeys, sessions et récupération STUDIO, inventaire guidé, manifeste, ressources graphiques et tests. |

Revue des 44 fichiers de la PR, du rapport d’automatisation et des six documents prioritaires. L’ancienne boutique utilisait un prototype Vinext avec une base et un gestionnaire propres à l’aperçu. La proposition de Claude place le métier dans `backend/src/`. Les Pages Functions servent l’API publique sur la même origine. Le Worker `ops/` reçoit les webhooks et sert STUDIO. Les deux utilisent la même D1 dans un environnement donné. La boutique n’a aucune opération directe sur D1.

Le registre de mouvements, les réservations atomiques, les identifiants d’idempotence, les webhooks signés et la relecture de la session chez Stripe constituent les mécanismes appropriés pour ce parcours. Les tests locaux existants couvrent les demandes simultanées, les notifications dupliquées, les remboursements et les expirations. Les écarts suivants concernent des situations distinctes.

## Corrections à la charge de Claude

| Priorité | Défaut confirmé localement | Correction et critère d’acceptation |
| --- | --- | --- |
| Haute · STUDIO | Une session liée à une ancienne passkey reste susceptible d’accéder à l’inventaire après récupération et remplacement de la clé. `backend/src/admin.mjs`, fonctions `currentSession` et `handleAdmin`. | Invalider atomiquement sessions et challenges de la génération précédente. Rattacher chaque session à une passkey active ou à une génération vérifiée. Après récupération, seule la nouvelle génération peut consulter l’inventaire. |
| Haute · stock 1.0 | `recordLegacyLinkSale` dans `backend/src/payments.mjs` emploie `session.created` comme date du règlement. Une vente réglée après comptage peut laisser sa pièce disponible. Le cas de recette finit à 1 au lieu de 0. Le routage actuel accepte aussi tout Payment Link du compte. | Reconnaître explicitement le lien autorisé, valider variante, quantité, prix, devise et instant de règlement. Soumettre les cas ambigus au contrôle du fondateur. Vérifier les deux côtés de la date d’inventaire et le renvoi d’une notification. |
| Haute · reprise de commande | `startCheckout` dans `backend/src/commerce.mjs` vérifie l’expiration du devis avant la recherche de la clé. Une reprise à 11 minutes reçoit `409 quote_expired` alors que la session Stripe et la réservation sont ouvertes. | Retrouver la tentative existante par clé, vérifier son empreinte, puis renvoyer sa session ou son état terminal. Exiger un devis valide pour une nouvelle tentative. L’essai doit retrouver une seule session et une seule réservation. |
| Haute · sauvegardes | `dumpDatabase` dans `backend/src/backup.mjs` lit les tables séparément. Pendant une vente, la sauvegarde peut conserver l’inventaire d’avant et le registre d’après. La restauration signale un stock de 1 face à un registre à 0. | Prendre une image D1 cohérente avec les écritures concurrentes. Valider l’image et la procédure de restauration avant de la compter comme sauvegarde réussie et de faire tourner les copies précédentes. |

Les trois cas commerciaux sont exécutables avec `npm run test:review`. Ils expriment le comportement correct attendu et échouent sur le commit examiné. Le contrôle de récupération STUDIO est distinct. Ajouter sa régression dans la suite STUDIO du propriétaire lors de la correction.

### Autres écarts relevés à la lecture du code

- **Ouverture des ventes.** Le stock public exige un inventaire complet. `stockCheck` et les conditions de réservation contrôlent les SKU commandés. Appliquer côté serveur la même règle de confirmation à tout le produit, y compris au moment de la réservation.
- **CGV.** Une valeur vide de `settings.terms_version` laisse passer une version non vide présentée par le client. Exiger des CGV publiées et versionnées avant d’ouvrir les ventes. Proposer leur version de référence dans le devis signé et conserver le texte associé.
- **Coordonnées d’expédition.** `sealContact` peut rendre une valeur vide si la clé manque. L’alerte actuelle intervient après paiement. Contrôler le chiffrement à l’ouverture des ventes et réserver les commandes non expédiables à une revue opérationnelle.
- **Authentification et accessibilité STUDIO.** Le serveur vérifie WebAuthn avec une implémentation propre. Organiser une revue spécialisée, figer les origines/RP par environnement et tester inscription, vérification utilisateur, récupération et révocation sur Safari/iPhone. La passkey n’atteste pas à elle seule l’usage de Face ID. La reconstruction du contenu dans `studio/app.js` peut déplacer le focus pendant le comptage. Restaurer le focus sur le contrôle utilisé et vérifier avec VoiceOver.
- **Destination et transport.** La recherche de relais filtre un format postal et un pays. Le devis relit la zone du relais. Unifier les refus de destination sur la recherche et le devis. Stabiliser les champs d’adresse et conserver l’adresse du relais choisie à la commande. Une adresse de domicile hors zone fournie ensuite sur Stripe doit rester en revue avant expédition.
- **Paiement et extension du catalogue.** L’étape 8 du plan cite encore Klarna. La décision applicable au DROP 01 est carte bancaire et wallets compatibles, sans Klarna. Pour plusieurs produits par drop, préciser la portée de `total_available`, actuellement calculé pour le produit demandé. L’épuisement définitif est déjà vérifié à l’échelle du drop.

## Vérification de la phase E

| Point du plan | Comportement de la boutique | Vérification |
| --- | --- | --- |
| 1 · Achat | Choisir taille et livraison, sélectionner un relais retourné par l’API, afficher le devis signé, recueillir l’acceptation des CGV et le contrôle anti-abus, réserver via le serveur, puis rediriger. | Deux modes jusqu’au récapitulatif dans Chrome. Client et routeur réel jusqu’au statut payé avec Stripe simulé. |
| 2 · Quantité | Anciens paniers ramenés à une pièce. Augmentation bloquée au plafond et erreur serveur prise en charge. | Panier réel dans le navigateur et rejet de deux pièces par le routeur. |
| 2 bis · Zone | Code postal à cinq chiffres, France métropolitaine hors Corse, sélection explicite du mode suivant un refus. | Corse refusée dans le navigateur, outre-mer et pays hors zone couverts en tests. |
| 2 ter · Stock | `total_available` alimente le seul total affiché. `orderable` et `state` gouvernent chaque taille. Aucun total calculé par addition des tailles. | Inventaire inconnu, total supérieur au plafond, épuisement, réservation, variante absente et D1 indisponible. |
| 3 · Retour Stripe | `/merci` vérifie référence et session par POST. Les états en attente, vérification, paiement, expiration, échec et remboursement sont distincts. `/commande-annulee` est informative. | Retour en attente puis confirmé, paire incorrecte refusée, notification dupliquée et chargement direct des chemins. |
| 4 · Pause | La fermeture temporaire conserve son message propre. Une réservation en cours ne déclenche pas le message de fin de drop. | Tests de normalisation et d’affichage. |
| 5 · Lectures | Fiche, panier ouvert et paiement visibles, toutes les 20 s au plus au repos. Arrêt en arrière-plan et après 10 min d’inactivité. Respect de `Retry-After`. | Horloge pilotée, erreur réseau et expiration de l’affichage. Sur l’accueil ouvert directement, aucun chiffre certain sans lecture récente. |
| 6 · Erreurs | Messages en français. Une réponse incertaine conserve le même devis et la même clé dans l’onglet. Un autre paiement ne peut pas être créé par un double clic. | Coupure avant réponse, reprise après rechargement, devis expiré, CGV obsolètes, tentatives concurrentes et limitation de débit. |
| 7 · Administration | L’ancien écran n’a plus de route ni de script chargé. Le build et le serveur portable excluent son fichier. | Vérification des scripts servis et du refus HTTP. STUDIO appartient à Claude. |
| 8 · Données minimales | Le checkout transmet les identifiants, le mode de livraison, le devis, la version des CGV et le jeton anti-abus. Les coordonnées complètes sont recueillies sur Stripe. | Contrôle du corps HTTP et des options créées sur le double Stripe. |
| 9 · Anti-abus | Widget explicite après acceptation, gestion de l’expiration et du renouvellement, reprise d’une même tentative. Clé publique et paiements désactivés par défaut. | Tests des jetons et reprises. Le véritable widget et Siteverify restent à valider en environnement de test autorisé. |
| 10 · Dépendances | Miniflare devient une dépendance de développement explicite à la version verrouillée. Le prototype historique est conservé pour sa référence et ses tests. | Installation verrouillée, compilation locale. Suppression ultérieure de Vinext/Next à coordonner avec Claude. |

## Recette et limites

Utiliser Node 22.13 ou ultérieur. La recette a été exécutée avec Node 24.22.3. Les commandes et résultats détaillés figurent dans le [plan de tests](TEST-PLAN.md). Les trois contrôles commerciaux en échec constituent des critères de correction.

Chrome, dans deux cadres de 390 et 1 440 px, a servi à vérifier la taille disponible, la taille épuisée, le panier limité à un article, le refus du code postal corse et les deux récapitulatifs. Les largeurs de contenu mesurées avec la barre de défilement étaient 375 et 1 425 px, sans débordement horizontal de la boutique. La barre rose avec le logo s’est déplacée, immobilisée en pause puis remise en lecture. Les quantités et le relais de cette recette venaient d’une base éphémère et d’un fournisseur de test explicitement identifiés.

La version 4 de l’aperçu privé reste celle déjà publiée. La branche de préparation dispose de ses propres fichiers et de ses contrôles locaux. Avant toute ouverture restent nécessaires un inventaire physique S/M/L, un transporteur validé, un environnement hébergé de test, un paiement Stripe test, les wallets sur des appareils compatibles, un vrai iPhone, les informations du vendeur et les essais de suivi, d’expédition et d’e-mails.
