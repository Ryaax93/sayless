(function (root) {
  'use strict';
  const product = Object.freeze({name:'Zip Hoodie Pink 001',price:75,priceCents:7500,sizes:Object.freeze(['S','M','L'])});
  const shipping = Object.freeze({
    relay:Object.freeze({label:'Point relais',priceCents:490,available:false}),
    home:Object.freeze({label:'Colissimo à domicile',priceCents:850,available:true})
  });
  function totals(items, method = null) {
    const quantity = items.reduce((sum,item)=>sum+item.quantity,0);
    const shippingCents = Object.hasOwn(shipping,method) ? shipping[method].priceCents : null;
    const subtotalCents = quantity*product.priceCents;
    return {quantity,subtotalCents,shippingCents,totalCents:shippingCents===null?null:subtotalCents+shippingCents};
  }
  function validDetails(details) {
    return Boolean(details && ['name','email','address','postcode','city','country'].every(key=>typeof details[key]==='string' && details[key].trim()) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email));
  }
  function canConfirmDemo(items, details, method) {
    return items.length>0 && validDetails(details) && method==='home';
  }
  const api=Object.freeze({product,shipping,totals,validDetails,canConfirmDemo});
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.SaylessCommerce=api;
})(typeof window==='undefined'?globalThis:window);
