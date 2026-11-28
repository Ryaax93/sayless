// SAYLESS STUDIO — application iPhone et ordinateur, fidèle à la maquette validée (24 novembre 2026).
// Tout vient de l'API /api/admin : aucun chiffre inventé ; une donnée inconnue s'affiche « — ».
// Une fonction pas encore raccordée est annoncée comme telle, jamais par un bouton factice.
// Accessibilité : focus conservé sur le contrôle utilisé, titre de l'écran annoncé à VoiceOver.
// Safari : chaque demande Face ID part directement du geste (défi préparé à l'avance).

const app = document.getElementById('app');
const live = document.getElementById('live');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const svg = (d, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  face: svg('<path d="M7 3H5.5A2.5 2.5 0 0 0 3 5.5V7M17 3h1.5A2.5 2.5 0 0 1 21 5.5V7M7 21H5.5A2.5 2.5 0 0 1 3 18.5V17M17 21h1.5a2.5 2.5 0 0 0 2.5-2.5V17"/><path d="M9 9v1.6M15 9v1.6M12 9v4.2h-1.2"/><path d="M9.4 16a4 4 0 0 0 5.2 0"/>'),
  back: svg('<path d="M15 6l-6 6 6 6"/>'),
  chev: svg('<path d="M9 6l6 6-6 6"/>', 'chev'),
  bell: svg('<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.6 2.2H4.4z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>'),
  hanger: svg('<path d="M12 8.5a2.25 2.25 0 1 1 2.25-2.25"/><path d="M12 8.5v1.2L20.2 15a1.6 1.6 0 0 1-.9 2.9H4.7a1.6 1.6 0 0 1-.9-2.9L12 9.7"/>'),
  ticket: svg('<path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2.5a1.5 1.5 0 0 0 0 3V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2.5a1.5 1.5 0 0 0 0-3z"/>'),
  lock: svg('<rect x="5" y="10" width="14" height="10" rx="2.5"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>'),
  user: svg('<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  tag: svg('<path d="M3.5 12.6V5.5a2 2 0 0 1 2-2h7.1l8 8a2 2 0 0 1 0 2.8l-6.3 6.3a2 2 0 0 1-2.8 0z"/><circle cx="8.2" cy="8.2" r="1.4"/>'),
  bars: svg('<path d="M5 20V11M12 20V5M19 20v-7"/>'),
  pulse: svg('<path d="M3 12h4l2.5-5 4 10 2.5-5H21"/>'),
  download: svg('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19.5h14"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>'),
  mail: svg('<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>'),
  today: svg('<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/><circle cx="12" cy="15" r="1.5" fill="currentColor" stroke="none"/>'),
  chart: svg('<path d="M4 19.5h16"/><path d="M6 15.5l4-4.5 3.2 3 5-6"/><path d="M15 8h3.2v3.2"/>'),
  dots: '<svg class="ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/></svg>',
};
const MESSAGES = {
  invalid_setup_code: 'Code d’installation incorrect.',
  already_enrolled: 'Un appareil est déjà autorisé. Connecte-toi avec Face ID ou utilise un code de secours.',
  not_enrolled: 'Aucun appareil n’est autorisé pour le moment. Utilise un code de secours.',
  passkey_rejected: 'Face ID n’a pas pu être vérifié. Réessaie.',
  unknown_credential: 'Cette passkey n’est pas autorisée dans STUDIO.',
  challenge_expired: 'La demande a expiré. Réessaie.',
  rate_limited: 'Trop d’essais. Patiente quelques minutes.',
  invalid_recovery_code: 'Code de secours incorrect ou déjà utilisé.',
  unauthenticated: 'Session expirée. Reconnecte-toi.',
  stepup_required: 'Confirmation Face ID nécessaire.',
  stale_revision: 'Le stock a changé pendant ta saisie. Les chiffres ont été rechargés.',
  quantity_below_reservations: 'Impossible : des pièces de cette taille sont en cours de paiement.',
  not_configured: 'Cette fonction attend sa configuration sur le serveur.',
  not_ready: 'Ouverture impossible : des prérequis manquent (voir ci-dessous).',
  order_not_shippable: 'Cette commande doit d’abord être vérifiée.',
  order_not_reviewable: 'Cette commande n’est plus à vérifier.',
  insufficient_stock: 'Aucune pièce libre dans cette taille.',
  refund_not_allowed: 'Remboursement impossible pour cette commande.',
  last_device: 'C’est ton dernier appareil autorisé : ajoute-en un autre avant de le retirer.',
  terms_version_exists: 'Cette version des CGV existe déjà : choisis un nouveau numéro de version.',
  invalid_request: 'Saisie incomplète ou invalide.',
  network: 'Connexion impossible. Vérifie le réseau et réessaie.',
  cancelled: 'Face ID annulé.',
  unsupported: 'Ce navigateur ne gère pas les passkeys. Utilise Safari sur iPhone ou sur Mac.',
  push_denied: 'Notifications refusées dans les réglages de l’iPhone.',
  push_unavailable: 'Installe d’abord STUDIO sur l’écran d’accueil (Partager, puis « Sur l’écran d’accueil »).',
  push_key_mismatch: 'Abonnement créé avec une ancienne clé : touche « Activer » de nouveau.',
  push_subscription_expired: 'L’iPhone a fourni un abonnement déjà refusé par Apple. Ferme STUDIO, rouvre-le depuis l’icône, puis touche « Activer ».',
};
const message = (code) => MESSAGES[code] ?? 'Action impossible pour le moment. Réessaie dans un instant.';

// ---------- formats (français, heure de Paris) ----------
const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const euro = (c) => (c === null || c === undefined ? '—' : EUR.format(c / 100));
const pct = (r) => (r === null || r === undefined ? '—' : `${(r * 100).toFixed(1).replace('.', ',')} %`);
const fmt = (opts) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', ...opts });
const longDate = (iso) => (iso ? fmt({ weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(':', ' h ') : '—');
const dayTitle = (iso) => fmt({ day: 'numeric', month: 'long' }).format(new Date(iso));
const hour = (iso) => fmt({ hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(':', ' h ');
const plural = (n, one, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
const today = () => { const t = fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()); return t.charAt(0).toUpperCase() + t.slice(1); };

// ---------- API ----------
class StudioError extends Error { constructor(code, status, extra = {}) { super(code); Object.assign(this, { code, status, extra }); } }
async function api(path, body) {
  let response;
  try {
    response = await fetch(path, body === undefined ? { credentials: 'same-origin', cache: 'no-store' }
      : { method: 'POST', credentials: 'same-origin', cache: 'no-store', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'X-Studio-Request': '1' } });
  } catch {
    throw new StudioError('network', 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new StudioError(data.error ?? 'error', response.status, data);
  return data;
}

// ---------- passkeys (WebAuthn) ----------
const b64 = {
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''),
  dec: (s) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0)),
};
const supported = () => Boolean(window.PublicKeyCredential && navigator.credentials);
// L'appel à navigator.credentials part de façon synchrone dans le geste de l'utilisateur (Safari).
function ceremony(run) {
  if (!supported()) return Promise.reject(new StudioError('unsupported', 0));
  let pending;
  try {
    pending = run();
  } catch (error) {
    return Promise.reject(new StudioError('passkey_rejected', 0, { name: error?.name }));
  }
  return pending.catch((error) => { throw new StudioError(error?.name === 'NotAllowedError' ? 'cancelled' : 'passkey_rejected', 0); });
}
const createPasskey = (pk) => ceremony(() => navigator.credentials.create({ publicKey: { ...pk, challenge: b64.dec(pk.challenge),
  user: { ...pk.user, id: b64.dec(pk.user.id) }, excludeCredentials: (pk.excludeCredentials ?? []).map((c) => ({ ...c, id: b64.dec(c.id) })) } })
  .then((cred) => ({ id: cred.id, rawId: b64.enc(cred.rawId), type: cred.type, response: { clientDataJSON: b64.enc(cred.response.clientDataJSON),
    attestationObject: b64.enc(cred.response.attestationObject), transports: cred.response.getTransports?.() ?? [] } })));
const getPasskey = (pk) => ceremony(() => navigator.credentials.get({ publicKey: { ...pk, challenge: b64.dec(pk.challenge),
  allowCredentials: (pk.allowCredentials ?? []).map((c) => ({ ...c, id: b64.dec(c.id) })) } })
  .then((cred) => ({ id: cred.id, rawId: b64.enc(cred.rawId), type: cred.type, response: { clientDataJSON: b64.enc(cred.response.clientDataJSON),
    authenticatorData: b64.enc(cred.response.authenticatorData), signature: b64.enc(cred.response.signature),
    userHandle: cred.response.userHandle ? b64.enc(cred.response.userHandle) : null } })));

// Défis préparés à l'avance (valables 5 minutes côté serveur) : connexion et confirmation Face ID.
const prepared = { login: null, stepup: null };
let stepupUntil = 0;
async function prepare(kind) {
  try {
    prepared[kind] = { ...(await api(`/api/admin/${kind === 'login' ? 'login' : 'stepup'}/options`, {})), at: Date.now() };
  } catch {
    prepared[kind] = null;
  }
}
const fresh = (p) => p && Date.now() - p.at < 240000;
setInterval(() => { if (state.session?.authenticated) prepare('stepup'); else if (state.screen === 'login' && state.session?.enrolled) prepare('login'); }, 200000);

// Action sensible : Face ID demandé tout de suite (dans le geste) si la dernière confirmation date de plus de 5 minutes.
function sensitive(run) {
  if (Date.now() < stepupUntil) return guarded(run);
  const options = fresh(prepared.stepup) ? prepared.stepup : null;
  const assertion = options ? getPasskey(options.publicKey) : null;
  return guarded(async () => {
    const opts = options ?? (await api('/api/admin/stepup/options', {}));
    const credential = await (assertion ?? getPasskey(opts.publicKey));
    await api('/api/admin/stepup/verify', { challenge_id: opts.challenge_id, credential });
    stepupUntil = Date.now() + 280000;
    prepared.stepup = null;
    prepare('stepup');
    await run();
  });
}

// ---------- navigation ----------
const ROUTES = [
  ['today', '#/'], ['orders', '#/commandes'], ['order', '#/commandes/'], ['stock', '#/stock'], ['inventory', '#/inventaire'],
  ['movements', '#/mouvements'], ['finances', '#/finances'], ['notifications', '#/notifications'], ['more', '#/plus'], ['drops', '#/drops'],
  ['performance', '#/performances'], ['health', '#/sante'], ['audit', '#/historique'], ['settings', '#/reglages'], ['requests', '#/demandes'],
];
const TITLES = { today: 'Aujourd’hui', orders: 'Commandes', order: 'Commande', stock: 'Stock', inventory: 'Inventaire guidé', movements: 'Mouvements de stock',
  finances: 'Finances', notifications: 'Notifications', more: 'Plus', drops: 'Drops et codes promo', performance: 'Performances', health: 'Santé du site',
  audit: 'Historique', settings: 'Réglages et sécurité', requests: 'Demandes des clients', login: 'Connexion', recover: 'Code de secours', codes: 'Codes de secours' };
const TABS = [['today', 'Aujourd’hui', I.today], ['orders', 'Commandes', I.ticket], ['stock', 'Stock', I.hanger], ['finances', 'Finances', I.chart], ['more', 'Plus', I.dots]];
const TAB_OF = { order: 'orders', inventory: 'stock', movements: 'stock', notifications: 'today', drops: 'more', performance: 'more', health: 'more', audit: 'more', settings: 'more', requests: 'more' };
const SIDE = [['today', 'Aujourd’hui'], ['orders', 'Commandes'], ['stock', 'Stock'], ['finances', 'Finances'], ['notifications', 'Notifications'],
  ['drops', 'Drops et codes promo'], ['performance', 'Performances'], ['requests', 'Demandes des clients'], ['health', 'Santé du site'], ['settings', 'Réglages']];
const hrefOf = (screen, id) => (screen === 'order' ? `#/commandes/${encodeURIComponent(id)}` : ROUTES.find(([s]) => s === screen)?.[1] ?? '#/');
function routeFromHash() {
  const h = location.hash || '#/';
  const order = h.match(/^#\/commandes\/([0-9a-f-]{36})$/);
  if (order) return { screen: 'order', id: order[1] };
  const filter = h.match(/^#\/commandes\?([a-z]+)$/);
  if (filter) return { screen: 'orders', filter: filter[1] };
  return { screen: ROUTES.find(([, path]) => path === h)?.[0] ?? 'today' };
}

// ---------- état et rendu ----------
const state = { screen: 'loading', session: null, error: null, notice: null, busy: false, data: {}, id: null, filter: 'all', q: '',
  codes: null, counts: {}, aside: { unshipped: 0, promised: 0, damaged: 0 }, saved: null, contact: null, form: {}, enrollOptions: null, recoverOptions: null };
const set = (patch) => { Object.assign(state, patch); render(); };
const errorBox = () => (state.error ? `<p class="notice error" role="alert">${esc(message(state.error))}</p>` : '');
const noticeBox = () => (state.notice ? `<p class="notice ok" role="status">${esc(state.notice)}</p>` : '');
const btn = (action, text, { cls = 'btn main', fk = action, extra = '', disabled = false } = {}) =>
  `<button type="button" class="${cls}" data-action="${esc(action)}" data-fk="${esc(fk)}" ${extra} ${disabled || state.busy ? 'disabled' : ''}>${text}</button>`;
const nav = (screen, inner, { cls = 'row action', id = '', filter = '' } = {}) =>
  `<a class="${cls}" href="${esc(hrefOf(screen, id))}${filter ? `?${esc(filter)}` : ''}" data-fk="nav:${esc(screen)}:${esc(id || filter)}">${inner}</a>`;
const pill = (text, cls = '') => `<span class="pill ${cls}">${esc(text)}</span>`;
const loadingBox = () => '<p class="s" role="status">Chargement…</p>';

// Bande des pièces : une barre par pièce (SVG, sans style en ligne : compatible avec la CSP stricte).
const BAR_TEXT = { sold: ['vendue', 'vendues'], gift: ['offerte', 'offertes'], held: ['en cours de paiement', 'en cours de paiement'],
  available: ['à vendre', 'à vendre'], aside: ['mise de côté', 'mises de côté'], todo: ['à confirmer par l’inventaire', 'à confirmer par l’inventaire'],
  gap: ['non retrouvée à l’inventaire', 'non retrouvées à l’inventaire'] };
function strip(drop, small = false) {
  const bars = drop.bars.flatMap((b) => Array.from({ length: Math.min(b.n, 200) }, () => b.kind)).slice(0, 200);
  const n = Math.max(bars.length, 1);
  const w = 1000 / n;
  const label = drop.bars.map((b) => `${b.n} ${BAR_TEXT[b.kind][b.n > 1 ? 1 : 0]}`).join(', ');
  return `<svg class="strip${small ? ' small' : ''}" viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" aria-label="${esc(`${bars.length} pièces : ${label}`)}">${
    bars.map((k, i) => `<rect class="bar ${k}" x="${(i * w + w * 0.12).toFixed(2)}" y="2" width="${(w * 0.76).toFixed(2)}" height="96" rx="${Math.min(w * 0.12, 6).toFixed(2)}"/>`).join('')
  }</svg><div class="legend">${drop.bars.map((b) => `<span class="key"><span class="sw ${b.kind}"></span><b>${esc(b.n)}</b> ${esc(BAR_TEXT[b.kind][b.n > 1 ? 1 : 0])}</span>`).join('')}</div>`;
}
const track = (ratio, cls = '') => `<svg class="track ${cls}" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true"><rect class="tbg" width="100" height="10" rx="5"/>${
  ratio > 0 ? `<rect class="tfill" width="${Math.min(Math.max(ratio * 100, 1.5), 100).toFixed(2)}" height="10" rx="5"/>` : ''}</svg>`;
const sizeTag = (size, cls = '') => (size ? `<span class="size ${cls}" aria-label="Taille ${esc(size)}">${esc(size)}</span>` : `<span class="size unknown ${cls}" aria-label="Taille non renseignée">?</span>`);

// En-tête de la maquette : titre dans la barre pour les onglets, lien de retour sinon.
function header(title, { back = null, right = '' } = {}) {
  if (!back) return `<header class="top"><h1 class="h1 screen-title" tabindex="-1" data-fk="title">${esc(title)}</h1>${right}</header>`;
  return `<header class="top">${nav(back[0], `${I.back} ${esc(back[1])}`, { cls: 'back' })}${right}</header>
    <div class="body-title"><h1 class="h1 screen-title" tabindex="-1" data-fk="title">${esc(title)}</h1></div>`;
}

// ---------- écrans ----------
const screens = {
  loading: () => '<div class="center"><div class="logo" role="img" aria-label="SAYLESS"></div><p class="s" role="status">Chargement…</p></div>',

  login: () => {
    const s = state.session ?? {};
    let content;
    if (s.recovering || state.recoverOptions) {
      content = `<p class="p strong">Code de secours accepté. Autorise maintenant cet appareil.</p>
        ${btn('recover-create', `${I.face} Créer la passkey de cet appareil`)}`;
    } else if (!s.enrolled && state.enrollOptions) {
      content = `<p class="p strong">Code vérifié. Autorise cet appareil avec Face ID.</p>${btn('enroll-create', `${I.face} Autoriser cet appareil`)}`;
    } else if (!s.enrolled && !s.enrollment_open) {
      content = `<label class="sr-only" for="setup">Code d’installation</label>
        <div class="field wide"><input id="setup" data-fk="setup" autocomplete="one-time-code" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="Code d’installation" maxlength="64"></div>
        ${btn('enroll-check', 'Vérifier le code')}`;
    } else {
      content = btn('login', `${I.face} Se connecter avec Face ID`, { disabled: !s.enrolled });
    }
    return `<div class="body split fade"><div class="center"><div class="logo" role="img" aria-label="SAYLESS"></div>
        <h1 class="h1 hero rose screen-title" tabindex="-1" data-fk="title">Studio</h1><p class="s narrow">Ton espace de gestion, réservé à ton compte.</p></div>
      <div class="stack">${errorBox()}${content}
        <a class="link" href="#/secours" data-action="go-recover" data-fk="go-recover">Utiliser un code de secours</a>
        <p class="note centered">Connexion par passkey : rien à retenir, rien à taper. Chaque nouvel appareil passe par toi.</p></div></div>`;
  },
  recover: () => `<header class="top"><button class="back" data-action="go-login" data-fk="go-login">${I.back} Retour</button></header>
    <div class="body fade"><div class="heading"><h1 class="h1 screen-title" tabindex="-1" data-fk="title">Code de secours</h1>
      <p class="s">Un code s’utilise une seule fois. Il retire tous les appareils et sessions, puis autorise ce nouvel appareil pendant 15 minutes.</p></div>
      ${errorBox()}<div class="field"><label class="sr-only" for="code">Code de secours</label><input id="code" data-fk="code" autocomplete="one-time-code" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="XXXX-XXXX" maxlength="12"></div>
      ${btn('recover-check', 'Valider le code')}</div>`,
  codes: () => `<div class="body fade"><div class="heading"><h1 class="h1 screen-title" tabindex="-1" data-fk="title">Codes de secours</h1>
      <p class="s">Note-les maintenant, hors ligne. Ils ne seront plus jamais affichés. Chacun ne sert qu’une fois.</p></div>
      <ul class="codes">${state.codes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
      <p class="notice">Garde-les à part de ton téléphone : papier rangé ou gestionnaire de mots de passe. Ne les envoie à personne, ni dans une discussion.</p>
      ${btn('codes-done', 'Je les ai notés')}</div>`,

  today: () => {
    const d = state.data.overview;
    const bell = `<a class="pill icon" href="#/notifications" data-fk="bell" aria-label="${esc(d ? `Notifications : ${plural(d.notifications.unread, 'nouvelle')}` : 'Notifications')}">${I.bell}${d?.notifications.unread ? '<span class="badge" aria-hidden="true"></span>' : ''}</a>`;
    const shop = d ? `<span class="pill"><span class="dot ${d.shop.mode === 'open' ? 'rose' : ''}"></span>${d.shop.mode === 'open' ? 'Boutique ouverte' : 'Boutique en pause'}</span>` : '';
    if (!d) return `${header('Aujourd’hui', { right: `<div class="cluster">${bell}</div>` })}<div class="body">${errorBox()}${loadingBox()}</div>`;
    const drop = d.drop;
    const f = d.finance;
    return `<header class="top"><div class="mark" role="img" aria-label="SAYLESS"></div><div class="cluster">${shop}${bell}</div></header>
    <div class="body fade">${errorBox()}${noticeBox()}
      ${drop ? `<section class="drop" aria-labelledby="drop-title"><div class="drop-head"><h1 class="big screen-title" id="drop-title" tabindex="-1" data-fk="title">${esc(drop.name)}</h1>
        <p class="s right">${esc(today())}${drop.product ? `<br>${esc(drop.product.name)}, ${esc(euro(drop.product.price_cents))}` : ''}</p></div>
        ${strip(drop)}
        ${drop.gap !== null && drop.gap < 0 ? `<p class="note">${esc(plural(-drop.gap, 'pièce'))} de plus que déclaré : vérifie les quantités reçues dans Drops.</p>` : ''}
        ${drop.received_total === null ? `<p class="note">Pièces reçues et offertes : ${nav('drops', 'à déclarer dans Drops', { cls: 'inline' })}${drop.confirmed
    ? ' pour compléter la bande avec les pièces vendues et offertes.' : `. En attendant, la bande montre les ${esc(drop.reference_total ?? '—')} pièces théoriques.`}</p>` : ''}</section>`
    : `<h1 class="h1 screen-title" tabindex="-1" data-fk="title">Aujourd’hui</h1>`}
      <section aria-labelledby="afaire"><h2 class="sec" id="afaire">À faire</h2><div class="sheet">
        ${d.todo.length ? d.todo.map((t) => (t.wait
    ? `<div class="row">${I.lock}<span class="grow"><span class="p strong block">${esc(t.title)}</span><span class="s block">${esc(t.detail)}</span></span>${pill('En attente', 'wait')}</div>`
    : nav(t.screen, `<span class="rose">${t.screen === 'inventory' ? I.hanger : t.screen === 'orders' ? I.ticket : I.gear}</span><span class="grow"><span class="p strong block">${esc(t.title)}</span><span class="s block">${esc(t.detail)}</span></span>${I.chev}`,
      { filter: t.filter ?? '' }))).join('') : '<div class="row"><span class="p">Rien d’urgent. Tout est à jour.</span></div>'}
      </div></section>
      ${nav('finances', `<span class="line"><span class="sec flat">${f.investment_cents ? 'Investissement récupéré' : 'Encaissé'}</span><span class="num rose">${f.investment_cents ? esc(pct(f.recovered_ratio)) : esc(euro(f.collected_cents))}</span></span>
        ${f.investment_cents ? track(f.recovered_ratio ?? 0) : ''}
        <span class="s">${f.investment_cents ? `${esc(euro(f.net_cents))} nets de frais Stripe, sur ${esc(euro(f.investment_cents))} investis. Encaissé : ${esc(euro(f.collected_cents))}.`
    : `${esc(euro(f.net_cents))} nets de frais Stripe. Déclare ton investissement dans Finances pour suivre ce qui est récupéré.`}${f.fees_unknown ? ` Frais inconnus pour ${esc(plural(f.fees_unknown, 'vente'))}.` : ''}</span>`, { cls: 'sheet pad card' })}
      <section class="desk-only" aria-labelledby="dernieres"><h2 class="sec" id="dernieres">Dernières notifications</h2><div class="sheet">
        ${d.notifications.latest.length ? d.notifications.latest.map((n) => `<div class="row"><span class="dot ${n.read ? 'muted' : 'rose'}"></span><span class="p grow">${esc(n.title)}</span><span class="s">${esc(dayTitle(n.at))}</span></div>`).join('')
    : '<div class="row"><span class="s">Aucune notification.</span></div>'}</div></section>
    </div>`;
  },

  orders: () => {
    const d = state.data.orders;
    const filters = [['all', 'Toutes'], ['review', 'À vérifier'], ['prep', 'À préparer'], ['confirm', 'Envoi à confirmer'], ['way', 'En route'], ['done', 'Livrées'], ['ret', 'Retours']];
    const list = d ? d.orders.filter((o) => state.filter === 'all' || o.group === state.filter) : [];
    const names = { review: 'à vérifier', prep: 'à préparer', confirm: 'dont l’envoi est à confirmer', way: 'en route', done: 'livrée', ret: 'en retour' };
    return `${header('Commandes', { right: d ? `<span class="s">${esc(plural(d.counts.all, 'commande'))}</span>` : '' })}
    <div class="body fade">${errorBox()}
      <label class="field">${I.search}<input type="search" id="q" data-fk="q" placeholder="Numéro, référence ou nom" aria-label="Rechercher une commande" value="${esc(state.q)}"></label>
      <div class="chips" role="group" aria-label="Filtrer les commandes">${filters.filter(([id]) => id === 'all' || id === state.filter || d?.counts[id]).map(([id, text]) => `<button type="button" class="pill ${state.filter === id ? 'on' : ''}" aria-pressed="${state.filter === id}" data-action="filter" data-value="${id}" data-fk="filter:${id}">${esc(text)} <span class="soft">${esc(d?.counts[id === 'all' ? 'all' : id] ?? 0)}</span></button>`).join('')}</div>
      <div class="list">${!d ? loadingBox() : list.length ? list.map((o) => nav('order', `${o.sizes.length ? sizeTag(o.sizes[0].size) : sizeTag(null)}
        <span class="grow col"><span class="line"><span class="id">Commande ${esc(o.label)}</span><span class="num small">${esc(euro(o.total_cents))}</span></span>
        <span class="s">${esc(longDate(o.paid_at ?? o.created_at))}</span>
        <span class="s">${esc(o.review ?? (o.source === 'legacy_link' ? 'Lien 1.0' : o.shipping === 'relay' ? 'Point relais' : o.shipping === 'home' ? 'Domicile' : 'Import'))}${o.refunded_cents ? ` · remboursé ${esc(euro(o.refunded_cents))}` : ''}</span>
        <span>${pill(o.stage, o.group === 'review' ? 'warn' : ['prep', 'confirm'].includes(o.group) ? 'wait' : '')}</span></span>`, { cls: 'ticket', id: o.id })).join('')
    : `<div class="sheet pad centered-block"><p class="p strong">Aucune commande ${esc(names[state.filter] ?? '')} pour l’instant.</p><p class="s">Les nouvelles commandes arrivent ici dès le paiement.</p></div>`}</div>
      ${d?.paying ? `<p class="note">${esc(plural(d.paying, 'paiement'))} en cours sur Stripe (pièce réservée, pas encore vendue).</p>` : ''}
    </div>`;
  },

  order: () => {
    const o = state.data.order;
    if (!o || o.id !== state.id) return `${header('Commande', { back: ['orders', 'Commandes'] })}<div class="body">${errorBox()}${loadingBox()}</div>`;
    const item = o.items[0];
    const relay = o.shipping === 'relay';
    const ev = Object.fromEntries(o.events.map((e) => [e.kind, e]));
    const steps = [['Payée', o.paid_at, true], ['Préparée', ev.prepared?.at, Boolean(ev.prepared)], ['Expédiée', ev.shipped?.at, Boolean(ev.shipped)],
      ...(relay ? [['Disponible en point relais', null, o.shipment?.tracking === 'available_at_relay' || Boolean(ev.delivered)]] : []),
      ['Remise au client', ev.delivered?.at, Boolean(ev.delivered)]];
    const shippedDetail = ev.shipped?.detail;
    const next = !ev.prepared && !ev.shipped ? 'prepared' : !ev.shipped ? 'shipped' : !ev.delivered ? 'delivered' : null;
    const nextText = { prepared: 'Marquer comme préparée', shipped: 'Marquer comme expédiée', delivered: relay ? 'Marquer comme retirée' : 'Marquer comme livrée' };
    const c = state.contact?.id === o.id ? state.contact.value : null;
    return `<header class="top">${nav('orders', `${I.back} Commandes`, { cls: 'back' })}${pill(o.stage, o.group === 'review' ? 'warn' : ['prep', 'confirm'].includes(o.group) ? 'wait' : '')}</header>
    <div class="body fade">${errorBox()}${noticeBox()}
      <section class="order-head">${sizeTag(item?.size ?? null, 'xl')}<div class="grow col"><h1 class="h1 screen-title" tabindex="-1" data-fk="title">Commande ${esc(o.label)}</h1>
        <p class="s">${esc(longDate(o.paid_at ?? o.created_at))}</p><p class="s">${esc(item ? `${item.name}${item.quantity > 1 ? ` × ${item.quantity}` : ''}` : '')}</p>
        <p class="s id">${esc(o.reference)}</p></div><div class="thumb" role="img" aria-label="Zip hoodie rose pastel du Drop 01"></div></section>
      ${o.review ? `<section class="notice warn" aria-labelledby="averifier"><h2 class="p strong" id="averifier">À vérifier</h2><p class="s">${esc(o.review)}</p>
        ${o.actions.resolve ? `<div class="stack-left">${o.actions.restore_piece ? btn('resolve', 'La pièce était déjà mise de côté : la remettre en vente', { cls: 'btn ghost', fk: 'restore', extra: 'data-value="restore_piece"' }) : ''}
          ${btn('resolve', o.status === 'paid_no_stock' ? 'Attribuer une pièce libre et valider' : 'Valider la commande', { cls: 'btn ghost', fk: 'confirm', extra: 'data-value="confirm"' })}
          <p class="note">Confirmation Face ID. Aucun remboursement n’est fait automatiquement.</p></div>` : ''}</section>` : ''}
      <section aria-labelledby="paiement"><h2 class="sec" id="paiement">Paiement</h2><div class="sheet">
        <div class="row"><div class="grow"><p class="p strong">Payé</p><p class="s">${esc(euro(o.subtotal_cents))} article${o.shipping_cents ? `, ${esc(euro(o.shipping_cents))} de livraison` : ''}</p></div><span class="num">${esc(euro(o.total_cents))}</span></div>
        <div class="row"><p class="p grow">Frais Stripe</p><span class="p muted">${o.fee_cents === null ? 'inconnus' : `− ${esc(euro(o.fee_cents))}`}</span></div>
        ${o.refunded_cents ? `<div class="row"><p class="p grow">Remboursé</p><span class="p muted">− ${esc(euro(o.refunded_cents))}</span></div>` : ''}
        <div class="row"><p class="p grow strong">Net pour toi</p><span class="num rose">${esc(euro(o.net_cents))}</span></div></div></section>
      <section aria-labelledby="suivi"><h2 class="sec" id="suivi">Suivi</h2><div class="sheet pad"><ol class="tl">${steps.map(([t, at, done]) => `<li class="step"><span class="node ${done ? 'done' : ''}"></span>
        <span class="grow"><span class="p block ${done ? 'strong' : ''}">${esc(t)}</span><span class="s block">${done ? (at ? esc(longDate(at)) : 'Fait') : 'À venir'}</span></span></li>`).join('')}</ol>
        ${shippedDetail?.tracking ? `<p class="s">Suivi ${esc(shippedDetail.carrier ?? '')} : <span class="id">${esc(shippedDetail.tracking)}</span></p>` : ''}
        ${relay && o.relay ? `<p class="s">Point relais : ${esc([o.relay.name, o.relay.address?.line1, [o.relay.address?.postcode, o.relay.address?.city].filter(Boolean).join(' ')].filter(Boolean).join(', '))}</p>` : ''}</div></section>
      ${o.actions.fulfil && next ? `<section class="stack-left" aria-label="Préparation et expédition">${next === 'shipped' ? `<div class="pair">
          <label class="field"><span class="sr-only">Transporteur</span><input id="carrier" data-fk="carrier" placeholder="Transporteur (facultatif)" maxlength="40"></label>
          <label class="field"><span class="sr-only">Numéro de suivi</span><input id="tracking" data-fk="tracking" placeholder="Numéro de suivi (facultatif)" maxlength="40"></label></div>` : ''}
        ${btn('fulfil', esc(nextText[next]), { extra: `data-value="${next}"`, fk: `fulfil:${next}` })}
        <p class="note">Étiquette automatique : avec le compte transporteur, pas encore choisi.${next === 'shipped' && o.source === 'storefront' ? ' Le client reçoit un e-mail si les e-mails sont configurés.' : ''}</p></section>` : ''}
      <section class="sheet pad client" aria-labelledby="client"><div class="row flat">${I.user}<div class="grow"><h2 class="p strong" id="client">${c ? 'Coordonnées' : 'Coordonnées masquées'}</h2>
        <p class="s">${o.contact.stored ? (c ? 'Consultation notée dans l’historique.' : 'Visibles après Face ID ; chaque consultation est notée dans l’historique.') : 'Non enregistrées : à lire dans Stripe.'}</p></div>
        ${o.contact.stored && !c ? btn('contact', 'Afficher', { cls: 'pill tall', fk: 'contact' }) : ''}</div>
        ${c ? (c.archived ? '<p class="s">Coordonnées archivées (au-delà de 90 jours après la livraison).</p>' : `<dl class="dl"><dt>Nom</dt><dd>${esc(c.name ?? '—')}</dd><dt>E-mail</dt><dd>${esc(c.email ?? '—')}</dd><dt>Téléphone</dt><dd>${esc(c.phone ?? '—')}</dd>
          ${c.recipient_name ? `<dt>Retrait par</dt><dd>${esc(c.recipient_name)}</dd>` : ''}${c.address ? `<dt>Adresse</dt><dd>${esc([c.shipping_name, c.address.line1, c.address.line2, [c.address.postal_code, c.address.city].filter(Boolean).join(' '), c.address.country].filter(Boolean).join(', '))}</dd>` : ''}</dl>`) : ''}</section>
      ${o.actions.refund || o.actions.return_check ? `<section aria-labelledby="sav"><h2 class="sec" id="sav">Retour et remboursement</h2><div class="sheet pad">
        ${o.actions.return_check ? `<p class="s">Retour reçu : contrôle la pièce. Seule une pièce revendable revient en stock, une seule fois.</p>
          <div class="pair">${btn('return', 'Revendable', { cls: 'btn ghost', fk: 'return-ok', extra: 'data-value="1"' })}${btn('return', 'Non revendable', { cls: 'btn ghost', fk: 'return-ko', extra: 'data-value="0"' })}</div>` : ''}
        ${o.actions.refund ? `<label class="field"><span class="sr-only">Montant à rembourser en euros</span><input id="refund" data-fk="refund" inputmode="decimal" placeholder="Montant à rembourser (max. ${esc(euro(o.total_cents - o.refunded_cents))})"></label>
          ${btn('refund', 'Rembourser avec Face ID', { cls: 'btn danger', fk: 'refund-go' })}<p class="note">Remboursement Stripe décidé par toi. Il ne remet jamais une pièce en stock.</p>` : ''}
      </div></section>` : ''}
    </div>`;
  },

  stock: () => {
    const d = state.data.stock;
    if (!d) return `${header('Stock')}<div class="body">${errorBox()}${loadingBox()}</div>`;
    const drop = d.drop;
    const cell = (v, known = true) => `<div class="${known ? '' : 'q'}">${known ? esc(v) : '—'}</div>`;
    const sizes = drop?.sizes ?? [];
    const total = (k) => sizes.reduce((n, s) => n + s[k], 0);
    const confirmed = drop?.confirmed;
    const moves = Object.fromEntries(d.movements.map((m) => [m.reason, m]));
    return `${header('Stock', { right: drop ? `<span class="s">${esc(drop.name)}${drop.product ? `, ${esc(drop.product.name)}` : ''}</span>` : '' })}
    <div class="body fade">${errorBox()}${d.problems.length ? `<p class="notice error" role="alert">Écart entre le stock et son registre : ${esc(d.problems[0])}</p>` : ''}
      ${drop ? `<section>${strip(drop, true)}</section>
      <section aria-labelledby="partaille"><h2 class="sec" id="partaille">Par taille</h2><div class="sheet table">
        <div class="grid g${Math.min(sizes.length + 2, 8)}" role="table" aria-label="Stock par taille">
          <div class="h l" role="columnheader">État</div>${sizes.map((s) => `<div class="h" role="columnheader">${esc(s.size)}</div>`).join('')}<div class="h" role="columnheader">Total</div>
          ${[['Physique', 'on_hand'], ['Disponible', 'available'], ['Réservé', 'reserved']].map(([t, k]) => `<div class="l" role="rowheader">${t}</div>${sizes.map((s) => cell(s[k], s.confirmed)).join('')}${cell(total(k), confirmed)}`).join('')}
          <div class="l" role="rowheader">Vendu</div>${sizes.map((s) => cell(s.sold)).join('')}<div class="rose">${esc(total('sold') + drop.sold_unknown_size)}</div>
        </div>
        <p class="note">${confirmed ? `Inventaire du ${esc(drop.last_count ? dayTitle(drop.last_count.at) : '—')}.` : '« — » : à remplir par ton inventaire.'}${drop.sold_unknown_size ? ` ${esc(plural(drop.sold_unknown_size, 'vente'))} sans taille connue.` : ''}</p></div></section>` : '<p class="s">Aucun produit.</p>'}
      ${nav('inventory', `${I.hanger} ${confirmed ? 'Refaire l’inventaire' : 'Commencer l’inventaire'}`, { cls: 'btn main' })}
      <div class="sheet">
        ${nav('settings', `<p class="p grow">Alerte stock faible</p><span class="s">${esc(d.low_stock_threshold)} par taille</span>${I.chev}`)}
        <div class="row"><p class="p grow">Retours à contrôler</p><span class="s">${d.returns_pending ? esc(d.returns_pending) : 'Aucun'}</span></div>
        ${nav('movements', `<p class="p grow">Mouvements</p><span class="s">${esc(plural(moves.sale?.count ?? 0, 'vente'))}${moves.legacy_link_sale ? `, ${esc(moves.legacy_link_sale.count)} lien 1.0` : ''}${moves.return_restock ? `, ${esc(moves.return_restock.count)} retour(s)` : ''}</span>${I.chev}`)}
      </div></div>`;
  },

  inventory: () => {
    const inv = state.data.inventory;
    if (!inv) return `${header('Inventaire', { back: ['stock', 'Stock'] })}<div class="body">${errorBox()}${loadingBox()}</div>`;
    const counted = inv.variants.reduce((n, v) => n + (state.counts[v.sku] ?? 0), 0);
    const reconciled = counted + state.aside.promised + state.aside.damaged;
    const ref = inv.reference_total;
    const gap = ref === null ? null : reconciled - ref;
    const n = Math.abs(gap ?? 0);
    const msg = reconciled === 0 && state.aside.unshipped === 0 ? 'Commence par les S : chaque pièce compte une seule fois.'
      : gap === null ? 'Aucun total théorique pour ce drop.' : gap === 0 ? `Ça correspond aux ${ref} pièces théoriques.`
        : `${plural(n, 'pièce')} de ${gap > 0 ? 'plus' : 'moins'} que prévu : vérifie avant de valider.`;
    const counter = (key, labelText, value, small = false) => `<div class="counter">
      <button type="button" class="stepbtn" data-action="dec" data-key="${esc(key)}" data-fk="dec:${esc(key)}" aria-label="Retirer une pièce : ${esc(labelText)}">−</button>
      <span class="val${small ? ' small' : ''}" aria-live="polite" aria-label="${esc(`${labelText} : ${value}`)}">${esc(value)}</span>
      <button type="button" class="stepbtn" data-action="inc" data-key="${esc(key)}" data-fk="inc:${esc(key)}" aria-label="Ajouter une pièce : ${esc(labelText)}">+</button></div>`;
    return `<header class="top">${nav('stock', `${I.back} Stock`, { cls: 'back' })}<span class="s">${inv.variants.every((v) => v.confirmed) ? 'Stock déjà confirmé' : 'Stock non confirmé'}</span></header>
    <div class="body tight fade"><div class="heading"><h1 class="h1 screen-title" tabindex="-1" data-fk="title">Inventaire</h1><p class="s">Lis l’étiquette de chaque pièce, compte, puis recompte une fois.</p></div>
      ${errorBox()}
      <section aria-labelledby="avendre"><h2 class="sec" id="avendre">À vendre</h2><div class="sheet">
        ${inv.variants.map((v) => `<div class="row tall">${sizeTag(v.size)}<p class="p grow strong">Taille ${esc(v.size)}${v.reserved ? `<span class="s block">${esc(v.reserved)} en cours de paiement</span>` : ''}</p>
          ${counter(`sku:${v.sku}`, `taille ${v.size}`, state.counts[v.sku] ?? 0)}</div>`).join('')}</div></section>
      <section aria-labelledby="decote"><h2 class="sec" id="decote">Mises de côté, hors vente</h2><div class="sheet">
        <div class="row"><p class="p grow">Commandes payées pas encore parties</p>${counter('aside:unshipped', 'commandes pas encore parties', state.aside.unshipped, true)}</div>
        <div class="row"><p class="p grow">Promises ou à offrir</p>${counter('aside:promised', 'pièces promises', state.aside.promised, true)}</div>
        <div class="row"><p class="p grow">Abîmées</p>${counter('aside:damaged', 'pièces abîmées', state.aside.damaged, true)}</div></div></section>
      <section class="sheet pad" aria-live="polite">
        <div class="line"><span class="p">Comptées à vendre</span><span class="num">${esc(counted)}</span></div>
        ${gap === null ? '' : `<div class="line"><span class="p">Écart avec les ${esc(ref)} théoriques</span><span class="num rose">${gap > 0 ? '+' : gap < 0 ? '−' : ''}${esc(n)}</span></div>`}
        <p class="s">${esc(msg)}</p>
        ${state.saved ? `<p class="p strong">Inventaire enregistré. Limite proposée pour le lien 1.0 : ${esc(state.saved.stripe_limit_proposal)} paiements (les 2 déjà comptés + les pièces à vendre). À appliquer par toi dans Stripe : rien n’est modifié sans ton OK.</p>` : ''}</section>
      <p class="note">En validant, ces quantités deviennent le stock vendable de la boutique 2.0. Confirmation Face ID demandée.</p>
      ${btn('save-inventory', state.saved ? 'Inventaire enregistré' : 'Valider l’inventaire', { disabled: Boolean(state.saved) })}</div>`;
  },

  movements: () => {
    const d = state.data.movements;
    const reasons = { inventory_count: 'Inventaire', adjustment: 'Ajustement', hold: 'Réservation', release: 'Réservation rendue', sale: 'Vente', late_sale: 'Vente tardive',
      legacy_link_sale: 'Vente lien 1.0', imported_sale: 'Vente importée', return_restock: 'Retour remis en stock' };
    const sizes = state.data.stock?.drop?.sizes ?? [];
    return `${header('Mouvements', { back: ['stock', 'Stock'] })}<div class="body fade">${errorBox()}${noticeBox()}
      <section aria-labelledby="ajuster"><h2 class="sec" id="ajuster">Ajuster le stock</h2><div class="sheet pad">
        <p class="s">Pièce retrouvée, abîmée ou donnée : ajuste avec un motif. Confirmation Face ID ; jamais sous les pièces en cours de paiement.</p>
        <div class="pair"><label class="field"><span class="sr-only">Taille</span><select id="adj-sku" data-fk="adj-sku">${sizes.map((s) => `<option value="${esc(s.sku)}">Taille ${esc(s.size)}</option>`).join('')}</select></label>
          <label class="field"><span class="sr-only">Variation</span><input id="adj-delta" data-fk="adj-delta" inputmode="numeric" placeholder="+1 ou −1"></label></div>
        <label class="field"><span class="sr-only">Motif</span><input id="adj-note" data-fk="adj-note" placeholder="Motif (obligatoire)" maxlength="200"></label>
        ${btn('adjust', 'Ajuster avec Face ID', { cls: 'btn ghost' })}</div></section>
      <section aria-labelledby="registre"><h2 class="sec" id="registre">Registre (non modifiable)</h2><div class="sheet">
        ${!d ? loadingBox() : d.movements.length ? d.movements.map((m) => `<div class="row"><span class="grow"><span class="p block">${esc(reasons[m.reason] ?? m.reason)}${m.size ? `, taille ${esc(m.size)}` : ''}</span>
          <span class="s block">${esc(longDate(m.at))}${m.note ? ` · ${esc(m.note)}` : ''}</span></span><span class="num small ${m.d_on_hand < 0 ? '' : 'rose'}">${m.d_on_hand > 0 ? '+' : ''}${esc(m.d_on_hand || (m.d_reserved ? `${m.d_reserved > 0 ? '+' : ''}${m.d_reserved}` : '0'))}</span></div>`).join('')
    : '<div class="row"><span class="s">Aucun mouvement.</span></div>'}</div>
        ${d?.next ? btn('more-movements', 'Afficher plus', { cls: 'btn ghost' }) : ''}</section></div>`;
  },

  finances: () => {
    const f = state.data.finances;
    if (!f) return `${header('Finances')}<div class="body">${errorBox()}${loadingBox()}</div>`;
    const chart = () => {
      if (!f.cumulative.length) return '<p class="s">La courbe apparaît après la première vente.</p>';
      const top = Math.max(f.investment_cents ?? 0, ...f.cumulative.map((c) => c.net_cents), 1);
      const pts = f.cumulative.map((c, i) => [10 + (330 * (i + 1)) / f.cumulative.length, 150 - (108 * Math.max(c.net_cents, 0)) / top]);
      const path = `M10 150 ${pts.map(([x, y], i) => `H${x.toFixed(1)} V${y.toFixed(1)}${i === pts.length - 1 ? ' H340' : ''}`).join(' ')}`;
      const months = f.cumulative.map((c, i) => `<text class="axis" x="${(10 + (330 * (i + 1)) / f.cumulative.length - 14).toFixed(1)}" y="170">${esc(fmt({ month: 'short' }).format(new Date(`${c.month}-15T12:00:00Z`)))}</text>`).join('');
      return `<svg class="chart" viewBox="0 0 350 178" role="img" aria-label="${esc(`Net cumulé : ${f.cumulative.map((c) => `${euro(c.net_cents)} fin ${c.month}`).join(', ')}${f.investment_cents ? `, face à ${euro(f.investment_cents)} investis` : ''}`)}">
        ${f.investment_cents ? `<line class="goal" x1="10" y1="${(150 - (108 * f.investment_cents) / top).toFixed(1)}" x2="340" y2="${(150 - (108 * f.investment_cents) / top).toFixed(1)}"/><text class="goal-text" x="10" y="${(150 - (108 * f.investment_cents) / top - 8).toFixed(1)}">${esc(euro(f.investment_cents))} investis</text>` : ''}
        <line class="base" x1="10" y1="150" x2="340" y2="150"/><path class="curve" d="${path}"/>
        ${pts.map(([x, y], i) => `<circle class="${i === pts.length - 1 ? 'pt rose' : 'pt'}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5"/>`).join('')}
        <text class="last" x="340" y="${(pts.at(-1)[1] - 10).toFixed(1)}" text-anchor="end">${esc(euro(f.cumulative.at(-1).net_cents))}</text>${months}</svg>`;
    };
    return `${header('Finances', { right: '<span class="s">Depuis le lancement</span>' })}<div class="body fade">${errorBox()}${noticeBox()}
      <section class="sheet pad" aria-labelledby="recup"><h2 class="sec flat" id="recup">${f.investment_cents ? 'Investissement récupéré' : 'Net encaissé'}${f.fees_unknown ? ', avant frais inconnus' : ''}</h2>
        <span class="big rose">${f.investment_cents ? esc(pct(f.recovered_ratio)) : esc(euro(f.net_cents))}</span>
        ${f.investment_cents ? `${track(f.recovered_ratio ?? 0)}<p class="s">${esc(euro(f.net_cents))} nets de frais Stripe sur ${esc(euro(f.investment_cents))} investis. Il reste ${esc(euro(f.remaining_cents))} à récupérer.</p>`
    : '<p class="s">Déclare ton investissement ci-dessous pour suivre ce qui est récupéré.</p>'}</section>
      <section aria-labelledby="courbe"><h2 class="sec" id="courbe">Net cumulé${f.investment_cents ? ' face à l’investissement' : ''}</h2><div class="sheet pad">${chart()}</div></section>
      <section aria-labelledby="detail"><h2 class="sec" id="detail">Détail</h2><div class="sheet">
        <div class="row"><p class="p grow">Encaissé (${esc(plural(f.sales, 'vente'))})</p><span class="p">${esc(euro(f.collected_cents))}</span></div>
        <div class="row"><p class="p grow">Frais Stripe${f.fees_unknown ? ` <span class="s block">connus seulement ; inconnus pour ${esc(plural(f.fees_unknown, 'vente'))}</span>` : ''}</p><span class="p muted">− ${esc(euro(f.fees_cents))}</span></div>
        ${f.refunds_cents ? `<div class="row"><p class="p grow">Remboursements</p><span class="p muted">− ${esc(euro(f.refunds_cents))}</span></div>` : ''}
        <div class="row"><p class="p grow strong">Net${f.fees_unknown ? ' <span class="s block">avant les frais inconnus</span>' : ''}</p><span class="num rose">${esc(euro(f.net_cents))}</span></div>
        ${f.stripe ? `<div class="row"><p class="p grow">Disponible sur Stripe</p><span class="p">${esc(euro(f.stripe.available_cents))}</span></div>
          <div class="row"><p class="p grow">En attente sur Stripe</p><span class="p">${esc(euro(f.stripe.pending_cents))}</span></div>` : ''}
        ${f.contribution_rate_bp !== null ? `<div class="row"><p class="p grow">Cotisations, estimation à ${esc((f.contribution_rate_bp / 100).toFixed(1).replace('.', ','))} %</p><span class="p muted">− ${esc(euro(f.contribution_estimate_cents))}</span></div>` : ''}
      </div></section>
      <section aria-labelledby="declarer"><h2 class="sec" id="declarer">Tes déclarations</h2><div class="sheet pad">
        <div class="pair"><label class="field"><span class="sr-only">Investissement en euros</span><input id="fin-invest" data-fk="fin-invest" inputmode="decimal" placeholder="Investissement (€)" value="${f.investment_cents === null ? '' : esc((f.investment_cents / 100).toFixed(2).replace('.', ','))}"></label>
          <label class="field"><span class="sr-only">Taux de cotisations en pourcentage</span><input id="fin-rate" data-fk="fin-rate" inputmode="decimal" placeholder="Taux de cotisations (%)" value="${f.contribution_rate_bp === null ? '' : esc((f.contribution_rate_bp / 100).toFixed(1).replace('.', ','))}"></label></div>
        ${btn('finance-save', 'Enregistrer avec Face ID', { cls: 'btn ghost' })}<p class="note">Chiffres saisis par toi ; l’estimation des cotisations ne remplace pas ta déclaration URSSAF.</p></div></section>
      <section aria-labelledby="exports"><h2 class="sec" id="exports">Exports</h2><div class="chips">
        ${btn('export', `${I.download} Livre des recettes`, { cls: 'pill tall', fk: 'export-recettes', extra: 'data-value="recettes"' })}
        ${btn('export', `${I.download} Commandes (CSV)`, { cls: 'pill tall', fk: 'export-orders', extra: 'data-value="orders"' })}</div>
        <p class="note">Confirmation Face ID ; chaque export est noté dans l’historique. Registre des achats : à venir, avec la saisie de tes achats.</p></section></div>`;
  },

  notifications: () => {
    const d = state.data.notifications;
    if (!d) return `${header('Notifications', { back: ['today', 'Aujourd’hui'] })}<div class="body">${errorBox()}${loadingBox()}</div>`;
    const groups = new Map();
    for (const n of d.notifications) {
      const key = dayTitle(n.at);
      groups.set(key, [...(groups.get(key) ?? []), n]);
    }
    const ch = d.channels;
    const pushHere = state.pushHere;
    // Abonnement de cet iPhone connu et actif côté serveur, avec la clé actuelle.
    const here = (ch.push.device_list ?? []).find((x) => x.active && x.fp === state.pushFp);
    const pushKnown = Boolean(state.pushFp && here && (!state.pushKey || state.pushKey === ch.push.public_key));
    return `<header class="top">${nav('today', `${I.back} Aujourd’hui`, { cls: 'back' })}<span class="s">${esc(plural(d.unread, 'nouvelle'))}</span></header>
    <div class="body fade"><h1 class="h1 screen-title" tabindex="-1" data-fk="title">Notifications</h1>${errorBox()}${noticeBox()}
      <div class="sheet">
        <div class="row"><span class="grow"><span class="p strong block">Discord</span><span class="s block">${ch.discord ? 'Salon privé configuré' : 'Webhook d’un salon privé à saisir dans Cloudflare'}</span></span>${pill(ch.discord ? 'Actif' : 'À configurer', ch.discord ? 'on' : 'wait')}</div>
        <div class="row"><span class="grow"><span class="p strong block">Sur cet iPhone</span><span class="s block">${!ch.push.configured ? 'Clés de notification à saisir dans Cloudflare'
    : pushHere && !pushKnown ? 'Abonnement inconnu du serveur, expiré ou créé avec une ancienne clé : touche « Activer »'
      : pushHere ? (ch.push.failing ? `Activées. ${ch.push.failing}` : `Activées. ${VERIFIED[here?.verification] ?? ''}`.trim()) : 'Dès que STUDIO est sur ton écran d’accueil'}</span></span>
          ${ch.push.configured && (!pushHere || !pushKnown) ? btn('push-enable', 'Activer', { cls: 'pill tall' }) : pill(pushHere ? 'Actif' : 'À configurer', pushHere ? 'on' : 'wait')}</div>
        ${ch.push.configured && pushHere && pushKnown ? `<div class="row top-align"><span class="grow"><span class="p strong block">Essai de notification</span><span class="s block">${state.pushTest
    ? esc(pushTestText(state.pushTest)) : 'Envoie une notification à cet iPhone et affiche la réponse d’Apple.'}</span></span>${btn('push-test', 'Envoyer un essai', { cls: 'pill tall' })}</div>` : ''}
        <div class="row"><span class="grow"><span class="p strong block">E-mails aux clients</span><span class="s block">${ch.email ? 'Confirmations et suivi envoyés' : 'Resend et un domaine vérifié à configurer'}</span></span>${pill(ch.email ? 'Actif' : 'À configurer', ch.email ? 'on' : 'wait')}</div>
      </div>
      ${d.unread ? btn('read-all', 'Tout marquer comme lu', { cls: 'btn ghost' }) : ''}
      ${[...groups].map(([day, items]) => `<section aria-label="${esc(day)}"><h2 class="sec">${esc(day)}</h2><div class="sheet">${items.map((n) => {
    const inner = `<span class="dot ${n.read ? 'muted' : n.level === 'critical' ? 'alerte' : 'rose'} top-dot"></span><span class="grow"><span class="p strong block">${esc(n.title)}</span><span class="s block">${esc(n.body)}</span></span><span class="s">${esc(hour(n.at))}</span>`;
    return n.order_id ? nav('order', inner, { cls: 'row action top-align', id: n.order_id }) : `<div class="row top-align">${inner}</div>`;
  }).join('')}</div></section>`).join('') || '<p class="s">Aucune notification pour l’instant.</p>'}
      <p class="note">Rapport quotidien chaque jour à 10 h, heure de Paris. Sur Discord et l’iPhone, les mêmes alertes partent sans nom, adresse ni téléphone.</p></div>`;
  },

  more: () => `${header('Plus')}<div class="body fade"><nav class="sheet" aria-label="Autres espaces">
      ${[['drops', I.tag, 'Drops et codes promo', 'Produits, brouillons, quantités déclarées'], ['performance', I.bars, 'Performances', 'Paiements abandonnés, ventes par taille'],
    ['requests', I.mail, 'Demandes des clients', 'Messages, retours, rétractations'], ['health', I.pulse, 'Santé du site et historique', 'Boutique, paiement, sauvegardes, journal'],
    ['notifications', I.bell, 'Notifications', 'Discord, iPhone, e-mails'], ['finances', I.download, 'Exports comptables', 'Livre des recettes, commandes'],
    ['settings', I.gear, 'Réglages et sécurité', 'Face ID, appareils, codes de secours']].map(([s, icon, t, sub]) => nav(s, `<span class="rose">${icon}</span><span class="grow"><span class="p strong block">${t}</span><span class="s block">${sub}</span></span>${I.chev}`)).join('')}
    </nav>${btn('logout', 'Se déconnecter', { cls: 'btn ghost' })}<p class="note centered-text">SAYLESS STUDIO</p></div>`,

  drops: () => {
    const d = state.data.drops;
    if (!d) return `${header('Drops', { back: ['more', 'Plus'] })}<div class="body">${errorBox()}${loadingBox()}</div>`;
    const statusText = { published: ['En ligne', 'on'], draft: ['Brouillon', 'wait'], scheduled: ['Programmé', 'wait'], archived: ['Archivé', ''] };
    return `${header('Drops', { back: ['more', 'Plus'], right: '<span class="s">Rien ne part sans toi</span>' })}<div class="body fade">${errorBox()}${noticeBox()}
      ${d.drops.map((drop) => `<section class="sheet pad" aria-label="${esc(drop.name)}"><div class="row flat"><div class="thumb small" role="img" aria-label="Photo du produit"></div><div class="grow col">
          <div class="line"><h2 class="h2">${esc(drop.name)}</h2>${drop.product ? pill(...statusText[drop.product.status] ?? [drop.product.status]) : ''}</div>
          ${drop.products.map((p) => `<p class="s">${esc(p.name)}, tailles ${esc(p.sizes.join(', ') || '—')}, ${esc(euro(p.price_cents))}</p>`).join('')}
          <p class="s">${drop.received_total === null ? 'Pièces reçues : à déclarer' : `${esc(drop.received_total)} pièces reçues : ${esc(drop.sold)} vendue(s), ${esc(drop.gifted_total ?? 0)} offerte(s)`}</p></div></div>
        <div class="pair"><label class="field"><span class="sr-only">Pièces reçues pour ${esc(drop.name)}</span><input id="rec-${esc(drop.id)}" data-fk="rec-${esc(drop.id)}" inputmode="numeric" placeholder="Pièces reçues" value="${esc(drop.received_total ?? '')}"></label>
          <label class="field"><span class="sr-only">Pièces offertes pour ${esc(drop.name)}</span><input id="gift-${esc(drop.id)}" data-fk="gift-${esc(drop.id)}" inputmode="numeric" placeholder="Pièces offertes" value="${esc(drop.gifted_total ?? '')}"></label></div>
        ${btn('declare', 'Enregistrer avec Face ID', { cls: 'btn ghost', fk: `declare:${drop.id}`, extra: `data-value="${esc(drop.id)}"` })}
        ${drop.products.filter((p) => p.status !== 'published').map((p) => `<div class="row"><span class="p grow">${esc(p.name)} : ${esc(statusText[p.status]?.[0] ?? p.status)}</span>
          ${btn('product-status', 'Mettre en ligne', { cls: 'pill tall', fk: `pub:${p.id}`, extra: `data-value="${esc(p.id)}" data-status="published"` })}</div>`).join('')}
      </section>`).join('')}
      <section class="sheet pad" aria-labelledby="brouillon"><h2 class="p strong" id="brouillon">Préparer un produit</h2>
        <p class="s">Il reste en brouillon, invisible et impossible à acheter, jusqu’à ta mise en ligne. Photos et texte de la fiche : à ajouter côté boutique.</p>
        <div class="pair"><label class="field"><span class="sr-only">Nom</span><input id="np-name" data-fk="np-name" placeholder="Nom du produit" maxlength="80"></label>
          <label class="field"><span class="sr-only">Prix en euros</span><input id="np-price" data-fk="np-price" inputmode="decimal" placeholder="Prix (€)"></label></div>
        <div class="pair"><label class="field"><span class="sr-only">Drop</span><input id="np-drop" data-fk="np-drop" placeholder="Drop (ex. drop-02)" maxlength="40"></label>
          <label class="field"><span class="sr-only">Tailles séparées par des virgules</span><input id="np-sizes" data-fk="np-sizes" placeholder="Tailles (S, M, L)" maxlength="40"></label></div>
        ${btn('product-create', 'Créer le brouillon avec Face ID', { cls: 'btn ghost' })}</section>
      <section aria-labelledby="codes"><h2 class="sec" id="codes">Codes promo</h2><div class="sheet"><div class="row"><span class="grow"><span class="p strong block">Pas encore disponibles dans la boutique 2.0</span>
        <span class="s block">${esc(d.promo.note)}</span></span></div></div></section></div>`;
  },

  performance: () => {
    const p = state.data.performance;
    if (!p) return `${header('Performances', { back: ['more', 'Plus'] })}<div class="body">${errorBox()}${loadingBox()}</div>`;
    const max = Math.max(...p.by_size.map((s) => s.quantity), 1);
    return `${header('Performances', { back: ['more', 'Plus'], right: p.since ? `<span class="s">Depuis le ${esc(dayTitle(p.since))}</span>` : '' })}<div class="body fade">${errorBox()}
      <div class="sheet">
        <div class="row"><span class="grow"><span class="p strong block">Ventes</span><span class="s block">Boutique 2.0 et lien 1.0 (${esc(p.legacy_sales)})</span></span><span class="num">${esc(p.sales)}</span></div>
        <div class="row"><span class="grow"><span class="p strong block">Paiements ouverts sans achat</span><span class="s block">Tentatives de la boutique 2.0 abandonnées ou refusées</span></span><span class="num">${esc(p.abandoned)}</span></div>
        <div class="row"><span class="grow"><span class="p strong block">Paiements menés au bout</span><span class="s block">${p.attempts ? `Sur ${esc(plural(p.attempts, 'tentative'))} de la boutique 2.0` : 'Aucune tentative pour l’instant'}</span></span><span class="num rose">${esc(pct(p.conversion))}</span></div>
        <div class="row"><span class="grow"><span class="p strong block">Livraison choisie</span><span class="s block">Point relais ${esc(p.shipping.relay)} · domicile ${esc(p.shipping.home)}</span></span></div></div>
      <section aria-labelledby="tailles"><h2 class="sec" id="tailles">Ventes par taille</h2><div class="sheet pad" role="img" aria-label="${esc(`Ventes par taille : ${p.by_size.map((s) => `${s.size ?? 'sans taille'} ${s.quantity}`).join(', ') || 'aucune'}`)}">
        ${p.by_size.length ? p.by_size.map((s) => `<div class="sizebar"><span class="s">${esc(s.size ?? 'Sans taille')}</span>${track(s.quantity / max, s.size ? '' : 'muted')}<span class="p right">${esc(s.quantity)}</span></div>`).join('') : '<p class="s">Aucune vente.</p>'}</div></section>
      <section class="sheet pad" aria-labelledby="visites"><h2 class="p strong" id="visites">Visites et provenance</h2><p class="s">${esc(p.visits_note)}</p></section></div>`;
  },

  health: () => {
    const h = state.data.health;
    if (!h) return `${header('Santé du site', { back: ['more', 'Plus'] })}<div class="body">${errorBox()}${loadingBox()}</div>`;
    const tone = { ok: ['OK', ''], todo: ['À faire', 'wait'], wait: ['En attente', 'wait'], alert: ['Alerte', 'warn'] };
    return `${header('Santé du site', { back: ['more', 'Plus'], right: `<span class="s">${esc(h.environment)}</span>` })}<div class="body fade">${errorBox()}${noticeBox()}
      <div class="sheet">${h.checks.map((c) => `<div class="row top-align"><span class="grow"><span class="p strong block">${esc(c.name)}</span><span class="s block">${esc(c.detail)}</span></span>${pill(...tone[c.state])}</div>`).join('')}</div>
      ${h.outbox?.closable ? `<section aria-labelledby="echecs"><h2 class="sec" id="echecs">Envois échoués</h2><div class="sheet">
        ${h.outbox.groups.map((g) => `<div class="row top-align"><span class="grow"><span class="p strong block">${esc({ push: 'iPhone', discord: 'Discord', email: 'E-mail client' }[g.channel] ?? g.channel)} · ${esc(plural(g.n, 'message'))}</span>
        <span class="s block">${esc(g.explanation)}</span></span></div>`).join('')}
        <div class="row top-align"><span class="grow"><span class="p block">${esc(plural(h.outbox.closable, 'envoi'))} à clôturer</span>
        <span class="s block">Discord et iPhone seulement. Ils restent dans l’historique ; aucun e-mail client n’est touché.</span></span>${btn('outbox-close', 'Clôturer', { cls: 'pill tall' })}</div></div></section>` : ''}
      ${h.uncertain?.length ? `<section aria-labelledby="a-verifier"><h2 class="sec" id="a-verifier">E-mails à vérifier</h2><div class="sheet">
        ${h.uncertain.map((u) => `<div class="row top-align"><span class="grow"><span class="p strong block">${esc(u.label)}${u.reference ? ` ${esc(u.reference)}` : ''}</span>
        <span class="s block">Premier essai ${esc((u.first_attempt_at ?? '').slice(0, 16).replace('T', ' '))} UTC · ${esc(u.attempts)} essai(s)${u.provider_ref ? ` · Resend ${esc(u.provider_ref)}` : ''}</span></span>
        ${btn('email-delivered', 'Il est parti', { cls: 'pill tall', fk: `ev:${u.id}`, extra: `data-value="${esc(u.id)}"` })}
        ${btn('email-resend', 'Renvoyer', { cls: 'pill tall', fk: `er:${u.id}`, extra: `data-value="${esc(u.id)}"` })}</div>`).join('')}</div>
        <p class="note">Resend n’a pas confirmé ces envois et sa protection contre les doublons a expiré. Cherche la référence dans Resend (Emails) : s’il apparaît, choisis « Il est parti » ; sinon « Renvoyer ».</p></section>` : ''}
      <section aria-labelledby="ouverture"><h2 class="sec" id="ouverture">Avant d’ouvrir la boutique 2.0</h2><div class="sheet">
        ${h.readiness.checks.map((c) => `<div class="row"><span class="dot ${c.ok ? 'rose' : c.blocker ? 'alerte' : 'muted'}"></span><span class="p grow">${esc(c.text)}</span>${c.ok ? '' : pill(c.blocker ? 'Bloquant' : 'Conseillé', c.blocker ? 'warn' : '')}</div>`).join('')}</div></section>
      ${state.data.backups?.configured ? `<section aria-labelledby="copies"><h2 class="sec" id="copies">Sauvegardes chiffrées</h2><div class="sheet">
        ${state.data.backups.backups.length ? state.data.backups.backups.slice(0, 5).map((x) => `<div class="row"><span class="grow"><span class="p block">${esc(x.name.startsWith('monthly/') ? 'Mensuelle' : 'Quotidienne')} ${esc(x.name.split('/')[1])}</span>
        <span class="s block">${x.checks === 'ok' ? 'Vérifiée' : 'Non vérifiée'}${x.rows ? ` · ${esc(x.rows)} lignes` : ''}${x.bytes ? ` · ${esc(Math.ceil(x.bytes / 1024))} Ko` : ''}</span></span>
        ${btn('backup-download', 'Télécharger', { cls: 'pill tall', fk: `bk:${x.name}`, extra: `data-value="${esc(x.name)}"` })}</div>`).join('')
      : '<div class="row"><span class="s">Première copie après 3 h du matin.</span></div>'}</div>
        <p class="note">Copie illisible sans ta clé privée, gardée hors ligne. Télécharge-en une chaque semaine et range-la hors de Cloudflare.</p></section>` : ''}
      ${nav('audit', `<span class="grow"><span class="p strong block">Historique</span><span class="s block">Chaque action datée, impossible à modifier ou effacer</span></span>${I.chev}`, { cls: 'sheet row action padded' })}</div>`;
  },

  audit: () => {
    const d = state.data.audit;
    const names = { session_login: 'Connexion', session_failed: 'Connexion refusée', stepup: 'Confirmation Face ID', passkey_added: 'Appareil autorisé', passkey_revoked: 'Appareil retiré',
      recovery_code_used: 'Code de secours utilisé', recovery_codes_regenerated: 'Codes de secours régénérés', sessions_revoked: 'Toutes les sessions fermées', inventory_count: 'Inventaire',
      stock_adjustment: 'Ajustement de stock', view_customer_contact: 'Coordonnées consultées', view_archived_contact: 'Coordonnées archivées consultées', export_livre_recettes: 'Export du livre des recettes',
      export_orders: 'Export des commandes', order_prepared: 'Commande préparée', order_shipped: 'Commande expédiée', order_delivered: 'Commande remise', order_review_resolved: 'Commande vérifiée',
      refund_requested: 'Remboursement demandé', refund_recorded: 'Remboursement enregistré', return_check: 'Retour contrôlé', shop_opened: 'Boutique ouverte', shop_paused: 'Boutique en pause',
      settings_changed: 'Réglages modifiés', backup_downloaded: 'Sauvegarde téléchargée', email_reconciled: 'E-mail rapproché', terms_published: 'CGV publiées', legacy_link_sale: 'Vente lien 1.0', legacy_sync: 'Synchronisation lien 1.0', drop_declared: 'Quantités déclarées',
      product_drafted: 'Produit en brouillon', product_status: 'Statut de produit', price_changed: 'Prix modifié', finance_settings: 'Déclarations financières', push_subscribed: 'Notifications activées', push_test: 'Essai de notification iPhone', outbox_closed: 'Envois échoués clôturés', push_subscribe_refused: 'Abonnement expiré refusé', push_reponse_tardive: 'Réponse tardive du service de notification (ignorée)',
      discord_destination_retiree: 'Ancien webhook Discord retiré', discord_destination_reprise: 'Webhook Discord de nouveau utilisé',
      request_received: 'Demande reçue', request_status: 'Demande traitée', notification_resolved: 'Alerte traitée', purge_customer_contacts: 'Coordonnées purgées', import_sale: 'Vente importée' };
    return `${header('Historique', { back: ['health', 'Santé du site'] })}<div class="body fade">${errorBox()}<div class="sheet">
      ${!d ? loadingBox() : d.entries.length ? d.entries.map((e) => `<div class="row"><span class="grow"><span class="p block">${esc(names[e.action] ?? e.action)}</span>
        <span class="s block">${esc(longDate(e.at))} · ${esc(e.actor)}${e.result && e.result !== 'ok' ? ` · ${esc(e.result)}` : ''}</span></span></div>`).join('') : '<div class="row"><span class="s">Le journal démarre à ta première connexion.</span></div>'}
      </div>${d?.next ? btn('more-audit', 'Afficher plus', { cls: 'btn ghost' }) : ''}</div>`;
  },

  settings: () => {
    const s = state.data.settings;
    if (!s) return `${header('Réglages', { back: ['more', 'Plus'] })}<div class="body">${errorBox()}${loadingBox()}</div>`;
    const open = s.shop.mode === 'open';
    const blockers = s.readiness.checks.filter((c) => c.blocker && !c.ok);
    const threshold = state.form.threshold ?? s.low_stock_threshold;
    return `${header('Réglages', { back: ['more', 'Plus'], right: '<span class="s">Face ID redemandé pour les changements</span>' })}<div class="body fade">${errorBox()}${noticeBox()}
      <section aria-labelledby="boutique"><h2 class="sec" id="boutique">Boutique 2.0</h2>
        <div class="seg" role="group" aria-label="État de la boutique">
          <button type="button" class="${open ? 'on' : ''}" aria-pressed="${open}" data-action="shop" data-value="open" data-fk="shop-open" ${state.busy ? 'disabled' : ''}>Ouverte</button>
          <button type="button" class="${open ? '' : 'on'}" aria-pressed="${!open}" data-action="shop" data-value="paused" data-fk="shop-paused" ${state.busy ? 'disabled' : ''}>En pause</button></div>
        ${!open && blockers.length ? `<p class="note">Ouverture possible quand ces étapes sont faites : ${esc(blockers.map((c) => c.text).join(' ; '))}.</p>` : ''}
        ${!open ? `<div class="quote">DROP 01 — TEMPORARILY UNAVAILABLE.\n\nLa boutique est momentanément indisponible. Retrouvez-nous prochainement sur saylessbrand.fr.\n\nInstagram : @sayless.brand\n\nSAY LESS. DO MORE.</div>
          <p class="note">Paiements bloqués ; ce message remplace les boutons d’achat. Jamais « SOLD OUT » pendant une pause.</p>` : ''}</section>
      <div class="sheet">
        <div class="row"><span class="grow"><span class="p strong block">Alerte stock faible</span><span class="s block">Pièces restantes par taille</span></span>
          <div class="counter"><button type="button" class="stepbtn" data-action="threshold" data-value="-1" data-fk="th-dec" aria-label="Baisser le seuil">−</button>
          <span class="val small" aria-live="polite" aria-label="${esc(`Seuil : ${threshold}`)}">${esc(threshold)}</span>
          <button type="button" class="stepbtn" data-action="threshold" data-value="1" data-fk="th-inc" aria-label="Monter le seuil">+</button></div></div>
        ${threshold !== s.low_stock_threshold ? `<div class="row">${btn('threshold-save', 'Enregistrer le seuil avec Face ID', { cls: 'btn ghost' })}</div>` : ''}
        <div class="row"><span class="grow"><span class="p strong block">Rapport quotidien</span><span class="s block">Heure de Paris, changement d’heure compris</span></span><span class="num">10:00</span></div></div>
      <section aria-labelledby="lien"><h2 class="sec" id="lien">Lien de paiement 1.0</h2><div class="sheet pad">
        <p class="s">Identifiants du lien et de son prix dans Stripe (plink_… et price_…). Une vente d’un autre lien reste « à vérifier ».</p>
        <label class="field"><span class="sr-only">Identifiant du lien</span><input id="legacy-link" data-fk="legacy-link" placeholder="plink_…" value="${esc(s.legacy.payment_link_id)}" maxlength="80"></label>
        <label class="field"><span class="sr-only">Identifiant du prix</span><input id="legacy-price" data-fk="legacy-price" placeholder="price_…" value="${esc(s.legacy.price_id)}" maxlength="80"></label>
        ${btn('legacy-save', 'Enregistrer avec Face ID', { cls: 'btn ghost' })}
        ${s.legacy.payment_link_id ? btn('legacy-sync', 'Relire les ventes du lien chez Stripe', { cls: 'btn ghost' }) : ''}</div></section>
      <section aria-labelledby="cgv"><h2 class="sec" id="cgv">Conditions générales de vente</h2><div class="sheet pad">
        <p class="s">${s.terms?.archived ? `Version en vigueur : ${esc(s.terms.version)}, publiée le ${esc(dayTitle(s.terms.published_at * 1000))}. Le texte accepté par chaque client est conservé.` : 'Aucune version publiée : la boutique ne peut pas ouvrir.'}</p>
        <label class="field"><span class="sr-only">Nouvelle version</span><input id="terms-version" data-fk="terms-version" placeholder="Version (ex. 2026-12-01)" maxlength="40"></label>
        <label class="field area"><span class="sr-only">Texte des CGV</span><textarea id="terms-body" data-fk="terms-body" rows="5" placeholder="Texte complet des CGV, identique à la page de la boutique"></textarea></label>
        ${btn('terms-publish', 'Publier cette version avec Face ID', { cls: 'btn ghost' })}</div></section>
      <section aria-labelledby="securite"><h2 class="sec" id="securite">Sécurité</h2><div class="sheet">
        ${s.devices.map((dv) => `<div class="row"><span class="grow"><span class="p strong block">${esc(dv.label)}${dv.id === s.current_device ? ' <span class="s">(cet appareil)</span>' : ''}</span>
          <span class="s block">Ajouté le ${esc(dayTitle(dv.created_at))}${dv.last_used_at ? `, utilisé le ${esc(dayTitle(dv.last_used_at))}` : ''}${dv.synced ? ' · synchronisé (trousseau)' : ''}</span></span>
          ${s.devices.length > 1 ? btn('device-revoke', 'Retirer', { cls: 'pill tall', fk: `rv:${dv.id}`, extra: `data-value="${esc(dv.id)}"` }) : ''}</div>`).join('')}
        <div class="row">${state.deviceOptions ? btn('device-create', `${I.face} Créer la passkey de cet appareil`, { cls: 'btn ghost' }) : btn('device-add', 'Ajouter cet appareil', { cls: 'btn ghost' })}</div>
        <div class="row"><span class="grow"><span class="p strong block">Codes de secours</span><span class="s block">${esc(s.recovery_codes_left)} code(s) restant(s), à imprimer et ranger hors ligne</span></span>
          ${btn('codes-new', 'Générer', { cls: 'pill tall' })}</div></div></section>
      <section aria-labelledby="donnees"><h2 class="sec" id="donnees">Données des clients</h2><div class="sheet"><div class="row"><span class="grow"><span class="p strong block">Conservation</span>
        <span class="s block">${s.retention.enabled ? `Coordonnées archivées ${esc(s.retention.archive_days)} jours après la livraison, supprimées à ${esc(s.retention.delete_days)} jours.` : 'Purge automatique coupée : durées proposées en attente de ta validation.'}</span></span></div></div></section>
      ${btn('revoke-all', 'Déconnecter tous les appareils', { cls: 'btn danger' })}</div>`;
  },

  requests: () => {
    const d = state.data.requests;
    const types = { contact: 'Message', return: 'Demande de retour', withdrawal: 'Rétractation' };
    const opened = state.openedRequest;
    return `${header('Demandes', { back: ['more', 'Plus'] })}<div class="body fade">${errorBox()}${noticeBox()}<div class="list">
      ${!d ? loadingBox() : d.requests.length ? d.requests.map((r) => `<div class="sheet pad"><div class="line"><span class="p strong">${esc(types[r.type])}</span>${pill(r.status === 'received' ? 'À traiter' : r.status === 'answered' ? 'Répondu' : 'Clos', r.status === 'received' ? 'wait' : '')}</div>
        <p class="s">${esc(longDate(r.created_at))} · <span class="id">${esc(r.reference)}</span>${r.order_reference ? ` · commande <span class="id">${esc(r.order_reference)}</span>` : ''}</p>
        ${opened?.id === r.id ? `<dl class="dl"><dt>Nom</dt><dd>${esc(opened.value.name || '—')}</dd><dt>E-mail</dt><dd>${esc(opened.value.email)}</dd><dt>Message</dt><dd class="pre">${esc(opened.value.message || '(sans motif)')}</dd></dl>`
    : btn('request-open', 'Afficher avec Face ID', { cls: 'pill tall', fk: `ro:${r.id}`, extra: `data-value="${esc(r.id)}"` })}
        ${r.status === 'received' ? btn('request-done', 'Marquer comme répondu', { cls: 'pill tall', fk: `rd:${r.id}`, extra: `data-value="${esc(r.id)}"` }) : ''}</div>`).join('')
    : '<div class="sheet pad"><p class="p strong">Aucune demande.</p><p class="s">Les messages, retours et rétractations envoyés depuis la boutique arrivent ici, avec un accusé de réception pour le client.</p></div>'}
      </div></div>`;
  },
};

// ---------- rendu : coque iPhone (barre d'onglets) ou ordinateur (navigation latérale) ----------
let shown = null;
function shell(html) {
  const authed = state.session?.authenticated && !['loading', 'login', 'recover', 'codes'].includes(state.screen);
  if (!authed) return `<main class="solo">${html}</main>`;
  const tab = TAB_OF[state.screen] ?? state.screen;
  return `<div class="shell"><nav class="side" aria-label="Navigation principale"><div class="logo side-logo" role="img" aria-label="SAYLESS"></div><p class="h2 rose side-title">Studio</p>
      ${SIDE.map(([s, t]) => `<a class="navlink ${s === tab || s === state.screen ? 'on' : ''}" href="${esc(hrefOf(s))}" ${s === state.screen ? 'aria-current="page"' : ''} data-fk="side:${s}">${esc(t)}</a>`).join('')}</nav>
    <main class="main">${html}</main>
    <nav class="tabbar" aria-label="Navigation principale">${TABS.map(([s, t, icon]) => `<a class="tab ${s === tab ? 'on' : ''}" href="${esc(hrefOf(s))}" ${s === tab ? 'aria-current="page"' : ''} data-fk="tab:${s}">${icon}<span>${esc(t)}</span></a>`).join('')}</nav></div>`;
}
function render() {
  const active = document.activeElement;
  const fk = active?.dataset?.fk ?? null;
  const caret = active && 'selectionStart' in active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  const inputs = Object.fromEntries([...app.querySelectorAll('input[data-fk], textarea[data-fk], select[data-fk]')].map((el) => [el.dataset.fk, el.value]));
  const changed = shown !== state.screen;
  app.innerHTML = shell((screens[state.screen] ?? screens.loading)());
  if (!changed) {
    app.querySelectorAll('.fade').forEach((el) => el.classList.remove('fade'));
    // Saisies en cours conservées (un nouveau rendu ne vide jamais un champ), sauf après une action réussie.
    for (const [k, v] of Object.entries(state.notice ? {} : inputs)) {
      const el = app.querySelector(`[data-fk="${CSS.escape(k)}"]`);
      if (el && (el.tagName !== 'INPUT' || el.type !== 'search') && el.value !== v) el.value = v;
    }
  }
  shown = state.screen;
  if (changed) {
    const title = app.querySelector('.screen-title');
    if (title && state.screen !== 'loading') title.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    if (live) live.textContent = TITLES[state.screen] ?? '';
  } else if (fk) {
    const again = app.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
    if (again && !again.disabled) {
      again.focus({ preventScroll: true });
      if (caret && 'setSelectionRange' in again) try { again.setSelectionRange(...caret); } catch { /* champ sans sélection */ }
    } else if (state.error || state.notice) app.querySelector('[role="alert"], [role="status"]')?.focus?.();
  }
}

// ---------- chargement des données ----------
const LOADERS = {
  today: async () => ({ overview: await api('/api/admin/overview') }),
  orders: async () => ({ orders: await api(`/api/admin/orders${state.q ? `?q=${encodeURIComponent(state.q)}` : ''}`) }),
  order: async () => ({ order: await api(`/api/admin/orders/${encodeURIComponent(state.id)}`) }),
  stock: async () => ({ stock: await api('/api/admin/stock') }),
  inventory: async () => {
    const inventory = await api('/api/admin/inventory');
    if (!state.saved) state.counts = Object.fromEntries(inventory.variants.map((v) => [v.sku, v.confirmed ? v.on_hand : 0]));
    return { inventory };
  },
  movements: async () => ({ movements: await api('/api/admin/stock/movements'), stock: state.data.stock ?? await api('/api/admin/stock') }),
  finances: async () => ({ finances: await api('/api/admin/finances') }),
  notifications: async () => ({ notifications: await api('/api/admin/notifications') }),
  drops: async () => ({ drops: await api('/api/admin/drops') }),
  performance: async () => ({ performance: await api('/api/admin/performance') }),
  health: async () => { const [health, backups] = await Promise.all([api('/api/admin/health'), api('/api/admin/backups')]); return { health, backups }; },
  audit: async () => ({ audit: await api('/api/admin/audit') }),
  settings: async () => ({ settings: await api('/api/admin/settings') }),
  requests: async () => ({ requests: await api('/api/admin/requests') }),
};
async function load(screen = state.screen) {
  const loader = LOADERS[screen];
  if (!loader) return;
  try {
    const patch = await loader();
    if (state.screen === screen) set({ data: { ...state.data, ...patch } });
  } catch (error) {
    if (error.code === 'unauthenticated') return refreshSession();
    if (state.screen === screen) set({ error: error.code });
  }
}
function navigate() {
  if (!state.session?.authenticated) return;
  const r = routeFromHash();
  const patch = { screen: r.screen, id: r.id ?? null, error: null, notice: null, contact: null, openedRequest: null, deviceOptions: null, form: {} };
  if (r.screen === 'orders' && r.filter) patch.filter = r.filter;
  if (r.screen === 'inventory' && state.screen !== 'inventory') patch.saved = null;
  set(patch);
  load(r.screen);
}
window.addEventListener('hashchange', navigate);

async function refreshSession() {
  let session;
  try {
    session = await api('/api/admin/state');
  } catch (error) {
    return set({ screen: 'login', error: error.code });
  }
  if (session.authenticated) {
    state.session = session;
    stepupUntil = session.stepup_valid_until ? Date.now() + Math.max(session.stepup_valid_until * 1000 - Date.now() - 20000, 0) : 0;
    prepare('stepup');
    checkPush();
    return navigate();
  }
  set({ session, screen: 'login' });
  if (session.enrolled) prepare('login');
  // Récupération en cours sur cet appareil (page rechargée) : défi préparé pour que Face ID parte du geste.
  if (session.recovering && !state.recoverOptions) {
    try {
      set({ recoverOptions: await api('/api/admin/recover/options', {}) });
    } catch {
      /* fenêtre close : un nouveau code de secours sera nécessaire */
    }
  }
}
async function guarded(fn) {
  if (state.busy) return;
  set({ busy: true, error: null, notice: null });
  try {
    await fn();
  } catch (error) {
    if (error.code === 'unauthenticated') { state.busy = false; return refreshSession(); }
    if (error.code === 'stale_revision') await load('inventory');
    if (error.code === 'stepup_required') stepupUntil = 0;
    set({ error: error.code, readinessDetail: error.extra?.checks ?? null });
  } finally {
    set({ busy: false });
  }
}
const value = (id) => app.querySelector(`#${id}`)?.value?.trim() ?? '';
const cents = (text) => {
  const m = text.replace(/\s|€/g, '').replace(',', '.').match(/^\d+(\.\d{1,2})?$/);
  return m ? Math.round(Number(m[0]) * 100) : null;
};
function download(name, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- notifications sur l'iPhone ----------
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
// Empreinte de l'abonnement (même calcul que le serveur) et clé avec laquelle il a été créé : STUDIO
// compare sans jamais afficher l'adresse de l'abonnement.
async function fingerprint(text) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...digest.slice(0, 6)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const subscriptionKey = (sub) => (sub?.options?.applicationServerKey ? b64.enc(sub.options.applicationServerKey) : null);
async function checkPush() {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    const sub = await reg.pushManager.getSubscription();
    state.pushHere = Boolean(sub);
    state.pushFp = sub ? await fingerprint(sub.endpoint) : null;
    state.pushKey = subscriptionKey(sub);
  } catch {
    state.pushHere = false;
  }
  if (state.screen === 'notifications' && state.data.notifications) set({}); // état de cet iPhone lu après l'écran
}
const VERIFIED = {
  unverified: 'Jamais vérifiées : touche « Envoyer un essai ».',
  refused: 'Dernier envoi refusé par le service de notification.',
  accepted: 'Dernier envoi accepté par Apple ; réception pas encore constatée sur l’iPhone.',
  received: 'Réception constatée sur cet iPhone.',
};
function pushTestText(r) {
  if (!r.keys.keypair) return 'Clés VAPID du serveur incohérentes : Apple refusera chaque envoi. Regénère les clés de test.';
  if (r.this_device === 'unknown') return 'Cet iPhone n’est pas abonné côté serveur : touche « Activer ».';
  if (!r.devices.length) return 'Aucun appareil abonné côté serveur : touche « Activer ».';
  return r.devices.map((x) => `${x.label} : ${x.result === 'ok' ? 'accepté par Apple (201). Quand la notification arrive, cet iPhone le confirme à STUDIO.'
    : x.explanation}${x.status && x.result !== 'ok' ? ` (réponse ${x.status}${x.reason ? ` ${x.reason}` : ''})` : ''}`).join(' ');
}

// ---------- actions ----------
const actions = {
  'go-recover': (el, event) => { event?.preventDefault(); set({ screen: 'recover', error: null }); },
  'go-login': () => { set({ screen: 'login', error: null, recoverOptions: null }); refreshSession(); },
  // Inscription en deux gestes : le code est vérifié, puis Face ID est demandé directement au toucher suivant.
  'enroll-check': () => { const code = value('setup'); return guarded(async () => { set({ enrollOptions: await api('/api/admin/setup/options', { setup_code: code }) }); }); },
  'enroll-create': () => {
    const options = state.enrollOptions;
    const creation = createPasskey(options.publicKey);
    return guarded(async () => {
      const result = await api('/api/admin/setup/verify', { challenge_id: options.challenge_id, credential: await creation, label: deviceLabel() });
      set({ codes: result.recovery_codes, screen: 'codes', enrollOptions: null });
    });
  },
  login: () => {
    const options = fresh(prepared.login) ? prepared.login : null;
    const assertion = options ? getPasskey(options.publicKey) : null;
    return guarded(async () => {
      const opts = options ?? (await api('/api/admin/login/options', {}));
      prepared.login = null;
      await api('/api/admin/login/verify', { challenge_id: opts.challenge_id, credential: await (assertion ?? getPasskey(opts.publicKey)) });
      if (!location.hash) location.hash = '#/';
      await refreshSession();
    });
  },
  'recover-check': () => { const code = value('code'); return guarded(async () => { set({ recoverOptions: await api('/api/admin/recover', { code }), screen: 'login', session: { ...state.session, recovering: true } }); }); },
  'recover-create': () => {
    const pending = state.recoverOptions;
    const creation = pending ? createPasskey(pending.publicKey) : null;
    return guarded(async () => {
      const options = pending ?? (await api('/api/admin/recover/options', {}));
      const result = await api('/api/admin/setup/verify', { challenge_id: options.challenge_id, credential: await (creation ?? createPasskey(options.publicKey)), label: deviceLabel() });
      set({ codes: result.recovery_codes, screen: 'codes', recoverOptions: null });
    });
  },
  'codes-done': () => { set({ codes: null, screen: 'loading' }); refreshSession(); },
  logout: () => guarded(async () => { await api('/api/admin/logout', {}); state.data = {}; await refreshSession(); }),
  'revoke-all': () => sensitive(async () => { await api('/api/admin/sessions/revoke-all', {}); state.data = {}; await refreshSession(); }),
  filter: (el) => set({ filter: el.dataset.value }),
  inc: (el) => step(el.dataset.key, 1),
  dec: (el) => step(el.dataset.key, -1),
  'save-inventory': () => sensitive(async () => {
    const inv = state.data.inventory;
    const saved = await api('/api/admin/inventory', { counts: state.counts, set_aside: state.aside, expected: Object.fromEntries(inv.variants.map((v) => [v.sku, v.revision])) });
    set({ saved, data: { ...state.data, inventory: saved } });
  }),
  contact: () => sensitive(async () => { const r = await api(`/api/admin/orders/${state.id}/contact`, {}); set({ contact: { id: state.id, value: r.contact ?? { archived: false } } }); }),
  fulfil: (el) => {
    const step = el.dataset.value;
    const extra = step === 'shipped' ? { carrier: value('carrier') || null, tracking: value('tracking') || null } : {};
    return guarded(async () => { set({ data: { ...state.data, order: await api(`/api/admin/orders/${state.id}/fulfil`, { step, ...extra }) }, notice: 'Suivi mis à jour.' }); });
  },
  resolve: (el) => { const decision = el.dataset.value; return sensitive(async () => { set({ data: { ...state.data, order: await api(`/api/admin/orders/${state.id}/resolve`, { decision }) }, notice: 'Commande validée : elle peut être préparée.' }); }); },
  refund: () => {
    const amount = cents(value('refund'));
    if (!amount) return set({ error: 'invalid_request' });
    if (!window.confirm(`Rembourser ${euro(amount)} au client ? Cette action est définitive.`)) return undefined;
    return sensitive(async () => { const r = await api(`/api/admin/orders/${state.id}/refund`, { amount_cents: amount }); set({ data: { ...state.data, order: r.order }, notice: `Remboursement de ${euro(amount)} demandé à Stripe.` }); });
  },
  return: (el) => {
    const sku = state.data.order.items.find((i) => i.sku)?.sku;
    const resellable = el.dataset.value === '1';
    return sensitive(async () => { const r = await api(`/api/admin/orders/${state.id}/return`, { sku, quantity: 1, resellable }); set({ data: { ...state.data, order: r.order },
      notice: r.result === 'restocked' ? 'Pièce remise en stock.' : r.result === 'already_done' ? 'Retour déjà contrôlé.' : 'Retour noté, pièce hors stock.' }); });
  },
  adjust: () => {
    const sku = value('adj-sku');
    const delta = Number(value('adj-delta').replace('−', '-').replace('+', ''));
    const note = value('adj-note');
    const v = state.data.stock?.drop?.sizes?.find((s) => s.sku === sku);
    if (!Number.isInteger(delta) || !delta || note.length < 3) return set({ error: 'invalid_request' });
    return sensitive(async () => {
      const inv = await api('/api/admin/inventory');
      const revision = inv.variants.find((x) => x.sku === sku)?.revision;
      await api('/api/admin/stock/adjust', { sku, delta, note, expected_revision: revision });
      const [movements, stock] = await Promise.all([api('/api/admin/stock/movements'), api('/api/admin/stock')]);
      set({ data: { ...state.data, movements, stock }, notice: `Stock ajusté${v ? ` en taille ${v.size}` : ''}.` });
    });
  },
  'more-movements': () => guarded(async () => { const d = state.data.movements; const more = await api(`/api/admin/stock/movements?before=${d.next}`);
    set({ data: { ...state.data, movements: { movements: [...d.movements, ...more.movements], next: more.next } } }); }),
  'more-audit': () => guarded(async () => { const d = state.data.audit; const more = await api(`/api/admin/audit?before=${d.next}`);
    set({ data: { ...state.data, audit: { entries: [...d.entries, ...more.entries], next: more.next } } }); }),
  'finance-save': () => {
    const invest = value('fin-invest');
    const rate = value('fin-rate').replace(',', '.');
    const body = { investment_cents: invest ? cents(invest) : null, contribution_rate_bp: rate ? Math.round(Number(rate) * 100) : null };
    if ((invest && body.investment_cents === null) || (rate && !Number.isFinite(body.contribution_rate_bp))) return set({ error: 'invalid_request' });
    return sensitive(async () => { set({ data: { ...state.data, finances: await api('/api/admin/finances/settings', body) }, notice: 'Déclarations enregistrées.' }); });
  },
  export: (el) => { const kind = el.dataset.value; return sensitive(async () => { const r = await api(`/api/admin/exports/${kind}`, {}); download(r.filename, r.csv); set({ notice: `Export prêt : ${r.filename}` }); }); },
  'read-all': () => guarded(async () => { await api('/api/admin/notifications/read', { all: true }); await load('notifications'); }),
  'push-enable': () => {
    if (!pushSupported()) return set({ error: 'push_unavailable' });
    const permission = Notification.requestPermission(); // dans le geste (exigé par iOS)
    return guarded(async () => {
      if ((await permission) !== 'granted') throw new StudioError('push_denied', 0);
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const push = state.data.notifications.channels.push;
      const key = push.public_key;
      let sub = await reg.pushManager.getSubscription();
      // Abonnement présent mais non confirmé actif par le serveur avec la clé actuelle (inconnu, expiré
      // chez Apple, créé avec une autre clé) : jamais réutilisé, remplacé par un abonnement neuf.
      const confirmed = Boolean(sub && state.pushFp && subscriptionKey(sub) === key
        && (push.device_list ?? []).some((d) => d.active && d.fp === state.pushFp));
      const replaces = sub && !confirmed ? sub.endpoint : null;
      if (replaces) {
        await sub.unsubscribe();
        sub = null;
      }
      sub = sub ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64.dec(key) }));
      const json = sub.toJSON();
      const result = await api('/api/admin/push/subscribe', { endpoint: json.endpoint, keys: json.keys, label: deviceLabel(),
        ...(subscriptionKey(sub) ? { key: subscriptionKey(sub) } : {}), ...(replaces ? { replaces } : {}) });
      await checkPush();
      state.pushTest = null;
      await load('notifications');
      // Refus du serveur (abonnement déjà déclaré expiré) : rien n'est annoncé comme activé.
      if (result?.subscribed !== true) return set({ error: result?.reason ?? 'push_subscription_expired' });
      return set({ notice: 'Notifications activées. Touche « Envoyer un essai » pour vérifier.' });
    });
  },
  'push-test': () => guarded(async () => {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    const result = await api('/api/admin/push/test', sub ? { endpoint: sub.endpoint } : {});
    await load('notifications');
    set({ pushTest: result });
  }),
  'outbox-close': () => {
    if (!window.confirm('Clôturer les envois échoués vers Discord et l’iPhone ? Ils restent dans l’historique ; aucun e-mail client n’est touché.')) return undefined;
    return sensitive(async () => {
      const r = await api('/api/admin/outbox/close', { scope: 'failed' });
      await load('health');
      set({ notice: `${plural(r.closed, 'envoi')} clôturé(s), ${plural(r.alerts, 'alerte')} résolue(s). L’historique est conservé.` });
    });
  },
  declare: (el) => {
    const id = el.dataset.value;
    const num = (v) => (v === '' ? null : Number(v));
    const body = { drop_id: id, received_total: num(value(`rec-${id}`)), gifted_total: num(value(`gift-${id}`)) };
    if ([body.received_total, body.gifted_total].some((v) => v !== null && !Number.isSafeInteger(v))) return set({ error: 'invalid_request' });
    return sensitive(async () => { await api('/api/admin/drops/declare', body); await load('drops'); set({ notice: 'Quantités enregistrées.' }); });
  },
  'product-create': () => {
    const name = value('np-name');
    const price = cents(value('np-price'));
    const drop = value('np-drop').toLowerCase();
    const sizes = value('np-sizes').split(/[,\s]+/).filter(Boolean);
    const id = `${drop}-${name}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    if (!name || !price || !drop || !sizes.length) return set({ error: 'invalid_request' });
    return sensitive(async () => { await api('/api/admin/products', { id, drop_id: drop, name, price_cents: price, sizes }); await load('drops'); set({ notice: 'Brouillon créé. Il reste invisible jusqu’à sa mise en ligne.' }); });
  },
  'product-status': (el) => {
    const { value: id, status } = el.dataset;
    if (!window.confirm('Mettre ce produit en ligne ? Il ne sera achetable qu’après son inventaire.')) return undefined;
    return sensitive(async () => { await api('/api/admin/products/status', { id, status }); await load('drops'); });
  },
  shop: (el) => {
    const mode = el.dataset.value;
    if (mode === state.data.settings?.shop.mode) return undefined;
    return sensitive(async () => { set({ data: { ...state.data, settings: await api('/api/admin/shop', { mode }) }, notice: mode === 'open' ? 'Boutique ouverte : les paiements sont actifs.' : 'Boutique en pause : aucun paiement possible.' }); });
  },
  threshold: (el) => set({ form: { ...state.form, threshold: Math.min(20, Math.max(0, (state.form.threshold ?? state.data.settings.low_stock_threshold) + Number(el.dataset.value))) } }),
  'threshold-save': () => sensitive(async () => { set({ data: { ...state.data, settings: await api('/api/admin/settings', { low_stock_threshold: state.form.threshold }) }, form: {}, notice: 'Seuil enregistré.' }); }),
  'legacy-save': () => { const body = { legacy_payment_link_id: value('legacy-link'), legacy_link_price_id: value('legacy-price') };
    return sensitive(async () => { set({ data: { ...state.data, settings: await api('/api/admin/settings', body) }, notice: 'Lien 1.0 enregistré.' }); }); },
  // Lecture par lots : chaque appel reste dans les limites de l'offre gratuite et indique où reprendre.
  'legacy-sync': () => sensitive(async () => {
    const total = { checked: 0, recorded: 0, duplicates: 0 };
    let after = null;
    for (let round = 0; round < 25; round += 1) {
      const r = await api('/api/admin/legacy/sync', after ? { after } : {});
      total.checked += r.checked; total.recorded += r.recorded; total.duplicates += r.duplicates;
      after = r.next;
      if (!after) break;
    }
    set({ notice: `${plural(total.checked, 'vente')} relue(s), ${total.recorded} nouvelle(s), ${total.duplicates} déjà connue(s).${after ? ' D’autres ventes restent : relance la lecture.' : ''}` });
  }),
  'terms-publish': () => { const body = { version: value('terms-version'), body: app.querySelector('#terms-body')?.value ?? '' };
    if (!window.confirm(`Publier la version ${body.version} des CGV ? Elle s’appliquera aux prochaines commandes et ne pourra plus être modifiée.`)) return undefined;
    return sensitive(async () => { await api('/api/admin/terms', body); await load('settings'); set({ notice: 'CGV publiées.' }); }); },
  'device-add': () => sensitive(async () => { set({ deviceOptions: await api('/api/admin/devices/options', {}) }); }),
  'device-create': () => {
    const options = state.deviceOptions;
    const creation = createPasskey(options.publicKey);
    return guarded(async () => { await api('/api/admin/devices/verify', { challenge_id: options.challenge_id, credential: await creation, label: deviceLabel() });
      set({ deviceOptions: null, notice: 'Appareil autorisé.' }); await load('settings'); });
  },
  'device-revoke': (el) => { const id = el.dataset.value;
    if (!window.confirm('Retirer cet appareil ? Ses sessions seront fermées.')) return undefined;
    return sensitive(async () => { await api('/api/admin/devices/revoke', { id }); await load('settings'); set({ notice: 'Appareil retiré.' }); }); },
  'codes-new': () => { if (!window.confirm('Générer 10 nouveaux codes ? Les anciens ne fonctionneront plus.')) return undefined;
    return sensitive(async () => { const r = await api('/api/admin/recovery-codes', {}); set({ codes: r.recovery_codes, screen: 'codes' }); }); },
  'request-open': (el) => { const id = el.dataset.value; return sensitive(async () => { const r = await api('/api/admin/requests/open', { id }); set({ openedRequest: { id, value: r.request } }); }); },
  'backup-download': (el) => { const name = el.dataset.value; return sensitive(async () => { const r = await api('/api/admin/backups/download', { name });
    download(r.filename, r.content, 'application/json'); set({ notice: `Copie téléchargée : ${r.filename}` }); }); },
  'request-done': (el) => { const id = el.dataset.value; return guarded(async () => { await api('/api/admin/requests/status', { id, status: 'answered' }); await load('requests'); }); },
  'email-delivered': (el) => { const id = Number(el.dataset.value); if (!window.confirm('Confirmer que cet e-mail apparaît bien dans Resend ?')) return undefined;
    return sensitive(async () => { await api('/api/admin/outbox/reconcile', { id, decision: 'delivered' }); await load('health'); set({ notice: 'E-mail classé comme envoyé.' }); }); },
  'email-resend': (el) => { const id = Number(el.dataset.value); if (!window.confirm('Renvoyer cet e-mail au client ? À faire seulement s’il n’apparaît pas dans Resend.')) return undefined;
    return sensitive(async () => { await api('/api/admin/outbox/reconcile', { id, decision: 'resend' }); await load('health'); set({ notice: 'E-mail renvoyé.' }); }); },
};
function deviceLabel() {
  const ua = navigator.userAgent;
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Macintosh/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'PC Windows' : 'Appareil';
}
function step(key, delta) {
  const [kind, name] = key.split(':');
  if (kind === 'sku') state.counts[name] = Math.max(0, (state.counts[name] ?? 0) + delta);
  else state.aside[name] = Math.max(0, (state.aside[name] ?? 0) + delta);
  set({ saved: null });
}

app.addEventListener('click', (event) => {
  const el = event.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) actions[el.dataset.action](el, event);
});
let searchTimer;
app.addEventListener('input', (event) => {
  if (event.target.id !== 'q') return;
  clearTimeout(searchTimer);
  state.q = event.target.value.trim();
  searchTimer = setTimeout(() => load('orders'), 250);
});
render();
refreshSession();
