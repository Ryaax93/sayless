// API de SAYLESS STUDIO (/api/admin/*) : connexion par passkey, sessions révocables, codes de
// secours, confirmation Face ID pour les actions sensibles, inventaire guidé.
// Règles : cookie __Host- (Secure, HttpOnly, SameSite=Strict) ; écritures limitées à l'origine
// STUDIO avec l'en-tête X-Studio-Request ; tout refus et toute action sensible sont journalisés.
import { audit, b64url, batch, fail, getSettings, hmacB64, json, one, all, randomCode, sha256Hex, sql, timingSafeEqual, uuid, errorResponse } from './lib.mjs';
import { clientHash, readJson } from './security.mjs';
import { newChallenge, verifyAssertion, verifyRegistration, WebAuthnError } from './webauthn.mjs';
import { inventorySnapshot, recordInventory } from './stock.mjs';

const COOKIE = '__Host-sl_studio';
const SESSION_TTL = 7 * 86400;
const IDLE = 12 * 3600;
const STEPUP = 300;
const CHALLENGE_TTL = 300;

const studioConfig = (env, request) => {
  const origin = env.STUDIO_ORIGIN ?? new URL(request.url).origin;
  return { origin, rpId: env.STUDIO_RP_ID ?? new URL(origin).hostname };
};
const tokenHash = (env, token) => hmacB64(env.APP_SECRET, `session:${token}`);
const codeHash = (env, code) => hmacB64(env.APP_SECRET, `recovery:${code.replace(/[^0-9A-Z]/gi, '').toUpperCase()}`);
const cookieOf = (request) => (request.headers.get('Cookie') ?? '').split(';').map((c) => c.trim())
  .find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? null;
const setCookie = (token, maxAge) => `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;

function guardWrite(request, config) {
  if (request.headers.get('Origin') !== config.origin) throw fail('invalid_origin');
  if (request.headers.get('X-Studio-Request') !== '1') throw fail('invalid_origin');
}

async function currentSession(env, request, now) {
  const token = cookieOf(request);
  if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const hash = await tokenHash(env, token);
  const row = await one(env.db, 'SELECT * FROM auth_sessions WHERE token_hash = ?', hash);
  if (!row || row.revoked_at || now >= row.expires_at || now - row.last_seen_at > IDLE) return null;
  if (now - row.last_seen_at > 60) {
    await batch(env.db, [sql(env.db, 'UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?', now, hash)]);
  }
  return { ...row, hash };
}

async function openSession(env, passkeyId, now) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const hash = await tokenHash(env, token);
  await batch(env.db, [sql(env.db, `INSERT INTO auth_sessions (token_hash, passkey_id, created_at, last_seen_at, expires_at, stepup_at)
    VALUES (?, ?, ?, ?, ?, ?)`, hash, passkeyId, now, now, now + SESSION_TTL, now)]);
  return setCookie(token, SESSION_TTL);
}

async function issueChallenge(env, purpose, now, sessionHash = null) {
  const id = uuid();
  const challenge = newChallenge();
  await batch(env.db, [sql(env.db, `INSERT INTO auth_challenges (id, purpose, challenge, session_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
    id, purpose, challenge, sessionHash, now), sql(env.db, 'DELETE FROM auth_challenges WHERE created_at < ?', now - 3600)]);
  return { id, challenge };
}

// Défi consommé une seule fois, même en cas d'échec de la vérification qui suit.
async function consumeChallenge(env, id, purpose, now, sessionHash = null) {
  if (typeof id !== 'string') throw fail('invalid_request');
  const res = await batch(env.db, [sql(env.db, `UPDATE auth_challenges SET used_at = ? WHERE id = ? AND purpose = ? AND used_at IS NULL
    AND created_at > ? AND (session_hash IS ? OR session_hash = ?)`, now, id, purpose, now - CHALLENGE_TTL, sessionHash, sessionHash)]);
  if (!res[0].meta.changes) throw fail('challenge_expired');
  return (await one(env.db, 'SELECT challenge FROM auth_challenges WHERE id = ?', id)).challenge;
}

async function registrationOptions(env, config, now) {
  const settings = await getSettings(env.db);
  let handle = settings.studio_user_handle;
  if (!handle) {
    handle = b64url(crypto.getRandomValues(new Uint8Array(16)));
    await batch(env.db, [sql(env.db, `UPDATE settings SET value = ? WHERE key = 'studio_user_handle' AND value = ''`, handle)]);
    handle = (await getSettings(env.db)).studio_user_handle;
  }
  const existing = await all(env.db, 'SELECT id FROM passkeys');
  const { id, challenge } = await issueChallenge(env, 'register', now);
  return { challenge_id: id, publicKey: { challenge, rp: { id: config.rpId, name: 'SAYLESS STUDIO' },
    user: { id: handle, name: 'fondateur', displayName: 'Fondateur SAYLESS' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], timeout: 60000, attestation: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: existing.map((p) => ({ type: 'public-key', id: p.id })) } };
}

const studioHeaders = (cookie) => (cookie ? { 'Set-Cookie': cookie } : {});

export async function handleAdmin(request, env, deps) {
  const ctx = { ...env, db: env.DB };
  const now = deps.now();
  const config = studioConfig(env, request);
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname.replace(/\/+$/, '')}`;
  const ip = request.headers.get('CF-Connecting-IP') ?? '';
  try {
    if (!env.APP_SECRET) throw fail('not_configured');
    if (request.method !== 'GET') guardWrite(request, config);
    const client = await clientHash(env, ip, now);
    const session = await currentSession(ctx, request, now);
    const enrolled = Boolean((await one(ctx.db, 'SELECT COUNT(*) AS n FROM passkeys')).n);
    const settings = await getSettings(ctx.db);
    const enrollmentOpen = Number(settings.studio_enrollment_open_until || 0) > now;
    const requireSession = () => { if (!session) throw fail('unauthenticated'); };
    const requireStepUp = () => { requireSession(); if (!session.stepup_at || now - session.stepup_at > STEPUP) throw fail('stepup_required'); };

    switch (route) {
      case 'GET /api/admin/state':
        return json({ enrolled, authenticated: Boolean(session), enrollment_open: enrollmentOpen,
          stepup_valid_until: session?.stepup_at ? session.stepup_at + STEPUP : null });

      // ---- première inscription (code d'installation saisi par le fondateur dans Cloudflare) ----
      case 'POST /api/admin/setup/options': {
        const body = await readJson(request);
        await deps.rateLimit(`studio-setup:${client}`, 5, 600);
        // Première inscription seulement. Après un code de secours, le défi d'inscription est remis
        // par /recover à l'appareil qui a saisi le code : personne d'autre ne peut s'inscrire.
        if (enrolled || settings.studio_setup_used_at) throw fail('already_enrolled');
        if (!env.ADMIN_SETUP_CODE || typeof body.setup_code !== 'string' || !timingSafeEqual(body.setup_code.trim(), env.ADMIN_SETUP_CODE)) {
          await batch(ctx.db, [audit(ctx.db, now, 'inconnu', 'session_failed', 'setup', 'bad_setup_code')]);
          throw fail('invalid_setup_code');
        }
        return json(await registrationOptions(ctx, config, now));
      }
      case 'POST /api/admin/setup/verify': {
        const body = await readJson(request, 32768);
        if (!enrollmentOpen && (enrolled || settings.studio_setup_used_at)) throw fail('already_enrolled');
        const challenge = await consumeChallenge(ctx, body.challenge_id, 'register', now);
        const cred = await verifyRegistration({ response: body.credential, expectedChallenge: challenge, origin: config.origin, rpId: config.rpId });
        const codes = Array.from({ length: 10 }, () => `${randomCode(4)}-${randomCode(4)}`);
        const batchId = uuid();
        const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 40) : 'Appareil principal';
        await batch(ctx.db, [
          // Après un code de secours, le nouvel appareil remplace les anciens (perdus ou compromis).
          ...(enrollmentOpen ? [sql(ctx.db, 'DELETE FROM passkeys')] : []),
          sql(ctx.db, `INSERT INTO passkeys (id, public_key, alg, sign_count, backed_up, transports, label, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, cred.credentialId, cred.publicKey, cred.alg, cred.signCount, cred.backedUp ? 1 : 0,
          cred.transports, label, now),
          sql(ctx.db, `UPDATE settings SET value = ? WHERE key = 'studio_setup_used_at'`, String(now)),
          sql(ctx.db, `UPDATE settings SET value = '0' WHERE key = 'studio_enrollment_open_until'`),
          sql(ctx.db, 'DELETE FROM recovery_codes'),
          ...(await Promise.all(codes.map(async (c) => sql(ctx.db, 'INSERT INTO recovery_codes (code_hash, batch, created_at) VALUES (?, ?, ?)',
            await codeHash(env, c), batchId, now)))),
          audit(ctx.db, now, 'fondateur', 'passkey_added', label, 'ok'),
        ]);
        await deps.notify({ kind: 'studio_passkey_added', ref: cred.credentialId.slice(0, 24), level: 'warning',
          title: 'Nouvel appareil autorisé dans STUDIO', body: `« ${label} » peut maintenant se connecter. Si ce n’est pas toi, utilise un code de secours.` });
        return json({ recovery_codes: codes }, 200, studioHeaders(await openSession(ctx, cred.credentialId, now)));
      }

      // ---- connexion ----
      case 'POST /api/admin/login/options': {
        await readJson(request);
        await deps.rateLimit(`studio-login:${client}`, 20, 600);
        if (!enrolled) throw fail('not_enrolled');
        const { id, challenge } = await issueChallenge(ctx, 'login', now);
        return json({ challenge_id: id, publicKey: { challenge, rpId: config.rpId, timeout: 60000, userVerification: 'required', allowCredentials: [] } });
      }
      case 'POST /api/admin/login/verify':
      case 'POST /api/admin/stepup/verify': {
        const body = await readJson(request, 32768);
        const stepup = route.endsWith('stepup/verify');
        if (stepup) requireSession();
        const challenge = await consumeChallenge(ctx, body.challenge_id, stepup ? 'stepup' : 'login', now, stepup ? session.hash : null);
        const credential = await one(ctx.db, 'SELECT * FROM passkeys WHERE id = ?', body.credential?.id ?? '');
        if (!credential) {
          await batch(ctx.db, [audit(ctx.db, now, 'inconnu', 'session_failed', 'login', 'unknown_credential')]);
          throw fail('unknown_credential');
        }
        const result = await verifyAssertion({ response: body.credential, expectedChallenge: challenge, origin: config.origin, rpId: config.rpId, credential });
        if (!result.ok) {
          await batch(ctx.db, [audit(ctx.db, now, 'inconnu', 'session_failed', credential.label, 'counter_regressed')]);
          await deps.notify({ kind: 'studio_counter_regressed', ref: `${credential.id.slice(0, 24)}:${result.signCount}`, level: 'critical',
            title: 'Connexion STUDIO refusée', body: 'Le compteur de la passkey a reculé : possible copie de la clé. Vérifie tes appareils.' });
          throw fail('passkey_rejected');
        }
        const statements = [sql(ctx.db, 'UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE id = ?', result.signCount, now, credential.id)];
        if (stepup) {
          statements.push(sql(ctx.db, 'UPDATE auth_sessions SET stepup_at = ? WHERE token_hash = ?', now, session.hash));
          statements.push(audit(ctx.db, now, 'fondateur', 'stepup', credential.label, 'ok'));
          await batch(ctx.db, statements);
          return json({ stepup_valid_until: now + STEPUP });
        }
        statements.push(audit(ctx.db, now, 'fondateur', 'session_login', credential.label, 'ok'));
        await batch(ctx.db, statements);
        return json({ authenticated: true }, 200, studioHeaders(await openSession(ctx, credential.id, now)));
      }
      case 'POST /api/admin/stepup/options': {
        await readJson(request);
        requireSession();
        const { id, challenge } = await issueChallenge(ctx, 'stepup', now, session.hash);
        return json({ challenge_id: id, publicKey: { challenge, rpId: config.rpId, timeout: 60000, userVerification: 'required',
          allowCredentials: (await all(ctx.db, 'SELECT id FROM passkeys')).map((p) => ({ type: 'public-key', id: p.id })) } });
      }

      // ---- code de secours : une fois, déconnecte tout, rouvre l'inscription 15 minutes ----
      case 'POST /api/admin/recover': {
        const body = await readJson(request);
        await deps.rateLimit(`studio-recover:${client}`, 5, 600);
        if (typeof body.code !== 'string' || body.code.length > 20) throw fail('invalid_request');
        const used = await batch(ctx.db, [sql(ctx.db, 'UPDATE recovery_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL',
          now, await codeHash(env, body.code))]);
        if (!used[0].meta.changes) {
          await batch(ctx.db, [audit(ctx.db, now, 'inconnu', 'session_failed', 'recovery', 'bad_code')]);
          throw fail('invalid_recovery_code');
        }
        await batch(ctx.db, [
          sql(ctx.db, 'UPDATE auth_sessions SET revoked_at = ? WHERE revoked_at IS NULL', now),
          sql(ctx.db, `UPDATE settings SET value = ? WHERE key = 'studio_enrollment_open_until'`, String(now + 900)),
          audit(ctx.db, now, 'fondateur', 'recovery_code_used', null, 'sessions_revoked'),
        ]);
        await deps.notify({ kind: 'studio_recovery_used', ref: String(now), level: 'critical', title: 'Code de secours utilisé',
          body: 'Toutes les sessions STUDIO ont été fermées. Un nouvel appareil peut être autorisé pendant 15 minutes.' });
        return json({ enrollment_open_until: now + 900, ...(await registrationOptions(ctx, config, now)) });
      }
      case 'POST /api/admin/logout': {
        await readJson(request);
        if (session) await batch(ctx.db, [sql(ctx.db, 'UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?', now, session.hash)]);
        return json({ authenticated: false }, 200, { 'Set-Cookie': setCookie('', 0) });
      }
      case 'POST /api/admin/sessions/revoke-all': {
        await readJson(request);
        requireStepUp();
        await batch(ctx.db, [sql(ctx.db, 'UPDATE auth_sessions SET revoked_at = ? WHERE revoked_at IS NULL', now),
          audit(ctx.db, now, 'fondateur', 'sessions_revoked', null, 'ok')]);
        return json({ authenticated: false }, 200, { 'Set-Cookie': setCookie('', 0) });
      }

      // ---- inventaire guidé ----
      case 'GET /api/admin/inventory':
        requireSession();
        return json(await inventoryView(ctx));
      case 'POST /api/admin/inventory': {
        const body = await readJson(request);
        requireStepUp();
        const counts = body.counts ?? {};
        const aside = body.set_aside ?? {};
        for (const v of [...Object.values(counts), aside.unshipped ?? 0, aside.promised ?? 0, aside.damaged ?? 0]) {
          if (!Number.isSafeInteger(v) || v < 0 || v > 10000) throw fail('invalid_request');
        }
        const counted = Object.values(counts).reduce((n, v) => n + v, 0);
        const reference = 26;
        const gap = counted + (aside.promised ?? 0) + (aside.damaged ?? 0) - reference;
        const note = `Inventaire guidé : à vendre ${counted} ; payées non expédiées ${aside.unshipped ?? 0} ; promises ${aside.promised ?? 0} ; abîmées ${aside.damaged ?? 0} ; écart avec ${reference} théoriques ${gap >= 0 ? '+' : ''}${gap}.`;
        await recordInventory(ctx.db, { counts, expected: body.expected ?? {}, actor: 'fondateur', note, now });
        return json({ ...(await inventoryView(ctx)), gap, stripe_limit_proposal: 2 + counted });
      }
      default:
        return json({ error: 'not_found' }, 404);
    }
  } catch (error) {
    if (error instanceof WebAuthnError) {
      await batch(ctx.db, [audit(ctx.db, now, 'inconnu', 'session_failed', 'webauthn', error.reason)]).catch(() => {});
      return json({ error: 'passkey_rejected' }, 403);
    }
    return errorResponse(error);
  }
}

async function inventoryView(ctx) {
  const rows = await inventorySnapshot(ctx.db);
  const settings = await getSettings(ctx.db);
  return { variants: rows.map((r) => ({ sku: r.sku, size: r.size, on_hand: r.on_hand, reserved: r.reserved, available: r.available,
    confirmed: r.confirmed_at !== null, revision: r.revision })), reference_total: 26, low_stock_threshold: Number(settings.low_stock_threshold || 2) };
}

export const _test = { tokenHash, codeHash, COOKIE, sha256Hex };
