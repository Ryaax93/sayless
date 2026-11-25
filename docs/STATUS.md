# État de SAYLESS 2.0 au 25 novembre 2026

La préparation `work/frontend-api-v1-2` contient la boutique intégrée au contrat v1.2 et les trois commits de la PR nº 1. La [revue](REVUE-PR-1-WORK.md) détaille quatre corrections à obtenir avant fusion.

| Fonction | Résultat sur la préparation | Étape restante |
| --- | --- | --- |
| Identité, photos, lookbook, barre rose animée, guide, pages secondaires | Design conservé. Logo officiel dans la barre, commande pause/reprise. Aucun post-it flottant. | Recette sur Safari et vrai iPhone. |
| Catalogue et stock | API du catalogue et du stock raccordées. La barre et la fiche partagent le total vérifié, chaque taille expose un état de disponibilité. | Inventaire physique et saisie S/M/L. Aucun chiffre théorique publié comme disponible. |
| Panier et livraison | Une pièce, zone et code postal contrôlés, sélection explicite du mode et du relais. | Compte et tarifs du transporteur, points réels et adresse complète vérifiés. |
| Devis et récapitulatif | Total serveur, CGV, renouvellement anti-abus et reprise de la même tentative testés localement. | Version de CGV validée, clé publique Turnstile et Siteverify en environnement de test. |
| Réservation, paiement, retour | Vrai code backend sur D1 locale, Stripe simulé. Le client vérifie le statut avec référence et session. | Corrections de reprise et des ventes 1.0, Stripe test hébergé, wallets sur appareils compatibles. |
| STUDIO | Code de Claude et tests locaux des passkeys, des codes de secours, des sessions et de l’inventaire. | Révocation après récupération, test sur appareil, puis prochains écrans du plan. |
| Données, commandes, notifications | Migrations, journal, chiffrement et opérations présents. | Sauvegardes cohérentes, conservation validée, confirmations durables, expéditions, suivi, Discord et Resend réels. |
| Formulaires, rétractation et contact | Les formulaires préparent un e-mail. Le suivi indique l’indisponibilité du service quand il répond 503. | Réception et preuves durables, mentions vendeur, médiateur, adresse de retour et délais. |

L’infrastructure hébergée, les paiements réels et le site officiel ne font pas partie de cette recette.
