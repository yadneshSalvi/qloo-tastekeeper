// Invitation material is removed before any asynchronous work, rendering, or API call.
let openingFragment = window.location.hash;
if (openingFragment)
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
let invitationToken = new URLSearchParams(openingFragment.replace(/^#/, '')).get('token');
openingFragment = '';

const clientId = document.body.dataset.client;
const ownerOrigin = document.body.dataset.ownerOrigin;
const workspace = document.querySelector('#client-workspace');
const drawer = document.querySelector('#evidence-dialog');
const drawerContent = document.querySelector('#drawer-content');
const wording = {
  books: {
    noun: 'book',
    plural: 'books',
    heading: 'A thoughtful brief.',
    lead: 'A book for Mira.',
    submit: 'Find a thoughtful book',
    source: 'View book source',
    saved: 'Your small, thoughtful shortlist.',
  },
  media: {
    noun: 'film',
    plural: 'films',
    heading: 'Set the scene.',
    lead: 'Something for tonight.',
    submit: 'Find tonight’s film',
    source: 'Open title source',
    saved: 'Your watchlist, kept simple.',
  },
  places: {
    noun: 'place',
    plural: 'places',
    heading: 'Make room for a good afternoon.',
    lead: 'Somewhere to begin.',
    submit: 'Find a place to begin',
    source: 'Open directions',
    saved: 'A few places worth keeping.',
  },
}[clientId];
const state = {
  view: null,
  result: null,
  runId: null,
  mode: 'sample',
  waiting: false,
  working: false,
  stage: 'queued',
  issue: null,
  blocked: null,
  paused: false,
  generation: 0,
  lastMode: 'sample',
  constraints:
    clientId === 'books'
      ? { maxPrice: 4000, format: 'any' }
      : clientId === 'media'
        ? { maxMinutes: 150 }
        : { maxPrice: 3000, setting: 'any' },
};
const accessErrors = new Set([
  'GRANT_REVOKED',
  'GRANT_EXPIRED',
  'INVITATION_EXPIRED',
  'INVITATION_CLAIMED',
  'INVITATION_USED',
  'CREDENTIAL_EXPIRED',
  'TOKEN_EXPIRED',
  'CLIENT_DISABLED',
  'CLIENT_REVOKED',
  'SCOPE_DENIED',
  'ACCESS_DENIED',
  'REVISION_CHANGED',
  'GRANT_CHANGED',
  'GRANT_VERSION_MISMATCH',
  'AUTHORIZATION_CHANGED',
]);

class ServiceError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
const money = (value) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value % 100 === 0 ? 0 : 2,
  }).format(value / 100);
const dateTime = (value) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(value));
const safeUrl = (value) => {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '#';
  } catch {
    return '#';
  }
};
const sourceName = (value) => {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return 'Public source';
  }
};
const ownerLink = (path = '/home') => ownerOrigin + path;
const directionsUrl = (item, facts) =>
  'https://www.google.com/maps/search/?api=1&query=' +
  encodeURIComponent(facts?.identity || `${item.title}, ${item.creator}, London`);

async function api(path, payload) {
  let response;
  try {
    response = await fetch(path, {
      method: payload === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
  } catch {
    throw new ServiceError(
      'NETWORK_UNAVAILABLE',
      'This client could not connect. Your brief is still here; try again.',
    );
  }
  let value;
  try {
    value = await response.json();
  } catch {
    throw new ServiceError(
      'RESPONSE_UNAVAILABLE',
      'The connection returned an unreadable response. Try again.',
    );
  }
  if (!response.ok || value.error)
    throw new ServiceError(
      value.error?.code || 'REQUEST_FAILED',
      value.error?.message || 'This request could not be completed.',
      response.status,
    );
  return value;
}

function errorCopy(error) {
  if (error.code === 'GRANT_REVOKED')
    return {
      title: 'Mira has ended this connection.',
      body: 'Future requests through this connection are blocked. Mira can create a new invitation from TASTEKEEPER. Previously shared results cannot be recalled.',
    };
  if (
    ['GRANT_EXPIRED', 'INVITATION_EXPIRED', 'CREDENTIAL_EXPIRED', 'TOKEN_EXPIRED'].includes(
      error.code,
    )
  )
    return {
      title: 'This invitation has ended.',
      body: 'Its access window has closed. Return to TASTEKEEPER to review the connection or ask the example recipient to create a new invitation.',
    };
  if (['INVITATION_CLAIMED', 'INVITATION_USED'].includes(error.code))
    return {
      title: 'This invitation has already been used.',
      body: 'Invitations can be claimed once. Use the connected browser session, or create a new invitation in the isolated demo.',
    };
  if (
    [
      'REVISION_CHANGED',
      'GRANT_CHANGED',
      'GRANT_VERSION_MISMATCH',
      'AUTHORIZATION_CHANGED',
    ].includes(error.code)
  )
    return {
      title: 'Access changed before this choice was ready.',
      body: 'The earlier result has been set aside. Check the connection again before making another choice.',
    };
  if (error.code === 'SCOPE_DENIED')
    return {
      title: 'This choice is outside the connection.',
      body: 'This app cannot use the context for this request. Only its owner can review the permitted scope in TASTEKEEPER.',
    };
  if (error.code === 'NO_ELIGIBLE_OPTIONS')
    return {
      title: 'Nothing fits this brief just yet.',
      body: `No permitted ${wording.plural} in this sample catalog meet these constraints. Adjust the brief and try again; the app will keep the same approved catalog.`,
    };
  if (['UPSTREAM_UNAVAILABLE', 'QLOO_UNAVAILABLE', 'QLOO_NOT_CONFIGURED'].includes(error.code))
    return {
      title: 'Qloo live is unavailable.',
      body: 'No Qloo key is configured for this demo. Your brief is preserved. Try live again, or explicitly choose the authored sample mode.',
    };
  return {
    title: 'We couldn’t complete this choice.',
    body: error.message || 'Try the connection again. Your brief is still here.',
  };
}

function renderEmpty(error) {
  const noSession = !error || error.code === 'NO_SESSION';
  const copy = noSession
    ? {
        title: 'A good choice starts with permission.',
        body: 'Open a connection from TASTEKEEPER to try this independent reference app. Each app has its own identity, catalog, and session.',
      }
    : errorCopy(error);
  workspace.innerHTML = `<section class="message-panel welcome-panel"><div class="panel-index" aria-hidden="true">${clientId === 'books' ? '↗' : clientId === 'media' ? '▶' : '↗'}</div><div><p class="eyebrow">YOUR CONNECTION</p><h2>${esc(copy.title)}</h2><p>${esc(copy.body)}</p><div class="button-row"><a class="button primary" href="${esc(ownerLink('/connections?client=' + clientId))}">Connect in TASTEKEEPER <span aria-hidden="true">↗</span></a><button type="button" class="button secondary" data-action="reconnect">Retry connection</button></div>${noSession ? '<p class="fine-print">Try Mira’s isolated demo workspace, create an invitation, and open this app from its claim link.</p>' : `<p class="error-code">${esc(error.code)}</p>`}</div></section><section class="explanation-grid" aria-label="How the connection works"><article><span>01</span><h3>One permitted purpose.</h3><p>The owner chooses which taste space this app may use, and for how long.</p></article><article><span>02</span><h3>A real boundary.</h3><p>The gateway checks access before it releases a choice. This app never receives private references.</p></article><article><span>03</span><h3>Always your call.</h3><p>Keep a choice or open its public source. Sample budgets and availability are illustrative.</p></article></section>`;
  workspace.setAttribute('aria-busy', 'false');
}

function formFields() {
  if (clientId === 'books')
    return `<div class="field"><label for="max-price">Illustrative budget <span>USD</span></label><div class="money-input"><span aria-hidden="true">$</span><input id="max-price" name="maxPrice" type="number" min="0" max="1000" step="1" inputmode="decimal" value="${state.constraints.maxPrice / 100}" required aria-describedby="budget-help"></div><p id="budget-help" class="field-help">Sample prices, not verified merchant prices.</p></div><div class="field"><label for="format">Book format</label><select id="format" name="format">${[
      ['any', 'Any format'],
      ['paperback', 'Paperback'],
      ['hardback', 'Hardback'],
      ['ebook', 'Ebook'],
    ]
      .map(
        ([value, label]) =>
          `<option value="${value}" ${state.constraints.format === value ? 'selected' : ''}>${label}</option>`,
      )
      .join(
        '',
      )}</select><p class="field-help">A preference within the permitted catalog.</p></div><div class="field occasion-field"><span class="field-label">The occasion</span><p class="occasion">A thoughtful gift <span aria-hidden="true">✳</span></p><p class="field-help">Mira’s private references stay with Mira.</p></div>`;
  if (clientId === 'media')
    return `<div class="field"><label for="max-minutes">Time for a film</label><select id="max-minutes" name="maxMinutes">${[90, 120, 150, 180, 240].map((minutes) => `<option value="${minutes}" ${state.constraints.maxMinutes === minutes ? 'selected' : ''}>Up to ${minutes} minutes</option>`).join('')}</select><p class="field-help">Runtime comes from public sample catalog facts.</p></div><div class="field"><span class="field-label">The mood</span><p class="occasion">Your permitted taste space <span aria-hidden="true">✦</span></p><p class="field-help">The gateway makes the choice within its scope.</p></div><div class="field availability-field"><span class="field-label">The important detail</span><p class="availability-copy">Bring your own screen.</p><p class="field-help">Streaming service availability is not verified.</p></div>`;
  return `<div class="field"><label for="max-price">Illustrative spend <span>USD</span></label><div class="money-input"><span aria-hidden="true">$</span><input id="max-price" name="maxPrice" type="number" min="0" max="1000" step="1" inputmode="decimal" value="${state.constraints.maxPrice / 100}" required aria-describedby="budget-help"></div><p id="budget-help" class="field-help">Sample amounts, not admission or booking prices.</p></div><div class="field"><label for="setting">Where sounds good?</label><select id="setting" name="setting">${[
    ['any', 'Indoors or outdoors'],
    ['indoors', 'Somewhere indoors'],
    ['outdoors', 'Somewhere outdoors'],
  ]
    .map(
      ([value, label]) =>
        `<option value="${value}" ${state.constraints.setting === value ? 'selected' : ''}>${label}</option>`,
    )
    .join(
      '',
    )}</select><p class="field-help">An outing within the London sample collection.</p></div><div class="field"><span class="field-label">A little breathing room</span><p class="occasion">London <span aria-hidden="true">↗</span></p><p class="field-help">Check opening times and accessibility with the source.</p></div>`;
}

function connectionStrip() {
  const grant = state.view.grant;
  return `<div class="connection-strip"><span class="connection-state"><span class="status-dot" aria-hidden="true"></span>${state.blocked ? 'Access needs attention' : 'Connected with permission'}</span><span class="connection-meta">${esc(grant.purpose === 'gift' ? 'Private gift connection' : 'Personal connection')} · until ${esc(dateTime(grant.expiresAt))}</span><button class="text-button" type="button" data-action="reconnect">Retry connection <span aria-hidden="true">↻</span></button></div>`;
}

function issuePanel(error) {
  const copy = errorCopy(error);
  return `<section class="inline-error" role="alert"><span class="error-symbol" aria-hidden="true">!</span><div><h3>${esc(copy.title)}</h3><p>${esc(copy.body)}</p><div class="button-row"><button type="button" class="button secondary" data-action="retry-choice">Try again</button>${state.lastMode === 'qloo' ? '<button type="button" class="button primary" data-action="use-sample">Use authored sample</button>' : ''}</div><p class="error-code">${esc(error.code)}</p></div></section>`;
}

function renderWorkspace() {
  if (!state.view) {
    renderEmpty(state.issue);
    return;
  }
  document.querySelector('.demo-notice p').innerHTML =
    `<strong>Isolated role-play demo.</strong> ${state.view.grant.purpose === 'gift' ? `Mira is the example recipient; ${esc(state.view.delegate.displayName)} is the example giver.` : `You’re trying Mira’s personal example workspace as ${esc(state.view.delegate.displayName)}.`} Claiming an invitation does not verify a real identity. Recommendations and budgets in sample mode are authored examples.`;
  if (state.blocked) {
    const copy = errorCopy(state.blocked);
    workspace.innerHTML = `${connectionStrip()}<section class="message-panel blocked-panel" role="alert"><div class="panel-index" aria-hidden="true">!</div><div><p class="eyebrow">CONNECTION UPDATE</p><h2>${esc(copy.title)}</h2><p>${esc(copy.body)}</p><div class="button-row"><button type="button" class="button primary" data-action="reconnect">Retry connection</button><a class="button secondary" href="${esc(ownerLink('/connections?client=' + clientId))}">Review in TASTEKEEPER <span aria-hidden="true">↗</span></a></div><p class="error-code">${esc(state.blocked.code)}</p></div></section>`;
    workspace.setAttribute('aria-busy', 'false');
    return;
  }
  workspace.setAttribute('aria-busy', String(state.waiting || state.working));
  workspace.innerHTML = `${connectionStrip()}<section class="brief-section" aria-labelledby="brief-title"><div class="section-heading"><div><p class="eyebrow">${clientId === 'media' ? 'BEFORE YOU PRESS PLAY' : 'LET’S BEGIN WITH THE BRIEF'}</p><h2 id="brief-title">${wording.heading}</h2></div><button type="button" class="text-button scope-link" data-action="scope">What can this app see? <span aria-hidden="true">↗</span></button></div><form id="brief-form"><fieldset class="brief-fields" ${state.waiting || state.working ? 'disabled' : ''}><legend class="sr-only">Your ${esc(wording.noun)} brief</legend>${formFields()}</fieldset><div class="form-bottom"><fieldset class="mode-fieldset" ${state.waiting || state.working ? 'disabled' : ''}><legend>Recommendation mode</legend><div class="mode-options"><button type="button" class="mode-choice ${state.mode === 'sample' ? 'is-active' : ''}" aria-pressed="${state.mode === 'sample'}" data-mode="sample"><span class="mode-radio" aria-hidden="true"></span>Authored sample</button><button type="button" class="mode-choice ${state.mode === 'qloo' ? 'is-active' : ''}" aria-pressed="${state.mode === 'qloo'}" data-mode="qloo"><span class="mode-radio" aria-hidden="true"></span>Qloo live <span class="unavailable-label">Unavailable</span></button></div></fieldset><button class="button primary submit-brief" type="submit" ${state.waiting || state.working ? 'disabled' : ''}>${state.waiting || state.working ? 'Checking your choice…' : state.mode === 'qloo' ? 'Check Qloo live' : wording.submit}<span aria-hidden="true">${clientId === 'media' ? '▶' : '→'}</span></button></div><p class="mode-disclosure">${state.mode === 'qloo' ? 'No Qloo key is configured. A live request will return an unavailable response; your brief is preserved.' : 'Authored sample order from TASTEKEEPER. These results are not Qloo recommendations. No individual preference or purchase likelihood has been measured.'}</p></form></section>${state.issue ? issuePanel(state.issue) : ''}<div id="choice-output" aria-live="polite"></div><div id="saved-output"></div><p class="catalog-notice"><span aria-hidden="true">↗</span><span>${esc(state.view.catalog.availabilityNotice)} <button type="button" class="text-button" data-action="catalog">View sample catalog facts</button></span></p>`;
  renderOutput();
  renderSaved();
}

const stageNames = {
  queued: 'Your request is queued.',
  authorizing: 'Checking this connection’s permission.',
  resolving: 'Checking options in the permitted catalog.',
  ranking: 'Reading the gateway’s authored sample order.',
  preparing: 'Preparing the permitted result.',
  release_pending: 'Checking access once more before release.',
};

function renderOutput() {
  const output = document.querySelector('#choice-output');
  if (!output) return;
  if (state.waiting) {
    const stage =
      state.stage === 'ranking' && state.lastMode === 'qloo'
        ? 'Requesting fit from Qloo.'
        : stageNames[state.stage] || 'Checking the choice.';
    output.innerHTML = `<section class="waiting-panel" aria-labelledby="waiting-title"><div class="waiting-header"><div><p class="eyebrow">A LITTLE THOUGHT</p><h2 id="waiting-title">A choice is on its way.</h2><p class="progress-message"><span class="loading-dot" aria-hidden="true"></span>${esc(stage)}</p></div><button class="text-button" type="button" data-action="pause">Stop waiting here</button></div><div class="skeleton-grid" aria-hidden="true"><div class="skeleton-card"><div></div><span></span><span></span></div><div class="skeleton-card"><div></div><span></span><span></span></div><div class="skeleton-card"><div></div><span></span><span></span></div></div></section>`;
    return;
  }
  if (state.paused && state.runId) {
    output.innerHTML =
      '<section class="message-panel paused-panel"><div><h2>Waiting is paused in this tab.</h2><p>The gateway may still finish this request. Check it again when you’re ready.</p><button type="button" class="button secondary" data-action="resume">Check this request</button></div></section>';
    return;
  }
  if (!state.result) {
    output.innerHTML = '';
    return;
  }
  const result = state.result;
  const provenance = result.provenance;
  if (!result.items.length) {
    output.innerHTML = `<section class="message-panel empty-choice"><div><p class="eyebrow">NO ELIGIBLE CHOICE</p><h2>A little more room might help.</h2><p>No permitted ${esc(wording.plural)} matched this brief in the sample catalog. You can adjust your constraints or review the connection with its owner.</p><p class="fine-print">${esc(provenance.label)} · ${provenance.candidateCount} catalog options considered.</p><button type="button" class="button secondary" data-action="edit-brief">Adjust the brief</button></div></section>`;
    return;
  }
  output.innerHTML = `<section class="results-section" aria-labelledby="results-title"><div class="section-heading"><div><p class="eyebrow">${provenance.mode === 'authored_sample' ? 'AN AUTHORED SAMPLE CHOICE' : 'A PERMITTED QLOO CHOICE'}</p><h2 id="results-title">${wording.lead}</h2></div><button type="button" class="text-button" data-action="receipt">View choice receipt <span aria-hidden="true">↗</span></button></div><div class="provenance-line"><span class="provenance-label">${provenance.mode === 'authored_sample' ? 'Authored sample' : 'Qloo result'}</span><p>${esc(provenance.label)}</p></div>${result.stale ? '<p class="result-warning">Based on an earlier context. Review the connection and make a new choice.</p>' : ''}${provenance.status === 'partial' || provenance.status === 'degraded' ? '<p class="result-warning">Some explanation details are unavailable. Only the returned public facts are shown.</p>' : ''}<div class="result-grid">${result.items.map((item, index) => resultCard(item, index)).join('')}</div><p class="result-footnote">${provenance.candidateCount} sample catalog options considered · Released with permission ${esc(dateTime(result.receipt.authorizedAt))}. ${provenance.mode === 'authored_sample' ? 'This order was authored for the demo.' : 'Cultural affinity is not an individual certainty.'}</p></section>`;
}

function artwork(item, index) {
  const facts = state.view.catalog.items.find((entry) => entry.id === item.id);
  const artVariants = {
    botanical: 0,
    sunflower: 3,
    solstice: 2,
    circle: 4,
    gathering: 1,
    river: 0,
    flight: 2,
    mountain: 4,
    hotel: 3,
    cove: 1,
    glasshouse: 0,
    shelves: 1,
    gallery: 2,
    cinema: 4,
    garden: 3,
  };
  const variant =
    artVariants[facts?.art] ??
    Math.abs(
      Array.from(facts?.art || item.id).reduce(
        (hash, letter) => (hash * 31 + letter.charCodeAt(0)) | 0,
        0,
      ),
    ) % 6;
  if (clientId === 'books')
    return `<div class="item-art book-art art-${variant}" aria-hidden="true"><div class="book-binding"></div><span class="cover-imprint">THE READING ROOM</span><span class="cover-title">${esc(item.title)}</span><svg class="cover-emblem" viewBox="0 0 120 120"><path d="M60 105V44M60 72C24 70 18 45 33 41C48 36 60 55 60 72M60 88C91 88 107 63 91 57C78 53 64 68 60 88"/><path d="M60 14L74 32L98 29L94 53L108 70L84 78L76 101L57 87L34 96L29 71L10 58L30 44L35 20L57 29Z"/><circle cx="60" cy="56" r="16"/></svg><span class="cover-author">${esc(item.creator)}</span></div>`;
  if (clientId === 'media')
    return `<div class="item-art film-art art-${variant}" aria-hidden="true"><svg viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice"><circle class="poster-sun" cx="215" cy="108" r="67"/><path class="poster-back" d="M0 210Q90 90 186 218T300 162V400H0Z"/><path class="poster-front" d="M0 283Q88 233 180 294T300 267V400H0Z"/><path class="poster-path" d="M165 229L218 400H98L149 229Z"/><path d="M155 225V253M149 225Q155 211 161 225" stroke="currentColor" stroke-width="7" fill="none"/></svg><span class="poster-overline">TONIGHT PRESENTS</span><span class="poster-title">${esc(item.title)}</span><span class="poster-index">${String(index + 1).padStart(2, '0')} / A FILM FOR THE MOMENT</span></div>`;
  return `<div class="item-art place-art art-${variant}" aria-hidden="true"><svg viewBox="0 0 420 300" preserveAspectRatio="xMidYMid slice"><rect width="420" height="300" class="map-ground"/><path class="map-water" d="M-10 265Q96 140 199 209T440 96"/><path class="map-roads" d="M-20 55L430 259M32-10L279 320M-20 188L440 40M62 326L419 162"/><rect class="map-park" x="54" y="58" width="73" height="64" rx="16"/><rect class="map-park" x="274" y="211" width="87" height="77" rx="21"/><path class="map-route" d="M118 103Q206 114 218 150T308 158"/><circle class="map-point-halo" cx="218" cy="148" r="35"/><path class="map-pin" d="M201 137Q218 112 235 137Q241 153 218 178Q195 153 201 137Z"/><circle class="map-pin-center" cx="218" cy="141" r="7"/></svg><span class="place-index">${String(index + 1).padStart(2, '0')}</span><span class="place-art-label">LONDON · A LITTLE POSSIBILITY</span></div>`;
}

function resultCard(item, index) {
  const facts = state.view.catalog.items.find((entry) => entry.id === item.id);
  const saved = state.view.selections.some(
    (selection) => selection.runId === state.runId && selection.itemId === item.id,
  );
  const detail =
    clientId === 'books'
      ? facts?.format
      : clientId === 'media'
        ? facts?.minutes
          ? `${facts.minutes} min`
          : 'Runtime not supplied'
        : facts?.setting;
  const handoffUrl = clientId === 'places' ? directionsUrl(item, facts) : safeUrl(item.url);
  return `<article class="result-card ${index === 0 ? 'leading-card' : ''}">${artwork(item, index)}<div class="card-content"><p class="card-kicker">${index === 0 ? 'THE FIRST CHOICE' : `ANOTHER POSSIBILITY · ${String(index + 1).padStart(2, '0')}`}</p><h3>${esc(item.title)}</h3><p class="card-creator">${esc(item.creator)}</p><p class="card-description">${esc(item.description)}</p><div class="card-facts"><span>${esc(detail || 'Public sample facts')}</span><span>${money(item.price)} <span class="sample-price">sample</span></span></div><button type="button" class="source-facts text-button" data-action="source" data-item="${esc(item.id)}">View source facts <span aria-hidden="true">↗</span></button><div class="card-actions"><button type="button" class="button primary keep-choice" data-action="save" data-item="${esc(item.id)}" ${saved ? 'disabled' : ''}>${saved ? '✓ Choice kept' : 'Keep this choice'}</button><a class="button secondary source-link" href="${esc(handoffUrl)}" target="_blank" rel="noopener noreferrer">${wording.source} <span aria-hidden="true">↗</span></a></div></div></article>`;
}

function renderSaved() {
  const target = document.querySelector('#saved-output');
  if (!target || !state.view) return;
  const selections = state.view.selections;
  target.innerHTML = selections.length
    ? `<section class="saved-section" aria-labelledby="saved-title"><div><p class="eyebrow">KEPT WITH INTENTION</p><h2 id="saved-title">${wording.saved}</h2><p>Saved through the gateway. Nothing has been purchased or booked.</p></div><ul>${selections.map((selection) => `<li><span class="saved-tick" aria-hidden="true">✓</span><span><strong>${esc(selection.title)}</strong><small>Kept ${esc(dateTime(selection.savedAt))}</small></span></li>`).join('')}</ul></section>`
    : '';
}

function showDrawer(html) {
  drawerContent.innerHTML = html;
  if (!drawer.open) drawer.showModal();
}

function scopeDrawer() {
  if (!state.view) {
    aboutDrawer();
    return;
  }
  const view = state.view;
  showDrawer(
    `<h2 id="drawer-title">Permission, in plain language.</h2><p class="drawer-intro">This is an isolated role-play demo, with no real identity verification. ${esc(view.delegate.displayName)} may ask this app for ${esc(wording.plural)} within the approved connection.</p><dl class="evidence-facts"><div><dt>Purpose</dt><dd>${esc(view.grant.purpose === 'gift' ? 'A private gift for Mira' : 'A personal choice')}</dd></div><div><dt>Taste space</dt><dd>${esc(view.grant.contextName)}</dd></div><div><dt>Access ends</dt><dd>${esc(dateTime(view.grant.expiresAt))}</dd></div><div><dt>Request allowance remaining</dt><dd>${view.grant.remainingRequests}</dd></div><div><dt>Permitted output</dt><dd>${view.grant.fields.map(esc).join(', ')}</dd></div><div><dt>Catalog</dt><dd>${esc(view.catalog.id)}</dd></div></dl><div class="drawer-callout"><h3>The boundary</h3><p>This app receives public item facts and permitted choices. It does not receive selected references, private signals, or Qloo seed contributions. Suggestions may still reveal something about taste.</p></div><p>Only the owner can change or end future access. Ending access cannot recall results already shared.</p><a class="button drawer-button" href="${esc(ownerLink('/connections?client=' + clientId))}">Review in TASTEKEEPER <span aria-hidden="true">↗</span></a>`,
  );
}

function aboutDrawer() {
  showDrawer(
    '<h2 id="drawer-title">A reference app with a boundary.</h2><p class="drawer-intro">The Reading Room, Tonight, and A Good Afternoon are independent reference applications built by the TASTEKEEPER team. They are working examples, not claimed partnerships.</p><div class="drawer-callout"><h3>Authored sample mode</h3><p>The gateway returns an explicitly authored sample order. It is not a live Qloo result, a measured personal prediction, or verified stock, screening, booking, or opening-hour information.</p></div><p>Each app runs its own backend, has separate credentials, and keeps its session separate. Browsers send their brief to that app. Only the gateway can read taste spaces and authorize results.</p><p>The owner chooses the context, purpose, catalog, fields, allowance, and end time. A later request is checked again. This demo role-play does not establish a real identity.</p>',
  );
}

function receiptDrawer() {
  if (!state.result) {
    scopeDrawer();
    return;
  }
  const result = state.result;
  showDrawer(
    `<h2 id="drawer-title">The receipt for this choice.</h2><p class="drawer-intro">A public record of the permission used when this result was released. Private taste references are not part of this client’s receipt.</p><span class="drawer-mode">${result.provenance.mode === 'authored_sample' ? 'AUTHORED SAMPLE · NO QLOO CALL' : 'QLOO RESULT'}</span><p>${esc(result.provenance.label)}</p><dl class="evidence-facts"><div><dt>Receipt</dt><dd class="mono">${esc(result.receipt.id)}</dd></div><div><dt>Decision</dt><dd class="mono">${esc(result.id)}</dd></div><div><dt>Authorized release</dt><dd>${esc(dateTime(result.receipt.authorizedAt))}</dd></div><div><dt>Grant version</dt><dd>${result.receipt.grantVersion}</dd></div><div><dt>Context revision</dt><dd>${result.receipt.contextRevision}</dd></div><div><dt>Catalog options considered</dt><dd>${result.provenance.candidateCount}</dd></div><div><dt>Choices returned</dt><dd>${result.provenance.selectedCount}</dd></div><div><dt>Released fields</dt><dd>${result.receipt.fields.map(esc).join(', ')}</dd></div><div><dt>Evidence status</dt><dd>${esc(result.provenance.status)}</dd></div></dl><p>The app displays the gateway’s returned order without ranking it again. Sample prices are illustrative. No current availability is verified.</p>`,
  );
}

function sourceDrawer(itemId) {
  const item = state.result?.items.find((entry) => entry.id === itemId);
  const facts = state.view?.catalog.items.find((entry) => entry.id === itemId);
  if (!item || !facts) return;
  showDrawer(
    `<h2 id="drawer-title">${esc(item.title)}</h2><p class="drawer-intro">${esc(item.creator)}</p><p>${esc(item.description)}</p><dl class="evidence-facts"><div><dt>Public item identifier</dt><dd class="mono">${esc(item.id)}</dd></div>${facts.identity ? `<div><dt>${clientId === 'places' ? 'Public address' : 'Public identity'}</dt><dd>${esc(facts.identity)}</dd></div>` : ''}${facts.format ? `<div><dt>Edition format</dt><dd>${esc(facts.format)}</dd></div>` : ''}${facts.minutes ? `<div><dt>Runtime</dt><dd>${facts.minutes} minutes</dd></div>` : ''}${facts.setting ? `<div><dt>Setting</dt><dd>${esc(facts.setting)}</dd></div>` : ''}<div><dt>Illustrative amount</dt><dd>${money(item.price)} USD · sample</dd></div><div><dt>Catalog source</dt><dd>${esc(state.view.catalog.source)}</dd></div><div><dt>Sample snapshot created</dt><dd>${esc(dateTime(state.view.catalog.retrievedAt))}</dd></div><div><dt>Public source</dt><dd>${esc(sourceName(item.url))}</dd></div></dl><div class="drawer-callout"><h3>Check with the source</h3><p>${esc(state.view.catalog.availabilityNotice)} These catalog facts do not verify current price or operational availability.</p></div><a class="button drawer-button" href="${esc(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer">${clientId === 'places' ? 'Open official venue page' : wording.source} <span aria-hidden="true">↗</span></a>${clientId === 'places' ? `<a class="button drawer-button" href="${esc(directionsUrl(item, facts))}" target="_blank" rel="noopener noreferrer">Search directions <span aria-hidden="true">↗</span></a>` : ''}`,
  );
}

function catalogDrawer() {
  if (!state.view) return;
  const catalog = state.view.catalog;
  showDrawer(
    `<h2 id="drawer-title">A small, named collection.</h2><p class="drawer-intro">${esc(catalog.availabilityNotice)}</p><dl class="evidence-facts"><div><dt>Catalog</dt><dd>${esc(catalog.id)}</dd></div><div><dt>Authorized snapshot</dt><dd class="mono">${esc(catalog.snapshotId)}</dd></div><div><dt>Source</dt><dd>${esc(catalog.source)}</dd></div><div><dt>Sample snapshot created</dt><dd>${esc(dateTime(catalog.retrievedAt))}</dd></div></dl><h3>Public catalog items</h3><ul class="catalog-list">${catalog.items.map((item) => `<li><a href="${esc(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer"><span>${esc(item.title)}</span><span aria-hidden="true">↗</span></a><small>${esc(item.creator)} · ${money(item.price)} sample</small></li>`).join('')}</ul><p>This app sends the approved candidate identifiers to TASTEKEEPER. It never creates or independently ranks substitute options.</p>`,
  );
}

function toast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message;
  element.hidden = false;
  window.clearTimeout(toast.timeout);
  toast.timeout = window.setTimeout(() => {
    element.hidden = true;
  }, 5000);
}

function fail(error) {
  state.waiting = false;
  state.working = false;
  state.issue = error;
  if (
    accessErrors.has(error.code) ||
    error.status === 403 ||
    error.status === 410 ||
    error.code === 'NO_SESSION'
  ) {
    state.blocked = error;
    state.result = null;
    if (drawer.open) drawer.close();
  }
  renderWorkspace();
}

function readBrief() {
  const form = document.querySelector('#brief-form');
  if (!form) return true;
  if (!form.reportValidity()) return false;
  const data = new FormData(form);
  if (data.has('maxPrice'))
    state.constraints.maxPrice = Math.round(Number(data.get('maxPrice')) * 100);
  if (data.has('format')) state.constraints.format = String(data.get('format'));
  if (data.has('maxMinutes')) state.constraints.maxMinutes = Number(data.get('maxMinutes'));
  if (data.has('setting')) state.constraints.setting = String(data.get('setting'));
  return true;
}

async function startChoice(mode = state.mode) {
  if (state.waiting || state.working || !state.view || state.blocked || !readBrief()) return;
  state.generation += 1;
  state.mode = mode;
  state.lastMode = mode;
  state.working = true;
  state.issue = null;
  state.result = null;
  state.paused = false;
  renderWorkspace();
  try {
    const request = await api('/api/decisions', {
      hardConstraints: state.constraints,
      mode,
      idempotencyKey: crypto.randomUUID(),
    });
    state.runId = request.id;
    state.working = false;
    await pollChoice();
  } catch (error) {
    fail(error);
  }
}

async function pollChoice() {
  const generation = ++state.generation;
  state.waiting = true;
  state.paused = false;
  state.stage = 'queued';
  state.issue = null;
  renderWorkspace();
  const started = Date.now();
  try {
    while (generation === state.generation) {
      const result = await api('/api/decisions/' + encodeURIComponent(state.runId));
      if (generation !== state.generation) return;
      if (result.state === 'released') {
        // Reload the allowance and persisted shortlist through the gateway, too.
        const current = await api('/api/session');
        if (generation !== state.generation) return;
        state.view = current;
        state.result = result;
        state.waiting = false;
        renderWorkspace();
        return;
      }
      state.stage = result.state;
      renderOutput();
      if (Date.now() - started > 45_000) {
        state.waiting = false;
        state.paused = true;
        renderWorkspace();
        toast('This choice is taking longer. You can check the request again.');
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 650));
    }
  } catch (error) {
    if (generation === state.generation) fail(error);
  }
}

async function reconnect() {
  state.generation += 1;
  state.waiting = false;
  try {
    const view = await api('/api/session');
    state.view = view;
    state.blocked = null;
    state.issue = null;
    renderWorkspace();
    toast('Connection checked with TASTEKEEPER.');
  } catch (error) {
    fail(error);
  }
}

async function saveChoice(button) {
  if (!state.runId || !state.result || button.disabled) return;
  const itemId = button.dataset.item;
  button.disabled = true;
  button.textContent = 'Keeping your choice…';
  try {
    const saved = await api(`/api/decisions/${encodeURIComponent(state.runId)}/selection`, {
      itemId,
    });
    if (
      !state.view.selections.some(
        (entry) => entry.runId === state.runId && entry.itemId === saved.itemId,
      )
    ) {
      state.view.selections.push({ ...saved, runId: state.runId });
    }
    button.textContent = '✓ Choice kept';
    renderSaved();
    toast('Choice kept in this connection’s shortlist. Nothing purchased.');
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Keep this choice';
    fail(error);
  }
}

document.addEventListener('submit', (event) => {
  if (event.target.id !== 'brief-form') return;
  event.preventDefault();
  void startChoice();
});
document.addEventListener('change', (event) => {
  if (event.target.closest('#brief-form')) readBrief();
});
document.addEventListener('click', (event) => {
  const modeButton = event.target.closest('[data-mode]');
  if (modeButton && !modeButton.disabled && readBrief()) {
    state.mode = modeButton.dataset.mode;
    renderWorkspace();
    document.querySelector(`[data-mode="${state.mode}"]`)?.focus();
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'reconnect') void reconnect();
  if (action === 'scope') scopeDrawer();
  if (action === 'receipt') receiptDrawer();
  if (action === 'source') sourceDrawer(button.dataset.item);
  if (action === 'catalog') catalogDrawer();
  if (action === 'save') void saveChoice(button);
  if (action === 'retry-choice') void startChoice(state.lastMode);
  if (action === 'use-sample') void startChoice('sample');
  if (action === 'resume') void pollChoice();
  if (action === 'pause') {
    state.generation += 1;
    state.waiting = false;
    state.paused = true;
    renderWorkspace();
  }
  if (action === 'edit-brief')
    document.querySelector('#brief-form input, #brief-form select')?.focus();
});
document.querySelector('.close-drawer').addEventListener('click', () => drawer.close());
drawer.addEventListener('click', (event) => {
  if (event.target === drawer) {
    const rect = drawer.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      drawer.close();
  }
});
document.querySelector('#connection-details').addEventListener('click', scopeDrawer);
document.querySelector('#about-client').addEventListener('click', () => {
  document.querySelector('.site-menu').open = false;
  aboutDrawer();
});
document.querySelector('#retry-connection').addEventListener('click', () => {
  document.querySelector('.site-menu').open = false;
  void reconnect();
});

async function boot() {
  try {
    let view;
    const claiming = Boolean(invitationToken);
    if (invitationToken) {
      const claim = { token: invitationToken };
      invitationToken = null;
      view = await api('/api/claim', claim);
      claim.token = '';
    } else view = await api('/api/session');
    state.view = view;
    if (view.brief) {
      state.constraints = view.brief.hardConstraints;
      state.mode = view.brief.mode;
      state.lastMode = view.brief.mode;
    }
    renderWorkspace();
    if (claiming) {
      workspace.scrollIntoView({ block: 'start', behavior: 'instant' });
      workspace.focus({ preventScroll: true });
    }
    if (view.latestRunId) {
      state.runId = view.latestRunId;
      await pollChoice();
    }
  } catch (error) {
    invitationToken = null;
    state.issue = error;
    renderEmpty(error);
  }
}
void boot();
