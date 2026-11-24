# Audit de SAYLESS 2.0 et intégration du backend — Claude

**Base auditée : branche `v2`, commit `3dc079b95e0bb7ef42124c0b39936eb5e84a5419` (24 novembre 2026).**
Travail livré sur `claude/integration-v2`. Rien n’est déployé ; `main`, le domaine, Stripe et le site publié sont inchangés.

## 1. En bref

- La boutique de Work est saine et prête à être raccordée : client API strict (stock vérifié et frais de moins de 30 s, aucun prix envoyé par le navigateur, redirection limitée à `checkout.stripe.com`), états de stock distincts, message SOLD OUT conditionné à une confirmation serveur.
- Le backend hérité (`server/`, `drizzle/`, `public/store/admin.js`) contient de bonnes protections, mais il est incompatible avec la cible : total de 26 imposé, administration liée aux en-têtes de l’hébergeur de l’aperçu, environnement mêlé dans une colonne `scope`, runtime Vinext, et il lui manque le balayage, les alertes, le registre immuable, le lien 1.0, etc.
- Résultat : **un seul backend** (`backend/`), **une seule source de vérité du stock** (registre en ajout seul), **une seule gestion des commandes**. Les protections de Work et les 29 scénarios de Claude y sont repris et testés.

## 2. Ce qui a réellement été vérifié

| Vérification | Résultat | Limite |
| --- | --- | --- |
| `npm ci` puis tests existants de Work | 15/15 frontend (+ 13 assertions) et 16/16 hérités | Node 22, D1 locale |
| Nouveaux tests `npm run test:backend` | 45/45 : 28 scénarios portés, 13 tests de parité avec Work, 4 tests de contrat ; 1 scénario à porter (Face ID, phase B) | D1 locale (Miniflare). Stripe, transporteur, relais et Discord **simulés** |
| Contrat avec le vrai client de la boutique | `public/store/api-client.js` exécuté contre le vrai serveur : stock (disponible, réservé, SOLD OUT, inconnu), devis, checkout idempotent, refus d’un devis modifié | Aucun navigateur réel |
| Compilation Cloudflare (`npm run check:cloudflare`) | Worker `ops/` (41,6 Kio, 12,2 Kio compressé) et Pages Functions compilés | Aucun envoi vers Cloudflare |
| Essai local dans le moteur Cloudflare (workerd, `wrangler dev` / `pages dev`) | Migrations appliquées par wrangler ; `/api/stock`, devis signé, refus de 2 pièces, relais non raccordé, paiement fermé, origine étrangère refusée, tâche planifiée et rapport de 10 h | Base locale jetable, quantités de test |
| Non vérifié | Cloudflare réel, Stripe en mode test réel, transporteur, Discord réel, e-mails, iPhone | Phase F |

## 3. Inventaire de la v2 et décision

| Élément | Responsable | Constat | Décision |
| --- | --- | --- | --- |
| `public/store/` (hors `admin.js`) | Work | Design, textes et parcours validés | Conserver ; raccorder selon `INTEGRATION-PLAN.md` |
| `public/store/api-client.js` | Work | Contrat v1 strict et bien testé | Conserver ; ajustements v1.1 mineurs |
| `public/store/admin.js` + route `#/gestion` | Claude | Ancienne administration dans la boutique | Retirer quand STUDIO la remplace (route à supprimer par Work) |
| `data/products.json` | Commun | Prix 7500, SKU S/M/L, livraison 490/850 | Source éditoriale. D1 fait foi pour le montant payable ; un test garde les deux identiques |
| `server/`, `db/`, `drizzle/` | Claude | Prototype hérité | Remplacés par `backend/` ; retrait dans une PR séparée après validation (l’historique reste dans Git) |
| `app/`, `worker/index.ts`, `lib/connector-*`, dépendances Next/React/Vinext, scripts `*:legacy` | Commun | Échafaudage de l’outil de création | Inutiles pour la cible ; retrait proposé à Work |
| `tests/inventory.test.mjs` | Claude | 16 tests du prototype | Conservés tant que `server/` existe ; intentions portées (W01–W16) |

## 4. Incompatibilités et résolution

| # | Incompatibilité | Risque | Résolution dans `backend/` |
| --- | --- | --- | --- |
| 1 | Total initial imposé (`initial_total_must_be_26`) | Inventaire réel impossible s’il diffère de 26 | Inventaire guidé par taille, sans total imposé ; écart avec 26 noté (W01) |
| 2 | Administration par en-têtes `oai-authenticated-user-*` | Absents sur Cloudflare | STUDIO sur son origine, passkey Face ID et sessions révocables (phase B) |
| 3 | Colonne `scope` real/test dans une même base | Mélange test/réel | Bases D1 séparées ; clé Stripe acceptée seulement si elle correspond à l’environnement (W16) |
| 4 | `/api/inventory` et variantes UUID | Deux contrats | Seul `/api/stock` (contrat de Work), SKU partout |
| 5 | Runtime Vinext/Next | Deux serveurs | Boutique statique + `functions/` ; `ops/` pour webhooks et tâches |
| 6 | Prix 7500 codé en dur dans la session Stripe | Divergence de prix | Prix relu dans D1 à chaque devis et checkout (`price_changed`) |
| 7 | Coordonnées client dans le devis (`customer_token`) | Données personnelles stockées avant paiement | Devis signé sans donnée personnelle ; Stripe collecte e-mail, nom, téléphone et adresse |
| 8 | Moyens de paiement par défaut du compte (Klarna actif, Google Pay coupé) | Klarna proposé malgré la décision | `payment_method_types[card]` dans chaque session : carte et portefeuilles, sans modifier le compte Stripe |
| 9 | Retour Stripe vers `/#/gestion` | Pas de confirmation client | `/merci?ref=…&session_id=…`, endpoint de statut, `/commande-annulee` |
| 10 | Pas de balayage, d’alertes, de registre immuable, de limites d’abus, de Turnstile serveur, de suivi relais, d’import, d’export ni de purge | Trous fonctionnels | Ajoutés et testés |
| 11 | `miniflare` utilisé sans être déclaré (dépendance de wrangler) | Casse possible à une mise à jour | Proposition commune : le déclarer en devDependency |
| 12 | Lecture du stock toutes les 20 s | Chaque lecture compte dans les 100 000 requêtes/jour gratuites ; au-delà, le stock devient « indisponible » et les ventes se bloquent (sans survente) | Lire seulement écran visible et vues d’achat, s’arrêter après 10 min d’inactivité ; surveiller le quota |

## 5. Doublons supprimés

| Sujet | Avant | Après |
| --- | --- | --- |
| Stock | `variants.available/reserved` du prototype et modèle de la preuve de concept | Table `inventory` modifiée uniquement par le registre `stock_movements` |
| Commandes | Deux schémas | Une table `orders` multi-lignes, réservations par ligne |
| Administration | `admin.js` dans la boutique et STUDIO | STUDIO seul, sur une origine séparée |
| Migrations | drizzle-kit et SQL de démonstration | `backend/migrations` (migrations D1 de wrangler) |
| Prix | Constantes, JSON et session Stripe | D1 pour le montant payable ; JSON éditorial ; test de cohérence (C03) |
| Identifiants | UUID seul | UUID interne, numéro séquentiel attribué au paiement (0001…), référence publique aléatoire `SL-XXXX-XXXX` |

## 6. Repris de Work et apporté par Claude

**Repris de Work** : lignes multiples ; empreinte d’idempotence (conflit si le contenu change) ; signature vérifiée sur le corps brut avec plusieurs `v1` et 300 s de tolérance ; relecture de la session avec ses lignes ; contrôle du montant, de la devise et des lignes ; compare-and-swap sur la révision ; « expirer puis relire » ; paiement après libération mis à l’examen ; remboursement sans remise en stock ; tests Miniflare.

**Apporté par Claude** : registre immuable et déclencheurs ; transitions gardées par la base ; SOLD OUT uniquement quand toutes les pièces sont vendues (une réservation n’est jamais une rupture) ; libération seulement après confirmation par Stripe ; session retrouvée par sa clé après une réponse perdue ; balayage chaque minute ; filet de sécurité pour le lien 1.0 ; import des ventes passées sans double décompte ; notifications sans donnée personnelle ; file Discord ; rapport de 10 h (heure de Paris) ; étiquettes sans double achat ; suivi relais « disponible » distinct de « retiré » ; retours contrôlés ; livre des recettes ; coordonnées chiffrées et purgeables ; sauvegarde et restauration testées ; Turnstile vérifié côté serveur ; limites d’abus.

## 7. Correspondance des tests (aucune couverture perdue)

| Origine | Nouveau test |
| --- | --- |
| Scénarios Claude t01–t27, t29 | `tests/backend/scenarios.test.mjs`, même numéro |
| t28 Face ID, sessions, codes de secours | À porter avec l’authentification STUDIO (phase B) ; le scénario reste vert dans la preuve de concept |
| Work 1, 2, 3, 4, 5, 7, 9, 10, 11, 13, 14, 15, 16 | `tests/backend/parity.test.mjs`, W01–W16 |
| Work 6 (doublons et désordre) | t02, t07 |
| Work 8 (abandon, échec, différé) | t03, t06 |
| Work 12 (annulation et paiement concurrent) | t05 |
| Work 15, volet administration | Avec STUDIO (phase B) ; volet écritures inter-sites couvert par W15 |
| Contrat boutique ↔ serveur | C01–C04 |

## 8. Décisions à prendre par le fondateur

1. **Une pièce par commande au lancement** tant que le tarif multi-pièces n’est pas fixé (le serveur refuse au-delà) : à confirmer.
2. **Coordonnées saisies sur la page Stripe** (recommandé : moins de données chez SAYLESS avant paiement, Apple Pay remplit tout) ou maintien de l’étape « coordonnées » de la boutique.
3. **Zones livrées** : France métropolitaine ; Corse et Monaco à confirmer avec le transporteur ; outre-mer exclu.
4. **Transporteur et points relais** : choix après la pesée.
5. **Durée de conservation des coordonnées** (la purge est prête ; la comptabilité reste 10 ans).
6. **Quantités par taille dans la réponse réseau de `/api/stock`** : jamais affichées à l’écran, mais lisibles par un curieux. À garder ou à masquer.
7. **Sauvegardes hors Cloudflare** : D1 garde 7 jours d’historique gratuitement ; une copie externe demande de choisir un support (R2 exige un moyen de paiement).
