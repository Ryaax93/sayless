# Face ID de STUDIO : bibliothèque WebAuthn éprouvée (proposition commune Claude et Work)

**Demandes du fondateur** : se coordonner avec Work pour retenir la solution la plus fiable (25 novembre) ; choisir une version commune maintenue après vérification, sans aucun affaiblissement silencieux de l’authentification (26 novembre).

**Version retenue par Claude : `@simplewebauthn/server` 14.1.0** (version exacte), celle qu’a essayée Work. Ma proposition précédente (14.0.3) est retirée : 14.1.0 est la dernière version publiée (6 novembre 2026) et l’audit npm de la bibliothèque et de ses 24 dépendances est vide.

**Statut au 27 novembre : intégration prête, DÉSACTIVÉE.** Accord technique de Work reçu (livraison v1.4). La bibliothèque est dans le projet (commit dédié `8253fe3`, audit à zéro). Elle ne vérifie rien tant que `WEBAUTHN_ENGINE` n’est pas réglé sur `simplewebauthn`, ce qui attend **ta validation explicite**. Sans ce réglage, STUDIO fonctionne exactement comme avant.

## Ce qui change une fois activée

La bibliothèque **s’ajoute** aux contrôles de SAYLESS ; elle ne les remplace pas. Une réponse Face ID n’est acceptée que si les deux vérifications l’acceptent. Tous les contrôles actuels restent en premier :

- origine exacte, domaine (RP ID), défi à usage unique ;
- refus d’une page intégrée dans un autre site (`crossOrigin`, `topOrigin`), que la bibliothèque laisserait passer ;
- présence (UP) et vérification (UV, Face ID exigé), drapeaux de sauvegarde ;
- signature, identifiant d’utilisateur, compteur qui recule (alerte « clé clonée ») ;
- récupération par code de secours, révocation des sessions et des anciennes passkeys, confirmation Face ID des actions sensibles.

Tests rejoués avec la bibliothèque activée (`npm run test:webauthn:bibliotheque`) :

- A01 à A03, W01, S01 à S09 et U01 à U12 : 25 sur 25, sans changer leurs attentes ;
- recette navigateur de STUDIO dans workerd, sans `nodejs_compat` : réussie.

Contre-épreuve : une erreur glissée exprès dans l’appel à la bibliothèque fait échouer S01 quand elle est activée, et aucun test quand elle ne l’est pas. La bibliothèque est donc bien sur le chemin, et seulement quand on l’active.

Coût : le Worker passe d’environ 188 Kio à 1 034 Kio (193 Kio compressés) ; limites de Cloudflare : 64 Mio, démarrage en moins d’une seconde. Le temps de calcul réel reste à mesurer sur Cloudflare de test.

## Activer après ta validation (environnement de TEST)

```powershell
node scripts/test-env.mjs reglage WEBAUTHN_ENGINE simplewebauthn
if ($LASTEXITCODE -ne 0) { throw 'Réglage non appliqué' }
```

L’assistant demande « OUI » puis remet le Worker en ligne. Ensuite : connexion Face ID et confirmation d’une action sensible sur l’iPhone. Pour revenir à la vérification seule de SAYLESS : `node scripts/test-env.mjs reglage WEBAUTHN_ENGINE sayless`. Les passkeys déjà enregistrées restent valables dans les deux cas.

## Vérifications faites le 26 novembre

### 1. Mêmes décisions que SAYLESS, sauf un point où SAYLESS est plus strict

Comparaison sur les mêmes réponses WebAuthn, construites octet par octet, signées avec de vraies clés (`tests/backend/webauthn-bibliotheque.test.mjs`, test W01, 46 cas) :

| Contrôle | ES256 (iPhone, Mac) | RS256 (Windows Hello) |
| --- | --- | --- |
| Inscription et connexion valides | acceptées par les deux | acceptées par les deux |
| Autre origine, autre domaine (RP ID), autre défi, mauvais type | refusés par les deux | refusés par les deux |
| Sans présence (UP), sans vérification (UV) | refusés par les deux | refusés par les deux |
| Signature altérée, compteur qui recule | refusés par les deux | refusés par les deux |
| Drapeau de sauvegarde incohérent (BS sans BE), format d’attestation sans preuve, identifiant incohérent, octets en trop | refusés par les deux | refusés par les deux |
| Passkey synchronisée iCloud (compteur 0, BE et BS) | acceptée par les deux | acceptée par les deux |
| **Réponse venue d’une autre origine** (`crossOrigin: true`, `topOrigin`, cadre intégré) | **SAYLESS refuse, la bibliothèque accepte** | idem |

Ces 6 désaccords sur 46 viennent tous du même point : la bibliothèque ne contrôle pas `crossOrigin` à l’inscription, et à la connexion elle ne le contrôle que si `topOrigin` est présent (Safari ne l’envoie pas). **Ce contrôle doit rester côté SAYLESS**, sinon l’authentification serait affaiblie sans bruit. Le test W01 échoue si un autre désaccord apparaît.

Pour le relancer sans toucher aux fichiers communs : `npm install --no-save @simplewebauthn/server@14.1.0` puis `node --test tests/backend/webauthn-bibliotheque.test.mjs`. Sans la bibliothèque, W01 est ignoré.

### 2. Clés enregistrées (JWK) et format attendu (COSE)

SAYLESS enregistre la clé publique en JWK ; la bibliothèque attend du COSE. La conversion (EC2 P-256 pour ES256 ; RSA n et e pour RS256) est vérifiée par W01 : les connexions valides avec une clé JWK convertie sont acceptées, les autres refusées. Aucune migration nécessaire : conversion à la lecture, ou colonne COSE ajoutée à l’inscription.

### 3. Moteur Cloudflare, sans `nodejs_compat`

Contrairement à ce qui était supposé, **`nodejs_compat` n’est pas nécessaire** : la bibliothèque utilise WebCrypto (`globalThis.crypto`) et n’importe aucun module Node à l’exécution. Essai réel dans workerd (Miniflare 5.20261123.1-beta, date de compatibilité 2026-05-15, sans indicateur) : inscription et connexion ES256 et RS256 vérifiées, réponse d’une autre origine refusée.

Taille : Worker d’essai contenant seulement la bibliothèque, 705 Ko (129 Ko compressés). Le Worker d’exploitation passerait d’environ 188 Ko à environ 890 Ko, très loin de la limite de Cloudflare (64 Mio non compressés, offre gratuite comprise). Démarrage (limite d’une seconde) et calcul (10 ms par invocation sur l’offre gratuite) à mesurer sur Cloudflare de test.

### 4. Récupération et sessions

La bibliothèque ne vérifie que la cérémonie WebAuthn. **Restent entièrement à SAYLESS, sans changement** : défis à usage unique en base (5 minutes), sessions `__Host-` (7 jours, 12 h d’inactivité), confirmation Face ID de moins de 5 minutes pour les actions sensibles, générations de passkeys, code de secours qui révoque passkeys, sessions et défis dans la même instruction SQL, inscription après récupération réservée à l’appareil qui a saisi le code, déconnexion de tous les appareils. Les tests S01 à S09 et U01 à U11 en sont les critères d’acceptation.

## Intégration proposée le 26 novembre (réalisée le 27, désactivée)

1. **Dépendance** : `"@simplewebauthn/server": "14.1.0"` en version exacte, dans un commit dédié avec le verrou (règles de `DEPENDANCES.md`). Ce serait la **première dépendance npm embarquée dans le code déployé** : à relire par Work.
2. **Adaptateur** dans `backend/src/webauthn.mjs`, même interface `verifyRegistration` et `verifyAssertion`, pour que tous les tests actuels s’appliquent sans changer leurs attentes. Avant d’appeler la bibliothèque, SAYLESS garde :
   - le refus de `crossOrigin` et `topOrigin` ;
   - l’attestation « none » seulement ;
   - `requireUserVerification: true` et `supportedAlgorithmIDs: [-7, -257]` écrits explicitement ;
   - le contrôle de l’identifiant d’utilisateur (`userHandle`) ;
   - la lecture du compteur par SAYLESS, pour garder l’alerte « clé clonée » ;
   - l’origine et le domaine figés par environnement.
3. **Tests** : A01 à A03, S01 à S09, U01 à U11, W01 (devenu obligatoire), recette navigateur, puis essai réel sur l’iPhone dans l’environnement de test.
4. **Répartition** : Work relit la dépendance et le verrou ; Claude écrit l’adaptateur sur `claude/integration-v2`. En cas d’écart sur un test qui passe aujourd’hui : analyse commune, l’implémentation actuelle reste en place.
5. **Le fondateur** valide la bascule.

## Ce qui ne change pas

Aucun changement pour les clients ni la boutique. Aucune fusion vers `v2` ni déploiement sans l’accord du fondateur.

## Vérification et avis Work — livraison v1.4

Accord technique sur la proposition Claude **14.1.0**, sans remplacement effectif ni ajout au manifeste racine. Essai dans un dossier isolé : les 46 cas différentiels ont été rejoués avec leurs six écarts cross-origin attendus. Un second banc dans workerd, sans `nodejs_compat`, vérifie inscription et connexion signées ES256/RS256, refus mauvais RP ID/origine et wrapper cross-origin. Résultats concordants ; il ne s'agit pas d'une vraie validation Face ID.

Conserver le wrapper de contexte strict et toutes les règles métier de récupération/session/reauth. Défis et codes à usage unique, révocation des anciennes générations, UP/UV, signatures et origine restent obligatoires. Le fondateur doit valider la bascule ; Claude écrit l'adaptateur et Work relit le verrou dans un commit dédié. Mesures CPU hébergées et iPhone réels restent nécessaires.

Pour rejouer l'essai de bibliothèque, utiliser une copie isolée du dépôt ; ne pas lancer `npm install --no-save` dans le checkout de recette et ne pas modifier le verrou partagé incidemment. Les résultats exploratoires sont séparés des 211 tests du projet.
