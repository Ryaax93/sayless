# Recette de la boutique intégrée

## Résultats locaux du 25 novembre 2026

| Vérification | Résultat attendu sur la préparation |
| --- | --- |
| Boutique (Node) | 39 tests sur le client du contrat v1.2, le stock, les écrans, les tentatives, les retours, le site portable et son absence de paiement direct. |
| Assertions commerciales | 13 vérifications de prix de présentation, de frais et du plafond. |
| Inventaire hérité | 16 tests sur le prototype de référence. |
| Backend et STUDIO de Claude | 57 tests sur Miniflare, stock, concurrence, notifications, remboursements, sauvegardes ordinaires et passkeys. |
| Boutique avec routeur et D1 locale | 8 scénarios croisés avec des doubles Stripe et transporteur. |
| Compilations locales | Boutique statique, STUDIO, Worker en dry-run et Pages Functions. |
| Contrôles de revue, hors test nominal | 3 échecs métier sur le commit Claude examiné. Consulter la revue pour les résultats obtenus et attendus. Le défaut de récupération STUDIO a été vérifié séparément. |

Les suites nominales se lancent par `npm test`. Les trois critères ouverts se lancent par `npm run test:review`. Les prix de 79,90 € et 83,50 €, l’échec réseau, la réservation existante, un devis expiré, le double clic, les CGV, le code postal, le statut en attente et le paiement confirmé sont couverts. Les contrôles d’exploitation n’utilisent aucune donnée client.

La recette dans Chrome a couvert le panier, deux formats de page (390 et 1 440 px), les deux modes de livraison, les totaux et la commande de pause de la barre. La vérification sur iPhone et le contrôle d’accessibilité avec VoiceOver restent à réaliser.

Les 31 tests Node du dépôt initial (15 boutique et 16 inventaire) et les 13 assertions commerciales avaient également été rejoués sur le commit Claude, avant le raccordement.

## À réaliser avec Claude, avant toute vente

- Inventaire physique S/M/L confirmé ; pas de quantité fabriquée pour faire passer un test.
- 200 tentatives simultanées sur la dernière pièce sur D1 de test ; une seule réservation ; tests multi-lignes et multi-variantes.
- Prix, quantité, frais de port et relais falsifiés dans le navigateur : refus/recalcul serveur ; devis expiré et choix modifié.
- Paiement Stripe test, webhook signé exact/corps modifié, signature expirée, notifications dupliquées/désordonnées, double clic et redirection avant webhook.
- Échec réseau après réservation et après création de session ; reprise idempotente ; état inconnu sans double réservation ni libération prématurée.
- Abandon, paiement différé, expiration, annulation et réconciliation de secours.
- Remboursement sans restock automatique ; retour physique validé une fois ; motif journalisé.
- Relais réel fermé ou non admissible, changement de mode, absence de fournisseur ; adresse et identifiant sur commande/étiquette.
- Suivi non énumérable, jeton expiré, contrôle d’accès ; aucune PII dans URLs/logs/Discord.
- Accusé de réception durable des demandes et rétractations, zéro faux succès en cas de panne.
- Chaque alerte Discord une fois ; e-mails Resend, étiquette/suivi Boxtal en test ; quotas et retries bornés.
- Authentification Studio sur iPhone et ordinateur, accès interdit sans droits, journal des actions et procédure de restauration.
- Audit juridique des renseignements réels et des textes avant vente ; vérification des zones et délais.
- SEO réel, URLs, sitemap, OG, données structurées fiables, budget performance, accessibilité et compatibilité Safari iPhone.
- Commande réelle de bout en bout uniquement après autorisation explicite du fondateur ; plan de retour vers la 1.0 en vitrine sans vente à valider, avec contrôle de l’ancien lien Stripe.
