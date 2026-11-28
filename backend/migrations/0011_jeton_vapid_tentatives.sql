-- Second contre-audit de Work du 28 novembre 2026 (P2-R1 à P2-R4). Migration uniquement additive :
-- une table et trois colonnes ; aucune ligne existante modifiée ni supprimée ; 0009 et 0010 restent
-- inchangées.
--
-- Jeton VAPID partagé par toutes les instances du Worker : signé par Web Crypto (signature native),
-- enregistré ici et remplacé de façon atomique (une seule instance gagne une rotation). Il ne donne
-- que le droit d'envoyer des notifications, 12 heures au plus ; jamais affiché ni journalisé, et
-- jamais copié dans les sauvegardes (table recréée vide à la restauration). Une ligne par service
-- de notification et par configuration (empreinte non secrète de la clé publique et du sujet).
CREATE TABLE vapid_tokens (
  audience TEXT NOT NULL,
  config TEXT NOT NULL,
  token TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (audience, config)
);
--> statement-breakpoint
-- Tentative par appareil : chaque envoi réserve un numéro avant l'appel au service de notification ;
-- son résultat n'est écrit que si aucun envoi plus récent n'a été réservé entre-temps. Sinon il est
-- seulement noté dans l'historique.
ALTER TABLE push_subscriptions ADD COLUMN attempt_seq INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Dernière inscription admise par le serveur (« Activer » dans STUDIO) : le même lot vérifie que
-- l'inscription a bien été admise avant d'écrire le journal et la réponse.
ALTER TABLE push_subscriptions ADD COLUMN admitted_at INTEGER;
--> statement-breakpoint
-- Destination Discord retirée (webhook remplacé ou supprimé de la configuration) : gardée avec son
-- historique, mais exclue de l'état du canal ; de nouveau active si son webhook est reconfiguré.
ALTER TABLE delivery_health ADD COLUMN retired_at INTEGER;
