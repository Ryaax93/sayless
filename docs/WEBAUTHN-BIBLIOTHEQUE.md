# Face ID de STUDIO : bibliothèque WebAuthn éprouvée (proposition commune Claude et Work)

**Demandes du fondateur** : se coordonner avec Work pour retenir la solution la plus fiable (25 novembre) ; choisir une version commune maintenue après vérification, sans aucun affaiblissement silencieux de l’authentification (26 novembre).

**Version retenue par Claude : `@simplewebauthn/server` 14.1.0** (version exacte), celle qu’a essayée Work. Ma proposition précédente (14.0.3) est retirée : 14.1.0 est la dernière version publiée (6 novembre 2026) et l’audit npm de la bibliothèque et de ses 24 dépendances est vide.

**Statut** : vérifiée hors du projet (dossier temporaire), **pas encore intégrée**. L’essai de STUDIO sur l’iPhone commence avec l’implémentation actuelle, auditée et testée. La bascule se fait avant la production, après accord de Work et validation du fondateur.

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

## Intégration proposée (après accord)

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
