# Plan d’intégration commun — SAYLESS 2.0

Un seul backend, une seule source de vérité du stock, une seule gestion des commandes. Work garde la boutique et l’expérience client ; Claude garde le backend, la sécurité, les automatisations et SAYLESS STUDIO. Chacun peut proposer une amélioration dans l’autre périmètre, par la documentation ou une PR, sans l’appliquer seul.

## Architecture cible

```text
Client ──► saylessbrand.fr ─ Cloudflare Pages (dist-storefront, Work)
             └─ /api/*  ─► functions/api/[[path]].js ─┐
                                                       ├─► backend/src (code métier unique) ─► D1
Stripe ──► webhooks ─► ops/worker.mjs ─────────────────┤
Tâche de chaque minute ─► ops/worker.mjs ──────────────┘   balayage · envois · rapport 10 h · relances
Fondateur (iPhone, Mac) ─► studio.saylessbrand.fr (phase B : STUDIO + /api/admin, passkey Face ID)
```

- Même origine pour l’API publique : pas de CORS, pas de jeton dans le navigateur.
- Le Worker `ops/` porte ce qui déplace de l’argent ou du stock en dehors d’une visite (webhooks, balayage) : un déploiement de la boutique ne peut pas l’interrompre.
- Une base D1 par environnement (test, production) ; jamais de colonne « test/réel » dans une même base.
- Offres gratuites : 100 000 requêtes Workers/Pages Functions par jour, 10 ms de CPU par requête, 5 tâches planifiées par compte (une seule utilisée), D1 gratuit. Aucun abonnement nécessaire à ce stade.

## Phases

| Phase | Contenu | Responsable | Terminée quand |
| --- | --- | --- | --- |
| A — cette PR | Audit, contrat v1.1, backend unique, migrations, tests, compilation Cloudflare | Claude | Revue de Work et accord du fondateur |
| B | STUDIO fonctionnel à partir de la maquette validée (harmonisée avec `DESIGN-SYSTEM.md`). Déjà branchés : connexion Face ID, codes de secours, inventaire guidé. À suivre : commandes, stock, finances, notifications, pause | Claude | Tests + essai sur iPhone |
| C | Discord, notifications push, e-mails Resend en test, rapport quotidien, exports, sauvegardes | Claude | Messages testés et validés par le fondateur |
| D | Points relais, étiquettes et suivi (après pesée et choix du transporteur) | Claude | Bac à sable du transporteur |
| E | Raccordement de la boutique au contrat v1.1 | Work | Tests frontend + parcours complet |
| F | Environnement de test réel (Cloudflare gratuit, Stripe test) : tous les tests rejoués | Claude + fondateur | Rapport de recette |
| G | Mise en production : inventaire, clés de production, DNS sans coupure, lien 1.0, contact@ | Fondateur (autorisation explicite) | Check-list signée |

## Ce que Work doit raccorder (phase E)

1. **Parcours (validé par le fondateur)** : panier → livraison (domicile avec code postal, ou point relais réel choisi sur SAYLESS) → récapitulatif au montant exact renvoyé par `POST /api/quote` → CGV et Turnstile → « Payer » (`POST /api/checkout`) → page Stripe, qui collecte les coordonnées. L’étape « coordonnées » disparaît de la boutique.
2. **Une pièce par commande** (validé) : `max_items_per_order` vaut 1 ; désactiver « + » au-delà ; gérer `422 quantity_not_supported`. Le code reste multi-articles.
2 bis. **Zones** : afficher « Livraison en France métropolitaine, hors Corse pour le moment » ; demander le code postal pour le domicile ; gérer `postcode_required` et `destination_not_supported`.
2 ter. **Stock minimisé** : lire `total_available` pour le total affiché et `orderable` pour chaque taille ; `available` n’est plus qu’un alias transitoire.
3. **Retours de Stripe** : `/merci?ref=…&session_id=…` appelle `POST /api/checkout/status` et affiche « Confirmation en cours » tant que le statut est `pending` ou `processing` ; `/commande-annulee` n’envoie rien (le serveur libère lui-même). Sans `404.html`, Pages sert `index.html` sur ces chemins.
4. **Message de pause validé**, affiché quand `mode = paused` : « DROP 01 — TEMPORARILY UNAVAILABLE. / La boutique est momentanément indisponible. Retrouvez-nous prochainement sur saylessbrand.fr. / Instagram : @sayless.brand / SAY LESS. DO MORE. »
5. **Lecture du stock** : uniquement écran visible et vues produit, panier, paiement ; arrêt après 10 min sans interaction ; respecter `Retry-After`.
6. **Nouveaux codes d’erreur** (voir le contrat) : `quote_invalid`, `quote_mismatch`, `checkout_in_progress`, `attempt_closed`, `terms_outdated`, `hold_limit`, `quantity_not_supported`, `destination_not_supported`, `relay_unavailable`, `challenge_unavailable`, `not_configured`, `invalid_origin`, `unsupported_media_type`, `payload_too_large`.
7. **Retirer** la route `#/gestion` et le chargement de `admin.js` quand STUDIO est disponible.
8. `customer_token` n’est plus utilisé : il peut être retiré du client.
9. **Turnstile** : widget avec la clé publique (donnée à l’étape Cloudflare), nouveau jeton à chaque tentative ; une reprise avec la même clé d’idempotence n’en a pas besoin.
10. Propositions communes : déclarer `miniflare` en devDependency ; retirer Next/Vinext et les scripts `*:legacy` s’ils ne servent plus.

## Configuration guidée, une étape à la fois

Chaque étape est vérifiée avant la suivante. Aucune clé secrète ne transite par le chat ni par GitHub : le fondateur les saisit lui-même dans Cloudflare.

| Ordre | Étape | Dépend de | Statut |
| --- | --- | --- | --- |
| 1 | Inventaire physique S/M/L et pesée d’un colis emballé | — | En cours (fondateur) |
| 2 | Accès GitHub de Claude limité au dépôt `Ryaax93/sayless` (pousser la branche, ouvrir la PR) | — | Fait (PR brouillon n° 1) |
| 3 | Compte Cloudflare gratuit : base D1 de test, projets de test sans domaine | 2 | À faire |
| 4 | Stripe en mode test : clé restreinte et webhook de test, saisis dans Cloudflare | 3 | À faire |
| 5 | Discord : webhook d’un salon privé | 3 | À faire |
| 6 | Turnstile (gratuit) | 3 | À faire |
| 7 | Recette complète sur l’infrastructure de test | 1 à 6 | À faire |
| 8 | Production : lien 1.0 (limite = 2 + pièces disponibles, message SOLD OUT), Klarna et Google Pay, DNS, contact@, clés de production | 7 + autorisation | À faire |
