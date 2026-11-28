// API de SAYLESS STUDIO (/api/admin/*) : connexion par passkey, sessions révocables, codes de
// secours, confirmation Face ID pour les actions sensibles, puis routes métier (studio.mjs).
// Règles : cookie __Host- (Secure, HttpOnly, SameSite=Strict) ; écritures limitées à l'origine
// STUDIO avec l'en-tête X-Studio-Request ; tout refus et toute action sensible sont journalisés.
//
// Générations : chaque code de secours ouvre une nouvelle génération (déclencheur
// studio_recovery_used, dans la même instruction que la consommation du code). Les passkeys, les
// sessions et les défis de la génération précédente sont alors invalidés. Une session n'est
// acceptée que si sa passkey est active et appartient à la génération courante : vérifié à
// chaque requête, et garanti par la base au moment de sa création (studio_session_admission).
import { audit, b64url, batch, fail, getSettings, hmacB64, json, one, all, normalizeCode, randomCode, sha256Hex, sql, timingSafeEqual, uuid, errorResponse } from './lib.mjs';
import { clientHash, readJson } from './security.mjs';
import { LIBRARY_ENGINE, newChallenge, verifyAssertion, verifyRegistration, WebAuthnError } from './webauthn.mjs';
import { handleStudio } from './studio.mjs';

const COOKIE = '__Host-sl_studio';
const RECOVERY_COOKIE = '__Host-sl_recovery';
const SESSION_TTL = 7 * 86400;
const IDLE = 12 * 3600;
const STEPUP = 300;
const CHALLENGE_TTL = 300;
const RECOVERY_WINDOW = 900;

// Origine et identifiant de domaine (RP ID) figés par environnement : jamais déduits de la requête
// en production ou en recette hébergée. Le repli sur l'URL ne sert qu'au poste local et aux tests.
export function studioConfig(env, request) {
  if (!env.STUDIO_ORIGIN && ['production', 'staging'].includes(env.ENVIRONMENT)) throw fail('not_configured');
  const origin = env.STUDIO_ORIGIN ?? new URL(request.url).origin;
  // Vérification Face ID par la bibliothèque en plus de celle de SAYLESS : seulement si
  // WEBAUTHN_ENGINE = simplewebauthn, réglage posé après la validation du fondateur.
  return { origin, rpId: env.STUDIO_RP_ID ?? new URL(origin).hostname, webauthnEngine: env.WEBAUTHN_ENGINE === LIBRARY_ENGINE ? LIBRARY_ENGINE : null };
}
const tokenHash = (env, token) => hmacB64(env.APP_SECRET, `session:${token}`);
const recoveryHashOf = (env, token) => hmacB64(env.APP_SECRET, `recovery-device:${token}`);
const codeHash = (env, code) => hmacB64(env.APP_SECRET, `recovery:${normalizeCode(code)}`);
const cookieOf = (request, name) => (request.headers.get('Cookie') ?? '').split(';').map((c) => c.trim())
  .find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
const setCookie = (name, token, maxAge) => `${name}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
const validToken = (token) => typeof token === 'string' && /^[A-Za-z0-9_-]{40,60}$/.test(token);
const CURRENT_GENERATION = `CAST((SELECT value FROM settings WHERE key = 'studio_generation') AS INTEGER)`;

function guardWrite(request, config) {
  if (request.headers.get('Origin') !== config.origin) throw fail('invalid_origin');
  if (request.headers.get('X-Studio-Request') !== '1') throw fail('invalid_origin');
}

async function currentSession(env, request, now) {
  const token = cookieOf(request, COOKIE);
  if (!validToken(token)) return null;
  const hash = await tokenHash(env, token);
  const row = await one(env.db, `SELECT s.*, p.label AS passkey_label FROM auth_sessions s JOIN passkeys p ON p.id = s.passkey_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND p.revoked_at IS NULL AND p.generation = s.generation
      AND s.generation = ${CURRENT_GENERATION}`, hash);
  if (!row || now >= row.expires_at || now - row.last_seen_at > IDLE) return null;
  if (now - row.last_seen_at > 60) {
    await batch(env.db, [sql(env.db, 'UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ? AND revoked_at IS NULL', now, hash)]);
  }
  return { ...row, hash };
}

// Instruction de création de session, à placer dans le lot qui valide la passkey : la base refuse
// une passkey retirée ou d'une autre génération, même en cas de requêtes concurrentes.
async function sessionStatement(env, passkeyId, generation, now) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const hash = await tokenHash(env, token);
  return {
    statement: sql(env.db, `INSERT INTO auth_sessions (token_hash, passkey_id, generation, created_at, last_seen_at, expires_at, stepup_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, hash, passkeyId, generation, now, now, now + SESSION_TTL, now),
    cookie: setCookie(COOKIE, token, SESSION_TTL),
  };
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
  if (typeof id !== 'string' || id.length > 64) throw fail('invalid_request');
  const res = await batch(env.db, [sql(env.db, `UPDATE auth_challenges SET used_at = ? WHERE id = ? AND purpose = ? AND used_at IS NULL
    AND created_at > ? AND (session_hash IS ? OR session_hash = ?)`, now, id, purpose, now - CHALLENGE_TTL, sessionHash, sessionHash)]);
  if (!res[0].meta.changes) throw fail('challenge_expired');
  return (await one(env.db, 'SELECT challenge FROM auth_challenges WHERE id = ?', id)).challenge;
}

async function userHandle(env) {
  let handle = (await getSettings(env.db)).studio_user_handle;
  if (!handle) {
    handle = b64url(crypto.getRandomValues(new Uint8Array(16)));
    await batch(env.db, [sql(env.db, `UPDATE settings SET value = ? WHERE key = 'studio_user_handle' AND value = ''`, handle)]);
    handle = (await getSettings(env.db)).studio_user_handle;
  }
  return handle;
}

async function registrationOptions(env, config, now, bindTo = null) {
  const handle = await userHandle(env);
  const existing = await all(env.db, 'SELECT id FROM passkeys WHERE revoked_at IS NULL');
  const { id, challenge } = await issueChallenge(env, 'register', now, bindTo);
  return { challenge_id: id, publicKey: { challenge, rp: { id: config.rpId, name: 'SAYLESS STUDIO' },
    user: { id: handle, name: 'fondateur', displayName: 'Fondateur SAYLESS' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], timeout: 60000, attestation: 'none',
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    excludeCredentials: existing.map((p) => ({ type: 'public-key', id: p.id })) } };
}

export async function handleAdmin(request, env, deps) {
  const ctx = { ...env, db: env.DB };
  const now = deps.now();
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname.replace(/\/+$/, '')}`;
  const ip = request.headers.get('CF-Connecting-IP') ?? '';
  try {
    if (!env.APP_SECRET) throw fail('not_configured');
    const config = studioConfig(env, request);
    if (request.method !== 'GET') guardWrite(request, config);
    const client = await clientHash(env, ip, now);
    const session = await currentSession(ctx, request, now);
    const settings = await getSettings(ctx.db);
    const generation = Number(settings.studio_generation || 1);
    const enrolled = Boolean((await one(ctx.db, 'SELECT COUNT(*) AS n FROM passkeys WHERE revoked_at IS NULL')).n);
    const enrollmentOpen = Number(settings.studio_enrollment_open_until || 0) > now;
    const recoveryToken = cookieOf(request, RECOVERY_COOKIE);
    const recoveryHash = validToken(recoveryToken) ? await recoveryHashOf(env, recoveryToken) : null;
    // Appareil qui a saisi le code de secours, pendant la fenêtre et tant qu'aucune passkey n'est active.
    const recovering = enrollmentOpen && !enrolled && recoveryHash !== null && settings.studio_recovery_hash !== ''
      && timingSafeEqual(recoveryHash, settings.studio_recovery_hash);
    const requireSession = () => { if (!session) throw fail('unauthenticated'); };
    const requireStepUp = () => { requireSession(); if (!session.stepup_at || now - session.stepup_at > STEPUP) throw fail('stepup_required'); };

    switch (route) {
      case 'GET /api/admin/state':
        return json({ enrolled, authenticated: Boolean(session), enrollment_open: enrollmentOpen, recovering,
          stepup_valid_until: session?.stepup_at ? session.stepup_at + STEPUP : null });

      // ---- première inscription (code d'installation saisi par le fondateur dans Cloudflare) ----
      case 'POST /api/admin/setup/options': {
        const body = await readJson(request);
        await deps.rateLimit(`studio-setup:${client}`, 5, 600);
        // Première inscription seulement. Après un code de secours, le défi d'inscription est remis
        // par /recover à l'appareil qui a saisi le code : personne d'autre ne peut s'inscrire.
        if (enrolled || settings.studio_setup_used_at) throw fail('already_enrolled');
        // Code d'au moins 12 caractères utiles ; casse, espaces, tirets et O/0, I/L/1 tolérés à la saisie.
        const expected = normalizeCode(env.ADMIN_SETUP_CODE);
        if (expected.length < 12 || typeof body.setup_code !== 'string' || !timingSafeEqual(normalizeCode(body.setup_code), expected)) {
          await batch(ctx.db, [audit(ctx.db, now, 'inconnu', 'session_failed', 'setup', 'bad_setup_code')]);
          throw fail('invalid_setup_code');
        }
        return json(await registrationOptions(ctx, config, now));
      }
      case 'POST /api/admin/setup/verify': {
        const body = await readJson(request, 32768);
        if (enrollmentOpen ? !recovering : (enrolled || settings.studio_setup_used_at)) throw fail('already_enrolled');
        const challenge = await consumeChallenge(ctx, body.challenge_id, 'register', now, recovering ? recoveryHash : null);
        const cred = await verifyRegistration({ response: body.credential, expectedChallenge: challenge, origin: config.origin, rpId: config.rpId, engine: config.webauthnEngine });
        const codes = Array.from({ length: 10 }, () => `${randomCode(4)}-${randomCode(4)}`);
        const batchId = uuid();
        const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 40) : 'Appareil principal';
        const { statement, cookie } = await sessionStatement(ctx, cred.credentialId, generation, now);
        try {
          await batch(ctx.db, [
            // Aucune passkey active : première inscription, ou anciennes passkeys retirées par le code de secours.
            sql(ctx.db, `INSERT INTO assertions (code) SELECT 'already_enrolled' WHERE EXISTS (SELECT 1 FROM passkeys WHERE revoked_at IS NULL)`),
            sql(ctx.db, `INSERT INTO passkeys (id, public_key, alg, sign_count, backed_up, transports, label, created_at, generation)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, cred.credentialId, cred.publicKey, cred.alg, cred.signCount, cred.backedUp ? 1 : 0,
            cred.transports, label, now, generation),
            sql(ctx.db, `UPDATE settings SET value = ? WHERE key = 'studio_setup_used_at'`, String(now)),
            sql(ctx.db, `UPDATE settings SET value = '0' WHERE key = 'studio_enrollment_open_until'`),
            sql(ctx.db, `UPDATE settings SET value = '' WHERE key = 'studio_recovery_hash'`),
            sql(ctx.db, 'DELETE FROM recovery_codes'),
            ...(await Promise.all(codes.map(async (c) => sql(ctx.db, 'INSERT INTO recovery_codes (code_hash, batch, created_at) VALUES (?, ?, ?)',
              await codeHash(env, c), batchId, now)))),
            audit(ctx.db, now, 'fondateur', 'passkey_added', label, recovering ? 'after_recovery' : 'ok'),
            statement,
          ]);
        } catch (error) {
          // Génération changée entre-temps (autre code de secours) : défi périmé, rien n'est créé.
          if (['stale_generation', 'session_refused', 'assertion_failed'].includes(error.dbCode)) throw fail('challenge_expired');
          if (error.dbCode === 'unique_failed') throw fail('passkey_rejected');
          throw error;
        }
        await deps.notify({ kind: 'studio_passkey_added', ref: cred.credentialId.slice(0, 24), level: 'warning',
          title: 'Nouvel appareil autorisé dans STUDIO', body: `« ${label} » peut maintenant se connecter. Si ce n’est pas toi, utilise un code de secours.` });
        return json({ recovery_codes: codes }, 200, [['Set-Cookie', cookie], ['Set-Cookie', setCookie(RECOVERY_COOKIE, '', 0)]]);
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
        const credential = await one(ctx.db, 'SELECT * FROM passkeys WHERE id = ? AND revoked_at IS NULL AND generation = ?',
          String(body.credential?.id ?? '').slice(0, 1400), generation);
        if (!credential) {
          await batch(ctx.db, [audit(ctx.db, now, 'inconnu', 'session_failed', stepup ? 'stepup' : 'login', 'unknown_or_revoked_credential')]);
          throw fail('unknown_credential');
        }
        const result = await verifyAssertion({ response: body.credential, expectedChallenge: challenge, origin: config.origin, engine: config.webauthnEngine,
          rpId: config.rpId, credential, userHandle: settings.studio_user_handle || null });
        if (!result.ok) {
          await batch(ctx.db, [audit(ctx.db, now, 'inconnu', 'session_failed', credential.label, 'counter_regressed')]);
          await deps.notify({ kind: 'studio_counter_regressed', ref: `${credential.id.slice(0, 24)}:${result.signCount}`, level: 'critical',
            title: 'Connexion STUDIO refusée', body: 'Le compteur de la passkey a reculé : possible copie de la clé. Vérifie tes appareils.' });
          throw fail('passkey_rejected');
        }
        const counter = sql(ctx.db, 'UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE id = ? AND revoked_at IS NULL',
          result.signCount, now, credential.id);
        if (stepup) {
          try {
            await batch(ctx.db, [
              // La session doit toujours être active dans la génération courante au moment de l'écriture.
              sql(ctx.db, `INSERT INTO assertions (code) SELECT 'session_inactive' WHERE NOT EXISTS (SELECT 1 FROM auth_sessions
                WHERE token_hash = ? AND revoked_at IS NULL AND generation = ${CURRENT_GENERATION})`, session.hash),
              counter,
              sql(ctx.db, 'UPDATE auth_sessions SET stepup_at = ? WHERE token_hash = ?', now, session.hash),
              audit(ctx.db, now, 'fondateur', 'stepup', credential.label, 'ok'),
            ]);
          } catch (error) {
            if (error.dbCode === 'assertion_failed') throw fail('unauthenticated');
            throw error;
          }
          return json({ stepup_valid_until: now + STEPUP });
        }
        const { statement, cookie } = await sessionStatement(ctx, credential.id, generation, now);
        try {
          await batch(ctx.db, [counter, statement, audit(ctx.db, now, 'fondateur', 'session_login', credential.label, 'ok')]);
        } catch (error) {
          if (error.dbCode === 'session_refused') {
            await batch(ctx.db, [audit(ctx.db, now, 'inconnu', 'session_failed', credential.label, 'revoked_during_login')]);
            throw fail('passkey_rejected');
          }
          throw error;
        }
        return json({ authenticated: true }, 200, { 'Set-Cookie': cookie });
      }
      case 'POST /api/admin/stepup/options': {
        await readJson(request);
        requireSession();
        const { id, challenge } = await issueChallenge(ctx, 'stepup', now, session.hash);
        return json({ challenge_id: id, publicKey: { challenge, rpId: config.rpId, timeout: 60000, userVerification: 'required',
          allowCredentials: (await all(ctx.db, 'SELECT id FROM passkeys WHERE revoked_at IS NULL AND generation = ?', generation))
            .map((p) => ({ type: 'public-key', id: p.id })) } });
      }

      // ---- code de secours : une fois ; passkeys, sessions et défis invalidés dans la même instruction ----
      case 'POST /api/admin/recover': {
        const body = await readJson(request);
        await deps.rateLimit(`studio-recover:${client}`, 5, 600);
        if (typeof body.code !== 'string' || body.code.length > 20) throw fail('invalid_request');
        const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
        const deviceHash = await recoveryHashOf(env, token);
        const hash = await codeHash(env, body.code);
        const used = await batch(ctx.db, [
          sql(ctx.db, 'UPDATE recovery_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL', now, hash),
          // Seul l'appareil qui vient de saisir ce code pourra inscrire la nouvelle passkey.
          sql(ctx.db, `UPDATE settings SET value = ? WHERE key = 'studio_recovery_hash'
            AND EXISTS (SELECT 1 FROM recovery_codes WHERE code_hash = ? AND used_at = ?)`, deviceHash, hash, now),
        ]);
        if (!used[0].meta.changes) {
          await batch(ctx.db, [audit(ctx.db, now, 'inconnu', 'session_failed', 'recovery', 'bad_code')]);
          throw fail('invalid_recovery_code');
        }
        await batch(ctx.db, [audit(ctx.db, now, 'fondateur', 'recovery_code_used', `generation=${generation + 1}`, 'sessions_revoked')]);
        await deps.notify({ kind: 'studio_recovery_used', ref: String(now), level: 'critical', title: 'Code de secours utilisé',
          body: 'Toutes les sessions et les appareils STUDIO ont été retirés. Un nouvel appareil peut être autorisé pendant 15 minutes.' });
        return json({ enrollment_open_until: now + RECOVERY_WINDOW, ...(await registrationOptions(ctx, config, now, deviceHash)) }, 200,
          { 'Set-Cookie': setCookie(RECOVERY_COOKIE, token, RECOVERY_WINDOW) });
      }
      // Nouveau défi pour le même appareil (page rechargée pendant la fenêtre de 15 minutes).
      case 'POST /api/admin/recover/options': {
        await readJson(request);
        if (!recovering) throw fail('already_enrolled');
        return json({ enrollment_open_until: Number(settings.studio_enrollment_open_until), ...(await registrationOptions(ctx, config, now, recoveryHash)) });
      }
      case 'POST /api/admin/logout': {
        await readJson(request);
        if (session) await batch(ctx.db, [sql(ctx.db, 'UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?', now, session.hash)]);
        return json({ authenticated: false }, 200, { 'Set-Cookie': setCookie(COOKIE, '', 0) });
      }
      case 'POST /api/admin/sessions/revoke-all': {
        await readJson(request);
        requireStepUp();
        await batch(ctx.db, [sql(ctx.db, 'UPDATE auth_sessions SET revoked_at = ? WHERE revoked_at IS NULL', now),
          sql(ctx.db, `UPDATE auth_challenges SET used_at = ? WHERE used_at IS NULL AND purpose = 'stepup'`, now),
          audit(ctx.db, now, 'fondateur', 'sessions_revoked', null, 'ok')]);
        return json({ authenticated: false }, 200, { 'Set-Cookie': setCookie(COOKIE, '', 0) });
      }
      // ---- appareils et codes de secours (réglages, confirmation Face ID) ----
      case 'POST /api/admin/recovery-codes': {
        await readJson(request);
        requireStepUp();
        const codes = Array.from({ length: 10 }, () => `${randomCode(4)}-${randomCode(4)}`);
        const batchId = uuid();
        await batch(ctx.db, [sql(ctx.db, 'DELETE FROM recovery_codes'),
          ...(await Promise.all(codes.map(async (c) => sql(ctx.db, 'INSERT INTO recovery_codes (code_hash, batch, created_at) VALUES (?, ?, ?)',
            await codeHash(env, c), batchId, now)))),
          audit(ctx.db, now, 'fondateur', 'recovery_codes_regenerated', null, 'ok')]);
        await deps.notify({ kind: 'studio_codes_regenerated', ref: String(now), level: 'warning', title: 'Nouveaux codes de secours',
          body: 'Les anciens codes de secours ne fonctionnent plus.' });
        return json({ recovery_codes: codes });
      }
      case 'POST /api/admin/devices/options': {
        await readJson(request);
        requireStepUp();
        return json(await registrationOptions(ctx, config, now, session.hash));
      }
      case 'POST /api/admin/devices/verify': {
        const body = await readJson(request, 32768);
        requireStepUp();
        const challenge = await consumeChallenge(ctx, body.challenge_id, 'register', now, session.hash);
        const cred = await verifyRegistration({ response: body.credential, expectedChallenge: challenge, origin: config.origin, rpId: config.rpId, engine: config.webauthnEngine });
        const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 40) : 'Nouvel appareil';
        try {
          await batch(ctx.db, [sql(ctx.db, `INSERT INTO passkeys (id, public_key, alg, sign_count, backed_up, transports, label, created_at, generation)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, cred.credentialId, cred.publicKey, cred.alg, cred.signCount, cred.backedUp ? 1 : 0, cred.transports,
          label, now, generation), audit(ctx.db, now, 'fondateur', 'passkey_added', label, 'device')]);
        } catch (error) {
          if (error.dbCode === 'stale_generation') throw fail('challenge_expired');
          if (error.dbCode === 'unique_failed') throw fail('passkey_rejected');
          throw error;
        }
        await deps.notify({ kind: 'studio_passkey_added', ref: cred.credentialId.slice(0, 24), level: 'warning',
          title: 'Nouvel appareil autorisé dans STUDIO', body: `« ${label} » peut maintenant se connecter. Si ce n’est pas toi, utilise un code de secours.` });
        return json({ added: true, label });
      }
      case 'POST /api/admin/devices/revoke': {
        const body = await readJson(request);
        requireStepUp();
        const id = String(body.id ?? '');
        try {
          await batch(ctx.db, [
            // Jamais le dernier appareil : il resterait seulement les codes de secours.
            sql(ctx.db, `INSERT INTO assertions (code) SELECT 'last_device' WHERE (SELECT COUNT(*) FROM passkeys WHERE revoked_at IS NULL AND id <> ?) = 0`, id),
            sql(ctx.db, 'UPDATE passkeys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', now, id),
            sql(ctx.db, 'UPDATE auth_sessions SET revoked_at = ? WHERE passkey_id = ? AND revoked_at IS NULL', now, id),
            audit(ctx.db, now, 'fondateur', 'passkey_revoked', id.slice(0, 24), 'ok'),
          ]);
        } catch (error) {
          if (error.dbCode === 'assertion_failed') throw fail('last_device');
          throw error;
        }
        return json({ revoked: true });
      }
      default:
        // Routes métier : session obligatoire ; confirmation Face ID pour les actions sensibles.
        requireSession();
        return await handleStudio(request, ctx, { route, url, session, settings, requireStepUp, deps, now, config });
    }
  } catch (error) {
    if (error instanceof WebAuthnError) {
      await batch(ctx.db, [audit(ctx.db, now, 'inconnu', 'session_failed', 'webauthn', error.reason)]).catch(() => {});
      return json({ error: 'passkey_rejected' }, 403);
    }
    return errorResponse(error);
  }
}

export const _test = { tokenHash, codeHash, COOKIE, RECOVERY_COOKIE, sha256Hex };
