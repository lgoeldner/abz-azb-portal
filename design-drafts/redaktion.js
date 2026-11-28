'use strict';
/* Redaktion page: four layouts over the same placeholder data, picked from the index with
   ?l=liste|karten|fokus|spalten. Tickets can be ticked off where they are (one step on, with undo);
   the detail page is not part of this draft. Data mirrors the portal's ticket and poll models. */
(function () {
  const { $, ICONS, UI } = window.P;
  const LAYOUTS = ['liste', 'karten', 'fokus', 'spalten'];
  const qp = new URLSearchParams(location.search).get('l');
  const L = LAYOUTS.includes(qp) ? qp : 'liste';
  document.documentElement.classList.add('l-' + L);

  const S = (inner, size, extra = '') =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" ${extra}>${inner}</svg>`;
  const I = {
    check: S('<path d="M5.5 12.4 9.8 16.5 18.5 7.2"/>', 14, 'stroke-width="3"'),
    bubble: S('<path d="M12 4.75c4.56 0 8.25 2.98 8.25 6.65s-3.69 6.65-8.25 6.65c-.86 0-1.7-.1-2.48-.3L5.4 19.6l.98-3.33C4.73 15.05 3.75 13.32 3.75 11.4 3.75 7.73 7.44 4.75 12 4.75z"/>', 14, 'stroke-width="2"'),
    chevR: S('<path d="m9.5 6 6 6-6 6"/>', 14, 'stroke-width="2.6"'),
    chevL: S('<path d="m14.5 6-6 6 6 6"/>', 16, 'stroke-width="2.6"'),
    person: `<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8.1" r="4.3"/><path d="M4.2 19.6c1.3-3.7 4.3-5.6 7.8-5.6s6.5 1.9 7.8 5.6c.2.6-.2 1.15-.85 1.15H5.05c-.65 0-1.05-.55-.85-1.15z"/></svg>`,
    list: `<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><circle cx="5.2" cy="6.5" r="1.7"/><circle cx="5.2" cy="12" r="1.7"/><circle cx="5.2" cy="17.5" r="1.7"/><rect x="9" y="5.2" width="11.5" height="2.6" rx="1.3"/><rect x="9" y="10.7" width="11.5" height="2.6" rx="1.3"/><rect x="9" y="16.2" width="11.5" height="2.6" rx="1.3"/></svg>`,
    cloud: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M7.4 19h9.9a4.2 4.2 0 0 0 .72-8.34A5.9 5.9 0 0 0 6.6 9.3 4.85 4.85 0 0 0 7.4 19z"/></svg>`,
    people: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="8" r="3.6"/><path d="M2.6 18.6c1.05-3.1 3.5-4.7 6.4-4.7s5.35 1.6 6.4 4.7c.17.5-.2 1-.72 1H3.32c-.52 0-.9-.5-.72-1z"/><circle cx="16.6" cy="8.6" r="2.9"/><path d="M16.2 13.4c2.6-.2 4.6 1.2 5.4 3.9.14.48-.22.95-.72.95h-3.5c-.2-1.9-.6-3.4-1.18-4.85z"/></svg>`,
    mail: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M4.75 5.5h14.5A2.25 2.25 0 0 1 21.5 7.75v.3l-9.5 5.6-9.5-5.6v-.3A2.25 2.25 0 0 1 4.75 5.5zM2.5 9.9l9.1 5.35a.8.8 0 0 0 .8 0L21.5 9.9v6.35a2.25 2.25 0 0 1-2.25 2.25H4.75A2.25 2.25 0 0 1 2.5 16.25z"/></svg>`,
    clock: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm-.1 4.2a1 1 0 0 0-1 1v4.25c0 .35.18.67.48.85l3.1 1.9a1 1 0 1 0 1.04-1.7l-2.62-1.6V8.2a1 1 0 0 0-1-1z"/></svg>`,
  };

  /* ───────── placeholder data ───────── */
  const AREAS = {
    texte: { name: 'Texte', c: '#FF8D28' },
    layout: { name: 'Layout', c: '#6155F5' },
    fotos: { name: 'Fotos', c: '#0088FF' },
    sponsoring: { name: 'Sponsoring', c: '#34C759' },
  };
  const PEOPLE = { lena: 'Lena Fischer', mia: 'Mia Weber', jonas: 'Jonas Hartmann', paul: 'Paul Meyer', sophie: 'Sophie Schmitt' };
  const REVIEWER = { texte: 'lena', layout: 'mia', fotos: 'paul', sponsoring: 'sophie' };
  const first = (k) => PEOPLE[k].split(' ')[0];
  const initials = (k) => PEOPLE[k].split(' ').map((w) => w[0]).join('');
  const ALL_TICKETS = 23;

  // state: changes (sent back to you) · review-you (waits for your approval) · progress (yours) ·
  // review-mine (yours, waiting for someone else) · done
  const tickets = [
    { id: 14, type: 'artikel', title: 'Interview mit der Schulleitung', area: 'texte', pages: 2, state: 'changes', with: ['paul'], by: 'lena', note: 'Einleitung kürzen und die Zitate noch mal gegenchecken.', goal: 'Zwei Seiten, freigegeben von Frau Albers', comments: 4, when: 'vor 2 Std.' },
    { id: 21, type: 'aufgabe', title: 'Layout Seite 12–13 prüfen', area: 'layout', size: 'S', state: 'review-you', with: ['mia'], by: 'mia', note: 'Doppelseite Kursfahrten ist fertig, Bildrechte sind geklärt.', goal: 'Satzspiegel und Bildrechte geprüft', comments: 2, when: 'vor 5 Std.' },
    { id: 9, type: 'aufgabe', title: 'Lehrerzitate sortieren', area: 'texte', size: 'S', state: 'progress', with: [], goal: 'Doppelte raus, nach Fach sortieren', comments: 0, when: 'seit 3 Tagen' },
    { id: 25, type: 'aufgabe', title: 'Fotos der Mottowoche aussortieren', area: 'fotos', size: 'XS', self: true, state: 'progress', with: [], goal: 'Pro Tag die zehn besten markieren', comments: 1, when: 'seit gestern' },
    { id: 17, type: 'artikel', title: 'Rückblick Skifahrt', area: 'texte', pages: 3, state: 'progress', with: ['jonas'], goal: 'Erster Entwurf mit Bildunterschriften', comments: 6, when: 'seit 5 Tagen' },
    { id: 23, type: 'aufgabe', title: 'Sponsoren anschreiben', area: 'sponsoring', size: 'M', state: 'review-mine', with: [], goal: 'Bäckerei Krause, Fahrschule Lenz, Copyshop am Markt', comments: 3, when: 'seit 2 Tagen' },
  ];
  const RANK = { changes: 0, 'review-you': 1, progress: 2, 'review-mine': 3, done: 4 };
  tickets.sort((a, b) => RANK[a.state] - RANK[b.state]); // order stays put while you tick (like Reminders)

  const ELIGIBLE = 26;
  const KINDS = {
    person: { label: 'Personenwahl', icon: I.person, c: '#FF8D28' },
    proposal: { label: 'Vorschlagswahl', icon: I.list, c: '#0088FF' },
    words: { label: 'Wortwolke', icon: I.cloud, c: '#FF2D55' },
  };
  const polls = [
    { t: 'Wer wird zuerst berühmt?', k: 'person', s: 'open', v: 25, days: 1 },
    { t: 'Was darf auf der Abifeier nicht fehlen?', k: 'proposal', s: 'open', v: 23, days: 5 },
    { t: 'Bester Ort in der Freistunde', k: 'proposal', s: 'open', v: 9, days: 6 },
    { t: 'Unser Abimotto', k: 'proposal', s: 'open', v: 18, days: 10 },
    { t: 'Wer hat immer einen guten Spruch?', k: 'person', s: 'open', v: 21, days: 14 },
    { t: 'Unser Jahrgang in 3 Wörtern', k: 'words', s: 'open', v: 12, days: 18 },
    { t: 'Lieblingslehrer:in', k: 'person', s: 'draft' },
    { t: 'Song für den Einzug beim Abiball', k: 'proposal', s: 'draft' },
    { t: 'Lieblingstag der Mottowoche', k: 'proposal', s: 'closed', v: 26, ended: '12. Nov.' },
    { t: 'Beste Erinnerung aus der 11. Klasse', k: 'proposal', s: 'closed', v: 24, ended: '3. Nov.' },
    { t: 'Ziel der Abifahrt', k: 'proposal', s: 'closed', v: 26, ended: '18. Okt.' },
  ];

  /* ───────── ticket logic ───────── */
  const byId = (id) => tickets.find((t) => t.id === id);
  const visible = () => tickets.filter((t) => !t.gone);

  function ask(t) {
    switch (t.state) {
      case 'changes': return { label: 'Änderungen gewünscht', text: `${first(t.by)}: „${t.note}“` };
      case 'review-you': return { label: 'Wartet auf deine Freigabe', text: `${first(t.by)}: „${t.note}“` };
      case 'progress': return { label: 'In Arbeit', text: `Ziel: ${t.goal}` };
      case 'review-mine': return { label: 'In Prüfung', text: `Wartet auf ${first(REVIEWER[t.area])}` };
      default: return { label: 'Erledigt', text: t.selfDone ? 'Selbst freigegeben' : 'Freigegeben' };
    }
  }
  function action(t) {
    if (t.state === 'review-you') return { label: 'Freigeben', next: 'done', toast: `„${t.title}“ freigegeben` };
    if (t.state === 'progress' && t.self) return { label: 'Erledigt', next: 'done', self: true, toast: 'Erledigt und selbst freigegeben' };
    if (t.state === 'progress' || t.state === 'changes') return { label: 'Zur Prüfung', next: 'review-mine', toast: `An ${first(REVIEWER[t.area])} zur Prüfung gegeben` };
    return null;
  }
  const sizeText = (t) => (t.type === 'artikel' ? `Artikel · ~${t.pages} Seiten` : `Aufgabe · ${t.size}`);

  function tick(id) {
    const t = byId(id);
    const a = t && action(t);
    if (!a) return;
    const prev = { state: t.state, selfDone: t.selfDone };
    t.state = a.next;
    t.selfDone = !!a.self;
    t.just = true;
    renderTickets();
    UI.toast(a.toast, 'Widerrufen', () => {
      Object.assign(t, prev, { gone: false, just: true });
      renderTickets();
    });
    // Finished tickets stay a moment with their check, then leave the list.
    if (a.next === 'done') {
      setTimeout(() => {
        if (t.state !== 'done' || t.gone) return;
        const els = [...document.querySelectorAll(`[data-t="${id}"]`)];
        if (!els.length) { t.gone = true; renderTickets(); return; }
        let left = els.length;
        els.forEach((el) => collapse(el, () => { if (--left === 0) { t.gone = true; renderTickets(); } }));
      }, 1100);
    }
  }

  function collapse(el, done) {
    const r = el.getBoundingClientRect();
    const sideways = el.closest('.shelf');
    el.style.overflow = 'hidden';
    const from = sideways ? { width: r.width + 'px', marginRight: '0px', opacity: 1 } : { height: r.height + 'px', opacity: 1 };
    const to = sideways
      ? { width: '0px', marginRight: '-12px', opacity: 0, paddingLeft: '0px', paddingRight: '0px' }
      : { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px' };
    el.animate([from, to], { duration: 340, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'forwards' }).onfinish = done;
  }

  /* ───────── shared pieces ───────── */
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function tickBtn(t) {
    const a = action(t);
    const label = a ? a.label : ask(t).label;
    return `<button class="tk" type="button" data-tick="${t.id}" aria-label="${label}: ${esc(t.title)}"${a ? '' : ' disabled'}>${I.check}</button>`;
  }
  const areaTag = (t) => `<span class="area" style="--c:${AREAS[t.area].c}">${AREAS[t.area].name}</span>`;
  const avatars = (t) => (t.with.length ? `<span class="avs">${t.with.map((k) => `<span class="av-s" title="${PEOPLE[k]}">${initials(k)}</span>`).join('')}</span>` : '');
  const comments = (t) => (t.comments ? `<span class="t-com">${I.bubble}${t.comments}</span>` : '');
  const stCls = (t) => `st-${t.state}${t.just ? ' just' : ''}`;

  function cta(t) {
    const a = action(t);
    if (a) return `<button class="tc-cta" type="button" data-tick="${t.id}">${a.label}</button>`;
    if (t.state === 'done') return `<span class="tc-cta done">${I.check}${t.selfDone ? 'Erledigt' : 'Freigegeben'}</span>`;
    return `<span class="tc-cta wait">In Prüfung</span>`;
  }

  function ring(frac, size, muted) {
    const r = size / 2 - 2.5;
    const C = 2 * Math.PI * r;
    return `<svg class="pring${muted ? ' muted' : ''}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="3.5" class="pr-track"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="3.5" class="pr-fill" stroke-linecap="round"
        stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - frac)).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg>`;
  }
  const pollTime = (p) => {
    if (p.s === 'draft') return '<span>Entwurf</span>';
    if (p.s === 'closed') return `<span>Beendet am ${p.ended}</span>`;
    if (p.days <= 1) return `<span class="soon">${p.days === 0 ? 'Endet heute' : 'Endet morgen'}</span>`;
    return `<span${p.days <= 3 ? ' class="soon"' : ''}>Noch ${p.days} Tage</span>`;
  };
  const POLL_GROUPS = [['open', 'Offen'], ['draft', 'Entwürfe'], ['closed', 'Beendet']];
  const pollsIn = (s) => polls.map((p, i) => [p, i]).filter(([p]) => p.s === s).sort((a, b) => (a[0].days ?? 0) - (b[0].days ?? 0));
  const openBtn = (i) => `<button class="small-btn" type="button" data-open="${i}">Öffnen</button>`;

  /* ───────── ticket components ───────── */
  // Rich list row: status ring · title · what it needs from you · area, size, comments, people.
  const richRow = (t) => `
    <div class="irow trow ${stCls(t)}" data-t="${t.id}">
      ${tickBtn(t)}
      <div class="t-main">
        <div class="t-title">${esc(t.title)}</div>
        <div class="t-ask"><b>${ask(t).label}</b> · ${esc(ask(t).text)}</div>
        <div class="t-meta">${areaTag(t)}<span>${sizeText(t)}</span>${comments(t)}${avatars(t)}</div>
      </div>
    </div>`;

  // Card: area + number, title, a box saying what it needs from you, people and the one action.
  function card(t, { count, hero, mini } = {}) {
    const k = ask(t);
    return `
      <article class="tcard ${stCls(t)}${hero ? ' hero' : ''}${mini ? ' mini' : ''}" data-t="${t.id}">
        <div class="tc-top">${areaTag(t)}<span class="tc-no">#${t.id}</span>${count ? `<span class="tc-count">${count}</span>` : ''}</div>
        <h3 class="tc-title">${esc(t.title)}</h3>
        ${mini
          ? `<p class="tc-line"><b>${k.label}</b> · ${esc(k.text)}</p>`
          : `<div class="tc-ask"><span class="tc-label">${k.label}<span class="tc-when"> · ${t.when}</span></span><span class="tc-text">${esc(k.text)}</span></div>`}
        ${hero && t.state !== 'progress' ? `<p class="tc-goal">Ziel: ${esc(t.goal)}</p>` : ''}
        <div class="tc-foot">${avatars(t)}<span class="tc-meta">${comments(t)}<span>${t.type === 'artikel' ? `~${t.pages} Seiten` : `Größe ${t.size}`}</span></span>${cta(t)}</div>
      </article>`;
  }

  const compactRow = (t, sel) => `
    <div class="irow crow ${stCls(t)}${sel ? ' sel' : ''}" data-t="${t.id}" data-pick="${t.id}">
      ${tickBtn(t)}
      <span class="c-title">${esc(t.title)}</span>
      <span class="c-tag">${{ changes: 'Änderungen', 'review-you': 'Prüfen', progress: t.when.replace('seit ', ''), 'review-mine': 'In Prüfung', done: 'Erledigt' }[t.state]}</span>
    </div>`;

  const allTicketsRow = () => `
    <a class="irow navrow" href="#" data-dead>
      <span class="nav-label">Alle Tickets</span><span class="nav-val">${ALL_TICKETS}</span>${I.chevR}
    </a>`;

  /* ───────── poll components ───────── */
  const pollTrail = (p, i) => (p.s === 'draft'
    ? openBtn(i)
    : `<span class="p-num">${p.v}/${ELIGIBLE}</span>${ring(p.v / ELIGIBLE, 26, p.s === 'closed')}`);

  // Settings-style row: kind icon, title, kind · time, participation.
  const iconRow = ([p, i]) => `
    <div class="irow prow${p.s === 'closed' ? ' closed' : ''}">
      <span class="kicon" style="--c:${KINDS[p.k].c}">${KINDS[p.k].icon}</span>
      <div class="p-main"><div class="p-title">${esc(p.t)}</div><div class="p-sub">${KINDS[p.k].label} · ${pollTime(p)}</div></div>
      ${pollTrail(p, i)}
    </div>`;

  // Bar row: participation as a full-width bar under the title.
  const barRow = ([p, i]) => `
    <div class="irow brow${p.s === 'closed' ? ' closed' : ''}">
      <div class="b-top"><span class="p-title">${esc(p.t)}</span>${p.s === 'draft' ? openBtn(i) : `<span class="p-num">${p.v}/${ELIGIBLE}</span>`}</div>
      ${p.s === 'draft' ? '' : `<span class="bar"><i style="width:${((p.v / ELIGIBLE) * 100).toFixed(1)}%"></i></span>`}
      <div class="p-sub">${KINDS[p.k].label} · ${pollTime(p)}</div>
    </div>`;

  // Ring row: the participation ring leads, with the percentage in it.
  const ringRow = ([p, i]) => `
    <div class="irow rrow${p.s === 'closed' ? ' closed' : ''}">
      <span class="lead-ring">${p.s === 'draft'
        ? '<span class="lead-draft"></span>'
        : `${ring(p.v / ELIGIBLE, 40, p.s === 'closed')}<b>${Math.round((p.v / ELIGIBLE) * 100)}</b>`}</span>
      <div class="p-main"><div class="p-title">${esc(p.t)}</div><div class="p-sub">${KINDS[p.k].label} · ${pollTime(p)}${p.s === 'draft' ? '' : ` · ${p.v} von ${ELIGIBLE}`}</div></div>
      ${p.s === 'draft' ? openBtn(i) : I.chevR}
    </div>`;

  function pollGroups(rowFn) {
    return POLL_GROUPS.map(([s, label]) => {
      const items = pollsIn(s);
      return items.length ? `<h3 class="ig-label">${label}</h3><div class="ig">${items.map(rowFn).join('')}</div>` : '';
    }).join('');
  }

  /* ───────── other sections ───────── */
  const sammeln = () => `
    <div class="tiles">${[
      ['Fotos', 'photo', 'var(--blue)', 128],
      ['Zitate', 'quote', 'var(--orange)', 46],
      ['Erinnerungen', 'sparkle', 'var(--purple)', 31],
      ['Ideen', 'bulb', 'var(--green)', 12],
    ].map(([label, icon, color, n]) => `
      <button class="tile" type="button">
        <span class="tile-icon" style="--c:${color}">${ICONS[icon]}</span>
        <span class="tile-count">${n}</span>
        <span class="tile-label">${label}</span>
      </button>`).join('')}
    </div>`;

  const verwaltung = () => `
    <div class="ig">
      <a class="irow vrow" href="#" data-dead><span class="kicon" style="--c:#8E8E93">${I.people}</span><span class="v-label">Personen</span><span class="badge-num">2</span>${I.chevR}</a>
      <a class="irow vrow" href="#" data-dead><span class="kicon" style="--c:#0088FF">${I.mail}</span><span class="v-label">E-Mail</span><span class="nav-val">34 von 100 heute</span>${I.chevR}</a>
      <a class="irow vrow" href="#" data-dead><span class="kicon" style="--c:#8E8E93">${I.clock}</span><span class="v-label">Protokoll</span>${I.chevR}</a>
    </div>`;

  const head = (title, extra = '') => `<div class="rd-head"><h2 class="section-title">${title}</h2>${extra}</div>`;
  const countLabel = () => `<span class="rd-count" id="rdCount"></span>`;

  /* ───────── layouts ───────── */
  let focusId = null;
  const root = $('rd');

  function build() {
    const sec = (id, html) => `<section class="rd-sec" id="${id}">${html}</section>`;
    if (L === 'liste') {
      root.innerHTML =
        sec('secT', head('Für dich', countLabel()) + '<div id="rdTickets"></div>') +
        sec('secP', head('Umfragen') + pollGroups(iconRow)) +
        sec('secS', head('Sammeln') + sammeln()) +
        sec('secV', head('Verwaltung') + verwaltung());
    } else if (L === 'karten') {
      root.innerHTML =
        sec('secT', head('Für dich', `<span class="shelf-nav">${countLabel()}<button class="paddle-s" type="button" data-shelf="-1" aria-label="Zurück">${I.chevL}</button><button class="paddle-s" type="button" data-shelf="1" aria-label="Weiter">${I.chevL.replace('<svg ', '<svg style="transform:scaleX(-1)" ')}</button></span>`) + '<div class="shelf" id="rdTickets"></div>') +
        sec('secP', head('Umfragen') + pollGroups(barRow)) +
        sec('secS', head('Sammeln') + sammeln()) +
        sec('secV', head('Verwaltung') + verwaltung());
    } else if (L === 'fokus') {
      root.innerHTML =
        sec('secT', head('Für dich', countLabel()) + '<div id="rdTickets"></div>') +
        sec('secP', head('Umfragen') + pollGroups(ringRow)) +
        sec('secS', head('Sammeln') + sammeln()) +
        sec('secV', head('Verwaltung') + verwaltung());
    } else {
      root.innerHTML = `
        <div class="seg" role="tablist" id="seg">
          <span class="seg-thumb"></span>
          <button type="button" role="tab" aria-selected="true" data-tab="t">Für dich</button>
          <button type="button" role="tab" aria-selected="false" data-tab="p">Umfragen</button>
        </div>
        <div class="rd-cols" data-show="t">
          ${sec('secT', head('Für dich', countLabel()) + '<div id="rdTickets" class="mini-stack"></div>')}
          ${sec('secP', head('Umfragen') + pollGroups(iconRow))}
        </div>
        <div class="rd-cols rd-cols-low">
          ${sec('secS', head('Sammeln') + sammeln())}
          ${sec('secV', head('Verwaltung') + verwaltung())}
        </div>`;
    }
  }

  function renderTickets() {
    const host = $('rdTickets');
    const list = visible();
    const open = list.filter((t) => t.state !== 'done' && t.state !== 'review-mine').length;
    $('rdCount').textContent = open ? `${open} offen` : 'Alles erledigt';
    if (L === 'liste') {
      host.innerHTML = `<div class="ig">${list.map(richRow).join('')}${allTicketsRow()}</div>`;
    } else if (L === 'karten') {
      const x = host.scrollLeft;
      host.innerHTML = list.map((t, i) => card(t, { count: `${i + 1}/${list.length}` })).join('') +
        `<a class="tcard all" href="#" data-dead><span class="all-n">${ALL_TICKETS}</span><span class="all-l">Alle Tickets</span>${I.chevR}</a>`;
      host.scrollLeft = x;
    } else if (L === 'fokus') {
      if (!list.some((t) => t.id === focusId)) focusId = (list.find((t) => action(t)) || list[0] || {}).id;
      const f = list.find((t) => t.id === focusId);
      host.innerHTML = (f ? `<div class="hero-wrap">${card(f, { hero: true })}</div>` : '') +
        `<div class="ig">${list.map((t) => compactRow(t, t.id === focusId)).join('')}${allTicketsRow()}</div>`;
    } else {
      host.innerHTML = list.map((t) => card(t, { mini: true })).join('') +
        `<div class="ig">${allTicketsRow()}</div>`;
    }
    tickets.forEach((t) => { t.just = false; });
  }

  function renderPolls() {
    const sec = $('secP');
    const rowFn = { liste: iconRow, karten: barRow, fokus: ringRow, spalten: iconRow }[L];
    sec.innerHTML = head('Umfragen') + pollGroups(rowFn);
  }

  /* ───────── events ───────── */
  document.addEventListener('click', (e) => {
    const tk = e.target.closest('[data-tick]');
    if (tk) { e.stopPropagation(); tick(Number(tk.dataset.tick)); return; }
    const op = e.target.closest('[data-open]');
    if (op) {
      const p = polls[Number(op.dataset.open)];
      const prev = { ...p };
      Object.assign(p, { s: 'open', v: 0, days: 14 });
      renderPolls();
      UI.toast(`„${p.t}“ ist offen`, 'Widerrufen', () => { Object.keys(p).forEach((k) => delete p[k]); Object.assign(p, prev); renderPolls(); });
      return;
    }
    const pick = e.target.closest('[data-pick]');
    if (pick && L === 'fokus') {
      const id = Number(pick.dataset.pick);
      if (id === focusId) return;
      focusId = id;
      renderTickets();
      const hero = document.querySelector('.hero-wrap .tcard');
      if (hero) hero.animate([{ opacity: 0, transform: 'scale(0.985)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
      return;
    }
    const sh = e.target.closest('[data-shelf]');
    if (sh) {
      const shelf = $('rdTickets');
      const c = shelf.querySelector('.tcard');
      shelf.scrollBy({ left: Number(sh.dataset.shelf) * ((c ? c.offsetWidth : 300) + 12), behavior: 'smooth' });
      return;
    }
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      document.querySelector('.rd-cols').dataset.show = tab.dataset.tab;
      $('seg').querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b === tab)));
      $('seg').classList.toggle('second', tab.dataset.tab === 'p');
      return;
    }
    if (e.target.closest('[data-dead]')) e.preventDefault();
  });

  UI.mount({
    title: 'Redaktion',
    backHref: './02-swipe-stack.html',
    newMenu: [
      { label: 'Ticket', icon: 'ticket' },
      { label: 'Umfrage', icon: 'poll' },
      { label: 'Sammlung', icon: 'folder' },
    ],
  });
  build();
  renderTickets();
})();
