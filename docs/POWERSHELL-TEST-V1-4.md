# SAYLESS v1.4 — commandes PowerShell

Procédure préparée le 26 novembre 2026. Les commandes locales ont été vérifiées sur Linux avec Node 24.22.3/npm 11.19.1 ; les suites Windows précédentes du fondateur étaient sur Node 26.13.1/npm 11.20.0. Les commandes Cloudflare ci-dessous sont préparées, **pas exécutées contre un compte**. Aucune fusion de PR n'est nécessaire pour une recette de cette branche.

## A. Maintenant : récupérer et vérifier sans déployer

Ouvrir PowerShell. Ce bloc crée une nouvelle copie pour préserver tout travail en cours dans le dossier existant. `npm.cmd`/`npx.cmd` évitent de changer la politique PowerShell.

```powershell
$ErrorActionPreference = 'Stop'
Set-Location $env:USERPROFILE
if (Test-Path '.\sayless-v14-test') { throw 'Ce dossier existe déjà : conserver son contenu et choisir un autre dossier vide.' }
git clone --branch work/frontend-api-v1-2 --single-branch https://github.com/Ryaax93/sayless.git sayless-v14-test
if ($LASTEXITCODE -ne 0) { throw 'Clonage incomplet' }
Set-Location '.\sayless-v14-test'
git rev-parse HEAD
node --version
npm.cmd --version
npm.cmd ci --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Installation incomplète' }
npm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'Une suite nominale a échoué' }
npm.cmd run test:review
if ($LASTEXITCODE -ne 0) { throw 'Revue initiale en échec' }
npm.cmd run test:review:v13
if ($LASTEXITCODE -ne 0) { throw 'Revue v1.3 en échec' }
npm.cmd run test:review:v14
if ($LASTEXITCODE -ne 0) { throw 'Revue v1.4 en échec' }
npm.cmd audit
if ($LASTEXITCODE -ne 0) { throw 'Audit complet à examiner' }
npm.cmd audit --omit=dev
if ($LASTEXITCODE -ne 0) { throw 'Audit production à examiner' }
npm.cmd run build:storefront
if ($LASTEXITCODE -ne 0) { throw 'Build boutique en échec' }
$env:SAYLESS_TEST_ORIGIN = 'https://sayless-boutique-test.pages.dev'
Remove-Item Env:SAYLESS_TEST_CHECKOUT -ErrorAction SilentlyContinue
npm.cmd run build:storefront:test
if ($LASTEXITCODE -ne 0) { throw 'Build boutique TEST en échec' }
npm.cmd run check:cloudflare
if ($LASTEXITCODE -ne 0) { throw 'Compilation Cloudflare en échec' }
```

Comparer le SHA affiché à celui livré dans la PR nº 2. Si la branche a évolué, noter le nouveau SHA et ses résultats ; ne pas confondre les rapports entre commits. Résultat attendu de cette livraison : 211 tests Node + 13 contrôles commerciaux réussis, audits à zéro, compilations réussies.

Reproduction séparée du défaut restant :

```powershell
npm.cmd run test:review:risks
```

**Un échec attendu**, V14-R1 : deux e-mails simulés au lieu d'un après interruption >24 h. Ne pas compter ce résultat comme une réussite. Aucun vrai e-mail n'est envoyé.

Pour consulter la boutique statique :

```powershell
npm.cmd run dev:storefront
```

Ouvrir `http://127.0.0.1:5173/`. Stock à confirmer et paiement fermé sont normaux sans API. Arrêter par Ctrl+C. Les captures de la PR utilisent une base locale de recette distincte, jamais l'inventaire réel.

## B. Seulement après autorisation explicite : Cloudflare TEST fermé

**Arrêter ici tant que le fondateur n'a pas autorisé le déploiement TEST.** Les commandes suivantes créent et publient des ressources externes. Le nom « production branch » de Pages désigne ici la branche principale du **projet TEST indépendant**, jamais `main`, `v2` ou saylessbrand.fr.

Vérifier dans Cloudflare que le compte est gratuit, que `sayless-test`, `sayless-ops-test`, `sayless-test-backups` et `sayless-boutique-test` ne désignent aucune ressource de production. Ne pas activer d'intégration Git automatique. Si le nom Pages fixe est indisponible ou renvoie une autre URL, arrêter et coordonner le changement d'origine dans les deux applications ; ne pas substituer un domaine de production.

Depuis le dossier du projet :

```powershell
npx.cmd wrangler login
if ($LASTEXITCODE -ne 0) { throw 'Connexion Cloudflare non terminée' }
node scripts/test-env.mjs
if ($LASTEXITCODE -ne 0) { throw 'Assistant interrompu : lire son message avant reprise' }
node scripts/test-env.mjs etat
if ($LASTEXITCODE -ne 0) { throw 'Contrôle TEST incomplet : ne pas continuer' }
```

L'assistant Claude applique les migrations à D1 TEST, crée KV TEST, génère les secrets hors Git et publie le Worker de test. S'il demande de choisir le sous-domaine workers.dev, terminer cette étape dans le tableau de bord puis relancer la commande. Ne pas supprimer ni régénérer les clés à chaque reprise. Le contrôle `etat` séparé est requis même si la première commande finit avec code 0.

### Boutique Pages fermée, même D1 TEST

```powershell
node scripts/prepare-pages-test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Configuration Pages TEST refusée' }
$env:SAYLESS_TEST_ORIGIN = 'https://sayless-boutique-test.pages.dev'
Remove-Item Env:SAYLESS_TEST_CHECKOUT -ErrorAction SilentlyContinue
npm.cmd run build:storefront:test
if ($LASTEXITCODE -ne 0) { throw 'Build TEST en échec' }
npx.cmd wrangler pages project create sayless-boutique-test --production-branch work/frontend-api-v1-2
if ($LASTEXITCODE -ne 0) { throw 'Création refusée : vérifier manuellement le projet TEST existant avant toute suite' }
npx.cmd wrangler pages secret bulk "$env:USERPROFILE\sayless-secrets-test\pages-secrets.json" --project-name sayless-boutique-test
if ($LASTEXITCODE -ne 0) { throw 'Secrets Pages TEST incomplets' }
npx.cmd wrangler pages deploy dist-storefront --project-name sayless-boutique-test --branch work/frontend-api-v1-2
if ($LASTEXITCODE -ne 0) { throw 'Déploiement Pages TEST incomplet' }
node scripts/test-env.mjs etat
if ($LASTEXITCODE -ne 0) { throw 'État serveur TEST à vérifier' }
```

`wrangler.json` est créé localement et ignoré par Git ; nom standard requis par Wrangler Pages. Le générateur refuse une configuration existante d'un autre environnement, n'importe aucune valeur libre et ne transmet rien. D1 : `sayless-test`, origine : `https://sayless-boutique-test.pages.dev`, mode serveur : staging. Le fichier `pages-secrets.json` contient uniquement les APP_SECRET/PII_KEY communs générés pour TEST. Si le dossier des secrets a été personnalisé, adapter ce chemin local, jamais son contenu dans Git. Les secrets STUDIO, Discord, VAPID privé et clé privée de sauvegarde ne doivent pas être copiés vers Pages.

Pour une **mise à jour déjà autorisée**, omettre uniquement la création du projet si son identité a été vérifiée ; conserver les contrôles et le build fermé. Ne pas installer un projet au hasard après une erreur.

### iPhone, secours et sauvegardes

- Ouvrir dans Safari l'URL exacte `workers.dev` renvoyée par l'assistant. Sur PowerShell : `notepad "$env:USERPROFILE\sayless-secrets-test\CODE-STUDIO.txt"`. Saisir le code dans STUDIO, pas dans une conversation.
- Enregistrer la passkey, recopier les dix codes de secours hors ligne, puis Safari → Partager → Sur l'écran d'accueil. Vérifier l'ouverture depuis l'icône. Cela constitue le premier vrai essai Face ID ; les essais logiciels ne le remplacent pas.
- Vérifier pause des ventes, absence de clé Stripe, statut du cron, CGV de TEST clairement non contractuelles et santé des sauvegardes.
- Sur des données de TEST uniquement, utiliser un code de secours : anciennes sessions/passkeys révoquées, code réutilisé refusé, réinscription réservée au bon appareil. Garder un second accès sûr et les autres codes avant cet exercice.
- Faire deux copies sûres de la clé privée de sauvegarde, vérifier qu'elles se relisent ; ne pas effacer l'unique exemplaire. Télécharger une sauvegarde TEST depuis STUDIO, puis lancer :

```powershell
$SauvegardeSayless = Read-Host 'Chemin complet du fichier de sauvegarde TEST téléchargé'
$CleSauvegardeSayless = Read-Host 'Chemin complet de la clé privée de sauvegarde TEST conservée hors Git'
node scripts/restore-backup.mjs --backup "$SauvegardeSayless" --key "$CleSauvegardeSayless"
if ($LASTEXITCODE -ne 0) { throw 'Sauvegarde non vérifiée' }
```

Cette commande vérifie la lecture ; la restauration dans une D1 hébergée isolée reste un exercice à coordonner. Observer les métriques CPU, D1 et KV sur 24 h ; aucune montée de forfait automatique.

## C. Autorisation distincte : connecteurs TEST

Ne pas activer les paiements dans ce premier passage. Resend attend aussi la correction V14-R1 pour valider sa fiabilité.

- Discord : créer un webhook du seul salon TEST retenu, sans données clients. `node scripts/test-env.mjs secret DISCORD_WEBHOOK_URL` ; entrer sa valeur dans l'invite masquée, jamais dans la commande. Le routage multi-salons reste à développer par Claude.
- Resend TEST : `node scripts/test-env.mjs secret RESEND_API_KEY`, puis `node scripts/test-env.mjs reglage EMAIL_FROM "SAYLESS <onboarding@resend.dev>"`. **La commande reglage redéploie le Worker.** Destinataire autorisé par le compte Resend uniquement tant que le domaine n'est pas validé. Aucun changement DNS implicite.
- Stripe : sandbox/TEST seulement, endpoint webhook TEST exact indiqué par Claude, secrets via invite masquée. Le Worker et Pages auront besoin des clés prévues par leur rôle ; ne jamais copier un jeu de secrets complet entre services. Tester signature, doublons, réponse perdue et retours avant d'autoriser `SAYLESS_TEST_CHECKOUT=enabled`.
- Turnstile : configuration TEST pour l'origine exacte, clé publique dans le build, clé privée côté API. Aucune fausse vérification présentée comme réelle.
- Boxtal : attendre la réponse au ticket 2277409 ; aucun faux relais ou achat d'étiquette réel.

La liste détaillée des prérequis avant Stripe TEST figure dans `CLOUDFLARE-TEST-FRONTEND.md`. Aucune commande de ce document n'autorise une vente réelle, une fusion ou une dépense.
