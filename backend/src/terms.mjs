// CGV publiées et versionnées : le texte accepté est conservé tel quel (terms_documents, jamais
// modifié ni supprimé). La version courante est signée dans le devis et revérifiée au paiement.
import { audit, batch, fail, getSettings, one, sha256Hex, sql } from './lib.mjs';

export const TERMS_VERSION = /^[A-Za-z0-9._-]{1,40}$/;

export async function publishTerms(db, { version, body, actor, now }) {
  if (typeof version !== 'string' || !TERMS_VERSION.test(version)) throw fail('invalid_request', { field: 'version' });
  if (typeof body !== 'string' || body.trim().length < 200 || body.length > 200000) throw fail('invalid_request', { field: 'body' });
  const digest = await sha256Hex(body);
  try {
    await batch(db, [
      sql(db, 'INSERT INTO terms_documents (version, sha256, body, published_at, actor) VALUES (?, ?, ?, ?, ?)', version, digest, body, now, actor),
      sql(db, `UPDATE settings SET value = ? WHERE key = 'terms_version'`, version),
      audit(db, now, actor, 'terms_published', version, digest.slice(0, 16)),
    ]);
  } catch (error) {
    if (error.dbCode === 'unique_failed') throw fail('terms_version_exists');
    throw error;
  }
  return { version, sha256: digest, published_at: now };
}

// Version en vigueur et son empreinte ; null si aucune CGV n'est publiée. `archived` : le document
// existe dans l'archive (un numéro de version seul ne suffit jamais à ouvrir un devis).
export async function currentTerms(db) {
  const version = (await getSettings(db)).terms_version || '';
  if (!version) return null;
  const doc = await one(db, 'SELECT version, sha256, published_at FROM terms_documents WHERE version = ?', version);
  return { version, sha256: doc?.sha256 ?? null, published_at: doc?.published_at ?? null, archived: Boolean(doc?.sha256) };
}

// Document archivé, source unique du texte accepté (V13-C1) : version demandée, ou version en
// vigueur. L'empreinte est recalculée sur le texte servi : un texte qui ne correspond plus à son
// empreinte n'est jamais présenté comme le document accepté.
export async function termsDocument(db, version = null) {
  const current = (await getSettings(db)).terms_version || '';
  const wanted = version ?? current;
  if (!wanted || !TERMS_VERSION.test(wanted)) return null;
  const doc = await one(db, 'SELECT version, sha256, body, published_at FROM terms_documents WHERE version = ?', wanted);
  if (!doc) return null;
  return { ...doc, current: doc.version === current, intact: (await sha256Hex(doc.body)) === doc.sha256 };
}
