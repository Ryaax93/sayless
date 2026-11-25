# Contre-revue Work — API v1.3 — 25 novembre 2026

## Périmètre et décision

Référence Claude examinée : `aab52709f40fd6a5bed3346ac4b7732fd4b2446e`, PR nº 1. Les quatre commits depuis `c6c9db1` ont été examinés, ainsi que le rapport privé fourni et l'intégralité de `API-CONTRACT.md`, `CLOUDFLARE-TEST.md`, `INTEGRATION-PLAN.md`, `OWNERSHIP.md` et `TEST-PLAN.md`.

La préparation conserve la branche et la PR nº 2 existantes. Elle avance depuis `6832ccd` jusqu'à la branche de vérification intégrée publiée par Claude (`4d6a5cc`), puis ajoute les adaptations de la boutique. Cette avance ne fusionne aucune PR et ne déplace ni `v2` ni `main`.

**Avis : préparation utilisable pour une recette technique hébergée séparée, avec paiements fermés au départ. Fusion vers `v2` à différer jusqu'aux corrections B1/B2 et à l'accord sur la publication des CGV. Aucun avis favorable à une ouverture commerciale.**

## Les quatre corrections précédentes

| Correction | Vérification indépendante | Résultat |
| --- | --- | --- |
| Récupération STUDIO | Le trigger de récupération invalide les anciennes passkeys, sessions et défis dans la même opération. Admission des sessions liée à la génération et à une clé active. S07/S08 et nouvelle régression Work avec ancienne session et ancien défi après récupération. | Corrigée dans le périmètre local testé. |
| Ventes du lien 1.0 | Filtrage du lien et du prix, quantité, monnaie et montant. Instant de règlement de la charge utilisé. Rejeu du test Work de vente réglée après l'inventaire, même si créée avant. Les situations ambiguës restent à vérifier. | Corrigée dans les scénarios testés. |
| Reprise après expiration du devis | Recherche idempotente avant la validation d'un nouveau devis. Rejeu à plus de dix minutes, conservation session/réservation, réponse perdue, paiement confirmé et `attempt_closed`. | Corrigée ; la boutique conserve la tentative payée ou incertaine et évite un nouvel achat involontaire. |
| Sauvegarde cohérente | Lecture en un lot D1, invariants, empreinte et relecture avant rotation. Ancien test Work de vente concomitante, R05/R06 et U09. | Corrigée localement. D1/KV hébergés et exercice de restauration réel restent à valider. |

## Anomalies restantes à corriger par Claude

### V13-B1 — P1 — confirmation e-mail perdue après paiement

`backend/src/payments.mjs`, fonction `confirmSale`, autour de `justPaid` et `queueEmail` (lignes 170–191 au SHA audité).

La vente est confirmée avant la mise en file de l'e-mail. Une erreur d'insertion dans `outbox` (canal e-mail) est absorbée. Le webhook est néanmoins traité. Une notification ultérieure de la même session ne remet pas le message en file car `paid_at` n'est plus égal à l'heure du nouvel appel. La commande reste payée, mais le client peut ne jamais recevoir sa confirmation.

Reproduction : `npm run test:review:v13`, premier test. Un trigger SQLite de recette refuse uniquement l'insertion de l'e-mail ; le paiement est confirmé ; suppression du trigger puis nouvelle notification signée à +60 secondes. Résultat observé : **0 confirmation en file**, résultat attendu : **1**. Aucun vrai paiement ni e-mail.

Correction proposée : enregistrer une intention de confirmation durable et dédupliquée dans la transaction qui confirme la vente, puis traiter cette intention par l'outbox. Ou ajouter une réconciliation durable qui recherche les confirmations manquantes indépendamment de `paid_at === now`. Ne pas simplement renvoyer une erreur après une vente déjà appliquée sans garantir sa reprise. Auditer également l'accusé des demandes et les notifications d'expédition pour le même risque.

### V13-B2 — P1 avant ouverture — CGV référencées sans document archivé

`backend/src/commerce.mjs`, `createQuote` et `createCheckout` ; `backend/migrations/0005_revue_work.sql`, `rs_admission`.

La valeur non vide de `settings.terms_version` suffit à obtenir un devis. L'existence du document correspondant dans `terms_documents` n'est pas exigée à cet endroit ni dans le garde-fou SQL de réservation. La voie normale de publication STUDIO archive correctement le document, mais une ancienne configuration, une migration ou un réglage incohérent peut la contourner.

Reproduction : second test de `npm run test:review:v13` : réglage d'une version inexistante dans l'archive, puis demande de devis. Résultat observé : **200**, attendu : **503 `not_configured`**.

Correction proposée : refuser devis et nouvelle réservation tant que `currentTerms().archived` n'est pas vrai ; renforcer la contrainte au niveau atomique de l'admission et conserver la reprise des tentatives déjà existantes. Ajouter le test de changement concurrent de version et le test d'une version archivée disparue/incohérente.

### V13-C1 — texte public des CGV à coordonner

Le contrat v1.3 fournit la version signée, mais aucune route publique permettant d'obtenir le texte archivé. Le lien de la boutique ouvre encore le projet de CGV statique. Une égalité de numéros ne prouve pas que ce texte est identique au document accepté côté serveur.

Protection livrée : une nouvelle acceptation reste bloquée si la version du devis diffère de `SaylessConfig.termsVersion` ; cette configuration est vide et le paiement fermé par défaut. La page affiche son identifiant quand il est configuré. **Ne pas renseigner un numéro seul pour ouvrir les ventes.**

Accord proposé : Claude expose une route additive en lecture seule donnant version, texte et empreinte du document archivé ; Work l'affiche sans HTML non fiable et lie le consentement au même document. À défaut, convenir d'un export statique immuable du texte et de son empreinte, publié simultanément avec la version. Ne pas créer une deuxième source juridique éditable indépendamment.

## Adaptations de la boutique

- Contrat v1.3 : validation du devis et des CGV, `total_available` exact, `orderable` par taille, destination et adresses complètes des relais. Aucun stock réel initialisé.
- Tentative conservée après réseau incertain, délai `Retry-After`, double clic partagé, reprise après expiration du devis et compatibilité des tentatives v1.2 déjà commencées. Les états paid/review/processing/pending/refunded ferment le nouvel achat ; expired/failed permettent un nouveau devis.
- Confirmation par `POST /api/checkout/status`, sans considérer la simple URL de retour Stripe comme preuve de paiement.
- Suivi : jeton reçu dans le fragment, retiré de l'URL, gardé seulement en mémoire puis transmis dans `Authorization`. Pas de données de suivi dans localStorage/sessionStorage. Réouverture du lien nécessaire après rechargement. Demande de lien à réponse neutre. Les valeurs héritées inconnues restent « à confirmer ».
- Contact, retour et rétractation : formulaires reliés à `/api/requests`, vérification anti-abus, référence affichée uniquement après réponse de persistance valide, état réseau incertain sans renvoi automatique. Un formulaire distinct ne peut pas recevoir l'accusé d'une autre demande en cours. Préparation d'e-mail conservée comme solution explicite.
- Focus et annonces de statut, erreurs de champs, typographies et mise en page existantes conservés. Logo, photos, lookbook, noir/rose et barre animée inchangés. Aucun sticker réintroduit.
- Build Cloudflare de test séparé, headers et routes statiques, aucun secret dans la configuration publique. Aucun deuxième serveur ni second STUDIO.

## WebAuthn et SimpleWebAuthn

Lecture du vérificateur manuel et des tests A01–A03. Les contrôles challenge/type/origine/RP ID, présence et vérification utilisateur, signature, compteur, userHandle et drapeaux de sauvegarde sont présents. La récupération révoque maintenant les anciennes autorisations.

`@simplewebauthn/server@14.1.0` s'est installé dans un répertoire de travail isolé, sans modifier les dépendances du projet. Sous Node : inscription ES256, authentification signée et refus de mauvaise origine réussis avec authentificateur logiciel. Bundle ESM, génération d'options, inscription ES256 et refus de mauvaise origine également réussis dans **workerd local** avec `nodejs_compat`. Cela ne valide ni les quotas CPU hébergés, ni Safari/Face ID, ni toutes les clés RS256.

Proposition à Claude, sans changement de ses fichiers : adopter un vérificateur maintenu après validation de la migration de stockage (COSE brut attendu par la bibliothèque, JWK actuellement conservée), de la liste d'algorithmes ES256/RS256, de la génération de sessions, des défis à usage unique et des compteurs. Garder `requireUserVerification`, origine et RP ID stricts. Prévoir migration contrôlée ou réinscription ; aucun repli silencieux vers un vérificateur plus permissif.

Durcissement à traiter même sans migration : borner les longueurs CBOR avant `Array.from({length:n})`, valider les octets/extensions résiduels, conserver la propriété de sauvegardabilité BE pour vérifier ses transitions, et éviter un parseur DER artisanal insuffisamment couvert. Ce sont des points de durcissement ; cette revue ne démontre pas un contournement d'authentification.

Sources primaires consultées : [SimpleWebAuthn serveur](https://simplewebauthn.dev/docs/packages/server), [limites Workers](https://developers.cloudflare.com/workers/platform/limits/). Tester coût CPU, mémoire et latence sur l'offre gratuite avant de conclure à sa suffisance.

## STUDIO : examen visuel et accessibilité

Maquette de Claude conservée sans modification de `studio/`. Chargement des vues Aujourd'hui, Commandes, Stock et Réglages contrôlé dans Chrome local ; layouts à 390 et 1440 px. Pas de débordement horizontal observé sur l'accueil mobile ; navigation basse mobile et latérale ordinateur, titres, étiquettes, focus visible et réduction des animations présents dans le code.

Les captures de recette indiquent explicitement des données de test et une authentification simulée pour le contrôle visuel. Elles ne démontrent pas Face ID. Une revue VoiceOver/Safari sur iPhone, zoom 200 %, retour de focus après chaque dialogue et noms accessibles des boutons à icône restent à faire. Les états sans données sont honnêtes. Aucun changement de la maquette n'est proposé.

## Tests indépendants exécutés

| Suite | Résultat |
| --- | --- |
| Frontend (`test:frontend`) | **55/55**, plus **13 assertions commerciales** |
| Inventaire historique (`test:inventory`) | **16/16** |
| Backend/STUDIO (`test:backend`) | **84/84** |
| Client + véritable routeur Claude + D1 locale (`test:integration`) | **13/13** |
| Contre-revue des quatre corrections (`test:review`) | **4/4** |
| Nouvelles anomalies (`test:review:v13`, séparée) | **0/2** : échecs B1 et B2 reproductibles, volontairement non masqués |
| Build statique, STUDIO, Pages Functions, Worker `--dry-run` | Réussis ; aucun déploiement |
| SimpleWebAuthn isolé | Essais Node et workerd local décrits ci-dessus réussis |

Total : **172 tests réussis et 13 assertions commerciales**, plus **2 régressions connues en échec**. Les suites ont été exécutées, avec reprise de la chaîne après redémarrage de l'environnement ; ces chiffres ne sont pas repris des annonces de Claude. Les anciennes régressions rouges v1.2 sont désormais vertes.

Cas couverts : stock périmé/absent, rupture globale/par taille, réservation, pause, zone refusée, devis expiré, CGV changées, double clic, coupure réseau, reprise, réponse terminale, retour Stripe et confirmation en attente, suivi expiré, demandes chiffrées. Les 84 tests incluent les scénarios de concurrence et notifications dupliquées du backend.

Contrôle navigateur : total domicile **83,50 €**, total relais **79,90 €**, adresse complète du relais de recette, version des CGV affichée, paiement fermé ; aucune erreur JavaScript applicative observée (des messages de l'extension de navigateur sont exclus). Le script Python de Claude avec authentificateur virtuel n'a pas été rejoué : contrôle du navigateur par l'outil géré et tests logiciels de l'authentification séparés.

## Limites et prochaine recette

Non validés ici : Cloudflare/D1/KV hébergés, Stripe TEST externe et wallets, transporteur réel, Resend livré, Discord, Web Push/iPhone, restauration hébergée, budget de quotas. Les prestataires sont simulés dans les tests locaux uniquement. L'aperçu privé sert la boutique statique avec stock inconnu et paiement fermé ; il ne prétend pas connecter ces services.

Avant test de paiement hébergé : B1/B2, CGV identiques et publiées, origine test dédiée, clés TEST, Turnstile et boîtes de réception de test, D1/KV distinctes, validation des tarifs et du transporteur. Avant ouverture : inventaire physique S/M/L, informations vendeur, médiateur et retours, politique de conservation, validation juridique et recette iPhone. Aucun inventaire n'est déduit des 26 théoriques.
