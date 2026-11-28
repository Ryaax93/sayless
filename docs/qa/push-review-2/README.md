# Preuves du second contre-audit push

Base examinée : `56d960bda249ca1ca354c22349cdd364fc42501a`, le 28 novembre 2026.

[Rapport et transmission à Claude](../../CONTRE-AUDIT-PUSH-2-WORK.md) — **NO GO TEST en l’état**.

Les journaux proviennent d’exécutions locales indépendantes. Les chemins propres à la machine sont expurgés ; assertions et résultats restent inchangés. Aucune base réelle, clé réelle, donnée client ou inscription iPhone réelle n’est jointe. Les chiffres de stock dans les tests sont des fixtures.

| Preuve | Contenu |
| --- | --- |
| `results.json` | Récapitulatif : 277 tests existants + 13 contrôles commerciaux réussis ; nouveaux tests : 6 réussis, 4 en échec |
| `baseline-results.json` | Codes de sortie et durées des commandes existantes |
| `npm-test.log` | Frontend 74, inventaire 16, backend/STUDIO 120, intégration 13, commerce 13 |
| `review*.log` | Reviews historiques, six anciens critères push inchangés et test D1 strict |
| `webauthn.log` | 25 tests avec la bibliothèque activée dans le banc, sans validation Face ID physique |
| `new-integrity.log` | 5 contrôles migrations, sauvegardes et trajet d’accusé de réception |
| `new-migrations.log` | 1 contrôle avec vrai Wrangler local, 0009/0010 et registre de migrations |
| `new-issues.log` | 4 nouveaux critères rouges P2-R1 à P2-R4, erreurs non masquées |
| `crypto-experiment.log` | Comparaison de signatures et mesure locale du calcul ; pas un audit formel ni une mesure CPU Cloudflare |
| `build*.log`, `free-plan.log` | Compilations et contrôles statiques, aucun déploiement |
| `audit.log`, `audit-prod.log` | Audit npm complet et hors dépendances de développement : zéro vulnérabilité |

La référence `@noble/curves@2.3.0` reste une installation expérimentale isolée, hors manifeste du produit. Le rapport fournit les commandes de reproduction PowerShell. Les tests supplémentaires ne sont pas ajoutés unilatéralement à la CI de Claude ; ils doivent être intégrés à son prochain correctif.

La CI GitHub de Claude et le PC Windows du fondateur sont distingués des exécutions locales. Apple, Discord et les fournisseurs sont simulés dans les tests ; aucune réception sur l’iPhone physique ni conservation des ressources Cloudflare distantes n’est certifiée par ces fichiers.
