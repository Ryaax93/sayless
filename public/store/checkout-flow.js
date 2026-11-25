/* Ce contrôleur ne réserve rien lui-même. Il présente le devis signé et garde
 * la même tentative tant que le serveur n'a pas tranché son résultat. */
(function (root) {
  'use strict';
  const STORAGE_KEY = 'sayless-checkout-attempt-v1';
  const refusals = new Set([
    'quote_expired',
    'quote_invalid',
    'quote_mismatch',
    'quote_required',
    'price_changed',
    'terms_outdated',
    'sold_out',
    'held',
    'stock_unavailable',
    'paused',
    'unavailable',
    'payments_disabled',
    'quantity_not_supported',
    'invalid_items',
    'invalid_request',
    'postcode_required',
    'destination_not_supported',
    'relay_required',
    'invalid_relay',
    'relay_unavailable',
    'challenge_failed',
    'challenge_required',
    'challenge_unavailable',
    'hold_limit',
    'rate_limited',
    'not_configured',
    'invalid_origin',
    'unsupported_media_type',
    'payload_too_large',
  ]);
  const challengeErrors = new Set(['challenge_required', 'challenge_failed', 'challenge_unavailable']);
  const isKey = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{16,100}$/.test(value);
  const isSku = (value) => typeof value === 'string' && /^[A-Z0-9-]{3,40}$/.test(value);

  function readAttempt(storage, contract) {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      if (!raw || raw.length > 24000) return null;
      const a = JSON.parse(raw);
      const line = a?.input?.items?.[0];
      if (!isKey(a?.key) || a.input?.items?.length !== 1 || !isSku(line?.sku) || line.quantity !== 1)
        return null;
      if (
        !['home', 'relay'].includes(a.input.shipping) ||
        typeof a.input.terms_version !== 'string' ||
        !a.input.terms_version
      )
        return null;
      // Un devis expiré peut appartenir à une tentative non résolue. Il n'autorise jamais un nouvel achat.
      if (!contract.validQuote(a.quote, a.input, 0)) return null;
      return a;
    } catch {
      return null;
    }
  }

  function createFlow({
    api,
    contract,
    getStock,
    storage = null,
    now = Date.now,
    newKey = () => crypto.randomUUID(),
  }) {
    const state = {
      phase: 'delivery',
      selection: null,
      quote: null,
      accepted: false,
      error: null,
      retryAt: 0,
      attempt: readAttempt(storage, contract),
      needsChallenge: false,
    };
    let pending = null;
    let generation = 0;
    const error = (code) => new contract.ApiError(code);
    function persist() {
      try {
        if (state.attempt) storage?.setItem(STORAGE_KEY, JSON.stringify(state.attempt));
        else storage?.removeItem(STORAGE_KEY);
      } catch {
        /* La tentative reste en mémoire si le navigateur refuse le stockage. */
      }
    }
    if (state.attempt) {
      state.quote = state.attempt.quote;
      state.phase = 'uncertain';
      state.accepted = true;
      state.error = error('attempt_pending');
    }
    function select(selection) {
      if (state.attempt || state.phase === 'submitting') throw error('attempt_pending');
      generation++;
      state.selection = JSON.parse(JSON.stringify(selection));
      Object.assign(state, { quote: null, accepted: false, error: null, phase: 'delivery' });
    }
    async function quote() {
      if (state.attempt) throw error('attempt_pending');
      if (now() < state.retryAt) throw error('rate_limited');
      const input = state.selection;
      if (input?.items?.length !== 1 || input.items[0].quantity !== 1) throw error('quantity_not_supported');
      if (!isSku(input.items[0].sku)) throw error('invalid_items');
      if (!['home', 'relay'].includes(input.shipping)) throw error('shipping_required');
      contract.destination(input.postcode, input.country);
      if (input.shipping === 'relay' && !input.relay_id) throw error('relay_required');
      const version = ++generation;
      Object.assign(state, { phase: 'quoting', quote: null, accepted: false, error: null });
      try {
        const result = await api.quote(input);
        if (version !== generation) return null;
        if (!contract.validQuote(result, input, now())) throw error('invalid_quote');
        Object.assign(state, { quote: result, phase: 'review' });
        return result;
      } catch (e) {
        if (version === generation)
          Object.assign(state, { phase: 'delivery', error: e, retryAt: now() + (e.retryAfterMs || 0) });
        throw e;
      }
    }
    function clearConfirmed() {
      Object.assign(state, {
        attempt: null,
        needsChallenge: false,
        quote: null,
        accepted: false,
        phase: 'delivery',
      });
      persist();
    }
    function accept(value) {
      state.accepted = value === true;
    }

    async function send({ termsVersion, turnstile }, retry) {
      try {
        let stock = null;
        if (!retry || state.needsChallenge) {
          stock = await getStock();
          if (stock?.status !== 'available' || !stock.checkoutEnabled)
            throw error(stock?.status === 'paused' ? 'paused' : 'stock_unavailable');
        }
        if (!retry) {
          const input = {
            items: state.selection.items.map(({ sku, quantity }) => ({ sku, quantity })),
            shipping: state.selection.shipping,
            relay_id: state.selection.shipping === 'relay' ? state.selection.relay_id : null,
            terms_version: termsVersion,
          };
          state.attempt = { key: newKey(), input, quote: state.quote };
          persist();
        }
        const a = state.attempt;
        const freshToken = !retry || state.needsChallenge ? turnstile : undefined;
        const result = await api.checkout(
          { ...a.input, turnstile: freshToken },
          {
            stock,
            quote: a.quote,
            idempotencyKey: a.key,
            retry: retry && !state.needsChallenge,
          },
        );
        state.phase = 'redirect';
        state.needsChallenge = false;
        a.order_reference = result.order_reference;
        persist();
        return result;
      } catch (e) {
        state.error = e;
        const defaultWait = { checkout_in_progress: 2000, hold_limit: 30000, rate_limited: 30000 };
        state.retryAt = now() + (e.retryAfterMs || defaultWait[e.code] || 0);
        if ((!retry && refusals.has(e.code)) || e.code === 'attempt_closed') {
          clearConfirmed();
        } else {
          state.phase = state.attempt ? 'uncertain' : 'review';
          if (retry && challengeErrors.has(e.code)) state.needsChallenge = true;
        }
        throw e;
      }
    }
    function submit({ termsVersion, turnstile } = {}) {
      if (pending) return pending;
      if (now() < state.retryAt) return Promise.reject(error('rate_limited'));
      const retry = Boolean(state.attempt);
      if (!retry && (!state.accepted || !termsVersion)) return Promise.reject(error('terms_required'));
      if ((!retry || state.needsChallenge) && !turnstile) return Promise.reject(error('challenge_required'));
      if (!retry && (!state.quote || Date.parse(state.quote.expires_at) <= now())) {
        clearConfirmed();
        state.error = error('quote_expired');
        return Promise.reject(state.error);
      }
      state.phase = 'submitting';
      state.error = null;
      pending = send({ termsVersion, turnstile }, retry).finally(() => {
        pending = null;
      });
      return pending;
    }
    return { state, select, quote, accept, submit, clearConfirmed };
  }
  function returnState(payload) {
    const allowed = ['pending', 'processing', 'paid', 'review', 'expired', 'failed', 'refunded'];
    if (!allowed.includes(payload?.payment_status) || !Number.isFinite(Date.parse(payload.updated_at)))
      return 'unavailable';
    return payload.payment_status;
  }
  const api = Object.freeze({ createFlow, returnState, STORAGE_KEY });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SaylessCheckoutFlow = api;
})(typeof window === 'undefined' ? globalThis : window);
