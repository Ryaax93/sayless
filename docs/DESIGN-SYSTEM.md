# Identité SAYLESS — à partager avec SAYLESS STUDIO

Le design existant est validé. Le conserver : ne pas recommencer la boutique, ne pas substituer de faux logos, ne pas réintroduire le post-it flottant.

## Tokens existants

| Usage | Valeur CSS |
| --- | --- |
| Noir / texte | `--ink: #151515` |
| Fond papier | `--paper: #f4f1eb` |
| Rose pastel de l’interface | `--pink: #f0a6bf` |
| Blanc clair | `--white: #fffefa` |
| Texte secondaire | `--muted: #69645e` |
| Filets clairs | `--line: #d4d0c8` |
| Filets sur noir | `--darkline: #383838` |
| Titres | `SaylessDisplay` → Open Sans Condensed Bold, `assets/display.ttf` |
| Texte | `SaylessSans` → Open Sans Regular / Semibold, `assets/body.ttf`, `assets/body-semibold.ttf` |

Le rose de l’interface n’est pas une mesure colorimétrique du tissu. Les polices embarquées déclarent Apache 2.0 dans leurs métadonnées ; notices et licence complète sont jointes. Deux familles visuelles : texte et condensée de titrage.

## Ressources

Vrai logo : `public/store/assets/logo.webp` (transparent/inversion CSS selon le fond). Favicon : `favicon.svg`. Photos conservées : `hoodie-front.webp`, `hoodie-back.webp`, `campaign.webp`. Aucun visuel n’a été régénéré pour cet export. L’authenticité, les crédits et les autorisations commerciales des photos restent à confirmer par le fondateur ; ne pas présenter les observations du rapport sur la 1.0 comme une vérification photographique nouvelle.

## Composants et lisibilité

Titres condensés en capitales, texte courant lisible, grands visuels, espace généreux, filets fins, boutons rectangulaires sobres. Les pages légales gardent fond clair, texte noir, paragraphes courts et hiérarchie nette. Le footer reste organisé par service et information, sans newsletter factice ni moyens de paiement non disponibles.

Réutiliser `.button`, `.text-link`, `.eyebrow`, `.summary-row`, `.notice`, `.field`, les états de focus et les dialogues accessibles. Studio peut reprendre ces tokens et principes ; ses écrans opérationnels sont à concevoir par Claude, sans copier aveuglément la mise en page de la boutique.

## Animations

La barre rose utilise deux groupes de largeur identique, le logo original, un déplacement CSS `translate3d` de 0 à −50 % sur 32 secondes, linéaire et infini. Aucune mise à jour du stock ne recrée la piste : seul le texte change, sans redémarrer l’animation. Le bouton Pause/Reprendre agit sur `animationPlayState`. La pause de test n’est pas persistée : le chargement d’une page neuve démarre l’animation.

`prefers-reduced-motion: reduce` désactive le défilement, réorganise le contenu sur plusieurs lignes et masque la copie répétée. Ne pas forcer l’animation contre cette préférence. Pas de flash, vibration, fausse urgence ni curseur intrusif.

## États de stock

Un seul total pour le client ; jamais de quantités par taille. Les tailles ont des états accessibles (« Disponible », « Épuisée », « Réservée temporairement », « Disponibilité à confirmer »). Le grand état SOLD OUT n’apparaît qu’après confirmation explicite du système, pas lorsque l’API échoue ni quand toutes les pièces sont temporairement réservées.

Texte validé :

> DROP 01 — SOLD OUT.
>
> Merci à tous ceux qui ont participé au premier chapitre de SAYLESS. Ce n’est que le début.
>
> Restez connectés sur Instagram : @sayless.brand
>
> SAY LESS. DO MORE.
