'use strict';
window.SaylessInventory=(()=>{
 let snapshot=null,lastChecked=0,pending=null;
 const skus=['ZH-PINK-S','ZH-PINK-M','ZH-PINK-L'];
 const hasStockView=()=>document.querySelector('#product-stock,[data-stock-ticker]');
 function current(){return snapshot&&Date.now()-lastChecked<30000&&Date.now()-snapshot.updatedAt<30000?snapshot:null;}
 function paint(){
  const state=current();
  const available=state?.status==='available';
  const soldOut=state?.status==='sold_out';
  const held=state?.status==='held';
  const text=available?state.total+' gilet'+(state.total>1?'s':'')+' disponible'+(state.total>1?'s':''):soldOut?'DROP 01 — SOLD OUT.':held?'Pièces réservées temporairement':'Stock à confirmer';
  const note=available?'Disponibilité vérifiée. Les pièces réservées sont déjà déduites.':soldOut?'Le stock du drop est épuisé, confirmation du système de gestion.':held?'Des paiements sont en cours. La disponibilité sera actualisée.':'La disponibilité ne peut pas être vérifiée. Aucun paiement n’est possible.';
  document.querySelectorAll('[data-stock-ticker]').forEach(el=>{const value=text.toLocaleUpperCase('fr-FR');if(el.textContent!==value)el.textContent=value;el.title=note;});
  document.querySelectorAll('[data-stock-accessible]').forEach(el=>{const value=text+'. '+note;if(el.textContent!==value)el.textContent=value;});
  document.querySelectorAll('[data-drop-sold-out]').forEach(el=>{el.hidden=!soldOut;});
  const box=document.querySelector('#product-stock');if(!box)return;
  box.dataset.state=state?.status||'unavailable';
  box.querySelector('[data-stock-count]').textContent=text;
  box.querySelector('[data-stock-note]').textContent=note;
  document.querySelectorAll('[data-size]').forEach(button=>{
   const v=state?.variants.find(v=>v.sku==='ZH-PINK-'+button.dataset.size);
   button.disabled=!v||v.state!=='available';
   const label=v?.state==='sold_out'?'Épuisée':v?.state==='held'?'Réservée temporairement':button.disabled?'Disponibilité à confirmer':'Disponible';
   button.title=label;button.setAttribute('aria-label','Taille '+button.dataset.size+' — '+label);
   if(button.disabled&&selectedSize===button.dataset.size)selectedSize=null;
   button.setAttribute('aria-pressed',String(button.dataset.size===selectedSize));
  });
  const label=document.querySelector('.size-label>.label');if(label)label.textContent='Ta taille'+(selectedSize?' : '+selectedSize:'');
  const add=document.querySelector('#add-to-cart');if(add)add.disabled=!available;
 }
 async function refresh(){
  if(pending)return pending;
  pending=(async()=>{try{const data=await window.SaylessAPI.stock('pink-001');const normalized=window.SaylessAPIContract.normalizeStock(data,skus);snapshot=normalized.status==='unavailable'?null:normalized;lastChecked=Date.now();}catch{snapshot=null;lastChecked=0;}finally{pending=null;paint();}})();return pending;
 }
 function canAdd(size,color,quantity){const state=current();if(!state){refresh();return false;}const v=state.variants.find(v=>v.sku==='ZH-PINK-'+size);return color==='Rose'&&Number.isSafeInteger(quantity)&&quantity>0&&v?.state==='available'&&v.available>=quantity;}
 function variantId(size,color){return color==='Rose'?current()?.variants.find(v=>v.sku==='ZH-PINK-'+size)?.sku||null:null;}
 setInterval(()=>{if(hasStockView()&&!document.hidden){paint();refresh();}},20000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&hasStockView()){paint();refresh();}});
 window.addEventListener('offline',()=>{snapshot=null;lastChecked=0;paint();});
 window.addEventListener('online',()=>{if(hasStockView())refresh();});
 window.addEventListener('focus',()=>{if(hasStockView()){paint();refresh();}});
 return {refresh,paint,canAdd,variantId};
})();
