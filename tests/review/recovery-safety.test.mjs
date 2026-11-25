import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabases, stopDatabases } from '../backend/helpers.mjs';
import { studio } from '../backend/studio-helpers.mjs';
before(startDatabases); after(stopDatabases);
test('contre-revue Work : récupération ferme toute ancienne session et annule ses défis avant réinscription', async () => {
  const b = await studio();
  const { auth, res } = await b.enroll(); const cookie = b.cookie();
  const challenge = await b.call('POST', '/api/admin/login/options', {}, { cookie: '' });
  b.forget();
  assert.equal((await b.call('POST', '/api/admin/recover', { code: res.body.recovery_codes[0] })).status, 200);
  assert.equal((await b.call('GET', '/api/admin/inventory', undefined, { cookie })).status, 401);
  const late = await b.call('POST', '/api/admin/login/verify', { challenge_id: challenge.body.challenge_id, credential: await auth.get(challenge.body.publicKey) }, { cookie: '' });
  assert.equal(late.body.error, 'challenge_expired');
  assert.equal(await b.count('SELECT COUNT(*) FROM passkeys WHERE revoked_at IS NULL'), 0);
  assert.equal(await b.count('SELECT COUNT(*) FROM auth_sessions WHERE revoked_at IS NULL'), 0);
});
