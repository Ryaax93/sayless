# Architecture SAYLESS 2.0 — état v1.4

La boutique est un site HTML/CSS/JavaScript autonome. `scripts/dev-storefront.mjs` permet une consultation sans dépendance ; les API y répondent explicitement indisponibles. `scripts/build-storefront.mjs` produit `dist-storefront/` à partir de `public/` et `data/`. Aucun runtime Next/Vinext n'est requis.

## Architecture cible conservée

| Couche | Code et responsabilité | Exécution prévue |
| --- | --- | --- |
| Boutique | `public/store/`, Work | Cloudflare Pages, ressources statiques |
| API publique de même origine | `functions/api/[[path]].js`, Claude | Pages Functions, importe le backend commun |
| Logique métier et état | `backend/src/`, `backend/migrations/`, Claude | Worker/Pages Functions + D1 |
| Exploitation, webhooks, cron | `ops/`, Claude | Worker distinct, même D1 par environnement |
| Administration | `studio/`, Claude | Ressources STUDIO servies par le Worker |
| Référence historique | `tests/legacy-fixtures/` | Uniquement les 16 tests historiques, jamais déployée |

Le serveur fait autorité pour prix, devis, stock par variante, réservations et total. La boutique n'initialise jamais une quantité d'après un texte du fondateur. Stripe recueille les coordonnées après sélection du mode de livraison et d'un éventuel vrai relais sur SAYLESS. Une pièce maximum pour DROP 01, zone France métropolitaine hors Corse. L'ajout de produits/drops/couleurs est prévu dans le modèle serveur ; une refonte multi-produits de la présentation n'est pas ajoutée à cette stabilisation.

## CGV et parcours v1.4

Le devis signé contient version, empreinte et URL de l'archive. La boutique télécharge le document exact, vérifie SHA-256 avec Web Crypto et le rend par `textContent`. Le consentement est rattaché au devis. Une relecture avant toute nouvelle réservation bloque le paiement en cas de changement ou de panne. La reprise garde la même clé et le consentement originel ; le serveur résout la tentative avant d'exiger les CGV courantes. Le statut de retour Stripe provient de l'API, jamais du seul paramètre d'URL.

Suivi par jeton en mémoire et Bearer ; demandes clients avec référence persistée et traitement explicite des erreurs réseau. Intentions d'e-mails transactionnelles puis outbox chiffrée. Reste le cas de livraison incertaine au-delà de la fenêtre Resend : voir [contre-audit](REVUE-V1-4-WORK.md).

## Frontières et limites

- Un seul backend et un seul STUDIO. Aucun fichier métier Claude modifié dans le raccordement Work.
- Next, React, Vinext, Vite, Drizzle, connecteurs de prévisualisation hérités et leurs configurations ne sont plus importés par les points d'entrée retenus : retirés avec l'accord de Claude, historique Git conservé.
- Les modules historiques utiles ont été déplacés sans changement métier dans les fixtures ; aucune ancienne migration n'est appliquée à D1 cible.
- Pas d'intégration Git de déploiement, pas de CNAME, pas de domaine ou de DNS modifié. Le manifeste de l'ancien hébergeur retiré de cette copie GitHub ne modifie pas l'aperçu déjà hébergé.
- Ressources TEST séparées, paiement frontend fermé par défaut, mode staging côté serveur. Noindex conservé pour la recette.
- Stripe TEST externe, Boxtal, Resend, Discord, iPhone et quotas CPU/volumes ne sont pas validés par les seuls tests locaux. [Procédure](POWERSHELL-TEST-V1-4.md).
- Routes hash et référencement commercial final restent à valider avant lancement. Aucune réécriture graphique ni nouveau périmètre commercial ajouté.

Le snapshot d'origine `docs/source-snapshot.json` documente la provenance historique, pas les empreintes de la version actuelle.
