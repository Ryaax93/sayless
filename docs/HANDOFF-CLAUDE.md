# À transmettre à Claude

La préparation `work/frontend-api-v1-2` consomme le contrat v1.2 livré dans `claude/integration-v2` au commit `c6c9db1`. La boutique et STUDIO conservent leurs responsabilités et la direction artistique validée.

1. Corriger la récupération de STUDIO, la datation et le filtrage des ventes 1.0, la reprise idempotente après l’expiration du devis et la cohérence transactionnelle des sauvegardes. Les résultats attendus sont détaillés dans la [revue de la PR nº 1](REVUE-PR-1-WORK.md).
2. Aligner le refus serveur sur l’intégralité de l’inventaire vérifié. Rendre la version publiée des CGV et le chiffrement des coordonnées obligatoires à l’ouverture. Convenons ensemble d’une version de CGV dans le devis signé. Garder `orderable`, `total_available`, les erreurs structurées, `Retry-After` et la paire référence/session du contrat.
3. Vérifier la version des CGV présentée au client et la clé **publique** Turnstile avec Work. Les valeurs publiques se trouvent dans `public/store/config.js`. Le serveur conserve ses contrôles indépendants. Les secrets des prestataires restent dans l’environnement serveur désigné.
4. Remplacer le fournisseur de relais de recette par le transporteur retenu. Confirmer les tarifs, l’identifiant stable, l’adresse complète, la disponibilité du point, son instantané à la commande, l’étiquette et le suivi. Le sélecteur de la boutique utilise les données reçues sur `/api/relay-points`. Le domicile doit toujours rester un choix explicite.
5. Raccorder les routes de suivi et de demandes au stockage et aux e-mails. Retourner un accusé durable seulement après prise en charge. Aujourd’hui, `/api/order/lookup`, `/api/order` et `/api/requests` répondent `503 not_configured`. Les formulaires de contact et de rétractation permettent de préparer un e-mail.
6. Rejouer `npm test`, `npm run test:review` et `npm run check:cloudflare` sur la préparation corrigée. Ajouter la régression de récupération dans les tests STUDIO. Sur autorisation du fondateur, effectuer ensuite la recette sur D1 hébergée, Stripe **test**, Turnstile et le bac à sable transporteur. Vérifier Safari/iPhone, les wallets compatibles et VoiceOver.
7. Maintenir la règle du DROP 01 : une pièce, 75 € TTC hors livraison, 4,90 € relais ou 8,50 € domicile sous réserve de validation du transporteur, France métropolitaine hors Corse. Les coordonnées sont recueillies sur Stripe. L’activation de Klarna est exclue.

Pour relire uniquement les changements boutique, exécuter `git diff c6c9db1...work/frontend-api-v1-2` avec les deux références récupérées. Toute correction Claude peut être présentée sur une branche `claude/…` ; Work réappliquera ses vérifications sur le SHA proposé. Le fondateur décide des fusions et de toute publication.

[Contrat](API-CONTRACT.md) · [Responsabilités](OWNERSHIP.md) · [Design system pour STUDIO](DESIGN-SYSTEM.md) · [Recette](TEST-PLAN.md)
