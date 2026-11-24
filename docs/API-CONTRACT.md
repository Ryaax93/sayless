# Contrat commun de la boutique — v1.1

**Statut : v1 proposée par Work le 24 novembre 2026 ; v1.1 = revue de Claude, implémentée dans `backend/` et testée sur D1 locale (dont le vrai `api-client.js` contre le vrai serveur).** Rien n’est déployé. À valider par Work (client) et par le fondateur pour les points commerciaux marqués ★. Le paiement reste fermé par défaut (`payments_enabled = 0`, boutique en pause).

## Changements v1.1 (Claude)

- Stock, catalogue, checkout, idempotence, CGV, Turnstile, relais et réponses d’erreur de la v1 : **confirmés**.
- Devis **sans donnée personnelle** : jeton signé par le serveur, rien n’est stocké avant le paiement. `customer_token` devient inutile. Les coordonnées sont saisies sur la page Stripe ★.
- **Une pièce par commande** tant que la tarification multi-pièces n’est pas validée ★ (`422 quantity_not_supported`).
- Ajout de `POST /api/checkout/status` pour la page `/merci`.
- Ajout de codes d’erreur : `quote_invalid`, `quote_mismatch`, `checkout_in_progress`, `attempt_closed`, `terms_outdated`, `hold_limit`, `quantity_not_supported`, `destination_not_supported`, `relay_unavailable`, `challenge_unavailable`, `not_configured`, `invalid_origin`, `unsupported_media_type`, `payload_too_large`.
- Message de pause validé par le fondateur ; lecture du stock limitée aux vues d’achat (quota gratuit).
- Moyens de paiement fixés par la session : carte, Apple Pay et Google Pay ; pas de Klarna.

## Principes

- Même origine `/api`, HTTPS, JSON UTF-8, montants entiers en centimes, devise `EUR`, dates ISO 8601 UTC.
- Le serveur relit catalogue, prix, stock, destination et livraison. Il ignore tout prix envoyé par le client. Un devis expiré est recalculé et représenté avant paiement.
- `Cache-Control: no-store` sur toutes les réponses. Aucune donnée personnelle ni secret dans une URL, un journal, Discord ou un cache.
- Timeout navigateur de 5 secondes ; pas de nouvel essai aveugle d’une mutation. Une reprise de checkout réutilise la même clé d’idempotence et le même contenu.
- Toute quantité inconnue reste absente, jamais zéro par défaut. Une panne bloque le paiement avec un message neutre.
- Écritures (`POST`) : en-tête `Origin` identique à l’origine de l’API (`403 invalid_origin`), `Content-Type: application/json` (`415`), 16 Kio maximum (`413`), limitation d’abus par client (`429` + `Retry-After`). Aucune adresse IP n’est stockée : le serveur garde une empreinte qui change chaque jour.

## Catalogue

`GET /api/catalog` : `data/products.json` (version 1) publié par le serveur, limité aux produits publiés ; `price_cents` est relu dans D1, qui fait foi pour le montant payable. Un test garde D1 et le JSON identiques (prix, SKU, livraison). Aucune quantité dans le catalogue. STUDIO deviendra l’éditeur du catalogue (drops et brouillons) sans créer de second catalogue.

## Stock

`GET /api/stock?product_id=pink-001` retourne un instantané complet des variantes du produit.

```json
{
  "verified": true,
  "mode": "open | paused",
  "updated_at": "<instant de lecture serveur>",
  "checkout_enabled": false,
  "drop_status": "available | held | sold_out | unavailable",
  "variants": [
    {"sku": "ZH-PINK-S", "available": "<entier >= 0>", "state": "available | held | sold_out | unavailable"}
  ]
}
```

Règles serveur (implémentées) :

- `available` = pièces présentes − pièces en cours de paiement. `state = available` si `available > 0` ; `held` si 0 mais des pièces sont réservées ; `sold_out` si plus aucune pièce présente ; `unavailable` tant que l’inventaire physique de la taille n’est pas confirmé dans STUDIO.
- `verified` n’est vrai que si toutes les tailles du produit sont confirmées et la base lisible ; sinon `drop_status = unavailable` et `503 stock_unavailable` au devis.
- `drop_status = sold_out` exige **tout le drop** confirmé et vendu. Une pièce seulement réservée donne `held`, jamais SOLD OUT. Le message « DROP 01 — SOLD OUT. » reste conditionné à cet état.
- `checkout_enabled` = vérifié, boutique ouverte, paiements ouverts par le fondateur et `drop_status = available`.
- `mode = paused` : la boutique masque le total, bloque l’achat et affiche le message validé : « DROP 01 — TEMPORARILY UNAVAILABLE. / La boutique est momentanément indisponible. Retrouvez-nous prochainement sur saylessbrand.fr. / Instagram : @sayless.brand / SAY LESS. DO MORE. »
- Le frontend n’affiche jamais de quantité par taille. Elles restent lisibles dans la réponse réseau ★ (à masquer si le fondateur le souhaite).
- Fraîcheur acceptée : 30 secondes. Lecture toutes les 20 secondes **uniquement** écran visible et vues produit, panier ou paiement ; arrêt après 10 minutes d’inactivité. Chaque lecture compte dans le quota gratuit de 100 000 requêtes par jour.

## Livraison et devis

`POST /api/quote` :

```json
{"items": [{"sku": "ZH-PINK-M", "quantity": 1}], "shipping": "home | relay", "relay_id": null, "country": "FR"}
```

Aucune coordonnée personnelle. Réponse :

```json
{
  "id": "<jeton opaque signé>",
  "currency": "EUR",
  "items": [{"sku": "ZH-PINK-M", "quantity": 1, "unit_price_cents": 7500, "line_total_cents": 7500}],
  "subtotal_cents": 7500,
  "shipping_cents": 850,
  "total_cents": 8350,
  "shipping": "home",
  "relay": null,
  "expires_at": "<ISO, 10 minutes>"
}
```

- Le récapitulatif affiché avant « Payer » est **cette réponse**. Le devis n’écrit rien en base.
- Tarifs validés pour une pièce : relais 490, domicile 850. Paniers de plusieurs pièces refusés (`422 quantity_not_supported`, champ `max_items`) tant que la grille n’est pas validée ★.
- Destination : `FR` uniquement (`422 destination_not_supported`) ; Corse et Monaco à confirmer avec le transporteur ★.
- Relais : `relay_id` revérifié auprès du fournisseur (ouvert, pays). Sans fournisseur raccordé : `503 relay_unavailable` ; ne pas basculer seul vers le domicile.
- Coordonnées ★ : e-mail, nom, téléphone et adresse (domicile) sont saisis sur la page Stripe, puis enregistrés chiffrés après le paiement. Rien n’est conservé avant. Si le fondateur préfère garder l’étape « coordonnées » de la boutique, ces données transiteront au checkout sans être stockées : à revoir ensemble.

## Points relais

`GET /api/relay-points?postcode=75016&country=FR` → `{"points": [{"id", "name", "network", …}]}` depuis le fournisseur choisi après la pesée. Choix accessible en liste en complément d’une carte. Aucun point fictif. Fournisseur absent : `503 relay_unavailable`.

## Checkout Stripe

`POST /api/checkout`, en-tête `Idempotency-Key` (16 à 100 caractères `A-Z a-z 0-9 _ -`), stable pour une tentative :

```json
{
  "items": [{"sku": "ZH-PINK-M", "quantity": 1}],
  "shipping": "home",
  "relay_id": null,
  "quote_id": "<id du devis>",
  "terms_version": "<version acceptée des CGV>",
  "turnstile": "<jeton anti-abus>"
}
```

Côté serveur, dans l’ordre : devis signé et non expiré ; contenu identique au devis (`quote_mismatch`) ; CGV ; reprise si la clé existe déjà (même contenu → même session, sans nouveau Turnstile ; contenu différent → `idempotency_conflict`) ; boutique ouverte ; paiements ouverts ; limite d’abus ; Turnstile ; prix relus (`price_changed`) ; puis, en un lot atomique, commande, lignes et réservations. Ensuite la session Stripe est créée avec la clé `sayless-checkout-<commande>` : carte uniquement (Apple Pay et Google Pay compris), sans Klarna, expiration à 30,5 minutes ; la réservation dure 32 minutes.

Une réponse Stripe incertaine garde la réservation : seule une confirmation par Stripe (session retrouvée par sa clé puis expirée, ou refus explicite) la libère.

Réponse : `{"url": "https://checkout.stripe.com/...", "order_reference": "SL-XXXX-XXXX", "expires_at": "ISO"}`.

| Réponse | Comportement client |
| --- | --- |
| 409 `sold_out` | Actualiser le stock, indiquer la taille épuisée ; ne pas conclure que tout le drop est terminé |
| 409 `held` | « Cette pièce est réservée temporairement. Réessaie dans un instant. » |
| 409 `quote_expired`, `quote_invalid`, `price_changed`, `quote_mismatch` | Recalculer le devis, l’afficher et redemander « Payer » |
| 409 `idempotency_conflict` | Ne pas réessayer automatiquement ; nouvelle tentative avec une nouvelle clé |
| 409 `checkout_in_progress` | Réessayer avec la même clé après `Retry-After` (2 s) |
| 409 `attempt_closed` | La tentative est terminée (`order_reference` fourni) : nouvelle clé et nouveau devis |
| 409 `terms_outdated` | Recharger les CGV et redemander l’acceptation |
| 422 `invalid_items`, `quantity_not_supported`, `destination_not_supported` | Corriger le panier ou la destination |
| 422 `invalid_relay` / `relay_required` | Revenir au choix du relais |
| 503 `stock_unavailable`, `service_unavailable`, `not_configured` | Aucun compteur certain ni paiement ; proposer de réessayer |
| 503 `relay_unavailable` | Désactiver le mode relais |
| 503 `paused` / `unavailable` | Fermeture temporaire : message de pause, jamais SOLD OUT |
| 403 `payments_disabled` | Ventes non ouvertes ; aucun contournement |
| 403 `challenge_failed` / `challenge_required`, 503 `challenge_unavailable` | Refaire le contrôle anti-abus ; aucune réservation créée |
| 403 `invalid_origin`, 415, 413 | Erreur d’intégration |
| 429 `rate_limited`, `hold_limit` | Message neutre, respecter `Retry-After` ; `hold_limit` : pièces déjà en cours de paiement pour ce client |

## Confirmation, annulation, commandes et suivi

- Retour Stripe : `/merci?ref=<order_reference>&session_id={CHECKOUT_SESSION_ID}` et `/commande-annulee?ref=<order_reference>`.
- `POST /api/checkout/status` avec `{"order_reference", "session_id"}` (les deux sont exigés ensemble) → `{"order_reference", "payment_status": "pending | processing | paid | review | expired | failed | refunded", "updated_at"}`. Aucune donnée personnelle. Le serveur peut relire Stripe pour accélérer la confirmation. Afficher « Confirmation en cours » tant que `pending` ou `processing`.
- L’annulation dans le navigateur ne libère rien : expiration, confirmation Stripe et balayage font autorité.
- `POST /api/order/lookup` (référence + e-mail, réponse générique, lien d’accès à durée limitée par e-mail) et `GET /api/order` (en-tête `Authorization: Bearer <jeton du lien>`, jamais dans l’URL envoyée au serveur) : prévus. Ils répondent `503 not_configured` tant que l’envoi d’e-mails n’est pas raccordé et testé.
- Numérotation : `order_reference` publique et aléatoire pour le client ; numéro séquentiel (0001…) attribué au paiement pour STUDIO et la comptabilité.

## Demandes et retours

`POST /api/requests` (`type = contact | return | withdrawal`, Turnstile) : prévu avec preuve durable de réception. `503 not_configured` tant que le stockage et les e-mails ne sont pas raccordés et testés ; la boutique n’affiche jamais « envoyé » sur une erreur. Le formulaire de rétractation reste utilisable sans motif.

Un retour et un remboursement sont distincts. Un remboursement ne remet jamais une pièce en stock ; seul un contrôle physique « revendable » enregistré dans STUDIO le fait, une seule fois et dans la limite de la quantité vendue. Les remboursements restent décidés par le fondateur.

## Backend, STUDIO et automatisations — Claude

Implémentés dans `backend/` (voir `backend/README.md`) : registre de stock en ajout seul, transitions gardées par la base, événements Stripe signés et relus chez Stripe, idempotents et tolérants au désordre, erreurs réseau sans libération aveugle, balayage chaque minute, filet de sécurité pour l’ancien lien 1.0, notifications sans donnée personnelle, coordonnées chiffrées et purgeables. STUDIO sera protégé par passkey (Face ID), jamais par l’obscurité d’une URL. Resend, Discord et le transporteur restent côté serveur. Les essais de `TEST-PLAN.md` seront rejoués sur l’infrastructure de test réelle avant toute vente.

## Contrôle anti-abus

Turnstile vérifié côté serveur avec la clé secrète. Sans clé : refus (`503 challenge_unavailable`), sauf environnement de test explicitement marqué. La boutique fournit un nouveau jeton à chaque nouvelle tentative ; une reprise avec la même clé d’idempotence n’en a pas besoin.
