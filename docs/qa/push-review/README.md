# Preuves du contre-audit push Work

Source testée : `be0bb9bf0406059cd129d8c818a5d3743992e6a3`. Revue achevée le 28 novembre 2026.

Ce dossier contient les sorties locales expurgées de chemins de machine et de séquences de couleur, ainsi que les deux réponses JSON de `npm audit`. Aucun journal d'exploitation du fondateur, export de sa base ou secret réel n'y figure.

| Fichier | Portée |
| --- | --- |
| `npm-test.txt` | 74 frontend, 13 contrôles commerciaux, 16 inventaire, 114 backend/STUDIO, 13 intégration |
| `review*.txt` | 4 + 2 + 6 + 1 tests de revue existants |
| `webauthn.txt` | 25 tests supplémentaires avec SimpleWebAuthn |
| `independent.txt` | 7 contrôles réussis et **6 critères en échec**, correspondant à 5 anomalies |
| `deployment.txt` | 2 contrôles réussis : assistant simulé installé, vrai Wrangler D1 local |
| `d1-observability.txt` | 300 clients, 26 commandes, 130 webhooks HTTP 200, aucune erreur de transport locale |
| `build-*.txt` | Compilations locales, aucune mise en ligne |
| `check-free-plan.txt` | Contrôle des tailles de bundle, pas de mesure CPU hébergée |
| `npm-audit*.json` | Audits complet et hors dépendances de développement : zéro vulnérabilité |

Les fournisseurs sont simulés ; l'authentificateur est logiciel. Les données et clés sont exclusivement de recette. Le test de l'action « Activer » exécute le corps réel de cette action avec des interfaces navigateur simulées ; ce n'est pas un essai Safari ou Face ID physique.

Les six échecs sont des critères d'acceptation non satisfaits sur le commit audité, **pas des tests ignorés ni une réussite globale**. Ils n'ont pas été ajoutés à la CI partagée ou au manifeste sans coordination avec Claude. Reproduction et corrections attendues : [rapport complet](../../CONTRE-AUDIT-PUSH-WORK.md).
