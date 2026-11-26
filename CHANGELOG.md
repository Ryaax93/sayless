# Journal des modifications

## 2026-11-26 — Claude : mission corrective prioritaire après la contre-revue v1.3 de Work (PR n° 1)

Demandée par le fondateur le 26 novembre. Détail, mesures et correspondance des tests : `docs/AUDIT-V2-CLAUDE.md`, section 12.

- **V13-B1, e-mails clients durables** : intention d’e-mail écrite dans le même lot que la vente, la demande ou l’expédition (`mail_intents`, migration `0007_intentions_cgv.sql`, `backend/src/intents.mjs`), sans donnée personnelle ; reprise par le renvoi du webhook, l’action liée et la tâche planifiée ; jamais de doublon ; alerte au 5e essai. Tests R11 à R14, U10 ; les deux tests `test:review:v13` de Work passent.
- **V13-B2, CGV archivées** : devis et réservation refusés si le texte de la version en vigueur manque à l’archive ou ne correspond plus à son empreinte ; la base refuse aussi une réservation qui cite d’autres CGV que celles en vigueur (`terms_outdated`). Reprise d’une tentative préservée. Tests R15.
- **V13-C1, texte exact des CGV** : route publique en lecture seule `GET /api/terms[/<version>]`, texte brut et empreinte SHA-256 vérifiée ; devis signé avec version et empreinte ; `terms_sha256` vérifié au paiement. Contrat **v1.4** pour Work (`docs/API-CONTRACT.md`). Tests R16.
- **Windows** : cause environnementale (Miniflare 4 épuisait les ports locaux de Windows), corrigée par wrangler 4.168 et Miniflare 5, et par des migrations de test en lots, sans réduire la charge ni les assertions. Commit de dépendances dédié `ee54ed1`. CI Linux et Windows (`.github/workflows/verification.yml`, Node 26 LTS).
- **Offre gratuite Cloudflare** : la tâche planifiée pouvait dépasser les 50 requêtes D1 et 50 appels externes par invocation après l’ouverture d’un drop, et la relecture des ventes 1.0 dans STUDIO aussi. Budget compté par invocation (`backend/src/budget.mjs`) ; travail repris à la minute suivante ; STUDIO relit les ventes 1.0 par lots. Tests R17, R18, U11.
- **Audit npm** : 33 → 27 vulnérabilités (6 élevées corrigées dans les outils Cloudflare) ; les 27 restantes sont dans l’ancien gabarit Next/vinext, rien dans le code déployé. Proposition à Work et répartition des fichiers de dépendances : `docs/DEPENDANCES.md`, `docs/OWNERSHIP.md`.
- **WebAuthn** : `@simplewebauthn/server` **14.1.0** retenue après comparaison sur 46 cas (test W01, ignoré tant que la bibliothèque n’est pas installée) et essai dans workerd sans `nodejs_compat`. Seul écart : la bibliothèque accepte les réponses d’une autre origine, que SAYLESS continue de refuser. Non intégrée avant l’accord de Work et du fondateur (`docs/WEBAUTHN-BIBLIOTHEQUE.md`).
- **Banc d’essai** : aucun appel réseau réel pendant les tests (bloqué et signalé) ; échecs de connexion au moteur local signalés à part.
- **Recette Cloudflare TEST, paiements fermés** : ajoutée à `docs/CLOUDFLARE-TEST.md`, à lancer seulement après accord.
- **Tests sur `claude/integration-v2`** : backend 96/96 (Node 22, Linux) ; inventaire 16/16 ; frontend 15/15 et 13 vérifications commerciales ; `check:cloudflare` compilé (187,53 Kio, 49,26 Kio compressés) ; recette navigateur de STUDIO dans workerd sans erreur ni violation CSP.
- **Non testé** : PC Windows du fondateur (CI Windows en cours), Cloudflare réel, temps de calcul par invocation (10 ms), Stripe en mode test, Resend réel, iPhone réel. Rien n’est déployé ; `main`, `v2`, le domaine, le DNS, Stripe et la boutique publique sont inchangés.

## 2026-11-25 — Work : intégration finale du contrat v1.3 (PR nº 2)

- Contre-revue du SHA Claude `aab5270` : les quatre corrections précédentes sont confirmées par lecture et tests indépendants. Deux nouveaux défauts reproduits, e-mail de confirmation perdu après échec d'outbox et version CGV sans archive ; corrections proposées à Claude dans `docs/REVUE-V1-3-WORK.md`.
- Boutique : CGV versionnées, reprise des tentatives v1.2/v1.3, états terminaux, adresses relais complètes, suivi sécurisé par jeton en mémoire, formulaires contact/retour/rétractation et gestion des réponses incertaines. Aucun backend ou STUDIO concurrent.
- Configuration de build Cloudflare TEST fermée et séparée, headers statiques et limitation des Pages Functions à `/api/*`. Aucun déploiement Cloudflare ni activation Stripe.
- 172 tests réussis, 13 assertions commerciales ; deux nouvelles régressions explicitement en échec dans `test:review:v13`. Compilation statique/Cloudflare réussie. SimpleWebAuthn installé et vérifié isolément sous Node et workerd local, sans modifier les dépendances de Claude.
- Revue visuelle boutique/STUDIO à 390 et 1440 px, devis locaux 79,90 €/83,50 €, captures de recette. Charte et maquette conservées. L'aperçu privé reste fermé, sans stock simulé publié ; les services externes et le vrai iPhone ne sont pas validés.

## 2026-11-25 (midi) — Claude : assistant de l’environnement de test et préparation de l’iPhone (PR n° 1)

Le fondateur valide la préparation de l’environnement de test Cloudflare gratuit et isolé. Il confirme que les codes promo ne sont pas prioritaires pour le DROP 01 et que la purge automatique reste coupée.

- **Assistant** `scripts/test-env.mjs` : une commande crée et vérifie, étape par étape, la base `sayless-test`, l’espace des sauvegardes et le Worker `sayless-ops-test` sur une adresse `*.workers.dev`, puis contrôle la santé en ligne. Il reprend après un arrêt, joint les secrets au premier envoi seulement, ne les affiche jamais et refuse tout secret non prévu. Configuration locale ignorée par Git (`ops/wrangler.test.local.toml`). Aucun domaine, DNS, Stripe réel ni boutique publique. Test T04 contre un Wrangler simulé, avec les contrôles servis par le vrai code du Worker. Configuration produite validée par le vrai Wrangler (`deploy --dry-run`).
- **Procédure** `docs/CLOUDFLARE-TEST.md` réécrite pour Windows (Invite de commandes), du PC vierge à STUDIO sur l’écran d’accueil de l’iPhone.
- **Codes tapés sur l’iPhone** : casse, espaces, tirets et confusions O/0, I/L/1 tolérés pour le code d’installation et les codes de secours ; un code d’installation de moins de 12 caractères utiles n’est jamais accepté. Champs sans majuscule automatique ni correction. Test S09.
- **Secrets** : `CODE-STUDIO.txt` contient le seul code d’installation, pour ne pas ouvrir les autres secrets à l’écran.
- **WebAuthn** : proposition commune à Work, `docs/WEBAUTHN-BIBLIOTHEQUE.md` (`@simplewebauthn/server` 14.0.3, répartition et critères d’acceptation). Rien n’est installé tant que Work et le fondateur n’ont pas validé.
- **Tests** : `npm run test:backend` 86/86 ; `test:frontend` 15/15 et 13 vérifications commerciales ; recette navigateur sans erreur ni violation CSP ; `check:cloudflare` compilé.
- **Non testé** : l’assistant avec un vrai compte Cloudflare et sur Windows. Premier essai réel par le fondateur.

## 2026-11-25 — Claude : corrections de la revue de Work, STUDIO complet, automatisations, environnement de test (PR n° 1)

Corrections demandées par la revue de Work (`docs/REVUE-PR-1-WORK.md`, PR n° 2). Détail et correspondance des tests : `docs/AUDIT-V2-CLAUDE.md`, sections 9 à 12.

- **STUDIO, récupération** : générations de passkeys. Un code de secours révoque, dans la même instruction SQL, passkeys, sessions et défis précédents ; chaque session est liée à une passkey active de la génération courante, garantie par la base. Inscription après récupération réservée à l’appareil qui a saisi le code. Migration `0005_revue_work.sql`. Tests S07, S08.
- **Ventes 1.0** : lien et prix autorisés reconnus explicitement, une ligne, quantité 1, prix catalogue, euro ; instant réel du règlement (charge Stripe) ; ventes proches de l’inventaire ou ambiguës « à vérifier » avec pièce retirée par prudence ; aucun double décompte. Tests R01, R02.
- **Reprise d’un paiement** : tentative retrouvée par sa clé avant l’expiration du devis, même session et même réservation ; tentative close renvoyée avec son état ; balayage qui garde une session retrouvée. Tests R03, R04, R10 ; t11 et t26 adaptés.
- **Sauvegardes** : image en un seul lot D1, contrôlée, relue après écriture (SHA-256), rotation seulement après une copie vérifiée, restauration par lots. Tests R05, R06.
- **Renforcement** : inventaire de tout le produit avant toute réservation ; CGV publiées, versionnées, signées dans le devis (`backend/src/terms.mjs`) ; chiffrement des coordonnées obligatoire et lié à la commande ; zone appliquée à la recherche de relais ; relais figé dans la commande ; Klarna retiré du plan. Tests R07 à R09.
- **WebAuthn** : audit point par point (W3C niveau 3, §7.1 et §7.2) ; lecteur CBOR durci (clés en double), extensions lues, drapeaux de sauvegarde et identifiant d’utilisateur vérifiés. Tests A01 à A03. L’ajout de la bibliothèque `@simplewebauthn/server` a été refusé par l’environnement de travail de Claude : non contourné, décision à prendre avec le fondateur et Work.
- **SAYLESS STUDIO** (`studio/`, `backend/src/studio.mjs`, migration `0006_studio_ecrans.sql`) : tous les écrans de la maquette branchés sur la base (aujourd’hui, commandes, préparation et expédition, stock, inventaire guidé, retours et remboursements, finances, drops, performances, notifications, santé, historique, réglages, demandes), vues iPhone et ordinateur, focus conservé et annonces pour VoiceOver. Codes promo et visites affichés comme non disponibles, sans faux bouton. Tests U01 à U09.
- **Automatisations** (gratuites, actives seulement quand leurs secrets sont saisis) : Discord ; notifications iPhone par Web Push (`backend/src/push.mjs`, RFC 8291, VAPID) ; e-mails clients par Resend (`backend/src/email.mjs` : confirmation, expédition, accusé de réception, lien de suivi) ; rapport de 10 h enrichi ; suivi des commandes ; exports ; copies chiffrées listées et téléchargeables dans STUDIO ; `/health` indique l’état de la tâche planifiée pour une surveillance externe. Routes de suivi, de contact et de rétractation raccordées (`backend/src/requests.mjs`), actives quand l’envoi d’e-mails est configuré. Tests T01 à T03, U07 à U09.
- **Contrat API v1.3** (`docs/API-CONTRACT.md`) : évolutions additives, à valider par Work (version des CGV dans le devis, `attempt_closed` enrichi, adresse stable des relais, suivi et demandes).
- **Environnement de test Cloudflare** : procédure gratuite pas à pas, sans domaine ni DNS (`docs/CLOUDFLARE-TEST.md`) ; section `[env.test]` dans `ops/wrangler.toml` (identifiants à remplacer, aucun secret) ; `scripts/generate-secrets.mjs` (secrets créés sur l’ordinateur du fondateur, hors dépôt) ; `scripts/restore-backup.mjs` (exercice de restauration local).
- **Tests** : `npm run test:backend` 84/84 ; recette navigateur `tests/browser/studio_e2e.py` (Chrome, authentificateur virtuel). Les 3 tests de revue de Work passent sur la branche de vérification.
- **Non testé** : Cloudflare réel, Stripe en mode test réel, Resend, notifications reçues sur un vrai iPhone, Safari, VoiceOver, transporteur. Rien n’est déployé ; `main`, `v2`, le domaine, le DNS, Stripe et la boutique publiée sont inchangés. Purge automatique toujours coupée.
## 2026-11-25 — Work · préparation sur le contrat v1.2

- Revue des trois commits et des 44 fichiers de la PR nº 1. Quatre corrections demandées à Claude, documentées dans [la revue](docs/REVUE-PR-1-WORK.md).
- Raccordement du catalogue, du stock, des relais, du devis signé, de la tentative idempotente et du statut après Stripe. Panier limité à une pièce, destination contrôlée, CGV et vérification anti-abus avant la réservation.
- Paiements fermés par défaut. Aucune quantité théorique affichée. Retrait du prototype de gestion des fichiers servis. Textes de livraison et de confidentialité alignés avec les données du parcours.
- Design, photos, logo et animations conservés. Contrôles du panier et du récapitulatif dans Chrome aux formats mobile et ordinateur.
- 39 tests boutique, 13 assertions commerciales, 16 tests historiques d’inventaire, 57 tests backend/STUDIO et 8 tests croisés locaux. Trois contrôles métier supplémentaires échouent en attendant leurs corrections.
- Passation technique et instructions de test actualisées. Les ressources de production, le backend et STUDIO restent sous la responsabilité de leurs propriétaires.

## 2026-11-24 (nuit) — Claude : SAYLESS STUDIO, connexion Face ID et inventaire guidé (PR n° 1)

- `studio/` : première version de l’application, fidèle à la maquette validée (fond noir, rose pastel, étiquettes de taille, compteurs) et harmonisée avec la charte 2.0 (couleurs, SaylessDisplay, SaylessSans, logo officiel). Installable sur l’écran d’accueil de l’iPhone (manifeste, icônes), CSP stricte (`studio/_headers`).
- Seuls les écrans branchés apparaissent : connexion Face ID, codes de secours, inventaire guidé, sécurité des sessions.
- API `/api/admin/*` dans le Worker `ops/` (`backend/src/admin.mjs`) : inscription par code d’installation à usage unique, passkey vérifiée côté serveur (`backend/src/webauthn.mjs`, sans dépendance), sessions `__Host-` de 7 jours et 12 h d’inactivité, 10 codes de secours en empreinte, confirmation Face ID de moins de 5 minutes pour les actions sensibles, journalisation des refus.
- Inventaire guidé : comptage S/M/L et mises de côté, écart avec les 26 théoriques, enregistrement par le registre de stock, limite Stripe proposée sans être appliquée.
- Migration `0004_studio_auth.sql`. Tests `tests/backend/studio.test.mjs` (6, dont le portage du scénario t28) : `npm run test:backend` = 57/57. Essai local dans le moteur Cloudflare, en HTTPS, avec Chrome et un authentificateur Face ID virtuel : inscription, codes, accueil, inventaire guidé enregistré, déconnexion puis reconnexion ; cookie `__Host-` Secure, HttpOnly, SameSite=Strict. Deux défauts trouvés par cet essai et corrigés (champ effacé avant lecture, écran des codes). **Non testé** : vrai iPhone, domaine réel.
- `npm run build:studio` (`ops/build-studio.mjs`, sortie `dist-studio/` non versionnée) ; `ops/wrangler.toml` sert STUDIO en ressources statiques.

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
