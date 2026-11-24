# SAYLESS STUDIO (Claude)

Application de gestion du fondateur, construite à partir de la maquette validée le 24 novembre 2026. La direction artistique est conservée : fond noir, rose pastel, étiquettes de taille tissées, compteurs larges. Seules les couleurs et les polices sont harmonisées avec `docs/DESIGN-SYSTEM.md` (SaylessDisplay, SaylessSans, logo officiel).

## Ce qui fonctionne (version 1)

| Écran | État réel |
| --- | --- |
| Connexion Face ID (passkey) | Branchée : inscription avec un code d’installation, connexion, refus journalisés |
| Codes de secours | 10 codes affichés une seule fois ; un code ferme toutes les sessions et remplace l’ancien appareil |
| Inventaire guidé | Branché : comptage S/M/L, mises de côté, écart avec les 26 théoriques, confirmation Face ID, limite Stripe proposée sans l’appliquer |
| Sécurité | Déconnexion, fermeture de toutes les sessions avec confirmation Face ID |

Les autres écrans de la maquette (commandes, stock, finances, notifications, drops, performances, santé, réglages, bureau) ne sont pas encore proposés : aucun bouton n’apparaît tant que l’écran n’est pas branché.

## Sécurité

- Passkey WebAuthn vérifiée côté serveur (`backend/src/webauthn.mjs`) : défi à usage unique de 5 minutes, origine et domaine exacts, Face ID exigé, signature, compteur qui ne recule jamais.
- Session : cookie `__Host-` (Secure, HttpOnly, SameSite=Strict), 7 jours maximum, 12 heures d’inactivité, révocable. Empreintes seulement en base.
- Actions sensibles (inventaire, fermeture des sessions) : nouvelle confirmation Face ID si la dernière date de plus de 5 minutes.
- Écritures acceptées seulement depuis l’origine STUDIO avec l’en-tête `X-Studio-Request`. CSP stricte, sans script ni style en ligne (`studio/_headers`).

## Construire et essayer

```bash
npm run build:studio      # dist-studio/ : fichiers de studio/ + polices et logo officiels
npm run test:backend      # dont tests/backend/studio.test.mjs (authentificateur logiciel)
```

Configuration dans Cloudflare, saisie par le fondateur, jamais dans le chat :

- `ADMIN_SETUP_CODE` : code d’installation à usage unique ;
- `STUDIO_ORIGIN`, par exemple `https://studio.saylessbrand.fr` ;
- `STUDIO_RP_ID`, par exemple `studio.saylessbrand.fr`.

Les passkeys sont liées au domaine : celles de l’environnement de test ne servent pas en production.

## État réel

Testé : D1 locale et moteur Cloudflare local. Un parcours complet a été fait dans Chrome, en HTTPS, avec un authentificateur Face ID virtuel : inscription, codes de secours, accueil, inventaire guidé, déconnexion puis reconnexion.

Non testé : Face ID sur un vrai iPhone et domaine réel. L’essai sur iPhone fait partie de la recette.
