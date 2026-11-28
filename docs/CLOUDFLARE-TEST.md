# Environnement de test Cloudflare — pas à pas sur Windows

> **Procédure simplifiée en PowerShell (27 novembre)** : `PROCEDURE-TEST-IPHONE.md` (vérifier, déployer TEST, installer STUDIO sur l'iPhone). Ce document garde le détail des comptes et des étapes.

**But** : installer SAYLESS STUDIO sur ton iPhone et l’essayer pour de vrai, dans un environnement **entièrement séparé** de la boutique actuelle. Tout reste gratuit. Le domaine saylessbrand.fr, le DNS, la boutique 1.0, le lien de paiement 1.0 et le Stripe réel ne sont **pas touchés**.

Règles : une étape à la fois, vérifiée avant la suivante. Aucune clé secrète dans le chat, par e-mail ou dans GitHub : les secrets sont créés sur ton PC et envoyés directement à Cloudflare. Même si une clé Stripe réelle était saisie par erreur, l’environnement de test la refuse.

| | Test (cette procédure) | Production (plus tard, sur ton autorisation) |
| --- | --- | --- |
| STUDIO | `https://sayless-ops-test.<ton-sous-domaine>.workers.dev` | `https://studio.saylessbrand.fr` |
| Base | D1 `sayless-test` | base séparée |
| Stripe | aucun, puis mode test | mode réel |
| Coût | 0 € (offres gratuites, sans carte bancaire) | 0 € au départ |

Offres gratuites utilisées : Workers (100 000 requêtes par jour, 10 ms de calcul par requête), D1 (500 Mo par base), Workers KV pour les sauvegardes (1 000 écritures par jour), une tâche planifiée sur les 5 offertes, journaux du Worker.

Durée totale : environ 1 heure, une seule fois. Ensuite, tout se fait sur l’iPhone.

## Étape 1 — Préparer le PC (15 min)

1. **Node.js** : sur nodejs.org, télécharge la version **LTS** (26.x) pour Windows et installe-la avec les choix par défaut. Laisse **décochée** la case qui propose d’installer des outils supplémentaires (Chocolatey, Python).
2. **Git** : sur git-scm.com, télécharge Git pour Windows et installe-le avec les choix par défaut.
3. Ouvre l’**Invite de commandes** : touche Windows, tape `cmd`, Entrée. Utilise-la pour toutes les commandes (PowerShell bloque `npm` par défaut).
4. Vérifie :
   ```bat
   node -v
   git --version
   ```
   Attendu : `v26.…` (22.13 minimum) et `git version 2.…`.

## Étape 2 — Compte Cloudflare (10 min)

1. Sur dash.cloudflare.com/sign-up, crée un compte gratuit avec ton adresse SAYLESS et un mot de passe unique, puis confirme l’e-mail reçu.
2. **N’ajoute aucun domaine ni site**, même si le tableau de bord le propose : passe cette étape.
3. Sécurité : icône du profil en haut à droite → profil → **Authentification** → active la **double authentification** (application d’authentification). Garde ses codes de secours sur papier.
4. Ouvre **Workers & Pages** (rubrique Compute). Si Cloudflare te demande un sous-domaine `workers.dev`, choisis un nom neutre, par exemple `sayless-test` : il fera partie de l’adresse de STUDIO.

## Étape 3 — Récupérer SAYLESS sur le PC (10 min)

```bat
cd %USERPROFILE%
git clone -c core.autocrlf=false --branch claude/verification-v2 https://github.com/Ryaax93/sayless.git
cd sayless
npm ci
```

`npm ci` prend quelques minutes et affiche des avertissements : c’est normal. Il se termine par `added … packages`.

## Étape 4 — Relier le PC à Cloudflare (2 min)

```bat
npx wrangler login
```

Une page s’ouvre dans le navigateur : connecte-toi à Cloudflare puis **Allow**. Le terminal affiche `Successfully logged in`. Aucun jeton à copier.

## Étape 5 — Installer l’environnement de test (5 min)

```bat
node scripts/test-env.mjs
```

L’assistant fait et vérifie 8 étapes, chacune terminée par `OK` :

1. connexion au bon compte ;
2. secrets de test créés dans `%USERPROFILE%\sayless-secrets-test` (jamais affichés) ;
3. base `sayless-test` (Europe de l’Ouest) ;
4. espace des sauvegardes chiffrées ;
5. tables de la base ;
6. construction de STUDIO ;
7. mise en ligne du Worker `sayless-ops-test`, secrets joints au premier envoi seulement ;
8. contrôle en ligne.

S’il s’arrête, il dit pourquoi et quoi faire ; relance ensuite la même commande, il reprend là où il en était. À la fin, il affiche l’adresse de STUDIO. Cette adresse n’est pas secrète.

## Étape 6 — Installer STUDIO sur l’iPhone (10 min)

1. Ouvre l’adresse de STUDIO dans **Safari** sur l’iPhone. Astuce : ouvre-la dans Edge sur le PC, clic droit sur la page → « Créer un code QR pour cette page », puis scanne-le avec l’appareil photo de l’iPhone.
2. Sur le PC : `notepad %USERPROFILE%\sayless-secrets-test\CODE-STUDIO.txt`. Tape ce code sur l’iPhone (majuscules, tirets et espaces indifférents), touche « Vérifier le code », puis « Autoriser cet appareil » : Face ID.
3. Recopie les **10 codes de secours sur papier**. Ils ne seront plus jamais affichés.
4. Safari → Partager → **Sur l’écran d’accueil**. Ouvre ensuite STUDIO depuis son icône.
5. Dans STUDIO ouvert depuis l’icône : Notifications → **Activer** → Autoriser.
6. Vérifie : Plus → Santé du site.

## Étape 7 — Ranger les secrets (5 min)

- Copie `CLE-PRIVEE-SAUVEGARDES.json` sur une clé USB rangée, idéalement en deux exemplaires, puis supprime-la du PC. Sans elle, aucune sauvegarde ne peut être relue.
- Garde le reste du dossier `sayless-secrets-test` sur le PC jusqu’à l’essai de la boutique de test : elle aura besoin des mêmes secrets.

## Ensuite, chacun séparément

Chaque secret se saisit avec l’assistant : la valeur ne s’affiche pas et part directement chez Cloudflare.

- **Discord** : serveur ou salon privé → Paramètres du salon → Intégrations → Webhooks → Nouveau webhook → Copier l’URL, puis `node scripts/test-env.mjs secret DISCORD_WEBHOOK_URL`.
- **E-mails (Resend, offre gratuite)** : sans domaine vérifié, Resend n’envoie qu’à l’adresse de ton compte Resend, ce qui suffit pour les essais. Vérifier le domaine demanderait une modification du DNS : pas avant ton accord. `node scripts/test-env.mjs secret RESEND_API_KEY`, puis `node scripts/test-env.mjs reglage EMAIL_FROM "SAYLESS <onboarding@resend.dev>"`.
- **Stripe en mode test** : clé de test et webhook de test seulement (`secret STRIPE_SECRET_KEY`, `secret STRIPE_WEBHOOK_SECRET`). Procédure détaillée au moment de l’essai de paiement.

Contrôle à tout moment : `node scripts/test-env.mjs etat`.

## Mettre à jour après une nouvelle version

```bat
cd %USERPROFILE%\sayless
git pull
npm ci
node scripts/test-env.mjs
```

Les secrets déjà envoyés ne sont jamais remplacés ; seules les nouvelles migrations sont appliquées.

## Recette de la version corrective du 26 novembre (paiements fermés)

**Seulement après ton accord**, une fois les étapes 1 à 7 faites. Cette recette ne crée aucune ressource nouvelle, n’ouvre aucun paiement et ne touche ni au domaine, ni au DNS, ni à Stripe réel, ni à la boutique publique.

1. Mettre l’environnement de test à jour avec la branche de vérification (la migration 0007 s’applique seule) :
   ```bat
   cd %USERPROFILE%\sayless
   git fetch origin
   git checkout claude/verification-v2
   git pull
   npm ci
   node scripts/test-env.mjs
   ```
   Attendu : toutes les étapes « OK », puis `node scripts/test-env.mjs etat` sans erreur.
2. **Paiements fermés** : STUDIO → Plus → Santé du site. Attendu : « Boutique 2.0 : en pause (aucun paiement possible) » et « Paiement Stripe : clés à saisir ». Aucune clé Stripe n’est demandée dans cette recette.
3. **Tâche de chaque minute** : deux minutes après la mise à jour, « Tâches automatiques : OK » et « File d’envoi : OK ». Si un e-mail client attendait, la ligne passe en alerte puis revient à OK toute seule.
4. **Limites de l’offre gratuite** : tableau de bord Cloudflare → Workers & Pages → `sayless-ops-test` → Métriques. Relève, sur 24 heures, le nombre d’erreurs (attendu : 0) et le **temps de calcul** médian et maximal (limite gratuite : 10 ms par exécution). Envoie-moi ces chiffres : ils ne contiennent aucun secret. C’est la seule mesure qu’on ne peut pas faire sur un ordinateur.
5. **CGV** : STUDIO → Réglages → CGV → publie une version de test (texte marqué « TEST — document non contractuel »). Attendu dans Santé : « CGV publiées », avec le début de leur empreinte. Une version publiée ne peut plus être modifiée : publie seulement un texte de test.
6. **Ventes 1.0 (facultatif, avec une clé Stripe de test seulement)** : Réglages → « Relire les ventes du lien 1.0 ». STUDIO enchaîne seul les lots ; attendu : un message unique avec le total relu.

**Pas couvert ici** (il faut la boutique de test et Stripe en mode test, étape suivante, sur ton accord) : confirmation de commande reçue après un paiement de test, route publique `/api/terms` affichée par la boutique, refus d’un paiement si les CGV changent pendant l’achat.

## Sauvegardes : vérifier qu’elles se relisent (une fois par mois)

1. STUDIO → Santé du site → Sauvegardes chiffrées → Télécharger.
2. Sur le PC, clé USB branchée :
   ```bat
   node scripts/restore-backup.mjs --backup "%USERPROFILE%\Downloads\sayless-sauvegarde-….json" --key E:\CLE-PRIVEE-SAUVEGARDES.json
   ```
   Résultat attendu : « Contrôle réussi ».

## Ce que cette procédure ne fait pas

Aucun domaine ajouté, aucun changement DNS, aucune clé Stripe réelle, aucune modification du lien 1.0 ni de la boutique publique, aucun abonnement, aucune dépense. Le passage en production fera l’objet d’une procédure séparée, soumise à ton autorisation.
