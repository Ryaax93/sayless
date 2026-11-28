# Notifications iPhone : boucle corrigée, contre-audit de Work, diagnostic

**Préparé par Claude le 27 novembre 2026, complété le 28 novembre** après le contre-audit indépendant de Work, qui refusait `be0bb9b` comme correctif complet (`docs/CONTRE-AUDIT-PUSH-WORK.md`). La mise à jour de TEST n'est faite que par le fondateur, avec les commandes de la dernière section.

Rien ici ne touche `main`, `v2`, la boutique publique, le DNS ni Stripe réel. Rien n'est déployé par Claude ni par Work.

## 1. Ce qui s'est passé

**Constat du fondateur, le 27 novembre à 21 h 49 :**

- 28 messages non distribués.
- Deux alertes Discord « Canal push : échec après 5 essais » toutes les 31 minutes environ.
- Notifications activées sur l'iPhone.
- Tâches automatiques à l'heure, sans plantage.

**La boucle**, relevée par Work et reproduite par un test sur le code `9748ccc` :

1. Un message iPhone échoue 5 fois. Les essais sont espacés de 2, 4, 8 et 16 minutes, soit 31 minutes avec la tâche de chaque minute.
2. Il est abandonné, et une alerte « technique » est créée.
3. Cette alerte repart par Discord, qui marche, et par l'iPhone, qui échoue.
4. 31 minutes plus tard, l'alerte est abandonnée à son tour, ce qui crée une nouvelle alerte, et ainsi de suite.

Deux messages initiaux et un iPhone refusé suffisent : en 8 heures simulées, on obtient 30 alertes, deux toutes les 31 minutes. C'est ce que tu as observé.

**Le départ probable, d'après le code :**

- Le canal iPhone était considéré comme prêt dès que les clés VAPID existaient. Les premières notifications partaient donc vers l'iPhone avant même son abonnement.
- Sans appareil, l'envoi échouait (« aucun appareil abonné ») et la boucle démarrait.

**Pourquoi elle continuait après l'activation de l'iPhone.** L'ancien code ne permet pas de trancher entre deux cas :

- **Le serveur n'avait plus d'abonnement actif.** L'ancien code supprimait en silence un abonnement déclaré expiré par Apple, alors que l'iPhone affichait toujours « Activées ».
- **Apple refusait chaque envoi.** L'ancien code ne gardait que « aucune notification remise », sans le code ni la raison d'Apple.

Le jeton VAPID refait à chaque envoi est une cause possible de refus. Ni Work ni moi ne pouvons le prouver avec l'ancien diagnostic. Le premier essai depuis ton iPhone, après la mise à jour, affichera la réponse exacte d'Apple.

## 2. Ce que fait le correctif

**Plus de boucle, même si Discord tombe aussi.**

- Une panne ouvre un incident **par destination** : un salon Discord, l'iPhone ou les e-mails clients. Elle produit une alerte, puis au plus un rappel par jour tant qu'elle dure.
- Le succès d'un autre salon ne déclare plus un salon en panne « rétabli ». Seul son propre envoi réussi le rétablit.
- L'alerte ne part jamais par la destination en panne :
  - si le salon #alertes a son propre webhook, l'alerte d'un autre salon y part, ainsi que sur l'iPhone ;
  - si tous les salons partagent le webhook de secours, une panne Discord n'est signalée que sur l'iPhone.
- Une alerte qui échoue à son tour n'en crée aucune autre. Les alertes de l'ancienne boucle encore en file meurent en silence.

**Plus de réessais inutiles.**

- Un refus à corriger n'est pas réessayé : clé, en-tête, webhook Discord supprimé.
- Une panne passagère est réessayée : réseau, 429 avec Retry-After respecté, 5xx.

**Aucun appareil n'est pas une panne.**

- Sans iPhone abonné, rien ne part vers l'iPhone : la notification reste dans STUDIO, sans échec ni alerte.
- Un abonnement expiré est gardé, marqué expiré, et n'est plus jamais utilisé ni réactivé.
- Une seule notice « Notifications iPhone à réactiver » part par Discord.

**Un seul jeton VAPID par heure**, le même pour toutes les instances du Worker (section 3, R1).

**Le diagnostic, sans secret ni donnée personnelle.** Chaque échec garde un code court, par exemple `apple_403_BadJwtToken`, avec son explication. Santé du site affiche :

- l'état de chaque canal, et le nom du salon Discord en panne (jamais l'adresse de son webhook) ;
- l'état de chaque iPhone : jamais vérifié, refusé, accepté par Apple, ou **réception constatée** ;
- le contrôle de la paire de clés VAPID dans le Worker.

« Notifications iPhone » n'est en **OK** que si un iPhone a confirmé avoir affiché l'essai. Un « 201 » d'Apple seul reste « En attente » : il prouve qu'Apple a accepté, pas que l'iPhone a affiché.

**Les outils dans STUDIO.**

- **Essai manuel :** la cloche, puis « Envoyer un essai ». La réponse d'Apple s'affiche, expliquée. Quand la notification arrive, l'iPhone confirme sa réception à STUDIO. Six essais au plus par 10 minutes, chaque essai journalisé.
- **Clôture des envois échoués :** Santé du site, « Clôturer », sous Face ID.
  - Discord et iPhone seulement, jamais un e-mail client.
  - Lignes et notifications conservées. La clôture et son entrée d'historique sont écrites ensemble.
  - Une réponse arrivée après la clôture est seulement notée : rien ne repart.

**Deux migrations, seulement additives :**

- `0009` : état des canaux et colonnes de diagnostic ;
- `0010` : état par destination et réception des essais.

Rien n'est effacé ni modifié dans les données existantes.

## 3. Contre-audit de Work du 28 novembre : corrections

Work a reproduit cinq anomalies avec six tests rouges. Ces six tests passent maintenant, **sans aucune modification** : les fichiers de Work sont identiques octet pour octet à son commit `9a2e8e1`.

### R1 (haute) : un seul jeton VAPID pour toutes les instances

**Constat de Work.** Le jeton était gardé dans la mémoire d'une instance. Deux instances donnaient 2 jetons, huit premiers appels simultanés en donnaient 8.

**Correction : signature déterministe.**

- Le jeton ne dépend que de la clé VAPID, du service Apple visé, du sujet et de l'heure en cours. `iat` est arrondi à l'heure, `exp` vaut `iat` + 12 heures.
- La signature ES256 suit la RFC 6979 : pour un même message et une même clé, elle est toujours identique.
- Toute instance, à froid ou en parallèle, calcule donc exactement le même jeton, sans stockage ni coordination. Il change une fois par heure, ou si la configuration change.
- Avant usage, chaque jeton est vérifié avec la clé publique. Une paire de clés incohérente ne produit aucun jeton, avec une erreur explicite.

**Pourquoi pas une coordination par D1, comme Work le proposait.**

- L'unicité est garantie par le calcul, pas par un verrou : aucune course possible entre instances.
- Aucune requête D1 de plus, donc rien sur les limites de l'offre gratuite.
- Aucun cas « D1 indisponible » où il faudrait choisir entre bloquer les notifications et émettre un jeton non coordonné.
- Work a raison : arrondir `exp` seul ne suffisait pas, car une signature ECDSA ordinaire change à chaque fois. C'est la signature qui est rendue déterministe.

**Coût.** 0,8 ms à chaud et 3,7 ms à froid, mesurés sous Node, une fois par heure et par instance. La limite de l'offre gratuite est de 10 ms par appel.

**Limite.** La dernière étape du calcul utilise les grands entiers de JavaScript, sans garantie de durée constante. Le risque est jugé très faible :

- au plus un calcul par heure et par instance, sur le même message pour toutes ;
- une attaque par mesure du temps demanderait des milliers de signatures mesurées finement.

**Preuves :**

- R1a et R1b de Work : 1 jeton dans les deux cas ;
- N11 : deux isolates workerd réels en parallèle donnent le même jeton ; nouvelle heure ou autre sujet, nouveau jeton ; paire incohérente, aucun jeton ; vérification croisée par OpenSSL ;
- N12 : vecteurs officiels de la RFC 6979 (P-256, SHA-256).

### R2 (haute) : un envoi clôturé ne repart jamais

**Constat de Work.** Une réponse réseau arrivée après la clôture remettait l'envoi en attente, puis il repartait.

**Correction.**

- Sélection, prise de l'envoi et chaque écriture du résultat exigent trois conditions : la même tentative, l'état « en cours » et une ligne non clôturée.
- Une réponse tardive, erreur ou succès, est seulement notée sur la ligne close (`remis_apres_cloture` ou `apres_cloture:<code>`). La ligne reste close et la santé du canal ne change pas.
- La reprise d'un Worker interrompu ignore les lignes closes.
- La clôture et son entrée d'historique sont écrites dans le même lot.

**Limite.** Un appel déjà parti vers Apple ou Discord ne peut pas être rappelé. Sa réponse est seulement notée.

**Preuves :**

- R2 de Work : `status=dead, nouvel envoi=0` ;
- N13 : succès tardif noté sans rouvrir ni rétablir, Worker abandonné jamais relancé, clôture et historique ensemble ;
- N07 : e-mails clients jamais touchés.

### R3 (haute) : « Activer » ne recycle plus un abonnement expiré

**Correction.**

- STUDIO garde l'abonnement de l'iPhone seulement si le serveur le confirme actif, avec la même clé.
- Sinon, pendant ton geste, il se désabonne, s'abonne de nouveau et signale l'ancien abonnement au serveur.
- Le serveur ne réactive jamais un abonnement déclaré expiré : il répond « abonnement expiré ». L'ancien est gardé dans l'historique, marqué « remplacé ».
- En cas de refus ou de réseau coupé, STUDIO affiche l'erreur, jamais « activé ».

**Preuves :**

- R3 de Work : `unsubscribe=1, subscribe=1, ancien endpoint réactivé=0` ;
- N14.

### R4 (moyenne) : santé Discord par salon

**Correction.**

- Migration additive `0010` : une ligne de santé par destination réelle.
- Pour Discord, une destination est un webhook réellement utilisé. Elle est identifiée par une empreinte non secrète de son adresse, jamais par l'adresse, et nommée par son salon.
- Un webhook unique partagé par les dix salons donne un seul incident, pas dix.
- L'état global du canal reste calculé pour STUDIO : il est en échec dès qu'une de ses destinations l'est.

**Preuves :**

- R4 de Work : `1 alerte en 4 minutes, diagnostic global=failing` ;
- N15 : deux salons de santé différente ; webhook partagé, un incident, jamais alerté par lui-même ; alerte par #alertes s'il est sain ; Santé nomme « salon commandes » sans adresse.

### R5 (moyenne) : Santé fidèle aux échecs réels

**Correction.**

- Chaque iPhone a un état : jamais vérifié, refusé, accepté par Apple, ou réception constatée.
- Un essai porte un identifiant aléatoire. Le service worker de l'iPhone le renvoie à STUDIO après avoir affiché la notification.
- Un essai refusé met Santé en **Alerte**, sans déclencher d'alerte en chaîne.

**Limite.** La réception n'est confirmée que si la session STUDIO de l'iPhone est ouverte, ce qui est le cas pour un essai lancé depuis l'iPhone. Sans session, l'état reste « accepté », jamais « reçu » à tort.

**Preuves :**

- R5 de Work : `Santé=alert, « Dernier envoi refusé … (403 BadJwtToken) »` ;
- N06 : accepté ≠ reçu, réception comptée une seule fois ;
- N16 : le service worker confirme seulement après l'affichage, seulement pour un essai, et un échec réseau n'empêche jamais l'affichage.

### Changements de tests

- **Tests de Work :** aucune modification.
- **Mes tests :**
  - N06 attend désormais « En attente » après un 201, puis « OK » après la confirmation de l'iPhone. C'est le comportement demandé par R5.
  - N08 applique 0009 puis 0010.
  - T04 contrôle le diagnostic avant et après ces migrations.
  - N11 à N16 sont nouveaux.
- **Intégration continue :** le contre-audit de Work et le test D1 strict y sont désormais obligatoires, sous Linux et Windows.

## 4. Avertissement D1 sous Windows (`fetch failed ×123`)

**Ce que c'est.** Un compteur du banc de test : des requêtes entre Node et le moteur D1 local (Miniflare et workerd), sur ton PC, ont échoué au niveau de la connexion. Ce ne sont ni des ventes, ni des appels à Apple.

**Ce qu'on sait :**

- Absent sous Linux, chez moi comme chez Work.
- Absent de la CI Windows de `be0bb9b` (log relu par Work) et de la nouvelle CI.
- Le test t02 ne vérifiait pas les 130 réponses de webhook. Le test strict de Work (D1-W1) les vérifie toutes et exige zéro erreur de transport. Il fait maintenant partie de la CI, sous Linux et Windows.

**Explication probable, non prouvée.** Les connexions locales du PC saturent sous la charge des suites lancées en parallèle. Le journal ci-dessous permettra de confirmer ou d'écarter cette piste.

**Ce qui change.**

- Aucun nouvel essai automatique n'est ajouté : une erreur reste une erreur et fait échouer le test qui en dépend.
- Le compteur retient la cause la plus profonde, par exemple `ECONNRESET` plutôt que `fetch failed`.
- Chaque erreur est notée dans `.journaux-tests\d1-transport-<suite>-<numéro>.jsonl`, dossier ignoré par Git. Le journal contient :
  - l'instant ;
  - l'opération, réduite aux trois premiers mots SQL, jamais une valeur ;
  - l'étape du test : fichier et ligne ;
  - la chaîne complète des causes, avec les codes de connexion ;
  - en en-tête : versions de Node, de Windows et de Miniflare, nombre de processeurs.
- Les données des tests sont fictives. Le journal ne contient ni adresse, ni clé, ni donnée de client.

**Ce qu'il reste à faire.** Le bloc A lance d'abord le test D1 strict seul, dans une copie neuve. Si un journal apparaît, envoie-le-moi. Le transport D1 local sur ton PC reste **validé sous réserve** jusqu'à une exécution sans avertissement ou une cause identifiée.

## 5. Codes affichés et quoi faire

| Code | Ce que ça veut dire | Que faire |
| --- | --- | --- |
| `apple_403_BadJwtToken` | Apple refuse le jeton VAPID : signature, sujet, audience ou expiration | Envoie-moi la ligne exacte affichée par l'essai ; contrôle « Clés VAPID » dans Santé |
| `apple_403_BadVapidPublicKey` | Clé publique VAPID refusée | Même chose |
| `apple_403_VapidPkHashMismatch` | L'iPhone s'est abonné avec une autre clé | Cloche, puis « Activer » de nouveau |
| `apple_410` ou `apple_404` | Abonnement expiré chez Apple | Cloche, puis « Activer » de nouveau |
| `apple_400_…` | En-tête ou chiffrement refusé | Envoie-moi le code exact |
| `apple_429`, `apple_5xx`, `reseau`, `delai` | Panne passagère | Rien : nouvel essai automatique |
| `aucun_appareil` | Aucun iPhone abonné au moment de l'envoi | Cloche, puis « Activer » ; ce n'est pas une panne |
| `discord_404`, `discord_401`, `discord_403` | Webhook Discord supprimé ou refusé ; Santé nomme le salon | Recrée le webhook de ce salon (`docs/DISCORD.md`) |
| `canal_non_configure` | Message destiné à un canal sans réglage | Saisis le webhook manquant (`docs/DISCORD.md`) |
| `remis_apres_cloture`, `apres_cloture:…` | Réponse arrivée après ta clôture, seulement notée | Rien |
| « abonnement déjà refusé par Apple » (dans STUDIO) | L'iPhone a fourni un abonnement expiré | Ferme STUDIO, rouvre-le depuis l'icône, puis « Activer » |

**Ne régénère pas les clés VAPID** pour essayer de régler un refus : cela obligerait à réabonner l'iPhone sans rien corriger. Envoie-moi d'abord le code affiché.

## 6. Ce qui n'est pas vérifié

- Apple et Discord sont simulés dans tous les tests. Le premier vrai résultat sera ton essai depuis l'iPhone après la mise à jour : la ligne « Réception constatée ».
- Le temps de calcul réel sur Cloudflare n'est pas mesuré. Sous Node, le jeton coûte au plus 3,7 ms, une fois par heure et par instance.
- Le transport D1 local sur ton PC est validé sous réserve (section 4).
- La confirmation de réception par Safari sur iPhone est testée en simulation seulement.
- Les liaisons et secrets réellement présents sur Cloudflare ne sont pas lus par moi. L'assistant les contrôle pendant la mise à jour.

## 7. Mettre à jour Cloudflare TEST (PowerShell)

Base D1, secrets, sauvegardes, Face ID et codes de secours sont conservés :

- La base n'est pas recréée. Les migrations `0009` (si elle manque encore) et `0010` n'ajoutent que des tables et des colonnes.
- Les secrets ne sont ni régénérés ni renvoyés : Discord, Stripe TEST, Resend et clés VAPID restent en place.
- Les réglages faits avec `reglage` sont conservés.
- Les sauvegardes, les appareils Face ID et les codes de secours ne sont pas touchés.
- Un point de restauration de la base est noté juste avant les migrations (Time Travel de D1, 7 jours sur l'offre gratuite).

Copie chaque bloc en entier dans PowerShell. Chaque bloc s'arrête à la première erreur. La version exacte à vérifier est indiquée dans le message de livraison et sur la PR nº 1.

**Bloc A : vérifier la correction dans une copie neuve, sans rien déployer** (environ 20 minutes)

Ce bloc ne touche ni le dossier `sayless-test`, ni Cloudflare. Les données des tests sont temporaires.

```powershell
& {
  $ErrorActionPreference = 'Stop'
  $attendu = (Read-Host 'SHA indiqué dans le message de livraison').Trim()
  if ($attendu -notmatch '^[0-9a-f]{40}$') { throw 'Colle le SHA complet (40 caractères)' }
  $copie = Join-Path $env:USERPROFILE "sayless-verif-$($attendu.Substring(0, 7))"
  if (Test-Path $copie) { throw "Ce dossier existe déjà : $copie" }
  git clone --single-branch --branch claude/verification-v2 https://github.com/Ryaax93/sayless.git $copie
  if ($LASTEXITCODE -ne 0) { throw 'Copie impossible' }
  Set-Location $copie
  if ((git rev-parse HEAD) -ne $attendu) { throw "Version inattendue : $(git rev-parse HEAD)" }
  npm.cmd ci --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Installation incomplète' }
  npm.cmd run test:review:d1
  if ($LASTEXITCODE -ne 0) { throw "Transport D1 en échec : envoie-moi le dossier $copie\.journaux-tests" }
  foreach ($suite in 'test:review:push', 'test', 'test:review', 'test:review:v13', 'test:review:v14', 'test:review:risks', 'test:webauthn:bibliotheque') {
    npm.cmd run $suite
    if ($LASTEXITCODE -ne 0) { throw "Suite en échec : $suite" }
  }
  npm.cmd audit
  if ($LASTEXITCODE -ne 0) { throw 'Audit à examiner' }
  $journaux = @(Get-ChildItem (Join-Path $copie '.journaux-tests') -Filter '*.jsonl' -ErrorAction SilentlyContinue)
  if ($journaux.Count -gt 0) {
    Write-Host "Suites réussies, transport D1 local SOUS RÉSERVE : envoie-moi le dossier $copie\.journaux-tests" -ForegroundColor Yellow
  } else {
    Write-Host "Code vérifié, aucune erreur de transport D1. Rien n'est déployé." -ForegroundColor Green
  }
}
```

**Bloc B : diagnostic, en lecture seule** (facultatif, avant la mise à jour)

```powershell
& {
  $ErrorActionPreference = 'Stop'
  Set-Location "$env:USERPROFILE\sayless-test"
  node scripts/test-env.mjs diagnostic
  if ($LASTEXITCODE -ne 0) { throw 'Diagnostic impossible : relance npx.cmd wrangler login, puis ce bloc' }
}
```

Il n'affiche que des codes, des nombres et des dates : aucune adresse, aucune clé, aucune donnée de client.

**Bloc C : mise à jour de TEST, seulement après le nouveau contre-audit de Work et ta décision**

```powershell
& {
  $ErrorActionPreference = 'Stop'
  $attendu = (Read-Host 'SHA indiqué dans le message de livraison').Trim()
  if ($attendu -notmatch '^[0-9a-f]{40}$') { throw 'Colle le SHA complet (40 caractères)' }
  Set-Location "$env:USERPROFILE\sayless-test"
  if (-not (Test-Path '.\ops\test-env.local.json')) { throw "Installation TEST introuvable ici : utilise le dossier de l'installation" }
  git pull --ff-only
  if ($LASTEXITCODE -ne 0) { throw 'Mise à jour du dossier impossible' }
  if ((git rev-parse HEAD) -ne $attendu) { throw "Version inattendue : $(git rev-parse HEAD)" }
  npm.cmd ci --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Installation incomplète' }
  node scripts/test-env.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Mise à jour incomplète : lis le message. La base a un point de restauration.' }
  node scripts/test-env.mjs etat
  if ($LASTEXITCODE -ne 0) { throw 'Environnement TEST non opérationnel après la mise à jour' }
  node scripts/test-env.mjs diagnostic
}
```

- L'assistant demande « OUI » et note le point de restauration de la base. Il applique les migrations manquantes et remet le code en ligne sans toucher aux secrets, puis contrôle l'environnement.
- Résultat attendu : « Installation terminée et vérifiée », puis « Environnement de TEST opérationnel ».
- Garde la ligne « Point de restauration de la base : … ».
- Une variable modifiée directement dans le tableau de bord Cloudflare serait remplacée : refais-la avec `reglage`.

**Sur l'iPhone, ensuite :**

1. Ouvre STUDIO depuis l'icône et connecte-toi avec Face ID.
2. Touche la cloche de l'écran Aujourd'hui.
3. Si la ligne « Sur cet iPhone » montre un bouton « Activer », touche-le et accepte les notifications.
   - En cas de message « abonnement déjà refusé par Apple » : ferme STUDIO complètement, rouvre-le depuis l'icône, puis « Activer ».
   - Quand l'abonnement est reconnu, la ligne affiche « Activées » et le bouton « Envoyer un essai » apparaît.
4. Touche « Envoyer un essai ».
   - Attendu : « accepté par Apple (201) », puis la notification sur l'iPhone.
   - Sinon, envoie-moi la ligne affichée. Elle ne contient aucun secret.
5. Plus, puis Santé du site. Attendu : « Notifications iPhone » en OK, avec « Réception constatée sur … ».
   - Si la ligne reste « Accepté … pas encore constatée » plus d'une minute alors que la notification est arrivée, envoie-moi une capture.
6. Toujours dans Santé, section « Envois échoués » : touche « Clôturer » et valide avec Face ID. Les lignes restent dans l'historique.
7. L'historique affiche « Essai de notification iPhone » et « Envois échoués clôturés ».

**Contrôle deux heures plus tard** : relance le bloc B. Aucun nouvel envoi iPhone non remis ne doit apparaître après l'heure de la mise à jour, et « Destinations en échec » doit indiquer « aucune », ou seulement un salon que tu sais à réparer.

**Retour arrière, seulement si je te le conseille :**

- **Le code :** `npx.cmd wrangler rollback -c ops/wrangler.test.local.toml` (confirmation demandée). L'ancien code fonctionne avec la base migrée, car les migrations sont additives.
- **La base :** `npx.cmd wrangler d1 time-travel restore sayless-test --bookmark=<point noté> -c ops/wrangler.test.local.toml`. Elle revient à l'instant d'avant les migrations ; tout ce qui a été écrit depuis est perdu.
