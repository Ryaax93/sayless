// Conservation des données (proposition du 24 novembre, appliquée seulement si retention_enabled = 1).
//  - coordonnées (e-mail, téléphone, adresse, destinataire) : actives jusqu'à 90 jours après la
//    livraison, puis archivées (consultation explicite et journalisée), supprimées après 913 jours
//    (garantie légale de conformité : 2 ans après la délivrance, 30 mois après une réparation) ;
//  - nom, montant, date, référence : conservés avec la comptabilité (10 ans) ;
//  - traces d'accès aux coordonnées et de connexion : 1 an ;
//  - empreintes anti-abus : 30 jours (réservations terminées), 2 jours (limites d'abus).
// Point de départ : la livraison confirmée, à défaut le paiement.
import { audit, batch, getSettings, sql } from './lib.mjs';

const DAY = 86400;
const reference = `COALESCE((SELECT s.tracking_at FROM shipments s WHERE s.order_id = o.id AND s.tracking = 'delivered'), o.paid_at)`;

export async function applyRetention(env, deps) {
  const { db } = env;
  const now = deps.now();
  const settings = await getSettings(db);
  const result = { rate_limits: 0, archived: 0, deleted: 0, client_hashes: 0, access_logs: 0, enabled: settings.retention_enabled === '1' };
  // Données purement techniques, sans lien avec un client : nettoyées dans tous les cas.
  const rl = await batch(db, [sql(db, 'DELETE FROM rate_limits WHERE win * 600 < ?', now - 2 * DAY)]);
  result.rate_limits = rl[0].meta.changes;
  if (!result.enabled) return result;
  const archiveDays = Number(settings.contact_archive_days || 90);
  const deleteDays = Number(settings.contact_delete_days || 913);
  const accessDays = Math.max(Number(settings.access_log_days || 365), 365);
  const hashDays = Number(settings.client_hash_days || 30);
  const res = await batch(db, [
    sql(db, `UPDATE order_contacts SET archived_at = ? WHERE archived_at IS NULL AND order_id IN
      (SELECT o.id FROM orders o WHERE ${reference} <= ?)`, now, now - archiveDays * DAY),
    sql(db, `DELETE FROM order_contacts WHERE order_id IN (SELECT o.id FROM orders o WHERE ${reference} <= ?)`, now - deleteDays * DAY),
    sql(db, `UPDATE reservations SET client_hash = 'anonymise' WHERE client_hash <> 'anonymise'
      AND status IN ('converted', 'released') AND updated_at <= ?`, now - hashDays * DAY),
    sql(db, `DELETE FROM audit_log WHERE action IN ('view_customer_contact', 'view_archived_contact', 'session_login', 'session_failed')
      AND at <= ? AND at < CAST(strftime('%s', 'now') AS INTEGER) - 31536000`, now - accessDays * DAY),
  ]);
  [result.archived, result.deleted, result.client_hashes, result.access_logs] = res.map((r) => r.meta.changes);
  if (result.archived || result.deleted) {
    await batch(db, [audit(db, now, 'system', 'retention', null, `archivées=${result.archived} supprimées=${result.deleted}`)]);
  }
  return result;
}
