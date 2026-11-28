/* Références éditoriales approuvées, jamais utilisées pour fixer le montant payable. */
(function (root) {
  'use strict';
  const product = Object.freeze({
    name: 'Zip Hoodie Pink 001',
    price: 75,
    priceCents: 7500,
    sizes: Object.freeze(['S', 'M', 'L']),
  });
  const shipping = Object.freeze({
    relay: Object.freeze({ label: 'Point relais', priceCents: 490 }),
    home: Object.freeze({ label: 'Colissimo à domicile', priceCents: 850 }),
  });
  function totals(items, method = null) {
    const quantity = items.reduce((n, l) => n + l.quantity, 0),
      subtotalCents = quantity * product.priceCents;
    const shippingCents =
      quantity === 1 && Object.hasOwn(shipping, method) ? shipping[method].priceCents : null;
    return {
      quantity,
      subtotalCents,
      shippingCents,
      totalCents: shippingCents === null ? null : subtotalCents + shippingCents,
      estimate: true,
    };
  }
  const api = Object.freeze({ product, shipping, totals });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SaylessCommerce = api;
})(typeof window === 'undefined' ? globalThis : window);
