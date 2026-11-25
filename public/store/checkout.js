'use strict';
const cents = (amount) => money(amount / 100);
const checkoutMessages = {
  shipping_required: 'Choisis ton mode de livraison.',
  postcode_required: 'Indique un code postal français à cinq chiffres.',
  destination_not_supported:
    'Livraison en France métropolitaine, hors Corse pour le moment. Cette destination n’est pas desservie.',
  relay_required: 'Choisis un point relais dans la liste.',
  invalid_relay: 'Ce point relais n’est plus proposé. Choisis-en un autre.',
  relay_unavailable:
    'Les points relais sont momentanément indisponibles. Tu peux réessayer ou choisir toi-même la livraison à domicile.',
  quantity_not_supported: 'Une seule pièce par commande pour le DROP 01. Modifie ton panier.',
  invalid_items: 'Cette sélection n’est plus proposée. Vérifie ton panier.',
  sold_out: 'Cette taille est épuisée. Vérifie les autres tailles disponibles.',
  held: 'Cette pièce est réservée temporairement. Réessaie dans un instant.',
  paused: 'La boutique est momentanément indisponible. Retrouvez-nous prochainement sur saylessbrand.fr.',
  unavailable: 'La boutique est momentanément indisponible.',
  stock_unavailable: 'Le stock ne peut pas être confirmé. Le paiement reste bloqué.',
  payments_disabled: 'Les ventes ne sont pas encore ouvertes sur cet aperçu.',
  quote_expired:
    'Le devis a expiré. Demande un nouveau récapitulatif puis vérifie le total avant de continuer.',
  quote_required: 'Demande un récapitulatif à jour.',
  quote_invalid: 'Le devis n’a pas pu être vérifié. Demande un nouveau récapitulatif.',
  quote_mismatch: 'La sélection a changé. Demande un nouveau récapitulatif.',
  price_changed: 'Le montant a changé. Demande un nouveau récapitulatif et vérifie-le avant de continuer.',
  invalid_quote: 'Le récapitulatif reçu est incomplet. Aucun paiement n’est possible.',
  terms_required: 'Lis et accepte les conditions générales de vente avant de continuer.',
  terms_outdated:
    'Les conditions de vente ont changé. Recharge la page pour les relire avant une nouvelle tentative.',
  challenge_required: 'Termine la vérification de sécurité.',
  challenge_failed: 'La vérification de sécurité doit être recommencée.',
  challenge_unavailable: 'La vérification de sécurité est indisponible. Le paiement reste bloqué.',
  checkout_in_progress: 'Ta demande est en cours. Patiente puis reprends la même tentative.',
  attempt_pending: 'Une tentative de paiement reste à vérifier. Reprends-la avant de démarrer un autre achat.',
  attempt_closed: 'Cette tentative est clôturée. Vérifie ta commande avant un nouvel achat.',
  idempotency_conflict:
    'La tentative ne correspond plus à cette sélection. Contacte SAYLESS avant un nouvel essai.',
  hold_limit: 'Une réservation est déjà en cours pour toi. Patiente avant de réessayer.',
  rate_limited: 'Trop de demandes rapprochées. Patiente avant de réessayer.',
  not_configured: 'Ce service n’est pas encore disponible. Tu peux contacter SAYLESS par e-mail.',
  backend_not_connected: 'La boutique attend sa connexion au serveur. Aucun paiement n’est possible.',
  service_unavailable:
    'La connexion a été interrompue. Aucun résultat de paiement ne peut être confirmé pour le moment.',
  invalid_checkout_url:
    'Le lien de paiement n’a pas pu être vérifié. Contacte SAYLESS avant une autre tentative.',
  invalid_origin: 'Le service de paiement n’a pas pu vérifier cette page.',
  unsupported_media_type: 'La demande n’a pas pu être transmise.',
  payload_too_large: 'La demande n’a pas pu être transmise.',
  invalid_response: 'Le serveur n’a pas renvoyé une réponse exploitable.',
};
const checkoutMessage = (error) =>
  checkoutMessages[error?.code] || 'Impossible de vérifier cette demande pour le moment. Réessaie plus tard.';
function refreshCheckout(focusSelector = null) {
  if (currentRoute() !== 'paiement') return;
  main.innerHTML = checkoutPage();
  updateCartCount();
  window.SaylessInventory?.paint();
  window.SaylessCheckoutUI.mount();
  if (focusSelector) {
    const el = $(focusSelector);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ behavior: 'instant', block: 'nearest' });
  }
}
function shippingForm(v, phase, hasQuote) {
  const disabled = v.busy || phase === 'quoting';
  const choices = Object.entries(SaylessCommerce.shipping)
    .map(([id, method]) => {
      const selected = v.shipping === id;
      const details =
        id === 'relay'
          ? 'Choisis un point de retrait proposé par le transporteur.'
          : 'Ton adresse complète sera saisie sur Stripe.';
      return `<label class="shipping-option ${selected ? 'selected' : ''}">
      <input type="radio" name="shipping" value="${id}" ${selected ? 'checked' : ''} ${id === 'relay' && v.relayUnavailable ? 'disabled' : ''}>
      <span><strong>${method.label}<span>${cents(method.priceCents)}</span></strong><small>${details}</small></span>
    </label>`;
    })
    .join('');
  const points = v.points
    .map((point) => {
      const address = typeof point.address === 'string' ? point.address : point.address?.line1;
      const line = [point.network, address, point.postcode, point.city].filter(Boolean).join(' · ');
      return `<label class="shipping-option ${v.relayId === point.id ? 'selected' : ''}">
      <input type="radio" name="relay" value="${escapeHTML(point.id)}" ${v.relayId === point.id ? 'checked' : ''}>
      <span><strong>${escapeHTML(point.name)}</strong><small>${escapeHTML(line)}</small></span>
    </label>`;
    })
    .join('');
  const relays =
    v.shipping === 'relay'
      ? `
    <button class="button button-outline" type="button" data-search-relays ${disabled ? 'disabled' : ''}>Rechercher les points relais</button>
    <div class="relay-results" aria-live="polite" tabindex="-1">
      ${v.searched && !points && !v.relayUnavailable ? '<p>Aucun point proposé pour cette recherche.</p>' : ''}
      ${points ? `<fieldset class="shipping-options" ${disabled ? 'disabled' : ''}><legend>Choisis ton point de retrait</legend>${points}</fieldset>` : ''}
    </div>`
      : '';
  return `<form id="shipping-form">
    <h2 id="checkout-step-title" tabindex="-1">Ta livraison</h2>
    <p>Livraison en France métropolitaine, hors Corse pour le moment.</p>
    <p class="small-text">Choisis ta livraison ici. Tes coordonnées complètes seront demandées sur Stripe.</p>
    <fieldset class="shipping-options" ${disabled ? 'disabled' : ''}><legend>Mode de livraison</legend>${choices}</fieldset>
    <p class="small-text">Tarifs prévus pour une pièce, sous réserve de validation du transporteur. Le montant exact figure dans ton récapitulatif.</p>
    <div class="field"><label for="shipping-postcode">${v.shipping === 'relay' ? 'Code postal de recherche' : 'Code postal de livraison'}</label>
      <input id="shipping-postcode" name="postcode" inputmode="numeric" autocomplete="postal-code" pattern="[0-9]{5}" maxlength="5" required value="${escapeHTML(v.postcode)}" ${disabled ? 'disabled' : ''}>
    </div>
    ${v.relayUnavailable ? `<p class="notice">${checkoutMessages.relay_unavailable}</p><button type="button" class="text-link" data-relay-retry>Réessayer les points relais</button>` : ''}
    ${relays}
    <button class="button checkout-action" type="submit" ${disabled || !v.shipping ? 'disabled' : ''}>
      ${phase === 'quoting' ? 'Vérification en cours…' : hasQuote ? 'Actualiser le récapitulatif' : 'Voir mon récapitulatif'}
    </button>
  </form>`;
}

function quoteSummary(state, postcode) {
  const q = state.quote;
  if (!q)
    return `<div class="summary-row total"><strong>Total avec livraison</strong><strong>À confirmer</strong></div>
    <p class="small-text">Demande ton devis pour voir le total exact. Aucun paiement ni réservation à cette étape.</p>`;
  const relay = q.relay;
  const destination = relay
    ? `<p class="relay-summary"><strong>${escapeHTML(relay.label)}</strong><br>
    ${escapeHTML([relay.network, relay.postcode, relay.city].filter(Boolean).join(' · '))}</p>`
    : `<p class="small-text">${postcode ? 'Code postal · ' + escapeHTML(postcode) : 'Destination confirmée dans le devis.'}</p>`;
  const consent = state.attempt
    ? ''
    : `<label class="terms-choice"><input id="accept-terms" type="checkbox" ${state.accepted ? 'checked' : ''}>
    <span>J’ai lu et j’accepte les <a href="/#/cgv" target="_blank" rel="noopener">conditions générales de vente</a>.</span></label>`;
  const challenge =
    !state.attempt || state.needsChallenge
      ? `<div id="checkout-challenge" aria-label="Vérification de sécurité"></div>
    <p id="challenge-status" class="small-text" role="status"></p>
    <button type="button" class="text-link" data-redo-challenge hidden>Recommencer la vérification</button>`
      : '';
  return `<div class="summary-row"><span>Article TTC</span><span>${cents(q.subtotal_cents)}</span></div>
    <div class="summary-row"><span>${relay ? 'Point relais' : 'Colissimo à domicile'}</span><span>${cents(q.shipping_cents)}</span></div>
    ${destination}
    <div class="summary-row total"><strong>Total TTC</strong><strong>${cents(q.total_cents)}</strong></div>
    <p class="small-text">Livraison comprise. Ce montant est celui qui sera demandé sur Stripe.</p>
    ${consent}${challenge}
    <button id="checkout-pay" type="button" class="button" disabled>${state.attempt ? 'Reprendre cette tentative' : 'Continuer vers Stripe · ' + cents(q.total_cents)}</button>
    <p id="checkout-readiness" class="small-text" role="status"></p>`;
}

function checkoutPage() {
  const { flow, values } = window.SaylessCheckoutUI,
    s = flow.state,
    a = s.attempt,
    q = s.quote;
  if (!cart.length && !a)
    return `<section class="checkout-page"><span class="eyebrow">LE RÉCAPITULATIF</span>
    <h1>IL MANQUE<br>TA PIÈCE.</h1><p>Ton panier est vide. Découvre le Pink 001.</p><a class="button checkout-action" href="#/produit">Voir le hoodie</a></section>`;
  const items = a ? a.input.items.map((l) => ({ size: l.sku.split('-').pop(), quantity: l.quantity })) : cart;
  const lines = items
    .map(
      (item, index) => `<div class="order-line">
    <img src="/store/assets/hoodie-front.webp" width="75" height="96" alt="Zip Hoodie Pink 001">
    <div><strong>Zip Hoodie Pink 001</strong><p>Rose pastel · Taille ${escapeHTML(item.size)}<br>Quantité · ${item.quantity}</p></div>
    <span>${q ? cents(q.items[index].line_total_cents) : '75 €'}</span></div>`,
    )
    .join('');
  const error = values.error || s.error;
  const errorText =
    a && error?.code === 'quote_expired'
      ? 'Le délai du devis est écoulé. La réservation initiale reste à vérifier. Contacte SAYLESS avant de recommencer.'
      : error
        ? checkoutMessage(error)
        : '';
  const reference = a?.order_reference || error?.details?.order_reference;
  const referenceHtml = window.SaylessAPIContract.orderRef.test(reference || '')
    ? `<p>Référence de commande · ${escapeHTML(reference)}</p><a href="#/suivi">Suivre ma commande</a>`
    : '';
  const delivery = a
    ? `<h2 id="checkout-step-title" tabindex="-1">Ta tentative en cours</h2>
    <p>Ta sélection et ton devis sont conservés. Reprends cette tentative pour retrouver ton paiement.</p>${referenceHtml}
    <a class="text-link" href="mailto:SayLe2s@outlook.com">Contacter SAYLESS</a>`
    : shippingForm(values, s.phase, Boolean(q));
  return `<section class="checkout-page">
    <nav class="checkout-steps" aria-label="Étapes du parcours"><button type="button" data-open-cart>Panier</button>
      <span aria-current="${q ? 'false' : 'step'}">Livraison</span><span aria-current="${q ? 'step' : 'false'}">Récapitulatif</span><span>Stripe</span></nav>
    <span class="eyebrow">TON CHOIX. TON STYLE.</span><h1>ON RÉCAPITULE.</h1>
    ${window.SaylessConfig.checkoutEnabled ? '' : '<div class="notice">Aperçu de préparation. Les paiements restent désactivés.</div>'}
    ${pausedNotice()}<p class="small-text" data-purchase-stock role="status">Vérification de la disponibilité…</p>
    <div id="checkout-error" class="notice checkout-error" role="alert" tabindex="-1" ${error ? '' : 'hidden'}>
      ${escapeHTML(errorText)}${a ? '' : referenceHtml}${a && s.phase === 'uncertain' ? '<p>Une réservation peut déjà exister. La reprise conserve la même tentative.</p>' : ''}
    </div>
    <div class="checkout-layout"><div class="checkout-block">${delivery}</div>
      <aside class="summary-card" aria-labelledby="summary-title">
        <h2 id="summary-title" tabindex="-1">${q ? 'Ton récapitulatif' : 'Ta sélection'}</h2>${lines}
        <p class="small-text">Une seule pièce par commande pour le DROP 01.</p>
        ${a ? '' : '<button class="text-link" data-open-cart>Modifier mon panier</button>'}
        ${quoteSummary(s, values.postcode)}
        <p class="small-text">Stripe recueille tes coordonnées et le règlement. La carte bancaire, Apple Pay et Google Pay seront proposés selon leur disponibilité sur ton appareil.</p>
        <div class="checkout-policy-links"><a href="#/cgv">Conditions de vente</a><a href="#/retours">Rétractation</a><a href="#/confidentialite">Confidentialité</a></div>
      </aside>
    </div>
  </section>`;
}
function confirmationPage() {
  const state = window.SaylessCheckoutUI.confirmation;
  const texts = {
    pending: [
      'CONFIRMATION<br>EN COURS.',
      'Ton paiement est en cours de vérification. Ne repasse pas commande.',
    ],
    processing: [
      'CONFIRMATION<br>EN COURS.',
      'Ton paiement est en cours de traitement. Ne repasse pas commande.',
    ],
    paid: [
      'COMMANDE<br>CONFIRMÉE.',
      'Ton paiement est confirmé. Merci de faire partie du premier chapitre SAYLESS.',
    ],
    review: [
      'COMMANDE<br>À VÉRIFIER.',
      'Ta commande demande une vérification par SAYLESS. Contacte-nous avant un nouvel achat.',
    ],
    expired: ['TENTATIVE<br>EXPIRÉE.', 'Le serveur indique que cette tentative a expiré.'],
    failed: ['PAIEMENT<br>NON CONFIRMÉ.', 'Le serveur indique que cette tentative a échoué.'],
    refunded: ['PAIEMENT<br>REMBOURSÉ.', 'Le serveur indique que ce paiement a été remboursé.'],
    unavailable: [
      'CONFIRMATION<br>INDISPONIBLE.',
      'Impossible de vérifier ton paiement pour le moment. Ne repasse pas commande avant d’avoir vérifié son état.',
    ],
  };
  const [title, copy] = texts[state.status] || texts.unavailable;
  return `<section class="success-layout"><span class="eyebrow">SAYLESS · TA COMMANDE</span><h1>${title}</h1><p role="status">${copy}</p>${state.reference ? `<p class="order-reference">Référence : <strong>${escapeHTML(state.reference)}</strong></p>` : ''}${state.status !== 'paid' ? '<button type="button" class="button checkout-action" data-check-status>Vérifier à nouveau</button>' : ''}<div class="checkout-policy-links"><a href="#/suivi">Suivre ma commande</a><a href="mailto:SayLe2s@outlook.com">Contacter SAYLESS</a><a href="#/">Retour à la boutique</a></div></section>`;
}
function cancellationPage() {
  return `<section class="success-layout"><span class="eyebrow">SAYLESS · TON PARCOURS</span><h1>TU PRENDS<br>LE TEMPS.</h1><p>Tu as quitté la page de paiement. Ce retour ne confirme ni un paiement ni la libération de ta pièce.</p><p>Le serveur vérifiera la session et libérera la réservation si elle expire sans paiement.</p><a href="#/paiement" class="button checkout-action">Retrouver ma tentative</a><div class="checkout-policy-links"><a href="#/suivi">Vérifier ma commande</a><a href="mailto:SayLe2s@outlook.com">Contacter SAYLESS</a></div></section>`;
}
function trackingPage() {
  return `<section class="checkout-page tracking-page"><span class="eyebrow">SAYLESS · À TES CÔTÉS</span><h1>TA COMMANDE.<br>SON PARCOURS.</h1><p>Le suivi en ligne attend l’activation des e-mails de commande. Tu peux vérifier la disponibilité du service ci-dessous, ou nous écrire.</p><form id="tracking-form"><div class="field"><label for="tracking-reference">Référence de commande</label><input id="tracking-reference" name="reference" required maxlength="80" autocomplete="off"></div><div class="field"><label for="tracking-email">Adresse e-mail de la commande</label><input id="tracking-email" name="email" type="email" required maxlength="254" autocomplete="email"></div><button class="button" type="submit">Demander mon lien de suivi</button><p id="tracking-result" role="status" tabindex="-1"></p></form><a class="text-link" href="mailto:SayLe2s@outlook.com">Contacter SAYLESS par e-mail</a></section>`;
}

window.SaylessCheckoutUI = (() => {
  const values = {
    shipping: null,
    postcode: '',
    relayId: null,
    points: [],
    searched: false,
    relayUnavailable: false,
    busy: false,
    error: null,
  };
  const confirmation = { status: 'pending', reference: null };
  let storage;
  try {
    storage = sessionStorage;
  } catch {
    storage = null;
  }
  const flow = window.SaylessCheckoutFlow.createFlow({
    api: window.SaylessAPI,
    contract: window.SaylessAPIContract,
    getStock: () => window.SaylessInventory.refresh(),
    storage,
  });
  let widget = null,
    widgetNode = null,
    token = '',
    loadingScript = null,
    returnContext = null,
    statusTimer = null,
    statusPending = null,
    statusTries = 0,
    statusRetryAt = 0,
    relayGeneration = 0;
  function selection() {
    return {
      items: cart.map((i) => ({
        sku: window.SaylessInventory.variantId(i.size, i.color),
        quantity: i.quantity,
      })),
      shipping: values.shipping,
      relay_id: values.relayId,
      country: 'FR',
      postcode: values.postcode,
    };
  }
  function invalidate() {
    if (flow.state.attempt) return;
    flow.select(selection());
    values.error = null;
    token = '';
  }
  function stockChanged() {
    const pay = document.querySelector('#checkout-pay'),
      note = document.querySelector('#checkout-readiness');
    if (!pay) return;
    const s = flow.state,
      stock = window.SaylessInventory.current();
    const configured =
      window.SaylessConfig.checkoutEnabled &&
      window.SaylessConfig.termsVersion &&
      window.SaylessConfig.turnstileSiteKey;
    const waiting = Date.now() < s.retryAt;
    const ready =
      !!configured &&
      !values.busy &&
      !['submitting', 'redirect'].includes(s.phase) &&
      !waiting &&
      (s.attempt
        ? !s.needsChallenge ||
          (!!token &&
            stock?.checkoutEnabled &&
            stock.status === 'available' &&
            Date.parse(s.quote?.expires_at) > Date.now())
        : s.accepted &&
          !!token &&
          stock?.status === 'available' &&
          stock.checkoutEnabled &&
          Date.parse(s.quote?.expires_at) > Date.now());
    pay.disabled = !ready;
    if (note)
      note.textContent = !configured
        ? 'Le paiement reste désactivé dans cet aperçu.'
        : waiting
          ? 'Patiente avant de reprendre ta demande.'
          : s.attempt
            ? 'La reprise vérifie la même tentative, sans deuxième réservation.'
            : Date.parse(s.quote?.expires_at) <= Date.now()
              ? 'Ce devis a expiré. Actualise le récapitulatif.'
              : !stock?.checkoutEnabled
                ? 'Le paiement attend une disponibilité vérifiée et l’ouverture des ventes.'
                : !s.accepted
                  ? 'Accepte les conditions de vente pour continuer.'
                  : !token
                    ? 'Termine la vérification de sécurité.'
                    : 'Tes coordonnées et le règlement seront saisis sur Stripe.';
  }
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve();
    if (loadingScript) return loadingScript;
    loadingScript = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.referrerPolicy = 'no-referrer';
      const timeout = setTimeout(() => {
        script.remove();
        loadingScript = null;
        reject(new window.SaylessAPIContract.ApiError('challenge_unavailable'));
      }, 10000);
      script.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      script.onerror = () => {
        clearTimeout(timeout);
        script.remove();
        loadingScript = null;
        reject(new window.SaylessAPIContract.ApiError('challenge_unavailable'));
      };
      document.head.append(script);
    });
    return loadingScript;
  }
  async function challenge() {
    const node = document.querySelector('#checkout-challenge');
    if (
      !node ||
      !flow.state.accepted ||
      (flow.state.attempt && !flow.state.needsChallenge) ||
      !window.SaylessConfig.checkoutEnabled ||
      !window.SaylessConfig.turnstileSiteKey
    )
      return;
    if (widgetNode === node) return;
    widgetNode = node;
    token = '';
    stockChanged();
    try {
      await loadTurnstile();
      if (!node.isConnected || widgetNode !== node || !flow.state.accepted) return;
      if (widget !== null) window.turnstile.remove(widget);
      widget = window.turnstile.render(node, {
        sitekey: window.SaylessConfig.turnstileSiteKey,
        action: 'checkout',
        language: 'fr',
        theme: 'light',
        size: 'flexible',
        callback: (value) => {
          if (!node.isConnected) return;
          token = value;
          stockChanged();
        },
        'expired-callback': () => {
          token = '';
          stockChanged();
          const text = document.querySelector('#challenge-status');
          if (text) text.textContent = 'La vérification a expiré. Recommence-la pour continuer.';
          const redo = document.querySelector('[data-redo-challenge]');
          if (redo) redo.hidden = false;
        },
        'error-callback': () => {
          token = '';
          const text = document.querySelector('#challenge-status');
          if (text) text.textContent = checkoutMessages.challenge_unavailable;
          const redo = document.querySelector('[data-redo-challenge]');
          if (redo) redo.hidden = false;
          stockChanged();
          return true;
        },
      });
    } catch (e) {
      const text = document.querySelector('#challenge-status');
      if (text) text.textContent = checkoutMessage(e);
      const redo = document.querySelector('[data-redo-challenge]');
      if (redo) redo.hidden = false;
    }
  }
  function mount() {
    stockChanged();
    challenge();
  }
  function unmount() {
    clearTimeout(statusTimer);
    statusTimer = null;
    if (widget !== null && window.turnstile) {
      window.turnstile.remove(widget);
      widget = null;
    }
    widgetNode = null;
    token = '';
  }
  async function searchRelays() {
    if (flow.state.attempt || values.busy || Date.now() < flow.state.retryAt) return;
    const version = ++relayGeneration;
    values.busy = true;
    values.error = null;
    values.points = [];
    values.relayId = null;
    values.searched = false;
    invalidate();
    refreshCheckout();
    try {
      const postcode = window.SaylessAPIContract.destination(values.postcode);
      const data = await window.SaylessAPI.relayPoints({ postcode, country: 'FR' });
      if (version !== relayGeneration) return;
      if (!Array.isArray(data.points)) throw new window.SaylessAPIContract.ApiError('invalid_response');
      const ids = new Set();
      values.points = data.points.filter((p) => {
        if (
          !p ||
          typeof p.id !== 'string' ||
          !p.id ||
          typeof p.name !== 'string' ||
          !p.name ||
          p.open === false ||
          (p.country && p.country !== 'FR') ||
          ids.has(p.id)
        )
          return false;
        ids.add(p.id);
        return true;
      });
      values.searched = true;
      values.relayUnavailable = false;
    } catch (e) {
      if (version !== relayGeneration) return;
      values.error = e;
      flow.state.retryAt = Date.now() + (e.retryAfterMs || 0);
      if (e.code === 'relay_unavailable') {
        values.relayUnavailable = true;
        values.shipping = null;
      }
    } finally {
      values.busy = false;
      refreshCheckout('#checkout-error:not([hidden]), .relay-results');
    }
  }
  async function makeQuote() {
    if (values.busy || flow.state.attempt) return;
    values.busy = true;
    values.error = null;
    try {
      const stock = await window.SaylessInventory.refresh();
      if (!stock || stock.status !== 'available')
        throw new window.SaylessAPIContract.ApiError(
          { paused: 'paused', held: 'held', sold_out: 'sold_out' }[stock?.status] || 'stock_unavailable',
        );
      flow.select(selection());
      const promise = flow.quote();
      refreshCheckout();
      await promise;
    } catch (e) {
      values.error = e;
    } finally {
      values.busy = false;
      refreshCheckout(values.error ? '#checkout-error' : '#summary-title');
    }
  }
  async function pay() {
    if (values.busy || document.querySelector('#checkout-pay')?.disabled) return;
    values.busy = true;
    values.error = null;
    stockChanged();
    try {
      const result = await flow.submit({ termsVersion: window.SaylessConfig.termsVersion, turnstile: token });
      token = '';
      if (currentRoute() === 'paiement') window.location.assign(result.url);
      else flow.state.phase = 'uncertain';
    } catch (e) {
      values.error = e;
      token = '';
    } finally {
      values.busy = false;
      refreshCheckout(values.error ? '#checkout-error' : null);
    }
  }
  function captureReturn() {
    if (!['/merci', '/commande-annulee'].includes(location.pathname.replace(/\/$/, ''))) return;
    const p = new URLSearchParams(location.search),
      ref = p.get('ref'),
      sid = p.get('session_id');
    returnContext = ref ? { order_reference: ref, session_id: sid } : history.state?.saylessReturn || {};
    confirmation.reference = window.SaylessAPIContract.orderRef.test(returnContext.order_reference || '')
      ? returnContext.order_reference
      : null;
    // Identifiants techniques supprimés de l'adresse et du referrer ; aucun détail client demandé.
    history.replaceState({ saylessReturn: returnContext }, '', location.pathname + location.hash);
  }
  async function checkStatus() {
    if (currentRoute() !== 'confirmation' || document.hidden || statusPending || Date.now() < statusRetryAt)
      return;
    if (!confirmation.reference || !/^cs_(test_|live_)?[A-Za-z0-9_]+$/.test(returnContext?.session_id || '')) {
      confirmation.status = 'unavailable';
      main.innerHTML = confirmationPage();
      return;
    }
    statusPending = (async () => {
      try {
        const data = await window.SaylessAPI.checkoutStatus(returnContext);
        if (data.order_reference !== returnContext.order_reference)
          throw new window.SaylessAPIContract.ApiError('invalid_response');
        confirmation.status = window.SaylessCheckoutFlow.returnState(data);
        if (['paid', 'expired', 'failed', 'refunded'].includes(confirmation.status)) {
          const matching = flow.state.attempt?.order_reference === confirmation.reference;
          if (matching) {
            flow.clearConfirmed();
            if (confirmation.status === 'paid') {
              cart = [];
              saveCart();
            }
          }
        }
      } catch (e) {
        confirmation.status = 'unavailable';
        statusRetryAt = Date.now() + Math.max(3000, e.retryAfterMs || 0);
      } finally {
        statusPending = null;
        statusTries++;
        if (currentRoute() !== 'confirmation') return;
        const title = document.querySelector('.success-layout h1');
        if (!title || main.dataset.paymentStatus !== confirmation.status) {
          const restore = document.activeElement?.hasAttribute('data-check-status');
          main.innerHTML = confirmationPage();
          main.dataset.paymentStatus = confirmation.status;
          if (restore) (main.querySelector('[data-check-status]') || main).focus({ preventScroll: true });
        }
        if (['pending', 'processing', 'unavailable'].includes(confirmation.status) && statusTries < 12)
          statusTimer = setTimeout(checkStatus, Math.max(5000, statusRetryAt - Date.now()));
      }
    })();
    return statusPending;
  }
  function cartChanged() {
    if (!flow.state.attempt && flow.state.phase !== 'submitting') invalidate();
    refreshCheckout();
  }
  document.addEventListener('input', (e) => {
    if (e.target.id === 'shipping-postcode') {
      values.postcode = e.target.value;
      values.points = [];
      values.relayId = null;
      values.searched = false;
      relayGeneration++;
      invalidate();
      stockChanged();
      const results = document.querySelector('.relay-results');
      if (results) results.replaceChildren();
      if (document.querySelector('#checkout-pay')) refreshCheckout('#shipping-postcode');
    }
  });
  document.addEventListener('change', (e) => {
    if (e.target.name === 'shipping') {
      values.shipping = e.target.value;
      values.relayId = null;
      values.points = [];
      values.searched = false;
      invalidate();
      refreshCheckout('input[name="shipping"]:checked');
    }
    if (e.target.name === 'relay') {
      values.relayId = e.target.value;
      invalidate();
      refreshCheckout('input[name="relay"]:checked');
    }
    if (e.target.id === 'accept-terms') {
      flow.accept(e.target.checked);
      token = '';
      if (widget !== null && window.turnstile) {
        window.turnstile.remove(widget);
        widget = null;
      }
      widgetNode = null;
      stockChanged();
      challenge();
    }
  });
  document.addEventListener('submit', async (e) => {
    if (e.target.id === 'shipping-form') {
      e.preventDefault();
      values.postcode = document.querySelector('#shipping-postcode').value.trim();
      await makeQuote();
    }
    if (e.target.id === 'tracking-form') {
      e.preventDefault();
      const form = e.target,
        button = form.querySelector('button'),
        result = form.querySelector('#tracking-result');
      if (button.disabled) return;
      const data = new FormData(form);
      button.disabled = true;
      try {
        const response = await window.SaylessAPI.lookupOrder({
          reference: String(data.get('reference')).trim(),
          email: String(data.get('email')).trim(),
        });
        result.textContent =
          response.accepted === true
            ? 'Si les informations correspondent à une commande, un lien de suivi sera envoyé à cette adresse.'
            : 'Le service n’a pas confirmé ta demande. Contacte SAYLESS.';
      } catch (error) {
        result.textContent = checkoutMessage(error) + ' Aucun lien n’a été confirmé comme envoyé.';
      } finally {
        button.disabled = false;
        result.focus();
      }
    }
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-search-relays')) searchRelays();
    if (b.hasAttribute('data-relay-retry')) {
      values.relayUnavailable = false;
      values.shipping = 'relay';
      searchRelays();
    }
    if (b.hasAttribute('data-redo-challenge')) {
      widgetNode = null;
      token = '';
      b.hidden = true;
      challenge();
    }
    if (b.id === 'checkout-pay') pay();
    if (b.hasAttribute('data-check-status')) {
      statusTries = 0;
      clearTimeout(statusTimer);
      checkStatus();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentRoute() === 'confirmation') checkStatus();
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && flow.state.phase === 'redirect') {
      flow.state.phase = 'uncertain';
      values.busy = false;
      refreshCheckout();
    }
  });
  setInterval(() => {
    if (!document.hidden && currentRoute() === 'paiement') stockChanged();
  }, 1000);
  return { values, flow, confirmation, mount, unmount, stockChanged, cartChanged, captureReturn, checkStatus };
})();
