-- Contre-audit de Work du 28 novembre 2026 (PUSH-R4, PUSH-R5). Migration uniquement additive :
-- aucune table recréée, aucune ligne existante modifiée ni supprimée ; 0009 reste inchangée.
--
-- Santé par destination effective : un salon Discord en panne n'est plus « rétabli » par le succès
-- d'un autre salon. Discord : une ligne par webhook réellement utilisé (empreinte non secrète de son
-- adresse ; un webhook unique partagé par plusieurs salons = une seule destination) ; iPhone et
-- e-mails clients : une destination chacun. channel_health reste l'état agrégé par canal, recalculé
-- à partir de cette table (canal en échec dès qu'une de ses destinations l'est).
CREATE TABLE delivery_health (
  channel TEXT NOT NULL CHECK (channel IN ('discord', 'push', 'email')),
  destination TEXT NOT NULL,
  label TEXT,
  state TEXT NOT NULL DEFAULT 'ok' CHECK (state IN ('ok', 'failing')),
  since INTEGER NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  alerted_at INTEGER,
  last_ok_at INTEGER,
  PRIMARY KEY (channel, destination)
);
--> statement-breakpoint
-- État déjà connu de l'iPhone et des e-mails repris (une seule destination chacun). Discord : la
-- destination en panne n'était pas enregistrée ; elle sera reconnue à son prochain envoi.
INSERT INTO delivery_health (channel, destination, label, state, since, failures, last_error, alerted_at, last_ok_at)
  SELECT channel, CASE channel WHEN 'push' THEN 'iphone' ELSE 'resend' END, CASE channel WHEN 'push' THEN 'iPhone' ELSE 'Resend' END,
    state, since, failures, last_error, alerted_at, last_ok_at FROM channel_health WHERE channel IN ('push', 'email');
--> statement-breakpoint
-- Réception constatée sur l'iPhone : un essai depuis STUDIO porte un identifiant ; à son arrivée, le
-- service worker de l'iPhone le renvoie. « Accepté par Apple » (201) et « reçu sur l'iPhone » sont
-- ainsi distingués dans le diagnostic.
ALTER TABLE push_subscriptions ADD COLUMN test_id TEXT;
--> statement-breakpoint
ALTER TABLE push_subscriptions ADD COLUMN test_sent_at INTEGER;
--> statement-breakpoint
ALTER TABLE push_subscriptions ADD COLUMN received_at INTEGER;
