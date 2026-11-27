/* Configuration publique non sensible. Aucun secret ni activation implicite par URL/localStorage.
 * Claude renseignera la clé PUBLIQUE Turnstile en préproduction.
 * Passer checkoutEnabled à true nécessite l'accord du fondateur et une recette Stripe TEST.
 * Le serveur conserve ses propres verrous, prix, inventaire, règles de destination et idempotence. */
window.SaylessConfig = Object.freeze({ checkoutEnabled: false, turnstileSiteKey: '' });
