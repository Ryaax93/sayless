# Contrat commun de la boutique — proposition v1

**Statut : proposition Work du 24 novembre 2026, à valider avec Claude.** Aucun endpoint commercial décrit ici n’est déployé par ce dépôt. `api-client.js` prépare les appels ; seul le lecteur de stock est branché à l’interface. Le paiement du client est désactivé par défaut. Le prototype historique utilise un autre contrat et reste réservé à l’audit.

## Principes

- Même origine `/api` recommandée pour éviter des secrets ou des tokens de compte dans le navigateur. HTTPS en déploiement, JSON UTF-8, montants entiers en centimes EUR, dates ISO 8601 UTC.
- Le serveur relit catalogue, prix, taxes applicables, stock, destination et livraison. Il ignore/refuse tout prix envoyé par le client. Un devis expiré est recalculé et représenté au client avant paiement.
- Stock, devis, commande et données clients : `Cache-Control: no-store`. Aucune donnée personnelle ou secret dans une URL, un log navigateur, Discord ou un cache public.
- Timeout navigateur de 5 secondes ; pas de retry aveugle d’une mutation. Reprendre une tentative de checkout avec la même clé d’idempotence et le même contenu, pas créer plusieurs réservations.
- Toute quantité inconnue reste `null`/absente ; jamais zéro par défaut. Une panne entraîne un message neutre et le blocage du paiement.
- Le serveur protège les POST : origine, type/taille du corps, validation, CSRF selon le mode d’authentification, limitation d’abus. Les contrôles du navigateur améliorent l’UX et ne remplacent jamais ceux du serveur.

## Catalogue

`GET /api/catalog` : modèle `data/products.json` (version 1), publié par le serveur. Catalogue éditorial extensible : produits, drops, couleurs, tailles, variantes/SKU, prix, photos, composition, entretien et fabrication. Les informations inconnues sont `null` ; aucune quantité dans le fichier de catalogue.

Le fichier JSON est le point d’import initial commun. Claude choisira comment D1 devient la source éditable via Studio et comment la boutique lit cet état publié. Ne pas créer deux catalogues qui divergent. Les cartes/fiches/cart du frontend actuel sont encore dédiées au premier produit ; leur généralisation est listée dans STATUS.md.

## Stock

`GET /api/stock?product_id=pink-001` retourne un instantané complet des variantes du produit demandé. Le schéma proposé enrichit la carte SKU → nombre de la section 6 du rapport : cette carte seule ne peut pas distinguer les pièces réservées d’un vrai sold out.

```json
{
  "verified": true,
  "mode": "open | paused",
  "updated_at": "<date ISO de lecture serveur>",
  "checkout_enabled": false,
  "drop_status": "available | held | sold_out | unavailable",
  "variants": [
    {"sku": "ZH-PINK-S", "available": "<entier >= 0>", "state": "available | held | sold_out | unavailable"}
  ]
}
```

Les placeholders ci-dessus décrivent les types ; **ils ne sont pas un inventaire à importer**. S, M et L doivent tous être présents, y compris les variantes épuisées. `verified` n’est vrai qu’après inventaire confirmé et lecture fiable de la base. `updated_at` est l’instant de lecture serveur, pas uniquement la dernière modification : un stock inchangé reste vérifiable.

`mode=paused` ou `drop_status=unavailable` masque le total et bloque tout achat. Le texte spécifique de pause du rapport reste à valider ; le message neutre existant ne promet aucun délai.

`available` est la quantité encore achetable, réservations déjà soustraites. `available > 0` exige `state=available`. À zéro : `held` s’il reste des pièces réservées, `sold_out` si la rupture est effectivement confirmée, `unavailable` en cas de fermeture/incohérence. Le frontend ne doit pas montrer de quantités par taille ; il peut désactiver les tailles et indiquer leur état.

Le total est la somme des variantes du produit et n’est affiché que si toutes les variantes requises sont présentes, uniques, cohérentes et vérifiées. Fraîcheur acceptée : 30 secondes ; lecture toutes les 20 secondes quand l’écran est visible. Les erreurs, dates invalides, réponses trop anciennes ou variantes incomplètes masquent le total. Le serveur doit relire et réserver atomiquement au checkout, même si l’instantané vient d’être lu.

`drop_status=sold_out` doit couvrir **tout le drop**, pas une seule taille ni un produit isolé d’un futur drop multiple. Le grand message « DROP 01 — SOLD OUT. » exige cet état explicite et toutes les variantes du produit épuisées. Les réservations, indisponibilités et ruptures partielles n’affichent pas ce message.

## Coordonnées, livraison et devis

`POST /api/quote` proposé : liste `items[{sku,quantity}]`, coordonnées nécessaires (nom, e-mail, téléphone transport, adresse, pays), `shipping=home|relay`, `relay_id` si relais. Le mode est choisi après la saisie des coordonnées. Une validation serveur de destination et de relais est obligatoire.

Réponse proposée : `id`, `currency`, `items[{sku,quantity,unit_price_cents,line_total_cents}]`, `subtotal_cents`, `shipping_cents`, `total_cents`, `expires_at`, `customer_token`, mode et relais normalisés. Le récapitulatif doit afficher **cette réponse serveur** avant paiement. Ni le calcul `commerce.js` de la démonstration, ni une modification du JSON navigateur ne doivent fixer un montant payable.

Le cycle `customer_token`/devis est à concevoir par Claude : jeton opaque, lié à la tentative et aux coordonnées, TTL court, pas de coordonnées dans localStorage ou l’URL, pas de conservation superflue. Le rapport prévoit la conservation finale des adresses chez Stripe ; les traitements avant paiement, le transporteur et les demandes clients doivent être explicités dans la confidentialité.

Prix approuvés pour **une pièce et une destination admissible** : 7500 + 490 = 7990 en relais ; 7500 + 850 = 8350 à domicile. Tarification des paniers multiples et destinations à valider avant activation. Le serveur bloque les cas non définis au lieu d’inventer une règle commerciale.

## Points relais

`GET /api/relay-points?postcode=...&country=FR` : liste issue du transporteur choisi, avec identifiant stable, fournisseur, nom, adresse, horaires et disponibilité. Aucun point fictif, géocodage de substitution ou donnée de test dans le checkout client réel.

La réponse doit permettre un choix accessible en liste en complément d’une carte. `relay_id` est revérifié lors du devis et du paiement (ouverture, pays, réseau, service compatible). L’identifiant suit la commande et l’étiquette. Si le service est indisponible, désactiver ce mode sans basculer automatiquement vers une livraison payante différente.

## Checkout Stripe

`POST /api/checkout`, en-tête `Idempotency-Key` stable par tentative :

```json
{
  "items": [{"sku": "ZH-PINK-M", "quantity": 1}],
  "shipping": "home",
  "relay_id": null,
  "quote_id": "<devis serveur valide>",
  "customer_token": "<jeton opaque lié au devis>",
  "terms_version": "<version acceptée des CGV>",
  "turnstile": "<jeton anti-abus à usage unique>"
}
```

Cette proposition remplace le `sku` unique de la section 6 par une liste, pour conserver le panier existant et préparer les futurs produits. Aucun prix ou total n’est envoyé par le client de checkout.

Le serveur valide le jeton Turnstile avec sa clé secrète, puis vérifie la session, le devis, la version des CGV, l’intégrité du relais et le stock ; réserve atomiquement ; crée la session Stripe à clé d’idempotence stable ; stocke le lien commande/réservation/session. Le choix de livraison validé doit rester le même dans Stripe. Les 30 minutes de réservation sont une décision d’architecture à implémenter et à tester par Claude, jamais une fausse échéance affichée par Work.

Réponse : `{ "url": "https://checkout.stripe.com/...", "order_reference": "...", "expires_at": "ISO" }`. Le client refuse une redirection vers un hôte arbitraire. La disponibilité réelle des moyens de paiement reste celle de la session créée par Stripe.

| Réponse | Comportement client |
| --- | --- |
| 409 `sold_out` | Actualiser le stock, indiquer la taille épuisée ; ne pas conclure que tout le drop est terminé |
| 409 `held` | « Cette pièce est réservée temporairement. Réessaie dans un instant. » ; aucun engagement de disponibilité après 30 min |
| 409 `quote_expired` ou `price_changed` | Recalculer, afficher le nouveau récapitulatif et demander de nouveau l’action Payer |
| 409 `idempotency_conflict` | Ne pas créer de nouvelle tentative automatiquement ; récupérer l’état serveur |
| 422 `invalid_relay` / `relay_required` | Revenir au choix de relais |
| 503 `stock_unavailable` / `service_unavailable` | Aucun compteur certain ni paiement ; proposer de réessayer |
| 403 `payments_disabled` | Aperçu ou ventes non ouvertes ; aucun contournement |
| 429 `rate_limited` | Message neutre et respect de `Retry-After` |
| 503 `paused` / `unavailable` | Fermeture temporaire : masquer le total et bloquer le paiement, jamais SOLD OUT |
| 403 `challenge_failed` | Refaire le contrôle anti-abus sans créer une autre réservation |

Aucune requête de paiement réel n’est envoyée par cette livraison. Les tests du client utilisent un fetch factice local, explicitement de test.

## Confirmation, annulation, commandes et suivi

Prévoir `/merci`, `/commande-annulee` et `/suivi` ; les routes visibles actuelles restent `/#/confirmation` et `/#/paiement` **de démonstration**. La migration des URL propres est à intégrer avec le futur serveur.

Un `session_id` dans l’URL retour n’est **pas** une preuve de paiement ni une autorisation de lire des données personnelles. Le serveur doit rattacher le visiteur à une commande par une session/autorisation adaptée et ne retourner que les champs nécessaires. Une confirmation reçue avant le webhook affiche « Confirmation en cours », pas « Payée ».

`POST /api/order/lookup` avec `reference` et `email` : réponse générique pour éviter l’énumération, limitation d’abus et lien/validation d’accès à durée limitée. Cette proposition remplace le GET e-mail + numéro du rapport pour éviter les données personnelles dans les URL.

`GET /api/order` avec une autorisation bornée : `reference`, `payment_status`, `fulfillment_status`, lignes non sensibles, total, événements de suivi normalisés et URL du transporteur validée côté serveur. Aucune adresse client, donnée de carte, charge Stripe brute ou secret. Distinguer en attente, payée, préparée, expédiée, livrée, annulée, remboursée et incident.

L’annulation dans le navigateur ne libère pas d’elle-même une réservation : confirmation Stripe/serveur, expiration et rapprochement font autorité.

## Demandes et retours

`POST /api/requests` avec jeton `turnstile` validé côté serveur et `type=contact|return|withdrawal`, coordonnées nécessaires, référence facultative selon le motif, articles et message. Réponse serveur avec identifiant et date de réception ; un échec ne doit jamais afficher « envoyé ».

Le formulaire de rétractation demeure utilisable sans motif et sans autorisation préalable. Un brouillon mail local n’est pas une réception serveur. Le backend prévoit la preuve durable de réception et les e-mails selon les services effectivement raccordés.

Un retour et un remboursement sont des opérations distinctes. Ne remettre en vente une unité qu’après validation de son retour physique et de son état revendable. Les remboursements exigent la décision du fondateur.

## Backend, Studio et automatisations — Claude

D1 avec mises à jour atomiques et contraintes ; événements Stripe signés sur corps brut, idempotents et tolérants au désordre ; erreurs réseau sans libération aveugle ; expirations et rapprochement ; journal et alertes sans PII. Administration protégée par une identité vérifiée, pas par l’obscurité d’une URL. Resend/Discord/Boxtal uniquement côté serveur. Pas de secret dans le catalogue ou le bundle.

Les vérifications de concurrence, double-clic, deux achats sur la dernière pièce, callbacks dupliqués, échecs, abandons, remboursements, décalages réseau, relais fermé, données de prix falsifiées, droits d’accès et quotas figurent dans TEST-PLAN.md. Aucun contrat ne doit être déclaré final avant la revue de Claude et les tests de bout en bout.

## Contrôle anti-abus du rapport actualisé

Turnstile est une intégration prévue, non activée : clé publique, widget accessible, jeton renouvelé si expiré/consommé, validation serveur et limites d’abus à coordonner. Le client de checkout transmet le champ et refuse son absence ; cela ne valide jamais lui-même un jeton. Aucun test local factice ne contourne un service réel. La gestion du widget dans les écrans, les demandes et les tests d’intégration restent à faire. Une reprise avec la même clé d’idempotence doit être distinguée d’une nouvelle réservation côté serveur, même si un nouveau jeton Turnstile est nécessaire.
