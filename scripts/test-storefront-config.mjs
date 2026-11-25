// Configuration publique de recette. Aucun accès distant, aucune clé secrète, aucun déploiement.
export function testStorefrontConfig(env) {
  const origin = env.SAYLESS_TEST_ORIGIN;
  if (origin !== 'https://sayless-boutique-test.pages.dev') throw new Error('SAYLESS_TEST_ORIGIN doit désigner le projet Pages de test séparé.');
  const termsVersion = env.SAYLESS_TEST_TERMS_VERSION || '';
  const siteKey = env.SAYLESS_TEST_TURNSTILE_SITE_KEY || '';
  if (termsVersion && !/^[A-Za-z0-9._-]{1,40}$/.test(termsVersion)) throw new Error('Version de CGV de test invalide.');
  if (siteKey && !/^[A-Za-z0-9_-]{10,100}$/.test(siteKey)) throw new Error('Clé publique Turnstile invalide.');
  const enabled = env.SAYLESS_TEST_CHECKOUT === 'enabled';
  if (enabled && (!termsVersion || !siteKey)) throw new Error('CGV de test et clé publique Turnstile requises.');
  return `/* Configuration publique limitée à l’origine de recette. */\nwindow.SaylessConfig = Object.freeze({ checkoutEnabled: ${enabled} && location.origin === ${JSON.stringify(origin)}, termsVersion: ${JSON.stringify(termsVersion)}, turnstileSiteKey: ${JSON.stringify(siteKey)} });\n`;
}
