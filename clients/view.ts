import type { ClientId } from './server.ts';

const content = {
  books: {
    name: 'The Reading Room',
    monogram: 'rr',
    eyebrow: 'A small bookshop. A thoughtful choice.',
    title: 'Some gifts say<br>“I know you.”',
    description:
      'Find a book with a little more meaning. A private connection to TASTEKEEPER helps us choose from our sample shelf, while Mira’s references stay with her.',
    promise: 'A choice with a reason.',
    number: 'No. 01',
    detail: 'BOOKS & GOOD INTENTIONS',
    art: `<div class="hero-art book-still-life" aria-hidden="true"><div class="book-shadow"></div><div class="display-book book-back"><span>THE READING ROOM</span><b>A LITTLE<br>WONDER</b><i>Collected curiosities</i></div><div class="display-book book-front"><span>THE READING ROOM</span><b>A WORLD<br>BETWEEN<br>PAGES</b><div class="cover-flower"><svg viewBox="0 0 100 100"><path d="M50 87V44M50 62C25 61 20 43 30 38C41 31 50 47 50 62M50 72C73 72 86 55 75 48C66 43 53 54 50 72"/><circle cx="50" cy="25" r="13"/><circle cx="35" cy="35" r="13"/><circle cx="65" cy="35" r="13"/><circle cx="50" cy="45" r="13"/><circle class="flower-center" cx="50" cy="35" r="10"/></svg></div><i>A thoughtful beginning</i></div><span class="art-annotation">Open up a new possibility.</span></div>`,
  },
  media: {
    name: 'Tonight',
    monogram: 't.',
    eyebrow: 'Fewer options. A better evening.',
    title: 'Your evening.<br>Opening scene.',
    description:
      'One film to settle into, with two possibilities if the mood changes. Let your permitted taste space guide a choice from this sample film collection.',
    promise: 'The credits can wait.',
    number: '02 / 03',
    detail: 'A FILM FOR THE MOMENT',
    art: `<div class="hero-art cinema-still" aria-hidden="true"><svg viewBox="0 0 560 440"><defs><linearGradient id="screen" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#2c4a53"/><stop offset=".56" stop-color="#9f8160"/><stop offset="1" stop-color="#eea67d"/></linearGradient></defs><rect class="cinema-frame" x="28" y="38" width="504" height="328" rx="2"/><rect x="42" y="52" width="476" height="300" fill="url(#screen)"/><circle cx="393" cy="128" r="49" fill="#f5dda5"/><path d="M42 270Q150 163 267 260T518 255V352H42" fill="#233d46"/><path d="M42 307Q195 238 311 294T518 287V352H42" fill="#12252d"/><path d="M282 267L300 352H244L261 267Z" fill="#dcbd8c"/><path d="M275 251V278M271 250Q273 240 279 250" stroke="#101c24" stroke-width="5" fill="none"/><path d="M56 385H501" stroke="#5d6471"/><text x="56" y="410" fill="#b3b9c0" font-size="12" letter-spacing="4">AN EVENING, WELL CHOSEN.</text><text x="476" y="410" fill="#e5edb4" font-size="12">▶</text></svg><span class="film-stamp">TASTE /<br>THEN PLAY.</span></div>`,
  },
  places: {
    name: 'A Good Afternoon',
    monogram: 'a.',
    eyebrow: 'London, at your own pace.',
    title: 'A little plan.<br>A lovely day.',
    description:
      'A garden, a gallery, a good place to begin. Find somewhere that fits the afternoon you have in mind, using a permissioned connection to your taste space.',
    promise: 'Leave a little room to wander.',
    number: '51.5072° N',
    detail: 'LONDON, WITH POSSIBILITY',
    art: `<div class="hero-art afternoon-map" aria-hidden="true"><svg viewBox="0 0 560 440"><rect x="25" y="26" width="510" height="384" rx="180" fill="#dfe6d3"/><path d="M28 322Q136 173 237 267T535 195" stroke="#a9cad0" stroke-width="59" fill="none"/><path d="M68 80L479 358M145 45L398 395M60 208L492 118M65 350L500 244" stroke="#f9f8ef" stroke-width="18" fill="none"/><path d="M116 169Q185 183 228 135T375 163Q422 194 402 248" stroke="#a26e36" stroke-width="3" stroke-dasharray="5 7" fill="none"/><rect x="99" y="99" width="64" height="68" rx="8" fill="#afc197"/><rect x="350" y="290" width="73" height="63" rx="13" fill="#afc197"/><g transform="translate(226 110)"><circle r="32" fill="#f8f4e6"/><path d="M-14-6Q0-29 14-6Q17 6 0 25Q-17 6-14-6Z" fill="#8c582b"/><circle cy="-5" r="6" fill="#f8f4e6"/></g><g transform="translate(402 249)"><circle r="24" fill="#365442"/><path d="M-9 0H9M0-9V9" stroke="#f8f4e6" stroke-width="2"/></g><path d="M448 62V107M434 77L448 62L462 77" stroke="#365442" stroke-width="2" fill="none"/><text x="445" y="52" font-size="12" fill="#365442">N</text></svg><span class="map-label">NOWHERE TO RUSH.</span></div>`,
  },
};

function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
}

export function renderPage(clientId: ClientId, ownerOrigin: string) {
  const page = content[clientId];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="${clientId === 'media' ? 'dark' : 'light'}"><meta name="description" content="${escape(page.name)} — an independent TASTEKEEPER reference application with controlled access to taste."><title>${escape(page.name)} · TASTEKEEPER</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' rx='8' fill='%232b4436'/%3E%3Ctext x='20' y='28' text-anchor='middle' font-size='26' fill='%23f6f3e9'%3Et%3C/text%3E%3C/svg%3E"><link rel="preload" href="/fonts/source-serif-4.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/geist.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/styles.css"><script src="/client.js" defer></script></head>
<body data-client="${clientId}" data-owner-origin="${escape(ownerOrigin)}">
<a class="skip-link" href="#client-workspace">Skip to your choice</a>
<div class="site-wrap">
<header class="site-header"><a class="brand" href="/"><span class="brand-mark" aria-hidden="true">${page.monogram}</span><span>${page.name}</span></a><div class="header-right"><span class="reference-label">A TASTEKEEPER reference app</span><button class="text-button connection-button" id="connection-details" type="button">Your connection <span aria-hidden="true">↗</span></button><details class="site-menu"><summary aria-label="Open navigation menu"><span aria-hidden="true">☰</span></summary><nav aria-label="Client navigation"><a href="${escape(ownerOrigin)}/home">Return to TASTEKEEPER <span aria-hidden="true">↗</span></a><button type="button" id="about-client">How this works</button><button type="button" id="retry-connection">Retry connection</button></nav></details></div></header>
<main><section class="hero" aria-labelledby="hero-title"><div class="hero-copy"><p class="eyebrow"><span class="small-line" aria-hidden="true"></span>${page.eyebrow}</p><h1 id="hero-title">${page.title}</h1><p class="hero-description">${page.description}</p><p class="hero-signoff">${page.promise}</p></div>${page.art}</section>
<div class="chapter-line"><span>${page.detail}</span><span>${page.number}</span></div>
<section class="demo-notice" aria-label="Demonstration disclosure"><span class="notice-icon" aria-hidden="true">i</span><p><strong>Isolated role-play demo.</strong> Mira is the example recipient; the invited giver chooses on her behalf. Claiming an invitation does not verify a real identity. Recommendations and budgets in sample mode are authored examples.</p></section>
<div id="client-workspace" tabindex="-1"><section class="connection-loading" aria-live="polite"><span class="loading-dot" aria-hidden="true"></span><p>Opening your connection…</p></section></div>
<noscript><section class="message-panel"><h2>JavaScript connects this reference app.</h2><p>Enable JavaScript to claim an invitation and make a choice. Invitation tokens stay out of page addresses after the client opens.</p><a class="button primary" href="${escape(ownerOrigin)}/connections?client=${clientId}">Open TASTEKEEPER</a></section></noscript>
</main>
<footer class="site-footer"><div><a class="footer-owner" href="${escape(ownerOrigin)}/home"><span class="owner-symbol" aria-hidden="true">✳</span> Made possible by TASTEKEEPER <span aria-hidden="true">↗</span></a><p>Your references stay in your taste space. Suggestions may still reveal something about taste.</p></div><span class="footer-note">No purchase, booking, stock, or streaming availability is verified.</span></footer>
</div>
<dialog id="evidence-dialog" class="evidence-dialog" aria-labelledby="drawer-title"><div class="drawer-header"><span class="drawer-kicker">BEHIND THIS CHOICE</span><button class="icon-button close-drawer" type="button" aria-label="Close details">×</button></div><div id="drawer-content"></div></dialog>
<div id="toast" class="toast" role="status" hidden></div>
</body></html>`;
}
