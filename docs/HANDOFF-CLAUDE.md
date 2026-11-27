# Passation Work → Claude — API v1.4

26 novembre 2026. PR nº 2, `work/frontend-api-v1-2`, préparée depuis `f6332555b44f8c3441a29d804d8bb013b2800522` contenant votre `7102f43`. Aucune fusion vers `v2`. [Contre-audit détaillé](REVUE-V1-4-WORK.md).

## Acquis vérifiés

B1 transactionnel, B2 archive obligatoire et C1 document exact : vérifiés dans les chemins de code, avec injection de pannes et restauration. 211 tests Node + 13 contrôles commerciaux passent ; un test de risque distinct reste rouge. La boutique transmet `terms_version` et `terms_sha256` pour les nouvelles tentatives, vérifie le corps avec Web Crypto, l'affiche sans HTML et conserve les reprises antérieures.

Nettoyage réalisé selon votre accord `DEPENDANCES.md` §3 : retrait Next/Vinext et anciens points d'entrée ; fixtures historiques conservées. Wrangler 4.168.0 et Miniflare 5.20261123.1-beta inchangés. Audit complet et production : zéro. Relire le commit dédié package/verrou avant fusion ; en cas de conflit, régénérer le verrou depuis le manifeste réconcilié. Ne pas réintroduire l'ancien gabarit.

Seul changement dans vos tests : la fixture `tests/backend/parity.test.mjs` reçoit le hash du devis pour passer dans le client v1.4. Aucun code métier, migration, STUDIO ou assistant modifié par Work.

## Corrections et décisions à prendre

1. **V14-R1, prioritaire avant recette e-mail fiable** : `npm run test:review:risks` reproduit deux envois après réponse Resend perdue et reprise >24 h. Conserver `first_attempt_at` avant l'appel, clé et contenu figés, reçu fournisseur ; délai maximal de reprise inférieur à la fenêtre garantie ; état incertain et rapprochement au-delà. Préserver la reprise des intentions non encore envoyées. Tester aussi crash après succès avant UPDATE, expiration du bail, concurrence, modification de l'expéditeur et restauration d'une ancienne sauvegarde. L'idempotence du fournisseur ne dure pas indéfiniment.
2. **API v1.5 proposée** : rendre `terms_sha256` obligatoire pour toute nouvelle réservation. Vérifier d'abord la clé existante et le fingerprint original, puis exiger hash/version/quote/archive courants pour une nouvelle commande. Ne pas injecter un hash a posteriori dans le fingerprint des anciennes tentatives sans hash. Critères : absence refusée sans mutation ; faux hash refusé ; reprise ancienne identique autorisée ; même clé avec contenu changé refusée. Work est prêt ; modifier le contrat et tests ensemble avant ouverture.
3. **Assistant TEST** : faire remonter le booléen de `report(url)` dans `install()` et tester un contrôle de santé négatif. En attendant, la procédure PowerShell Work exécute `etat` séparément, code non nul bloquant. L'assistant sans argument et `reglage` déploient : conserver un accord explicite du fondateur.
4. **CI partagée** : ajouter `npm run test:review:v14`, build boutique TEST fermé, et rendre l'audit npm bloquant maintenant qu'il est à zéro. Conserver le risque R1 explicitement suivi ; après correction, intégrer son test dans une suite obligatoire. Le workflow Claude n'a pas été modifié unilatéralement.
5. **SimpleWebAuthn** : accord technique Work sur 14.1.0 et votre adaptateur ; Node et workerd sans nodejs_compat confirmés. Ne pas enlever le garde cross-origin/topOrigin. Garder toutes les politiques sessions/récupération/UP/UV/signatures/reauth. Validation du fondateur avant bascule ; essai iPhone et CPU hébergé ensuite. Aucun remplacement réalisé ici.
6. **Recette externe** : Cloudflare fermé, puis secrets TEST et services séparément, inventaire de recette clairement identifié. Confirmation de l'inventaire réel via STUDIO après contrôle des ventes V1. Aucun changement du lien V1. Boxtal suspendu à la réponse au ticket 2277409.

## Discord : un seul webhook actuellement

`configuredChannels` et `discordSender` utilisent `DISCORD_WEBHOOK_URL`. Cela permet une destination Discord, pas quatorze. Proposition à implémenter par Claude sans nouveau service : un secret Worker par salon utile, une table de routage fixe `kind → destination`, sans URL ni canal fournis par le navigateur. Résolution et validation des URLs exclusivement côté serveur ; ne jamais journaliser les tokens. Garder le webhook actuel comme secours `alertes` seulement si explicitement configuré.

| Salon | Événements autorisés proposés |
| --- | --- |
| rapport-quotidien | Agrégats journaliers |
| finances | Totaux agrégés, anomalies de rapprochement sans identité client |
| à-faire | Compteurs de tâches manuelles |
| commandes | Nouvelle commande : référence interne opaque, taille, montant, état |
| expéditions | Compteurs et état de préparation ; aucun lien porteur de jeton ni adresse |
| retours | Compteurs et état des dossiers ; aucun motif libre du client |
| stock | Seuil, taille épuisée, fin de drop |
| alertes | Échec technique, envoi incertain, file bloquée |
| sécurité | Événement technique minimisé, sans IP, e-mail, token ou identifiant d'appareil |
| état-du-site | Santé et disponibilité |
| sauvegardes | Résultat, date et contrôle d'intégrité ; ni contenu ni clé ni lien de téléchargement |
| direction-artistique, contenus, futurs-drops | Salons manuels ; aucune automatisation nécessaire au DROP 01 |

Persister une destination logique dans chaque envoi et dédupliquer par `(événement, destination)` ; bornes du budget partagé, gestion 429/Retry-After, pas de mentions (`allowed_mentions: {parse: []}`). Tests : routage exact, salon absent, erreur d'une destination isolée, reprise, aucune donnée personnelle même dans les erreurs. Discord n'offre pas la même garantie d'idempotence que Resend : ne pas promettre zéro doublon réseau. Ne copier aucun secret Discord vers Pages.

## Éléments fondateur enregistrés

Comptage du 26 novembre 2026 : S8/M14/L5 =27, aucune pièce endommagée. Hypothèse sample offert non confirmée ; ne pas réécrire l'historique ni initialiser la production automatiquement. Poids emballés environ 711/821/872 g, sachet 55×45 cm, épaisseur 10 cm pour simulation seulement. Prix 75 €, relais 4,90 €, domicile 8,50 €, transporteur non validé. Voir `INFORMATIONS-A-COMPLETER.md`.

[Procédure PowerShell](POWERSHELL-TEST-V1-4.md) · [Frontend TEST](CLOUDFLARE-TEST-FRONTEND.md) · [Responsabilités](OWNERSHIP.md) · [Design system](DESIGN-SYSTEM.md)
