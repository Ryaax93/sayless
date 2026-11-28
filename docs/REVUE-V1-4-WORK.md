# Contre-audit indépendant Work — API v1.4

26 novembre 2026. PR nº 2, branche `work/frontend-api-v1-2`. Base commune : `f6332555b44f8c3441a29d804d8bb013b2800522`, qui contient Claude `7102f4356299adcf8d7daeb2eb717500828ff12c` et Work `4dc56e10ed6fafc64c397f567d82c2a21a2293a7`. Lecture intégrale des documents demandés et du rapport Claude joint, puis examen du code et essais indépendants. Les rapports privés et journaux Windows du fondateur ne sont pas republiés.

## Verdict

Préparation locale suffisante pour demander l'autorisation d'une **recette Cloudflare TEST fermée**, sans Stripe ni Resend actifs au premier déploiement. Pas de validation commerciale ni de garantie de livraison des e-mails. Un défaut reproductible reste ouvert : **V14-R1**, doublon possible après réponse Resend perdue et reprise au-delà de 24 heures. Aucune fusion ni aucun déploiement effectué par cette livraison.

B1 est corrigé concernant la persistance transactionnelle et la reprise des intentions ; la promesse générale « jamais de doublon » doit être restreinte. B2 est corrigé. C1 est raccordé côté boutique et vérifié. L'empreinte reste facultative côté serveur v1.4 pour les appels directs : proposer v1.5 avant l'ouverture commerciale.

## Examen des chemins d'exécution

| Point | Constat indépendant | Preuve ajoutée ou rejouée |
| --- | --- | --- |
| B1 : intention durable | `mail_intents` est inséré dans le même lot D1 que vente, demande ou expédition. Une panne avant validation annule le lot ; après validation, le webhook ou le cron retrouve l'intention. | `v14-integrity.test.mjs` : échec forcé par trigger SQL, vente non validée, webhook rejoué puis une seule vente. Demande et intention annulées ensemble. |
| B1 : file et reprise | Déduplication en base sur l'intention et l'outbox. Échec après insertion dans la file, avant marquage de l'intention : reprise concurrente sans seconde entrée. | Nouvelle régression passant sur les véritables modules de Claude. |
| B2 : CGV requises | `termsDocument` recalcule l'empreinte avant devis et nouvelle réservation. Garde SQL sur version/hash courants ; archive immuable par triggers. Une version seule dans `settings` ne suffit pas. | Deux anciennes régressions passent. Archive altérée entre devis et checkout : 503 et aucune réservation. Mauvais hash : refus sans stock réservé. |
| C1 : document exact | Routes `/api/terms` et `/api/terms/{version}`, corps brut, format, date, version et SHA. Le navigateur vérifie SHA-256 sur les octets UTF-8 du texte sans le normaliser. | 17 tests frontend dédiés, dont CRLF, accents, espaces, HTML hostile, mauvaise empreinte et absence de Web Crypto. |
| Reprise des tentatives | La recherche par clé existante précède les exigences sur la version courante. La boutique conserve devis, version, hash et clé d'origine ; aucun nouveau consentement imposé à une réservation existante. | Tests de reprise, panne réseau, changement de version, tentative ancienne sans hash, états terminaux et double clic. |
| Sauvegardes | Archive CGV et intentions incluses. Capture en lot D1, vérification du contenu relu, chiffrement RSA-OAEP/AES-GCM et compression. | Nouvelle restauration locale : archive identique, intention en attente reprise une fois avec la même clé PII. |
| Limites gratuites | Budget explicite D1/appels externes ; lot D1 compté comme un appel ; pause/reprise bornée du cron et de la relecture V1 ; sauvegarde isolée. | Tests Claude R17/R18/U11 rejoués. Ce compteur ne mesure ni le CPU réel ni les quotas journaliers de lignes D1/KV/Resend. |

`terms_sha256` fourni est vérifié dans `backend/src/commerce.mjs:210–231` ; son absence demeure autorisée dans v1.4. La boutique l'envoie désormais pour chaque **nouvelle** tentative. Cette sécurité frontend ne remplace pas une obligation serveur.

## V14-R1 — livraison incertaine après expiration de l'idempotence Resend

Fichiers concernés : `backend/src/notify.mjs`, fonction `deliverOutbox` ; `backend/src/email.mjs`, fonction `resendSender`.

1. Resend accepte un message ; la réponse réseau est perdue.
2. La ligne reste à reprendre. La clé de déduplication locale reste la même.
3. Le service reste interrompu plus de 24 h.
4. À la reprise, Resend ne conserve plus nécessairement cette clé. Le même message est envoyé une seconde fois.

Reproduction : `npm run test:review:risks`. Résultat observé : **2 livraisons au lieu de 1**, avec le véritable expéditeur et la véritable outbox, fournisseur simulé avec une fenêtre de 24 h. Aucun e-mail réel envoyé. Ce test est volontairement séparé et reste rouge ; il n'est ni ignoré ni compté parmi les tests réussis.

Correction à réaliser par Claude : enregistrer l'instant de première tentative avant l'appel fournisseur, figer le contenu et la clé, conserver l'identifiant fournisseur reçu, limiter les reprises automatiques à la fenêtre garantie avec marge. Au-delà, conserver un état « livraison incertaine », alerter STUDIO et rapprocher avant toute réexpédition. Des événements signés du fournisseur peuvent aider le rapprochement. Un nombre maximal d'essais ne suffit pas si le système reste arrêté. Ne pas promettre un envoi exactement une fois sans borne temporelle. Corriger également les commentaires trop absolus.

Cette anomalie n'empêche pas la première recette hébergée **fermée et sans expéditeur configuré**. Elle doit être traitée avant de valider les confirmations transactionnelles comme fiables.

## Modifications Work livrées

- Contrat CGV v1.4 : URLs canoniques de même origine, métadonnées strictes, Web Crypto, comparaison document/réponse/devis, chargement sans cache. Refus en cas de document manquant, ancien, invalide ou différent.
- Document exact affiché via `textContent`, `white-space: pre-wrap`, zone défilable au clavier et page entière accessible. Aucun rendu HTML du texte serveur, aucune reformulation contractuelle.
- Nouvelle vérification juste avant réservation ; consentement annulé si les CGV changent. Résultats asynchrones obsolètes ignorés ; reprise des tentatives antérieures préservée.
- Retrait de la version CGV codée dans la configuration. Projet juridique précédent conservé dans `docs/legal/CGV-PROJET-AVANT-ARCHIVAGE.html`, non publié comme contrat applicable.
- Gabarit Next/Vinext et ancien runtime retirés après traçage des imports et points d'entrée. Cinq fichiers utiles aux 16 tests historiques déplacés sous `tests/legacy-fixtures/`. Dépendances et verrou régénérés ensemble, sans `--force`.
- Générateur local `scripts/prepare-pages-test.mjs` : configuration Pages de test strictement séparée, aucun secret recopié et aucun déploiement. Build frontend fermé par défaut.
- Aucun module backend, migration, Worker, script d'exploitation Claude ou écran STUDIO modifié. Une adaptation de fixture dans `tests/backend/parity.test.mjs` transmet le hash désormais exigé par le client Work ; assertions préservées.

## Résultats indépendants

Environnement : Linux, Node **24.22.3**, npm **11.19.1**. Les résultats Windows Node 26.13.1/npm 11.20.0 fournis par le fondateur sont une preuve distincte ; ils ne sont pas présentés comme exécutés ici.

| Suite | Résultat |
| --- | ---: |
| Frontend | 74/74 |
| Inventaire historique | 16/16 |
| Backend/STUDIO, dont concurrence 200/300 clients | 96/96 |
| Intégration boutique + véritable routeur + D1 locale | 13/13 |
| Revue initiale | 4/4 |
| Revue v1.3 | 2/2 |
| Nouvelles régressions v1.4 | 6/6 |
| **Total Node** | **211/211** |
| Contrôles commerciaux | **13/13** |
| Risque séparé V14-R1 | **0/1 : défaut reproduit** |

Les 25 vérifications supplémentaires par rapport aux 199 du fondateur sont 17 tests CGV, 2 configurations Pages et 6 régressions d'intégrité. Installation propre `npm ci --ignore-scripts --no-audit --no-fund` réussie. Compilations boutique ordinaire et TEST, STUDIO, Worker TEST en dry-run et Pages Functions réussies. Aucun accès de production requis. Après une interruption de l'environnement, la chaîne a repris à la suite inventaire ; aucune suite inachevée n'est comptée.

| Audit npm | Avant | Après |
| --- | --- | --- |
| Complet | 27 : 2 critiques, 8 élevées, 16 modérées, 1 faible | **0** |
| `--omit=dev` | 5 : 1 critique, 2 élevées, 2 modérées | **0** |

Preuves JSON et journaux nettoyés : [qa/v14](qa/v14/README.md). Ce résultat décrit l'audit au moment du contrôle, pas une garantie contre de futures vulnérabilités. Aucune dépendance déplacée artificiellement vers les outils de développement.

## WebAuthn, STUDIO et visuel

L'essai isolé SimpleWebAuthn **14.1.0** confirme les 46 cas différentiels de Claude, avec les six écarts connus de contexte cross-origin. Essai supplémentaire dans workerd **sans `nodejs_compat`** : inscription et connexion signées ES256/RS256, refus d'une mauvaise origine, d'un mauvais RP ID et d'un contexte cross-origin par l'enveloppe SAYLESS. Aucune dépendance d'authentification ajoutée au projet et aucun remplacement du vérificateur.

Accord technique de Work pour la proposition d'adaptateur de Claude, **sous validation du fondateur**. Conserver UP/UV, signature, origine/RP ID, challenge, userHandle, générations, révocation après récupération, secours à usage unique et réauthentification sensible. Les tests logiciels ne valident pas Face ID réel. CPU, Safari, passkey synchronisée et installation PWA restent à tester sur l'iPhone et Cloudflare.

Recette Chrome locale : fiche 390 px et ordinateur, panier et récapitulatif au clavier, Corse refusée, devis domicile 83,50 €, CGV exactes, zone sans débordement horizontal, focus visible, paiement désactivé. Barre rose : logo original, animation `sayless-marquee` active, pause et reprise vérifiées. Réduction des animations conservée dans le CSS. STUDIO desktop/mobile conservé, navigation et dashboard lisibles ; aucun écran remanié. [Captures et limites](qa/v14/README.md).

## Exploitation et limites restantes

- L'assistant `scripts/test-env.mjs` crée et déploie réellement des ressources lors de sa commande sans argument. Il n'a pas été exécuté contre Cloudflare. Ses scénarios simulés font partie des 96 tests.
- Point à corriger par Claude : `install()` attend `report(url)` sans retourner son booléen. En cas de contrôle final négatif, le code de sortie peut rester 0. La procédure Work appelle donc explicitement `etat` et vérifie son code de sortie ; proposer `return await report(url)` avec test de panne de santé.
- Sauvegardes locales vérifiées ; restauration hébergée, conservation des clés hors ligne, volumes et limites KV/D1 à mesurer. Ne jamais supprimer la seule clé privée avant d'avoir vérifié une copie et la lecture d'une sauvegarde.
- Discord utilise aujourd'hui un seul `DISCORD_WEBHOOK_URL`. Proposition gratuite de routage multi-salons documentée dans la passation ; aucun webhook créé ni testé ici.
- Boxtal, paiements Stripe TEST externes, livraison Resend, push iPhone, collecte de métriques et authentification iPhone restent non validés. Pas de recette commerciale complète.
- Texte juridique, informations vendeur, mesures du guide, transporteur et délais restent à valider. Inventaire déclaré de 27 pièces documenté, jamais préchargé dans une base active.

## Sources primaires vérifiées

- [Cloudflare D1 : limites et lots](https://developers.cloudflare.com/d1/platform/limits/).
- [Cloudflare Workers : limites](https://developers.cloudflare.com/workers/platform/limits/) : gratuit, 50 appels externes par invocation, CPU 10 ms et limites journalières à contrôler.
- [Resend : idempotence limitée à 24 heures](https://resend.com/docs/dashboard/emails/idempotency-keys).
- [SimpleWebAuthn : serveur et environnements pris en charge](https://simplewebauthn.dev/docs/packages/server).

Les vérifications locales ne démontrent pas le respect du CPU gratuit en environnement hébergé. Mesurer les métriques sur TEST ; ne pas activer de plan payant automatiquement.
