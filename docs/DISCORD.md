# Discord SAYLESS : un salon par type de notification

**Préparé par Claude le 27 novembre 2026.** Gratuit : des webhooks entrants Discord, sans bot ni abonnement. Aucune donnée de client n'est envoyée sur Discord : seulement des références de commande, des tailles, des montants, des états et des compteurs.

## Comment ça marche

Chaque notification de STUDIO a un type fixe. Le serveur en déduit le salon ; ni le navigateur ni la boutique ne peuvent le choisir. Chaque salon a son webhook, gardé comme secret du Worker. Un salon sans webhook dédié passe par le webhook unique `DISCORD_WEBHOOK_URL`, s'il existe. Sinon, ses messages restent dans STUDIO et sur l'iPhone.

| Salon conseillé | Secret du Worker | Ce qui y arrive |
| --- | --- | --- |
| #commandes | `DISCORD_WEBHOOK_COMMANDES` | Nouvelle commande (numéro, taille, montant, mode), vente 1.0, commande à vérifier, message client reçu (référence seulement) |
| #expéditions | `DISCORD_WEBHOOK_EXPEDITIONS` | Colis expédié, en point relais, retiré, livré, non retiré |
| #retours | `DISCORD_WEBHOOK_RETOURS` | Colis retourné, demande de retour ou de rétractation (référence seulement, jamais le message), remboursement |
| #stock | `DISCORD_WEBHOOK_STOCK` | Stock faible, taille épuisée, fin du drop, vente payée sans pièce libre |
| #finances | `DISCORD_WEBHOOK_FINANCES` | Montant Stripe différent, paiement échoué, litige, remboursement ou session inconnus |
| #rapport-quotidien | `DISCORD_WEBHOOK_RAPPORT` | Rapport de 10 h |
| #alertes | `DISCORD_WEBHOOK_ALERTES` | Pannes techniques, e-mail client à vérifier ou bloqué, CGV altérées, et tout type imprévu |
| #sécurité | `DISCORD_WEBHOOK_SECURITE` | Nouvel appareil autorisé, code de secours utilisé, codes régénérés, compteur de passkey qui recule |
| #état-du-site | `DISCORD_WEBHOOK_SITE` | Boutique ouverte ou mise en pause |
| #sauvegardes | `DISCORD_WEBHOOK_SAUVEGARDES` | Sauvegarde échouée ou non configurée, sans contenu ni clé ni lien |

Les salons sans automatisme (direction artistique, contenus, futurs drops) restent manuels. Tu peux tout regrouper : avec le seul `DISCORD_WEBHOOK_URL`, tout arrive dans un seul salon, comme avant.

Discord limite le débit. Quand il demande d'attendre (réponse 429), le message repart au délai indiqué, sans être abandonné. Discord n'a pas de protection contre les doublons : dans de rares cas de réponse perdue, un message peut arriver deux fois.

## 1. Créer un webhook dans Discord

Sur ordinateur, dans le serveur privé SAYLESS (il faut le droit « Gérer les webhooks ») :

1. Survole le salon (par exemple #commandes) et clique sur la roue « Modifier le salon ».
2. Choisis **Intégrations**, puis **Webhooks**, puis **Nouveau webhook**.
3. Nomme-le `SAYLESS STUDIO` et vérifie que le salon affiché est le bon.
4. Clique sur **Copier l'URL du webhook**. Elle commence par `https://discord.com/api/webhooks/`.
5. Clique sur **Enregistrer les modifications**.

Cette adresse est un secret : quiconque la connaît peut écrire dans le salon. Ne la colle jamais dans un chat, un e-mail, GitHub ou un document. Colle-la seulement dans l'invite masquée de l'étape 2.

En cas de fuite : retourne dans **Intégrations** > **Webhooks**, supprime le webhook, crée-en un nouveau et refais l'étape 2.

## 2. L'enregistrer dans Cloudflare TEST (PowerShell)

Depuis le dossier du projet, une commande par salon. L'assistant demande la valeur dans une invite masquée et l'envoie directement à Cloudflare, sans l'afficher.

```powershell
node scripts/test-env.mjs secret DISCORD_WEBHOOK_COMMANDES
if ($LASTEXITCODE -ne 0) { throw 'Webhook commandes non enregistré' }
```

Remplace `COMMANDES` par `EXPEDITIONS`, `RETOURS`, `STOCK`, `FINANCES`, `RAPPORT`, `ALERTES`, `SECURITE`, `SITE` ou `SAUVEGARDES` pour les autres salons. Pour un seul salon commun : `node scripts/test-env.mjs secret DISCORD_WEBHOOK_URL`.

Une adresse qui ne commence pas par `https://discord.com/api/webhooks/` ou `https://discordapp.com/api/webhooks/` est ignorée par le serveur.

## 3. Vérifier

1. `node scripts/test-env.mjs etat` doit finir par « Environnement de TEST opérationnel ».
2. Dans STUDIO, ouvre **Plus** > **Santé du site**. La ligne « Notifications Discord » liste les salons dédiés, ceux qui passent par le webhook unique et ceux sans destination. Aucune adresse n'y figure.
3. Premier message automatique : le rapport de 10 h arrive dans #rapport-quotidien (ou dans le salon commun). Rien d'autre à faire, et les paiements de TEST restent fermés.

Pour essayer un webhook tout de suite, sans écrire son adresse dans une commande ni l'enregistrer : PowerShell demande l'adresse en masquant la saisie, poste un message d'essai, puis l'oublie.

```powershell
$CacheSayless = Read-Host 'Colle l’adresse du webhook (masquée, non enregistrée)' -AsSecureString
$AdresseSayless = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($CacheSayless))
$CorpsSayless = [Text.Encoding]::UTF8.GetBytes('{"content":"Essai SAYLESS STUDIO : ce salon est bien relié.","allowed_mentions":{"parse":[]}}')
Invoke-RestMethod -Method Post -Uri $AdresseSayless -ContentType 'application/json; charset=utf-8' -Body $CorpsSayless
Remove-Variable CacheSayless, AdresseSayless, CorpsSayless
```

Le message « Essai SAYLESS STUDIO » doit apparaître dans le salon choisi. Une erreur 404 signale une adresse fausse ou un webhook supprimé : recrée-le (étape 1).

## Vérifié par les tests

Le test T06 (`tests/backend/automations.test.mjs`) vérifie :

- le bon salon pour chaque événement, avec le vrai code d'envoi ;
- le webhook unique utilisé en secours ;
- une adresse hors Discord ignorée ;
- le délai Retry-After respecté sans abandon ;
- un salon en panne sans effet sur les autres ;
- aucune mention possible ;
- aucun nom, e-mail, téléphone ou adresse de client dans un message, même quand le client écrit son adresse dans sa demande.

**Pas encore vérifié** : l'envoi vers les vrais salons Discord, à faire dans l'environnement de TEST après ton accord.
