// E-mails aux clients par Resend (offre gratuite, aucun abonnement) : confirmation de commande,
// expédition, accusé de réception d'une demande, lien de suivi. Ils passent par la file d'envoi
// commune (outbox, canal « email ») : le contenu, qui contient l'adresse du client, y est chiffré
// (PII_KEY) et lié à sa clé d'envoi. Rien ne part tant que RESEND_API_KEY et EMAIL_FROM (adresse
// d'un domaine vérifié chez Resend) ne sont pas saisis par le fondateur dans Cloudflare.
import { batch, sql } from './lib.mjs';
import { openPayload, sealPayload } from './security.mjs';

const ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i;
const senderAddress = (from) => String(from ?? '').match(/<([^<>]+)>\s*$/)?.[1] ?? String(from ?? '').trim();
export const emailReady = (env) => Boolean(env.RESEND_API_KEY && ADDRESS.test(senderAddress(env.EMAIL_FROM)));
export const validEmail = (value) => typeof value === 'string' && value.length <= 254 && ADDRESS.test(value.trim());

export async function queueEmail(env, { dedupe, to, subject, text }, now) {
  if (!emailReady(env) || !validEmail(to)) return false;
  const key = `email:${dedupe}`;
  const sealed = await sealPayload(env, { to: to.trim(), subject, text }, `outbox:${key}`);
  if (!sealed) return false;
  await batch(env.db, [sql(env.db, `INSERT INTO outbox (channel, dedupe, payload, at) VALUES ('email', ?, ?, ?)
    ON CONFLICT (dedupe) DO NOTHING`, key, sealed, now)]);
  return true;
}

// Envoi : la clé de la file sert de clé d'idempotence chez Resend (aucun double envoi sur un nouvel essai).
export function resendSender(env, transport = fetch) {
  return async (payload, row) => {
    const message = await openPayload(env, payload, `outbox:${row.dedupe}`);
    const response = await transport('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': row.dedupe.slice(0, 256) },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text,
        ...(env.EMAIL_REPLY_TO && validEmail(senderAddress(env.EMAIL_REPLY_TO)) ? { reply_to: env.EMAIL_REPLY_TO } : {}) }),
    });
    if (!response.ok) throw new Error(`resend_${response.status}`);
  };
}

// ---------- textes (tutoiement, comme la boutique) ----------
const euros = (cents) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;
const SIGNATURE = '\n\nSAYLESS\nSAY LESS. DO MORE.';
const relayText = (snapshot) => {
  if (!snapshot) return null;
  const r = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
  const a = r.address ?? {};
  return [r.name, a.line1, a.line2, [a.postcode, a.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
};
export const trackingLink = (origin) => `${origin}/#/suivi`;

export function orderConfirmationEmail({ order, items, origin }) {
  const lines = items.map((i) => `${i.label} × ${i.quantity}`).join('\n');
  const delivery = order.shipping_method === 'relay' ? `Point relais : ${relayText(order.relay_snapshot) ?? order.relay_label ?? ''}` : 'Livraison à domicile (adresse saisie au paiement)';
  return {
    subject: `Commande ${order.reference} confirmée`,
    text: `Merci, ta commande est confirmée.\n\nRéférence : ${order.reference}\n${lines}\n${delivery}\nTotal payé : ${euros(order.total_cents)}\n\n`
      + `On te prévient dès que ton colis part. Tu peux suivre ta commande avec ta référence et cette adresse e-mail : ${trackingLink(origin)}\n`
      + `Une question ? Réponds simplement à cet e-mail.${SIGNATURE}`,
  };
}

export function shippedEmail({ order, carrier, tracking, origin }) {
  const follow = tracking ? `\nTransporteur : ${carrier || 'non précisé'}\nNuméro de suivi : ${tracking}` : '';
  return {
    subject: `Ta commande ${order.reference} est en route`,
    text: `Ton colis est parti.${follow}\n\nSuivi de ta commande : ${trackingLink(origin)}${SIGNATURE}`,
  };
}

const REQUEST_NAMES = { contact: 'message', return: 'demande de retour', withdrawal: 'demande de rétractation' };
export function requestAckEmail({ request, receivedAt }) {
  const date = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short' }).format(new Date(receivedAt * 1000));
  const about = request.order_reference ? ` concernant la commande ${request.order_reference}` : '';
  const legal = request.type === 'withdrawal'
    ? '\n\nCet e-mail est l’accusé de réception de ta rétractation. Le renvoi de l’article et le remboursement suivent les conditions de vente (rubrique Retours).'
    : '';
  return {
    subject: `Nous avons bien reçu ta ${REQUEST_NAMES[request.type]} (${request.reference})`,
    text: `Ta ${REQUEST_NAMES[request.type]}${about} a bien été reçue le ${date}.\nRéférence de ta demande : ${request.reference}.${legal}\n\nOn te répond par e-mail.${SIGNATURE}`,
  };
}

export function lookupEmail({ order, link }) {
  return {
    subject: `Ton lien de suivi pour la commande ${order.reference}`,
    text: `Voici ton lien pour suivre ta commande ${order.reference}. Il reste valable 30 minutes :\n${link}\n\nTu n’as rien demandé ? Ignore cet e-mail : personne d’autre ne peut l’utiliser sans ta boîte mail.${SIGNATURE}`,
  };
}
