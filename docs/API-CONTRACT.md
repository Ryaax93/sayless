# Contrat commun de la boutique — v1.4

**Statut : v1 proposée par Work le 24 novembre 2026 ; v1.1 et v1.2 implémentées par Claude et consommées par Work (`work/frontend-api-v1-2`) ; v1.3 = corrections de la revue de Work ; v1.4 = suite de la contre-revue v1.3 de Work (26 novembre), à valider par Work.** Les évolutions v1.3 et v1.4 sont additives : un client v1.3 continue de fonctionner (`terms_sha256` est facultatif au paiement pendant la transition). Rien n’est déployé. Le paiement reste fermé par défaut (`payments_enabled = 0`, boutique en pause).

## Changements v1.4 (contre-revue v1.3 de Work, 26 novembre) — à valider par Work

- **Texte exact des CGV (V13-C1)** : une version seule ne suffit plus. Le devis renvoie aussi `terms_sha256` (empreinte SHA-256 du texte archivé, 64 caractères hexadécimaux) et `terms_url` (`/api/terms/<version>`), tous deux signés dans le jeton du devis avec la version.
- **Nouvelle route publique en lecture seule** : `GET /api/terms` (CGV en vigueur) et `GET /api/terms/<version>` (une version archivée, ancienne comprise). Réponse :

  ```json
  {"version": "2026-11", "sha256": "<64 hex>", "published_at": "ISO", "current": true, "format": "text/plain", "body": "<texte intégral>"}
  ```

  - `body` est du **texte brut** : l’afficher tel quel (`textContent`, retours à la ligne conservés), jamais l’interpréter comme du HTML.
  - Empreinte recalculée par le serveur à chaque lecture ; un texte qui ne correspond plus à son empreinte n’est jamais servi (`503 not_configured`, alerte critique au fondateur).
  - `ETag: "<sha256>"`. Version précise : `Cache-Control: public, max-age=86400, immutable` (un texte publié ne change jamais) ; `/api/terms` : `max-age=0, must-revalidate`.
  - Erreurs : `404 not_found` (version inconnue), `503 not_configured` (aucune CGV publiée ou texte altéré).
- **Affichage proposé côté boutique** : charger `terms_url` reçu dans le devis (pas `/api/terms`, qui peut changer entre-temps), vérifier côté navigateur que `sha256` = `terms_sha256` du devis (`crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))`), afficher ce texte, puis envoyer au paiement `terms_version` **et** `terms_sha256` reçus dans le devis. Si l’empreinte ne correspond pas : ne pas proposer « Payer », recharger le devis.
- **Paiement** : `POST /api/checkout` accepte `terms_sha256`. Facultatif en v1.4 (compatibilité v1.3) ; s’il est présent, il doit avoir 64 caractères hexadécimaux minuscules (`400 invalid_request` sinon) et correspondre au devis et au texte archivé (`409 terms_outdated` sinon). **Proposition : obligatoire en v1.5**, une fois la boutique de Work mise à jour.
- **CGV non archivées (V13-B2)** : devis refusé (`503 not_configured`) si le texte de la version en vigueur manque à l’archive ou ne correspond plus à son empreinte. La base refuse aussi toute réservation dans ce cas, et toute réservation dont la commande cite une autre version ou une autre empreinte que celles en vigueur : une publication de CGV concurrente pendant un paiement donne `409 terms_outdated`, sans commande créée. La reprise d’une tentative existante (même clé) n’est pas concernée.
- **E-mails clients (V13-B1)** : aucun changement d’interface. Confirmation de commande, accusé des demandes et avis d’expédition sont désormais garantis côté serveur : une panne de la file d’envoi est réparée automatiquement, sans seconde entrée en file ; l’envoi est protégé contre les doublons pendant les 24 h de la clé d’idempotence de Resend, puis passe « à vérifier » (v1.5).

## Changements v1.3 (revue de Work, 25 novembre) — à valider par Work

- **CGV versionnées** : le devis renvoie `terms_version` (version en vigueur, signée dans le jeton). Une nouvelle tentative exige `terms_version` égal à celui du devis **et** à la version en vigueur (`409 terms_outdated`). Sans CGV publiées : `503 not_configured` dès le devis. Le texte de chaque version est conservé côté serveur, sans modification possible. Proposition : la boutique affiche la version reçue dans le devis et l’envoie telle quelle.
- **Reprise d’une tentative** : la clé d’idempotence est cherchée **avant** l’expiration du devis. Même clé et même contenu = même session Stripe et même réservation, même après 10 minutes. Un devis expiré n’ouvre jamais une **nouvelle** tentative (`409 quote_expired`).
- **`409 attempt_closed`** porte désormais `payment_status` (mêmes valeurs que `/api/checkout/status`) et, si la tentative a une session Stripe, `session_id` : la boutique peut afficher la page `/merci` d’une tentative payée au lieu de proposer un nouvel achat.
- **Points relais** : `GET /api/relay-points` applique les mêmes refus que le devis (`422 postcode_required`, `422 destination_not_supported`) et écarte les points fermés ou hors zone. Chaque point a une adresse stable : `{"id", "name", "network", "postcode", "city", "address": {"line1", "line2", "postcode", "city", "country"}}`. Le devis renvoie la même `address` dans `relay`. Le point choisi est figé dans la commande.
- **Chiffrement obligatoire** : sans clé de chiffrement valide des coordonnées, aucune tentative n’est ouverte (`503 not_configured`).
- **Inventaire de tout le produit** : tant qu’une taille du produit n’est pas confirmée, devis et réservation sont refusés (`503 stock_unavailable`), comme le stock public.
- **Suivi et demandes raccordés** (actifs seulement quand l’envoi d’e-mails est configuré, sinon `503 not_configured` comme avant) : voir les sections ci-dessous. Lien de suivi envoyé par e-mail : `<origine de la boutique>/#/suivi?t=<jeton>` ; la boutique lit `t` dans le fragment et appelle `GET /api/order` avec `Authorization: Bearer <jeton>`.
- **Moyens de paiement** : carte bancaire, avec Apple Pay et Google Pay sur les appareils compatibles. **Klarna exclu** (décision du DROP 01).
- **Portée de `total_available`** : total exact **du produit demandé** (`product_id`). Pour plusieurs produits dans un même drop, la boutique additionne les produits du drop ; l’épuisement définitif (`drop_status = sold_out`) est déjà calculé à l’échelle du drop.

## Changements v1.2 (décisions du fondateur, 24 novembre)

- **Stock minimisé** : par taille, seulement `state` et `orderable` (quantité commandable, plafonnée au maximum par commande). Nouveaux champs `total_available` (total exact du drop, affiché par la boutique) et `max_items_per_order`. `available` reste un alias transitoire de `orderable` : la boutique doit lire `total_available` pour son total.
- **Zones** : France métropolitaine hors Corse ; Monaco et outre-mer refusés. Le devis domicile exige `postcode` (`422 postcode_required`, `422 destination_not_supported`).
- **Coordonnées sur Stripe, livraison choisie sur SAYLESS** : mode de livraison et point relais choisis dans la boutique ; la page Stripe ne propose qu’une option, au montant exact du récapitulatif ; elle demande le nom de la personne qui retire un colis en relais.
- **Une pièce par commande** au lancement : validé ; l’API reste multi-articles.

## Changements v1.1 (Claude)

- Stock, catalogue, checkout, idempotence, CGV, Turnstile, relais et réponses d’erreur de la v1 : **confirmés**.
- Devis **sans donnée personnelle** : jeton signé par le serveur, rien n’est stocké avant le paiement. `customer_token` devient inutile. Les coordonnées sont saisies sur la page Stripe ★.
- **Une pièce par commande** tant que la tarification multi-pièces n’est pas validée ★ (`422 quantity_not_supported`).
- Ajout de `POST /api/checkout/status` pour la page `/merci`.
- Ajout de codes d’erreur : `quote_invalid`, `quote_mismatch`, `checkout_in_progress`, `attempt_closed`, `terms_outdated`, `hold_limit`, `quantity_not_supported`, `destination_not_supported`, `relay_unavailable`, `challenge_unavailable`, `not_configured`, `invalid_origin`, `unsupported_media_type`, `payload_too_large`.
- Message de pause validé par le fondateur ; lecture du stock limitée aux vues d’achat (quota gratuit).
- Moyens de paiement fixés par la session : carte, Apple Pay et Google Pay ; Klarna exclu.

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
  "total_available": "<total exact du drop, ou null si non vérifié>",
  "max_items_per_order": 1,
  "variants": [
    {"sku": "ZH-PINK-S", "state": "available | held | sold_out | unavailable", "orderable": "<0 à max_items_per_order>", "available": "<alias transitoire de orderable>"}
  ]
}
```

Règles serveur (implémentées) :

- Disponible = pièces présentes − pièces en cours de paiement, calculé par le serveur et jamais envoyé par taille. `state = available` s’il en reste ; `held` si 0 mais des pièces sont réservées ; `sold_out` si plus aucune pièce présente ; `unavailable` tant que l’inventaire physique de la taille n’est pas confirmé dans STUDIO.
- `verified` n’est vrai que si toutes les tailles du produit sont confirmées et la base lisible ; sinon `drop_status = unavailable` et `503 stock_unavailable` au devis.
- `drop_status = sold_out` exige **tout le drop** confirmé et vendu. Une pièce seulement réservée donne `held`, jamais SOLD OUT. Le message « DROP 01 — SOLD OUT. » reste conditionné à cet état.
- `checkout_enabled` = vérifié, boutique ouverte, paiements ouverts par le fondateur et `drop_status = available`.
- `mode = paused` : la boutique masque le total, bloque l’achat et affiche le message validé : « DROP 01 — TEMPORARILY UNAVAILABLE. / La boutique est momentanément indisponible. Retrouvez-nous prochainement sur saylessbrand.fr. / Instagram : @sayless.brand / SAY LESS. DO MORE. »
- Le navigateur ne reçoit aucune quantité par taille au-delà de `orderable` (décision du fondateur : minimisation). Le total du drop est exact.
- Fraîcheur acceptée : 30 secondes. Lecture toutes les 20 secondes **uniquement** écran visible et vues produit, panier ou paiement ; arrêt après 10 minutes d’inactivité. Chaque lecture compte dans le quota gratuit de 100 000 requêtes par jour.

## Livraison et devis

`POST /api/quote` :

```json
{"items": [{"sku": "ZH-PINK-M", "quantity": 1}], "shipping": "home | relay", "relay_id": null, "country": "FR", "postcode": "75011"}
```

Aucune coordonnée personnelle : seul le code postal de livraison est demandé pour le domicile, afin de vérifier la zone avant le paiement (il n’est pas enregistré). Réponse :

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
  "terms_version": "<version des CGV en vigueur (v1.3)>",
  "terms_sha256": "<empreinte SHA-256 du texte archivé (v1.4)>",
  "terms_url": "/api/terms/<version> (v1.4)",
  "expires_at": "<ISO, 10 minutes>"
}
```

Relais (v1.3) : `"relay": {"id", "label", "network", "postcode", "city", "address": {"line1", "line2", "postcode", "city", "country"}}`.

- Le récapitulatif affiché avant « Payer » est **cette réponse**. Le devis n’écrit rien en base.
- Tarifs validés pour une pièce : relais 490, domicile 850. Paniers de plusieurs pièces refusés (`422 quantity_not_supported`, champ `max_items`) : une pièce par commande au lancement, validé par le fondateur.
- Zone : France métropolitaine hors Corse (`20…`) et outre-mer (`97…`, `98…`) ; Monaco refusé (`MC`). Domicile sans code postal : `422 postcode_required` ; hors zone : `422 destination_not_supported`. Relais : le code postal du point est contrôlé de la même façon. Voir `DONNEES-ET-SAUVEGARDES.md`.
- Relais : `relay_id` revérifié auprès du fournisseur (ouvert, pays). Sans fournisseur raccordé : `503 relay_unavailable` ; ne pas basculer seul vers le domicile.
- Coordonnées (validé par le fondateur) : e-mail, nom, téléphone et adresse (domicile) sont saisis sur la page Stripe, puis enregistrés chiffrés après le paiement. Le mode de livraison et le point relais sont choisis sur SAYLESS avant le paiement, et le récapitulatif affiche le montant exact. La page Stripe ne propose que l’option choisie ; pour un relais, elle demande le nom de la personne qui retirera le colis. Une adresse hors zone saisie sur Stripe met la commande « à vérifier » (pas d’envoi ni de remboursement automatique).

## Points relais

`GET /api/relay-points?postcode=75016&country=FR` → `{"points": [{"id", "name", "network", "postcode", "city", "address": {"line1", "line2", "postcode", "city", "country"}}]}` depuis le fournisseur choisi après la pesée. Mêmes refus de destination que le devis (`422 postcode_required`, `422 destination_not_supported`) ; points fermés ou hors zone écartés (v1.3). Choix accessible en liste en complément d’une carte. Aucun point fictif. Fournisseur absent : `503 relay_unavailable`.

## Checkout Stripe

`POST /api/checkout`, en-tête `Idempotency-Key` (16 à 100 caractères `A-Z a-z 0-9 _ -`), stable pour une tentative :

```json
{
  "items": [{"sku": "ZH-PINK-M", "quantity": 1}],
  "shipping": "home",
  "relay_id": null,
  "quote_id": "<id du devis>",
  "terms_version": "<version acceptée des CGV>",
  "terms_sha256": "<empreinte du texte affiché, reçue dans le devis (v1.4, facultatif)>",
  "turnstile": "<jeton anti-abus>"
}
```

Côté serveur, dans l’ordre (v1.3) : devis authentique (signature) ; **reprise si la clé existe déjà**, même devis expiré (même contenu → même session et même réservation, sans nouveau Turnstile ; contenu différent → `idempotency_conflict`) ; puis, pour une nouvelle tentative seulement : devis non expiré (`quote_expired`) ; contenu identique au devis (`quote_mismatch`) ; CGV en vigueur et identiques au devis (`terms_outdated`) ; boutique ouverte ; paiements ouverts ; chiffrement des coordonnées prêt ; limite d’abus ; Turnstile ; prix relus (`price_changed`) ; puis, en un lot atomique, commande, lignes et réservations. Ensuite la session Stripe est créée avec la clé `sayless-checkout-<commande>` : carte uniquement (Apple Pay et Google Pay compris), sans Klarna, expiration à 30,5 minutes ; la réservation dure 32 minutes.

Une réponse Stripe incertaine garde la réservation : seule une confirmation par Stripe (session retrouvée par sa clé puis expirée, ou refus explicite) la libère.

Réponse : `{"url": "https://checkout.stripe.com/...", "order_reference": "SL-XXXX-XXXX", "expires_at": "ISO"}`.

| Réponse | Comportement client |
| --- | --- |
| 409 `sold_out` | Actualiser le stock, indiquer la taille épuisée ; ne pas conclure que tout le drop est terminé |
| 409 `held` | « Cette pièce est réservée temporairement. Réessaie dans un instant. » |
| 409 `quote_expired`, `quote_invalid`, `price_changed`, `quote_mismatch` | Recalculer le devis, l’afficher et redemander « Payer » |
| 409 `idempotency_conflict` | Ne pas réessayer automatiquement ; nouvelle tentative avec une nouvelle clé |
| 409 `checkout_in_progress` | Réessayer avec la même clé après `Retry-After` (2 s) |
| 409 `attempt_closed` | La tentative est terminée : `order_reference`, `payment_status` et, si elle existe, `session_id` (v1.3). Payée : afficher `/merci` ; sinon nouvelle clé et nouveau devis |
| 409 `terms_outdated` | Recharger le devis et le texte des CGV (`terms_url`), puis redemander l’acceptation |
| 422 `invalid_items`, `quantity_not_supported`, `destination_not_supported`, `postcode_required` | Corriger le panier, le code postal ou la destination ; afficher « Livraison en France métropolitaine, hors Corse pour le moment » |
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
- `POST /api/order/lookup` `{"reference", "email"}` → toujours `200 {"accepted": true}`, que la commande existe ou non (aucune énumération). Si la référence et l’adresse correspondent, un lien valable 30 minutes part par e-mail : `<origine>/#/suivi?t=<jeton>`. Limité à 10 demandes par client et par 10 minutes.
- `GET /api/order` avec `Authorization: Bearer <jeton>` → `{"order_reference", "payment_status", "items": [{"size", "quantity"}], "shipping", "relay": {"name", "city", "postcode"} | null, "steps": [{"step": "prepared | shipped | delivered | returned", "at"}], "tracking": {"carrier", "number"} | null, "updated_at"}`. Aucune donnée personnelle. Jeton absent, faux ou expiré : `401 unauthenticated`.
- Les deux routes répondent `503 not_configured` tant que l’envoi d’e-mails (Resend, domaine vérifié) et le chiffrement ne sont pas configurés.
- Numérotation : `order_reference` publique et aléatoire pour le client ; numéro séquentiel (0001…) attribué au paiement pour STUDIO et la comptabilité.

## Demandes et retours

`POST /api/requests` `{"type": "contact | return | withdrawal", "order_reference"?, "name", "email", "message", "turnstile"}` → `200 {"reference": "R-XXXX-XXXX", "type", "received_at"}` **seulement après l’enregistrement** de la demande (coordonnées et message chiffrés). Un accusé de réception part aussitôt par e-mail (support durable, exigé pour la rétractation). `message` obligatoire sauf pour une rétractation (sans motif) ; champ invalide : `400 invalid_request` avec `field`. Limité à 5 demandes par client et par 10 minutes. `503 not_configured` tant que l’envoi d’e-mails et le chiffrement ne sont pas configurés ; la boutique n’affiche jamais « envoyé » sur une erreur.

Un retour et un remboursement sont distincts. Un remboursement ne remet jamais une pièce en stock ; seul un contrôle physique « revendable » enregistré dans STUDIO le fait, une seule fois et dans la limite de la quantité vendue. Les remboursements restent décidés par le fondateur.

## Backend, STUDIO et automatisations — Claude

Implémentés dans `backend/` (voir `backend/README.md`) : registre de stock en ajout seul, transitions gardées par la base, événements Stripe signés et relus chez Stripe, idempotents et tolérants au désordre, erreurs réseau sans libération aveugle, balayage chaque minute, filet de sécurité pour l’ancien lien 1.0, notifications sans donnée personnelle, coordonnées chiffrées et purgeables. STUDIO sera protégé par passkey (Face ID), jamais par l’obscurité d’une URL. Resend, Discord et le transporteur restent côté serveur. Les essais de `TEST-PLAN.md` seront rejoués sur l’infrastructure de test réelle avant toute vente.

## Contrôle anti-abus

Turnstile vérifié côté serveur avec la clé secrète. Sans clé : refus (`503 challenge_unavailable`), sauf environnement de test explicitement marqué. La boutique fournit un nouveau jeton à chaque nouvelle tentative ; une reprise avec la même clé d’idempotence n’en a pas besoin.
