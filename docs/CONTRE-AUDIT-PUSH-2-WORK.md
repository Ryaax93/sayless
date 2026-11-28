# Second contre-audit indépendant des notifications push

28 novembre 2026 — Work — livraison de preuves et transmission à Claude.

**Verdict : NO GO pour redéployer en l’état le commit `56d960bda249ca1ca354c22349cdd364fc42501a` sur Cloudflare TEST.** Ce verdict concerne ce correctif précis. Il ne constitue aucune autorisation de production. Les cinq anomalies précédentes sont corrigées dans leurs scénarios initiaux ; quatre nouveaux cas limites échouent et le choix cryptographique doit être revu.

## 1. Périmètre et méthode

- PR examinée : [nº 1](https://github.com/Ryaax93/sayless/pull/1), réponse [Claude](https://github.com/Ryaax93/sayless/pull/1#issuecomment-7231551601), rapport joint et documentation `NOTIFICATIONS-PUSH.md` lus.
- Branches Claude examinées : `claude/integration-v2` et `claude/verification-v2`, toutes deux sur `56d960b…` lors du contrôle.
- Branche des preuves : `work/audit-push-56d960b`, créée depuis ce commit. Aucun changement du code exécuté par la boutique, le Worker ou STUDIO, des migrations, de l’authentification ou des dépendances du projet.
- Comparaison avec le premier audit `9a2e8e1f986b489ad938122a07dfb9d48d9f9585` : les anciens tests Work et leurs assertions n’ont pas été modifiés par Claude.
- Exécution indépendante : Linux, Node `24.22.3`, npm `11.19.1`, dépendances installées depuis le verrou. Vrais routeurs et D1/SQLite de Miniflare ; vrai Wrangler **local** pour les migrations. Fournisseurs Apple, Discord, Stripe et Resend simulés dans ces tests.
- Preuves : [journaux expurgés](qa/push-review-2/README.md), [critères rouges](../tests/review/push-second-open-issues.test.mjs), [intégrité et réception](../tests/review/push-second-integrity.test.mjs), [migrations Wrangler](../tests/review/push-second-migrations.test.mjs), [expérience crypto](../tests/review/push-crypto-experiment.mjs).

## 2. Les cinq corrections précédentes

| Critère précédent | Constat indépendant |
| --- | --- |
| R1a/R1b, VAPID entre contextes et appels concurrents | Les deux tests passent sans changement. Même JWT dans la même heure civile. Nouvelle limite à la frontière horaire : P2-R1 ci-dessous. |
| R2, clôture pendant un envoi | Le résultat tardif ne rouvre plus la ligne clôturée, aucun nouvel envoi ; audit conservé et réauthentification exigée. Le problème P2-R4 concerne le diagnostic de l’appareil, pas cette clôture. |
| R3, réactivation d’un abonnement expiré | STUDIO désabonne puis remplace ; le serveur conserve l’ancien abonnement expiré. Nouveau cas de concurrence : P2-R3. |
| R4, panne d’un salon masquée par un autre | Santé par empreinte de destination effective ; le succès d’un salon sain ne résout plus une panne distincte. Le webhook partagé est dédupliqué. Nouveau cas après remplacement du secret : P2-R2. |
| R5, refus d’un essai manuel absent de Santé | Le refus apparaît désormais ; « accepté » est distingué de « reçu ». Nouveau cas de réponses arrivant dans le désordre : P2-R4. |

La boucle initiale de notifications ne se reproduit pas : sept jours simulés, Apple et Discord simultanément en panne, anciennes alertes incluses, **40 appels initiaux puis zéro nouvel appel sans événement supplémentaire ; deux alertes de canal**. Le code exclut les messages techniques des nouvelles escalades et déduplique les incidents. Cela étaye l’absence de cascade autonome dans les chemins examinés ; les quatre anomalies suivantes restent distinctes.

## 3. Nouveaux critères rouges et corrections attendues

### P2-R1 — VAPID : deux jetons à deux secondes d’intervalle

**Priorité haute, garantie de renouvellement insuffisante.** `backend/src/push.mjs:43–76` calcule `Math.floor(now / 3600) * 3600`. Deux premiers envois dans deux contextes froids à `H−1 s` puis `H+1 s` donnent **deux JWT**, bien que deux secondes seulement les séparent. L’unicité par heure civile ne garantit donc pas une durée minimale de réutilisation depuis la première émission. Le test précédent restait à l’intérieur d’une heure.

Apple demande de ne pas renouveler le JWT plus d’une fois par heure. **Aucun rejet Apple réel n’a été provoqué ici** : le test démontre l’insuffisance de la garantie, pas le comportement exact de sa limitation interne. Une dérive d’horloge ou des contextes placés de part et d’autre de la frontière aggravent l’alternance possible.

Attendu : partage durable d’un JWT avec rotation atomique, durée de réutilisation et validité explicites, indépendante de l’heure civile et des démarrages à froid. Proposition privilégiée : signature Web Crypto native, stockage serveur du JWT et coordination D1, avec renouvellement espacé et marge d’expiration. Tester frontière, deux contextes froids, concurrence, horloges décalées, panne de stockage et rotation de configuration ; aucun retour à une génération non coordonnée en cas d’erreur. Une bibliothèque déterministe seule ne corrige pas cette frontière.

### P2-R2 — Discord : une ancienne destination bloque indéfiniment Santé

**Priorité moyenne, diagnostic faux après réparation.** `backend/src/notify.mjs:204–214` agrège toutes les destinations historiques ; `backend/src/studio.mjs:245–250` expose leurs échecs sans notion de retrait.

Reproduction : webhook Commandes A → 404 ; webhook Alertes → 204 ; remplacement du secret Commandes par B → nouvelle commande effectivement acceptée 204 et file `sent`. Résultat : ancien A toujours `failing`, agrégat Discord toujours `failing`. Aucun envoi réussi sur B ne peut résoudre A, qui ne sera plus utilisé.

Attendu : relation entre salons et destinations actuellement configurées, retrait/supersession explicite et audité de l’ancienne destination, historique conservé, agrégat limité aux destinations actives. Ne pas retirer A si un autre salon ou le secours l’utilise encore. Tester changement de secret, webhook partagé et vraie panne encore active. Ne pas simplement effacer toutes les anciennes erreurs.

### P2-R3 — Abonnement : expiration concurrente et faux succès

**Priorité moyenne, cohérence transactionnelle.** `backend/src/studio.mjs:475–497` vérifie d’abord `expired_at`, puis effectue l’upsert et annonce toujours `subscribed: true`.

Reproduction : abonnement actif lu ; une autre opération enregistre un 410 juste avant le lot d’inscription. Résultat réel : **`expired_at` présent, mais réponse `subscribed: true` et audit de succès**. L’ancien abonnement n’est pas réactivé en base ; c’est le résultat annoncé au client qui est faux.

Attendu : admission conditionnelle atomique à l’écriture, résultat effectif (`RETURNING` ou équivalent transactionnel) et journal cohérent. Si l’expiration gagne la course, renvoyer `subscribed: false` pour déclencher le remplacement dans STUDIO. Tester aussi deux inscriptions concurrentes. Une nouvelle lecture avant le lot ne ferme pas cette course.

### P2-R4 — Une réponse Apple ancienne écrase le refus le plus récent

**Priorité moyenne, diagnostic et santé incohérents.** `backend/src/push.mjs:225–249` écrit le résultat par `endpoint` uniquement ; `backend/src/studio.mjs:509–531` inscrit l’identifiant d’essai puis peut rétablir le canal sans vérifier qu’il s’agit encore de la tentative actuelle.

Reproduction : essai A retenu en réseau ; essai B une seconde après, refusé 403 `BadJwtToken` ; réponse A 201 libérée ensuite. Résultat : **`last_status=201`, `last_error=null`, `last_attempt_at < test_sent_at` et Santé=`wait`** au lieu du refus récent. Ce n’est pas une nouvelle livraison prouvée, ni un état vert constaté : le défaut masque l’alerte par un état d’attente.

Attendu : identité de tentative persistée par appareil et condition atomique sur l’écriture du résultat **et** la résolution du canal. Conserver les réponses tardives dans l’historique sans écraser le résultat courant. Couvrir essais dans la même seconde, deux clients STUDIO et concurrence essai manuel/cron. Un bouton désactivé dans un seul navigateur ne suffit pas.

## 4. Signature RFC 6979 : correcte fonctionnellement, durcissement insuffisant

`backend/src/es256.mjs:20–28,73` utilise l’algorithme d’Euclide étendu avec division et boucle `while (r1)` sur le nonce secret `k`. L’inversion et les produits en `BigInt` ne sont pas masqués. Le calcul natif de `k·G` et la vérification finale de la signature ne protègent pas ces opérations intermédiaires.

Expérience indépendante, sans toucher au code du produit :

- 52 signatures comparées octet par octet à `@noble/curves@2.3.0`, vérification OpenSSL, clés limites valides et messages vides/UTF-8/variables : **52 concordances** ; 4 scalaires invalides refusés.
- Référence exécutée dans un vrai `workerd` local, sans `nodejs_compat` : **8 cas concordants**.
- Instrumentation d’une copie du module en mémoire : inversion entre **123 et 175 itérations**, 29 nombres d’itérations distincts. Preuve de contrôle dépendant du secret, **pas démonstration d’une extraction de clé ou d’un canal exploitable à distance**.
- Le nonce déterministe répète les mêmes calculs pour les mêmes données. RFC 6979 §4 demande précisément des défenses contre les canaux auxiliaires. La limitation des essais administrateur et le cache réduisent l’exposition, mais ne prouvent pas la résistance temporelle à travers des isolates éphémères. Ce n’est pas une API publique de signature arbitraire.
- La clé concernée est la clé VAPID serveur. Aucune compromission des paiements, passkeys ou secrets existants n’a été constatée.

**Recommandation à Claude : remplacer l’arithmétique secrète maison avant ce redéploiement.** Préférer la primitive native Web Crypto avec le partage durable de jeton de P2-R1. Si le déterminisme reste nécessaire, évaluer et figer une bibliothèque maintenue et auditée. La version 2.3.0 de noble examinée masque notamment l’entrée de l’inversion et les produits secrets ; elle ne promet pas un temps parfaitement constant en JavaScript, compte tenu du JIT et du ramasse-miettes. Aucun remplacement de production n’a été effectué par Work.

La référence a été installée uniquement sous `work/push-audit-2/crypto-reference/`, ignoré par Git. Les manifestes et verrous de SAYLESS sont inchangés. L’expérience est reproductible et distincte d’un audit cryptographique formel.

## 5. Cloudflare Free et performances

La documentation Cloudflare consultée indique **10 ms de CPU par invocation HTTP et par cron** en offre Free. L’attente réseau n’entre pas dans le CPU ; le temps écoulé d’un test Node n’est donc pas une mesure de conformité. D1 Free autorise 50 requêtes par invocation ; un lot `batch()` compte comme une requête selon sa documentation.

Mesures locales, 40 échantillons par opération, CPU du processus Node, hors démarrage à froid et hors requête complète :

| Opération | Médiane CPU | p95 CPU |
| --- | ---: | ---: |
| Signature actuelle | 0,598 ms | 1,092 ms |
| Signature noble de référence | 0,626 ms | 1,032 ms |
| Signature Web Crypto native | 0,077 ms | 0,218 ms |
| VAPID, cache absent | 0,875 ms | 1,685 ms |
| VAPID, cache présent | 0,003 ms | 0,007 ms |

Ces valeurs ne certifient **ni** la durée du Worker hébergé **ni** le coût total des envois, diagnostics, chiffrement et écritures. La nouvelle méthode n’est pas démontrée au-dessus de 10 ms ; elle n’est pas non plus validée sous cette limite en conditions réelles. La compatibilité locale de noble ne vaut pas validation CPU Cloudflare.

Budgets D1/appels externes et régressions existantes réussis. Bundles : Worker/STUDIO **1 068 Kio**, Pages **134 Kio** ; contrôle gratuit réussi. Toute coordination D1 supplémentaire devra entrer dans le budget, y compris les reprises et la tâche planifiée.

Après correction et autorisation d’un futur déploiement TEST, relever le CPU réel pour démarrage à froid, cache chaud, essai manuel, cron avec file chargée et échecs simultanés. Ne pas augmenter l’offre ni engager de dépense automatiquement.

## 6. Migrations, sauvegardes, secrets et accès

**0009 est inchangée ; 0010 ajoute une table et trois colonnes.** Les nouveaux tests vérifient :

- Base 0008 synthétique peuplée avec 38 envois, 176 échecs appareil, passkey, session, dix empreintes de secours et paramètres ; application 0009 puis 0010 : valeurs préexistantes et historique de clôture préservés.
- Santé push/e-mail copiée vers `delivery_health`. La destination historique Discord, inconnue, n’est pas inventée ; elle ne sera identifiée qu’à un nouvel envoi. Cette limite de reprise est explicitée dans la migration.
- Échec intentionnel de 0010 au milieu du lot : transaction annulée, aucun ajout partiel observé.
- Vrai Wrangler local : registre de dix migrations, deuxième application sans effet, appareil et santé conservés.
- Sauvegarde chiffrée puis restauration dans une autre base vide : mêmes tables et données, y compris `delivery_health` et champs de réception.

L’ancien test de mise à jour a été rejoué : assistant sur une installation simulée avec 17 secrets, dix salons, mêmes D1/KV/origines/clés, point Time Travel avant migration ; aucun ordre de rotation de secrets ou de création/suppression de ressources. Le seul déploiement observé dans ce test est **simulé par un faux Wrangler**. Les chemins d’authentification/passkeys/récupération ne sont pas changés par ce correctif ; les suites de réauthentification et de récupération passent.

**Limite : aucun inventaire des secrets réels, export de D1 TEST, contrôle des sauvegardes KV hébergées ni nouvel essai physique Face ID n’a été réalisé par Work.** Préserver les mêmes liaisons, clés, origine et RP ID reste indispensable. La procédure est cohérente et testée localement ; la conservation sur le compte distant ne peut pas être certifiée sans son contrôle effectif. Ne pas régénérer les secrets pour ce correctif.

## 7. Réception effective sur iPhone

Le nouveau mécanisme est pertinent : identifiant aléatoire d’essai chiffré dans le push ; appel de `showNotification`, puis accusé vers `/api/admin/push/receipt` ; session STUDIO, origine et en-tête exigés. Ancien identifiant, rejeu, abonnement expiré ou session absente sont refusés dans les nouveaux tests.

Le trajet testé utilise le vrai chiffrement, un déchiffrement indépendant OpenSSL, le véritable code du service worker dans une VM et le vrai routeur de réception. Avant accusé, Santé attend ; après accusé, Santé passe à OK. Échec d’affichage ou coupure réseau : pas de faux accusé. Si l’accusé échoue, il n’est actuellement pas rejoué ; l’état peut donc rester en attente malgré une notification vue. Relancer un essai après reconnexion est une limite acceptable documentée.

**Réception physique sur l’iPhone du fondateur : non vérifiée par ce contre-audit.** Une réponse Apple 201 ne suffit pas ; un accusé applicatif prouve le passage dans le service worker authentifié, pas que le fondateur a vu l’écran. Après futur GO et déploiement autorisé, vérifier successivement : même installation Face ID, Apple accepte, accusé enregistré, notification effectivement visible, ouverture de STUDIO. Aucun accès à son iPhone n’est prétendu ici.

## 8. Transport D1 Windows

Le nouveau banc de test enregistre la cause profonde et un journal local expurgé dans `.journaux-tests/` ; il n’ajoute aucun réessai destiné à cacher les erreurs. Le test strict contrôle désormais toutes les réponses webhook et le compteur d’erreurs du moteur, au lieu de s’appuyer uniquement sur l’état final du stock.

- Exécution indépendante Linux : **300 clients, 26 réservations, 274 réponses `held`, 130/130 réponses webhook HTTP 200, zéro erreur D1**. Le stock de 26 ici est une fixture de concurrence, pas l’inventaire réel de SAYLESS.
- [CI fournie](https://github.com/Ryaax93/sayless/actions/runs/46091489490) : jobs Windows et Ubuntu réussis ; journal Windows lu, suite stricte réussie, aucun `fetch failed` observé dans ce journal. Le workflow PR associé à ce SHA, `46091495123`, est également annoncé réussi par GitHub.
- **Les 123 erreurs de l’ancienne exécution du PC du fondateur n’ont pas été reproduites ni expliquées avec certitude.** Une suite verte avec un avertissement de transport ne suffit pas. Demander seulement si elles réapparaissent : version Node/npm, SHA, résultat du test strict et journal `.journaux-tests/` expurgé. Ne pas transmettre une base ou des secrets.

## 9. Résultats complets

| Vérification indépendante | Résultat |
| --- | --- |
| Frontend | 74/74 |
| Inventaire historique | 16/16 |
| Backend/STUDIO | 120/120 |
| Intégration | 13/13 |
| Reviews métier, v1.3, v1.4 et risque e-mail | 4 + 2 + 6 + 1 réussis |
| Premier contre-audit push, inchangé | 15/15, dont les six anciens critères rouges |
| D1 strict | 1/1 |
| WebAuthn avec bibliothèque activée dans le banc | 25/25 |
| **Total tests existants** | **277/277** |
| Contrôles commerciaux séparés | 13/13 |
| Nouveaux tests intégrité/réception/migrations | 6/6 |
| Nouveaux critères P2-R1 à P2-R4 | **0/4 : quatre échecs reproduits** |
| Comparaison crypto, hors total Node tests | 52 signatures, 4 refus de scalaires, 8 cas workerd réussis |
| Audit npm complet / hors dev | 0 / 0 vulnérabilité |
| Boutique, boutique TEST fermée, STUDIO, Worker dry-run, Pages | Tous compilés |
| Contrôle des limites gratuites statiques | Réussi ; CPU hébergé non mesuré |

Aucune régression détectée par les suites existantes sur réservations, paiements simulés, reprises, commandes, e-mails, sauvegardes et authentification. Aucun nouveau test réel de Stripe, Resend, Boxtal, Apple ou Discord n’est revendiqué. **Les quatre nouveaux tests sont volontairement non satisfaits sur cette livraison**, sans `skip` ni masquage. Ils ne sont pas encore ajoutés aux scripts/CI appartenant à Claude.

## 10. Transmission et décision attendue de Claude

1. Corriger P2-R1 et retirer/durcir la cryptographie secrète maison avec une solution maintenue ; coordonner un éventuel changement de dépendances dans un commit dédié.
2. Traiter le retrait des destinations Discord, l’inscription atomique et l’ordre des résultats par appareil (P2-R2 à P2-R4).
3. Réutiliser les nouveaux tests tels quels, compléter même-seconde/cron/horloges et les rendre obligatoires en CI Linux/Windows. Ne pas affaiblir les critères pour retrouver du vert.
4. Rejouer les anciennes suites et les migrations sur une copie locale peuplée ; conserver les sauvegardes et accès. Garder la procédure de déploiement distincte de cette revue.
5. Publier le SHA corrigé et les résultats. Un futur **GO TEST** permettra ensuite une recette hébergée limitée : CPU, Apple, réception sur iPhone et contrôle de préservation des liaisons. Ces mesures ne sont pas présentées comme des prérequis déjà réalisables sans déploiement.

Le NO GO actuel repose sur les défauts reproductibles et le choix cryptographique non durci, **pas uniquement sur l’absence de mesure iPhone/CPU hébergée**. La boutique et la maquette STUDIO n’ont pas à être refondues. Aucun nouveau service payant n’est nécessaire pour ces corrections.

## 11. Reproduction locale depuis PowerShell

Utiliser une nouvelle copie sans secrets ni configuration de production. Ces commandes ne déploient rien. `-c core.autocrlf=false` s’applique à cette copie uniquement.

```powershell
git -c core.autocrlf=false clone --branch work/audit-push-56d960b --single-branch https://github.com/Ryaax93/sayless.git sayless-audit-push-2
if ($LASTEXITCODE -ne 0) { throw "Copie Git impossible" }
Set-Location sayless-audit-push-2
git rev-parse HEAD
npm ci --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "Installation impossible" }
npm test
if ($LASTEXITCODE -ne 0) { throw "Tests principaux en échec" }
foreach ($suite in @('test:review','test:review:v13','test:review:v14','test:review:risks','test:review:push','test:review:d1','test:webauthn:bibliotheque')) {
  npm run $suite
  if ($LASTEXITCODE -ne 0) { throw "Échec : $suite" }
}
node --test tests/review/push-second-integrity.test.mjs tests/review/push-second-migrations.test.mjs
if ($LASTEXITCODE -ne 0) { throw "Intégrité ou migration en échec" }
node --test tests/review/push-second-open-issues.test.mjs
# Sur 56d960b et la branche de preuves : code 1 et QUATRE échecs attendus.
# Sur le futur correctif de Claude : les quatre critères doivent devenir verts.
npm run build:storefront
if ($LASTEXITCODE -ne 0) { throw "Compilation boutique en échec" }
$env:SAYLESS_TEST_ORIGIN = 'https://sayless-boutique-test.pages.dev'
npm run build:storefront:test
if ($LASTEXITCODE -ne 0) { throw "Compilation TEST en échec" }
npm run check:cloudflare
if ($LASTEXITCODE -ne 0) { throw "Compilation Cloudflare en échec" }
node scripts/check-free-plan.mjs
if ($LASTEXITCODE -ne 0) { throw "Contrôle gratuit en échec" }
npm audit
if ($LASTEXITCODE -ne 0) { throw "Audit complet en échec" }
npm audit --omit=dev
if ($LASTEXITCODE -ne 0) { throw "Audit livré en échec" }
```

Comparaison crypto facultative, dépendance isolée du projet :

```powershell
npm install --prefix work/push-audit-2/crypto-reference --ignore-scripts --no-audit --no-fund --save-exact @noble/curves@2.3.0
if ($LASTEXITCODE -ne 0) { throw "Installation de référence impossible" }
node tests/review/push-crypto-experiment.mjs
if ($LASTEXITCODE -ne 0) { throw "Comparaison crypto en échec" }
```

## 12. Références primaires

- [Apple — Sending Web Push Notifications](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers) : cadence des JWT et distinction entre acceptation et livraison.
- [RFC 6979, §4](https://www.rfc-editor.org/rfc/rfc6979#section-4) : défenses contre les canaux auxiliaires.
- [Cloudflare Workers — Limits](https://developers.cloudflare.com/workers/platform/limits/) et [D1 — Limits](https://developers.cloudflare.com/d1/platform/limits/) : CPU, sous-requêtes et D1.
- [noble-curves — sécurité](https://github.com/paulmillr/noble-curves#security), [code de signature 2.3.0](https://github.com/paulmillr/noble-curves/blob/2.3.0/src/abstract/weierstrass.ts) : protections et limites JavaScript ; comparées à la version npm installée isolément.

Aucun déploiement, fusion, accès Stripe réel ou modification des branches `main`/`v2`, du DNS ou de la boutique publique effectué pour ce contre-audit.
