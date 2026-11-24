// SAYLESS STUDIO — application (connexion Face ID, inventaire guidé).
// Aucune donnée n'est inventée : tout vient de l'API /api/admin, sinon l'écran le dit.
// Seuls les écrans réellement branchés sont proposés ; les autres arriveront au fur et à mesure.

const app = document.getElementById('app');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icons = {
  face: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3H5.5A2.5 2.5 0 0 0 3 5.5V7M17 3h1.5A2.5 2.5 0 0 1 21 5.5V7M7 21H5.5A2.5 2.5 0 0 1 3 18.5V17M17 21h1.5a2.5 2.5 0 0 0 2.5-2.5V17"/><path d="M9 9v1.6M15 9v1.6M12 9v4.2h-1.2"/><path d="M9.4 16a4 4 0 0 0 5.2 0"/></svg>',
  back: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  tag: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12V4.5A1.5 1.5 0 0 1 4.5 3H12l9 9-9 9-9-9Z"/><circle cx="8" cy="8" r="1.6"/></svg>',
  chev: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
};
const MESSAGES = {
  invalid_setup_code: 'Code d’installation incorrect.',
  already_enrolled: 'Un appareil est déjà autorisé. Connecte-toi avec Face ID ou utilise un code de secours.',
  not_enrolled: 'Aucun appareil n’est encore autorisé.',
  passkey_rejected: 'Face ID n’a pas pu être vérifié. Réessaie.',
  unknown_credential: 'Cette passkey n’est pas autorisée dans STUDIO.',
  challenge_expired: 'La demande a expiré. Réessaie.',
  rate_limited: 'Trop d’essais. Patiente quelques minutes.',
  invalid_recovery_code: 'Code de secours incorrect ou déjà utilisé.',
  unauthenticated: 'Session expirée. Reconnecte-toi.',
  stale_revision: 'Le stock a changé pendant ta saisie. Les chiffres ont été rechargés.',
  quantity_below_reservations: 'Impossible : des pièces de cette taille sont en cours de paiement.',
  not_configured: 'STUDIO n’est pas encore configuré sur ce serveur.',
  cancelled: 'Face ID annulé.',
  unsupported: 'Ce navigateur ne gère pas les passkeys. Utilise Safari sur iPhone ou sur Mac.',
};
const message = (code) => MESSAGES[code] ?? 'Action impossible pour le moment. Réessaie dans un instant.';

// ---------- API ----------
class StudioError extends Error { constructor(code, status) { super(code); this.code = code; this.status = status; } }
async function api(path, body) {
  let response;
  try {
    response = await fetch(path, body === undefined
      ? { credentials: 'same-origin', cache: 'no-store' }
      : { method: 'POST', credentials: 'same-origin', cache: 'no-store', body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', 'X-Studio-Request': '1' } });
  } catch {
    throw new StudioError('network', 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new StudioError(data.error ?? 'error', response.status);
  return data;
}

// ---------- passkeys (WebAuthn) ----------
const b64 = {
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''),
  dec: (s) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0)),
};
const supported = () => Boolean(window.PublicKeyCredential && navigator.credentials);
async function ceremony(run) {
  if (!supported()) throw new StudioError('unsupported', 0);
  try {
    return await run();
  } catch (error) {
    if (error instanceof StudioError) throw error;
    throw new StudioError(error?.name === 'NotAllowedError' ? 'cancelled' : 'passkey_rejected', 0);
  }
}
const createPasskey = (pk) => ceremony(async () => {
  const cred = await navigator.credentials.create({ publicKey: { ...pk, challenge: b64.dec(pk.challenge), user: { ...pk.user, id: b64.dec(pk.user.id) },
    excludeCredentials: (pk.excludeCredentials ?? []).map((c) => ({ ...c, id: b64.dec(c.id) })) } });
  return { id: cred.id, rawId: b64.enc(cred.rawId), type: cred.type, response: { clientDataJSON: b64.enc(cred.response.clientDataJSON),
    attestationObject: b64.enc(cred.response.attestationObject), transports: cred.response.getTransports?.() ?? [] } };
});
const getPasskey = (pk) => ceremony(async () => {
  const cred = await navigator.credentials.get({ publicKey: { ...pk, challenge: b64.dec(pk.challenge),
    allowCredentials: (pk.allowCredentials ?? []).map((c) => ({ ...c, id: b64.dec(c.id) })) } });
  return { id: cred.id, rawId: b64.enc(cred.rawId), type: cred.type, response: { clientDataJSON: b64.enc(cred.response.clientDataJSON),
    authenticatorData: b64.enc(cred.response.authenticatorData), signature: b64.enc(cred.response.signature),
    userHandle: cred.response.userHandle ? b64.enc(cred.response.userHandle) : null } };
});
async function stepUp() {
  const options = await api('/api/admin/stepup/options', {});
  await api('/api/admin/stepup/verify', { challenge_id: options.challenge_id, credential: await getPasskey(options.publicKey) });
}
// Action sensible : confirmation Face ID demandée seulement si la précédente date de plus de 5 minutes.
async function sensitive(path, body) {
  try {
    return await api(path, body);
  } catch (error) {
    if (error.code !== 'stepup_required') throw error;
    await stepUp();
    return api(path, body);
  }
}

// ---------- état et rendu ----------
const state = { screen: 'loading', session: null, error: null, busy: false, codes: null, inventory: null, counts: {}, aside: { unshipped: 0, promised: 0, damaged: 0 }, saved: null };
function set(patch) { Object.assign(state, patch); render(); }
const errorBox = () => (state.error ? `<p class="notice error" role="alert">${esc(message(state.error))}</p>` : '');

const screens = {
  loading: () => '<div class="center"><div class="logo" role="img" aria-label="SAYLESS"></div><p class="s">Chargement…</p></div>',
  login: () => {
    const first = !state.session?.enrolled;
    return `<div class="body split fade">
      <div class="center"><div class="logo" role="img" aria-label="SAYLESS"></div><h1 class="h1 hero rose">Studio</h1>
        <p class="s narrow">Ton espace de gestion, réservé à ton compte.</p></div>
      <div class="stack">${errorBox()}
        ${first ? `<label class="sr-only" for="setup">Code d’installation</label>
          <div class="field wide"><input id="setup" name="setup" autocomplete="one-time-code" placeholder="Code d’installation" maxlength="64"></div>
          <button class="btn main" data-action="enroll" ${state.busy ? 'disabled' : ''}>${icons.face} Autoriser cet appareil avec Face ID</button>`
    : `<button class="btn main" data-action="login" ${state.busy ? 'disabled' : ''}>${icons.face} Se connecter avec Face ID</button>`}
        <button class="link" data-action="go" data-to="recover">Utiliser un code de secours</button>
        <p class="note centered">Connexion par passkey : rien à retenir, rien à taper. Chaque nouvel appareil passe par toi.</p>
      </div></div>`;
  },
  recover: () => `<header class="top"><button class="back" data-action="go" data-to="login">${icons.back} Retour</button></header>
    <div class="body fade"><div class="heading"><h1 class="h1">Code de secours</h1><p class="s">Un code s’utilise une seule fois. Il ferme toutes les sessions et autorise un nouvel appareil pendant 15 minutes.</p></div>
      ${errorBox()}<div class="field"><label class="sr-only" for="code">Code de secours</label><input id="code" autocomplete="one-time-code" placeholder="XXXX-XXXX" maxlength="9"></div>
      <button class="btn main" data-action="recover" ${state.busy ? 'disabled' : ''}>${icons.face} Valider et autoriser cet appareil</button></div>`,
  codes: () => `<div class="body fade"><div class="heading"><h1 class="h1">Codes de secours</h1>
      <p class="s">Note-les maintenant, hors ligne. Ils ne seront plus jamais affichés. Chacun ne sert qu’une fois.</p></div>
      <ul class="codes">${state.codes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
      <p class="notice">Garde-les à part de ton téléphone : papier rangé ou gestionnaire de mots de passe. Ne les envoie à personne, ni dans une discussion.</p>
      <button class="btn main" data-action="codes-done">Je les ai notés</button></div>`,
  home: () => {
    const inv = state.inventory;
    const done = inv && inv.variants.every((v) => v.confirmed);
    return `<header class="top"><div class="mark" role="img" aria-label="SAYLESS"></div><button class="link" data-action="logout">Se déconnecter</button></header>
    <div class="body fade"><h1 class="h1">Studio</h1>${errorBox()}
      <section aria-labelledby="dispo"><h2 class="sec" id="dispo">Disponible</h2><div class="sheet">
        <button class="row action" data-action="go" data-to="inventory">
          <span class="size" aria-hidden="true">${icons.tag}</span><span class="grow"><span class="p strong block">Inventaire guidé</span>
          <span class="s">${inv ? (done ? 'Stock confirmé par taille' : 'À faire : stock non confirmé') : 'État inconnu'}</span></span>
          <span class="pill ${done ? 'on' : 'wait'}"><span class="dot"></span>${done ? 'Fait' : 'À faire'}</span>${icons.chev}</button>
      </div></section>
      <section aria-labelledby="secu"><h2 class="sec" id="secu">Sécurité</h2><div class="sheet">
        <button class="row action" data-action="revoke-all">
          <span class="grow"><span class="p strong block">Fermer toutes les sessions</span><span class="s">Confirmation Face ID demandée</span></span>${icons.chev}</button>
      </div></section>
      <p class="note">Commandes, stock, finances et notifications arrivent dans les prochaines versions de STUDIO.</p></div>`;
  },
  inventory: () => {
    const inv = state.inventory;
    if (!inv) return `<div class="center"><p class="s">Chargement de l’inventaire…</p>${errorBox()}</div>`;
    const counted = inv.variants.reduce((n, v) => n + (state.counts[v.sku] ?? 0), 0);
    const reconciled = counted + state.aside.promised + state.aside.damaged;
    const gap = reconciled - inv.reference_total;
    const n = Math.abs(gap);
    const msg = reconciled === 0 && state.aside.unshipped === 0 ? 'Commence par les S : chaque gilet compte une seule fois.'
      : gap === 0 ? `Ça correspond aux ${inv.reference_total} pièces théoriques (30 reçues, 2 offertes, 2 vendues).`
        : `${n} pièce${n > 1 ? 's' : ''} de ${gap > 0 ? 'plus' : 'moins'} que prévu : vérifie avant de valider.`;
    const counter = (key, label, value, small = false) => `<div class="counter">
      <button type="button" class="stepbtn" data-action="dec" data-key="${esc(key)}" aria-label="Retirer : ${esc(label)}">−</button>
      <span class="val${small ? ' small' : ''}" aria-live="polite">${esc(value)}</span>
      <button type="button" class="stepbtn" data-action="inc" data-key="${esc(key)}" aria-label="Ajouter : ${esc(label)}">+</button></div>`;
    return `<header class="top"><button class="back" data-action="go" data-to="home">${icons.back} Studio</button>
      <span class="s">${inv.variants.every((v) => v.confirmed) ? 'Stock déjà confirmé' : 'Stock non confirmé'}</span></header>
    <div class="body tight fade"><div class="heading"><h1 class="h1">Inventaire</h1><p class="s">Lis l’étiquette de chaque gilet, compte, puis recompte une fois.</p></div>
      ${errorBox()}
      <section aria-labelledby="avendre"><h2 class="sec" id="avendre">À vendre</h2><div class="sheet">
        ${inv.variants.map((v) => `<div class="row tall"><span class="size" aria-hidden="true">${esc(v.size)}</span>
          <p class="p grow strong">Taille ${esc(v.size)}${v.reserved ? `<span class="s block">${esc(v.reserved)} en cours de paiement</span>` : ''}</p>
          ${counter(`sku:${v.sku}`, `taille ${v.size}`, state.counts[v.sku] ?? 0)}</div>`).join('')}
      </div></section>
      <section aria-labelledby="decote"><h2 class="sec" id="decote">Mises de côté, hors vente</h2><div class="sheet">
        <div class="row"><p class="p grow">Commandes payées pas encore parties</p>${counter('aside:unshipped', 'commande pas encore partie', state.aside.unshipped, true)}</div>
        <div class="row"><p class="p grow">Promises ou à offrir</p>${counter('aside:promised', 'pièce promise', state.aside.promised, true)}</div>
        <div class="row"><p class="p grow">Abîmées</p>${counter('aside:damaged', 'pièce abîmée', state.aside.damaged, true)}</div>
      </div></section>
      <section class="sheet pad" aria-live="polite">
        <div class="line"><span class="p">Comptées à vendre</span><span class="num">${esc(counted)}</span></div>
        <div class="line"><span class="p">Écart avec les ${esc(inv.reference_total)} théoriques</span><span class="num rose">${gap > 0 ? '+' : gap < 0 ? '−' : ''}${esc(n)}</span></div>
        <p class="s">${esc(msg)}</p>
        ${state.saved ? `<p class="p strong">Inventaire enregistré. Limite Stripe proposée pour le lien 1.0 : ${esc(state.saved.stripe_limit_proposal)} paiements, soit les 2 déjà comptés + les pièces à vendre. Rien n’est appliqué sans ton OK.</p>` : ''}
      </section>
      <p class="note">En validant, ces quantités deviennent le stock vendable de la boutique 2.0 (quand elle sera ouverte). Confirmation Face ID demandée.</p>
      <button type="button" class="btn main" data-action="save-inventory" ${state.busy || state.saved ? 'disabled' : ''}>${state.saved ? 'Inventaire enregistré' : 'Valider l’inventaire'}</button></div>`;
  },
};

// L'animation d'entrée ne joue qu'au changement d'écran, jamais à chaque appui sur un compteur.
let shown = null;
function render() {
  app.innerHTML = (screens[state.screen] ?? screens.loading)();
  if (shown === state.screen) app.querySelectorAll('.fade').forEach((el) => el.classList.remove('fade'));
  shown = state.screen;
  const input = app.querySelector('input');
  if (input && !state.busy) input.focus({ preventScroll: true });
}

// ---------- actions ----------
async function refreshSession() {
  const session = await api('/api/admin/state');
  if (session.authenticated) {
    set({ session, screen: 'home', error: null });
    loadInventory();
  } else set({ session, screen: 'login' });
}
async function loadInventory() {
  try {
    const inventory = await api('/api/admin/inventory');
    const counts = Object.fromEntries(inventory.variants.map((v) => [v.sku, v.confirmed ? v.on_hand : 0]));
    set({ inventory, counts: state.saved ? state.counts : counts });
  } catch (error) {
    if (error.code === 'unauthenticated') return refreshSession();
    set({ error: error.code });
  }
}
async function guarded(fn) {
  if (state.busy) return;
  set({ busy: true, error: null });
  try {
    await fn();
  } catch (error) {
    if (error.code === 'unauthenticated') { set({ busy: false }); return refreshSession(); }
    if (error.code === 'stale_revision') await loadInventory();
    set({ error: error.code });
  } finally {
    set({ busy: false });
  }
}

const actions = {
  go: (el) => { set({ screen: el.dataset.to, error: null }); if (el.dataset.to === 'inventory') loadInventory(); },
  // Les champs sont lus avant tout nouveau rendu (le rendu recrée le formulaire).
  enroll: () => { const code = app.querySelector('#setup')?.value ?? ''; return guarded(async () => {
    const options = await api('/api/admin/setup/options', { setup_code: code });
    const result = await api('/api/admin/setup/verify', { challenge_id: options.challenge_id, credential: await createPasskey(options.publicKey), label: navigator.userAgentData?.platform || navigator.platform || 'Appareil' });
    set({ codes: result.recovery_codes, screen: 'codes' });
  }); },
  login: () => guarded(async () => {
    const options = await api('/api/admin/login/options', {});
    await api('/api/admin/login/verify', { challenge_id: options.challenge_id, credential: await getPasskey(options.publicKey) });
    await refreshSession();
  }),
  recover: () => { const code = app.querySelector('#code')?.value ?? ''; return guarded(async () => {
    const result = await api('/api/admin/recover', { code });
    const done = await api('/api/admin/setup/verify', { challenge_id: result.challenge_id, credential: await createPasskey(result.publicKey), label: 'Appareil de secours' });
    set({ codes: done.recovery_codes, screen: 'codes' });
  }); },
  'codes-done': () => { set({ codes: null, screen: 'loading' }); refreshSession(); },
  logout: () => guarded(async () => { await api('/api/admin/logout', {}); await refreshSession(); }),
  'revoke-all': () => guarded(async () => { await sensitive('/api/admin/sessions/revoke-all', {}); await refreshSession(); }),
  inc: (el) => step(el.dataset.key, 1),
  dec: (el) => step(el.dataset.key, -1),
  'save-inventory': () => guarded(async () => {
    const inv = state.inventory;
    const saved = await sensitive('/api/admin/inventory', { counts: state.counts, set_aside: state.aside,
      expected: Object.fromEntries(inv.variants.map((v) => [v.sku, v.revision])) });
    set({ saved, inventory: saved });
  }),
};
function step(key, delta) {
  const [kind, name] = key.split(':');
  if (kind === 'sku') state.counts[name] = Math.max(0, (state.counts[name] ?? 0) + delta);
  else state.aside[name] = Math.max(0, (state.aside[name] ?? 0) + delta);
  set({ saved: null });
}

app.addEventListener('click', (event) => {
  const el = event.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) actions[el.dataset.action](el);
});
render();
refreshSession().catch((error) => set({ screen: 'login', error: error.code }));
