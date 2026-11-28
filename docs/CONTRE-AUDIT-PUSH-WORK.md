# SAYLESS — contre-audit indépendant du correctif push

**28 novembre 2026 — verdict : NO GO pour redéployer `be0bb9bf0406059cd129d8c818a5d3743992e6a3` en tant que correctif complet.**

La cascade autonome d'alertes toutes les 31 minutes est corrigée dans les chemins examinés et dans les essais. Cinq anomalies distinctes restent reproduites par six tests rouges. Les priorités sont le cache VAPID, la clôture concurrente et la reprise d'un abonnement expiré. La gestion des dix salons et les diagnostics doivent également être corrigés avant la prochaine recette.

## 1. Périmètre et preuves

- Source examinée : PR nº 1, branches `claude/integration-v2` et `claude/verification-v2`, toutes deux au SHA `be0bb9bf0406059cd129d8c818a5d3743992e6a3` au début de la revue.
- Branche de preuves : `work/audit-push-be0bb9b`, créée depuis ce SHA. Aucun code backend, STUDIO, migration ou dépendance modifié ; uniquement tests indépendants, rapport et changelog.
- Documents fournis lus : `NOTIFICATIONS-PUSH.md`, `Diagnostic-PUSH.txt`, `SAYLESS-Tests-Windows-PUSH.txt`. Les journaux privés fournis ne sont pas copiés dans GitHub.
- Lecture des fichiers du correctif et des chemins associés : file d'envoi, routage, Web Push, routes STUDIO, authentification, migration, sauvegardes, assistant de mise à jour, tests et actions de l'interface.
- Banc local : Linux, Node 24.22.3, npm 11.19.1, dépendances du verrou installé avec `npm ci --ignore-scripts --no-audit --no-fund`. D1 exécutée par Miniflare/workerd ; migration également rejouée par le véritable Wrangler en `--local`.
- Apple, Discord et les autres fournisseurs sont simulés dans ces essais. Les signatures et le chiffrement sont réels avec des clés éphémères de recette. Le fondateur a confirmé l'installation de TEST et Face ID sur son iPhone ; cette revue ne prétend pas avoir effectué un nouvel essai physique sur cet iPhone.
- Aucun accès direct effectué à la D1 distante, aucun secret demandé ou lu, aucun déploiement, envoi réel ou changement du domaine. La conformité de l'état réel après migration reste à contrôler chez le fondateur après le prochain GO.

## 2. Anomalies à corriger par Claude

### PUSH-R1 — Haute : cache VAPID non partagé et premiers appels concurrents

Source : `backend/src/push.mjs:46–56`.

`tokens` est une `Map` dans le module. Elle disparaît avec l'isolate du Worker et n'est pas partagée entre plusieurs isolates. Le cache n'est rempli qu'après deux opérations asynchrones de cryptographie : plusieurs premiers appels du même isolate peuvent aussi signer chacun un JWT différent.

Preuves, sans afficher de jeton :

- `PUSH-R1a` : mêmes clés, origine et sujet, deux instances du module à 60 secondes d'écart → **2 JWT distincts**, attendu 1.
- `PUSH-R1b` : huit premiers appels simultanés → **8 JWT distincts**, attendu 1.

Le test N05 de Claude ne vérifie qu'un module conservé en mémoire, avec des appels successifs. Il ne couvre pas ces cas. Apple demande de ne pas renouveler le JWT plus d'une fois par heure ; Cloudflare ne garantit pas la durée de vie des isolates [S1, S2]. Le contenu des claims et la signature ES256 sont corrects dans le test cryptographique indépendant. **Ce défaut ne prouve pas à lui seul la cause des 176 échecs réels**, car l'ancien diagnostic ne contient pas le code Apple.

Correction attendue : conserver le JWT et sa période de validité dans un état partagé durable, indexé par origine du service et configuration VAPID, avec acquisition atomique. Tous les concurrents doivent relire et utiliser le même gagnant ; une promesse partagée locale peut compléter le dispositif, sans remplacer le stockage partagé. D1 existante convient ; ne pas ajouter de service payant. KV seule, sans coordination des écritures, ne garantit pas cette unicité. Ne pas seulement arrondir `exp` : des signatures ECDSA distinctes produisent encore des JWT différents. Conserver le contrôle des clés, l'expiration à moins de 24 h et l'absence de secrets dans les logs.

Critères : tests R1a/R1b verts, deux isolates workerd indépendants partageant le stockage, renouvellement contrôlé, changement de configuration, erreur D1 bloquant l'émission d'un nouveau JWT non coordonné.

### PUSH-R2 — Haute : un envoi clôturé sous Face ID peut repartir

Sources : `backend/src/studio.mjs:538–554`, `backend/src/notify.mjs:222–288`.

La clôture marque une ancienne alerte `sending` en `dead`, avec `closed_at`. Si son appel réseau déjà engagé échoue ensuite, `deliverOutbox()` écrit `pending` avec un simple `WHERE id = ?`. La sélection et la prise de bail suivantes ne filtrent pas `closed_at`.

Preuve `PUSH-R2` : prise de bail d'une ancienne alerte → confirmation WebAuthn → clôture par la véritable route STUDIO → erreur réseau retardée → **`status=pending`, `closed_at` toujours présent, puis un nouvel envoi**. Le refus sans confirmation récente est bien vérifié avant ce scénario. La faille concerne la concurrence, pas un contournement de l'authentification.

Correction attendue : fermeture définitive protégée dans les lectures, prises de bail et mises à jour de résultat ; conditions `closed_at IS NULL`, état et identité de tentative/bail attendus. Une réponse tardive ne doit ni rouvrir la ligne ni rétablir abusivement la santé du canal. Conserver l'historique, le résultat tardif si utile et la journalisation ; rendre la clôture et son événement d'audit atomiques. Un appel externe déjà parti ne peut pas être rappelé, mais aucun appel supplémentaire ne doit partir après la clôture.

Critères : R2 vert pour erreur, succès tardif et abandon d'un Worker ; e-mails clients intacts ; le premier envoi après clôture reste interdit.

### PUSH-R3 — Haute : « Activer » recycle un abonnement expiré

Sources : `studio/app.js:903–923`, `backend/src/studio.mjs:441–455`.

L'interface sait qu'un abonnement est expiré côté serveur, mais l'action `push-enable` ne remplace l'abonnement navigateur que si sa clé publique diffère. Pour un endpoint expiré utilisant encore la bonne clé, `getSubscription()` peut retourner l'ancien abonnement. L'action le renvoie au serveur, qui efface `expired_at` et annonce le succès.

Preuve `PUSH-R3`, exécutant **le corps réel de l'action STUDIO** avec les interfaces navigateur simulées et le vrai routeur serveur : abonnement marqué `apple_410` + même clé → **0 `unsubscribe`, 0 `subscribe`, ancien endpoint réactivé en base**, puis nouvel essai simulé **410**.

Correction attendue : distinguer abonnement inconnu, expiré et clé différente. Sur réactivation explicite d'un abonnement connu expiré ou déclaré incompatible, désabonner l'ancien et souscrire de nouveau dans le parcours autorisé par le geste utilisateur. Garder l'ancienne ligne pour l'historique, ne pas effacer son état d'expiration en réenregistrant le même endpoint, gérer refus et échec réseau sans annoncer « activé ». Vérifier ensuite la réponse du fournisseur et la réception sur l'iPhone.

### PUSH-R4 — Moyenne : état Discord global incompatible avec dix salons

Sources : `backend/src/notify.mjs:161–176,261–262`, migration 0009 (`channel_health` indexée seulement par `channel`).

Un webhook du salon commandes reste en 404. Chaque succès sur le salon stock marque pourtant tout Discord `ok`, résout les alertes de panne et réinitialise le délai au prochain échec des commandes.

Preuve `PUSH-R4` : quatre événements commandes refusés, intercalés avec quatre événements stock acceptés → **4 alertes en 4 minutes**, diagnostic Discord final **`ok`**, sans réparation du webhook commandes. Ce n'est plus la cascade autonome de 31 minutes ; cela invalide néanmoins la promesse « au plus un rappel par jour tant que la panne dure » et masque un canal important.

Correction attendue : état par destination logique/effective avec identifiant non secret, récupération uniquement de cette destination, agrégation honnête pour STUDIO. Tenir compte du webhook partagé de secours et éviter un incident par salon si tous utilisent le même webhook ; ne jamais stocker son URL dans les notifications. Préserver l'exclusion du canal en panne et les alertes sans récursion.

### PUSH-R5 — Moyenne : diagnostic Santé vert après un essai Apple refusé

Sources : `backend/src/studio.mjs:254–262,465–481`.

Un essai manuel met à jour l'abonnement et le journal, mais met à jour `channel_health` seulement en cas de succès. En l'absence d'incident automatique antérieur, Santé affiche donc `ok` malgré un refus constaté.

Preuve `PUSH-R5` : réponse manuelle **403 BadJwtToken**, puis Santé → **`ok`, « 1 appareil(s) abonné(s), aucun envoi encore accepté »**.

Correction attendue : intégrer le dernier résultat de l'appareil ciblé au diagnostic, sans déclencher de cascade d'alertes lors de l'essai manuel. Distinguer « configuré », « abonné, non vérifié », « refusé », « accepté par le service » et « réception constatée sur l'iPhone ». Un HTTP 201 ne prouve pas la réception ou l'affichage physique.

## 3. Points confirmés

### Fin de la cascade autonome

`isMetaAlert()` reconnaît `channel_failure`, `push_device_expired` et les anciennes alertes `technical:outbox:N`. Leur échec ne rappelle pas `alertChannel()`. La notification de panne exclut le canal défaillant. Sans appareil actif, pas de nouvelle ligne push ; un abonnement expiré est conservé et écarté des envois.

Test indépendant A3 : deux événements et une ancienne alerte, Apple 503 et Discord inaccessible simultanément. Huit lignes finales, deux alertes de canal, quarante appels initiaux au total, puis **aucun nouvel appel ni aucune nouvelle ligne pendant sept jours simulés sans événement entrant**. Les dix tests N01–N10 passent également. La borne ne signifie pas qu'un 429 persistant cesse tout réessai : le code respecte une attente sans compter cet essai comme échec. La conclusion porte sur la création récursive d'alertes.

### Migration et sauvegardes

- A1 : base locale construite avec 0001–0008, puis peuplée avec **38 envois** (36 morts et 2 en attente), **36 notifications techniques**, un abonnement avec **176 échecs**, une passkey, une session, dix empreintes de codes de secours et un état de sauvegarde. Comparaison de toutes les valeurs et colonnes préexistantes après 0009 : identiques.
- 0009 ajoute une table et six colonnes ; pas de suppression ni remise à zéro. L'abonnement existant demeure actif, les champs diagnostiques nouveaux valent `NULL`.
- A2 : anomalie de schéma forcée au milieu de 0009 → transaction annulée, pas de demi-migration.
- D2 : vrai Wrangler local, migrations 0001–0008, peuplement, 0009, relecture de `d1_migrations`, puis seconde application → neuf migrations enregistrées, aucune réapplication, compteur 176 et abonnement conservés.
- A1 : copie incluant `channel_health`, chiffrement, déchiffrement et restauration dans une D1 vide → toutes les tables relues identiques. Le mécanisme de sauvegarde découvre les nouvelles tables automatiquement.
- Ces essais utilisent une **base représentative créée pour la revue**, pas un export de la base TEST distante du fondateur.

### Web Push, essai manuel et protection STUDIO

- A5 : déchiffrement indépendant par `node:crypto`/OpenSSL du message produit par Web Crypto : ECDH P-256, HKDF SHA-256, `aes128gcm`, délimiteur final `0x02`, taille d'enregistrement et clé éphémère corrects. JWT ES256 vérifié avec la clé publique, audience Apple, sujet HTTPS et expiration de 12 heures conformes au cas testé [S1, S3, S4]. Réserve R1 sur sa réutilisation.
- A6 : route d'essai inaccessible sans session ou avec origine/en-tête incorrect ; six essais en dix minutes, septième refusé ; codes explicatifs et audit sans endpoint, clé privée ou clés d'abonnement exposés.
- A7 : service worker affiche une notification même pour un push vide ou JSON invalide ; pas de traitement silencieux. Ce test de logique ne vaut pas validation Safari/iOS.
- N07 et R2 : confirmation WebAuthn récente exigée pour clôturer. La clôture normale ne supprime ni lignes ni notifications et ne touche pas les e-mails. Réserve R2 pour l'appel en cours.
- 25 tests avec SimpleWebAuthn rejoués ; aucun changement du moteur d'authentification réalisé par Work.

### Conservation lors du redéploiement

Test indépendant D1 : assistant exécuté contre une installation simulée préexistante avec 17 secrets (base STUDIO, Stripe TEST, Resend et dix webhooks Discord), D1/KV existants et iPhone inscrit. Aucun appel de création/suppression ou d'envoi de secrets, mêmes identifiants de liaison, mêmes valeurs publiques, mêmes réglages, point de restauration avant migration, une seule remise en ligne simulée. T04/T05 existants passent également.

Wrangler conserve les secrets lors d'un déploiement ; les variables non secrètes du tableau de bord peuvent en revanche être remplacées par le fichier local [S5]. Il faut conserver le dossier d'installation et son `ops/test-env.local.json`, les mêmes noms/identifiants, l'origine STUDIO/RP ID et les clés VAPID/de sauvegarde. Le script ne modifie pas le contenu KV dans ce chemin. **Ne pas régénérer les clés pour tenter de résoudre le push sans diagnostic.** Cela créerait un changement supplémentaire d'abonnement et ne corrigerait pas R1.

Les liaisons et secrets **réellement présents** sur Cloudflare n'ont pas été lus dans cette revue. Aucun passage de migration ou redéploiement distant n'a été effectué.

## 4. Avertissement D1 Windows

Le fichier fourni confirme 230 tests principaux, 13 contrôles commerciaux et 25 tests supplémentaires, avec le message `fetch failed ×123` dans la suite backend.

Ce compteur vient de `tests/backend/helpers.mjs:49–61,102` : les promesses D1 surveillées incrémentent un compteur lors d'erreurs de transport. Il ne représente ni 123 ventes perdues, ni des appels Apple refusés. Le journal ne conserve pas la sous-cause, l'opération et le moment précis : il ne permet pas d'affirmer si le problème exact est un port, un délai, une charge locale ou une autre défaillance du moteur.

La réussite n'annule pas cet avertissement : dans `tests/backend/scenarios.test.mjs:39–49`, le scénario t02 attend cinq livraisons de chaque webhook mais **ne vérifie pas leurs 130 statuts HTTP**. Quelques livraisons peuvent réussir, les suivantes échouer, et l'état final rester correct. C'est une explication possible, pas l'attribution prouvée des 123 erreurs à ce seul scénario.

Ajout Work `d1-delivery-observability.test.mjs` : 300 clients, 26 commandes, contrôle de tous les refus, **130/130 webhooks HTTP 200**, stock/registre cohérents, compteur d'erreur D1 vide. Réussi sous Linux. Suite nominale complète locale : aucun avertissement D1. Journaux de la CI Windows de `be0bb9b` relus : aucun `fetch failed` ni avertissement « Moteur D1 local » trouvé ; job réussi [S6]. Cela oriente vers le contexte du PC, sans identifier sa cause exacte.

Attendu de Claude : journal technique de recette avec phase et chaîne des causes réseau expurgées, test strict des réponses et du compteur transport. Ne pas ajouter un retry qui transforme artificiellement une erreur en réussite. Premier contrôle Windows utile : nouvelle copie de travail, puis le test renforcé ci-dessous sans autres suites concurrentes. Si l'erreur persiste, conserver les codes de socket, version Node/Miniflare et phase, sans exporter de données clients.

## 5. Résultats complets

| Vérification locale | Résultat |
| --- | --- |
| Frontend | 74/74 |
| Contrôles commerciaux | 13/13 |
| Inventaire historique | 16/16 |
| Backend/STUDIO, dont N01–N10 | 114/114 |
| Intégration frontend/backend | 13/13 |
| Revues initiale / v1.3 / v1.4 / risque Resend | 4/4 · 2/2 · 6/6 · 1/1 |
| Total principal | **230/230** |
| SimpleWebAuthn, passe supplémentaire | **25/25** |
| Nouveaux contrôles Work A1–A7, D1–D2 et D1-W1 | **10/10** |
| Nouveaux critères Work R1a, R1b, R2, R3, R4, R5 | **0/6 — six échecs reproduisant cinq anomalies** |
| Audit npm complet / hors développement | **0 / 0 vulnérabilité** |
| Boutique ordinaire et boutique TEST fermée | Compilées |
| STUDIO, Worker `--dry-run`, Pages Functions | Compilés |
| Contrôle local des tailles de bundle | Réussi : Worker 1 056 Kio, Pages 126 Kio |

Le premier essai de build TEST sans `SAYLESS_TEST_ORIGIN` a été refusé comme prévu par la protection existante ; il a réussi avec l'origine de recette requise. Le premier parseur JSON du nouveau test Wrangler mélangeait stderr et stdout ; corrigé dans le banc Work, puis D1/D2 rejoués et réussis. Aucun code produit modifié pour faire passer les tests.

La CI existante de Claude est verte sur Linux et Windows [S6], mais ne contient pas les six nouveaux critères rouges de cette revue. Les logs locaux expurgés se trouvent dans `docs/qa/push-review/` ; les échecs ne sont ni ignorés ni rebaptisés « réussite ».

## 6. Commandes PowerShell — vérification locale uniquement

Utiliser une copie isolée pour ne pas toucher aux réglages du dossier Cloudflare installé. Toutes les données de ces tests sont temporaires. Ne pas copier le dossier de secrets dans cette copie.

```powershell
& {
  $ErrorActionPreference = 'Stop'
  $dossierAuditPush = Join-Path $env:USERPROFILE 'sayless-contre-audit-push'
  if (Test-Path $dossierAuditPush) { throw 'Ce dossier existe déjà : utilise une autre copie vide.' }
  git clone --single-branch --branch work/audit-push-be0bb9b https://github.com/Ryaax93/sayless.git $dossierAuditPush
  if ($LASTEXITCODE -ne 0) { throw 'Copie impossible' }
  Set-Location $dossierAuditPush
  git rev-parse HEAD
  npm.cmd ci --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Installation incomplète' }
  node --test tests/review/push-integrity.test.mjs tests/review/push-deployment.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Intégrité ou procédure locale en échec' }
  node --test tests/review/d1-delivery-observability.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Erreur D1 ou réponse webhook anormale : conserver le journal' }
  node --test tests/review/push-open-issues.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Anomalies push encore présentes : ne pas redéployer cette version' }
}
```

Sur `be0bb9b` + les preuves Work, le dernier fichier échoue volontairement sur les six critères non satisfaits. La copie ne modifie ni le Worker réel, ni sa D1, ni le dossier d'installation.

## 7. Transmission et conditions du prochain GO

Claude conserve le backend, STUDIO et les migrations. Merci de répondre sur PR nº 1 avec un SHA corrigé, les résultats de ces six critères et les adaptations de tests, sans supprimer leurs assertions de sécurité.

1. Corriger R1–R5 dans les périmètres Claude. Utiliser une nouvelle migration pour tout nouvel état partagé ; ne pas réécrire une migration déjà appliquée chez le fondateur.
2. Rejouer les suites existantes, les dix contrôles indépendants verts et les six rouges, puis les compilations et audits.
3. Vérifier sous workerd deux instances partageant le cache VAPID, la clôture pendant une réponse en retard, la nouvelle souscription et deux webhooks Discord de santé différente.
4. Compléter le diagnostic D1 Windows ; si l'avertissement se reproduit, ne pas annoncer une validation sans réserve du transport local.
5. Avant la mise à jour réelle autorisée : comparer les liaisons D1/KV et l'origine STUDIO à l'installation existante, vérifier les migrations appliquées, noter le point Time Travel et garder les copies chiffrées. Aucun secret ne doit être copié dans GitHub.
6. Après un prochain GO et la mise à jour exécutée par le fondateur : connexion Face ID conservée, essai manuel avec réponse Apple exacte, réception visible sur iPhone, expiration/réactivation si nécessaire, clôture contrôlée et contrôle qu'aucune chaîne automatique ne réapparaît au-delà de plusieurs anciens cycles de 31 minutes.

Le NO GO porte sur **ce correctif complet**. Il ne remet pas en cause la validité additive de 0009 ni la correction de la cascade identifiée. Si l'urgence impose seulement de stopper le bruit de l'ancien Worker, demander à Claude une intervention TEST minimale explicitement autorisée ; Work n'a ni désactivé de service, ni touché au déploiement.

## Sources primaires consultées

- [S1 — Apple, Sending web push notifications](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers) : réutilisation du JWT, clés, en-têtes et affichage obligatoire.
- [S2 — Cloudflare, How Workers works](https://developers.cloudflare.com/workers/reference/how-workers-works/) : mémoire des isolates non durable.
- [S3 — RFC 8291](https://www.rfc-editor.org/rfc/rfc8291) : chiffrement Web Push.
- [S4 — RFC 8292](https://www.rfc-editor.org/rfc/rfc8292) : VAPID, ES256, audience et expiration.
- [S5 — Cloudflare, commandes Wrangler](https://developers.cloudflare.com/workers/wrangler/commands/workers/) et [migrations D1](https://developers.cloudflare.com/d1/reference/migrations/) : conservation des secrets et registre des migrations.
- [S6 — CI du commit audité, exécution nº 46076465084](https://github.com/Ryaax93/sayless/actions/runs/46076465084), jobs Linux et Windows réussis ; log Windows relu.
