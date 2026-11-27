# Notifications iPhone : correctif de la boucle et diagnostic

**Préparé par Claude le 27 novembre 2026**, après l'essai réel du fondateur sur Cloudflare TEST. La mise à jour de TEST n'est faite que par le fondateur, avec les commandes de la dernière section.

Rien ici ne touche `main`, la boutique publique, le DNS ni Stripe réel.

## 1. Ce qui s'est passé

**Constat du fondateur, à 21 h 49 :**

- 28 messages non distribués.
- Deux alertes Discord « Canal push : échec après 5 essais » toutes les 31 minutes environ.
- Notifications activées sur l'iPhone.
- Tâches automatiques à l'heure, sans plantage.

**La boucle**, relevée par Work et reproduite par un test sur le code `9748ccc` :

1. Un message iPhone échoue 5 fois. Les essais sont espacés de 2, 4, 8 et 16 minutes, soit 31 minutes avec la tâche de chaque minute.
2. Il est abandonné, et une alerte « technique » est créée.
3. Cette alerte repart par Discord, qui marche, et par l'iPhone, qui échoue.
4. 31 minutes plus tard, l'alerte est abandonnée à son tour, ce qui crée une nouvelle alerte, et ainsi de suite.

Deux messages initiaux et un iPhone refusé suffisent : en 8 heures simulées, on obtient 30 alertes, deux toutes les 31 minutes. C'est ce que tu as observé (28 à 21 h 49).

**Le départ probable, d'après le code :**

- Le canal iPhone était considéré comme prêt dès que les clés VAPID existaient. Les premières notifications de l'environnement partaient donc vers l'iPhone avant même son abonnement : rapport, sauvegarde, etc.
- Sans appareil, l'envoi échouait (« aucun appareil abonné ») et la boucle démarrait. Deux messages de ce type donnent deux chaînes, donc deux alertes toutes les 31 minutes.

**Pourquoi la boucle continue après l'activation de l'iPhone.** Une fois l'iPhone abonné, un envoi accepté aurait dû arrêter chaque chaîne. Elle continue, donc l'envoi échoue encore. L'ancien code ne permet pas de savoir lequel de ces deux cas s'applique :

- **Le serveur n'a plus d'abonnement actif.** L'ancien code supprimait en silence un abonnement qu'Apple déclarait expiré (404 ou 410), alors que l'iPhone continuait d'afficher « Activées ».
- **Apple refuse chaque envoi.** L'ancien code ne gardait que « aucune notification remise », sans le code ni la raison d'Apple.

La commande `diagnostic` (section 5) lit ces traces dans ta base avant la mise à jour. Ensuite, l'essai depuis STUDIO affiche la réponse exacte d'Apple.

**Revue du code contre les exigences d'Apple** (documentation « Sending web push notifications in web apps and browsers »).

Points conformes :

| Point contrôlé | Résultat |
| --- | --- |
| Chiffrement aes128gcm | Conforme : un test déchiffre le message comme le ferait l'iPhone |
| En-têtes TTL, Urgency, Topic | Conformes |
| Jeton VAPID : audience, sujet https, expiration à moins d'un jour, clé `k=` | Conformes |
| Configuration Cloudflare | La paire de clés VAPID est générée ensemble par l'assistant. Le Worker joint bien l'extérieur (Discord passe par le même Worker), et le processeur n'est pas dépassé (wrangler tail) |

Écarts trouvés, corrigés :

- **Jeton VAPID refait à chaque envoi.** Apple demande de ne pas le renouveler plus d'une fois par heure. Il est maintenant gardé 6 heures et vaut 12 heures.
- **Ancien abonnement réutilisé sans vérification.** STUDIO reprenait un abonnement existant sans vérifier sa clé. Un abonnement créé avec une autre clé serait refusé par Apple (VapidPkHashMismatch) ; il est maintenant remplacé.

## 2. Ce que fait le correctif

**Plus de boucle, même si Discord tombe aussi.**

- Une panne de canal ouvre un incident et produit une seule alerte. Ensuite, au plus un rappel par jour tant que la panne dure.
- L'alerte ne part jamais par le canal en panne.
- Une alerte qui échoue à son tour n'en crée aucune autre.
- Les alertes de l'ancienne boucle encore en file meurent en silence.

**Plus de réessais inutiles.**

- Un refus à corriger n'est pas réessayé : clé, en-tête, webhook Discord supprimé.
- Une panne passagère est réessayée : réseau, 429 avec Retry-After respecté, 5xx.

**Aucun appareil n'est pas une panne.**

- Sans iPhone abonné, rien ne part vers l'iPhone : la notification reste dans STUDIO, sans échec ni alerte.
- Un abonnement expiré est gardé, marqué expiré, et n'est plus utilisé.
- Une seule notice « Notifications iPhone à réactiver » part par Discord.

**Le diagnostic, sans secret ni donnée personnelle.** Chaque échec garde un code court, par exemple `apple_403_BadJwtToken`, avec son explication en français. STUDIO affiche ensuite :

- l'état de chaque canal ;
- les appareils, sous une empreinte de 12 caractères, jamais l'adresse d'abonnement ;
- le dernier code de réponse ;
- le contrôle de la paire de clés VAPID dans le Worker.

**Les outils dans STUDIO.**

- **Essai manuel :** la cloche, puis « Envoyer un essai ». La réponse d'Apple s'affiche, expliquée. Six essais au plus par 10 minutes, chaque essai journalisé.
- **Clôture des envois échoués :** Santé du site, « Clôturer », sous Face ID.
  - Discord et iPhone seulement, jamais un e-mail client.
  - Lignes et notifications conservées, opération journalisée.

**La migration `0009`** est seulement additive : une table d'état des canaux, des colonnes en plus, rien d'effacé ni de modifié.

**Les tests :** N01 à N10, une recette navigateur dans workerd, et la reprise de l'assistant de TEST avec point de restauration. Détail dans le CHANGELOG.

## 3. Codes affichés et quoi faire

| Code | Ce que ça veut dire | Que faire |
| --- | --- | --- |
| `apple_403_BadJwtToken` | Apple refuse le jeton VAPID : signature, sujet, audience ou expiration | Envoie-moi la ligne exacte affichée par l'essai ; contrôle « Clés VAPID » dans Santé |
| `apple_403_BadVapidPublicKey` | Clé publique VAPID refusée | Même chose |
| `apple_403_VapidPkHashMismatch` | L'iPhone s'est abonné avec une autre clé | Cloche, puis « Activer » de nouveau |
| `apple_410` ou `apple_404` | Abonnement expiré chez Apple | Cloche, puis « Activer » de nouveau |
| `apple_400_…` | En-tête ou chiffrement refusé | Envoie-moi le code exact |
| `apple_429`, `apple_5xx`, `reseau`, `delai` | Panne passagère | Rien : nouvel essai automatique |
| `aucun_appareil` | Aucun iPhone abonné au moment de l'envoi | Cloche, puis « Activer » ; ce n'est pas une panne |
| `discord_404`, `discord_401`, `discord_403` | Webhook Discord supprimé ou refusé | Recrée le webhook du salon (`docs/DISCORD.md`) |

## 4. Ce qui n'est pas vérifié

- Les tests simulent Apple et Discord. Le premier vrai résultat sera l'essai depuis ton iPhone après la mise à jour.
- La cause exacte des refus d'Apple sur ton environnement sera connue par la commande `diagnostic` et par cet essai.

## 5. Mettre à jour Cloudflare TEST (PowerShell)

Base D1, secrets, sauvegardes et inscription Face ID sont conservés :

- La base n'est pas recréée, et la migration `0009` n'ajoute que des colonnes et une table.
- Les secrets ne sont ni régénérés ni renvoyés.
- Les sauvegardes et les appareils Face ID restent en place.
- Un point de restauration de la base est noté juste avant la migration (Time Travel de D1, 7 jours sur l'offre gratuite).

À lancer dans le dossier utilisé pour l'installation de TEST (`sayless-test`). Copie chaque bloc en entier dans PowerShell. Le bloc s'arrête à la première erreur.

**Bloc A : récupérer la correction et la vérifier, sans rien déployer** (environ 15 minutes)

```powershell
& {
  $ErrorActionPreference = 'Stop'
  Set-Location "$env:USERPROFILE\sayless-test"
  if (-not (Test-Path '.\ops\test-env.local.json')) { throw "Installation TEST introuvable ici : utilise le dossier de l'installation" }
  git pull --ff-only
  if ($LASTEXITCODE -ne 0) { throw 'Mise à jour du dossier impossible' }
  git rev-parse HEAD
  npm.cmd ci --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Installation incomplète' }
  foreach ($suite in 'test', 'test:review', 'test:review:v13', 'test:review:v14', 'test:review:risks', 'test:webauthn:bibliotheque') {
    npm.cmd run $suite
    if ($LASTEXITCODE -ne 0) { throw "Suite en échec : $suite" }
  }
  npm.cmd audit
  if ($LASTEXITCODE -ne 0) { throw 'Audit à examiner' }
  Write-Host "Code vérifié. Rien n'est encore déployé." -ForegroundColor Green
}
```

**Bloc B : diagnostic, en lecture seule** (avant la mise à jour)

```powershell
& {
  $ErrorActionPreference = 'Stop'
  node scripts/test-env.mjs diagnostic
  if ($LASTEXITCODE -ne 0) { throw 'Diagnostic impossible : relance npx.cmd wrangler login, puis ce bloc' }
}
```

Envoie-moi ce qu'il affiche. Ce ne sont que des codes, des nombres et des dates : aucune adresse, aucune clé, aucune donnée de client.

**Bloc C : mise à jour de TEST, après ta validation**

```powershell
& {
  $ErrorActionPreference = 'Stop'
  node scripts/test-env.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Mise à jour incomplète : lis le message. La base a un point de restauration.' }
  node scripts/test-env.mjs etat
  if ($LASTEXITCODE -ne 0) { throw 'Environnement TEST non opérationnel après la mise à jour' }
}
```

- L'assistant demande « OUI », note le point de restauration de la base et applique la migration `0009`. Il remet le code en ligne sans toucher aux secrets, puis contrôle l'environnement.
- Résultat attendu : « Installation terminée et vérifiée », puis « Environnement de TEST opérationnel ».
- Garde la ligne « Point de restauration de la base : … ».
- Les réglages faits avec `reglage` sont conservés. Une variable modifiée directement dans le tableau de bord Cloudflare serait remplacée : refais-la avec `reglage`.

**Sur l'iPhone, ensuite :**

1. Ouvre STUDIO depuis l'icône et connecte-toi avec Face ID.
2. Touche la cloche de l'écran Aujourd'hui.
3. Si « Sur cet iPhone » indique un abonnement inconnu du serveur, expiré ou créé avec une ancienne clé, touche « Activer ».
4. Touche « Envoyer un essai » :
   - « Accepté par le service de notification » et une notification qui arrive : c'est réglé ;
   - sinon, envoie-moi la ligne affichée. Elle ne contient aucun secret.
5. Plus, puis Santé du site et historique : à la section « Envois échoués », touche « Clôturer » et valide avec Face ID. Les lignes restent dans l'historique.
6. L'historique affiche « Essai de notification iPhone » et « Envois échoués clôturés ».

**Retour arrière, seulement si je te le conseille :**

- **Le code :** `npx.cmd wrangler rollback -c ops/wrangler.test.local.toml` (confirmation demandée). L'ancien code fonctionne avec la base migrée, car la migration est additive.
- **La base :** `npx.cmd wrangler d1 time-travel restore sayless-test --bookmark=<point noté> -c ops/wrangler.test.local.toml`. Elle revient à l'instant d'avant la migration ; tout ce qui a été écrit depuis est perdu.
