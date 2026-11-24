# Contrôles de cet export — 24 novembre 2026

## Réalisés localement

- Copie séparée des 70 fichiers suivis de la source v4, sans historique privé, base, secrets ou dépendances préinstallées.
- Installation depuis `package-lock.json` : `npm ci --ignore-scripts --no-audit --no-fund` réussie (683 paquets). L’essai hors ligne ne suffisait pas ; l’installation normale a réussi.
- 15 tests frontend Node et 13 vérifications commerciales réussis.
- 16 tests du prototype historique réussis sur Miniflare/D1 locale, sans requête Stripe réelle.
- Lancement indépendant par Node, fichiers publics disponibles, toutes les API en 503, fichiers internes inaccessibles.
- Build statique réussi sans publication.
- Contrôle navigateur local : accueil, logo et photos conservés ; fiche produit et retours lisibles dans une fenêtre de 390 px ; structure de 1440 px sans débordement horizontal de la page. Ces tailles sont des cadres de test dans Chromium, pas des essais sur iPhone physique.
- Barre animée : positions différentes entre deux observations, groupes de même largeur, état Pause disponible et animation en marche à la fin. La réduction des animations est conservée dans le CSS ; essai système/iPhone à compléter.
- Sans backend : « Stock à confirmer », aucune quantité théorique affichée, ajout au panier désactivé, aucun faux SOLD OUT.
- Textes légaux existants préservés ; informations manquantes recensées. Ceci ne constitue pas une validation juridique.
- Contrôle des ressources locales et des motifs de secrets avant transfert. Aucun fichier de données clients ni configuration de déploiement automatique ajouté.

## Limites des preuves

Les tests sont locaux. Aucun paiement, vrai point relais, e-mail, alerte Discord, passkey, push iPhone ni déploiement distant n’a été testé ou activé. Les 23 scénarios annoncés dans le rapport de Claude ne sont pas inclus ni confondus avec ces tests.

La vérification GitHub finale consiste à relire la référence v2 et à comparer chemin, mode et empreinte Git de chaque fichier avec la copie transférée ; vérifier également main, CNAME, historique des exécutions et version publiée de l’aperçu. Son résultat et l’identifiant du commit sont fournis au fondateur après le dépôt, sans prétendre à un audit de tous les réglages administratifs GitHub Pages.

La recette complète multi-navigateurs, accessibilité, performances et intégrations est décrite dans TEST-PLAN.md. La dépendance historique Vinext n’est pas une dépendance du lancement statique portable.
