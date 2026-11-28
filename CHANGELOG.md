# Journal des modifications

## 2026-11-28 — Claude : en-tête Topic refusé par Apple, P3-R1a et P3-R1b

Recette réelle du fondateur sur `d05cf65` (TEST déployé, migrations appliquées) : « Envoyer un essai », le 28 novembre à 17 h 28, refusé par Apple avec **400 BadWebPushTopic**. Troisième contre-audit de Work (`402b1ff`) : GO pour la recette TEST, réserve P3-R1. Détail : `docs/NOTIFICATIONS-PUSH.md`, sections 5 et 6 ; `docs/AUDIT-V2-CLAUDE.md`, section 17.

- **Valeur envoyée :** `Topic: push_test` (type du message, 9 caractères). Alphabet et longueur conformes à la RFC 8030, mais aucun texte base64url n'a une longueur 4n + 1 ; `daily_report` (12) avait été accepté à 10 h.
- **Types touchés :** sur 30 types envoyés aux appareils, 8 étaient refusés à coup sûr (`technical`, `backup_failed`, `low_stock`…), 14 dépendaient de la tolérance d'Apple aux bits de remplissage, 8 étaient décodables. Le message du commit `9f35e0c` annonçait à tort douze types : ce compte incluait des types qui ne partent jamais vers l'iPhone.
- **Correction :** plus aucun en-tête Topic, pour l'essai comme pour les envois automatiques. Il est facultatif, et il faisait remplacer une notification non remise par la suivante du même type. Les en-têtes sont réunis dans `pushHeaders`. Clés, abonnements, Face ID, secrets et données inchangés.
- **P3-R1a et P3-R1b :**
  - les identités de tentative d'appareil (`deviceAttempts`) sont propagées, en remise comme en échec ;
  - rétablissement, mise en panne, résolution et création d'incident (condition `when` du notificateur) ne s'appliquent que si l'une de ces tentatives est encore la dernière de son appareil, vérifié par la base dans le même lot ;
  - chaque message garde son vrai résultat.
- **Tests :**
  - P3-R1a, P3-R1b et P3-A1 à P3-A3 de Work passent, sans modification de ses fichiers ;
  - troisième contre-audit obligatoire en CI (`test:review:push3`) ;
  - N05 exige l'absence de Topic : il ne contrôlait que l'alphabet et la longueur, et laissait passer `push_test` ;
  - N27 : service Apple simulé strict, essai manuel et trente types acceptés sans Topic ;
  - N28 à N30 : deux appareils, deux essais manuels, incident d'une panne déjà finie.
- **Documentation :** portée du cache du jeton VAPID précisée ; restauration et redéploiement distingués.
- **Non testé :** réception réelle sur l'iPhone avec cette correction ; la règle exacte d'Apple pour Topic n'est pas documentée par Apple.
- Aucun déploiement ni fusion. Rien sur `main`, `v2`, le DNS, la boutique publique ou Stripe réel.

## 2026-11-28 — Work : troisième contre-audit push d05cf65

- Signature native Web Crypto et coordination D1 vérifiées indépendamment, y compris sans le repli de base du banc, concurrence, perte de réponse et reprise froide. Aucun ancien test de Work modifié.
- 297 tests existants et 13 contrôles commerciaux réussis ; trois nouveaux contrôles d'intégrité réussis. Deux nouveaux tests rouges reproduisent un même défaut résiduel P3-R1 : un résultat ancien peut encore modifier la santé du canal, malgré la protection correcte de l'appareil.
- Migration 0011, sauvegarde chiffrée, restauration, sessions et passkeys vérifiées localement ; aucun accès Face ID physique ou service distant certifié. Audits npm 0/0 ; compilations réussies ; budgets par invocation vérifiés localement, CPU hébergé à mesurer.
- Verdict : GO pour redéploiement et recette Cloudflare TEST surveillée, réserve explicite P3-R1 avant validation complète des diagnostics. Rapport et corrections attendues dans `docs/CONTRE-AUDIT-PUSH-3-WORK.md` ; preuves dans `docs/qa/push-review-3/`.
- Livraison limitée aux tests et à la documentation : aucun runtime, dépendance, déploiement, fusion, main/v2, domaine, paiement réel ou boutique publique modifié.

## 2026-11-28 — Claude : corrections du second contre-audit push de Work (P2-R1 à P2-R4)

Demandées par le fondateur le 28 novembre à 12 h 21, après le refus de Work (NO GO) sur `56d960b`. Détail : `docs/NOTIFICATIONS-PUSH.md`, section 4 ; `docs/AUDIT-V2-CLAUDE.md`, section 16.

- **P2-R1, jeton VAPID :**
  - signature ES256 native de Web Crypto ; module de signature maison `es256.mjs` supprimé, plus aucun calcul sur une clé secrète dans le code ;
  - jeton partagé par D1 (table `vapid_tokens`, migration additive `0011_jeton_vapid_tentatives.sql`) : réutilisé 6 h depuis sa première émission, valable 12 h ;
  - rotation atomique (condition vérifiée par la base à l'écriture, relecture dans le même lot), relue dix minutes avant l'échéance pour les horloges en retard ;
  - base injoignable ou absente : aucun jeton, l'envoi attend ; jamais affiché, journalisé ni sauvegardé.
- **P2-R2, Discord :** un webhook remplacé ou retiré de la configuration est marqué retiré (historique, journal, alerte résolue) ; l'état du canal ne compte que les destinations actives ; jamais retiré s'il sert encore ; de nouveau actif s'il revient.
- **P2-R3, inscription :** admission conditionnelle et atomique (un seul lot : inscription, remplacement, journal, relecture) ; réponse fondée sur la ligne effective.
- **P2-R4, tentatives :** numéro de tentative réservé sur l'appareil avant l'appel ; résultat, état de l'appareil et rétablissement du canal liés à cette tentative ; réponse tardive notée dans l'historique et signalée comme dépassée.
- **Budget gratuit :** coûts du jeton, des tentatives et du retrait Discord ajoutés (`budget.mjs`) ; message push vers deux appareils, jeton créé : 9 requêtes D1 pour 15 prévues (N24).
- **Tests :**
  - les quatre critères P2-R1 à P2-R4 et les six contrôles P2-A1 à P2-A6 de Work passent, sans modification de ses fichiers ;
  - second contre-audit de Work obligatoire en CI Linux et Windows (`test:review:push2`) ;
  - N11 et N12 réécrits ; N17 à N26 ajoutés (panne de base, réponse perdue, horloges décalées, webhook partagé, Santé, inscriptions simultanées, même seconde, deux clients, tâche planifiée, budget, migration 0011, vrai Wrangler local) ;
  - banc commun : une base D1 locale est fournie aux appels directs du jeton sans liaison `DB` ; sans aucune base, refus testé.
- **Non testé :** Apple et Discord réels ; mise à jour sur le compte Cloudflare du fondateur ; réception sur son iPhone ; temps de calcul et requêtes réels sur Cloudflare ; transport D1 sur le PC du fondateur.
- Aucun déploiement ni fusion. Rien sur `main`, `v2`, le DNS, la boutique publique ou Stripe réel.

## 2026-11-28 — Work : second contre-audit push 56d960b

- Cinq anciennes anomalies corrigées dans les scénarios initiaux : six anciens critères devenus verts, assertions inchangées. Cascade Apple/Discord simultanément en échec non reproduite.
- 277 tests existants et 13 contrôles commerciaux réussis ; six nouveaux contrôles d’intégrité, réception et migrations réussis. Quatre nouveaux critères rouges : frontière horaire VAPID, remplacement d’un webhook Discord, expiration concurrente d’abonnement, réponses Apple arrivant dans le désordre.
- Cryptographie comparée à `@noble/curves@2.3.0` dans une installation isolée : 52 signatures concordantes, huit cas workerd, calcul secret variable observé. Aucune extraction de clé démontrée ; recommandation de remplacer l’arithmétique maison, sans modification du runtime ni des dépendances SAYLESS.
- Migrations 0009/0010, sauvegarde/restauration et conservation d’accès vérifiées localement. Audits npm 0/0, compilations réussies. Réception physique iPhone, CPU Cloudflare et ancienne erreur du PC Windows non certifiés.
- Verdict NO GO TEST en l’état ; preuves, limites et corrections attendues dans `docs/CONTRE-AUDIT-PUSH-2-WORK.md`. Aucun déploiement, fusion ou changement de main/v2/boutique publique.

## 2026-11-28 — Claude : corrections du contre-audit push de Work (R1 à R5)

Demandées par le fondateur le 28 novembre à 1 h 03, après le refus de Work (NO GO) sur `be0bb9b`. Détail : `docs/NOTIFICATIONS-PUSH.md`, sections 3 et 4 ; `docs/AUDIT-V2-CLAUDE.md`, section 15.

- **R1, jeton VAPID :** signature ES256 déterministe (RFC 6979) sur l'heure en cours. Toutes les instances du Worker, à froid ou en parallèle, produisent le même jeton, sans stockage ni requête D1. Il change une fois par heure ou si la configuration change. Chaque jeton est vérifié par la clé publique avant usage.
- **R2, clôture :** sélection, prise de l'envoi et écriture du résultat exigent la même tentative et une ligne non clôturée. Une réponse tardive est seulement notée, sans rouvrir ni relancer l'envoi ni rétablir le canal. Clôture et historique sont écrits dans le même lot.
- **R3, « Activer » :** un abonnement que le serveur ne confirme pas actif est remplacé (désabonnement puis nouvel abonnement). Un abonnement déclaré expiré n'est jamais réactivé ; l'ancien est gardé, marqué « remplacé ». Aucun « activé » en cas d'échec.
- **R4, Discord :** santé par destination effective. Migration additive `0010_destinations_reception.sql` ; empreinte non secrète du webhook ; un webhook partagé = un incident. L'état par canal reste un agrégat.
- **R5, Santé :** état par iPhone (jamais vérifié, refusé, accepté, reçu). « OK » seulement après la réception constatée par le service worker de l'iPhone. Un essai refusé passe Santé en alerte, sans alerte en chaîne.
- **Transport D1 local (Windows, `fetch failed ×123`) :** aucun réessai ajouté. Cause la plus profonde comptée ; journal technique sans donnée dans `.journaux-tests/` (ignoré par Git).
- **Diagnostic :** `node scripts/test-env.mjs diagnostic` montre aussi, après 0010, les destinations en échec et la dernière réception constatée.
- **Tests :**
  - les six critères de Work (R1a, R1b, R2 à R5) passent, sans aucune modification de ses fichiers ;
  - N11 à N16 ajoutés ; N06, N08 et T04 étendus ;
  - N11 rendu portable après un premier refus de la CI Windows sur `ed3d8fa` : le chemin du dépôt était donné à esbuild sous forme d'adresse (`/D:/…`) ; assertions inchangées ;
  - CI : contre-audit de Work (`test:review:push`) et test D1 strict (`test:review:d1`) désormais obligatoires sous Linux et Windows.
- **Non testé :**
  - Apple et Discord réels, simulés dans les tests ;
  - la mise à jour sur le compte Cloudflare du fondateur et la réception sur son iPhone ;
  - le temps de calcul réel sur Cloudflare ;
  - le transport D1 sur le PC du fondateur.
- Aucun déploiement ni fusion. Rien sur `main`, `v2`, le DNS, la boutique publique ou Stripe réel.

## 2026-11-28 — Work : contre-audit du correctif push be0bb9b

- Relecture indépendante du correctif, des diagnostics réels et des tests Windows. Cascade autonome d'alertes non reproduite après correction, y compris Apple et Discord en panne ensemble ; migration 0009 additive, conservation des données et sauvegarde/restauration vérifiées localement.
- 230 tests principaux, 13 contrôles commerciaux et 25 tests WebAuthn rejoués : réussis. Audits npm complet/production : 0/0. Compilations boutique, TEST, STUDIO, Worker dry-run et Pages : réussies.
- Dix contrôles Work complémentaires réussis ; six critères en échec reproduisent cinq anomalies : cache VAPID entre isolates/concurrence, clôture pendant un envoi, réactivation d'un abonnement expiré, santé Discord avec plusieurs salons, diagnostic après essai manuel.
- NO GO pour redéployer cette version comme correctif complet ; preuves et propositions pour Claude dans `docs/CONTRE-AUDIT-PUSH-WORK.md` et `tests/review/push-*.mjs`. Test D1 renforcé : 300 clients, 130 réponses webhook vérifiées, aucune erreur locale observée.
- Aucun code backend/STUDIO/dépendance modifié, aucune fusion ni intervention sur Cloudflare, main, v2, le domaine, la boutique publiée ou Stripe réel.

## 2026-11-27 (soir) — Claude : correctif urgent des notifications push (essai réel sur Cloudflare TEST)

Demandé par le fondateur à 22 h 39 : 28 messages non distribués et deux alertes Discord toutes les 31 minutes. Détail : `docs/NOTIFICATIONS-PUSH.md`.

- **Boucle reproduite puis supprimée.** Sur `9748ccc`, un message abandonné déclenchait une alerte renvoyée par le même canal, abandonnée 31 minutes plus tard, et ainsi de suite : 30 alertes en 8 h simulées. Désormais :
  - une panne de canal ouvre un incident (table `channel_health`) avec une alerte, puis au plus un rappel par jour ;
  - l'alerte ne part jamais par le canal en panne ;
  - une alerte qui échoue n'en crée aucune autre, y compris si Discord et l'iPhone tombent ensemble ;
  - les alertes de l'ancienne boucle en file meurent en silence ;
  - premier envoi accepté : canal rétabli, alerte résolue.
- **Réessais :** refus à corriger (clé VAPID, en-tête, webhook Discord supprimé) abandonné sans réessais ; pannes passagères réessayées (Retry-After respecté).
- **Aucun appareil abonné :** rien n'est mis en file pour l'iPhone, sans échec ni alerte. Un abonnement expiré (404, 410) ou créé avec une autre clé (VapidPkHashMismatch) n'est plus supprimé en silence : il est marqué, n'est plus utilisé, et une seule notice part par Discord.
- **Diagnostic sans secret ni donnée personnelle :**
  - codes courts (`apple_403_BadJwtToken`…) avec explication en français ;
  - appareils sous empreinte, contrôle de la paire de clés VAPID dans le Worker ;
  - état des canaux et envois échoués groupés dans Santé du site ;
  - commande `node scripts/test-env.mjs diagnostic`, en lecture seule.
- **Exigences d'Apple :** jeton VAPID gardé 6 h et valable 12 h (Apple demande au plus un renouvellement par heure) ; abonnement à une ancienne clé remplacé par STUDIO.
- **STUDIO :** essai de notification depuis l'iPhone (réponse d'Apple expliquée, 6 essais par 10 min, journalisé) ; clôture des envois échoués sous Face ID (Discord et iPhone seulement, jamais un e-mail client, historique conservé, journalisée).
- **Migration `0009_notifications_fiables.sql`**, seulement additive : une table, six colonnes, rien d'effacé ni de modifié.
- **Assistant TEST :** point de restauration de la base (Time Travel) noté avant les migrations ; mise à jour sans régénérer ni renvoyer les secrets.
- **Tests :** N01 à N10 ajoutés (`tests/backend/notifications-push.test.mjs`) ; T04 complété ; t20, U06 et U07 adaptés au nouveau comportement ; recette navigateur étendue (clés contrôlées dans workerd, clôture sous Face ID).
- **Non testé :** Apple et Discord réels (simulés dans les tests), mise à jour sur le compte Cloudflare du fondateur, essai sur son iPhone.

## 2026-11-27 — Claude : stabilisation finale avant Cloudflare TEST (livraison v1.4 de Work)

Demandée par le fondateur le 27 novembre. Détail : `docs/AUDIT-V2-CLAUDE.md`, section 13.

- **Intégration** : branche commune avancée sur Work `ea66e60` (sans `main` ni `v2`). Retrait du gabarit relu, sans import cassé ; audit npm complet et production à 0.
- **V14-R1** : file d'envoi recréée (migration `0008_envois_rapprochement.sql`). Pour chaque e-mail : premier essai enregistré avant l'appel, enveloppe figée, référence Resend gardée. Reprise automatique seulement pendant 23 h (Resend garde sa clé 24 h), puis état « à vérifier » avec alerte et rapprochement dans STUDIO, confirmé par Face ID. Sauvegarde restaurée datée prudemment. Le test de risque de Work passe ; régressions R19 à R21 et U12.
- **API v1.5** : `terms_sha256` obligatoire pour toute nouvelle tentative de paiement (400 si absente ou mal formée, 409 si différente, rien d'écrit). Reprise des tentatives v1.4 préservée. R22 ; contrat mis à jour.
- **Assistant TEST** : jamais de succès annoncé si le contrôle final échoue (code 1). Accord « OUI » avant tout déploiement ; Worker non isolé refusé ; paiements fermés affichés. `/health` expose `environment` et `payments`. T04 complété, T05.
- **Discord** : un salon par type d'événement, webhook unique en secours, Retry-After respecté, aucune donnée client. `docs/DISCORD.md` (interface Discord et PowerShell). T06.
- **Face ID** : `@simplewebauthn/server` 14.1.0 en version exacte (commit de dépendance dédié `8253fe3`). Vérification supplémentaire prête et **désactivée** (`WEBAUTHN_ENGINE`) jusqu'à la validation du fondateur. 25 tests rejoués avec la bibliothèque, recette navigateur dans workerd sans `nodejs_compat`.
- **CI** : régressions v1.4 et V14-R1 obligatoires, Face ID avec bibliothèque, builds boutique ordinaire et TEST, contrôle des limites gratuites (`scripts/check-free-plan.mjs`), audits bloquants.
- **Procédure** : `docs/PROCEDURE-TEST-IPHONE.md` (PowerShell : vérifier, déployer Cloudflare TEST, installer STUDIO sur l'iPhone).
- **Non testé** : Cloudflare réel, Face ID réel sur iPhone, CPU hébergé (10 ms), Discord et Resend réels, Stripe en mode test. Boxtal non opérationnel. Stock déclaré (S8/M14/L5) jamais chargé automatiquement.

## 2026-11-27 — Work : stabilisation API v1.4, sans déploiement

Base de vérification `f633255` contenant Claude `7102f43`. PR nº 2 conservée en brouillon ; main/v2 et boutique publique intacts.

- CGV exactes depuis `/api/terms[/version]` : SHA-256 Web Crypto, comparaison document/devis, rendu texte sans injection, relecture avant réservation, consentement renouvelé après changement et contrôle final du consentement avant envoi.
- Reprise des tentatives précédentes conservant version, hash éventuel, clé et fingerprint ; aucune nouvelle tentative sur document invalide ou service indisponible.
- Nettoyage convenu avec Claude : gabarit Next/Vinext, connecteurs et ancien backend inutilisés retirés ; 16 tests historiques conservés dans des fixtures isolées. Manifeste et verrou régénérés dans un commit dédié. npm audit complet **27 → 0**, hors développement **5 → 0**, sans déplacement artificiel de dépendances.
- Générateur local de configuration Pages TEST sans secrets et sans déploiement ; procédure PowerShell détaillée, build fermé par défaut.
- 211 tests Node et 13 contrôles commerciaux réussis ; compilations boutique, TEST, STUDIO, Worker dry-run et Pages Functions réussies. Nouvelle régression V14-R1 encore rouge : doublon Resend après réponse perdue et reprise >24 h. Critère et correction proposés à Claude, aucun backend concurrent.
- Captures de recette mobile/ordinateur, design et STUDIO conservés. Inventaire déclaré S8/M14/L5 documenté sans activation. SimpleWebAuthn 14.1.0 essayé isolément, bascule soumise au fondateur.
- Contre-audit, passation, état, responsabilités et guide de tests actualisés. Les affirmations historiques « jamais de doublon » ci-dessous sont limitées par V14-R1 ; voir `docs/REVUE-V1-4-WORK.md`.

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
