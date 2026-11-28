# Preuves du troisième contre-audit push

Base : `d05cf655668a4ea6d2191f5859aa78c1d4f6cf5d`, 28 novembre 2026.

[Rapport et transmission à Claude](../../CONTRE-AUDIT-PUSH-3-WORK.md) : **GO pour recette Cloudflare TEST surveillée, réserve P3-R1 sur les diagnostics concurrents**. Aucun déploiement réalisé.

Les journaux sont ceux des exécutions locales complètes. Chemins locaux et séquences de couleur expurgés ; résultats et erreurs conservés. Aucun secret réel, base réelle, journal distant ou donnée client inclus. Les stocks, appareils et clés utilisés par les tests sont synthétiques.

| Fichier | Preuve |
| --- | --- |
| `results.json` | Commandes, totaux et limites : 297 tests existants verts, 13 contrôles commerciaux verts, 3 nouveaux tests verts et 2 rouges |
| `baseline-results.json` | Codes de sortie et durées des quinze commandes existantes |
| `npm-test.log` | Frontend 74, inventaire 16, backend/STUDIO 130, intégration 13 et contrôles commerciaux 13 |
| `review*.log` | Reviews historiques, quinze tests du premier contre-audit, dix du second et un test D1 strict |
| `webauthn.log` | 25 tests logiciels ; ne prouve pas Face ID physique |
| `new-integrity.log` | DB explicite et réponse perdue ; migration et restauration avec authentification ; budget du cron avec quatre services push |
| `new-issues.log` | Deux reproductions en échec du défaut de santé du canal P3-R1 ; assertions non masquées |
| `build*.log`, `free-plan.log` | Compilations et contrôles statiques ; Worker uniquement en dry-run |
| `audit.log`, `audit-prod.log` | Audits npm complet et hors dev : zéro vulnérabilité signalée |

Le nouveau scénario de quatre audiences attend exactement douze notifications métier et une notice légitime signalant KV absent de sa fixture. Il vérifie la liste complète et 52 appels, pas uniquement une borne permettant de masquer une cascade. Les providers Apple/Google/Mozilla/Windows sont simulés ; aucune réception réelle n'est certifiée.

Les deux fichiers de tests ajoutés sont autonomes et utilisables par Claude. Ils ne sont pas ajoutés unilatéralement à sa CI. Aucun ancien test ou fichier du backend n'est modifié. Le rapport explique pourquoi deux échecs diagnostiques restent compatibles avec une recette TEST limitée, sans les qualifier de corrections terminées.
