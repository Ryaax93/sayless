// Intentions d'e-mail durables (V13-B1). Une intention est écrite dans la MÊME transaction que
// l'événement qui la justifie (vente confirmée, demande enregistrée, colis expédié). La mise en
// file d'envoi (outbox) vient ensuite ; si elle échoue, l'intention reste en attente et elle est
// reprise au renvoi suivant du webhook, à la prochaine action liée et par la tâche planifiée.
// Clé unique : aucune intention ni aucun e-mail en double, même avec des passages simultanés.
// L'intention ne contient aucune donnée personnelle : l'adresse est relue, chiffrée, au moment
// de la mise en file.
import { orderItems } from './commerce.mjs';
import { orderConfirmationEmail, queueEmail, requestAckEmail, shippedEmail } from './email.mjs';
import { all, batch, one, sql } from './lib.mjs';
import { COST, fits } from './budget.mjs';
import { openContact, openPayload } from './security.mjs';

export const INTENT_KINDS = ['order_confirmation', 'request_ack', 'order_shipped'];
const CONFIRMABLE = ['paid', 'paid_no_stock', 'review', 'partially_refunded'];
const ALERT_AFTER = 5;

// Instruction à placer dans le lot qui crée l'événement. `when` : condition SQL évaluée dans le
// même lot (par exemple « la commande vient d'être payée »), avec ses paramètres dans `params`.
export function intentStatement(db, { kind, dedupe, ref, now, when = '1', params = [] }) {
  if (!INTENT_KINDS.includes(kind)) throw new Error(`intention inconnue : ${kind}`);
  return sql(db, `INSERT INTO mail_intents (dedupe, kind, ref, created_at, next_at)
    SELECT ?, ?, ?, ?, ? WHERE ${when}
    ON CONFLICT (dedupe) DO NOTHING`, dedupe, kind, ref, now, now, ...params);
}

// Contenu reconstitué depuis la base au moment de la mise en file. `null` : plus rien à envoyer
// (commande remboursée entre-temps, demande effacée par la politique de conservation).
async function message(env, intent) {
  const { db } = env;
  if (intent.kind === 'request_ack') {
    const row = await one(db, 'SELECT id, reference, type, order_reference, sealed, created_at FROM customer_requests WHERE id = ?', intent.ref);
    if (!row?.sealed) return null;
    const data = await openPayload(env, row.sealed, `request:${row.id}`);
    if (!data?.email) throw new Error('sealed_unreadable');
    return { to: data.email, ...requestAckEmail({ request: row, receivedAt: row.created_at }) };
  }
  const order = await one(db, 'SELECT * FROM orders WHERE id = ?', intent.ref);
  if (!order) return null;
  if (intent.kind === 'order_confirmation' && !CONFIRMABLE.includes(order.status)) return null;
  const sealed = (await one(db, 'SELECT sealed FROM order_contacts WHERE order_id = ?', order.id))?.sealed;
  if (!sealed) return null;
  const contact = await openContact(env, sealed, order.id);
  if (!contact?.email) throw new Error('contact_unreadable');
  if (!env.PUBLIC_ORIGIN) throw new Error('origin_missing');
  if (intent.kind === 'order_confirmation') {
    return { to: contact.email, ...orderConfirmationEmail({ order, items: await orderItems(db, order.id), origin: env.PUBLIC_ORIGIN }) };
  }
  const shipped = await one(db, `SELECT detail FROM order_events WHERE order_id = ? AND kind = 'shipped'`, order.id);
  const { carrier = null, tracking = null } = shipped?.detail ? JSON.parse(shipped.detail) : {};
  return { to: contact.email, ...shippedEmail({ order, carrier, tracking, origin: env.PUBLIC_ORIGIN }) };
}

const reason = (error) => String(error?.code ?? error?.dbCode ?? error?.message ?? 'erreur').slice(0, 120);

// Met en file les intentions en attente. `only` : une intention précise, sans attendre son
// prochain essai (action liée, renvoi du webhook). Sinon : les plus anciennes arrivées à échéance,
// `limit` au plus (budget de requêtes de l'offre gratuite). Ne lève jamais : chaque échec est noté
// sur l'intention, réessayé (1 min, 2 min, 4 min… 1 h au plus) et signalé après 5 essais.
export async function processMailIntents(env, deps, { only = null, limit = 3 } = {}) {
  const { db } = env;
  const now = deps.now();
  // Invocation comptée (tâche planifiée, webhook) : la lecture et au moins un e-mail doivent tenir.
  if (!fits(deps, { queries: 1 + COST.mailIntent.queries })) return { queued: 0, failed: 0, deferred: true };
  let rows;
  try {
    rows = only
      ? await all(db, 'SELECT * FROM mail_intents WHERE dedupe = ? AND queued_at IS NULL', only)
      : await all(db, 'SELECT * FROM mail_intents WHERE queued_at IS NULL AND next_at <= ? ORDER BY next_at LIMIT ?', now, limit);
  } catch {
    return { queued: 0, failed: 0, unavailable: true };
  }
  let queued = 0;
  let failed = 0;
  for (const intent of rows) {
    if (!fits(deps, COST.mailIntent)) break; // la suite à la minute suivante, jamais à mi-chemin
    try {
      const content = await message(env, intent);
      if (content && !(await queueEmail(env, { dedupe: intent.dedupe, ...content }, now))) throw new Error('email_not_configured');
      await batch(db, [sql(db, `UPDATE mail_intents SET queued_at = ?, last_error = ? WHERE dedupe = ? AND queued_at IS NULL`,
        now, content ? null : 'obsolete', intent.dedupe)]);
      queued += content ? 1 : 0;
    } catch (error) {
      failed += 1;
      const attempts = intent.attempts + 1;
      await batch(db, [sql(db, `UPDATE mail_intents SET attempts = ?, last_error = ?, next_at = ? WHERE dedupe = ? AND queued_at IS NULL`,
        attempts, reason(error), now + Math.min(3600, 60 * 2 ** Math.min(attempts - 1, 6)), intent.dedupe)]).catch(() => {});
      if (attempts === ALERT_AFTER && deps.notify) {
        try {
          await deps.notify({ kind: 'mail_intent_stuck', ref: intent.dedupe, level: 'critical', title: 'E-mail client en attente',
            body: `Un e-mail « ${intent.kind} » n’a pas pu être mis en file après ${ALERT_AFTER} essais (${reason(error)}). Nouvel essai automatique ; vérifier Resend et le chiffrement dans STUDIO.` });
        } catch {
          // Alerte reportée : l'intention reste en attente et sera de nouveau signalée par la santé du site.
        }
      }
    }
  }
  return { queued, failed };
}

// Intentions en attente depuis plus de `age` secondes (santé du site, rapport quotidien).
export async function pendingIntents(db, now, age = 600) {
  return (await one(db, 'SELECT COUNT(*) AS n FROM mail_intents WHERE queued_at IS NULL AND created_at <= ?', now - age))?.n ?? 0;
}
