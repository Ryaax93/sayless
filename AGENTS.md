# Règles communes SAYLESS 2.0

Lire README.md, docs/OWNERSHIP.md, docs/API-CONTRACT.md et CHANGELOG.md avant de modifier.

- Ne jamais pousser sur main, fusionner vers main, publier, changer le domaine, activer un paiement réel ou engager une dépense sans accord explicite du fondateur.
- La branche v2 est une branche de préparation. Claude travaille sur claude/… ; Work sur work/… après ce dépôt initial. Les PR d’intégration ciblent v2.
- Aucun déploiement automatique ni CNAME dans v2. Ne pas activer d’intégration Git Cloudflare sans validation.
- Work possède la boutique. Claude possède backend, base, opérations et SAYLESS STUDIO. Respecter la matrice docs/OWNERSHIP.md ; proposer une modification de l’autre périmètre dans la documentation commune ou une PR, sans l’appliquer unilatéralement.
- Un seul backend et une seule administration cibles. Les anciens server/, drizzle/ et public/store/admin.js sont des sources historiques transmises à Claude, pas des services concurrents à maintenir.
- Aucun secret, export Stripe, adresse client, base réelle, journal ou rapport financier dans Git. Utiliser des secrets serveur, jamais des variables publiques.
- Aucun stock inventé. 26 est théorique ; inventaire physique S/M/L à confirmer. Le serveur fait autorité pour prix, stock, livraison et total. Une indisponibilité bloque le paiement.
- Conserver le design noir/blanc/rose, les véritables ressources et les textes validés. Pas de post-it flottant, faux avis, fausse urgence ni quantité par taille affichée aux clients.
- Documenter toute modification dans CHANGELOG.md, avec son état réel et les tests pertinents. Ne pas appeler « fonctionnel » un connecteur absent ni « testé » un parcours seulement simulé.
