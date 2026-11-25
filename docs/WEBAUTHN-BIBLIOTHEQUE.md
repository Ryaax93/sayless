# Face ID de STUDIO : bibliothèque WebAuthn éprouvée (proposition commune Claude et Work)

**Demande du fondateur (25 novembre 2026)** : se coordonner pour retenir la solution la plus fiable.

**Proposition de Claude** : adopter `@simplewebauthn/server` **14.0.3** (version exacte), avant la production, sans bloquer l’essai de STUDIO sur l’iPhone qui commence avec l’implémentation actuelle, auditée et testée.

## Pourquoi

| Critère | Implémentation actuelle | `@simplewebauthn/server` 14.0.3 |
| --- | --- | --- |
| Usage | SAYLESS seulement | Largement utilisée, maintenue activement (versions et correctifs réguliers) |
| Corrections | Revues internes (audit point par point, tests A01 à A03) | Correctifs publiés, dont une vulnérabilité modérée corrigée en 14.0.2 |
| Cloudflare Workers | Oui (WebCrypto) | Annoncée compatible ; Node 22 minimum, comme le dépôt |
| Formats | Attestation « none », ES256 et RS256 | Tous les formats et algorithmes de la norme |
| Dépendances | Aucune | Quelques paquets (CBOR, ASN.1, base64) à figer et surveiller |

La bibliothèque réduit le risque principal : une erreur subtile dans le décodage CBOR ou COSE, ou dans la vérification d’une signature.

## Ce qui change, ce qui reste

- **Délégué à la bibliothèque** : lecture de `clientDataJSON`, de l’objet d’attestation et des données de l’authentificateur, défi, origine, empreinte du domaine, drapeaux de présence et de vérification, signature, compteur.
- **Gardé par SAYLESS** : défis à usage unique en base (5 min), générations de passkeys et révocation atomique après un code de secours, refus de `crossOrigin` et `topOrigin`, cohérence des drapeaux de sauvegarde, alerte si le compteur recule, origine et domaine figés par environnement, attestation « none ».
- **Stockage** : la bibliothèque attend la clé publique au format COSE ; une colonne s’ajoute aux passkeys. Seules des passkeys de test existent : réinscription possible, aucune donnée de production.

## Répartition proposée

1. **Work** ajoute la dépendance dans `package.json` et `package-lock.json` (fichiers communs), version exacte, dans un commit séparé. L’environnement de travail de Claude a refusé cette installation le 25 novembre : Claude ne l’a pas contourné.
2. **Claude** branche la bibliothèque sur `claude/integration-v2`, sans toucher aux règles SAYLESS ci-dessus.
3. **Critères d’acceptation**, contrôlés par les deux :
   - toutes les suites actuelles passent sans modification de leurs attentes (S01 à S09, A01 à A03, U01 à U09) ;
   - recette navigateur et essai réel sur l’iPhone dans l’environnement de test ;
   - Worker toujours compilé sous la limite de l’offre gratuite, connexion sous 10 ms de calcul ;
   - aucune requête réseau ajoutée (pas de service de métadonnées).
4. Si un test qui passe aujourd’hui échoue avec la bibliothèque : analyse commune avant toute décision ; l’implémentation actuelle reste en place.
5. **Le fondateur** valide la bascule.

## Ce qui ne change pas

Aucun changement pour les clients ni la boutique. Aucune fusion vers `v2` ni déploiement sans l’accord du fondateur.
