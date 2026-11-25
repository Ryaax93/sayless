# Passation Work → Claude — contrat v1.3

La PR nº 2 reste en brouillon sur `work/frontend-api-v1-2`. Elle contient l'intégration de votre SHA `aab52709f40fd6a5bed3346ac4b7732fd4b2446e` via la branche de vérification `4d6a5cc`, puis les seuls changements boutique, tests Work et documentation. Aucun fichier backend/STUDIO/ops/migration n'a été modifié par Work.

1. Les quatre corrections précédentes sont vérifiées et les quatre tests Work passent. Voir la [contre-revue complète](REVUE-V1-3-WORK.md).
2. Corriger **V13-B1**, la perte définitive de confirmation e-mail si sa mise en file échoue après paiement, et **V13-B2**, la version de CGV sans document archivé. Reproduction : `npm run test:review:v13` (deux échecs attendus tant que non corrigés). Les tests se trouvent dans `tests/review/v13-open-issues.test.mjs`.
3. Coordonner **V13-C1** : route publique de texte CGV archivé et empreinte, ou export statique immuable commun. Le client exige maintenant la version du devis et bloque toute nouvelle acceptation si elle diffère de sa configuration. Ne pas ouvrir avec seulement une version renseignée dans `settings`.
4. Valider la migration vers SimpleWebAuthn. Installation et essais Node/workerd possibles ici ; aucune dépendance ni vérificateur backend modifié. Plan COSE/JWK, userVerification, RP ID/origine, récupération/génération, compteurs et limites CPU dans la revue.
5. Le suivi consomme `/api/order` par Bearer en mémoire ; `/api/order/lookup` conserve sa réponse neutre. Contact/retour/rétractation consomment `/api/requests`. Une interruption réseau de cette dernière route n'est pas rejouée automatiquement faute de clé idempotente contractuelle ; référence et date exigées pour confirmer l'enregistrement.
6. Les relais affichent leur adresse complète, figée dans le devis. Valider le fournisseur réel, la disponibilité et l'instantané à la réservation/étiquette. Les tarifs restent 4,90 € et 8,50 € sous réserve du transporteur. Une seule pièce à 75 €, France métropolitaine hors Corse, aucun Klarna.
7. Lire le [complément frontend pour Cloudflare TEST](CLOUDFLARE-TEST-FRONTEND.md). Le build est fermé par défaut et limité à l'origine de test. Les ressources et secrets ne sont pas créés par Work. `public/_headers` s'applique aux actifs statiques ; les réponses Functions conservent leurs en-têtes propres.
8. Rejouer les suites sur le SHA corrigé, y compris les deux nouvelles régressions. Ensuite, seulement après autorisation du fondateur, recette Cloudflare séparée, Stripe TEST, transporteur, Resend, notifications et iPhone. Publier le SHA et les preuves de recette ; ne fusionner aucune PR sans accord.

Pour isoler les adaptations Work : `git diff aab52709f40fd6a5bed3346ac4b7732fd4b2446e..work/frontend-api-v1-2 -- public/store scripts tests docs README.md CHANGELOG.md package.json public/_headers public/_routes.json`.

[Contrat](API-CONTRACT.md) · [Responsabilités](OWNERSHIP.md) · [Design system](DESIGN-SYSTEM.md) · [État](STATUS.md)
