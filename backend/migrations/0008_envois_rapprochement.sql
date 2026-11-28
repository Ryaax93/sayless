-- V14-R1 (contre-audit v1.4 de Work) : un e-mail dont la réponse de Resend s'est perdue ne doit
-- pas être renvoyé après la fin de la protection contre les doublons (clé d'idempotence gardée
-- 24 h par Resend). La file garde la première tentative, la dernière, le début de l'incertitude,
-- l'enveloppe figée (expéditeur et réponse), la référence Resend et la dernière erreur ; l'état
-- « uncertain » demande un rapprochement par le fondateur avant tout nouvel envoi.
-- `route` : destination logique d'un message Discord (salon), résolue côté serveur à l'envoi.
-- Recréation de la table : seule façon d'élargir la contrainte CHECK dans SQLite.
CREATE TABLE outbox_v8 (
  id INTEGER PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('discord', 'push', 'email')),
  dedupe TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'dead', 'uncertain')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL,
  first_attempt_at INTEGER,
  last_attempt_at INTEGER,
  uncertain_since INTEGER,
  envelope TEXT,
  provider_ref TEXT,
  last_error TEXT,
  route TEXT
);
--> statement-breakpoint
-- Lignes déjà essayées avant cette migration : instant réel du premier essai inconnu, au plus tôt
-- l'entrée en file ; issue des essais inconnue pour un e-mail non envoyé. Hypothèse prudente.
INSERT INTO outbox_v8 (id, channel, dedupe, payload, status, attempts, next_at, at, first_attempt_at, last_attempt_at, uncertain_since)
  SELECT id, channel, dedupe, payload, status, attempts, next_at, at,
    CASE WHEN attempts > 0 THEN at END,
    CASE WHEN attempts > 0 THEN at END,
    CASE WHEN channel = 'email' AND attempts > 0 AND status IN ('pending', 'sending') THEN at END
  FROM outbox;
--> statement-breakpoint
DROP TABLE outbox;
--> statement-breakpoint
ALTER TABLE outbox_v8 RENAME TO outbox;
--> statement-breakpoint
CREATE INDEX idx_outbox_due ON outbox (status, next_at);
