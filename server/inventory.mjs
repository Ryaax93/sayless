// Monetary values are integer cents. DB triggers enforce every stock transition.
export const UNIT_CENTS=7500;
export const SHIPPING_CENTS=Object.freeze({home:850,relay:490});
export const DECLARATION=Object.freeze({total:26,produced:30,gifted:2,sold:2,date:'2026-11-21'});
export class AppError extends Error {constructor(code,status=400){super(code);this.code=code;this.status=status;}}
export const stmt=(db,sql,...values)=>db.prepare(sql).bind(...values);
export const nowSeconds=()=>Math.floor(Date.now()/1000);
export function validateItems(items){
 if(!Array.isArray(items)||!items.length||items.length>12)throw new AppError('invalid_items');
 const clean=items.map(i=>({variantId:String(i.variantId||''),quantity:i.quantity})).sort((a,b)=>a.variantId.localeCompare(b.variantId));
 if(clean.some(i=>!i.variantId||i.variantId.length>100||!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>5)||new Set(clean.map(i=>i.variantId)).size!==clean.length)throw new AppError('invalid_items');
 return clean;
}
export function key(value){if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(value))throw new AppError('invalid_request_key');return value;}
export async function fingerprint(value){const bytes=new TextEncoder().encode(JSON.stringify(value));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function getInventory(db,scope='real'){
 const results=await db.batch([stmt(db,'SELECT * FROM stock_state WHERE scope=?',scope),stmt(db,'SELECT id,color,size,available,reserved,enabled,revision FROM variants WHERE scope=? ORDER BY color,size',scope)]);
 const state=results[0].results[0];const variants=results[1].results;
 if(!state?.initialized)return {status:'unallocated',scope,total:null,reportedTotal:scope==='real'?DECLARATION.total:null,reportedAt:scope==='real'?DECLARATION.date:null,variants:[],observedAt:Date.now()};
 return {status:'verified',scope,total:variants.reduce((n,v)=>n+(v.enabled?v.available:0),0),reserved:variants.reduce((n,v)=>n+v.reserved,0),revision:state.revision,verifiedAt:state.verified_at,observedAt:Date.now(),variants};
}
export async function initializeInventory(db,scope,rows,actor,requestKey){
 key(requestKey);if(!['real','test'].includes(scope)||!Array.isArray(rows)||!rows.length||rows.length>12)throw new AppError('invalid_inventory');
 const variants=rows.map(v=>({color:String(v.color||'').trim(),size:String(v.size||'').trim(),quantity:v.quantity}));
 if(variants.some(v=>!v.color||v.color.length>40||!v.size||v.size.length>12||!Number.isInteger(v.quantity)||v.quantity<0||v.quantity>100)||new Set(variants.map(v=>`${v.color.toLowerCase()}:${v.size.toUpperCase()}`)).size!==variants.length)throw new AppError('invalid_inventory');
 if(scope==='real'&&variants.some(v=>v.color.toLowerCase()!=='rose'))throw new AppError('invalid_color');
 if(scope==='real')variants.forEach(v=>{v.color='Rose';});
 if(scope==='real'&&variants.some(v=>!['S','M','L'].includes(v.size)))throw new AppError('invalid_size');
 if(scope==='real'&&variants.reduce((n,v)=>n+v.quantity,0)!==26)throw new AppError('initial_total_must_be_26');
 const fp=await fingerprint({scope,variants});const previous=await stmt(db,'SELECT * FROM operations WHERE id=?',requestKey).first();
 if(previous){if(previous.fingerprint!==fp)throw new AppError('idempotency_conflict',409);return getInventory(db,scope);}
 const time=nowSeconds();
 const commands=[stmt(db,"INSERT INTO stock_state(scope,initialized,reported_total,reported_at,verified_at,revision) VALUES(?,1,?,?,?,1)",scope,scope==='real'?26:null,scope==='real'?DECLARATION.date:null,time)];
 for(const v of variants)commands.push(stmt(db,'INSERT INTO variants(id,scope,color,size,available) VALUES(?,?,?,?,?)',crypto.randomUUID(),scope,v.color,v.size,v.quantity));
 commands.push(stmt(db,'INSERT INTO operations VALUES(?,?,?,?,?,?)',requestKey,fp,actor,'Inventaire initial confirmé',JSON.stringify({scope,variants}),time));
 try{await db.batch(commands);}catch(e){const done=await stmt(db,'SELECT fingerprint FROM operations WHERE id=?',requestKey).first();if(done?.fingerprint===fp)return getInventory(db,scope);throw new AppError('inventory_already_initialized',409);}
 return getInventory(db,scope);
}
export async function getOrder(db,id){const order=await stmt(db,'SELECT * FROM orders WHERE id=?',id).first();if(!order)return null;order.items=(await stmt(db,'SELECT i.*,v.color,v.size FROM order_items i JOIN variants v ON v.id=i.variant_id WHERE order_id=? ORDER BY variant_id',id).all()).results;return order;}
export async function reserve(db,{scope='test',items,requestKey,shipping='home'},clock=nowSeconds()){
 key(requestKey);if(!['real','test'].includes(scope))throw new AppError('invalid_scope');
 // Relay remains blocked until a carrier returns and verifies a real relay identifier.
 if(shipping!=='home')throw new AppError('relay_not_connected',409);
 items=validateItems(items);const fp=await fingerprint({scope,items,shipping});
 const existing=await stmt(db,'SELECT id,fingerprint FROM orders WHERE scope=? AND request_key=?',scope,requestKey).first();
 if(existing){if(existing.fingerprint!==fp)throw new AppError('idempotency_conflict',409);return getOrder(db,existing.id);}
 const id=crypto.randomUUID();const amount=items.reduce((n,i)=>n+i.quantity*UNIT_CENTS,SHIPPING_CENTS[shipping]);
 const commands=[stmt(db,'INSERT INTO orders(id,scope,request_key,fingerprint,status,amount_cents,shipping_cents,created_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,scope,requestKey,fp,'creating',amount,SHIPPING_CENTS[shipping],clock,clock+1860,clock)];
 for(const item of items)commands.push(stmt(db,'INSERT INTO order_items(order_id,variant_id,quantity) VALUES(?,?,?)',id,item.variantId,item.quantity));
 commands.push(stmt(db,"UPDATE orders SET status='reserved' WHERE id=?",id));
 try{await db.batch(commands);}catch(e){
  const retried=await stmt(db,'SELECT id,fingerprint FROM orders WHERE scope=? AND request_key=?',scope,requestKey).first();
  if(retried){if(retried.fingerprint!==fp)throw new AppError('idempotency_conflict',409);return getOrder(db,retried.id);}
  if(/stock_unavailable|CHECK constraint|FOREIGN KEY/i.test(e.message))throw new AppError('stock_unavailable',409);
  throw e;
 }
 return getOrder(db,id);
}
export async function attachSession(db,id,session){
 if(!session?.id||session.livemode!==false)throw new AppError('live_payments_forbidden',403);
 await stmt(db,'UPDATE orders SET session_id=?,updated_at=? WHERE id=? AND scope=\'test\' AND (session_id IS NULL OR session_id=?)',session.id,nowSeconds(),id,session.id).run();
 const order=await getOrder(db,id);if(order?.session_id!==session.id)throw new AppError('session_conflict',409);return order;
}
export async function applySessionEvent(db,event,session){
 const duplicate=await stmt(db,'SELECT id FROM stripe_events WHERE id=?',event.id).first();if(duplicate)return {duplicate:true};
 if(event.livemode!==false||session.livemode!==false)throw new AppError('live_payments_forbidden',403);
 const id=session.metadata?.sayless_order_id;const order=await getOrder(db,id);
 if(!order||order.scope!=='test')throw new AppError('unknown_order',409);
 if(order.session_id&&order.session_id!==session.id)throw new AppError('session_mismatch',409);
 if(session.amount_total!==order.amount_cents||session.currency!=='eur'||session.client_reference_id!==order.id)throw new AppError('payment_mismatch',409);
 const lines=session.line_items?.data;
 if(!Array.isArray(lines)||session.line_items.has_more||lines.length!==order.items.length)throw new AppError('line_items_mismatch',409);
 const expected=new Map(order.items.map(i=>[i.variant_id,i.quantity]));
 for(const line of lines){const sku=line.price?.product?.metadata?.sayless_variant_id;if(expected.get(sku)!==line.quantity||line.price?.unit_amount!==UNIT_CENTS||line.price?.currency!=='eur')throw new AppError('line_items_mismatch',409);expected.delete(sku);}
 if(expected.size)throw new AppError('line_items_mismatch',409);
 let next=null;
 if(session.payment_status==='paid')next='paid';
 else if(session.status==='expired')next='expired';
 else if(event.type==='checkout.session.async_payment_failed'&&session.status==='complete')next='failed';
 else if(session.status==='complete'&&session.payment_status==='unpaid')next='pending';
 const pi=typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id||null;
 const cmds=[stmt(db,'INSERT INTO stripe_events VALUES(?,?,?,?)',event.id,event.type,session.id,nowSeconds()),stmt(db,'UPDATE orders SET session_id=?,payment_intent=COALESCE(?,payment_intent),updated_at=? WHERE id=?',session.id,pi,nowSeconds(),id)];
 if(next)cmds.push(stmt(db,next==='paid'?"UPDATE orders SET status=?,updated_at=? WHERE id=? AND status != 'paid'":"UPDATE orders SET status=?,updated_at=? WHERE id=? AND status IN ('reserved','pending')",next,nowSeconds(),id));
 // A paid event after a released reservation is quarantined, never silently fulfilled.
 if(next==='paid'&&['expired','cancelled','failed'].includes(order.status))throw new AppError('paid_after_release_requires_review',409);
 try{await db.batch(cmds);}catch(e){if(await stmt(db,'SELECT id FROM stripe_events WHERE id=?',event.id).first())return {duplicate:true};throw e;}
 return {duplicate:false,status:(await getOrder(db,id)).status};
}
export async function recordRefund(db,event,charge){
 if(event.livemode!==false||charge.livemode!==false)throw new AppError('live_payments_forbidden',403);
 const pi=typeof charge.payment_intent==='string'?charge.payment_intent:charge.payment_intent?.id;
 const order=await stmt(db,'SELECT * FROM orders WHERE payment_intent=?',pi||'').first();
 if(!order||order.scope!=='test')throw new AppError('refund_order_not_ready',409);
 if(!Number.isInteger(charge.amount_refunded)||charge.amount_refunded<0||charge.amount_refunded>order.amount_cents||charge.currency!=='eur')throw new AppError('refund_mismatch',409);
 try{await db.batch([stmt(db,'INSERT INTO stripe_events VALUES(?,?,?,?)',event.id,event.type,charge.id,nowSeconds()),stmt(db,'UPDATE orders SET refund_cents=MAX(refund_cents,?),updated_at=? WHERE id=?',charge.amount_refunded,nowSeconds(),order.id)]);}catch(e){if(await stmt(db,'SELECT id FROM stripe_events WHERE id=?',event.id).first())return {duplicate:true};throw e;}
 // Refunds do not imply that a physical item has been returned in saleable condition.
 return {duplicate:false,restocked:false};
}
export async function adjustStock(db,{variantId,physicalQuantity,expectedRevision,reason,requestKey},actor){
 key(requestKey);if(!Number.isInteger(physicalQuantity)||physicalQuantity<0||physicalQuantity>1000||!Number.isInteger(expectedRevision)||!reason?.trim()||reason.length>300)throw new AppError('invalid_adjustment');
 const fp=await fingerprint({variantId,physicalQuantity,expectedRevision,reason});const existing=await stmt(db,'SELECT fingerprint FROM operations WHERE id=?',requestKey).first();
 if(existing){if(existing.fingerprint!==fp)throw new AppError('idempotency_conflict',409);return {duplicate:true};}
 let res;try{res=await db.batch([
 stmt(db,'UPDATE variants SET available=?-reserved,revision=revision+1,last_operation=? WHERE id=? AND revision=?',physicalQuantity,requestKey,variantId,expectedRevision),
 stmt(db,'INSERT INTO operations SELECT ?,?,?,?,?,? FROM variants WHERE id=? AND last_operation=?',requestKey,fp,actor,reason,JSON.stringify({variantId,physicalQuantity,expectedRevision}),nowSeconds(),variantId,requestKey)
 ]);}catch(e){if(/CHECK constraint/.test(e.message))throw new AppError('quantity_below_reservations',409);const done=await stmt(db,'SELECT fingerprint FROM operations WHERE id=?',requestKey).first();if(done?.fingerprint===fp)return {duplicate:true};throw e;}
 if(!res[0].meta.changes)throw new AppError('stock_changed_refresh_required',409);return {duplicate:false};
}
export async function restockReturn(db,{orderId,variantId,quantity,reason,requestKey},actor){
 key(requestKey);if(!Number.isInteger(quantity)||quantity<1||!reason?.trim()||reason.length>300)throw new AppError('invalid_return');
 const fp=await fingerprint({orderId,variantId,quantity,reason});const old=await stmt(db,'SELECT fingerprint FROM operations WHERE id=?',requestKey).first();if(old){if(old.fingerprint!==fp)throw new AppError('idempotency_conflict',409);return {duplicate:true};}
 const order=await getOrder(db,orderId);if(order?.status!=='paid'||!order.items.some(i=>i.variant_id===variantId))throw new AppError('return_order_not_paid',409);
 try{await db.batch([stmt(db,'INSERT INTO operations VALUES(?,?,?,?,?,?)',requestKey,fp,actor,reason,JSON.stringify({orderId,variantId,quantity}),nowSeconds()),stmt(db,'UPDATE order_items SET returned=returned+? WHERE order_id=? AND variant_id=?',quantity,orderId,variantId)]);}catch(e){const done=await stmt(db,'SELECT fingerprint FROM operations WHERE id=?',requestKey).first();if(done?.fingerprint===fp)return {duplicate:true};if(/CHECK constraint/.test(e.message))throw new AppError('return_quantity_exceeded',409);throw e;}
 return {duplicate:false};
}
