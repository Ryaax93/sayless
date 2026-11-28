# Troisième contre-audit push — Work, 28 novembre 2026

## Verdict : GO pour le redéploiement de Cloudflare TEST, avec réserve ciblée

Version examinée : **`d05cf655668a4ea6d2191f5859aa78c1d4f6cf5d`**, branches Claude `integration-v2` et `verification-v2`. [Réponse de Claude examinée](https://github.com/Ryaax93/sayless/pull/1#issuecomment-7239278599).

Le correctif peut passer en **recette sur l'environnement TEST isolé**. La signature maison a disparu, la coordination VAPID est transactionnelle, les quatre scénarios rouges du second audit passent sans modification de leurs assertions et la cascade autonome Apple/Discord n'est pas reproduite. Les migrations et les accès existants sont conservés dans les essais locaux. Cela justifie le passage aux vérifications réelles qui nécessitent cette version hébergée.

**Réserve : P3-R1, un défaut de concurrence des diagnostics du canal push, reste reproductible par deux nouveaux tests en échec.** L'état de l'appareil est protégé, mais un résultat ancien peut encore déclarer le canal en panne ou résoudre un incident plus récent. Ce défaut doit être corrigé avant de valider complètement la fiabilité des diagnostics push. Il n'a pas recréé la cascade autonome, ni affecté commandes, paiements, accès ou données dans les scénarios examinés : je ne le classe pas comme bloquant pour une recette TEST surveillée. Il ne doit pas être présenté comme corrigé.

Ce verdict technique **n'est ni un déploiement, ni une autorisation de production, ni une approbation de fusion**. La décision d'effectuer la mise à jour TEST reste au fondateur. Aucun service externe n'a été modifié par cet audit.

## Corrections P2-R1 à P2-R4

| Point | Constat indépendant | Statut |
| --- | --- | --- |
| P2-R1 — VAPID | ES256 signé par Web Crypto natif ; `es256.mjs` supprimé. Rotation/relecture dans un même lot D1, réutilisation 6 h et validité 12 h. Concurrence, changement d'heure, réponse de transaction perdue et reprise froide vérifiés. | Corrigé dans les scénarios examinés |
| P2-R2 — Discord | Ancienne destination retirée de l'agrégat et conservée dans l'historique ; webhook encore utilisé non retiré ; retour d'une destination géré. | Corrigé |
| P2-R3 — abonnement | Admission, remplacement, audit et relecture dans un même lot conditionnel ; une expiration concurrente n'est pas annulée. | Corrigé |
| P2-R4 — ordre des réponses | `attempt_seq` protège bien les écritures sur l'appareil, y compris dans la même seconde. Les cas historiques passent. La protection n'est pas complète pour les écritures de santé du canal. | Partiellement corrigé : P3-R1 ci-dessous |

### VAPID et cryptographie

La clé secrète n'est plus utilisée dans une arithmétique elliptique JavaScript propre au projet. La question des opérations non constantes en temps de l'ancien module RFC 6979 ne s'applique donc plus à ce chemin. L'unicité du jeton utilisé par plusieurs instances est assurée par D1, et non par une signature déterministe. Ajouter une seconde bibliothèque de signature n'est pas nécessaire pour corriger ce problème.

`push.mjs` signe avec `crypto.subtle.sign`, vérifie la signature avec la clé publique et l'audience, puis renvoie le jeton réellement relu dans le lot D1. Le test indépendant P3-A1 vérifie aussi la signature avec Node/OpenSSL. Quatre instances de module et une réponse D1 perdue donnent trois réponses identiques, un refus propre, une seule ligne en base et une reprise froide qui réutilise cette ligne. La rotation et un retard d'horloge de cinq minutes sont couverts.

Nuance documentaire pour Claude : « base injoignable : aucun jeton » est trop large. La création, le renouvellement et la lecture à froid échouent proprement sans D1 ; un cache chaud peut réutiliser un jeton précédemment vérifié et enregistré. Cela ne constitue pas une création non coordonnée. La marge d'horloge testée n'est pas une garantie contre un décalage arbitraire. Une restauration chiffrée recrée volontairement `vapid_tokens` vide : distinguer cette reprise exceptionnelle d'un redéploiement ordinaire qui conserve la table.

## P3-R1 — écritures de santé encore dissociées de la tentative courante

Sévérité : **moyenne, fiabilité opérationnelle des diagnostics**. Fichier de reproduction : [`tests/review/push-third-open-issues.test.mjs`](../tests/review/push-third-open-issues.test.mjs). Deux tests rouges, sans `skip`, `todo`, assertion inversée ni échec ignoré.

### P3-R1a — ancien refus automatique après un essai récent reçu

1. Un envoi automatique A attend sa réponse du service push.
2. Un essai manuel B est accepté (`201`) et son accusé de réception passe par la véritable route STUDIO dans le banc.
3. La réponse `403` de A arrive ensuite.
4. L'appareil garde correctement `last_status = 201` et le message A est correctement noté échoué.
5. **Mais `channel_health` devient `failing`, Santé devient `alert` et un incident est ouvert.**

Cause : les exceptions de `pushSender` (`backend/src/push.mjs`, lignes 358–366 au commit examiné) ne transmettent pas les identités de tentative permettant au consommateur de distinguer les échecs dépassés. Les écritures de `destinationFailing` et de l'incident dans `notify.mjs` gardent l'identité de la tentative *outbox*, pas celle de la tentative *appareil*.

### P3-R1b — ancien succès résolvant un échec plus récent

1. Un essai A est accepté et son résultat appareil est enregistré ; `applied` vaut alors `true`.
2. Avant le lot de rétablissement du canal, un envoi automatique B réserve une nouvelle tentative et échoue avec `403`.
3. Le lot tardif de A s'exécute ensuite.
4. L'appareil garde correctement `last_status = 403`.
5. **Mais le canal redevient `ok` et son incident récent est résolu.** Santé peut encore afficher l'erreur de l'appareil : ce test ne démontre pas une interface entièrement verte.

Cause : `studio.mjs:541` décide du rétablissement à partir d'un booléen calculé avant le lot ; `channelRecovered` (`notify.mjs:260`) ne revalide pas la tentative appareil dans ses requêtes. Le chemin automatique fondé sur `receipt.current` doit recevoir la même protection. Le test intercale une vraie opération D1 avant le lot grâce au point d'injection du banc ; il ne fabrique pas l'état final.

### Correction attendue de Claude

- Propager les identités `{ endpoint, attempt_seq }` des résultats utiles, sur les chemins de succès **et** d'échec ; ne pas exposer ces identifiants dans les journaux publics.
- Vérifier en SQL que ces tentatives sont encore courantes au moment d'écrire la santé de la destination et de créer/résoudre les incidents. Appliquer cette condition dans la transaction concernée, pas seulement dans un booléen JavaScript calculé en amont.
- Conserver la vérité historique de chaque message : A reste réellement remis ou échoué, même si son résultat ne doit plus modifier l'état courant du canal. Préserver les gardes existantes de clôture et de bail de l'outbox.
- Préserver la règle existante de remise à au moins un appareil ; couvrir aussi plusieurs appareils, envoi automatique contre essai manuel et deux essais manuels.
- Faire passer P3-R1a/b sans affaiblir les assertions, puis les inclure dans les suites Linux/Windows. Work ne modifie pas unilatéralement le backend de Claude.

Ces deux courses n'entraînent pas une récursion autonome d'alertes dans les essais : les protections contre les notifications techniques qui se réémettent restent actives. Elles peuvent néanmoins produire un faux diagnostic ou une clôture incorrecte et doivent rester suivies explicitement.

## Migration 0011, sauvegardes et conservation de TEST

`0011_jeton_vapid_tentatives.sql` ajoute seulement une table et trois colonnes : `vapid_tokens`, `push_subscriptions.attempt_seq`, `push_subscriptions.admitted_at`, `delivery_health.retired_at`. Les migrations 0009/0010 restent inchangées. Aucune suppression de données ou modification de schéma d'authentification.

Vérifications locales :

- N25/N26 : rollback du lot, application par le vrai Wrangler local, registre des onze migrations et seconde exécution sans nouvelle migration.
- P3-A2 : inscription et passkey logicielles créées sur le schéma 0010, session utilisable après 0011 ; comparaison des données préexistantes ; conservation d'un appareil, de son historique et de ses 176 échecs synthétiques.
- Sauvegarde chiffrée réellement créée, ouverte et restaurée dans une base locale vide ; comparaison des tables, reconnexion avec la même passkey et conservation des dix codes de secours.
- `vapid_tokens` est exclue du contenu sauvegardé mais son schéma est conservé. La sauvegarde n'emporte aucun jeton VAPID temporaire.

La procédure `scripts/test-env.mjs` et son banc de mise à jour réutilisent D1/KV et conservent les secrets existants. Le diff de ce correctif n'ajoute ni rotation de clé, ni nouvel environnement, ni reset d'inscription iPhone. **Ce sont des preuves de code et de simulation locale, pas une inspection des ressources du compte Cloudflare.** La conservation effective distante doit être contrôlée lors de la mise à jour décidée par le fondateur.

Conserver le dossier d'installation existant, sa configuration locale, ses identifiants D1/KV et les origines STUDIO. La section 8 de `docs/NOTIFICATIONS-PUSH.md` prévoit un point Time Travel avant migration. Elle précise aussi que les variables non secrètes changées uniquement dans le tableau de bord doivent être reportées par `reglage`. Un retour arrière du code et une restauration de base n'ont pas le même effet : restaurer la base perd les écritures postérieures au point choisi.

## Banc de tests, régressions et Windows

Comparaison avec la livraison Work précédente `6e01980e3b404379c6f6214eded9e48e1e79fc16` : **aucune modification des anciens fichiers `tests/review/`, de leurs assertions, des preuves `docs/qa/` ni du verrou de dépendances**. Les dix contrôles du second audit sont exécutés tels quels et passent.

Claude a ajouté un fournisseur de base de repli pour les appels directs du jeton dans le banc. Il n'est pas une source de faux jetons, mais masque l'absence de `env.DB` dans ces anciens appels. Pour le contrôler indépendamment, P3-A1 à A3 désactivent ce repli avec `setVapidStore(null)` et transmettent explicitement une vraie base locale au code. L'absence totale de base est testée et refusée. Une amélioration de maintenance serait de fournir explicitement D1 à tous les anciens appels directs, puis de retirer le point d'injection du runtime, sans changer leurs assertions ; ce nettoyage n'est pas bloquant pour TEST.

Le test D1 strict exige les réponses des 300 clients et des 130 notifications webhook, sans ignorer les erreurs de transport. Il passe localement. Le journal Windows de la [CI au commit examiné](https://github.com/Ryaax93/sayless/actions/runs/46144152736) a été lu : job Windows réussi, test D1 strict réussi, aucune occurrence de `fetch failed`. Le job Ubuntu réussit également. Aucun réessai n'a été ajouté pour cacher ces erreurs.

Cela **ne diagnostique pas à distance les 123 erreurs historiques du PC du fondateur**. Si elles reviennent, conserver le journal technique local expurgé dans `.journaux-tests/` et le résultat du test strict ; ne pas assimiler une suite verte à un transport sain. Aucun test Windows n'a été exécuté personnellement depuis cette machine Linux.

## Résultats reproductibles

Environnement local : Linux, Node.js 24.22.3, npm 11.19.1, dépendances installées par `npm ci`. [Journaux et récapitulatif](qa/push-review-3/README.md).

| Vérification | Résultat |
| --- | --- |
| Frontend / inventaire / backend-STUDIO / intégration | 74 / 16 / 130 / 13 réussis |
| Reviews générales / v1.3 / v1.4 / risques | 4 / 2 / 6 / 1 réussis |
| Premier contre-audit push / deuxième / D1 strict | 15 / 10 / 1 réussis |
| WebAuthn avec bibliothèque dans le banc | 25 réussis |
| **Total des tests existants rejoués** | **297 réussis, 0 échec** |
| Contrôles commerciaux séparés | 13 réussis |
| Nouveaux contrôles P3-A1/A2/A3 | 3 réussis |
| Nouveaux critères P3-R1a/b | **2 échecs reproduits** |
| Audit npm complet / `--omit=dev` | 0 / 0 vulnérabilité signalée |
| Boutique / boutique TEST / STUDIO / Worker dry-run / fonctions Pages | Réussis |

Au total : **300 tests réussis et 2 en échec, plus 13 contrôles commerciaux réussis**. Les deux échecs ne sont pas retirés du bilan. L'ancien banc expérimental comparant la signature maison à Noble est devenu inapplicable après suppression du module : ce n'est ni une validation supplémentaire ni un test du produit ignoré pour obtenir un résultat vert.

## Limites gratuites Cloudflare

P3-A3 utilise le véritable ordonnanceur et quatre audiences push, avec succès et refus mélangés : douze messages métier et une notice unique de configuration KV absente dans la fixture, 52 appels simulés au total, aucun message en attente après drainage, aucun incident récursif. Maximum observé **39 appels D1 et 16 appels externes par invocation**, sous les plafonds de 50. N24 et le scénario historique de panne simultanée restent verts.

Compilation : Worker + STUDIO **1073 Kio** (204,02 Kio gzip annoncés par Wrangler), fonctions Pages **139 Kio** ; contrôle statique gratuit réussi. Les coûts quotidiens en lignes D1, le stockage et l'utilisation réelle de KV dépendent du volume et ne sont pas certifiés par un test local.

**Le temps CPU hébergé n'a pas été mesuré.** L'offre Free documente 10 ms de CPU par invocation HTTP et Cron ; l'attente réseau ne constitue pas du CPU. La durée totale d'un test local ne permet pas de conclure. Mesurer ce point lors de la recette TEST, notamment au renouvellement VAPID, pendant une sauvegarde et lors du drainage de messages. Une éventuelle limite doit conduire à réduire le travail par invocation, pas à engager automatiquement une offre payante.

Sources primaires vérifiées le 28 novembre 2026 : [limites Workers](https://developers.cloudflare.com/workers/platform/limits/), [limites D1](https://developers.cloudflare.com/d1/platform/limits/), [transactions D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), [instructions Web Push Apple](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers). Un lot D1 compte comme un appel pour le plafond par invocation ; ses instructions s'exécutent dans une transaction. La réutilisation VAPID de six heures évite les rotations horaires trop rapprochées du correctif précédent.

## Réception réelle et recette à effectuer après décision du fondateur

Le fondateur a confirmé avoir reçu le rapport de 10 h sur son iPhone et sur Discord. C'est une observation réelle utile sur **l'ancienne version déployée** ; elle ne certifie pas la réception sur `d05cf65`. Dans cet audit, les fournisseurs sont simulés et les passkeys sont logicielles : aucune validation physique Face ID n'est revendiquée.

Après une mise à jour TEST décidée et effectuée séparément : vérifier le SHA, D1/KV et les secrets conservés, connexion Face ID existante, essai manuel accepté puis réception effectivement constatée sur l'iPhone, notification Discord, clôture protégée des anciens échecs et historique conservé. Observer au moins deux heures pour vérifier l'arrêt des alertes de 31 minutes ; vérifier ensuite le rapport programmé et la rotation VAPID au-delà de six heures. En cas d'opérations concurrentes, tenir compte de P3-R1 et de l'état de l'appareil, sans se fier au seul agrégat du canal.

La procédure de mise à jour est la section 8 de `docs/NOTIFICATIONS-PUSH.md`. **Aucun de ses blocs de déploiement, restauration ou diagnostic distant n'a été exécuté ici.** Aucun changement de la boutique ni de son design n'est introduit par la livraison Work : uniquement tests, rapport, preuves et changelog.

## Reproduction locale PowerShell — aucun déploiement

Dans une copie neuve de la branche Work publiée avec cet audit :

```powershell
& {
  $ErrorActionPreference = 'Stop'
  $copieAudit = Join-Path $env:USERPROFILE 'sayless-audit-push-3'
  if (Test-Path $copieAudit) { throw "Le dossier existe déjà : $copieAudit" }
  git clone --single-branch --branch work/audit-push-d05cf65 https://github.com/Ryaax93/sayless.git $copieAudit
  if ($LASTEXITCODE -ne 0) { throw 'Copie impossible' }
  Set-Location $copieAudit
  if ((git rev-parse HEAD^) -ne 'd05cf655668a4ea6d2191f5859aa78c1d4f6cf5d') { throw 'Base différente de la version auditée' }
  npm.cmd ci --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Installation incomplète' }
  foreach ($suite in 'test', 'test:review', 'test:review:v13', 'test:review:v14', 'test:review:risks', 'test:review:push', 'test:review:push2', 'test:review:d1', 'test:webauthn:bibliotheque') {
    npm.cmd run $suite
    if ($LASTEXITCODE -ne 0) { throw "Suite en échec : $suite" }
  }
  node --test tests/review/push-third-integrity.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Contrôle indépendant en échec' }
  node --test tests/review/push-third-open-issues.test.mjs
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'Consulter les assertions : P3-R1a et P3-R1b échouent sur la version auditée. Ne pas les ignorer.' -ForegroundColor Yellow
  }
}
```

Les commandes de compilation et d'audit rejouées sont consignées dans `docs/qa/push-review-3/results.json`. La syntaxe PowerShell est fournie pour reproduction ; les nouveaux tests ont été exécutés ici sous Linux, pas sur le PC Windows du fondateur.

## Transmission à Claude

1. P3-R1 : corriger les deux écritures de santé concurrentes avec gardes SQL de tentative appareil, conserver l'historique et faire passer les deux régressions livrées.
2. Préciser la documentation du cache VAPID et de sa reprise après restauration ; envisager ensuite le retrait du repli de test du runtime.
3. Préserver migration 0011 additive, secrets, clés VAPID, ressources existantes et origines. Ne pas régénérer les clés lors d'une mise à jour ordinaire.
4. Ajouter ces nouvelles régressions aux vérifications Windows/Linux après correction. Fournir les mesures CPU et les observations iPhone/Discord du SHA réellement hébergé lors de la recette autorisée.
5. **GO pour recette TEST surveillée ; fiabilité complète des diagnostics encore sous réserve P3-R1.** Aucune recommandation de lancement public ou de fusion à ce stade.
