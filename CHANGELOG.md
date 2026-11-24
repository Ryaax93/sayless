# Journal des modifications

## 2026-11-24 — dépôt GitHub v2 et préparation du relais à Claude

- Copie indépendante des 70 fichiers suivis de l’aperçu v4, source `e271bd63ee1ca9d806a921511fbc12900de4c14f`. Logo, photographies, polices, CSS, pages, démo, prototype et tests conservés ; aucun changement du site publié.
- Ajout d’un lancement et build statiques portables via Node. Toutes les API y répondent 503, sans inventaire factice ni paiement. Identifiant de projet retiré du manifeste de la copie ; aucun secret/local state exporté.
- Catalogue éditorial JSON sans stock : rose pastel, S/M/L, 350 GSM, 80/20, YKK, capuche doublée et prix approuvé ; inconnues laissées nulles.
- Rapport actualisé lu intégralement (693 lignes) ; différences de direction artistique 1.0/2.0, passkeys proposées et contrôle Turnstile documentés. Aucun compte ni service supplémentaire activé.
- Frontière API proposée : catalogue, stock, devis, checkout désactivé par défaut, relais, commandes et demandes. Contrat et divergences à valider avec Claude documentés.
- Stock frontend : retrait du total déclaré comme disponibilité certaine ; uniquement données vérifiées, fraîches et complètes. Panne, réservation, rupture d’une taille et véritable SOLD OUT distingués. Aucune quantité par taille affichée.
- Ajout du message de fin de drop approuvé, masqué jusqu’à confirmation serveur. Compte Instagram aligné sur `@sayless.brand` fourni dans le dernier brief.
- Fiche produit complétée avec les caractéristiques officiellement fournies. Design, logo, animation continue, guide et textes légaux validés préservés ; aucun post-it réintroduit.
- Documentation commune : architecture, responsabilités, API, design, statut, blocages, tests, consignes à Claude, provenance et liste des fichiers.
- Ajout de la licence Apache complète pour les polices ; mise à jour des informations restant à fournir.
- Tests frontend de sécurité et de dégradation ajoutés ; backend et migrations hérités inchangés et transmis à Claude.
- Aucun changement de main, domaine, réglage Stripe ou déploiement ; aucun nouvel admin ni backend commercial concurrent.

## 2026-11-22 — historique de l’aperçu v4

Post-it retiré ; barre rose avec logo et total déclaré ; rose unisexe et conseil S ; retours adaptés (14 jours pour déclarer puis 14 pour renvoyer) ; blocs administratifs provisoires retirés visuellement à la demande du fondateur ; références à la plateforme retirées du contenu client. Les informations obligatoires restent à compléter avant vente.

## 2026-11-21 — historique du prototype

Mise en page boutique, pages secondaires, panier et checkout démo ; prototype D1 et Stripe exclusivement test, administration expérimentale liée à l’hébergeur ; atomicité, idempotence et tests locaux. Aucun raccordement réel aux paiements ou transporteurs.
