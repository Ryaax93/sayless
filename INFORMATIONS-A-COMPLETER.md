# SAYLESS — Informations à confirmer avant l’ouverture des ventes

État au 24 novembre 2026. Aucun paiement réel n’est activé par SAYLESS 2.0 ; le site officiel et ses réglages Stripe existants ne sont pas modifiés. Les paragraphes techniques du prototype ci-dessous sont à relire avec docs/ARCHITECTURE.md : Claude reprend le backend cible.

## Données commerciales fournies

| Élément | Valeur retenue |
|---|---|
| Prix unitaire | 75 € TTC hors livraison |
| Stock restant théorique | 26 gilets ; inventaire physique et répartition par taille à confirmer |
| Point relais | 4,90 € ; sélecteur réel non raccordé |
| Colissimo domicile | 8,50 € |
| Parcours | Coordonnées, puis livraison, puis total avant confirmation |
| Un gilet livré | 79,90 € en relais prévu ; 83,50 € à domicile |

La production initiale de 30 pièces est distincte des 26 pièces restantes : 2 pièces offertes et 2 vendues. Aucun stock par taille n’est inventé. Le total de 26 est théorique, pas encore issu d’un inventaire physique par variante. La branche v2 ne le présente plus comme une quantité disponible vérifiée. L’aperçu publié conserve sa version antérieure.

## Informations administratives

Les blocs « Éditeur du site » et « Hébergement » ont été retirés de l’affichage de l’aperçu à la demande du propriétaire. Les renseignements ci-dessous restent nécessaires pour la boutique commerciale ; leur retrait visuel ne vaut pas validation juridique. Aucune identité ou adresse n’a été inventée.


| À fournir ou valider | Détail attendu |
|---|---|
| Identité | Nom et prénoms de l’entrepreneur ou dénomination sociale |
| Statut | EI ou forme juridique ; capital si applicable |
| Immatriculation | SIREN, SIRET, registre et lieu applicables |
| Adresse | Adresse professionnelle ou siège social à afficher |
| Téléphone | Contact professionnel |
| Fiscalité | Régime de TVA et numéro intracommunautaire si applicable |
| Publication | Responsable de publication |
| Médiation | Médiateur effectivement désigné, coordonnées et site |
| Hébergement commercial | Entité contractuelle, adresse et téléphone ; ne pas déduire l’identité légale du nom d’une plateforme |

## Produit et stock

- Coloris confirmé : rose uniquement. Modèle unisexe femme et homme. Conseil fourni par SAYLESS : S pour les personnes de petite taille.
- Répartition interne des 26 pièces entre S, M et L, y compris les tailles à zéro. Aucun chiffre par taille n’est présenté aux clients ; seul le total est affiché dans la barre animée et sur la fiche. Le comptage physique fait autorité, même s’il diffère du total théorique. Claude initialisera la base cible après confirmation.
- Autres circuits de vente à synchroniser : ventes sur le site officiel, paiement par lien, remise en main propre, pièces offertes. Un événement Stripe non associé à une commande et une variante de cet aperçu ne peut pas être décompté automatiquement.
- Aucun autre coloris à créer : les photos et le catalogue correspondent au rose Pink 001.
- Composition confirmée : 80 % coton, 20 % polyester. Étiquette d’entretien à fournir.
- Mesures vérifiées sur les pièces : longueur, mesure appelée « poitrine » dans l’ancien tableau, épaules ; points de mesure, largeur à plat ou tour, méthode et tolérances.
- Grammage confirmé : 350 GSM ; fermeture YKK et capuche doublée confirmées par le fondateur.

| Taille | Longueur reprise | « Poitrine » reprise | Épaules reprises |
|---|---:|---:|---:|
| S | 71 cm | 63 cm | 58 cm |
| M | 74 cm | 69 cm | 63 cm |
| L | 76 cm | 74 cm | 67 cm |

Valeurs issues de l’ancien site, sans validation physique. Elles restent provisoires. Aucun tour de corps, conseil automatique ou mensuration de modèle n’a été inventé. Les tech packs charcoal/sand trouvés concernent un autre concept.

## Livraison et retours

- Transporteur de point relais choisi, compte marchand et accès à sa documentation ; identifiant public du widget si nécessaire, configuration sécurisée des accès serveur.
- Sélecteur à raccorder à de vrais relais avec nom, adresse et identifiant ; correction du choix et enregistrement dans la commande. Le tarif seul ne rend pas cette intégration opérationnelle.
- Pays et territoires desservis, exclusions, délais de préparation et d’acheminement.
- Application des tarifs aux paniers multiples et éventuelles variations par destination.
- Adresse de retour et procédure d’échange à confirmer.
- Frais de retour validés par SAYLESS : client pour changement d’avis ou de taille ; bordereau gratuit fourni après vérification en cas de mauvais article ou de défaut.
- Délais conservés dans les textes : 14 jours pour déclarer la rétractation, puis 14 jours pour renvoyer. Le délai de 7 jours après validation et une interdiction absolue d’essayage ne sont pas utilisés pour restreindre le droit légal.
- Réception effective de la rétractation en ligne, confirmation et accusé durable daté. Le brouillon e-mail actuel n’effectue pas cette transmission.

Les clés secrètes devront être configurées dans l’espace sécurisé prévu à cet effet, jamais dans les fichiers publics du site.

## Commandes, paiement et données personnelles

- Stripe : accès de test et secret de signature à configurer dans les variables sécurisées, jamais dans ce document ou le code public. Les clés réelles sont refusées par le code livré.
- Réception des webhooks : l’aperçu est privé, sa barrière de connexion bloque un appel Stripe extérieur. Un point de réception serveur accessible à Stripe et authentifié par signature doit être déployé et testé avant toute synchronisation effective. Aucun accès public n’a été ouvert.
- Validation de la mise en service réelle et des moyens de paiement acceptés, après une commande de test complète.
- Politique des annulations, retours et remboursements. Le remboursement seul ne remet jamais automatiquement une pièce en stock ; un retour physique revendable doit être confirmé séparément.
- Commandes réelles, confirmations par e-mail, facturation et suivi des envois restent à raccorder. La base, les opérations de stock et la gestion de commandes isolées de test sont implémentées.
- Durées de conservation et purge des identités administrateur, commandes et journaux : aucune purge automatique n’est encore configurée.
- Prestataires réels : hébergement, paiement, transport, e-mails, service client et éventuelles statistiques.
- Pour chaque traitement : finalité, base légale, champs nécessaires, destinataires, conservation, pays de traitement et garanties en cas de transfert.
- Identité du responsable et procédure pour les demandes d’exercice des droits.
- Finalisation des CGV : vendeur, livraison, garanties réglementaires, médiation et conditions réellement appliquées.

## Contact et réseaux

| Élément conservé de l’ancien site | Confirmation attendue |
|---|---|
| SayLe2s@outlook.com | Boîte active, suivie et destinée au service client |
| Instagram : sayless.brand | Identifiant fourni dans le brief du 24 novembre ; lien actualisé dans v2 |
| TikTok : sayless.brand | Compte officiel actuel |
| Logo et photographies | Crédits et droits pour la publication commerciale |

Les liens sont correctement formés et correspondent à la source. L’accès externe aux profils n’a pas permis de vérifier leur activité actuelle. Aucun e-mail de test n’a été envoyé.

## Sources officielles consultées pour les textes préparatoires

- [Mentions obligatoires](https://entreprendre.service-public.gouv.fr/vosdroits/F37351)
- [Conditions générales de vente](https://entreprendre.service-public.gouv.fr/vosdroits/F33527)
- [Commerce électronique](https://entreprendre.service-public.gouv.fr/vosdroits/F23455)
- [Droit de rétractation](https://www.service-public.gouv.fr/particuliers/vosdroits/F10485)
- [DGCCRF : délais et rétractation en ligne](https://www.economie.gouv.fr/dgccrf/les-fiches-pratiques/delais-de-reflexion-ou-de-retractation-comment-sappliquent-t-ils)
- [Garantie de conformité](https://www.service-public.gouv.fr/particuliers/vosdroits/F11094)
- [Vices cachés](https://www.service-public.gouv.fr/particuliers/vosdroits/F11007)
- [CNIL : information et transparence](https://www.cnil.fr/fr/conformite-rgpd-information-des-personnes-et-transparence)
- [CNIL : cookies et autres traceurs](https://www.cnil.fr/fr/cookies-et-autres-traceurs/que-dit-la-loi)

Les textes décrivent les fonctions actives et les éléments manquants. Ils ne présentent pas la boutique comme prête à encaisser des commandes.
