import {sqliteTable,text,integer,primaryKey,uniqueIndex,check} from 'drizzle-orm/sqlite-core';
import {sql} from 'drizzle-orm';
export const stockState=sqliteTable('stock_state',{
 scope:text('scope').primaryKey(), initialized:integer('initialized').notNull().default(0),
 reportedTotal:integer('reported_total'), reportedAt:text('reported_at'), verifiedAt:integer('verified_at'),
 revision:integer('revision').notNull().default(0)
},t=>[check('scope_valid',sql`${t.scope} IN ('real','test')`)]);
export const admins=sqliteTable('admins',{slot:integer('slot').primaryKey(),userId:text('user_id').notNull(),createdAt:integer('created_at').notNull()},t=>[check('one_admin',sql`${t.slot}=1`)]);
export const variants=sqliteTable('variants',{
 id:text('id').primaryKey(),scope:text('scope').notNull().references(()=>stockState.scope),color:text('color').notNull(),size:text('size').notNull(),
 available:integer('available').notNull(),reserved:integer('reserved').notNull().default(0),enabled:integer('enabled').notNull().default(1),
 revision:integer('revision').notNull().default(0),lastOperation:text('last_operation')
},t=>[uniqueIndex('variant_color_size').on(t.scope,t.color,t.size),check('stock_nonnegative',sql`${t.available}>=0 AND ${t.reserved}>=0`),check('enabled_boolean',sql`${t.enabled} IN (0,1)`)]);
export const orders=sqliteTable('orders',{
 id:text('id').primaryKey(),scope:text('scope').notNull().references(()=>stockState.scope),requestKey:text('request_key').notNull(),fingerprint:text('fingerprint').notNull(),
 status:text('status').notNull(),sessionId:text('session_id'),paymentIntent:text('payment_intent'),amountCents:integer('amount_cents').notNull(),shippingCents:integer('shipping_cents').notNull(),
 createdAt:integer('created_at').notNull(),expiresAt:integer('expires_at').notNull(),updatedAt:integer('updated_at').notNull(),refundCents:integer('refund_cents').notNull().default(0)
},t=>[uniqueIndex('order_request').on(t.scope,t.requestKey),uniqueIndex('order_session').on(t.sessionId),uniqueIndex('order_payment').on(t.paymentIntent),check('order_amounts',sql`${t.amountCents}>0 AND ${t.refundCents}>=0 AND ${t.refundCents}<=${t.amountCents}`)]);
export const orderItems=sqliteTable('order_items',{
 orderId:text('order_id').notNull().references(()=>orders.id),variantId:text('variant_id').notNull().references(()=>variants.id),
 quantity:integer('quantity').notNull(),returned:integer('returned').notNull().default(0)
},t=>[primaryKey({columns:[t.orderId,t.variantId]}),check('item_quantities',sql`${t.quantity}>0 AND ${t.returned}>=0 AND ${t.returned}<=${t.quantity}`)]);
export const stripeEvents=sqliteTable('stripe_events',{id:text('id').primaryKey(),type:text('type').notNull(),objectId:text('object_id').notNull(),processedAt:integer('processed_at').notNull()});
export const operations=sqliteTable('operations',{id:text('id').primaryKey(),fingerprint:text('fingerprint').notNull(),actor:text('actor').notNull(),reason:text('reason').notNull(),details:text('details').notNull(),createdAt:integer('created_at').notNull()});
