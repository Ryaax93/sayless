/* Shared storefront boundary. Contract proposed in docs/API-CONTRACT.md; no backend here. */
(function(root){
 'use strict';
 const MAX_AGE_MS=30000;
 class ApiError extends Error {constructor(code,status=0){super(code);this.name='ApiError';this.code=code;this.status=status;}}
 const unknown=()=>({status:'unavailable',total:null,variants:[],updatedAt:null,checkoutEnabled:false});
 function normalizeStock(data,skus,now=Date.now()){
  if(!data||data.verified!==true||!Array.isArray(data.variants)||!Array.isArray(skus)||!skus.length)return unknown();
  if(data.mode==='paused'||data.drop_status==='unavailable'||!['available','held','sold_out'].includes(data.drop_status))return unknown();
  const updatedAt=Date.parse(data.updated_at),age=now-updatedAt;
  if(!Number.isFinite(updatedAt)||age>MAX_AGE_MS||age< -5000)return unknown();
  const variants=[];
  for(const sku of skus){
   const matches=data.variants.filter(v=>v?.sku===sku);
   if(matches.length!==1)return unknown();
   const v=matches[0];
   if(!Number.isSafeInteger(v.available)||v.available<0||!['available','held','sold_out','unavailable'].includes(v.state))return unknown();
   if((v.state==='available')!==(v.available>0))return unknown();
   variants.push({sku,available:v.available,state:v.state});
  }
  const total=variants.reduce((n,v)=>n+v.available,0);
  if(!Number.isSafeInteger(total))return unknown();
  const status=variants.some(v=>v.state==='unavailable')?'unavailable':total>0?'available':variants.some(v=>v.state==='held')?'held':variants.every(v=>v.state==='sold_out')&&data.drop_status==='sold_out'?'sold_out':'unavailable';
  if(status==='unavailable')return unknown();
  return {status,total,variants,updatedAt,checkoutEnabled:data.checkout_enabled===true};
 }
 function createClient({fetchImpl=globalThis.fetch,checkoutEnabled=false,timeoutMs=5000}={}){
  async function request(path,{method='GET',body,headers={}}={}){
   const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeoutMs);
   try{
    const response=await fetchImpl(path,{method,cache:'no-store',credentials:'same-origin',signal:ctrl.signal,headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();
    if(!response.ok)throw new ApiError(typeof data?.error==='string'?data.error:'service_unavailable',response.status);
    if(!data||typeof data!=='object')throw new ApiError('invalid_response');
    return data;
   }catch(e){if(e instanceof ApiError)throw e;throw new ApiError('service_unavailable',503);}finally{clearTimeout(timer);}
  }
  async function checkout(input,{stock,quote,idempotencyKey}={}){
   if(!checkoutEnabled)throw new ApiError('payments_disabled',403);
   if(!stock?.checkoutEnabled||stock.status!=='available'||!Number.isFinite(stock.updatedAt)||Date.now()-stock.updatedAt>MAX_AGE_MS)throw new ApiError('stock_unavailable',503);
   if(!quote?.id||quote.currency!=='EUR'||!Number.isSafeInteger(quote.total_cents)||quote.total_cents<0||!(Date.parse(quote.expires_at)>Date.now()))throw new ApiError('quote_required',409);
   if(!Array.isArray(input?.items)||!input.items.length||!['relay','home'].includes(input.shipping)||typeof idempotencyKey!=='string'||idempotencyKey.length<16)throw new ApiError('invalid_request',400);
   if(input.shipping==='relay'&&!input.relay_id)throw new ApiError('relay_required',422);
   if(typeof input.turnstile!=='string'||!input.turnstile.trim())throw new ApiError('challenge_required',403);
   const seen=new Set();
   const items=input.items.map(item=>{const v=stock.variants.find(v=>v.sku===item.sku);if(seen.has(item.sku)||!Number.isSafeInteger(item.quantity)||item.quantity<1||!v||v.state!=='available'||v.available<item.quantity)throw new ApiError('stock_unavailable',409);seen.add(item.sku);return {sku:item.sku,quantity:item.quantity};});
   // Never send browser prices or totals. The server must reload prices, validate the quote,
   // revalidate the relay, atomically reserve stock, and bind customer data itself.
   const data=await request('/api/checkout',{method:'POST',headers:{'Idempotency-Key':idempotencyKey},body:{items,shipping:input.shipping,relay_id:input.shipping==='relay'?input.relay_id:null,quote_id:quote.id,customer_token:input.customer_token,terms_version:input.terms_version,turnstile:input.turnstile}});
   let url;try{url=new URL(data.url);}catch{throw new ApiError('invalid_checkout_url');}
   if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com'||url.username||url.password||url.port)throw new ApiError('invalid_checkout_url');
   return {...data,url:url.href};
  }
  return Object.freeze({
   catalog:()=>request('/api/catalog'),
   stock:(productId)=>request('/api/stock?product_id='+encodeURIComponent(productId)),
   quote:input=>request('/api/quote',{method:'POST',body:input}),
   relayPoints:({postcode,country})=>request('/api/relay-points?'+new URLSearchParams({postcode,country})),
   order:token=>request('/api/order',{headers:{Authorization:'Bearer '+token}}),
   // Email goes in the body, never in a URL, history, cache key or referrer.
   lookupOrder:({reference,email})=>request('/api/order/lookup',{method:'POST',body:{reference,email}}),
   request:input=>request('/api/requests',{method:'POST',body:input}),
   checkout
  });
 }
 const api=Object.freeze({ApiError,normalizeStock,createClient,MAX_AGE_MS});
 if(typeof module==='object'&&module.exports)module.exports=api;
 else{root.SaylessAPIContract=api;root.SaylessAPI=createClient();}
})(typeof window==='undefined'?globalThis:window);
