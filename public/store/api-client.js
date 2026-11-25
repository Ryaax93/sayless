/* Frontière boutique / backend Claude. Contrat commun v1.2 ; aucun calcul de confiance ici. */
(function (root) {
  'use strict';
  const MAX_AGE_MS = 30000;
  const orderRef = /^SL-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
  class ApiError extends Error {
    constructor(code, status = 0, details = {}, retryAfterMs = 0) {
      super(code);
      this.name = 'ApiError';
      Object.assign(this, { code, status, details, retryAfterMs });
    }
  }
  const unknown = (status = 'unavailable', updatedAt = null) => ({
    status,
    total: null,
    variants: [],
    updatedAt,
    checkoutEnabled: false,
    maxItems: 1,
  });
  function normalizeStock(data, skus, now = Date.now()) {
    const updatedAt = Date.parse(data?.updated_at),
      age = now - updatedAt;
    if (!Number.isFinite(updatedAt) || age > MAX_AGE_MS || age < -5000) return unknown();
    if (data.mode === 'paused') return unknown('paused', updatedAt);
    if (
      data.mode !== 'open' ||
      data.verified !== true ||
      !Array.isArray(data.variants) ||
      !Array.isArray(skus) ||
      !skus.length
    )
      return unknown();
    if (
      !['available', 'held', 'sold_out'].includes(data.drop_status) ||
      !Number.isSafeInteger(data.total_available) ||
      data.total_available < 0 ||
      !Number.isSafeInteger(data.max_items_per_order) ||
      data.max_items_per_order < 1
    )
      return unknown();
    const variants = [];
    for (const sku of skus) {
      const matches = data.variants.filter((v) => v?.sku === sku);
      if (matches.length !== 1) return unknown();
      const v = matches[0];
      if (
        !Number.isSafeInteger(v.orderable) ||
        v.orderable < 0 ||
        v.orderable > data.max_items_per_order ||
        !['available', 'held', 'sold_out'].includes(v.state)
      )
        return unknown();
      if ((v.state === 'available') !== v.orderable > 0) return unknown();
      variants.push({ sku, orderable: v.orderable, available: v.orderable, state: v.state });
    }
    const hasAvailable = variants.some((v) => v.state === 'available'),
      hasHeld = variants.some((v) => v.state === 'held');
    if (
      hasAvailable !== data.total_available > 0 ||
      data.total_available < variants.reduce((n, v) => n + v.orderable, 0)
    )
      return unknown();
    const status = hasAvailable
      ? 'available'
      : hasHeld
        ? 'held'
        : data.drop_status === 'sold_out'
          ? 'sold_out'
          : 'unavailable';
    if (status !== data.drop_status) return unknown();
    // available/orderable sont plafonnés. Leur somme n'est JAMAIS le compteur du drop.
    return {
      status,
      total: data.total_available,
      variants,
      updatedAt,
      checkoutEnabled: data.checkout_enabled === true,
      maxItems: Math.min(1, data.max_items_per_order),
    };
  }
  function destination(postcode, country = 'FR') {
    if (typeof postcode !== 'string' || !/^\d{5}$/.test(postcode.trim()))
      throw new ApiError('postcode_required', 422);
    if (country !== 'FR' || /^(20|97|98)/.test(postcode.trim()))
      throw new ApiError('destination_not_supported', 422);
    return postcode.trim();
  }
  function validQuote(q, input, now = Date.now()) {
    if (!q || typeof q.id !== 'string' || !q.id || q.currency !== 'EUR' || !(Date.parse(q.expires_at) > now))
      return false;
    if (
      !['subtotal_cents', 'shipping_cents', 'total_cents'].every(
        (k) => Number.isSafeInteger(q[k]) && q[k] >= 0,
      ) ||
      q.total_cents !== q.subtotal_cents + q.shipping_cents
    )
      return false;
    if (!Array.isArray(q.items) || q.items.length !== input.items.length || q.shipping !== input.shipping)
      return false;
    if (
      q.shipping === 'relay' &&
      (!q.relay || q.relay.id !== input.relay_id || typeof q.relay.label !== 'string')
    )
      return false;
    if (q.shipping === 'home' && q.relay !== null) return false;
    const seen = new Set();
    let sum = 0;
    for (const l of q.items) {
      const expected = input.items.find((x) => x.sku === l.sku);
      if (
        !expected ||
        seen.has(l.sku) ||
        l.quantity !== expected.quantity ||
        !Number.isSafeInteger(l.unit_price_cents) ||
        l.unit_price_cents < 0 ||
        !Number.isSafeInteger(l.line_total_cents) ||
        l.line_total_cents !== l.quantity * l.unit_price_cents
      )
        return false;
      seen.add(l.sku);
      sum += l.line_total_cents;
    }
    return Number.isSafeInteger(sum) && sum === q.subtotal_cents;
  }
  function createClient({
    fetchImpl = globalThis.fetch,
    checkoutEnabled = false,
    timeoutMs = 5000,
    now = Date.now,
  } = {}) {
    async function request(path, { method = 'GET', body, headers = {} } = {}) {
      const ctrl = new AbortController(),
        timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const response = await fetchImpl(path, {
          method,
          cache: 'no-store',
          credentials: 'same-origin',
          signal: ctrl.signal,
          headers: {
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            ...headers,
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const data = await response.json().catch(() => {
          throw new ApiError('invalid_response', response.status);
        });
        if (!response.ok) {
          const retry = response.headers?.get('Retry-After');
          const delay =
            retry === null || retry === undefined
              ? 0
              : /^\d+$/.test(retry)
                ? Number(retry) * 1000
                : Math.max(0, Date.parse(retry) - now());
          throw new ApiError(
            typeof data?.error === 'string' ? data.error : 'service_unavailable',
            response.status,
            data,
            Number.isFinite(delay) ? delay : 0,
          );
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError('invalid_response');
        return data;
      } catch (e) {
        if (e instanceof ApiError) throw e;
        throw new ApiError('service_unavailable', 503);
      } finally {
        clearTimeout(timer);
      }
    }
    async function checkout(input, { stock, quote, idempotencyKey, retry = false } = {}) {
      if (!checkoutEnabled) throw new ApiError('payments_disabled', 403);
      if (
        !retry &&
        (!stock?.checkoutEnabled ||
          stock.status !== 'available' ||
          !Number.isFinite(stock.updatedAt) ||
          now() - stock.updatedAt > MAX_AGE_MS)
      )
        throw new ApiError('stock_unavailable', 503);
      if (
        !quote?.id ||
        quote.currency !== 'EUR' ||
        !Number.isSafeInteger(quote.total_cents) ||
        quote.total_cents < 0 ||
        (!retry && !(Date.parse(quote.expires_at) > now()))
      )
        throw new ApiError('quote_required', 409);
      if (
        !Array.isArray(input?.items) ||
        !input.items.length ||
        !['relay', 'home'].includes(input.shipping) ||
        typeof idempotencyKey !== 'string' ||
        !/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)
      )
        throw new ApiError('invalid_request', 400);
      if (input.items.reduce((n, l) => n + l.quantity, 0) !== 1)
        throw new ApiError('quantity_not_supported', 422, { max_items: 1 });
      if (input.shipping === 'relay' && !input.relay_id) throw new ApiError('relay_required', 422);
      if (!retry && (typeof input.turnstile !== 'string' || !input.turnstile.trim()))
        throw new ApiError('challenge_required', 403);
      const seen = new Set();
      const items = input.items.map((item) => {
        if (
          seen.has(item.sku) ||
          !Number.isSafeInteger(item.quantity) ||
          item.quantity < 1 ||
          typeof item.sku !== 'string'
        )
          throw new ApiError('invalid_items', 422);
        const v = stock?.variants.find((v) => v.sku === item.sku);
        if (!retry && (!v || v.state !== 'available' || v.orderable < item.quantity))
          throw new ApiError('stock_unavailable', 409);
        seen.add(item.sku);
        return { sku: item.sku, quantity: item.quantity };
      });
      // Reprise explicite : mêmes identifiants et devis, jamais un nouveau prix ou customer_token.
      const data = await request('/api/checkout', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: {
          items,
          shipping: input.shipping,
          relay_id: input.shipping === 'relay' ? input.relay_id : null,
          quote_id: quote.id,
          terms_version: input.terms_version,
          turnstile: retry ? undefined : input.turnstile,
        },
      });
      let url;
      try {
        url = new URL(data.url);
      } catch {
        throw new ApiError('invalid_checkout_url');
      }
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'checkout.stripe.com' ||
        url.username ||
        url.password ||
        url.port
      )
        throw new ApiError('invalid_checkout_url');
      if (!orderRef.test(data.order_reference || '') || !Number.isFinite(Date.parse(data.expires_at)))
        throw new ApiError('invalid_response');
      return { url: url.href, order_reference: data.order_reference, expires_at: data.expires_at };
    }
    return Object.freeze({
      catalog: () => request('/api/catalog'),
      stock: (productId) => request('/api/stock?product_id=' + encodeURIComponent(productId)),
      quote: (input) =>
        request('/api/quote', {
          method: 'POST',
          body: {
            items: input.items.map(({ sku, quantity }) => ({ sku, quantity })),
            shipping: input.shipping,
            relay_id: input.shipping === 'relay' ? input.relay_id : null,
            country: input.country || 'FR',
            postcode: input.postcode,
          },
        }),
      relayPoints: ({ postcode, country = 'FR' }) =>
        request('/api/relay-points?' + new URLSearchParams({ postcode, country })),
      checkoutStatus: ({ order_reference, session_id }) =>
        request('/api/checkout/status', { method: 'POST', body: { order_reference, session_id } }),
      order: (token) => request('/api/order', { headers: { Authorization: 'Bearer ' + token } }),
      lookupOrder: ({ reference, email }) =>
        request('/api/order/lookup', { method: 'POST', body: { reference, email } }),
      request: (input) => request('/api/requests', { method: 'POST', body: input }),
      checkout,
    });
  }
  const api = Object.freeze({
    ApiError,
    normalizeStock,
    createClient,
    validQuote,
    destination,
    MAX_AGE_MS,
    orderRef,
  });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.SaylessAPIContract = api;
    root.SaylessAPI = createClient({ checkoutEnabled: root.SaylessConfig?.checkoutEnabled === true });
  }
})(typeof window === 'undefined' ? globalThis : window);
