/* API v1.3 : suivi par jeton en mémoire et demandes enregistrées côté serveur.
 * Aucun formulaire ni jeton de suivi n'est conservé dans le stockage du navigateur. */
(function (root) {
  'use strict';
  const TOKEN = /^[A-Za-z0-9_-]{40,60}$/;
  function trackingToken(hash) {
    if (!/^#\/suivi(?:\?|$)/.test(hash)) return null;
    const values = new URLSearchParams(hash.split('?')[1] || '');
    const tokens = values.getAll('t');
    return tokens.length === 1 && TOKEN.test(tokens[0]) ? tokens[0] : null;
  }
  function createRequests({ api, now = Date.now }) {
    let pending = null, pendingInput = null, retryAt = 0, uncertain = false;
    function send(input) {
      const fingerprint = JSON.stringify({ ...input, turnstile: undefined });
      if (pending) return pendingInput === fingerprint ? pending : Promise.reject({ code: 'request_pending' });
      if (uncertain) return Promise.reject({ code: 'request_uncertain' });
      if (now() < retryAt) return Promise.reject({ code: 'rate_limited' });
      pendingInput = fingerprint;
      pending = api.request(input).catch(error => {
        retryAt = now() + (error.retryAfterMs || (error.code === 'rate_limited' ? 30000 : 0));
        // Cette API n'a pas de clé d'idempotence : une coupure peut survenir après l'enregistrement.
        if (['service_unavailable', 'invalid_response'].includes(error.code)) uncertain = true;
        throw error;
      }).finally(() => { pending = null; pendingInput = null; });
      return pending;
    }
    return { send, blocked: () => uncertain || now() < retryAt, uncertain: () => uncertain };
  }
  const api = Object.freeze({ trackingToken, createRequests });
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.SaylessService = (() => {
    const requests = createRequests({ api: root.SaylessAPI });
    let token = null, order = null, trackingError = null, trackingLoading = false, generation = 0;
    let challengeToken = '', widget = null, challengeForm = null, lookupBusy = false, lookupRetryAt = 0;
    const field = (id, label, name, options = '') => `<div class="field"><label for="${id}">${label}</label><input id="${id}" name="${name}" ${options}></div>`;
    function form(type) {
      const withdrawal = type === 'withdrawal';
      return `<form data-customer-request="${type}" id="${withdrawal ? 'withdrawal-form' : type === 'contact' ? 'message-form' : 'return-form'}" data-kind="${type}">
        <div class="form-grid">${field(type+'-name', 'Nom et prénom'+(withdrawal ? '' : ' (facultatif)'), 'name', `autocomplete="name" maxlength="120" ${withdrawal ? 'required' : ''}`)}
        ${field(type+'-email', 'Adresse e-mail', 'email', 'type="email" autocomplete="email" maxlength="254" required')}
        ${field(type+'-order', 'Référence de commande (facultatif)', 'order', 'maxlength="12" pattern="SL-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}" autocapitalize="characters" placeholder="SL-XXXX-XXXX"')}</div>
        ${withdrawal ? `<div class="form-grid">${field('return-ordered', 'Date de commande (facultatif)', 'ordered', 'type="date"')}${field('return-received', 'Date de réception (facultatif)', 'received', 'type="date"')}</div>
        <div class="field"><label for="return-address">Adresse du client</label><textarea id="return-address" name="address" autocomplete="street-address" maxlength="400" required></textarea></div>
        ${field('return-products', 'Vêtement(s) concerné(s)', 'products', 'required maxlength="300" placeholder="Pink 001, taille et quantité"')}
        <p>Aucun motif n’est demandé pour exercer votre droit de rétractation.</p>` : `<div class="field"><label for="${type}-message">${type === 'return' ? 'La pièce concernée et ta demande' : 'Ton message'}</label><textarea id="${type}-message" name="message" required minlength="2" maxlength="2500"></textarea></div>`}
        <p class="small-text">Tes informations servent à traiter cette demande. Consulte notre <a href="#/confidentialite">politique de confidentialité</a>.</p>
        <button type="button" class="text-link" data-service-challenge>Vérifier pour envoyer</button><div data-request-challenge></div>
        <p data-request-security role="status" class="small-text"></p>
        <button type="submit" class="button" data-request-send disabled>${withdrawal ? 'Envoyer ma rétractation' : 'Envoyer ma demande'}</button>
        <button type="button" class="text-link" data-prepare-email>Préparer un e-mail</button>
        <p class="small-text">Une référence s’affiche uniquement après enregistrement. L’accusé de réception est ensuite adressé par e-mail.</p>
        <div data-form-result class="form-result" hidden tabindex="-1" role="status"></div></form>`;
    }
    function capture() {
      if (currentRoute() !== 'suivi') { token = null; order = null; trackingError = null; generation++; return; }
      if (location.hash.includes('?')) {
        const found = trackingToken(location.hash);
        token = found; order = null; generation++;
        trackingError = found ? null : { code: 'unauthenticated' };
        // Le fragment n'est envoyé ni à l'API, ni au referrer ; suppression de l'historique visible.
        history.replaceState(null, '', location.pathname + '#/suivi');
      }
    }
    function trackingPage() {
      const labels = { pending: 'Confirmation en cours', processing: 'Paiement en cours de vérification', paid: 'Paiement confirmé', review: 'Commande à vérifier avec SAYLESS', expired: 'Tentative expirée', failed: 'Paiement non confirmé', refunded: 'Paiement remboursé' };
      const steps = { prepared: 'Préparée', shipped: 'Expédiée', delivered: 'Livrée', returned: 'Retournée' };
      const body = order ? `<div class="summary-card tracking-card"><span class="eyebrow">${escapeHTML(order.order_reference)}</span><h2>${labels[order.payment_status]}</h2>
        ${order.items.map(i => `<p>Zip Hoodie Pink 001 · Rose pastel · ${i.size ? 'Taille '+escapeHTML(i.size) : 'Taille à confirmer'} · ${i.quantity} pièce</p>`).join('')}
        <p>${order.shipping === 'relay' ? 'Livraison en point relais' : order.shipping === 'home' ? 'Colissimo à domicile' : 'Mode de livraison à confirmer'}</p>
        ${order.relay ? `<p>${escapeHTML([order.relay.name, order.relay.postcode, order.relay.city].filter(Boolean).join(' · '))}</p>` : ''}
        <ol class="tracking-steps">${order.steps.map(s => `<li><strong>${steps[s.step]}</strong><span>${escapeHTML(new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(s.at)))}</span></li>`).join('')}</ol>
        ${!order.steps.length ? '<p>Les étapes de préparation et d’expédition apparaîtront ici dès leur confirmation.</p>' : ''}
        ${order.tracking ? `<p>Transporteur · ${escapeHTML(order.tracking.carrier || 'À confirmer')}<br>Numéro de suivi · <strong>${escapeHTML(order.tracking.number || 'À confirmer')}</strong></p>` : ''}
        <button class="text-link" data-refresh-tracking type="button">Actualiser le suivi</button></div>` : token && !trackingError ? '<p role="status">Chargement sécurisé de ta commande…</p>' : '';
      return `<section class="checkout-page tracking-page"><span class="eyebrow">SAYLESS · À TES CÔTÉS</span><h1>TA COMMANDE.<br>SON PARCOURS.</h1>
        ${trackingError ? `<p class="notice" role="alert">${escapeHTML(checkoutMessage(trackingError))}</p>` : ''}${body}
        ${!order ? `<p>Indique la référence et l’adresse e-mail utilisées pour ta commande. Si elles correspondent, tu recevras un lien de suivi valable 30 minutes.</p><form id="tracking-form">
        ${field('tracking-reference', 'Référence de commande', 'reference', 'required maxlength="12" autocapitalize="characters" autocomplete="off" pattern="SL-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}"')}
        ${field('tracking-email', 'Adresse e-mail de la commande', 'email', 'type="email" required maxlength="254" autocomplete="email"')}
        <button class="button" type="submit">Demander mon lien de suivi</button><p id="tracking-result" role="status" tabindex="-1"></p></form>` : ''}
        <a class="text-link" href="mailto:SayLe2s@outlook.com">Contacter SAYLESS par e-mail</a></section>`;
    }
    async function readTracking() {
      if (!token || trackingLoading || currentRoute() !== 'suivi') return;
      const version = generation, currentToken = token;
      const restoreFocus = document.activeElement?.hasAttribute('data-refresh-tracking');
      trackingLoading = true;
      main.setAttribute('aria-busy', 'true');
      try { const data = await root.SaylessAPI.order(currentToken); if (version === generation) { order = data; trackingError = null; } }
      catch (error) { if (version === generation) { order = null; trackingError = error; if (error.code === 'unauthenticated') token = null; } }
      finally {
        trackingLoading = false;
        main.removeAttribute('aria-busy');
        if (version === generation && currentRoute() === 'suivi') {
          main.innerHTML = trackingPage(); main.querySelector('h1')?.setAttribute('tabindex', '-1');
          if (restoreFocus) (main.querySelector('[data-refresh-tracking]') || main.querySelector('h1'))?.focus({ preventScroll: true });
        }
        else if (token && currentRoute() === 'suivi') readTracking();
      }
    }
    function unmount() {
      if (widget !== null && root.turnstile) root.turnstile.remove(widget);
      widget = null; challengeForm = null; challengeToken = '';
    }
    async function challenge(form) {
      const note = form.querySelector('[data-request-security]'), button = form.querySelector('[data-request-send]');
      unmount(); challengeForm = form; button.disabled = true;
      if (!root.SaylessConfig.turnstileSiteKey) { note.textContent = 'L’envoi en ligne attend l’activation du service. Tu peux préparer un e-mail.'; return; }
      try {
        await root.SaylessCheckoutUI.loadTurnstile();
        if (!form.isConnected || challengeForm !== form) return;
        widget = root.turnstile.render(form.querySelector('[data-request-challenge]'), { sitekey: root.SaylessConfig.turnstileSiteKey,
          action: 'request', theme: 'light', language: 'fr', size: 'flexible',
          callback: value => { if (challengeForm !== form) return; challengeToken = value; button.disabled = requests.blocked(); note.textContent = 'Vérification terminée.'; },
          'expired-callback': () => { challengeToken = ''; button.disabled = true; note.textContent = 'La vérification a expiré. Recommence-la avant l’envoi.'; },
          'error-callback': () => { challengeToken = ''; button.disabled = true; note.textContent = 'La vérification est indisponible. Tu peux préparer un e-mail.'; return true; }
        });
      } catch { note.textContent = 'La vérification est indisponible. Tu peux préparer un e-mail.'; }
    }
    async function submit(form) {
      const button = form.querySelector('[data-request-send]');
      if (button.disabled || challengeForm !== form || !challengeToken) return;
      button.disabled = true;
      const values = new FormData(form), type = form.dataset.customerRequest;
      const payload = { type, name: String(values.get('name') || '').trim(), email: String(values.get('email') || '').trim(),
        order_reference: String(values.get('order') || '').trim().toUpperCase() || undefined,
        message: type === 'withdrawal' ? withdrawalMessage(form) : String(values.get('message') || '').trim(), turnstile: challengeToken };
      challengeToken = '';
      const result = form.querySelector('[data-form-result]');
      try {
        const receipt = await requests.send(payload);
        result.textContent = `Demande enregistrée · ${receipt.reference}. Un accusé de réception est prévu par e-mail. Conserve cette référence.`;
        form.querySelectorAll('input, textarea, button').forEach(el => { el.disabled = true; });
      } catch (error) {
        result.textContent = requests.uncertain()
          ? 'La connexion a été interrompue après l’envoi. Ta demande a peut-être été enregistrée. Vérifie tes e-mails ou contacte SAYLESS avant de la renvoyer.'
          : checkoutMessage(error) + ' L’enregistrement n’a pas été confirmé.';
        if (error.details?.field) {
          const name = error.details.field === 'order_reference' ? 'order' : error.details.field;
          const input = Array.from(form.querySelectorAll('input, textarea')).find(el => el.name === name);
          input?.setAttribute('aria-invalid', 'true');
        }
      }
      result.hidden = false; result.focus();
    }
    document.addEventListener('submit', async event => {
      const form = event.target;
      if (form.hasAttribute('data-customer-request')) { event.preventDefault(); await submit(form); }
      if (form.id !== 'tracking-form') return;
      event.preventDefault();
      if (lookupBusy || Date.now() < lookupRetryAt) return;
      lookupBusy = true;
      const button = form.querySelector('button'), result = form.querySelector('#tracking-result'), data = new FormData(form);
      button.disabled = true;
      try {
        const answer = await root.SaylessAPI.lookupOrder({ reference: String(data.get('reference')).trim().toUpperCase(), email: String(data.get('email')).trim() });
        if (answer.accepted !== true) throw new root.SaylessAPIContract.ApiError('invalid_response');
        result.textContent = 'Si ces informations correspondent à une commande, un lien de suivi sera envoyé à cette adresse.';
      } catch (error) { lookupRetryAt = Date.now() + (error.retryAfterMs || 0); result.textContent = checkoutMessage(error) + ' Aucun envoi de lien n’a été confirmé.'; }
      finally { lookupBusy = false; button.disabled = false; result.focus(); }
    });
    document.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button) return;
      if (button.hasAttribute('data-service-challenge')) challenge(button.closest('form'));
      if (button.hasAttribute('data-refresh-tracking')) readTracking();
      if (button.hasAttribute('data-prepare-email')) {
        const form = button.closest('form');
        if (form.dataset.customerRequest === 'withdrawal') prepareWithdrawal(form); else prepareEmail(form);
      }
    });
    return { form, capture, trackingPage, readTracking, unmount };
  })();
})(typeof window === 'undefined' ? globalThis : window);
function trackingPage() { return window.SaylessService.trackingPage(); }
