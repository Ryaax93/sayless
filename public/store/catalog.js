/* Une lecture du catalogue publié lie la fiche éditoriale à ses SKU de vente.
 * Le devis reste la source du total. Un catalogue manquant bloque les achats. */
(function (root) {
  'use strict';
  function dropProduct(data) {
    if (data?.currency !== 'EUR' || !Array.isArray(data.products)) return null;
    const product = data.products.find((p) => p.id === 'pink-001' && p.drop_id === 'drop-01');
    if (!product || product.price_cents !== 7500 || !Array.isArray(product.variants)) return null;
    const variants = new Map(),
      ids = new Set();
    for (const v of product.variants) {
      if (v.color_id !== 'pastel-pink' || !['S', 'M', 'L'].includes(v.size)) return null;
      if (!/^[A-Z0-9-]{3,40}$/.test(v.sku) || ids.has(v.sku) || variants.has(v.size)) return null;
      variants.set(v.size, v.sku);
      ids.add(v.sku);
    }
    return variants.size === 3 ? { id: product.id, priceCents: product.price_cents, variants } : null;
  }
  function createCatalog(api, now = Date.now) {
    let value = null,
      expires = 0,
      pending = null,
      retryAt = 0;
    function current() {
      return now() < expires ? value : null;
    }
    async function read() {
      if (current() || now() < retryAt) return current();
      if (!pending) {
        pending = api
          .catalog()
          .then((data) => {
            value = dropProduct(data);
            expires = now() + 60000;
            retryAt = value ? 0 : now() + 20000;
            return value;
          })
          .catch((e) => {
            value = null;
            retryAt = now() + (e.retryAfterMs || 20000);
            return null;
          })
          .finally(() => {
            pending = null;
          });
      }
      return pending;
    }
    return { read, current };
  }
  if (typeof module === 'object' && module.exports) module.exports = { dropProduct, createCatalog };
  else root.SaylessCatalog = createCatalog(root.SaylessAPI);
})(typeof window === 'undefined' ? globalThis : window);
