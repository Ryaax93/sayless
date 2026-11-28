# Preuves de recette locale — API v1.4

Captures et essais réalisés le 26 novembre 2026 ; livraison finalisée le 27. **Aucune capture ne provient de Cloudflare TEST hébergé.** Serveur de recette local, D1 éphémère, paiements interdits. Les 3 unités visibles sont des fixtures (S2/M1/L0), pas le stock SAYLESS. L'accès STUDIO des captures est simulé pour contrôler le rendu ; il ne prouve ni passkey ni Face ID réel. Le statut « Boutique ouverte » appartient aussi à cette fixture ; aucun checkout de ce serveur ne réserve ou encaisse.

## Visuels

| Vue | Capture |
| --- | --- |
| Fiche ordinateur, viewport environ 1363 px | [desktop.jpg](desktop.jpg) |
| Fiche mobile, cadre 390 px | [mobile.jpg](mobile.jpg) |
| Récapitulatif et CGV mobile, focus visible | [mobile-cgv.jpg](mobile-cgv.jpg) |
| Document CGV exact en pleine page | [cgv-desktop.jpg](cgv-desktop.jpg) |
| STUDIO ordinateur | [studio-desktop.jpg](studio-desktop.jpg) |
| STUDIO mobile, cadre 390 px à gauche | [studio-mobile-large.jpg](studio-mobile-large.jpg) |

Le cadre mobile a une hauteur de 1300 px ; il s'agit d'une vérification responsive dans Chrome, pas d'une capture d'iPhone. Certaines captures sont des portions visibles de la page ; elles n'attestent pas seules tout le parcours.

Contrôles effectués : sélection M, panier plafonné à une pièce, activation au clavier, destination Corse refusée, devis domicile 83,50 €, focus sur le récapitulatif, document brut de recette marqué non contractuel, mise en forme `pre-wrap`, région CGV accessible au clavier, aucun débordement horizontal dans cette zone ni dans STUDIO mobile. Bouton Stripe désactivé. Barre rose : vrais logos, animation active, pause et reprise vérifiées. Aucun post-it.

La préférence reduced-motion est conservée dans le code. VoiceOver, Safari, PWA et Face ID réels restent à tester sur iPhone. Les captures du 26 précèdent uniquement le verrouillage final de la case CGV durant l'envoi ; cette correction ne change pas les états visuels capturés.

## Résultats et audits

- [Suite complète](tests-suite-complete.txt) : 211 tests Node + 13 vérifications commerciales réussis. Une interruption a coupé la première invocation d'inventaire avant ses résultats ; elle a été relancée intégralement et n'est comptée qu'une fois.
- [Frontend final](frontend-final.txt) et [intégration finale](integration-final.txt) : rejoués après le dernier contrôle de consentement et le renforcement de la configuration Pages.
- [Risque Resend](risque-resend.txt) : un échec connu distinct, 2 envois simulés au lieu de 1. **La recette complète n'est donc pas déclarée entièrement verte.**
- [Compilation Cloudflare](compilation-cloudflare.txt) : STUDIO, Worker `--dry-run --env test` et Pages Functions. [Build statique](compilation-boutique.txt), [build TEST](compilation-boutique-test.txt).
- Audits complets [avant](audit-before.json) / [après](audit-after.json) : **27 → 0**. Audits `--omit=dev` [avant](audit-prod-before.json) / [après](audit-prod-after.json) : **5 → 0**.
- Essais exploratoires séparés [SimpleWebAuthn différentiel](webauthn-differentiel.txt) et [workerd sans nodejs_compat](webauthn-workerd.txt). Aucun changement d'authentification déployé.

Journaux nettoyés des chemins absolus du poste et séquences couleur. Aucune donnée réelle de client, aucun secret ni rapport privé du fondateur.

[Contre-audit et limites](../../REVUE-V1-4-WORK.md) · [Procédure reproductible PowerShell](../../POWERSHELL-TEST-V1-4.md).
