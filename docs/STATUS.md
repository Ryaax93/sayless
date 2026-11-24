# État réel — dépôt v2 du 24 novembre 2026

Cette livraison transfère la boutique et prépare son raccordement. Elle ne lance pas les ventes. L’aperçu privé publié reste en version 4 ; les adaptations de contrat sont uniquement dans la branche GitHub.

| Fonction | État |
| --- | --- |
| Identité, logo, couleurs, photographies, lookbook | Conservés depuis l’aperçu validé |
| Post-it flottant | Absent |
| Barre rose | Animation CSS continue, logo original, pause et réduction des animations |
| Produit | Rose pastel, unisexe, S/M/L, 350 GSM, 80/20, YKK, capuche doublée ; conseil S pour petite taille |
| Panier et écrans coordonnées/livraison/récapitulatif | Code et présentation existants conservés ; démonstration, aucune commande réelle |
| Prix | 75 € et tarifs 4,90 €/8,50 € inchangés ; valeurs de présentation, pas une autorité de paiement |
| Stock affiché | Nouveau lecteur `/api/stock` préparé et testé localement ; aucun total si non vérifié |
| 26 théoriques | Documentés pour inventaire, aucun seed de quantités par taille |
| État SOLD OUT | Composant créé, visible uniquement sur état serveur confirmé ; pas actif aujourd’hui |
| Catalogue extensible | Schéma éditorial `data/products.json` fourni ; généralisation dynamique du frontend restant à faire |
| Client API | Appels préparés pour catalogue, stock, devis, checkout, relais, commandes, demandes ; contrat proposé à Claude |
| Stripe réel | Désactivé ; aucun nouveau lien réel ni réglage du compte modifié |
| Point relais | Tarif présent, choix réel non raccordé et désactivé |
| Suivi de commande | Contrat et client préparés ; page et endpoint restant à intégrer |
| Contact / rétractation | Brouillon e-mail local existant ; pas d’envoi ni d’accusé serveur |
| SAYLESS STUDIO | À développer par Claude ; ancien écran expérimental conservé pour audit |
| D1 / réservations / signatures Stripe | Prototype historique testé en local, transmis à Claude ; aucun inventaire réel initialisé |
| Discord, Resend, Boxtal | Non raccordés, aucun envoi ni dépense |
| Pages légales, FAQ, contact, tailles | Présentes, textes et présentation validés conservés ; informations manquantes listées |
| SEO | Titre, description, favicon et h1 par page ; noindex volontaire ; URLs propres, OG, sitemap, canonicals et Product/Offer restant à faire |
| Images et polices | Fichiers locaux, WebP et polices avec licence ; pas de srcset ni sous-ensemble WOFF2 actuellement |
| Performance | Objectif premier écran mobile < 300 Ko non atteint/mesuré comme validé ; polices TTF lourdes à optimiser sans changer le rendu |
| Accessibilité | Focus, clavier, dialogues, textes alternatifs, réduction des animations existants ; audit WCAG complet à faire |

## Problèmes connus / blocages de lancement

- Stock réel par taille inconnu ; nombre théorique insuffisant pour autoriser un paiement.
- API du prototype différente du contrat cible ; le frontend `v2` n’utilise plus la déclaration ancienne `/api/inventory`.
- API du futur serveur absente : le lancement portable affiche un stock inconnu et empêche l’ajout. Ce n’est pas un faux sold out. Pour tester le parcours visuel complet actuel, l’aperçu privé v4 est conservé ; le code du panier et les tests commerciaux restent disponibles.
- Administration historique liée à l’identité injectée par l’ancien hébergeur ; ne pas exposer ce handler publiquement.
- Valeurs de démonstration encore présentes dans les templates commerciaux. À remplacer par le catalogue serveur et les devis avant activation ; jamais utilisées pour encaisser actuellement.
- Catalogue/galerie/panier actuellement centrés sur Pink 001 ; les APIs et le schéma sont extensibles, pas encore l’ensemble des écrans.
- Conditions de livraison multi-articles et zones non finalisées ; poids emballé et transporteur relais manquants.
- Identité légale, immatriculation, TVA, médiateur, hébergeur commercial, délais, adresse de retour et politique de conservation manquants. Les blocs administratifs masqués à la demande du fondateur ne dispensent pas de les compléter avant vente.
- Mesures du guide reprises de la 1.0, pas encore contrôlées physiquement ; aucune nouvelle mensuration ajoutée.
- Les services externes et leurs quotas réels n’ont pas été testés sur les futurs comptes. Aucun budget technique supplémentaire engagé.

## Ordre de la suite

Claude audite la branche et valide le contrat commun, puis crée le backend et Studio. Work branche catalogue/stock/devis/relais/checkout, confirmation, suivi et formulaires sur ses endpoints. Les deux parties testent le parcours en mode test ; le fondateur complète l’inventaire et l’administratif. La publication réelle exige un accord distinct.
