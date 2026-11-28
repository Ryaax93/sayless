# Recette SAYLESS — API v1.4

## Résultats locaux du 26 novembre 2026

| Commande | Résultat |
| --- | --- |
| `npm run test:frontend` | 74 tests Node + 13 contrôles commerciaux |
| `npm run test:inventory` | 16 tests historiques conservés |
| `npm run test:backend` | 96 tests, dont STUDIO, sécurité, concurrence 200/300 clients et assistant Cloudflare simulé |
| `npm run test:integration` | 13 scénarios client réel + routeur Claude + D1 locale, Stripe/transporteur simulés |
| `npm run test:review` | 4/4 |
| `npm run test:review:v13` | 2/2, anciennes anomalies corrigées |
| `npm run test:review:v14` | 6/6, intégrité transactionnelle et restauration |
| `npm run test:review:risks` | **1 échec connu V14-R1** : reprise Resend après 24 h |
| `npm audit`, `npm audit --omit=dev` | Zéro vulnérabilité chacun |
| Builds boutique, boutique TEST, STUDIO, Worker dry-run et Pages Functions | Réussis, sans déploiement |

Total positif : **211 tests Node + 13 contrôles commerciaux**. Ne pas omettre le test rouge séparé dans un bilan. Preuves : [qa/v14](qa/v14/README.md). Node 24.22.3/npm 11.19.1 sur Linux ici ; Windows fondateur constitue une recette antérieure distincte.

Les scénarios frontend couvrent stock inconnu, pause, réservé, épuisé, destination, code postal, devis expiré, consentement, double clic, réseau interrompu, reprise d'ancienne tentative, retour Stripe et confirmation en attente. Les 17 nouveaux tests CGV couvrent corps exact, hash, route sûre, document invalide, Web Crypto indisponible, changement avant paiement et rendu sans injection.

## Avant de déclarer la recette hébergée réussie

1. Exécuter la procédure PowerShell sur le SHA livré ; conserver les codes de sortie, pas seulement les dernières lignes.
2. Autorisation du fondateur, puis environnement Cloudflare TEST séparé avec ventes fermées. Confirmer migrations, santé, cron, CGV TEST archivées et métriques CPU/D1/KV sur 24 h.
3. Recette iPhone/Safari : inscription réelle, UP/UV, Face ID, PWA, navigation clavier externe/VoiceOver, codes de secours, anciennes sessions/passkeys invalidées, réauthentification sensible et push.
4. Restauration sur base de test distincte, bonne et mauvaise clé, intégrité CGV, intentions et commandes, reprise sans réexpédition aveugle d'e-mails anciens.
5. Après correction R1 et accord : Resend réellement reçu, destinataire TEST, réponse perdue, reprise bornée, doublons et état incertain. Discord TEST sans PII ni tokens, budget partagé.
6. Stripe TEST : aucune clé réelle, falsification prix/stock/refus serveur, dernière pièce concurrente, webhooks signés, dupliqués et désordonnés, changement de CGV, devis expiré, création de session incertaine, abandon et reprise. Aucun double débit ou décompte. Ne pas confondre statut local et paiement confirmé côté serveur.
7. Transporteur confirmé : relais réel fermé/invalide, adresse exacte dans devis/commande/étiquette, frais et poids final. Aucun achat réel d'étiquette sans autorisation.
8. Annulations/remboursements : pas de restock avant retour physique validé ; écritures idempotentes et journalisées.
9. Liens de suivi, anti-énumération, expiration, requêtes et accusés durables, pas de PII dans URL/logs/Discord.
10. Vérification des renseignements administratifs réels, mesures produit, délais, SEO, performances et contenu avant ouverture commerciale. Inventaire actif confirmé dans STUDIO après contrôle des ventes V1.

Aucun essai externe n'est autorisé par ce document seul. Le workflow CI de Claude doit encore inclure la nouvelle suite v1.4 et rendre les audits bloquants ; proposition dans la passation, sans changement unilatéral.
