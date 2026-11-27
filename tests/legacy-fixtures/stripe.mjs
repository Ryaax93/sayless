import {AppError,nowSeconds,stmt,reserve,getOrder,attachSession,applySessionEvent,recordRefund} from './inventory.mjs';
export async function verifyStripeSignature(raw,header,secret,clock=nowSeconds()){
 if(!secret||typeof raw!=='string'||raw.length>262144||typeof header!=='string')throw new AppError('invalid_signature',400);
 const parts=header.split(',').map(p=>p.trim().split('='));const ts=parts.filter(p=>p[0]==='t');const signatures=parts.filter(p=>p[0]==='v1'&&/^[a-f0-9]{64}$/.test(p[1]));
 if(ts.length!==1||!/^\d+$/.test(ts[0][1])||!signatures.length||Math.abs(clock-Number(ts[0][1]))>300)throw new AppError('invalid_signature',400);
 const enc=new TextEncoder();const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 let valid=false;for(const [,hex] of signatures){const bytes=Uint8Array.from(hex.match(/../g),v=>parseInt(v,16));valid=(await crypto.subtle.verify('HMAC',key,bytes,enc.encode(ts[0][1]+'.'+raw)))||valid;}
 if(!valid)throw new AppError('invalid_signature',400);
 let event;try{event=JSON.parse(raw);}catch{throw new AppError('invalid_event',400);}
 if(!/^evt_[a-zA-Z0-9_]+$/.test(event.id||'')||event.livemode!==false)throw new AppError('live_or_invalid_event',400);
 return event;
}
export function stripeReady(env){return env.STRIPE_TEST_ENABLED==='true'&&/^sk_test_/.test(env.STRIPE_TEST_SECRET_KEY||'')&&/^whsec_/.test(env.STRIPE_TEST_WEBHOOK_SECRET||'');}
export class StripeTestClient {
 constructor(env,transport=fetch){if(!stripeReady(env))throw new AppError('stripe_test_not_configured',503);this.secret=env.STRIPE_TEST_SECRET_KEY;this.transport=transport;}
 async request(path,{method='GET',body=null,idempotencyKey=null}={}){
  const headers={Authorization:'Bearer '+this.secret};if(body)headers['Content-Type']='application/x-www-form-urlencoded';if(idempotencyKey)headers['Idempotency-Key']=idempotencyKey;
  let response;try{response=await this.transport('https://api.stripe.com/v1/'+path,{method,headers,body:body?.toString(),signal:AbortSignal.timeout(10000)});}catch{throw new AppError('stripe_network_retry_same_key',503);}
  if(!response.ok)throw new AppError('stripe_request_unconfirmed',503);
  const data=await response.json();if(data.livemode===true)throw new AppError('live_payments_forbidden',403);return data;
 }
 retrieveSession(id){if(!/^cs_test_[a-zA-Z0-9]+$/.test(id))throw new AppError('invalid_session');return this.request('checkout/sessions/'+id+'?expand%5B%5D=line_items.data.price.product');}
 retrieveCharge(id){if(!/^ch_[a-zA-Z0-9]+$/.test(id))throw new AppError('invalid_charge');return this.request('charges/'+id);}
 async createSession(order,origin){
  const body=new URLSearchParams({mode:'payment',client_reference_id:order.id,'metadata[sayless_order_id]':order.id,'payment_intent_data[metadata][sayless_order_id]':order.id,
   success_url:origin+'/#/gestion',cancel_url:origin+'/#/gestion',expires_at:String(order.expires_at),
   'shipping_options[0][shipping_rate_data][type]':'fixed_amount','shipping_options[0][shipping_rate_data][fixed_amount][amount]':String(order.shipping_cents),'shipping_options[0][shipping_rate_data][fixed_amount][currency]':'eur','shipping_options[0][shipping_rate_data][display_name]':'Colissimo domicile — essai'});
  order.items.forEach((item,i)=>{const prefix=`line_items[${i}]`;body.set(prefix+'[quantity]',String(item.quantity));body.set(prefix+'[price_data][currency]','eur');body.set(prefix+'[price_data][unit_amount]','7500');body.set(prefix+'[price_data][product_data][name]',`SAYLESS — TEST — ${item.color} / ${item.size}`);body.set(prefix+'[price_data][product_data][metadata][sayless_variant_id]',item.variant_id);});
  return this.request('checkout/sessions',{method:'POST',body,idempotencyKey:'sayless-checkout-'+order.id});
 }
 expireSession(id){if(!/^cs_test_[a-zA-Z0-9]+$/.test(id))throw new AppError('invalid_session');return this.request('checkout/sessions/'+id+'/expire',{method:'POST',body:new URLSearchParams(),idempotencyKey:'sayless-expire-'+id});}
}
export async function startTestCheckout(db,input,client,origin){
 const order=await reserve(db,{...input,scope:'test'});
 if(!['reserved','pending'].includes(order.status))throw new AppError('order_not_open',409);
 if(order.created_at<nowSeconds()-23*3600&&!order.session_id)throw new AppError('uncertain_session_requires_review',409);
 const session=order.session_id?await client.retrieveSession(order.session_id):await client.createSession(order,origin);
 if(session.livemode!==false||!/^https:\/\/checkout\.stripe\.com\//.test(session.url||'')||session.client_reference_id!==order.id||session.amount_total!==order.amount_cents)throw new AppError('invalid_checkout_session',409);
 await attachSession(db,order.id,session);return {orderId:order.id,url:session.url,expiresAt:order.expires_at,mode:'test'};
}
export async function handleStripeWebhook(db,raw,signature,env,clientFactory=e=>new StripeTestClient(e)){
 if(!stripeReady(env))throw new AppError('stripe_test_not_configured',503);
 const event=await verifyStripeSignature(raw,signature,env.STRIPE_TEST_WEBHOOK_SECRET);
 if(await stmt(db,'SELECT id FROM stripe_events WHERE id=?',event.id).first())return {duplicate:true};
 const allowed=['checkout.session.completed','checkout.session.expired','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed'];
 if(allowed.includes(event.type)){const session=await clientFactory(env).retrieveSession(event.data?.object?.id);return applySessionEvent(db,event,session);}
 if(event.type==='charge.refunded'){const charge=await clientFactory(env).retrieveCharge(event.data?.object?.id);return recordRefund(db,event,charge);}
 return {ignored:true};
}
export async function reconcileOrder(db,id,client,cancel=false){
 const order=await getOrder(db,id);if(!order||order.scope!=='test')throw new AppError('unknown_order',404);
 if(!['reserved','pending'].includes(order.status))return {status:order.status};
 if(!order.session_id)throw new AppError('uncertain_session_retry_checkout_first',409);
 let session=await client.retrieveSession(order.session_id);
 if(cancel&&session.status==='open'){
  try{await client.expireSession(session.id);}catch{/* A payment can complete concurrently. Always retrieve again. */}
  session=await client.retrieveSession(session.id);
 }
 if(session.status==='open')return {status:order.status,held:true};
 const event={id:`reconcile_${session.id}_${session.status}_${session.payment_status}`,type:'server.reconciliation',livemode:false};
 return applySessionEvent(db,event,session);
}
