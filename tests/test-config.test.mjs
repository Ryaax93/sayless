import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { testStorefrontConfig } from '../scripts/test-storefront-config.mjs';
test('configuration de recette : origine séparée obligatoire et paiements fermés par défaut', () => {
  for (const origin of [undefined, 'https://saylessbrand.fr', 'https://example.invalid']) assert.throws(() => testStorefrontConfig({ SAYLESS_TEST_ORIGIN: origin }));
  const config = testStorefrontConfig({ SAYLESS_TEST_ORIGIN: 'https://sayless-boutique-test.pages.dev' });
  const c = { window: {}, location: { origin: 'https://sayless-boutique-test.pages.dev' } }; vm.runInNewContext(config, c); assert.equal(c.window.SaylessConfig.checkoutEnabled, false);
});
test('configuration de recette : aucun secret recopié et activation impossible sur une autre origine', () => {
  const env = { SAYLESS_TEST_ORIGIN: 'https://sayless-boutique-test.pages.dev', SAYLESS_TEST_TERMS_VERSION: 'test-only', SAYLESS_TEST_TURNSTILE_SITE_KEY: '1x00000000000000000000AA', SAYLESS_TEST_CHECKOUT: 'enabled', STRIPE_SECRET_KEY: 'must-never-appear' };
  const script = testStorefrontConfig(env); assert.ok(!script.includes(env.STRIPE_SECRET_KEY));
  for (const origin of ['https://sayless-boutique-test.pages.dev', 'https://saylessbrand.fr']) { const c = { window: {}, location: { origin } }; vm.runInNewContext(script, c); assert.equal(c.window.SaylessConfig.checkoutEnabled, origin === env.SAYLESS_TEST_ORIGIN); }
});
