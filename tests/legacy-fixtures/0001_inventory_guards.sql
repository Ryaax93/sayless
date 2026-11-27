-- Schema-only invariants: stock and order state change in the same D1 transaction.
CREATE TRIGGER reserve_item_guard BEFORE INSERT ON order_items BEGIN
 SELECT RAISE(ABORT,'stock_unavailable') WHERE NOT EXISTS (
  SELECT 1 FROM variants v JOIN orders o ON o.id=NEW.order_id JOIN stock_state s ON s.scope=v.scope
  WHERE v.id=NEW.variant_id AND v.scope=o.scope AND s.initialized=1 AND v.enabled=1
   AND v.available>=NEW.quantity AND o.status='creating'
 );
END;
--> statement-breakpoint
CREATE TRIGGER reserve_item AFTER INSERT ON order_items BEGIN
 UPDATE variants SET available=available-NEW.quantity,reserved=reserved+NEW.quantity,revision=revision+1 WHERE id=NEW.variant_id;
END;
--> statement-breakpoint
CREATE TRIGGER order_item_identity BEFORE UPDATE OF order_id,variant_id,quantity ON order_items BEGIN
 SELECT RAISE(ABORT,'order_items_immutable');
END;
--> statement-breakpoint
CREATE TRIGGER order_transition_guard BEFORE UPDATE OF status ON orders WHEN OLD.status!=NEW.status BEGIN
 SELECT RAISE(ABORT,'invalid_order_transition') WHERE NOT (
  (OLD.status='creating' AND NEW.status='reserved') OR
  (OLD.status IN ('reserved','pending') AND NEW.status IN ('pending','paid','expired','cancelled','failed'))
 );
END;
--> statement-breakpoint
CREATE TRIGGER order_paid AFTER UPDATE OF status ON orders WHEN NEW.status='paid' AND OLD.status IN ('reserved','pending') BEGIN
 UPDATE variants SET reserved=reserved-(SELECT quantity FROM order_items WHERE order_id=NEW.id AND variant_id=variants.id),revision=revision+1
 WHERE id IN (SELECT variant_id FROM order_items WHERE order_id=NEW.id);
END;
--> statement-breakpoint
CREATE TRIGGER order_released AFTER UPDATE OF status ON orders WHEN NEW.status IN ('expired','cancelled','failed') AND OLD.status IN ('reserved','pending') BEGIN
 UPDATE variants SET available=available+(SELECT quantity FROM order_items WHERE order_id=NEW.id AND variant_id=variants.id),reserved=reserved-(SELECT quantity FROM order_items WHERE order_id=NEW.id AND variant_id=variants.id),revision=revision+1
 WHERE id IN (SELECT variant_id FROM order_items WHERE order_id=NEW.id);
END;
--> statement-breakpoint
CREATE TRIGGER variant_changed AFTER UPDATE OF available,reserved,enabled ON variants BEGIN
 UPDATE stock_state SET revision=revision+1,verified_at=CAST(strftime('%s','now') AS INTEGER) WHERE scope=NEW.scope;
END;
--> statement-breakpoint
CREATE TRIGGER return_guard BEFORE UPDATE OF returned ON order_items BEGIN
 SELECT RAISE(ABORT,'invalid_return') WHERE NEW.returned<OLD.returned OR NOT EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id AND status='paid');
END;
--> statement-breakpoint
CREATE TRIGGER item_returned AFTER UPDATE OF returned ON order_items WHEN NEW.returned>OLD.returned BEGIN
 UPDATE variants SET available=available+NEW.returned-OLD.returned,revision=revision+1 WHERE id=NEW.variant_id;
END;
