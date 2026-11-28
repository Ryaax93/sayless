# SAYLESS STUDIO : vérifier, déployer Cloudflare TEST, installer sur l'iPhone

**Préparé par Claude le 27 novembre 2026** pour le fondateur, sur PC Windows avec PowerShell. Version à utiliser : la branche commune `claude/verification-v2` au SHA indiqué dans la PR nº 1.

Rien ici ne touche `main`, `v2`, saylessbrand.fr, le DNS, Stripe réel ou la boutique publique. Aucune dépense : offre gratuite de Cloudflare. Les paiements restent fermés.

Comment exécuter les blocs :

- Copie chaque bloc **en entier** dans PowerShell, puis appuie sur Entrée. Le bloc s'arrête à la première erreur, avec un message rouge qui dit quoi faire.
- `npm.cmd` et `npx.cmd` évitent de modifier la politique d'exécution de PowerShell.

## A. Vérifier sur ton PC (aucun déploiement)

Ce bloc crée un dossier neuf `sayless-test`, sans toucher à ton dossier actuel `sayless`. Les fichiers gardent les fins de ligne de la vérification GitHub (`core.autocrlf=false`). Durée : environ 15 minutes.

```powershell
& {
  $ErrorActionPreference = 'Stop'
  Set-Location $env:USERPROFILE
  if (Test-Path '.\sayless-test') { throw 'Le dossier sayless-test existe déjà : renomme-le avant de continuer.' }
  git clone -c core.autocrlf=false --branch claude/verification-v2 --single-branch https://github.com/Ryaax93/sayless.git sayless-test
  if ($LASTEXITCODE -ne 0) { throw 'Clonage incomplet' }
  Set-Location '.\sayless-test'
  git rev-parse HEAD
  node --version
  npm.cmd ci --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Installation incomplète' }
  foreach ($suite in 'test', 'test:review', 'test:review:v13', 'test:review:v14', 'test:review:risks', 'test:webauthn:bibliotheque') {
    npm.cmd run $suite
    if ($LASTEXITCODE -ne 0) { throw "Suite en échec : $suite" }
  }
  npm.cmd audit
  if ($LASTEXITCODE -ne 0) { throw 'Audit complet à examiner' }
  npm.cmd audit --omit=dev
  if ($LASTEXITCODE -ne 0) { throw 'Audit production à examiner' }
  npm.cmd run check:cloudflare
  if ($LASTEXITCODE -ne 0) { throw 'Compilation Cloudflare en échec' }
  node scripts/check-free-plan.mjs
  if ($LASTEXITCODE -ne 0) { throw "Limites de l'offre gratuite dépassées" }
  Write-Host 'Vérification complète : tout est bon.' -ForegroundColor Green
}
```

Résultats attendus :

- `git rev-parse HEAD` affiche le SHA de la PR nº 1, et `node --version` une version 26.
- Chaque suite affiche `fail 0`. Les contrôles commerciaux affichent « 13 vérifications commerciales réussies ». Le backend prend plusieurs minutes.
- Les deux audits indiquent `found 0 vulnerabilities`, et `check-free-plan` trois lignes « OK ».
- Le bloc finit par « Vérification complète : tout est bon. » en vert.

En cas d'échec, envoie-moi les dix dernières lignes affichées. Elles ne contiennent aucun secret.

## B. Déployer Cloudflare TEST (après ton autorisation)

L'assistant crée dans ton compte Cloudflare gratuit :

- la base `sayless-test` ;
- l'espace de sauvegarde `sayless-test-backups` ;
- le Worker `sayless-ops-test`, sur une adresse `*.workers.dev`.

Il génère les secrets sur ton PC, dans `sayless-secrets-test`, puis les envoie directement à Cloudflare, sans jamais les afficher. Il demande `OUI` avant toute création. Il n'annonce le succès que si le contrôle final est bon.

Dans la même fenêtre PowerShell, qui est déjà dans `sayless-test` :

```powershell
& {
  $ErrorActionPreference = 'Stop'
  if (-not (Test-Path '.\scripts\test-env.mjs')) { throw "Place-toi d'abord dans le dossier sayless-test" }
  npx.cmd wrangler login
  if ($LASTEXITCODE -ne 0) { throw 'Connexion Cloudflare non terminée' }
  node scripts/test-env.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Installation TEST incomplète : lis le message, corrige, puis relance ce bloc' }
  node scripts/test-env.mjs etat
  if ($LASTEXITCODE -ne 0) { throw 'Environnement TEST non opérationnel : ne continue pas' }
}
```

- **Connexion** : `wrangler login` ouvre le navigateur ; accepte avec ton compte Cloudflare.
- **Adresse workers.dev** : si l'assistant signale qu'elle manque, ouvre le lien affiché, choisis un sous-domaine, puis relance le bloc. L'assistant reprend où il s'était arrêté, sans recréer la base ni régénérer les secrets.
- **Résultat attendu** :
  - « Installation terminée et vérifiée », puis « Environnement de TEST opérationnel » ;
  - les lignes « paiement Stripe : absent » et « Environnement : staging ; paiements : fermés ».
- **À noter** : l'adresse affichée après « STUDIO est en ligne : ». Elle n'est pas secrète.
- **À garder** : le dossier `sayless-secrets-test` de ton dossier personnel. Ne le supprime pas. Sauvegarde-le sur une clé USB, hors de Cloudflare et hors de GitHub.

## C. Installer SAYLESS STUDIO sur l'iPhone

1. Sur le PC, ouvre le code d'installation :
   ```powershell
   notepad "$env:USERPROFILE\sayless-secrets-test\CODE-STUDIO.txt"
   ```
   Ne le colle jamais dans un chat ni un e-mail : tu le tapes directement sur l'iPhone.
2. Sur l'iPhone, ouvre dans **Safari** l'adresse exacte notée à l'étape B.
3. Saisis le code d'installation et touche **Vérifier le code**.
4. Touche **Autoriser cet appareil** et valide avec Face ID.
5. Recopie les **dix codes de secours** sur papier et range-les hors ligne. Ils ne seront plus affichés. Chacun ne sert qu'une fois.
6. Dans Safari, touche **Partager**, puis **Sur l'écran d'accueil**, puis **Ajouter**. Ouvre STUDIO depuis l'icône et touche **Se connecter avec Face ID**.
7. Depuis l'icône, touche la **cloche** de l'écran Aujourd'hui, puis **Activer** sur la ligne « Sur cet iPhone ». Accepte la demande d'iOS.

Premiers contrôles, paiements fermés :

- **Plus** > **Santé du site et historique**, deux minutes après l'installation :
  - « Boutique 2.0 » : En pause (aucun paiement possible) ;
  - « Paiement Stripe » : Clés à saisir ;
  - « Tâches automatiques » : en vert.
- **Stock** > **Commencer l'inventaire** : tu saisis toi-même le comptage, rien n'est prérempli. Le comptage déclaré du 26 novembre est S8 / M14 / L5, soit 27 pièces. Rapproche d'abord les ventes du lien 1.0. Rien n'est activé automatiquement.
- **Code de secours** : à essayer seulement sur ces données de test, en gardant les autres codes. Il retire tous les appareils, puis tu réautorises l'iPhone. Un code déjà utilisé est refusé.

C'est le premier vrai essai de Face ID. Les tests automatiques utilisent un authentificateur simulé et ne le remplacent pas.

## D. Ensuite, chacun sur ton accord séparé

| Étape | Document | État |
| --- | --- | --- |
| Discord, un salon par type de notification | `docs/DISCORD.md` | Prêt ; testé en simulation, pas encore sur ton serveur |
| Vérification Face ID par SimpleWebAuthn 14.1.0 | `docs/WEBAUTHN-BIBLIOTHEQUE.md` | Prête, désactivée : `reglage WEBAUTHN_ENGINE simplewebauthn` après ta validation |
| E-mails Resend de test | `docs/CLOUDFLARE-TEST.md` | Possible : le risque de doublon V14-R1 est corrigé ; la livraison réelle reste à vérifier |
| Boutique de test sur Pages | `docs/CLOUDFLARE-TEST-FRONTEND.md` (Work) | Préparée par Work, paiements fermés |
| Stripe en mode test | — | Pas encore : clés de test et accord dédiés |
| Transporteur (Boxtal) | — | Non opérationnel : en attente des confirmations écrites |

Métriques à relever après 24 heures : Cloudflare > Workers & Pages > `sayless-ops-test` > Métriques. Note le nombre d'erreurs (attendu : 0) et le temps de calcul médian et maximal (limite gratuite : 10 ms). C'est la seule limite qu'on ne peut pas mesurer sur un ordinateur. Aucune montée de forfait n'est automatique.

## E. Mettre à jour TEST sans rien perdre

Pour installer une correction sur l'environnement TEST existant (base D1, secrets, sauvegardes et Face ID conservés), suis `docs/NOTIFICATIONS-PUSH.md`, section 8 (« Mettre à jour Cloudflare TEST ») :

- **bloc A** : récupérer et vérifier le code ;
- **bloc B** : diagnostic en lecture seule ;
- **bloc C** : mise à jour, avec point de restauration de la base.
