// Stripe : client REST minimal (fetch), signature des webhooks, paramètres de session déterministes.
// Les paramètres d'une session sont recalculés à l'identique à partir de la commande : une reprise
// avec la même clé d'idempotence retrouve la session d'origine au lieu d'en créer une seconde.
import { fail } from './lib.mjs';

export class StripeError extends Error {
  constructor(kind, status = 0, type = null, param = null) {
    super(`stripe_${kind}${status ? `_${status}` : ''}`);
    this.kind = kind; // network | api | mode_mismatch
    this.status = status;
    this.type = type;
    this.param = param;
  }
  // Réponse explicite de Stripe : la requête n'a créé aucun objet. Une erreur d'idempotence
  // (clé déjà utilisée avec d'autres paramètres), un 409 ou un 429 restent incertains.
  get definite() {
    return this.kind === 'api' && this.type !== 'idempotency_error' && [400, 401, 402, 403, 404].includes(this.status);
  }
}

export function stripeMode(env) {
  const key = env.STRIPE_SECRET_KEY ?? '';
  if (/^(sk|rk)_live_/.test(key)) return 'live';
  if (/^(sk|rk)_test_/.test(key)) return 'test';
  return null;
}
// Clé de production seulement en production ; clé de test seulement hors production.
export function stripeReady(env) {
  const mode = stripeMode(env);
  if (!mode || !env.STRIPE_WEBHOOK_SECRET) return false;
  return (mode === 'live') === (env.ENVIRONMENT === 'production');
}

export function createStripeClient(env, transport = fetch) {
  if (!stripeReady(env)) return null;
  const live = stripeMode(env) === 'live';
  async function call(method, path, params = null, idempotencyKey = null) {
    const headers = { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` };
    if (params) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    let response;
    try {
      response = await transport(`https://api.stripe.com/v1/${path}`, {
        method, headers, body: params ? new URLSearchParams(params).toString() : undefined,
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new StripeError('network');
    }
    let data = null;
    try {
      data = await response.json();
    } catch {
      throw new StripeError(response.ok ? 'network' : 'api', response.status);
    }
    if (!response.ok) throw new StripeError('api', response.status, data?.error?.type ?? null, data?.error?.param ?? null);
    if (typeof data.livemode === 'boolean' && data.livemode !== live) throw new StripeError('mode_mismatch');
    return data;
  }
  const id = (value, prefix) => {
    if (typeof value !== 'string' || !new RegExp(`^${prefix}_[A-Za-z0-9_]+$`).test(value)) throw fail('invalid_event');
    return value;
  };
  return {
    live,
    createCheckoutSession: (params, key) => call('POST', 'checkout/sessions', params, key),
    // Charge du paiement incluse : son instant de création date le règlement (ventes du lien 1.0).
    retrieveSession: (sid) => call('GET', `checkout/sessions/${id(sid, 'cs')}?expand%5B%5D=line_items.data.price.product&expand%5B%5D=payment_intent.latest_charge`),
    expireSession: (sid, key) => call('POST', `checkout/sessions/${id(sid, 'cs')}/expire`, [], key),
    retrieveCharge: (cid) => call('GET', `charges/${id(cid, 'ch')}?expand%5B%5D=refunds`),
  };
}

// Paramètres de Checkout : carte uniquement (Apple Pay et Google Pay passent par la carte),
// sans Klarna ni autre moyen activé par défaut sur le compte, et sans modifier le compte Stripe.
export function sessionParams(order, items, origin) {
  const ref = encodeURIComponent(order.reference);
  const p = [
    ['mode', 'payment'],
    ['client_reference_id', order.id],
    ['metadata[sayless_order_id]', order.id],
    ['metadata[order_reference]', order.reference],
    ['payment_intent_data[metadata][sayless_order_id]', order.id],
    ['success_url', `${origin}/merci?ref=${ref}&session_id={CHECKOUT_SESSION_ID}`],
    ['cancel_url', `${origin}/commande-annulee?ref=${ref}`],
    ['expires_at', String(order.stripe_expires_at)],
    ['locale', 'fr'],
    ['payment_method_types[0]', 'card'],
    ['phone_number_collection[enabled]', 'true'],
    ['shipping_options[0][shipping_rate_data][type]', 'fixed_amount'],
    ['shipping_options[0][shipping_rate_data][fixed_amount][amount]', String(order.shipping_cents)],
    ['shipping_options[0][shipping_rate_data][fixed_amount][currency]', 'eur'],
    ['shipping_options[0][shipping_rate_data][display_name]', order.shipping_method === 'relay' ? `Point relais — ${order.relay_label ?? ''}`.trim() : 'Colissimo domicile'],
  ];
  // Une seule option de livraison : celle choisie sur SAYLESS. Le montant affiché par Stripe est
  // celui du récapitulatif SAYLESS ; le client ne peut ni changer de mode ni de point relais ici.
  if (order.shipping_method === 'home') {
    p.push(['shipping_address_collection[allowed_countries][0]', 'FR']);
    p.push(['custom_text[shipping_address][message]', 'Livraison en France métropolitaine uniquement (hors Corse et outre-mer pour le moment).']);
  }
  if (order.shipping_method === 'relay') {
    p.push(['metadata[relay_id]', order.relay_id]);
    p.push(['custom_fields[0][key]', 'recipient_name']);
    p.push(['custom_fields[0][label][type]', 'custom']);
    p.push(['custom_fields[0][label][custom]', 'Nom de la personne qui retirera le colis']);
    p.push(['custom_fields[0][type]', 'text']);
    p.push(['custom_fields[0][optional]', 'false']);
  }
  items.forEach((item, i) => {
    p.push([`line_items[${i}][quantity]`, String(item.quantity)]);
    p.push([`line_items[${i}][price_data][currency]`, 'eur']);
    p.push([`line_items[${i}][price_data][unit_amount]`, String(item.unit_price_cents)]);
    p.push([`line_items[${i}][price_data][product_data][name]`, item.label]);
    p.push([`line_items[${i}][price_data][product_data][metadata][sku]`, item.sku]);
  });
  return p;
}

// Signature Stripe : HMAC-SHA256 du corps brut, tolérance de 5 minutes, plusieurs signatures v1.
export async function verifyStripeSignature(raw, header, secret, now, expectLive) {
  if (!secret || typeof raw !== 'string' || raw.length > 262144 || typeof header !== 'string') throw fail('invalid_signature');
  const parts = header.split(',').map((p) => p.trim().split('='));
  const ts = parts.filter((p) => p[0] === 't');
  const signatures = parts.filter((p) => p[0] === 'v1' && /^[a-f0-9]{64}$/.test(p[1] ?? ''));
  if (ts.length !== 1 || !/^\d+$/.test(ts[0][1]) || !signatures.length || Math.abs(now - Number(ts[0][1])) > 300) {
    throw fail('invalid_signature');
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  let valid = false;
  for (const [, hexSig] of signatures) {
    const bytes = Uint8Array.from(hexSig.match(/../g), (v) => parseInt(v, 16));
    valid = (await crypto.subtle.verify('HMAC', key, bytes, enc.encode(`${ts[0][1]}.${raw}`))) || valid;
  }
  if (!valid) throw fail('invalid_signature');
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    throw fail('invalid_event');
  }
  if (!/^evt_[A-Za-z0-9_]+$/.test(event?.id ?? '') || event.livemode !== expectLive) throw fail('invalid_event');
  return event;
}
