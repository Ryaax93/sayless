'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const main = $('#main');
const CART_KEY = 'sayless-preview-cart-v1';
const PRODUCT = SaylessCommerce.product;
const CART_TTL = 30 * 24 * 60 * 60 * 1000;
const GALLERY = [
  {src: '/store/assets/hoodie-front.webp', alt: 'Le zip hoodie rose SAYLESS vu de face, avec sa broderie sur la poitrine'},
  {src: '/store/assets/hoodie-back.webp', alt: 'Le zip hoodie rose SAYLESS de dos, avec son grand motif imprimé'},
  {src: '/store/assets/campaign.webp', alt: 'Deux personnes portant le hoodie rose SAYLESS dans la rue'}
];
const money = value => new Intl.NumberFormat('fr-FR', {style: 'currency', currency: 'EUR', maximumFractionDigits: 2}).format(value);
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let selectedSize = null;
const selectedColor = 'Rose';
let galleryIndex = 0;
let cart = readCart();
let toastTimer;
let productObserver;
let previousDialogFocus = null;

function normalizeCart(value) {
  if(!Array.isArray(value))return [];
  const grouped=new Map();
  for(const item of value){
    if(!item||!PRODUCT.sizes.includes(item.size)||!Number.isInteger(item.quantity)||item.quantity<1)continue;
    if(item.color&&item.color!=='Rose')continue;
    const color='Rose';
    const key=color+'|'+item.size;
    grouped.set(key,{size:item.size,color,variantId:typeof item.variantId==='string'?item.variantId:null,quantity:1});
  }
  return [...grouped.values()].slice(0,1);
}
function readCart() {
  try {
    const stored = JSON.parse(localStorage.getItem(CART_KEY) || 'null');
    if (!stored) return [];
    if (Array.isArray(stored)) {
      const items=normalizeCart(stored);
      if(items.length) localStorage.setItem(CART_KEY,JSON.stringify({items,expiresAt:Date.now()+CART_TTL}));
      else localStorage.removeItem(CART_KEY);
      return items;
    }
    if(!Number.isFinite(stored.expiresAt) || stored.expiresAt<=Date.now()) {
      localStorage.removeItem(CART_KEY); return [];
    }
    return normalizeCart(stored.items);
  } catch { return []; }
}
function saveCart() {
  try {
    if(cart.length) localStorage.setItem(CART_KEY,JSON.stringify({items:cart,expiresAt:Date.now()+CART_TTL}));
    else localStorage.removeItem(CART_KEY);
  } catch { /* Le panier reste utilisable en mémoire. */ }
  updateCartCount();
}
const cartCount = () => cart.reduce((sum, item) => sum + item.quantity, 0);
const subtotal = () => cartCount() * PRODUCT.price;
function updateCartCount() {
  const count = cartCount();
  $$('[data-cart-count]').forEach(el => { el.textContent = count; });
  $$('.bag-button[data-open-cart]').forEach(el => el.setAttribute('aria-label', `Ouvrir le panier, ${count} article${count > 1 ? 's' : ''}`));
}
function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3400);
}

const bagIcon = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M15 23h34l3 34H12l3-34ZM23 25V17a9 9 0 0 1 18 0v8"/></svg>';
const lockIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="1"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg>';
const careLinks = [
  ['aide','Questions fréquentes'], ['tailles','Guide des tailles'], ['livraison','Livraison'],
  ['retours','Retours & rétractation'], ['contact','Nous contacter'],
  ['suivi','Suivi de commande'], ['confidentialite','Confidentialité'], ['cookies','Cookies'], ['mentions-legales','Mentions légales'], ['cgv','Conditions générales de vente']
];
const faqData = [
  ['Comment taille le Pink 001 ?', 'Le gilet rose est unisexe, pour femmes et hommes, avec une coupe oversize en S, M et L. Pour les personnes de petite taille, nous recommandons le S. Consulte le <a href="#/tailles">guide des tailles</a> pour comparer les mesures à un vêtement que tu portes déjà.'],
  ['Y aura-t-il un restock ?', 'Le premier drop a été produit en 30 exemplaires, sans réassort prévu. La disponibilité est indiquée sur la fiche produit. Les pièces en cours de paiement sont distinguées des ruptures définitives.'],
  ['La livraison est-elle comprise ?', 'Le hoodie est à 75 € TTC, hors livraison. Les tarifs prévus sont de 4,90 € en point relais et 8,50 € par Colissimo à domicile. Choisis ta livraison sur SAYLESS et vérifie le récapitulatif. Tes coordonnées seront demandées sur Stripe. France métropolitaine hors Corse ; tarifs sous réserve de validation du transporteur.'],
  ['Comment se passe la commande ?', 'Une pièce par commande pour le DROP 01. Choisis ta taille, puis la livraison et un point relais si nécessaire. Vérifie le total TTC et les conditions de vente avant de continuer sur Stripe. Les paiements restent désactivés sur cet aperçu de préparation.'],
  ['Comment faire un retour ?', 'La page <a href="#/retours">Retours & rétractation</a> explique les étapes prévues pour la boutique et permet de préparer un message. Pour une commande déjà passée, contacte directement <a href="mailto:SayLe2s@outlook.com">SayLe2s@outlook.com</a> avec sa référence.'],
  ['Comment prendre soin de mon hoodie ?', 'Suis en priorité l’étiquette d’entretien du vêtement. Pour préserver la broderie et le motif, évite de repasser directement sur les décorations. Les consignes complètes seront ajoutées après vérification de l’étiquette.']
];
function faqMarkup(entries = faqData) {
  return '<div class="faq-list">' + entries.map(([q,a]) => `<details><summary>${q}</summary><div class="answer">${a}</div></details>`).join('') + '</div>';
}
function supportCallout() {
  return '<div class="support-callout"><h3>Une question en tête ?</h3><p>Pour la coupe, une taille ou ta commande, écris-nous.</p><a class="text-link" href="#/contact">Contacter SAYLESS</a></div>';
}
function pageTitle(eyebrow, title, description = '') {
  return `<div class="page-title"><span class="eyebrow">${eyebrow}</span><h1>${title}</h1>${description ? `<p>${description}</p>` : ''}</div>`;
}
function helpLayout(route, title, description, content) {
  return pageTitle('SAYLESS · À TES CÔTÉS', title, description) + `<div class="help-layout"><nav class="help-sidebar" aria-label="Aide et informations">${careLinks.map(([slug,label])=>`<a class="${route===slug?'active':''}" href="#/${slug}" ${route===slug?'aria-current="page"':''}>${label}</a>`).join('')}</nav><div class="help-content">${content}</div></div>`;
}
function legalLayout(route,title,description,content) {
  return `<article class="legal-page"><a class="legal-back" href="#/aide">Aide & informations</a><header><h1>${title}</h1><p>${description}</p></header><div class="legal-content help-content">${content}</div></article>`;
}
function soldOutNotice() {
  return '<section class="drop-complete" data-drop-sold-out hidden aria-live="polite"><span class="eyebrow">SAYLESS · PREMIER CHAPITRE</span><h2>DROP 01 — SOLD OUT.</h2><p>Merci à tous ceux qui ont participé au premier chapitre de SAYLESS. Ce n’est que le début.</p><p>Restez connectés sur Instagram : <a href="https://www.instagram.com/sayless.brand/" target="_blank" rel="noopener noreferrer">@sayless.brand</a></p><strong>SAY LESS. DO MORE.</strong></section>';
}
function pausedNotice() {
  return '<section class="drop-complete drop-paused" data-drop-paused hidden aria-live="polite"><h2>DROP 01 — TEMPORARILY UNAVAILABLE.</h2><p>La boutique est momentanément indisponible. Retrouvez-nous prochainement sur saylessbrand.fr.</p><p>Instagram : <a href="https://www.instagram.com/sayless.brand/" target="_blank" rel="noopener noreferrer">@sayless.brand</a></p><strong>SAY LESS. DO MORE.</strong></section>';
}
function home() {
  return `<section class="hero" aria-labelledby="hero-title">
    <div class="hero-copy"><span class="eyebrow">STREETWEAR INDÉPENDANT · PARIS</span><h1 id="hero-title"><span>SAY LESS.</span><span class="pink">DO MORE.</span></h1><p class="hero-description">Un zip oversize unisexe. Un rose signature.<br>Le premier chapitre de SAYLESS.</p><div class="hero-action"><a class="button button-light" href="#/produit">Découvrir le hoodie</a><div class="hero-price">75 €<span>TTC · hors livraison</span></div></div><div class="hero-specs"><span>350 GSM</span><span>COUPE OVERSIZE</span><span>S · M · L</span></div></div>
    <div class="hero-image"><img src="/store/assets/campaign.webp" width="813" height="1000" alt="Deux personnes portent le zip hoodie rose SAYLESS en ville" fetchpriority="high"><div class="hero-photo-caption"><span class="eyebrow">LE ROSE SORT<br>DU CADRE.</span><strong>PINK 001</strong></div></div>
  </section>
  <section class="marquee" aria-label="Disponibilité du premier drop SAYLESS"><span class="sr-only" data-stock-accessible role="status">Stock à confirmer</span><div class="marquee-window"><div class="marquee-track">${[0,1].map(()=>`<div class="marquee-group" aria-hidden="true"><span class="marquee-stock" data-stock-ticker>STOCK À CONFIRMER</span><img src="/store/assets/logo.webp" width="112" height="56" alt=""><span>SAY LESS. DO MORE.</span><img src="/store/assets/logo.webp" width="112" height="56" alt=""><span>DROP 01 · SAYLESS PARIS</span><img src="/store/assets/logo.webp" width="112" height="56" alt=""></div>`).join('')}</div></div><button type="button" class="marquee-control" data-marquee-toggle aria-label="Mettre le défilement en pause" aria-pressed="false">Pause</button></section>
  ${soldOutNotice()}${pausedNotice()}<section class="section product-feature" aria-labelledby="feature-title"><figure class="feature-image"><img src="/store/assets/hoodie-front.webp" width="804" height="1000" alt="Détail du zip et de la broderie poitrine du hoodie rose" loading="lazy"><figcaption class="photo-label"><span>LE ZIP. LE ROSE. LE DÉTAIL.</span><span>SAYLESS · PARIS</span></figcaption></figure><div class="feature-copy"><span class="eyebrow">UNE PIÈCE. TOUTE L’ATTITUDE.</span><h2 id="feature-title">TON PROCHAIN<br><span>ESSENTIEL.</span></h2><p>Une coupe ample, une matière de 350 g/m² et le logo brodé côté cœur. Devant, le détail. Dans le dos, le motif qui fait la différence.</p><div class="feature-details"><div><strong>350 GSM</strong><span>Une matière avec de la tenue</span></div><div><strong>OVERSIZE</strong><span>De l’aisance, à ta façon</span></div></div><div class="feature-price"><a class="button" href="#/produit">Voir le Pink 001</a><span>75 €<small>TTC · hors livraison</small></span></div></div></section>
  <section class="section dark-section" aria-labelledby="lookbook-home"><div class="section-head"><div><span class="eyebrow">LE LOOKBOOK</span><h2 id="lookbook-home">LA RUE LUI VA BIEN.</h2></div><a class="text-link" href="#/lookbook">Explorer le lookbook</a></div><div class="lookbook-grid"><figure><a href="#/lookbook"><img src="/store/assets/campaign.webp" width="813" height="1000" alt="Le hoodie rose porté à deux" loading="lazy"></a><figcaption>DEHORS. ENSEMBLE.</figcaption></figure><figure><a href="#/lookbook"><img src="/store/assets/hoodie-back.webp" width="811" height="999" alt="Le motif du hoodie vu de dos" loading="lazy"></a><figcaption class="center-caption">LE DOS NE FAIT PAS SEMBLANT.</figcaption></figure><figure><a href="#/lookbook"><img src="/store/assets/hoodie-front.webp" width="804" height="1000" alt="La broderie poitrine du Pink 001" loading="lazy"></a><figcaption>LES DÉTAILS COMPTENT.</figcaption></figure></div></section>
  <section class="manifesto" aria-labelledby="manifesto-title"><div><span class="eyebrow">LE DÉBUT DE QUELQUE CHOSE.</span><h2 id="manifesto-title">FAIS À<br>TA FAÇON.</h2></div><div class="manifesto-copy"><p>SAYLESS, c’est une marque indépendante à Paris. Pour ce premier drop, on commence avec un hoodie rose, une coupe oversize et 30 pièces produites. Une idée qui se porte enfin.</p><a href="#/histoire" class="text-link">L’histoire de SAYLESS</a></div></section>
  <section class="section faq-section" aria-labelledby="faq-home-title"><div class="faq-heading"><span class="eyebrow">AVANT DE TE LANCER</span><h2 id="faq-home-title">ON TE DIT TOUT.</h2><p>La coupe, les tailles, la livraison.<br>Les réponses, au même endroit.</p><a class="text-link" href="#/aide">Toutes les questions</a></div>${faqMarkup(faqData.slice(0,3))}</section>`;
}
function productPage() {
  return `<div class="product-page"><nav class="breadcrumb" aria-label="Fil d’Ariane"><a href="#/">Accueil</a><span>/</span><span>Drop 01</span><span>/</span><span>Pink 001</span></nav><div class="product-layout"><div class="product-gallery"><div class="gallery-main"><button class="image-button" data-zoom-current aria-label="Agrandir la photo du hoodie"><img id="product-image" src="${GALLERY[galleryIndex].src}" width="804" height="1000" alt="${GALLERY[galleryIndex].alt}" fetchpriority="high"></button><span class="zoom-hint">Agrandir +</span></div><div class="gallery-thumbs" aria-label="Choisir une photo">${GALLERY.map((photo,i)=>`<button data-gallery="${i}" aria-pressed="${i===galleryIndex}" aria-label="${['Voir le hoodie de face','Voir le hoodie de dos','Voir le hoodie porté'][i]}"><img src="${photo.src}" width="80" height="100" alt=""></button>`).join('')}</div></div>
    <div class="product-info"><span class="eyebrow">SAYLESS · PREMIER DROP</span><h1>ZIP HOODIE<span>PINK 001.</span></h1><div class="price-row"><strong>75 € TTC</strong><span>hors livraison</span></div><div class="stock-panel" id="product-stock" aria-live="polite"><p data-stock-count>Vérification du stock…</p><p data-stock-note></p></div>${soldOutNotice()}${pausedNotice()}<p class="product-intro">Un gilet rose unisexe, pour femmes et hommes. Une coupe oversize, une broderie côté cœur et un motif au dos qui se remarque.</p><div class="color-row"><span class="color-swatch" aria-hidden="true"></span><span class="label">Rose signature · Unisexe</span></div><div id="size-selector"><div class="size-label"><span class="label">Ta taille${selectedSize ? ' : '+selectedSize : ''}</span><button class="text-link" data-size-guide>Guide des tailles</button></div><div class="size-options" role="group" aria-label="Choisir une taille">${PRODUCT.sizes.map(size=>`<button class="size-option" data-size="${size}" aria-pressed="${selectedSize===size}">${size}</button>`).join('')}</div><p id="size-error" class="size-error" role="status"></p></div><button class="button add-button" id="add-to-cart"><span>Ajouter au panier</span><span>75 €</span></button><div class="product-service">${lockIcon}<span>Aperçu interactif · Aucun paiement réel</span></div>
    ${faqMarkup([
      ['Les détails du hoodie','Zip hoodie unisexe rose pastel, coupe oversize. Matière de 350 g/m² : 80 % coton et 20 % polyester. Fermeture YKK, capuche doublée, logo brodé côté cœur et grand motif imprimé au dos.'],
      ['Bien choisir sa taille','Un modèle unisexe en S, M et L. Pour les personnes de petite taille, nous recommandons le S. Le <a href="#/tailles">guide des tailles</a> reprend les mesures du site actuel ; leur méthode de prise reste à vérifier avant la mise en vente.'],
      ['Livraison & retours','Le hoodie coûte 75 € TTC, hors livraison : 4,90 € en point relais ou 8,50 € par Colissimo à domicile. France métropolitaine hors Corse pour le moment. Le choix d’un relais dépend de la connexion au transporteur. Les tarifs et délais restent à valider avec lui. Consulte les pages <a href="#/livraison">Livraison</a> et <a href="#/retours">Retours</a>.'],
      ['Prendre soin de ta pièce','Suis les indications de l’étiquette d’entretien. Évite de repasser directement sur la broderie et le motif imprimé.']
    ])}</div></div></div>
    <section class="section product-detail-section"><div><span class="eyebrow">DEVANT, LE DÉTAIL. DERRIÈRE, LE CARACTÈRE.</span><h2>VU DE DOS.<br>RECONNU PARTOUT.</h2><p>Un grand motif, des touches de rose et une silhouette ample. Le Pink 001 se porte zippé ou ouvert, avec les pièces que tu aimes déjà.</p><div class="inline-features"><div><strong>BRODERIE</strong><span>Le logo côté cœur</span></div><div><strong>MOTIF AU DOS</strong><span>La signature du premier drop</span></div></div></div><button class="image-button plain-image-button" data-zoom="1" aria-label="Agrandir le motif au dos"><img src="/store/assets/hoodie-back.webp" width="811" height="999" alt="Vue de dos du hoodie SAYLESS et de son motif" loading="lazy"></button></section>
    <section class="manifesto"><div><span class="eyebrow">PETITE SÉRIE. PREMIER CHAPITRE.</span><h2>30 PIÈCES.<br>PAS DE RESTOCK.</h2></div><div class="manifesto-copy"><p>30, c’est le nombre de hoodies produits pour ce premier drop. Une série limitée qui marque le début de SAYLESS.</p><a class="text-link" href="#/histoire">Découvrir la marque</a></div></section>
    <div class="mobile-product-bar" id="mobile-product-bar" hidden><div><strong>Pink 001 · 75 € TTC</strong><span>${selectedSize?'Taille '+selectedSize:'Choisis ta taille'}</span></div><button class="button" data-go-size>${selectedSize?'Ajouter au panier':'Choisir ma taille'}</button></div>`;
}
function lookbookPage() {
  return `<div class="lookbook-page">${pageTitle('SAYLESS · LOOKBOOK DU PREMIER DROP','PINK IN<br>THE CITY.','Un rose qui se repère. Une coupe qui se vit. Les visuels du premier chapitre.')}
  <div class="editorial-grid"><figure><button data-zoom="2" aria-label="Agrandir la photo du hoodie porté à deux"><img src="/store/assets/campaign.webp" width="813" height="1000" alt="Deux personnes portent le hoodie rose dans la rue"></button><figcaption>LE ROSE SE PORTE À PLUSIEURS.</figcaption></figure><figure><button data-zoom="1" aria-label="Agrandir la photo de dos"><img src="/store/assets/hoodie-back.webp" width="811" height="999" alt="Le motif du hoodie rose, de dos"></button><figcaption>TOUT EST DANS LE DOS.</figcaption></figure><figure><button data-zoom="0" aria-label="Agrandir la photo de face"><img src="/store/assets/hoodie-front.webp" width="804" height="1000" alt="Détail de la broderie et du zip" loading="lazy"></button><figcaption class="editorial-caption"><span class="eyebrow pink">PINK 001 · 350 GSM · OVERSIZE</span><h2>FAIT POUR<br>ÊTRE PORTÉ.</h2><p>Un logo brodé, un zip, une coupe ample. À toi d’écrire la suite.</p><a class="button button-light" href="#/produit">Découvrir le Pink 001</a></figcaption></figure></div></div>`;
}
function storyPage() {
  return pageTitle('INDÉPENDANT · PARIS','UNE IDÉE.<br>UN PREMIER DROP.','SAYLESS commence ici, avec une pièce et l’envie de la voir vivre.') + `<section class="story-layout"><img src="/store/assets/hoodie-back.webp" width="811" height="999" alt="Le motif du premier hoodie SAYLESS"><div class="story-copy"><span class="eyebrow">SAY LESS. DO MORE.</span><h2>MOINS DE MOTS.<br>PLUS DE TOI.</h2><p>Pour le premier chapitre de SAYLESS, on a choisi un zip hoodie rose. Une silhouette oversize, le logo brodé sur la poitrine et un grand motif dans le dos.</p><p>La marque est indépendante et basée à Paris. Ce drop a été produit en 30 pièces, sans réassort prévu.</p><p>Ce qui nous intéresse maintenant ? Voir cette pièce portée à ta façon, avec ton style et dans ton quotidien.</p><p class="signature">LE DÉBUT DE LA SUITE.</p><a class="button" href="#/produit">Découvrir le premier drop</a></div></section><section class="story-note"><div><span class="eyebrow">ON SE RETROUVE LÀ-BAS.</span><h2>TON STYLE.<br>NOTRE PREMIER CHAPITRE.</h2></div><a class="button button-outline" href="https://www.instagram.com/sayless.brand/" target="_blank" rel="noopener noreferrer">SAYLESS sur Instagram</a></section>`;
}
function sizeGuideContent(modal = false) {
  return `${modal?'<span class="eyebrow">PINK 001 · COUPE OVERSIZE</span><h2 id="size-title">TA TAILLE,<br>TON STYLE.</h2>':'<h2>Le tableau des mesures</h2>'}<p>Mesures en centimètres reprises du site SAYLESS actuel. Leur exactitude sur les pièces vendues reste à confirmer.</p><div class="table-scroll"><table class="size-table"><caption class="sr-only">Mesures du hoodie Pink 001 en centimètres</caption><thead><tr><th scope="col">Taille</th><th scope="col">Longueur</th><th scope="col">Poitrine</th><th scope="col">Épaules</th></tr></thead><tbody><tr><th scope="row">S</th><td>71</td><td>63</td><td>58</td></tr><tr><th scope="row">M</th><td>74</td><td>69</td><td>63</td></tr><tr><th scope="row">L</th><td>76</td><td>74</td><td>67</td></tr></tbody></table></div><div class="notice">Tableau provisoire : « poitrine » est le libellé d’origine et ne doit pas être interprété comme un tour de poitrine. La méthode de mesure et les valeurs doivent être confirmées sur ce modèle. Si tu hésites, <a href="#/contact">demande-nous conseil</a>.</div><div class="size-advice"><h3>Pour choisir ta coupe</h3><p><strong>Un seul modèle, unisexe : femme et homme.</strong> Pour les personnes de petite taille, nous recommandons le <strong>S</strong>. Le rendu reste oversize.</p><p>Prends un hoodie dont tu aimes le volume et pose-le à plat, sans l’étirer. Note sa longueur, sa largeur sous les aisselles et la distance entre les coutures d’épaules. Compare ensuite avec le tableau une fois sa méthode confirmée.</p><p>Les lettres S, M et L ne suffisent pas à garantir le rendu. Si tu hésites, demande conseil en précisant la coupe souhaitée et les mesures de ton vêtement de référence.</p></div>${modal?'':'<div class="size-illustration"><svg viewBox="0 0 140 130" aria-hidden="true"><path d="m48 18-22 12-20 45 23 11 13-27v60h56V59l13 27 23-11-20-45-22-12c-4 17-40 17-44 0ZM70 30v89M43 58h54"/><path d="M50 8h40M105 36v76" stroke-dasharray="3 3"/></svg><span>Le schéma est indicatif. Compare la coupe à un hoodie que tu portes déjà, une fois la méthode de mesure confirmée.</span></div>'+supportCallout()}`;
}
function contactForm(isReturn = false) { return window.SaylessService.form(isReturn ? 'return' : 'contact'); }

function infoPage(route) {
  const legal=legalContent(route);
  if(legal) return legalLayout(route,legal.title,legal.description,legal.content);
  const map={
    aide:['LES RÉPONSES,<br>SANS DÉTOUR.','Avant de choisir ta pièce, on répond aux questions qui comptent.',faqMarkup()+supportCallout()],
    tailles:['LA BONNE<br>TAILLE POUR TOI.','Pink 001 est un gilet rose unisexe à la coupe oversize, proposé en S, M et L.',sizeGuideContent()],
    contact:['ON SE<br>PARLE ?','Une question sur le hoodie, une taille ou ta commande ? Écris-nous.',`<div class="contact-card"><span>LE CONTACT SAYLESS</span><a href="mailto:SayLe2s@outlook.com">SayLe2s@outlook.com</a></div><h2>Ton message</h2>${contactForm()}`]
  };
  if(!map[route]) return null;
  return helpLayout(route,...map[route]);
}
function currentRoute() {
  if(location.hash)return location.hash.replace(/^#\/?/,'').split('?')[0].replace(/\/$/,'')||'accueil';
  return ({'/merci':'confirmation','/commande-annulee':'commande-annulee','/suivi':'suivi'})[location.pathname.replace(/\/$/,'')]||'accueil';
}
function render() {
  delete main.dataset.paymentStatus;
  window.SaylessCheckoutUI.unmount();
  window.SaylessService.unmount();
  window.SaylessService.capture();
  closeMenu();
  closeDialogs(false);
  if (productObserver) productObserver.disconnect();
  const route = currentRoute();
  document.body.classList.toggle('legal-view',['mentions-legales','cgv','confidentialite','cookies','livraison','retours'].includes(route));
  const pages = {accueil:home,produit:productPage,lookbook:lookbookPage,histoire:storyPage,paiement:checkoutPage,confirmation:confirmationPage,'commande-annulee':cancellationPage,suivi:trackingPage};
  const html = pages[route] ? pages[route]() : infoPage(route);
  main.innerHTML = html || `<section class="not-found"><span class="eyebrow">SAYLESS</span><h1>ON S’EST<br>ÉGARÉS.</h1><p>Cette page n’existe pas. Le premier drop, lui, est juste ici.</p><a class="button" href="#/">Retour à l’accueil</a></section>`;
  const titles = {accueil:'Say less. Do more.',produit:'Zip Hoodie Pink 001',lookbook:'Le lookbook',histoire:'Notre histoire',paiement:'Livraison et récapitulatif',confirmation:'Confirmation de commande',suivi:'Suivi de commande','commande-annulee':'Retour du paiement',aide:'Questions fréquentes',tailles:'Guide des tailles',livraison:'Livraison',retours:'Retours & rétractation',contact:'Contact',confidentialite:'Confidentialité',cookies:'Cookies','mentions-legales':'Mentions légales',cgv:'Conditions de vente'};
  document.title = `SAYLESS — ${titles[route] || 'Page introuvable'}`;
  $$('.desktop-nav a').forEach(link=>{ if(link.getAttribute('href')==='#/'+route)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current'); });
  document.body.classList.toggle('has-product-bar',route==='produit');
  window.scrollTo({top:0,behavior:'instant'});
  main.focus({preventScroll:true});
  if(route==='produit') setupProductBar();
  window.SaylessInventory.enter();
  if(route==='paiement')window.SaylessCheckoutUI.mount();
  if(route==='cgv')mountTermsDocument();
  if(route==='confirmation')window.SaylessCheckoutUI.checkStatus();
  if(route==='suivi')window.SaylessService.readTracking();
  updateCartCount();
}
function setupProductBar() {
  const bar = $('#mobile-product-bar');
  const button = $('#add-to-cart');
  if(!bar || !button) return;
  productObserver = new IntersectionObserver(([entry])=>{
    bar.hidden = entry.isIntersecting || entry.boundingClientRect.top > window.innerHeight;
  },{threshold:.1});
  productObserver.observe(button);
}
function closeMenu() {
  $('#mobile-menu').hidden = true;
  document.body.classList.remove('menu-open');
  $('#menu-toggle').setAttribute('aria-expanded','false');
  $('#menu-toggle').setAttribute('aria-label','Ouvrir le menu');
}
function openDialog(dialog) {
  previousDialogFocus = document.activeElement;
  if(!dialog.open) dialog.showModal();
  document.body.classList.add('modal-open');
}
function closeDialogs(restore = true) {
  $$('dialog[open]').forEach(dialog=>dialog.close());
  document.body.classList.remove('modal-open');
  if(restore && previousDialogFocus?.isConnected) previousDialogFocus.focus({preventScroll:true});
}
function renderCart() {
  if(!cart.length) {
    $('#cart-content').innerHTML = `<div class="empty-cart">${bagIcon}<h3>IL ATTEND<br>TON PREMIER CHOIX.</h3><p>Le Pink 001 te fait de l’œil ?</p><a href="#/produit" class="button" data-close-cart-link>Découvrir le hoodie</a></div>`;
    return;
  }
  $('#cart-content').innerHTML = cart.map(item=>`<div class="cart-item"><img src="/store/assets/hoodie-front.webp" width="88" height="120" alt="Zip Hoodie Pink 001"><div><div class="item-head"><span>Zip Hoodie Pink 001</span><span>${money(PRODUCT.price*item.quantity)}</span></div><p class="item-size">${escapeHTML(item.color||'Rose')} · Taille ${item.size}</p><div class="quantity-row"><div class="quantity-control"><button data-quantity="-1" data-item-key="${escapeHTML((item.color||'Rose')+'|'+item.size)}" aria-label="Diminuer la quantité en taille ${item.size}">−</button><span aria-label="Quantité">${item.quantity}</span><button data-quantity="1" data-item-key="${escapeHTML((item.color||'Rose')+'|'+item.size)}" aria-label="Augmenter la quantité en taille ${item.size}" disabled>+</button></div><button class="remove-item" data-remove="${escapeHTML((item.color||'Rose')+'|'+item.size)}" aria-label="Retirer le hoodie en taille ${item.size}">Retirer</button></div></div></div>`).join('') + `<div class="cart-summary"><p class="small-text" data-purchase-stock role="status"></p><div class="summary-row total"><strong>Sous-total TTC</strong><strong>${money(subtotal())}</strong></div><div class="summary-row"><span>Livraison</span><span>À choisir maintenant</span></div><a href="#/paiement" class="button" data-close-cart-link>Choisir ma livraison</a><p class="small-text">Une pièce maximum · Paiement désactivé dans cet aperçu</p><button class="text-link cart-continue" data-close-dialog>Continuer à découvrir</button><p class="cart-note">75 € TTC par gilet, hors livraison. Point relais : 4,90 € ; Colissimo domicile : 8,50 €. Tarifs sous réserve de validation du transporteur. Ton panier reste mémorisé 30 jours après sa dernière modification.</p></div>`;
}
function openCart() { closeMenu(); renderCart(); openDialog($('#cart-dialog')); window.SaylessInventory.enter(); }
function addToCart() {
  if(!selectedSize) {
    $('#size-error').textContent = 'Choisis ta taille pour ajouter le hoodie.';
    $('#size-selector').scrollIntoView({behavior:'instant',block:'center'});
    $('.size-option')?.focus({preventScroll:true});
    return;
  }
  if(window.SaylessCheckoutUI.flow.state.attempt){toast('Une tentative est déjà en cours. Reprends-la depuis le récapitulatif.');location.hash='#/paiement';return;}
  if(cart.length){toast('Une pièce maximum par commande. Retire la sélection actuelle pour choisir une autre taille.');openCart();return;}
  if(!window.SaylessInventory.canAdd(selectedSize,selectedColor,1)){toast('Cette taille n’est plus disponible ou le stock doit être revérifié.');window.SaylessInventory.refresh();return;}
  cart=[{size:selectedSize,color:selectedColor,variantId:window.SaylessInventory.variantId(selectedSize,selectedColor),quantity:1}];
  saveCart();window.SaylessCheckoutUI.cartChanged();openCart();
}
function changeGallery(index) {
  if(!GALLERY[index]) return;
  galleryIndex = index;
  const img = $('#product-image');
  if(img) { img.src = GALLERY[index].src; img.alt=GALLERY[index].alt; }
  $$('[data-gallery]').forEach(button=>button.setAttribute('aria-pressed',Number(button.dataset.gallery)===index));
}
function zoomPhoto(index) {
  if(!GALLERY[index]) return;
  $('#zoom-image').src = GALLERY[index].src;
  $('#zoom-image').alt = GALLERY[index].alt;
  openDialog($('#image-dialog'));
}
function prepareEmail(form) {
  const values = new FormData(form);
  const isReturn = form.dataset.kind==='return';
  const name = String(values.get('name')||'').trim();
  const order = String(values.get('order')||'').trim();
  const message = String(values.get('message')||'').trim();
  const subject = isReturn ? 'SAYLESS — Demande de retour / rétractation' : 'SAYLESS — '+String(values.get('subject')||'Question');
  const body = ['Bonjour SAYLESS,','',message,'',order?'Référence de commande : '+order:'',name?'Nom : '+name:''].filter((line,index,lines)=>line || (index>0 && lines[index-1])).join('\n');
  const result = form.querySelector('[data-form-result]');
  result.hidden=false;
  result.innerHTML = `<strong>Ton message est prêt, mais pas encore envoyé.</strong><p class="small-text">Relis-le ci-dessous, puis ouvre ta messagerie. Tu pourras l’envoyer toi-même à SAYLESS.</p><textarea readonly aria-label="Message préparé">${escapeHTML(body)}</textarea><a class="button" href="mailto:SayLe2s@outlook.com?subject=${encodeURIComponent(subject)}&amp;body=${encodeURIComponent(body)}">Ouvrir ma messagerie</a><p class="small-text" style="margin:15px 0 0">Si ta messagerie ne s’ouvre pas, copie le texte et envoie-le à SayLe2s@outlook.com.</p>`;
  result.focus({preventScroll:true});
  result.scrollIntoView({behavior:'smooth',block:'center'});
}

function withdrawalMessage(form) {
  const data=new FormData(form);
  const value=key=>String(data.get(key)||'').trim();
  const readableDate=key=>value(key)?value(key).split('-').reverse().join('/'):'Non précisée';
  const body=[
    'À l’attention de SAYLESS — contact : SayLe2s@outlook.com',
    '',
    'Je vous informe de ma décision de me rétracter du contrat portant sur les vêtements ci-dessous.',
    'Référence de commande : '+(value('order') || 'Non précisée'),
    'Vêtements concernés : '+value('products'),
    'Date de commande : '+readableDate('ordered'),
    'Date de réception : '+readableDate('received'),
    '',
    'Nom et prénom : '+value('name'),
    'Adresse du client : '+value('address'),
    '',
    'Date de la déclaration : '+new Intl.DateTimeFormat('fr-FR').format(new Date()),
    'Signature : uniquement si ce formulaire est envoyé sur papier.'
  ].join('\n');
  return body;
}
function prepareWithdrawal(form) {
  const body=withdrawalMessage(form);
  const result=form.querySelector('[data-form-result]');
  result.hidden=false;
  result.innerHTML=`<strong>Déclaration préparée, pas encore envoyée.</strong><p>Relis le texte puis envoie-le depuis ta messagerie. Ce site n’enregistre pas ta demande et n’émet pas d’accusé de réception.</p><textarea readonly aria-label="Déclaration préparée">${escapeHTML(body)}</textarea><a class="button" href="mailto:SayLe2s@outlook.com?subject=${encodeURIComponent('SAYLESS — Rétractation')}&amp;body=${encodeURIComponent(body)}">Ouvrir ma messagerie</a><p class="small-text">Tu peux aussi copier ce texte et l’envoyer à SayLe2s@outlook.com. Conserve une preuve de ton envoi.</p>`;
  result.focus({preventScroll:true});
  result.scrollIntoView({behavior:'smooth',block:'center'});
}

document.addEventListener('click', event=>{
  const target = event.target.closest('button,a');
  if(!target) return;
  if(target.hasAttribute('data-marquee-toggle')) {const paused=target.getAttribute('aria-pressed')!=='true';target.setAttribute('aria-pressed',String(paused));target.setAttribute('aria-label',paused?'Reprendre le défilement':'Mettre le défilement en pause');target.textContent=paused?'Reprendre':'Pause';$('.marquee-track').style.animationPlayState=paused?'paused':'running';return;}
  if(target.classList.contains('skip')) { event.preventDefault(); main.focus(); main.scrollIntoView(); return; }
  if(target.id==='menu-toggle') {
    const open = $('#mobile-menu').hidden;
    $('#mobile-menu').hidden=!open;
    $('#mobile-menu').style.top=$('.site-header').getBoundingClientRect().bottom+'px';
    document.body.classList.toggle('menu-open',open);
    target.setAttribute('aria-expanded',String(open));
    target.setAttribute('aria-label',open?'Fermer le menu':'Ouvrir le menu');
    return;
  }
  if(target.hasAttribute('data-open-cart')) return openCart();
  if(target.hasAttribute('data-close-dialog') || target.hasAttribute('data-close-cart-link')) closeDialogs();
  if(target.hasAttribute('data-size-guide')) { $('#size-content').innerHTML=sizeGuideContent(true); return openDialog($('#size-dialog')); }
  if(target.dataset.size) {
    selectedSize=target.dataset.size;
    $$('[data-size]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.size===selectedSize));
    $('.size-label>.label').textContent='Ta taille : '+selectedSize;
    $('#size-error').textContent='';
    const bar=$('#mobile-product-bar');
    if(bar) { $('span',bar).textContent='Taille '+selectedSize; $('button',bar).textContent='Ajouter au panier'; }
    return;
  }
  if(target.id==='add-to-cart') return addToCart();
  if(target.hasAttribute('data-go-size')) {
    if(selectedSize) return addToCart();
    $('#size-selector').scrollIntoView({behavior:'instant',block:'center'});
    $('.size-option').focus({preventScroll:true});return;
  }
  if(target.dataset.gallery!==undefined) return changeGallery(Number(target.dataset.gallery));
  if(target.hasAttribute('data-zoom-current')) return zoomPhoto(galleryIndex);
  if(target.dataset.zoom!==undefined) return zoomPhoto(Number(target.dataset.zoom));
  if(target.dataset.quantity) {
    if(window.SaylessCheckoutUI.flow.state.attempt){toast('Reprends d’abord ta tentative en cours.');return;}
    const itemKey=target.dataset.itemKey;const delta=Number(target.dataset.quantity);
    if(delta>0){toast('Une pièce maximum par commande pour le DROP 01.');return;}
    const current=cart.find(item=>(item.color+'|'+item.size)===itemKey);
    if(delta>0&&current&&!window.SaylessInventory.canAdd(current.size,current.color,current.quantity+delta)){toast('Le stock doit être revérifié ou cette quantité n’est plus disponible.');window.SaylessInventory.refresh();return;}
    cart=cart.map(item=>(item.color+'|'+item.size)===itemKey?{...item,quantity:Math.max(0,Math.min(1,item.quantity+delta))}:item).filter(item=>item.quantity>0);
    saveCart();renderCart();
    window.SaylessCheckoutUI.cartChanged();
    const replacement=$$('[data-quantity]').find(el=>el.dataset.itemKey===itemKey&&Number(el.dataset.quantity)===delta);
    if(replacement&&!replacement.disabled)replacement.focus({preventScroll:true});
    else $('#cart-dialog [data-close-dialog]').focus({preventScroll:true});
    return;
  }
  if(target.dataset.remove) {
    if(window.SaylessCheckoutUI.flow.state.attempt){toast('Reprends d’abord ta tentative en cours.');return;}
    cart=cart.filter(item=>(item.color+'|'+item.size)!==target.dataset.remove);saveCart();renderCart();
    window.SaylessCheckoutUI.cartChanged();
    $('#cart-dialog [data-close-dialog]').focus({preventScroll:true});return;
  }
  if(target.hasAttribute('data-clear-data')) {
    cart=[];saveCart();window.SaylessCheckoutUI.cartChanged();toast('Le panier local a été effacé. Une éventuelle réservation reste gérée par le serveur.');return;
  }
  if(target.tagName==='A' && target.getAttribute('href')?.startsWith('#/')) {
    closeMenu();closeDialogs(false);
    if(target.getAttribute('href')===location.hash)window.scrollTo({top:0,behavior:'smooth'});
  }
});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu();});
$$('dialog').forEach(dialog=>{
  dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeDialogs();}});
  dialog.addEventListener('close',()=>{if(!document.querySelector('dialog[open]'))document.body.classList.remove('modal-open');});
});
let touchStart=null;
document.addEventListener('touchstart',event=>{if(event.target.closest('.gallery-main'))touchStart=event.changedTouches[0].clientX;},{passive:true});
document.addEventListener('touchend',event=>{if(touchStart!==null){const delta=event.changedTouches[0].clientX-touchStart;if(Math.abs(delta)>60)changeGallery((galleryIndex+(delta<0?1:GALLERY.length-1))%GALLERY.length);touchStart=null;}},{passive:true});
window.addEventListener('storage',event=>{if(event.key===CART_KEY){cart=readCart();updateCartCount();if($('#cart-dialog').open)renderCart();window.SaylessCheckoutUI.cartChanged();}});
window.addEventListener('hashchange',render);
window.matchMedia('(min-width: 761px)').addEventListener('change', event=>{if(event.matches)closeMenu();});
window.SaylessCheckoutUI.captureReturn();
render();
