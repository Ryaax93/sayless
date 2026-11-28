# SAYLESS — Informations à confirmer avant l’ouverture des ventes

État au 26 novembre 2026. Voir la [contre-revue v1.4](docs/REVUE-V1-4-WORK.md). Le comptage est déclaré ; l’inventaire actif reste à confirmer dans STUDIO. Paiements fermés.

## Données commerciales fournies

| Élément | Valeur retenue |
|---|---|
| Prix unitaire | 75 € TTC hors livraison |
| Comptage physique déclaré | S : 8, M : 14, L : 5, total : 27 ; aucune pièce endommagée ; compté le 26 novembre 2026, activation STUDIO à confirmer |
| Point relais | 4,90 € ; sélecteur réel non raccordé |
| Domicile | 8,50 € envisagés ; transporteur et tarif à valider |
| Parcours | Une pièce, livraison sur SAYLESS, devis et récapitulatif, CGV, vérification anti-abus, réservation puis coordonnées et paiement sur Stripe |
| Un gilet livré | 79,90 € en relais prévu ; 83,50 € à domicile |

La production initiale annoncée est de 30 pièces, avec 2 offertes et 2 vendues. Le chiffre antérieur de 26 était théorique. Le fondateur indique 27 pièces vendables après comptage : l’hypothèse d’un sample offert hors stock principal reste à confirmer. Ne pas corriger l’historique arbitrairement ni appliquer ce comptage à la production. Vérifier les ventes V1 postérieures au comptage, puis confirmer dans STUDIO.

Pesées avec sachet : S environ 711 g, M 821 g, L 872 g. Emballage 55 × 45 cm ; épaisseur 10 cm uniquement pour simulation. Tranche jusqu’à 1 kg envisagée, à vérifier sur chaque colis final.

Boxtal : compte créé, ticket n°2277409 en attente (éligibilité commerciale du compte particulier, API, tarifs, environnement de test). Simulation Bobigny → Bordeaux : Chrono 2Shop Direct environ 4,39 € TTC et Mondial Domicile France environ 7,48 € TTC. Aucune garantie nationale ; aucune intégration opérationnelle déclarée.

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
- Répartition déclarée S8/M14/L5, à valider après rapprochement des ventes V1. Aucun chiffre par taille n’est présenté aux clients ; seul le total est affiché dans la barre animée et sur la fiche. Le comptage physique fait autorité, même s’il diffère du total théorique. Le fondateur confirmera l’inventaire dans STUDIO ; aucune migration de cette livraison ne précharge ces nombres.
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
- Zone confirmée au lancement : France métropolitaine hors Corse. Renseigner les délais de préparation et d’acheminement.
- Une pièce par commande au lancement. Faire valider les deux tarifs par le transporteur après pesée du colis complet.
- Adresse de retour et procédure d’échange à confirmer.
- Frais de retour validés par SAYLESS : client pour changement d’avis ou de taille ; bordereau gratuit fourni après vérification en cas de mauvais article ou de défaut.
- Délais conservés dans les textes : 14 jours pour déclarer la rétractation, puis 14 jours pour renvoyer. Le délai de 7 jours après validation et une interdiction absolue d’essayage ne sont pas utilisés pour restreindre le droit légal.
- Réception effective de la rétractation en ligne, confirmation et accusé durable daté. Le formulaire utilise l’API et conserve une référence de réception ; l’envoi Resend réel reste à tester.

Les clés secrètes devront être configurées dans l’espace sécurisé prévu à cet effet, jamais dans les fichiers publics du site.

## Commandes, paiement et données personnelles

- Les corrections B1/B2/C1 sont vérifiées localement. Reste le cas V14-R1 (doublon d’e-mail après panne prolongée), la recette externe et la validation du texte juridique archivé.
- Préparer D1 hébergée de test, Stripe test, réception des webhooks signés, Turnstile et les tests sur iPhone avec l’accord du fondateur. Aucune clé ni donnée client dans le dépôt.
- Confirmer les wallets compatibles, le transporteur, les e-mails transactionnels, les preuves de réception, l’étiquette, le suivi et la restauration.
- Choisir et valider les durées de conservation. Le mécanisme proposé dans la PR de Claude demeure désactivé tant que les durées ne sont pas approuvées.
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
