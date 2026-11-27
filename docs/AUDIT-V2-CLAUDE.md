# Audit de SAYLESS 2.0 et intégration du backend — Claude

**Base auditée : branche `v2`, commit `3dc079b95e0bb7ef42124c0b39936eb5e84a5419` (24 novembre 2026). Mise à jour du 25 novembre : revue de Work (PR n° 2, commit `6832ccd`) traitée, sections 9 à 12.**
Travail livré sur `claude/integration-v2`. Rien n’est déployé ; `main`, `v2`, le domaine, Stripe et le site publié sont inchangés.

## 1. En bref

- La boutique de Work est saine et prête à être raccordée : client API strict (stock vérifié et frais de moins de 30 s, aucun prix envoyé par le navigateur, redirection limitée à `checkout.stripe.com`), états de stock distincts, message SOLD OUT conditionné à une confirmation serveur.
- Le backend hérité (`server/`, `drizzle/`, `public/store/admin.js`) contient de bonnes protections, mais il est incompatible avec la cible : total de 26 imposé, administration liée aux en-têtes de l’hébergeur de l’aperçu, environnement mêlé dans une colonne `scope`, runtime Vinext, et il lui manque le balayage, les alertes, le registre immuable, le lien 1.0, etc.
- Résultat : **un seul backend** (`backend/`), **une seule source de vérité du stock** (registre en ajout seul), **une seule gestion des commandes**. Les protections de Work et les 29 scénarios de Claude y sont repris et testés.
- 25 novembre : les quatre défauts confirmés par Work sont corrigés, ses trois tests de revue passent, chaque correction a son test de régression (section 9). STUDIO couvre tous les écrans de la maquette avec des données réelles de la base ; les automatisations gratuites sont raccordées et testées en local (section 11).

## 2. Ce qui a réellement été vérifié

| Vérification | Résultat | Limite |
| --- | --- | --- |
| `npm ci` puis tests existants de Work | 15/15 frontend (+ 13 assertions) et 16/16 hérités | Node 22, D1 locale |
| Nouveaux tests `npm run test:backend` | 45/45 : 28 scénarios portés, 13 tests de parité avec Work, 4 tests de contrat ; 1 scénario à porter (Face ID, phase B) | D1 locale (Miniflare). Stripe, transporteur, relais et Discord **simulés** |
| Contrat avec le vrai client de la boutique | `public/store/api-client.js` exécuté contre le vrai serveur : stock (disponible, réservé, SOLD OUT, inconnu), devis, checkout idempotent, refus d’un devis modifié | Aucun navigateur réel |
| Compilation Cloudflare (`npm run check:cloudflare`) | Worker `ops/` (41,6 Kio, 12,2 Kio compressé) et Pages Functions compilés | Aucun envoi vers Cloudflare |
| Essai local dans le moteur Cloudflare (workerd, `wrangler dev` / `pages dev`) | Migrations appliquées par wrangler ; `/api/stock`, devis signé, refus de 2 pièces, relais non raccordé, paiement fermé, origine étrangère refusée, tâche planifiée et rapport de 10 h | Base locale jetable, quantités de test |
| Non vérifié | Cloudflare réel, Stripe en mode test réel, transporteur, Discord réel, e-mails, iPhone | Phase F |

## 3. Inventaire de la v2 et décision

| Élément | Responsable | Constat | Décision |
| --- | --- | --- | --- |
| `public/store/` (hors `admin.js`) | Work | Design, textes et parcours validés | Conserver ; raccorder selon `INTEGRATION-PLAN.md` |
| `public/store/api-client.js` | Work | Contrat v1 strict et bien testé | Conserver ; ajustements v1.1 mineurs |
| `public/store/admin.js` + route `#/gestion` | Claude | Ancienne administration dans la boutique | Retirer quand STUDIO la remplace (route à supprimer par Work) |
| `data/products.json` | Commun | Prix 7500, SKU S/M/L, livraison 490/850 | Source éditoriale. D1 fait foi pour le montant payable ; un test garde les deux identiques |
| `server/`, `db/`, `drizzle/` | Claude | Prototype hérité | Remplacés par `backend/` ; retrait dans une PR séparée après validation (l’historique reste dans Git) |
| `app/`, `worker/index.ts`, `lib/connector-*`, dépendances Next/React/Vinext, scripts `*:legacy` | Commun | Échafaudage de l’outil de création | Inutiles pour la cible ; retrait proposé à Work |
| `tests/inventory.test.mjs` | Claude | 16 tests du prototype | Conservés tant que `server/` existe ; intentions portées (W01–W16) |

## 4. Incompatibilités et résolution

| # | Incompatibilité | Risque | Résolution dans `backend/` |
| --- | --- | --- | --- |
| 1 | Total initial imposé (`initial_total_must_be_26`) | Inventaire réel impossible s’il diffère de 26 | Inventaire guidé par taille, sans total imposé ; écart avec 26 noté (W01) |
| 2 | Administration par en-têtes `oai-authenticated-user-*` | Absents sur Cloudflare | STUDIO sur son origine, passkey Face ID et sessions révocables (phase B) |
| 3 | Colonne `scope` real/test dans une même base | Mélange test/réel | Bases D1 séparées ; clé Stripe acceptée seulement si elle correspond à l’environnement (W16) |
| 4 | `/api/inventory` et variantes UUID | Deux contrats | Seul `/api/stock` (contrat de Work), SKU partout |
| 5 | Runtime Vinext/Next | Deux serveurs | Boutique statique + `functions/` ; `ops/` pour webhooks et tâches |
| 6 | Prix 7500 codé en dur dans la session Stripe | Divergence de prix | Prix relu dans D1 à chaque devis et checkout (`price_changed`) |
| 7 | Coordonnées client dans le devis (`customer_token`) | Données personnelles stockées avant paiement | Devis signé sans donnée personnelle ; Stripe collecte e-mail, nom, téléphone et adresse |
| 8 | Moyens de paiement par défaut du compte (Klarna actif, Google Pay coupé) | Klarna proposé malgré la décision | `payment_method_types[card]` dans chaque session : carte et portefeuilles, sans modifier le compte Stripe |
| 9 | Retour Stripe vers `/#/gestion` | Pas de confirmation client | `/merci?ref=…&session_id=…`, endpoint de statut, `/commande-annulee` |
| 10 | Pas de balayage, d’alertes, de registre immuable, de limites d’abus, de Turnstile serveur, de suivi relais, d’import, d’export ni de purge | Trous fonctionnels | Ajoutés et testés |
| 11 | `miniflare` utilisé sans être déclaré (dépendance de wrangler) | Casse possible à une mise à jour | Proposition commune : le déclarer en devDependency |
| 12 | Lecture du stock toutes les 20 s | Chaque lecture compte dans les 100 000 requêtes/jour gratuites ; au-delà, le stock devient « indisponible » et les ventes se bloquent (sans survente) | Lire seulement écran visible et vues d’achat, s’arrêter après 10 min d’inactivité ; surveiller le quota |

## 5. Doublons supprimés

| Sujet | Avant | Après |
| --- | --- | --- |
| Stock | `variants.available/reserved` du prototype et modèle de la preuve de concept | Table `inventory` modifiée uniquement par le registre `stock_movements` |
| Commandes | Deux schémas | Une table `orders` multi-lignes, réservations par ligne |
| Administration | `admin.js` dans la boutique et STUDIO | STUDIO seul, sur une origine séparée |
| Migrations | drizzle-kit et SQL de démonstration | `backend/migrations` (migrations D1 de wrangler) |
| Prix | Constantes, JSON et session Stripe | D1 pour le montant payable ; JSON éditorial ; test de cohérence (C03) |
| Identifiants | UUID seul | UUID interne, numéro séquentiel attribué au paiement (0001…), référence publique aléatoire `SL-XXXX-XXXX` |

## 6. Repris de Work et apporté par Claude

**Repris de Work** : lignes multiples ; empreinte d’idempotence (conflit si le contenu change) ; signature vérifiée sur le corps brut avec plusieurs `v1` et 300 s de tolérance ; relecture de la session avec ses lignes ; contrôle du montant, de la devise et des lignes ; compare-and-swap sur la révision ; « expirer puis relire » ; paiement après libération mis à l’examen ; remboursement sans remise en stock ; tests Miniflare.

**Apporté par Claude** : registre immuable et déclencheurs ; transitions gardées par la base ; SOLD OUT uniquement quand toutes les pièces sont vendues (une réservation n’est jamais une rupture) ; libération seulement après confirmation par Stripe ; session retrouvée par sa clé après une réponse perdue ; balayage chaque minute ; filet de sécurité pour le lien 1.0 ; import des ventes passées sans double décompte ; notifications sans donnée personnelle ; file Discord ; rapport de 10 h (heure de Paris) ; étiquettes sans double achat ; suivi relais « disponible » distinct de « retiré » ; retours contrôlés ; livre des recettes ; coordonnées chiffrées et purgeables ; sauvegarde et restauration testées ; Turnstile vérifié côté serveur ; limites d’abus.

## 7. Correspondance des tests (aucune couverture perdue)

| Origine | Nouveau test |
| --- | --- |
| Scénarios Claude t01–t27, t29 | `tests/backend/scenarios.test.mjs`, même numéro |
| t28 Face ID, sessions, codes de secours | `tests/backend/studio.test.mjs`, S01 à S04 (authentificateur logiciel, signatures réelles) |
| Work 1, 2, 3, 4, 5, 7, 9, 10, 11, 13, 14, 15, 16 | `tests/backend/parity.test.mjs`, W01–W16 |
| Work 6 (doublons et désordre) | t02, t07 |
| Work 8 (abandon, échec, différé) | t03, t06 |
| Work 12 (annulation et paiement concurrent) | t05 |
| Work 15, volet administration | S05 (origine STUDIO, en-tête obligatoire, 401 sans session) ; volet boutique : W15 |
| Contrat boutique ↔ serveur | C01–C04 |

## 8. Décisions du fondateur (24 novembre 2026)

| Sujet | Décision | Application |
| --- | --- | --- |
| Pièces par commande | Une seule pour le DROP 01, architecture multi-articles conservée | `max_items_per_order = 1` |
| Coordonnées | Saisies sur Stripe, livraison et vrai point relais choisis sur SAYLESS, montant exact au récapitulatif | Session Stripe à option unique, nom du destinataire pour un relais |
| Zones | France métropolitaine ; Corse et Monaco après vérification ; pas d’outre-mer | Contrôle avant et après paiement (`DONNEES-ET-SAUVEGARDES.md`) |
| Transporteur | Choisi après l’inventaire et la pesée | En attente |
| Conservation | Durées proposées selon les obligations légales | Proposition à valider ; purge coupée par défaut |
| Stock par taille | Minimisation des données publiques | États et quantité commandable seulement ; total exact du drop |
| Sauvegardes | Chiffrées, restaurables, hors base principale, sans abonnement, rien dans GitHub | KV gratuit + copie hebdomadaire hors Cloudflare, clé privée chez le fondateur |

## 9. Revue de Work (PR n° 2) : corrections du 25 novembre 2026

Revue : `docs/REVUE-PR-1-WORK.md` et `docs/HANDOFF-CLAUDE.md` (branche de Work). Les trois tests de Work (`npm run test:review`) échouaient sur le commit revu ; ils passent sur la branche de vérification qui réunit les deux travaux.

| Défaut confirmé par Work | Correction | Preuve |
| --- | --- | --- |
| STUDIO : une session de l’ancienne passkey restait valable après récupération | Générations de passkeys. Le code de secours, dans la **même instruction SQL** (déclencheur `studio_recovery_used`), passe à la génération suivante, révoque passkeys, sessions et défis précédents. Toute session est liée à une passkey active de la génération courante, vérifiée à chaque requête et garantie par la base (`studio_session_admission`). Inscription après récupération réservée à l’appareil qui a saisi le code (cookie dédié, 15 min) | S07, S08 ; scénario de Work rejoué |
| Lien 1.0 : date de création de la session prise pour la date du règlement ; tout lien du compte accepté | Lien et prix autorisés reconnus explicitement (`legacy_payment_link_id`, `legacy_link_price_id`). Une ligne, quantité 1, prix catalogue, euro. Instant réel du règlement : la charge Stripe, bornée par l’événement signé. Ventes proches de l’inventaire (24 h) ou ambiguës : « à vérifier », pièce retirée par prudence, décision du fondateur dans STUDIO. Jamais de double décompte (renvoi de notification compris) | R01, R02 ; test de revue « vente 1.0 après inventaire » : 0 pièce |
| Reprise : `quote_expired` à 11 min alors que la session et la réservation étaient ouvertes | Clé d’idempotence cherchée avant l’expiration du devis ; même session, même réservation, même clé Stripe ; tentative close renvoyée avec son état et sa session. Le balayage garde une session retrouvée pendant la réservation | R03, R04, R10 ; t11, t26 ; test de revue « reprise à 11 min » |
| Sauvegarde : image lue table par table, incohérente pendant une vente | Image lue en **un seul lot D1** (instantané cohérent), contrôlée (stock = registre, réservations, ventes, lignes orphelines), chiffrée, **relue et comparée** (SHA-256) après écriture. Rotation seulement après une copie vérifiée : une copie défectueuse ne chasse jamais une bonne. Restauration par lots contrôlée | R05, R06, U09 ; test de revue « sauvegarde pendant une vente » ; exercice de restauration (`scripts/restore-backup.mjs`) |

| Autre écart relevé par Work | Correction | Preuve |
| --- | --- | --- |
| Inventaire contrôlé sur les seuls SKU commandés | Devis et réservation refusés tant qu’une taille **du produit** n’est pas confirmée (règle de la base, `rs_admission`) | R07 |
| CGV : version vide acceptée | Table `terms_documents` (texte conservé, jamais modifié). Sans CGV publiées : `503 not_configured`. Version signée dans le devis et vérifiée au paiement | R07, U05 |
| Chiffrement des coordonnées contrôlé après paiement | Ouverture impossible sans clé valide (`piiReady`). Coordonnées scellées et liées à la commande (AES-GCM, données associées `order:<id>`). Contact non scellé : commande « à vérifier », jamais expédiée | R07, R08 |
| WebAuthn « maison » | Audit point par point (section 10) | A01 à A03 |
| Focus et VoiceOver dans STUDIO | Focus restauré sur le contrôle utilisé après chaque rendu, titre d’écran focalisé, annonces `aria-live` | Recette Chrome. VoiceOver réel non testé |
| Zone : relais et devis non unifiés ; adresse du relais non conservée | Mêmes refus sur la recherche et le devis ; points fermés ou hors zone écartés ; adresse normalisée ; relais figé dans la commande (`relay_snapshot`) ; domicile hors zone saisi sur Stripe : « à vérifier », expédition refusée par la base | R09, U02 |
| Klarna encore cité dans le plan | Plan et contrat corrigés : carte, Apple Pay et Google Pay, Klarna exclu | Documentation |
| Portée de `total_available` | Précisée dans le contrat v1.3 (total du produit ; épuisement du drop calculé à l’échelle du drop) | Documentation |

## 10. Audit WebAuthn (passkeys de STUDIO)

Référence : W3C Web Authentication niveau 3, §7.1 (inscription) et §7.2 (connexion). Chaque contrôle est testé avec de vraies signatures (ES256 et RS256), y compris les refus.

| Étape de la spécification | Contrôle | Test |
| --- | --- | --- |
| §7.1 5-6 et §7.2 9-10 | `clientDataJSON` lu en UTF-8 puis JSON ; champ manquant refusé | A01, A02 |
| §7.1 7 et §7.2 11 | Type `webauthn.create` ou `webauthn.get` exact | A01, A02 |
| §7.1 8 et §7.2 12 | Défi exact, à usage unique, lié à son usage, valable 5 min | A01, S02, S08 |
| §7.1 9 et §7.2 13 | Origine exacte de STUDIO (figée par environnement : sans `STUDIO_ORIGIN`, STUDIO refuse de démarrer en recette et en production) | A01, A02, S02 |
| §7.1 10 et §7.2 14 | `crossOrigin` et `topOrigin` refusés (STUDIO n’est jamais intégré dans une autre page) | A01 |
| §7.1 12 | `attestationObject` lu par un lecteur CBOR strict : longueurs, imbrication, clés en double, types inattendus | A03 |
| §7.1 13 et §7.2 15 | Empreinte du domaine (`STUDIO_RP_ID`) | A01, A02, S02 |
| §7.1 14-15 et §7.2 16-17 | Présence et vérification de l’utilisateur exigées | A01, A02, S02 |
| §7.1 16-17 et §7.2 18-19 | Drapeaux de sauvegarde cohérents (BS sans BE refusé) ; passkey iCloud synchronisée acceptée | A01, A02 |
| §7.1 19 | Algorithme parmi ceux proposés (ES256, RS256) | A01 |
| §7.1 20 | Extensions de l’authentificateur lues (drapeau ED), aucune donnée en trop | A01 |
| §7.1 21-24 | Attestation « none » seulement (politique : aucune liste de fabricants à maintenir) | A01 |
| §7.1 25-26 | Identifiant de 16 à 1 023 octets (A01) ; jamais déjà inscrit (clé primaire de la base) | A01 |
| §7.2 5-6 | Passkey connue, active, de la génération courante ; identifiant d’utilisateur vérifié s’il est fourni | A02, S07 |
| §7.2 21 | Signature vérifiée sur `authenticatorData ‖ SHA-256(clientDataJSON)` | A02, S02 |
| §7.2 22 | Compteur qui recule : connexion refusée et alerte critique (clone possible) ; compteur à 0 d’une passkey synchronisée accepté | A02, S02 |

Limites :

- **Bibliothèque éprouvée.** L’ajout de `@simplewebauthn/server` (dépendance de développement et d’exécution) a été refusé par les règles d’autorisation de l’environnement de travail de Claude ; il n’a pas été contourné. L’implémentation actuelle reste sans dépendance, durcie et testée point par point. Ajouter une bibliothèque change `package.json`, fichier commun : décision à prendre avec le fondateur et Work. Une revue par un spécialiste reste recommandée avant la production.
- **Face ID.** WebAuthn atteste une vérification de l’utilisateur par l’appareil, pas la méthode employée : sur iPhone, Face ID ou, à défaut, le code de l’appareil. STUDIO exige cette vérification à chaque connexion et à chaque action sensible.
- **Safari et iPhone.** Les cérémonies démarrent dans le geste de l’utilisateur (exigence de Safari), mais seul Chrome avec un authentificateur virtuel a été essayé. Inscription, récupération et révocation sur un vrai iPhone font partie de la recette de l’environnement de test (`docs/CLOUDFLARE-TEST.md`).

## 11. SAYLESS STUDIO et automatisations : état réel

| Élément | État |
| --- | --- |
| Écrans de la maquette : aujourd’hui, commandes, préparation et expédition, stock et mouvements, inventaire guidé, retours et remboursements, finances et rentabilité, drops, performances, notifications, santé du site, historique, réglages, demandes des clients, vues iPhone et ordinateur | Branchés sur la base, testés (U01 à U09) et parcourus dans Chrome à 390 et 1 440 px, sans erreur ni violation CSP |
| Codes promo | Non pris en charge par la v2 : affiché comme tel, aucun faux bouton. Demande un changement du devis, à coordonner avec Work |
| Visites | Non mesurées : affiché comme tel, aucun chiffre inventé |
| Discord, notifications iPhone (Web Push, sans service payant), e-mails Resend | Code et tests avec services simulés ; actifs seulement quand leurs secrets sont saisis. Aucun envoi réel effectué |
| Rapport de 10 h (heure de Paris), alertes de stock bas et SOLD OUT sans doublon, suivi des commandes | Testés (T01, t19, U02, U08) |
| Sauvegardes chiffrées | Copie quotidienne vérifiée, liste et téléchargement dans STUDIO (Face ID, journalisé), exercice de restauration testé de bout en bout (U09, recette navigateur) |
| Surveillance | Écran Santé, battement de la tâche planifiée, alertes critiques, `/health` lisible par un service de surveillance externe (T03) |
| Exports | Livre des recettes et commandes (CSV), confirmation Face ID, journalisés (U04) |
| Suivi, contact, rétractation | Routes raccordées ; actives quand l’envoi d’e-mails est configuré, sinon refus explicite (U08, C04) |
| Purge automatique | Coupée, en attente de la validation des durées par le fondateur |

## 12. Mission corrective du 26 novembre 2026 (contre-revue v1.3 de Work)

### V13-B1 : e-mail de confirmation perdu

Avant : la vente était validée, puis la confirmation mise en file à part ; une panne entre les deux perdait l’e-mail pour toujours (le renvoi du webhook ne refaisait rien, la commande étant déjà payée). Même faiblesse pour l’accusé des demandes et l’avis d’expédition.

Après : une **intention durable** (`mail_intents`, migration 0007) est écrite dans le **même lot** que l’événement, sans donnée personnelle (référence seulement). La mise en file vient ensuite ; si elle échoue, l’intention attend et elle est reprise par le renvoi du webhook, l’action liée et la tâche planifiée (essais espacés de 1 min à 1 h, alerte critique au 5e). Clé unique : jamais deux fois dans la file. L'envoi chez Resend reste protégé contre les doublons pendant sa fenêtre d'idempotence (24 h) ; au-delà, un envoi non confirmé passe « à vérifier » (V14-R1, section 13). Commande remboursée entre-temps : rien n’est envoyé. Santé de STUDIO en alerte tant qu’un e-mail attend plus de 10 minutes.

Tests : R11 (panne de file, renvois, nouvel événement, passages simultanés : une seule confirmation), R12 (8 webhooks simultanés, aucune adresse en clair, aucune confirmation tardive si l’envoi a été configuré après la vente), R13 (accusé des demandes), R14 (alerte au 5e essai, remboursement), U10 (avis d’expédition).

### V13-B2 : CGV non archivées

Devis et réservation exigent le texte archivé de la version en vigueur, avec son empreinte vérifiée. La base refuse aussi, au dernier verrou : une commande qui cite une version absente de l’archive (`orders_terms_archived`) ; une réservation si les CGV en vigueur manquent à l’archive (`terms_unpublished`) ou si la commande cite une autre version ou empreinte (`terms_outdated`). Une publication concurrente pendant le paiement est refusée sans commande créée. Reprise d’une tentative existante préservée. Tests R15.

### V13-C1 : texte des CGV

Source unique : la table `terms_documents` (version, texte, empreinte SHA-256, date). Route publique en lecture seule `GET /api/terms[/<version>]` : texte brut, empreinte recalculée à chaque lecture (texte altéré jamais servi : 503 et alerte critique), ETag, cache immuable pour une version précise. Le devis signe version **et** empreinte, et renvoie `terms_sha256` et `terms_url` ; le paiement vérifie `terms_sha256` s’il est fourni. Contrat v1.4 pour Work. Tests R16.

### Échecs sous Windows : cause environnementale, corrigée

| Mesure | Version 397bb43 (Miniflare 4) | Version corrigée (Miniflare 5, lots) |
| --- | --- | --- |
| Connexions TCP locales pour la suite backend | 27 654 | environ 2 800 |
| Linux, ports limités comme Windows (8 192, sans réutilisation TIME_WAIT) | 70 réussis, 16 en échec (« fetch failed ») | 93/93, aucun échec |
| Pic de connexions en TIME_WAIT | 8 177 | 2 016 |

Cause : Miniflare 4 ouvre une connexion TCP locale par requête SQL ; Windows (16 384 ports, TIME_WAIT d’environ 120 s, pas de réutilisation) les épuise, d’où EADDRINUSE, « fetch failed » et, dans t02, 0 réservation au lieu de 26 (toutes les requêtes échouaient avant d’atteindre la base). Aucune erreur fonctionnelle : la même suite passe sous Linux. Correction : outils Cloudflare à jour (Miniflare 5 réutilise ses connexions) et migrations de test en lots. Charge et assertions inchangées ; diagnostic ajouté (échecs de connexion comptés, répartition des réponses dans t01 et t02). CI Linux et Windows (GitHub Actions) ajoutée ; un premier passage sur Windows avec l’ancienne version avait reproduit un échec intermittent de t01.

### Limites de l’offre gratuite Cloudflare (trouvé pendant la mission)

| Invocation | Avant | Après (mesuré par les tests) |
| --- | --- | --- |
| Tâche planifiée après l’ouverture d’un drop (25 paniers expirés, 3 ventes, 4 accusés en attente, 30 alertes, rapport dû) | 115 requêtes D1, 65 appels externes : interrompue par Cloudflare (limites de 50) | 44 à 47 requêtes et 4 à 26 appels par minute ; arriéré traité en 10 minutes, rien perdu ni doublé (R17) |
| Webhook de la dernière pièce (fin du drop, e-mails en attente) | non mesuré | 32 requêtes (R18) |
| STUDIO, relecture de 20 ventes 1.0 | environ 156 requêtes : en échec | lots de 5 ventes, 39 requêtes chacun, relance automatique (U11) |
| Écrans de STUDIO (données d’un drop complet) | — | 3 à 22 requêtes |

`backend/src/budget.mjs` compte les requêtes D1 et les appels externes de la tâche planifiée, du webhook Stripe et de STUDIO ; chaque tâche ne commence une unité de travail que si son pire coût mesuré tient dans le reste ; 2 requêtes restent gardées pour le battement. Les pires coûts par unité sont vérifiés par R18.

### Audit npm et WebAuthn

- Audit : 33 → 27 par la mise à jour des outils Cloudflare ; les 27 restantes sont dans l’ancien gabarit Next/vinext et ses outils, rien dans le code déployé. Proposition à Work : `DEPENDANCES.md`.
- WebAuthn : `@simplewebauthn/server` 14.1.0 retenue après comparaison sur 46 cas (W01) et essai dans workerd sans `nodejs_compat`. Un seul écart : la bibliothèque accepte les réponses venues d’une autre origine, que SAYLESS refuse et continuera de refuser. Non intégrée avant l’accord de Work et du fondateur : `WEBAUTHN-BIBLIOTHEQUE.md`.

## 13. Risques et limites restants

- Rien n’a été essayé sur Cloudflare réel, Stripe en mode test réel, Resend réel, un vrai iPhone (Safari, VoiceOver, notifications), ni avec un transporteur : procédure prête dans `docs/CLOUDFLARE-TEST.md`, à lancer avec l’accord du fondateur.
- Offre gratuite : requêtes D1 et appels externes désormais comptés et bornés (section 12) ; les 10 ms de calcul par invocation ne se mesurent pas en local : à relever dans les métriques du Worker de test. La sauvegarde a sa propre minute.
- Windows : correction prouvée sous Linux avec des ports limités comme Windows et par la CI ; à confirmer sur le PC du fondateur.
- Le lien de paiement 1.0 affiche les moyens de paiement dynamiques du compte (Klarna possible) : décision du fondateur, rien n’a été modifié dans Stripe.
- À saisir par le fondateur dans STUDIO : identifiants du lien 1.0, investissement, quantités reçues et offertes, inventaire physique, CGV.
