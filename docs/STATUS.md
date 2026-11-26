# État de SAYLESS 2.0 — 25 novembre 2026 — API v1.3

Préparation sur `work/frontend-api-v1-2`, PR nº 2 en brouillon. Backend Claude `aab5270` intégré dans la préparation uniquement. [Contre-revue et résultats](REVUE-V1-3-WORK.md) ; [passation](HANDOFF-CLAUDE.md).

| Fonction | Réalisé et vérifié | Reste à valider |
| --- | --- | --- |
| Identité, logo, photos, lookbook, guide, barre rose | Direction artistique conservée, animation continue et pause/reprise, réduction des mouvements prévue. Aucun post-it. | Vrai iPhone/Safari, VoiceOver et mesures physiques du guide. |
| Catalogue et stock | Données serveur, `total_available`, états par taille, rupture/réservation/pause/panne distincts. Pas de quantité théorique injectée. | Inventaire physique S/M/L et D1 hébergée. |
| Livraison et devis | Une pièce, code postal, zone, relais avec adresse complète, devis 79,90 €/83,50 € vérifiés localement. | Transporteur réel, validation des tarifs, étiquette et expédition. |
| CGV et paiement | Version du devis exigée, refus si version publique différente, idempotence, reprise et états terminaux, statut confirmé par API. Paiement fermé par défaut. | Archive CGV obligatoire (B2), texte public identique (C1), Stripe TEST externe, Turnstile et wallets. |
| Suivi et demandes | Jeton en mémoire/Bearer, réponse neutre au lien demandé, formulaires contact/retour/rétractation, références après persistance, réseau incertain explicite. | Livraison réelle des e-mails, confirmation durable après erreur d'outbox (B1). |
| STUDIO et authentification | Écrans Claude conservés, 84 tests backend/STUDIO rejoués, ancienne récupération corrigée ; contrôle visuel desktop/mobile. | SimpleWebAuthn à coordonner ; Face ID réel, Safari, Web Push, accessibilité sur appareil. |
| Automatisations et sauvegardes | Code de Claude, tests locaux et quatre anciennes régressions réussis. | Services externes, budget CPU/quotas, restauration et surveillance hébergées, durée de conservation validée. |
| Cloudflare TEST | Build frontend séparé et fermé, bundle Pages/Worker compilé, procédure complémentaire. | Ressources TEST, secrets, accès et autorisation de déployer. |
| Aperçu privé | Version 5 publiée sur l’aperçu privé existant, boutique statique sans API active, aucun faux stock ni paiement. | Connexion propriétaire requise ; distinct de la recette Cloudflare. |

**172 tests passent, plus 13 assertions commerciales. Deux nouvelles régressions restent en échec et sont conservées : `npm run test:review:v13`.** Le tout n'est donc pas présenté comme une recette commerciale validée.

Manquent encore : inventaire exact par taille, mesures du vêtement, identité/statut/immatriculation et coordonnées du vendeur, TVA applicable, hébergeur contractuel, médiateur désigné, adresse et procédure de retour, délais transporteur, version juridique validée, durées de conservation et paramètres des services TEST. Ne pas inventer ces éléments. La liste administrative détaillée reste dans `INFORMATIONS-A-COMPLETER.md`.

Aucune fusion de PR ni modification de `main`, `v2`, du domaine, du DNS, de Stripe réel ou de la boutique publique.
