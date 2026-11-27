// Configuration publique de recette. Aucun accès distant, aucune clé secrète, aucun déploiement.
export function testStorefrontConfig(env) {
  const origin = env.SAYLESS_TEST_ORIGIN;
  if (origin !== 'https://sayless-boutique-test.pages.dev') throw new Error('SAYLESS_TEST_ORIGIN doit désigner le projet Pages de test séparé.');
  const siteKey = env.SAYLESS_TEST_TURNSTILE_SITE_KEY || '';
  if (siteKey && !/^[A-Za-z0-9_-]{10,100}$/.test(siteKey)) throw new Error('Clé publique Turnstile invalide.');
  const enabled = env.SAYLESS_TEST_CHECKOUT === 'enabled';
  if (enabled && !siteKey) throw new Error('Clé publique Turnstile requise. Les CGV seront vérifiées auprès du serveur.');
  return `/* Configuration publique limitée à l’origine de recette. */\nwindow.SaylessConfig = Object.freeze({ checkoutEnabled: ${enabled} && location.origin === ${JSON.stringify(origin)}, turnstileSiteKey: ${JSON.stringify(siteKey)} });\n`;
}
