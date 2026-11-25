# SAYLESS STUDIO (Claude)

Application de gestion du fondateur, construite à partir de la maquette validée le 24 novembre 2026. La direction artistique est conservée : fond noir, rose pastel, étiquettes de taille tissées, compteurs larges. Seules les couleurs et les polices sont harmonisées avec `docs/DESIGN-SYSTEM.md` (SaylessDisplay, SaylessSans, logo officiel).

## Écrans (version 2, 25 novembre 2026)

Tous les écrans de la maquette sont branchés sur la base : aucun chiffre inventé, aucun bouton factice. Ce qui n’existe pas encore est dit comme tel.

| Écran | État réel |
| --- | --- |
| Connexion Face ID (passkey), codes de secours, appareils | Inscription par code d’installation, connexion, 10 codes de secours ; un code ferme tout et ne rouvre l’inscription que pour l’appareil qui l’a saisi ; ajout et retrait d’appareils (jamais le dernier) |
| Aujourd’hui | Bande des pièces réelle (vendues, offertes, réservées, disponibles, mises de côté, à compter), liste « à faire » calculée, ventes 1.0 relues |
| Commandes, préparation et expédition | Filtres, détail, coordonnées déchiffrées sous Face ID (journalisé), préparée → expédiée → livrée, e-mail d’expédition ; commande « à vérifier » tranchée par le fondateur |
| Retours et remboursements | Remboursement décidé par le fondateur (Face ID), demandé à Stripe, idempotent ; une pièce ne revient en stock qu’après contrôle physique « revendable » |
| Stock, mouvements, inventaire guidé | Grille par taille, registre des mouvements, ajustement motivé, inventaire guidé avec mises de côté et écart avec 26 |
| Finances | Encaissé, remboursé, frais Stripe réels, investissement et taux de cotisation déclarés ; résultat marqué « avant frais inconnus » tant que des frais manquent ; exports CSV |
| Drops | Drop en cours, quantités reçues et offertes déclarées, brouillons de produits invisibles côté boutique ; codes promo non pris en charge (affiché) |
| Performances | Ventes, tentatives et abandons, conversion de la boutique 2.0, ventes 1.0, relais ou domicile, ventes par taille ; visites non mesurées (affiché) |
| Notifications | Centre de notifications, lecture, résolution ; activation sur l’iPhone (Web Push) |
| Santé du site | Contrôles réels (base, tâches automatiques, Stripe, Discord, iPhone, e-mails, file d’envoi, sauvegardes, conservation), prérequis d’ouverture, copies chiffrées à télécharger |
| Historique | Journal des actions, impossible à modifier ou effacer |
| Réglages | Ouverture et pause (refusée tant qu’un prérequis bloquant manque), CGV versionnées, seuil de stock bas, lien 1.0, codes de secours, appareils |
| Demandes des clients | Contact, retour, rétractation : ouverture sous Face ID, statut |

Vues : iPhone (barre d’onglets) et ordinateur dès 960 px (navigation latérale).

## Sécurité

- Passkey WebAuthn vérifiée côté serveur (`backend/src/webauthn.mjs`) : défi à usage unique de 5 minutes, origine et domaine exacts, Face ID exigé, signature, compteur qui ne recule jamais.
- Session : cookie `__Host-` (Secure, HttpOnly, SameSite=Strict), 7 jours maximum, 12 heures d’inactivité, révocable. Empreintes seulement en base.
- Actions sensibles (inventaire, coordonnées, remboursements, exports, sauvegardes, réglages, fermeture des sessions) : nouvelle confirmation Face ID si la dernière date de plus de 5 minutes. Sur iPhone, WebAuthn atteste une vérification par l’appareil : Face ID ou, à défaut, son code.
- Code de secours : dans la même instruction de la base, passkeys, sessions et défis de la génération précédente sont révoqués.
- Accessibilité : focus rendu au contrôle utilisé après chaque mise à jour, titre d’écran focalisé à chaque navigation, annonces `aria-live`.
- Écritures acceptées seulement depuis l’origine STUDIO avec l’en-tête `X-Studio-Request`. CSP stricte, sans script ni style en ligne (`studio/_headers`).

## Construire et essayer

```bash
npm run build:studio      # dist-studio/ : fichiers de studio/ + polices et logo officiels
npm run test:backend      # dont tests/backend/studio.test.mjs (authentificateur logiciel)
```

Configuration dans Cloudflare, saisie par le fondateur, jamais dans le chat :

- `ADMIN_SETUP_CODE` : code d’installation à usage unique ;
- `STUDIO_ORIGIN`, par exemple `https://studio.saylessbrand.fr` ;
- `STUDIO_RP_ID`, par exemple `studio.saylessbrand.fr`.

Les passkeys sont liées au domaine : celles de l’environnement de test ne servent pas en production.

## État réel

Testé : D1 locale et moteur Cloudflare local (`npm run test:backend`, suites `studio`, `studio-screens`, `webauthn`). Recette dans Chrome, en HTTPS, avec un authentificateur Face ID virtuel (`python3 tests/browser/studio_e2e.py`) : inscription, codes, inventaire, commandes, décision sur une vente à vérifier, tous les écrans à 390 et 1 440 px, téléchargement d’une copie chiffrée puis restauration contrôlée ; aucune erreur ni violation CSP.

Non testé : Safari et Face ID sur un vrai iPhone, VoiceOver, notifications reçues sur l’iPhone, domaine réel. Ces essais font partie de la recette de l’environnement de test (`docs/CLOUDFLARE-TEST.md`).
