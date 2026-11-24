> Archive descriptive de l’aperçu v4, conservée pour audit. Pour l’état actuel de cette branche, lire README.md, STATUS.md et API-CONTRACT.md. La disponibilité réelle n’est plus déduite du total théorique.

# SAYLESS 2.0 — Aperçu privé

Mise à jour du 22 novembre 2026 — ajustement du contenu et du stock dans la barre rose. L’identité visuelle de l’aperçu existant est conservée. Le site officiel `saylessbrand.fr` n’est pas modifié. Aucun paiement réel n’est activé.

## Modifications visuelles

- Post-it flottant supprimé, sans remplacement ni espace réservé.
- Barre rose continue avec le total disponible (actuellement 26 gilets déclarés), le logo original SAYLESS, deux groupes identiques, animation linéaire et commande pause/reprise. Le même service alimente la barre et la fiche, sans chiffre par taille côté client. Une règle `prefers-reduced-motion` désactive le mouvement et masque la répétition.
- Fiche produit : prix de 75 € TTC hors livraison, stock issu de l’API et distinction entre le total déclaré et un inventaire confirmé.
- Pages légales sur fond clair, titres hiérarchisés, texte noir, colonne lisible sans menu latéral.
- Footer allégé : navigation, service, informations légales, réseaux et contact. Aucune newsletter inactive ni faux logo de paiement.
- Coloris unique rose, modèle unisexe femme et homme. Le S est recommandé aux personnes de petite taille selon les indications de SAYLESS.
- Blocs administratifs provisoires retirés des mentions légales ; les données à réunir sont conservées dans le document interne. Références à la plateforme retirées du texte des pages ; son écran de connexion privé reste géré par l’hébergeur.
- Retours : présentation demandée, frais client pour taille/changement d’avis et bordereau gratuit après vérification pour erreur/défaut. Délai légal de 14 jours pour déclarer puis 14 jours pour expédier, sans validation préalable imposée ; simple essayage autorisé.
- Guide des tailles conservé. Les valeurs issues de l’ancien site restent signalées comme provisoires ; aucune nouvelle mensuration n’a été inventée.

## Ce qui fonctionne et ce qui reste à connecter

| Fonction | État livré |
|---|---|
| Présentation, navigation, galerie, panier | Fonctionnels dans l’aperçu |
| Parcours client | Démonstration, sans commande ni paiement |
| Prix et domicile | 75 € + 8,50 € = 83,50 €, total affiché après les coordonnées et la livraison |
| Point relais | Tarif de 4,90 € ; sélection désactivée jusqu’au raccordement d’un vrai transporteur |
| Base centrale de stock | Schéma D1 et API serveur ; aucun inventaire réel prérempli |
| Quantité affichée | 26 déclarées par SAYLESS le 21 novembre, répartition à confirmer ; ensuite somme des variantes disponibles |
| Actualisation | Lecture serveur toutes les 20 secondes sur l’accueil ou la fiche visible ; quantité masquée si la vérification échoue |
| Administration | Authentification de la plateforme et autorisation serveur ; espace `/#/gestion` |
| Stock Stripe | Code limité au mode test, inventaire isolé, signé et idempotent ; raccordement Stripe absent |
| Paiements réels | Refusés côté serveur, y compris avec une clé réelle |
| Réception de webhooks Stripe | Non raccordée : l’accès privé de cet aperçu bloque les appels extérieurs |
| Contact et rétractation | Préparation locale d’un e-mail, sans envoi ni accusé durable |
| Mentions et CGV | Présentation terminée, contenu préparatoire ; informations administratives et conditions réelles à compléter |

La quantité « 26 » est une déclaration du propriétaire, pas un compteur de ventes prétendument actif. Les 30 pièces produites comprennent 2 offertes et 2 vendues. Les variantes ne seront créées qu’après confirmation de la répartition interne S/M/L totalisant 26. Aucun détail chiffré par taille n’est affiché aux clients.

## Stock et sécurité

Les fichiers `server/inventory.mjs`, `server/stripe.mjs` et `server/api.mjs` assurent les opérations côté serveur. Les déclencheurs SQL de `drizzle/0001_inventory_guards.sql` font évoluer les réservations et le stock dans les mêmes transactions D1. Les inventaires `real` et `test` sont indépendants.

Une réservation soustrait les pièces disponibles et augmente le nombre réservé. Un paiement confirmé libère la réservation sans soustraire une seconde fois les pièces. Une expiration ou un échec définitif confirmé rend les pièces disponibles. Une notification dupliquée, une notification reçue dans le désordre ou une répétition de requête ne doit pas doubler l’opération. Les événements Stripe sont vérifiés sur le corps brut par HMAC SHA-256, avec tolérance de cinq minutes, puis la session est relue chez Stripe ; montant, devise et lignes sont comparés à la commande serveur.

Les remboursements sont enregistrés séparément. Seul un retour reçu et contrôlé, explicitement saisi par l’administrateur, réintègre une pièce. Les corrections manuelles utilisent une révision de stock pour refuser l’écrasement d’une modification concurrente et sont journalisées.

Une erreur réseau lors de la création Stripe ne libère pas aveuglément une réservation : la même clé permet une reprise. Si l’état du prestataire ne peut pas être confirmé, les pièces restent réservées et nécessitent une vérification. Il n’existe pas de tâche planifiée de rapprochement ; en complément des notifications, une vérification manuelle est disponible dans l’administration. Sans session rattachée, une tentative incertaine nécessite de reprendre la même création ou une revue technique. Aucune garantie de traitement réel n’est annoncée avant le test de bout en bout.

L’accès administrateur repose sur les en-têtes d’identité injectés par Sites. Le propriétaire peut associer son compte une première fois ; son identifiant stable est ensuite enregistré. Les modifications exigent cette identité et la même origine. Le courriel de démarrage est configuré en variable sécurisée. Ni jeton administrateur ni clé Stripe ne sont inclus dans les fichiers publics.

## Configuration et usage

- `ADMIN_BOOTSTRAP_EMAIL` : compte propriétaire autorisé à associer l’espace de gestion ; configuré dans les variables Sites.
- `STRIPE_TEST_ENABLED`, `STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_WEBHOOK_SECRET` : non configurés. Seul le mode test est accepté.
- Webhook prévu : `POST /api/stripe/webhook`. L’hébergement privé ne suffit pas à le rendre joignable par Stripe. La réception doit être résolue sans rendre l’administration publique ni contourner l’autorisation de l’utilisateur.
- Événements préparés : `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`.
- L’inventaire réel doit totaliser 26 à l’initialisation ; renseigner S, M et L pour le seul coloris Rose. Le serveur refuse un autre coloris dans l’inventaire réel. Des unités fictives peuvent être créées séparément pour les essais.
- Les ventes antérieures, liens de paiement indépendants et ventes sur le site officiel ne sont pas synchronisés automatiquement par cet aperçu.

Le stockage local du panier expire après 30 jours. Les coordonnées d’essai restent en mémoire de la page. La politique de confidentialité distingue ces éléments des données administratives conservées dans la base.

## Validation effectuée

- 16 tests d’intégration sur une base D1 locale éphémère avec Miniflare : concurrence, transactions, événements dupliqués/désordonnés, signature, montants, erreurs réseau, abandon/échec, remboursements, retours, ajustements concurrents, autorisation et protection des paiements réels.
- Scénario de concurrence : 20 demandes pour 3 unités, exactement 3 réservations réussies, aucun stock négatif.
- 13 assertions commerciales sur prix, tarifs, coordonnées, totaux et relais indisponible.
- 3 tests du stock affiché : accueil sans fiche produit, actualisation simultanée de la barre et de la fiche, variantes épuisées, disparition des quantités après erreur réseau ou données périmées.
- Révision du 22 novembre : contrôles des textes et de la mise en page à 320, 390 et 1280 px ; total visible dans les deux groupes du bandeau, seul coloris Rose, conseil S, mentions retirées et formulaire de rétractation dépliable.
- Contrôles navigateur de 14 pages dans des cadres de 320, 390 et 1280 px : aucun débordement horizontal ni image de contenu chargée défectueuse. Il s’agit de vues responsive dans un navigateur, pas d’essais sur des téléphones physiques.
- Animation et pause/reprise vérifiées, six images du logo chargées et groupes de largeur identique. La préférence de réduction des animations est gérée dans le CSS ; le réglage système n’a pas été émulé dans ces contrôles.
- Guide, sélection de taille, panier, augmentation/diminution, coordonnées fictives, livraison après coordonnées, total 83,50 € et confirmation démo vérifiés. Aucun envoi effectué.
- Administration : contrôles serveur testés ; association initiale au compte et saisie de l’inventaire réel à faire par le propriétaire.
- Aucun paiement Stripe externe ni réception réelle de webhook n’ont été testés, faute de raccordement.

Commandes : `node --test tests/inventory.test.mjs tests/stock-display.test.mjs` et `node tests/commerce.test.cjs`. Le build et la publication passent par les outils Sites. Le dossier `public/store/` conserve l’interface HTML/CSS/JavaScript ; les routes Vinext apportent le serveur. Les migrations sont sans données et leur historique ne doit pas être modifié après application.

## Informations à fournir

Voir `INFORMATIONS-A-COMPLETER.md` pour la liste précise : inventaire, mesures, identité, immatriculation, TVA, médiateur, hébergeur, livraison et retours, prestataires, conservation des données et confirmation des contacts.

Le logo, les photos, les réseaux, l’adresse de contact et les mesures proviennent du projet SAYLESS existant. Les profils externes et la réception de la boîte de contact restent à confirmer. Les polices sont locales et leur licence est conservée dans `public/store/assets/FONT-LICENSE.txt`.
