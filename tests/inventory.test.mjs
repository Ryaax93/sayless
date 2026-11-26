import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {stmt,getInventory,initializeInventory,reserve,getOrder,attachSession,applySessionEvent,recordRefund,adjustStock,restockReturn} from '../server/inventory.mjs';
import {verifyStripeSignature,stripeReady,StripeTestClient,startTestCheckout,handleStripeWebhook,reconcileOrder} from '../server/stripe.mjs';
import {handleRequest} from '../server/api.mjs';

let mf,db;
const key=()=>crypto.randomUUID();
const env={STRIPE_TEST_ENABLED:'true',STRIPE_TEST_SECRET_KEY:'sk_test_fixture',STRIPE_TEST_WEBHOOK_SECRET:'whsec_fixture'};
const event=(type='checkout.session.completed',id='evt_'+key().replaceAll('-',''))=>({id,type,livemode:false});
const sign=(raw,time=Math.floor(Date.now()/1000))=>`t=${time},v1=${createHmac('sha256',env.STRIPE_TEST_WEBHOOK_SECRET).update(time+'.'+raw).digest('hex')}`;
async function initialize(q=3){return initializeInventory(db,'test',[{color:'Essai',size:'TEST',quantity:q}], 'test-owner',key());}
async function orderFor(quantity=1){const inventory=await getInventory(db,'test');return reserve(db,{items:[{variantId:inventory.variants[0].id,quantity}],requestKey:key()});}
function sessionFor(order,override={}){return {id:'cs_test_'+order.id.replaceAll('-',''),livemode:false,metadata:{sayless_order_id:order.id},client_reference_id:order.id,amount_total:order.amount_cents,currency:'eur',status:'complete',payment_status:'paid',payment_intent:'pi_'+order.id.replaceAll('-',''),url:'https://checkout.stripe.com/c/pay/test_fixture',line_items:{has_more:false,data:order.items.map(i=>({quantity:i.quantity,price:{unit_amount:7500,currency:'eur',product:{metadata:{sayless_variant_id:i.variant_id}}}}))},...override};}
async function quantity(){const s=await getInventory(db,'test');return [s.total,s.reserved];}
const rejectsCode=(promise,code)=>assert.rejects(promise,e=>e.code===code);

before(async()=>{
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB'],compatibilityDate:'2026-05-15'}));
 db=await mf.getD1Database('DB');
 for(const name of ['0000_sweet_warbird.sql','0001_inventory_guards.sql']){
  const sql=await readFile(new URL('../drizzle/'+name,import.meta.url),'utf8');
  for(const part of sql.split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await db.prepare(part).run();
 }
});
after(async()=>{await mf?.dispose();});
beforeEach(async()=>{for(const table of ['order_items','orders','variants','stock_state','stripe_events','operations','admins'])await db.prepare('DELETE FROM '+table).run();});

test('inventory remains unallocated until an exact 26-piece breakdown is confirmed',async()=>{
 const initial=await getInventory(db);assert.equal(initial.status,'unallocated');assert.equal(initial.total,null);assert.equal(initial.reportedTotal,26);assert.deepEqual(initial.variants,[]);
 await rejectsCode(initializeInventory(db,'real',[{color:'Rose',size:'S',quantity:25}],'owner',key()),'initial_total_must_be_26');
 await rejectsCode(initializeInventory(db,'real',[{color:'Noir',size:'S',quantity:26}],'owner',key()),'invalid_color');
 const confirmed=await initializeInventory(db,'real',[{color:'Rose',size:'S',quantity:26},{color:'Rose',size:'M',quantity:0}],'owner',key());
 assert.equal(confirmed.total,26);assert.equal(confirmed.variants.find(v=>v.size==='M').available,0);
 await initialize(2);await orderFor();assert.equal((await getInventory(db)).total,26);assert.deepEqual(await quantity(),[1,1]);
});

test('20 concurrent buyers cannot reserve more than three units',async()=>{
 await initialize(3);const results=await Promise.allSettled(Array.from({length:20},()=>orderFor()));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,3);
 assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='stock_unavailable').length,17);
 assert.deepEqual(await quantity(),[0,3]);assert.equal((await stmt(db,'SELECT count(*) n FROM orders').first()).n,3);
});

test('a multi-variant reservation rolls back entirely if one line is unavailable',async()=>{
 const inv=await initializeInventory(db,'test',[{color:'A',size:'TEST',quantity:2},{color:'B',size:'TEST',quantity:0}],'owner',key());
 await rejectsCode(reserve(db,{items:inv.variants.map(v=>({variantId:v.id,quantity:1})),requestKey:key()}),'stock_unavailable');
 assert.deepEqual(await quantity(),[2,0]);assert.equal((await stmt(db,'SELECT count(*) n FROM orders').first()).n,0);
});

test('concurrent duplicate checkout requests reserve once and reject changed payloads',async()=>{
 const inv=await initialize(3);const input={requestKey:key(),items:[{variantId:inv.variants[0].id,quantity:1}]};
 const orders=await Promise.all(Array.from({length:8},()=>reserve(db,input)));assert.equal(new Set(orders.map(o=>o.id)).size,1);assert.deepEqual(await quantity(),[2,1]);
 await rejectsCode(reserve(db,{...input,items:[{variantId:inv.variants[0].id,quantity:2}]}),'idempotency_conflict');
 await rejectsCode(reserve(db,{...input,requestKey:key(),shipping:'relay'}),'relay_not_connected');
});

test('signed notifications are verified using the raw body, tolerance and v1 signatures',async()=>{
 const e=event(),raw=JSON.stringify(e);assert.equal((await verifyStripeSignature(raw,sign(raw),env.STRIPE_TEST_WEBHOOK_SECRET)).id,e.id);
 await rejectsCode(verifyStripeSignature(raw+' ',sign(raw),env.STRIPE_TEST_WEBHOOK_SECRET),'invalid_signature');
 await rejectsCode(verifyStripeSignature(raw,sign(raw,Math.floor(Date.now()/1000)-301),env.STRIPE_TEST_WEBHOOK_SECRET),'invalid_signature');
 await rejectsCode(verifyStripeSignature(raw,sign(raw,Math.floor(Date.now()/1000)+301),env.STRIPE_TEST_WEBHOOK_SECRET),'invalid_signature');
 await rejectsCode(verifyStripeSignature(raw,sign(raw).replace('v1=','v0='),env.STRIPE_TEST_WEBHOOK_SECRET),'invalid_signature');
 const mixed=sign(raw)+',v1='+'0'.repeat(64);assert.equal((await verifyStripeSignature(raw,mixed,env.STRIPE_TEST_WEBHOOK_SECRET)).id,e.id);
 const live=JSON.stringify({...e,livemode:true});await rejectsCode(verifyStripeSignature(live,sign(live),env.STRIPE_TEST_WEBHOOK_SECRET),'live_or_invalid_event');
});

test('duplicate and reordered payment notifications never double-count stock',async()=>{
 await initialize(3);const order=await orderFor(),session=sessionFor(order),e=event();
 await Promise.all(Array.from({length:8},()=>applySessionEvent(db,e,session)));
 await applySessionEvent(db,event(),session);assert.deepEqual(await quantity(),[2,0]);assert.equal((await getOrder(db,order.id)).status,'paid');
 await applySessionEvent(db,event('checkout.session.expired'),sessionFor(order,{status:'expired',payment_status:'unpaid'}));assert.deepEqual(await quantity(),[2,0]);
});

test('wrong amount, currency or line items cannot confirm an order',async()=>{
 await initialize();const order=await orderFor();
 await rejectsCode(applySessionEvent(db,event(),sessionFor(order,{amount_total:1})),'payment_mismatch');
 await rejectsCode(applySessionEvent(db,event(),sessionFor(order,{currency:'usd'})),'payment_mismatch');
 await rejectsCode(applySessionEvent(db,event(),sessionFor(order,{line_items:{has_more:false,data:[]}})),'line_items_mismatch');
 assert.deepEqual(await quantity(),[2,1]);assert.equal((await stmt(db,'SELECT count(*) n FROM stripe_events').first()).n,0);
});

test('abandoned and failed sessions release once; delayed payments remain reserved',async()=>{
 await initialize();const expired=await orderFor(),s=sessionFor(expired,{status:'expired',payment_status:'unpaid'});
 await applySessionEvent(db,event('checkout.session.expired'),s);await applySessionEvent(db,event('checkout.session.expired'),s);assert.deepEqual(await quantity(),[3,0]);
 await rejectsCode(applySessionEvent(db,event(),sessionFor(expired)),'paid_after_release_requires_review');
 const delayed=await orderFor();await applySessionEvent(db,event(),sessionFor(delayed,{payment_status:'unpaid'}));assert.deepEqual(await quantity(),[2,1]);assert.equal((await getOrder(db,delayed.id)).status,'pending');
 await applySessionEvent(db,event('checkout.session.async_payment_failed'),sessionFor(delayed,{payment_status:'unpaid'}));assert.deepEqual(await quantity(),[3,0]);
});

test('an uncertain Stripe response holds stock; retry uses the same order and provider key',async()=>{
 const inv=await initialize(),input={requestKey:key(),items:[{variantId:inv.variants[0].id,quantity:1}]};let firstId;
 const client={createSession:async order=>{firstId=order.id;throw Error('network response lost');}};
 await assert.rejects(startTestCheckout(db,input,client,'https://preview.test'));assert.deepEqual(await quantity(),[2,1]);
 client.createSession=async order=>{assert.equal(order.id,firstId);return sessionFor(order,{status:'open',payment_status:'unpaid'});};
 const retry=await startTestCheckout(db,input,client,'https://preview.test');assert.equal(retry.orderId,firstId);assert.deepEqual(await quantity(),[2,1]);
 let options;const api=new StripeTestClient(env,async(url,opts)=>{options=opts;return Response.json(sessionFor(await getOrder(db,firstId)));});
 await api.createSession(await getOrder(db,firstId),'https://preview.test');assert.equal(options.headers['Idempotency-Key'],'sayless-checkout-'+firstId);assert.equal(new URLSearchParams(options.body).get('shipping_options[0][shipping_rate_data][fixed_amount][amount]'),'850');
});

test('a database response lost after commit does not reserve a second time',async()=>{
 const inv=await initialize(),input={requestKey:key(),items:[{variantId:inv.variants[0].id,quantity:1}]};
 const flaky={prepare:db.prepare.bind(db),batch:async commands=>{await db.batch(commands);throw Error('response lost');}};
 const order=await reserve(flaky,input);assert.equal((await reserve(db,input)).id,order.id);assert.deepEqual(await quantity(),[2,1]);
});

test('a network-failed webhook remains retryable and only records the verified provider result',async()=>{
 await initialize();const order=await orderFor(),e={...event(),data:{object:{id:sessionFor(order).id}}},raw=JSON.stringify(e);
 await assert.rejects(handleStripeWebhook(db,raw,sign(raw),env,()=>({retrieveSession:async()=>{throw Error('offline');}})));
 assert.equal((await stmt(db,'SELECT count(*) n FROM stripe_events').first()).n,0);assert.deepEqual(await quantity(),[2,1]);
 await handleStripeWebhook(db,raw,sign(raw),env,()=>({retrieveSession:async()=>sessionFor(order)}));assert.deepEqual(await quantity(),[2,0]);
});

test('cancelling checks provider state again to handle a concurrent payment',async()=>{
 await initialize();const order=await orderFor();await attachSession(db,order.id,sessionFor(order));let gets=0;
 const client={retrieveSession:async()=>sessionFor(order,++gets===1?{status:'open',payment_status:'unpaid'}:{}),expireSession:async()=>{throw Error('payment completed concurrently');}};
 await reconcileOrder(db,order.id,client,true);assert.equal((await getOrder(db,order.id)).status,'paid');assert.deepEqual(await quantity(),[2,0]);
});

test('refunds do not restock; a checked return is explicit, bounded and idempotent',async()=>{
 await initialize();const order=await orderFor(2),s=sessionFor(order);await applySessionEvent(db,event(),s);
 const charge={id:'ch_test',livemode:false,payment_intent:s.payment_intent,amount_refunded:7500,currency:'eur'};const e=event('charge.refunded');
 await Promise.all([recordRefund(db,e,charge),recordRefund(db,e,charge)]);await recordRefund(db,event('charge.refunded'),{...charge,amount_refunded:500});
 assert.equal((await getOrder(db,order.id)).refund_cents,7500);assert.deepEqual(await quantity(),[1,0]);
 const data={orderId:order.id,variantId:order.items[0].variant_id,quantity:1,reason:'Vêtement reçu et revendable',requestKey:key()};
 await Promise.all([restockReturn(db,data,'owner'),restockReturn(db,data,'owner')]);assert.deepEqual(await quantity(),[2,0]);
 await rejectsCode(restockReturn(db,{...data,quantity:2,requestKey:key()},'owner'),'return_quantity_exceeded');assert.deepEqual(await quantity(),[2,0]);
});

test('admin adjustments preserve holds and use compare-and-swap against concurrent edits',async()=>{
 await initialize();await orderFor();let v=(await getInventory(db,'test')).variants[0];
 await rejectsCode(adjustStock(db,{variantId:v.id,physicalQuantity:0,expectedRevision:v.revision,reason:'Recomptage',requestKey:key()},'owner'),'quantity_below_reservations');
 const input={variantId:v.id,physicalQuantity:4,expectedRevision:v.revision,reason:'Recomptage vérifié',requestKey:key()};
 await adjustStock(db,input,'owner');await adjustStock(db,input,'owner');assert.deepEqual(await quantity(),[3,1]);
 await rejectsCode(adjustStock(db,{...input,physicalQuantity:2,requestKey:key()},'owner'),'stock_changed_refresh_required');assert.deepEqual(await quantity(),[3,1]);
});

test('admin access is server-authorized, claim is owner-only, and cross-site writes are rejected',async()=>{
 const config={DB:db,ADMIN_BOOTSTRAP_EMAIL:'owner@example.test'};
 const request=(path,{user,email,body,origin='https://preview.test'}={})=>new Request('https://preview.test/api/admin/'+path,{method:body?'POST':'GET',headers:{...(user?{'oai-authenticated-user-id':user}:{}),...(email?{'oai-authenticated-user-email':email}:{}),...(body?{Origin:origin,'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 assert.equal((await handleRequest(request('inventory'),config)).status,403);
 assert.equal((await handleRequest(request('claim',{user:'intruder',email:'other@example.test',body:{}}),config)).status,403);
 assert.equal((await handleRequest(request('claim',{user:'owner',email:'owner@example.test',body:{},origin:'https://evil.test'}),config)).status,403);
 assert.equal((await handleRequest(request('claim',{user:'owner',email:'owner@example.test',body:{}}),config)).status,200);
 assert.equal((await handleRequest(request('inventory',{user:'owner',email:'changed@example.test'}),config)).status,200);
 assert.equal((await handleRequest(request('inventory',{user:'intruder',email:'owner@example.test'}),config)).status,403);
 assert.equal((await handleRequest(request('test-checkout',{user:'owner',body:{}}),config)).status,503);assert.equal((await stmt(db,'SELECT count(*) n FROM orders').first()).n,0);
});

test('live payments and unverified quantities fail closed',async()=>{
 assert.equal(stripeReady({...env,STRIPE_TEST_SECRET_KEY:'sk_live_forbidden'}),false);
 assert.throws(()=>new StripeTestClient({...env,STRIPE_TEST_SECRET_KEY:'sk_live_forbidden'}),e=>e.code==='stripe_test_not_configured');
 const live=await handleRequest(new Request('https://preview.test/api/checkout',{method:'POST'}),{DB:db,...env});assert.equal(live.status,403);
 const response=await handleRequest(new Request('https://preview.test/api/inventory'),{});assert.equal(response.status,503);assert.equal((await response.json()).total,undefined);assert.match(response.headers.get('Cache-Control'),/no-store/);
});
