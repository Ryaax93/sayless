# État de SAYLESS 2.0 — 26 novembre 2026 — API v1.4

PR nº 2 en brouillon sur `work/frontend-api-v1-2`, base commune `f633255`. [Contre-audit](REVUE-V1-4-WORK.md), [passation](HANDOFF-CLAUDE.md), [PowerShell](POWERSHELL-TEST-V1-4.md).

| Fonction | Réalisé et vérifié localement | Reste à valider |
| --- | --- | --- |
| Identité, photos, lookbook, guide, barre rose | Direction artistique intacte. Logo officiel, défilement, pause/reprise ; aucun post-it. Captures boutique et STUDIO. | Vrai iPhone/Safari, VoiceOver et mesures physiques du guide. |
| Catalogue et stock | Source serveur, états distincts, total vérifié seulement, aucun nombre injecté. | Comptage déclaré S8/M14/L5 =27 à confirmer dans STUDIO après rapprochement V1. |
| Livraison et devis | Une pièce, code postal, refus Corse, relais avec adresse, totaux 79,90 €/83,50 € via devis. | Boxtal/ticket 2277409, tarifs et vrais relais. |
| CGV | Archive exacte, SHA-256 Web Crypto, rendu sans HTML, consentement réinitialisé si changement, reprise ancienne préservée. | Texte juridique final ; obligation du hash côté serveur proposée pour v1.5. |
| Paiement et suivi | Réservation serveur, idempotence, retours, statuts, lien sécurisé, paiement fermé par défaut. | Stripe TEST hébergé, webhook réel de test, wallets, Turnstile. |
| Contact, retours, rétractation | API et référence persistée ; intention d'accusé transactionnelle corrigée. | V14-R1 : doublon possible après interruption >24 h ; délivrabilité réelle. |
| STUDIO et passkeys | Maquette conservée, tests backend/STUDIO réussis. SimpleWebAuthn 14.1.0 essayé isolément. | Validation fondateur avant remplacement ; vraie passkey iPhone, PWA et secours réels. |
| Sauvegardes et automatismes | Budget par invocation, intentions durables, restauration locale archive/intentions. | Cloudflare hébergé, CPU/quotas, restauration isolée et clés hors ligne. |
| Dépendances | Ancien gabarit retiré ; npm audit complet et production : 0. Tests historiques conservés. | Surveillance des nouvelles alertes et revue du verrou par Claude. |
| Cloudflare TEST | Scripts de build fermés et configuration Pages locale, procédure PowerShell. | Autorisation du fondateur puis déploiement et recette externes. |
| Aperçu privé existant | Inchangé dans cette mission ; nouvelles captures locales dans la PR. | Une actualisation externe nécessiterait un accord distinct. |

**211 tests Node + 13 contrôles commerciaux réussis. Une régression séparée reste rouge : `npm run test:review:risks`.** Compilations boutique, boutique TEST, STUDIO, Pages Functions et Worker dry-run réussies.

Avis : prêt pour une première recette hébergée fermée après autorisation ; pas prêt pour une ouverture commerciale. Informations administratives, texte juridique, transporteur, délais et mesures à compléter dans `INFORMATIONS-A-COMPLETER.md`. Aucun déploiement, aucune fusion, aucune modification de main/v2, du domaine, du DNS, de Stripe réel, du lien V1 ou de la boutique publique.
