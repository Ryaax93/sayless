import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../public/store/inventory.js',import.meta.url),'utf8');
const clientSource=await readFile(new URL('../public/store/api-client.js',import.meta.url),'utf8');
function harness(product=false){
 const clock={now:Date.now()},tickers=[{textContent:''},{textContent:''}],accessible={textContent:''},count={textContent:''},note={textContent:''},sizeLabel={textContent:''},add={disabled:false},soldOut={hidden:true};
 const sizes=['S','M','L'].map(size=>({dataset:{size},setAttribute(name,value){this[name]=value;}}));
 const box={dataset:{},querySelector(selector){return selector==='[data-stock-count]'?count:note;}};
 let response={status:'unallocated',reportedTotal:26,variants:[]},failed=false;
 const window={addEventListener(){}};
 const document={hidden:false,addEventListener(){},querySelector(selector){if(selector==='#product-stock')return product?box:null;if(selector==='#add-to-cart')return add;if(selector==='.size-label>.label')return sizeLabel;return tickers[0];},querySelectorAll(selector){return selector==='[data-stock-ticker]'?tickers:selector==='[data-stock-accessible]'?[accessible]:selector==='[data-drop-sold-out]'?[soldOut]:product?sizes:[];}};
 const context=vm.createContext({window,document,Date:{now:()=>clock.now,parse:Date.parse},selectedSize:'L',URL,URLSearchParams,AbortController,setTimeout,clearTimeout,setInterval(){},fetch:async()=>{if(failed)throw Error('network unavailable');return {ok:true,json:async()=>response};}});
 vm.runInContext(clientSource,context);vm.runInContext(source,context);
 return {api:window.SaylessInventory,tickers,accessible,count,note,sizes,add,clock,soldOut,set(data){response=data;failed=false;},fail(){failed=true;}};
}
const verified=()=>({verified:true,updated_at:new Date().toISOString(),checkout_enabled:false,drop_status:'available',variants:[{sku:'ZH-PINK-S',available:12,state:'available'},{sku:'ZH-PINK-M',available:13,state:'available'},{sku:'ZH-PINK-L',available:0,state:'sold_out'}]});
test('a theoretical declaration is never presented as live available inventory',async()=>{const h=harness();await h.api.refresh();assert.deepEqual(h.tickers.map(e=>e.textContent),['STOCK À CONFIRMER','STOCK À CONFIRMER']);});
test('the ticker and product show one total, while a depleted size is blocked',async()=>{const h=harness(true);h.set(verified());await h.api.refresh();assert.equal(h.count.textContent,'25 gilets disponibles');assert.equal(h.tickers[0].textContent,'25 GILETS DISPONIBLES');assert.equal(h.sizes[2].disabled,true);assert.equal(h.api.canAdd('L','Rose',1),false);assert.equal(h.api.canAdd('S','Noir',1),false);assert.equal(h.api.canAdd('S','Rose',13),false);});
test('network failure and stale inventory remove the quantity and block the purchase path',async()=>{const h=harness(true);h.set(verified());await h.api.refresh();h.fail();await h.api.refresh();assert.equal(h.count.textContent,'Stock à confirmer');assert.equal(h.add.disabled,true);h.set(verified());await h.api.refresh();h.clock.now+=30001;h.api.paint();assert.equal(h.count.textContent,'Stock à confirmer');assert.equal(h.add.disabled,true);});
test('the sold-out presentation requires an explicit confirmed drop state',async()=>{const h=harness(true),s=verified();s.variants.forEach(v=>{v.available=0;v.state='held';});h.set(s);await h.api.refresh();assert.match(h.count.textContent,/réservées/);assert.equal(h.soldOut.hidden,true);s.variants.forEach(v=>v.state='sold_out');s.drop_status='sold_out';h.set(s);await h.api.refresh();assert.equal(h.soldOut.hidden,false);assert.equal(h.count.textContent,'DROP 01 — SOLD OUT.');});
