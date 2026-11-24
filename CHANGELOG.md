# Journal des modifications

## 2026-11-24 (soir) — Claude : décisions du fondateur intégrées (PR n° 1)

- Zones : France métropolitaine hors Corse ; Monaco et outre-mer refusés avant paiement ; adresse hors zone saisie sur Stripe → commande « à vérifier » sans envoi ni remboursement automatique. Constats Corse/Monaco et sources : `docs/DONNEES-ET-SAUVEGARDES.md`.
- Coordonnées sur Stripe : session à option de livraison unique (celle choisie sur SAYLESS), montant identique au récapitulatif, nom du destinataire demandé pour un relais, message de zone pour le domicile.
- Stock public minimisé (contrat v1.2) : `state` et `orderable` par taille, `total_available` exact pour le drop ; `available` devient un alias transitoire, compatible avec le client actuel.
- Conservation : proposition de durées (90 jours actives, archive jusqu’à 913 jours, comptabilité 10 ans, traces d’accès 1 an) et module `retention.mjs`, coupé tant que le fondateur ne l’a pas validé.
- Sauvegardes : copie quotidienne gzip + AES-256-GCM, clé enveloppée par la clé publique RSA du fondateur, rotation 30 + 12 dans Workers KV (gratuit), restauration testée ; aucune donnée dans GitHub.
- Tests : `tests/backend/decisions.test.mjs` (6 tests). `npm run test:backend` : 51/51 + 1 à porter avec Face ID. Compilation Cloudflare vérifiée.

## 2026-11-24 — Claude : audit de v2, contrat v1.1 et backend unique (branche `claude/integration-v2`)

- Audit complet de v2 (code et documentation) : `docs/AUDIT-V2-CLAUDE.md`. Plan commun et raccordements attendus de Work : `docs/INTEGRATION-PLAN.md`.
- Contrat API v1.1 proposé dans `docs/API-CONTRACT.md` : devis sans donnée personnelle, une pièce par commande à valider, `POST /api/checkout/status`, nouveaux codes d’erreur, message de pause validé. À valider par Work et le fondateur.
- Nouveau backend unique `backend/` : migrations D1 (registre de stock en ajout seul, transitions gardées, aucune quantité réelle), devis signé, checkout idempotent, webhooks Stripe relus chez Stripe, balayage, filet de sécurité du lien 1.0, import des ventes passées, notifications sans donnée personnelle, Discord, rapport de 10 h, étiquettes, suivi relais, retours, livre des recettes, coordonnées chiffrées et purgeables, sauvegarde et restauration.
- `functions/api/[[path]].js` (API de la boutique, même origine) et `ops/` (Worker : webhooks, tâche de chaque minute). `ops/wrangler.toml` ne contient ni secret ni identifiant réel.
- Tests `npm run test:backend` : 45/45 sur D1 locale (28 scénarios de Claude portés, 13 tests de parité avec Work, 4 tests de contrat dont le vrai `api-client.js` contre le vrai serveur) ; 1 scénario à porter avec Face ID (phase B). Tests existants de Work inchangés : 15/15 et 16/16.
- Vérifié : compilation du Worker et des Functions (`npm run check:cloudflare`) ; essai local dans le moteur Cloudflare (stock, devis, refus, tâche planifiée, rapport). **Non vérifié** : Cloudflare réel, Stripe en mode test réel, transporteur, Discord réel, e-mails, iPhone.
- `package.json` : scripts `test:backend` et `check:cloudflare` (aucune dépendance ajoutée). `.gitignore` : états `.wrangler/` des sous-dossiers. `docs/OWNERSHIP.md` : ligne `backend/`.
- Aucun déploiement ; `main`, le domaine, Stripe et le site publié sont inchangés. `server/`, `drizzle/` et `admin.js` restent en place jusqu’à validation de leur retrait.

## 2026-11-24 — dépôt GitHub v2 et préparation du relais à Claude

- Copie indépendante des 70 fichiers suivis de l’aperçu v4, source `e271bd63ee1ca9d806a921511fbc12900de4c14f`. Logo, photographies, polices, CSS, pages, démo, prototype et tests conservés ; aucun changement du site publié.
- Ajout d’un lancement et build statiques portables via Node. Toutes les API y répondent 503, sans inventaire factice ni paiement. Identifiant de projet retiré du manifeste de la copie ; aucun secret/local state exporté.
- Catalogue éditorial JSON sans stock : rose pastel, S/M/L, 350 GSM, 80/20, YKK, capuche doublée et prix approuvé ; inconnues laissées nulles.
- Rapport actualisé lu intégralement (693 lignes) ; différences de direction artistique 1.0/2.0, passkeys proposées et contrôle Turnstile documentés. Aucun compte ni service supplémentaire activé.
- Frontière API proposée : catalogue, stock, devis, checkout désactivé par défaut, relais, commandes et demandes. Contrat et divergences à valider avec Claude documentés.
- Stock frontend : retrait du total déclaré comme disponibilité certaine ; uniquement données vérifiées, fraîches et complètes. Panne, réservation, rupture d’une taille et véritable SOLD OUT distingués. Aucune quantité par taille affichée.
- Ajout du message de fin de drop approuvé, masqué jusqu’à confirmation serveur. Compte Instagram aligné sur `@sayless.brand` fourni dans le dernier brief.
- Fiche produit complétée avec les caractéristiques officiellement fournies. Design, logo, animation continue, guide et textes légaux validés préservés ; aucun post-it réintroduit.
- Documentation commune : architecture, responsabilités, API, design, statut, blocages, tests, consignes à Claude, provenance et liste des fichiers.
- Ajout de la licence Apache complète pour les polices ; mise à jour des informations restant à fournir.
- Tests frontend de sécurité et de dégradation ajoutés ; backend et migrations hérités inchangés et transmis à Claude.
- Aucun changement de main, domaine, réglage Stripe ou déploiement ; aucun nouvel admin ni backend commercial concurrent.

## 2026-11-22 — historique de l’aperçu v4

Post-it retiré ; barre rose avec logo et total déclaré ; rose unisexe et conseil S ; retours adaptés (14 jours pour déclarer puis 14 pour renvoyer) ; blocs administratifs provisoires retirés visuellement à la demande du fondateur ; références à la plateforme retirées du contenu client. Les informations obligatoires restent à compléter avant vente.

## 2026-11-21 — historique du prototype

Mise en page boutique, pages secondaires, panier et checkout démo ; prototype D1 et Stripe exclusivement test, administration expérimentale liée à l’hébergeur ; atomicité, idempotence et tests locaux. Aucun raccordement réel aux paiements ou transporteurs.
