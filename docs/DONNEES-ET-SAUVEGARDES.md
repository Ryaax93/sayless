# Zones livrées, conservation des données et sauvegardes — décisions du 24 novembre 2026

Décisions du fondateur appliquées dans `backend/` (migration `0003_decisions_fondateur.sql`, tests `tests/backend/decisions.test.mjs`). Les durées de conservation sont une **proposition** : la purge automatique reste coupée (`retention_enabled = 0`) jusqu’à sa validation.

## Zones livrées

Lancement : **France métropolitaine hors Corse**. Corse, Monaco et outre-mer sont refusés avant le paiement (`422 destination_not_supported`). Une adresse hors zone saisie sur la page Stripe met la commande « à vérifier » après le paiement : pas d’étiquette, pas de remboursement automatique, alerte critique.

| Zone | Constat (sources ci-dessous) | Pour l’inclure |
| --- | --- | --- |
| Corse | Colissimo domicile au même tarif que le continent, environ 2 jours ; pas d’indemnisation de retard vers la Corse dans les conditions professionnelles Colissimo ; Chronopost facture un supplément ; des points Mondial Relay existent en Corse, mais suppléments et délais dépendent du contrat | Vérifier les conditions du transporteur choisi, puis retirer `20` des préfixes exclus |
| Monaco | Même territoire douanier que la France, aucune formalité ; Colissimo domicile sur la grille « France métropolitaine, Monaco, Andorre » ; livraison en point de retrait incertaine (la grille point de retrait ne vise que la métropole) | Confirmer avec le transporteur, puis ajouter `MC` aux pays autorisés (et dans la session Stripe) |
| Outre-mer | Hors lancement | — |

## Conservation des données personnelles (proposition)

Principe CNIL : suppression à la fin du contrat, archive intermédiaire séparée seulement pour une obligation légale ou la preuve d’un litige, dans la limite du délai applicable. Point de départ : la livraison confirmée, à défaut le paiement.

| Données | Pourquoi | Durée proposée | Fondement |
| --- | --- | --- | --- |
| E-mail, téléphone, adresse, nom du destinataire | Préparer, livrer, suivre, rétractation (14 jours), retours | Actives jusqu’à 90 jours après la livraison | Exécution du contrat |
| Les mêmes, archivées (chiffrées, consultation explicite et journalisée) | Garantie légale de conformité : 2 ans après la livraison, 30 mois après une réparation | Supprimées 913 jours (2 ans et 6 mois) après la livraison | Code de la consommation ; CNIL, archive intermédiaire |
| Nom du client, montant, date, référence, remboursements | Livre des recettes, pièces comptables | 10 ans après la clôture de l’exercice | Code de commerce, art. L123-22 |
| Suivi d’expédition sans adresse (référence, dates) | Litiges de transport | 5 ans | Code de commerce, art. L110-4 |
| Traces d’accès aux coordonnées et de connexion à STUDIO | Sécurité | 1 an | CNIL, recommandation sur la journalisation (6 mois à 1 an) |
| Journal des opérations (stock, remboursements, exports), sans donnée client | Contrôle interne, comptabilité | 10 ans | Avec la comptabilité |
| Empreintes anti-abus (aucune adresse IP stockée) | Limiter les abus | 30 jours (réservations), 2 jours (limites) | Minimisation |
| Données de carte | Jamais chez SAYLESS | — | Traitées par Stripe |
| Prospection | Aucune newsletter à ce stade | 3 ans après le dernier contact, si un jour | CNIL |

## Stock visible par le navigateur

`GET /api/stock` ne donne plus de quantité par taille : seulement l’état de chaque taille et la quantité commandable (plafonnée au maximum par commande, 1 au lancement). Le total du drop, affiché par la boutique, reste exact. Le serveur contrôle toujours le stock réel à chaque devis et à chaque réservation.

## Sauvegardes chiffrées hors de la base principale

| Niveau | Quoi | Où | Coût |
| --- | --- | --- | --- |
| 1 | Retour arrière natif de D1 (Time Travel), 7 jours | Cloudflare D1 | Gratuit |
| 2 | Copie quotidienne chiffrée après 3 h (heure de Paris) ; 30 quotidiennes + 12 mensuelles | Workers KV `BACKUPS`, séparé de la base (offre gratuite : 1 Go, 1 000 écritures par jour) | Gratuit |
| 3 | Copie hors Cloudflare chaque semaine : téléchargement depuis STUDIO (confirmation Face ID, journalisé) vers ton propre support | Ton stockage personnel | Gratuit |

- **Chiffrement** : compression gzip, AES-256-GCM, clé enveloppée par RSA-OAEP 3072 avec ta **clé publique**. La clé privée est créée sur ton ordinateur (`scripts/generate-secrets.mjs`) et n’en sort jamais : ni Cloudflare, ni GitHub, ni le chat ne peuvent relire une copie. Garde-la en deux exemplaires hors ligne : sans elle, les copies sont illisibles.
- **Cohérence** (corrigé le 25 novembre après la revue de Work) : toutes les tables sont lues en **un seul lot D1**, donc dans le même instant, même pendant une vente. L’image est contrôlée avant d’être scellée : stock égal au registre, réservations et ventes cohérentes, aucune ligne orpheline.
- **Vérification** : chaque copie est relue après écriture et comparée (empreinte SHA-256 dans l’en-tête). Les anciennes copies ne sont retirées qu’après une copie vérifiée : une copie défectueuse ne remplace jamais une bonne.
- **Restauration** (testée : D06, R05, R06, U09) : base vide → tables → données par lots → index et déclencheurs → contrôles de cohérence. Le basculement vers la base restaurée ne se fait qu’avec ton accord.
- **Exercice mensuel** : STUDIO → Santé du site → Sauvegardes chiffrées → Télécharger (Face ID, noté dans l’historique), puis sur ton ordinateur `node scripts/restore-backup.mjs --backup <copie> --key <clé privée>` : la copie est déchiffrée et restaurée dans une base locale jetable, puis contrôlée. Testé de bout en bout dans la recette navigateur.
- **Exclus** : GitHub (aucune donnée client, même chiffrée) et R2 (demande un moyen de paiement).
- Une panne de sauvegarde déclenche une alerte critique ; nouvel essai à l’heure suivante. Sans copie vérifiée depuis 36 h, l’écran Santé passe en alerte.

## Sources consultées le 24 novembre 2026

- [La Poste — envoyer un colis en Corse](https://www.laposte.fr/envoyer/envoi-colis-corse)
- [La Poste — tarifs Colissimo en ligne 2026](https://www.laposte.fr/colissimo-en-ligne/tarifs)
- [La Poste — principaux tarifs colis 2026](https://www.laposte.fr/professionnel/tarifs-postaux-colis)
- [Colissimo — conditions spécifiques professionnelles](https://www.colissimo.entreprise.laposte.fr/media/772/download)
- [La Poste — envoyer un colis à Monaco](https://www.laposte.fr/envoyer/envoi-colis-monaco)
- [La Poste — quels tarifs selon le poids (supplément Chronopost Corse)](https://www.laposte.fr/tarifs-envoyer-colis-selon-poids)
- [ShippyPro — tarifs 2026 des transporteurs en France](https://www.shippypro.com/blog/fr/envoyer-un-colis-prix-et-tarifs-2026-des-transporteurs-en-france)
- [CNIL — questions-réponses sur le référentiel gestion commerciale](https://cnil.fr/fr/questions-reponses-sur-les-referentiels-relatifs-la-gestion-des-activites-commerciales-et-des)
- [CNIL — recommandation sur la journalisation](https://www.cnil.fr/fr/node/9999)
- [DGCCRF — garanties légales](https://www.economie.gouv.fr/dgccrf/les-fiches-pratiques/les-garanties-legales-de-conformite-et-contre-les-vices-caches?lang=en)
- [economie.gouv.fr — garantie légale de conformité (30 mois après réparation)](https://www.economie.gouv.fr/particuliers/garantie-legale-conformite)
- [BOFiP — conservation des documents comptables (L123-22)](https://bofip.impots.gouv.fr/doctrine/pgp/2837-PGP)
- [Greffe du tribunal de commerce de Paris — documents à conserver (L110-4)](https://greffe-tc-paris.fr/procedure_sheet_download/documentsaconserverentreprises)
- [Cloudflare — limites de Workers KV](https://developers.cloudflare.com/kv/platform/limits)
