'use strict';

function checkoutTotals() { return SaylessCommerce.totals(cart,checkout.shipping); }
function cents(amount) { return money(amount/100); }
function refreshCheckout(focusSelector = null) {
  if(currentRoute()!=='paiement') return;
  main.innerHTML=checkoutPage();
  updateCartCount();
  if(focusSelector) {
    const focus=$(focusSelector);
    focus?.focus({preventScroll:true});
    focus?.scrollIntoView({behavior:'instant',block:'start'});
  }
}
function deliveryDetailsForm() {
  const values=checkout.details || {};
  const field=(key,label,extra='')=>`<div class="field"><label for="delivery-${key}">${label}</label><input id="delivery-${key}" name="${key}" value="${escapeHTML(values[key]||'')}" required maxlength="${key==='address'?180:120}" ${extra}></div>`;
  return `<form id="delivery-form"><h2 id="checkout-step-title" tabindex="-1">Tes coordonnées</h2><p class="small-text">Pour essayer le parcours, tu peux utiliser des coordonnées fictives. Elles restent dans cette page et ne sont pas transmises.</p><button type="button" class="text-link example-details" data-example-details>Utiliser des coordonnées d’exemple</button><div class="form-grid">${field('name','Nom et prénom','autocomplete="name"')}${field('email','Adresse e-mail','type="email" autocomplete="email"')}</div>${field('address','Adresse','autocomplete="street-address"')}<div class="form-grid">${field('postcode','Code postal','autocomplete="postal-code"')}${field('city','Ville','autocomplete="address-level2"')}</div>${field('country','Pays','autocomplete="country-name"')}<p class="small-text">Les destinations desservies seront confirmées avant les ventes. Cet essai ne vérifie pas l’éligibilité d’une adresse réelle.</p><button class="button" type="submit">Continuer vers la livraison</button><p class="small-text checkout-privacy">En savoir plus sur les <a href="#/confidentialite">données de cet aperçu</a>.</p></form>`;
}
function deliveryChoices() {
  const d=checkout.details;
  return `<div><h2 id="checkout-step-title" tabindex="-1">Choisis la livraison</h2><div class="delivery-address"><p><strong>${escapeHTML(d.name)}</strong><br>${escapeHTML(d.address)}<br>${escapeHTML(d.postcode)} ${escapeHTML(d.city)} · ${escapeHTML(d.country)}<br>${escapeHTML(d.email)}</p><button class="text-link" data-edit-details>Modifier mes coordonnées</button></div><fieldset class="shipping-options"><legend>Mode de livraison</legend><label class="shipping-option unavailable"><input type="radio" name="shipping" value="relay" disabled aria-describedby="relay-status"><span><strong>Point relais <span>${cents(SHIPPING.relay.priceCents)}</span></strong><small id="relay-status">Indisponible dans cet aperçu : le choix d’un point de retrait réel reste à raccorder.</small></span></label><label class="shipping-option ${checkout.shipping==='home'?'selected':''}"><input type="radio" name="shipping" value="home" ${checkout.shipping==='home'?'checked':''}><span><strong>Colissimo à domicile <span>${cents(SHIPPING.home.priceCents)}</span></strong><small>Essayer la livraison à l’adresse renseignée.</small></span></label></fieldset><p class="small-text">Tarifs d’essai fournis par SAYLESS. Les délais, zones et conditions des paniers multiples restent à confirmer avant l’ouverture.</p><div class="checkout-selection" aria-live="polite">${checkout.shipping==='home'?'Livraison à domicile sélectionnée. Le total est mis à jour.':'Choisis un mode de livraison pour afficher le total final.'}</div></div>`;
}
function checkoutPage() {
  if(!cart.length) return `<section class="checkout-page"><span class="eyebrow">LE RÉCAPITULATIF</span><h1>IL MANQUE<br>TA PIÈCE.</h1><p>Ton panier est vide. Découvre le Pink 001 pour essayer le parcours.</p><a class="button" style="margin-top:25px" href="#/produit">Voir le hoodie</a></section>`;
  const readyForShipping=SaylessCommerce.validDetails(checkout.details) && checkout.step==='shipping';
  const order=checkoutTotals();
  const canConfirm=readyForShipping && SaylessCommerce.canConfirmDemo(cart,checkout.details,checkout.shipping);
  return `<section class="checkout-page"><nav class="checkout-steps" aria-label="Étapes du parcours"><button type="button" data-open-cart>Panier</button><span aria-current="${!readyForShipping?'step':'false'}">Coordonnées</span><span aria-current="${readyForShipping?'step':'false'}">Livraison & total</span></nav><span class="eyebrow">TON CHOIX. TON STYLE.</span><h1>ON RÉCAPITULE.</h1><div class="notice">Parcours de démonstration : aucune commande, aucun paiement et aucune réservation de stock. Tu peux tester avec des coordonnées d’exemple.</div><div class="checkout-layout"><div class="checkout-block">${readyForShipping?deliveryChoices():deliveryDetailsForm()}</div><aside class="summary-card" aria-label="Résumé du panier"><h2>Ta sélection</h2>${orderLines(cart)}<button class="text-link" style="margin:20px 0" data-open-cart>Modifier mon panier</button><div class="summary-row"><span>Articles TTC</span><span>${cents(order.subtotalCents)}</span></div><div class="summary-row"><span>Livraison</span><span>${readyForShipping && order.shippingCents!==null?cents(order.shippingCents):'À choisir après les coordonnées'}</span></div><div class="summary-row total" id="checkout-total"><strong>${canConfirm?'Total TTC':'Sous-total TTC'}</strong><strong>${cents(canConfirm?order.totalCents:order.subtotalCents)}</strong></div><p class="small-text">${canConfirm?'Livraison à domicile comprise. Ce montant est affiché avant la confirmation démo.':'Hors livraison tant qu’aucun mode n’a été choisi.'}</p>${readyForShipping?`<button id="demo-confirm" class="button" ${canConfirm?'':'disabled'}>Simuler la confirmation</button><p class="small-text">Aucun débit, aucun envoi. Les ventes restent désactivées.</p>`:''}<p class="small-text">Cet essai ne réserve aucune pièce.</p><div class="checkout-policy-links"><a href="#/cgv">Conditions de vente</a><a href="#/retours">Rétractation</a></div></aside></div></section>`;
}
function confirmationPage() {
  if(!lastDemoOrder) return checkoutPage();
  const order=lastDemoOrder;
  return `<section class="success-layout"><div class="success-mark" aria-hidden="true">✓</div><span class="eyebrow">DÉMONSTRATION TERMINÉE</span><h1>ÇA TE VA<br>DÉJÀ BIEN.</h1><p>Ta taille et ton choix de livraison ont été repris dans ce récapitulatif.</p><div class="notice">Aucune commande n’a été passée, aucun paiement n’a été effectué et aucun e-mail n’a été envoyé. Les coordonnées d’essai ont été effacées.</div>${orderLines(order.items)}<div class="summary-row"><span>Articles TTC</span><span>${cents(order.totals.subtotalCents)}</span></div><div class="summary-row"><span>${SHIPPING[order.shipping].label}</span><span>${cents(order.totals.shippingCents)}</span></div><div class="summary-row total"><strong>Total TTC de démonstration</strong><strong>${cents(order.totals.totalCents)}</strong></div><a href="#/" class="button">Retour à la boutique</a></section>`;
}
