'use strict';
/* Redaktion page (draft). "Für dich" is a carousel of plain instructions: each card says what to do,
   why, and what happens when you press the button. Umfragen is one list ordered by end date (finished
   at the top, running at the bottom) with drafts on their own page (?seite=entwuerfe).
   The bar can be tried in three versions (?leiste=abgegeben|suche|profil). Placeholder data only. */
(function () {
  const { $, ICONS, UI, Carousel } = window.P;
  const params = new URLSearchParams(location.search);
  const PAGE = params.get('seite') === 'entwuerfe' ? 'entwuerfe' : 'start';
  const BAR = ['abgegeben', 'suche', 'profil'].includes(params.get('leiste')) ? params.get('leiste') : 'abgegeben';
  const link = (extra = {}) => {
    const u = new URLSearchParams();
    if (BAR !== 'abgegeben') u.set('leiste', BAR);
    Object.entries(extra).forEach(([k, v]) => u.set(k, v));
    const q = u.toString();
    return './03-redaktion.html' + (q ? '?' + q : '');
  };

  const S = (inner, size, extra = '') =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" ${extra}>${inner}</svg>`;
  const I = {
    chevR: S('<path d="m9.5 6 6 6-6 6"/>', 14, 'stroke-width="2.6"'),
    person: S('<circle cx="12" cy="8" r="3.75"/><path d="M5 19.5c.9-3.4 3.6-5.25 7-5.25s6.1 1.85 7 5.25"/>', 22, 'stroke-width="1.8"'),
    list: S('<path d="M9.5 7h10M9.5 12h10M9.5 17h10"/><circle cx="5" cy="7" r=".9" fill="currentColor"/><circle cx="5" cy="12" r=".9" fill="currentColor"/><circle cx="5" cy="17" r=".9" fill="currentColor"/>', 22, 'stroke-width="1.8"'),
    words: S('<path d="M4.5 18.5 9 5.5l4.5 13M6.2 13.8h5.6"/><path d="M15.5 18.5V11M15.5 14.5c0-2 1.3-3.5 3-3.5"/>', 22, 'stroke-width="1.8"'),
    people: S('<circle cx="9" cy="8.5" r="3.25"/><path d="M3 18.75c.8-3 3.1-4.6 6-4.6s5.2 1.6 6 4.6"/><path d="M15.5 5.6a3 3 0 0 1 0 5.8M17.5 14.4c1.7.5 3 1.9 3.5 4.1"/>', 22, 'stroke-width="1.8"'),
    mail: S('<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4.5 7.5 7.5 5.5 7.5-5.5"/>', 22, 'stroke-width="1.8"'),
    log: S('<circle cx="12" cy="12" r="8.25"/><path d="M12 7.5V12l3 1.8"/>', 22, 'stroke-width="1.8"'),
    draft: S('<path d="M14.5 5.5 18.5 9.5M4.5 19.5l1-4.2L15.8 5a1.9 1.9 0 0 1 2.7 0l.5.5a1.9 1.9 0 0 1 0 2.7L8.7 18.5z"/>', 22, 'stroke-width="1.8"'),
    plus: S('<path d="M12 5.5v13M5.5 12h13"/>', 15, 'stroke-width="2.4"'),
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ───────── placeholder data ───────── */
  const PEOPLE = { lena: 'Lena Fischer', mia: 'Mia Weber', jonas: 'Jonas Hartmann', paul: 'Paul Meyer', sophie: 'Sophie Schmitt' };
  const first = (k) => PEOPLE[k].split(' ')[0];
  const initials = (k) => PEOPLE[k].split(' ').map((w) => w[0]).join('');
  const ALL_TICKETS = 23;

  // What each open ticket asks of you, in words: what to do, why, and what the button does.
  const TODOS = [
    {
      id: 't14', title: 'Interview mit der Schulleitung überarbeiten', meta: 'Texte · Artikel, ca. 2 Seiten',
      from: 'lena', say: 'wünscht sich Änderungen', when: 'vor 2 Std.', text: 'Einleitung kürzen und die Zitate noch mal gegenchecken.',
      next: 'Wenn du fertig bist, geht der Text wieder an Lena.', cta: 'Überarbeitet', toast: 'Der Text ist wieder bei Lena.', passTo: 'lena',
    },
    {
      id: 't21', title: 'Layout Seite 12–13 prüfen', meta: 'Layout · Doppelseite Kursfahrten',
      from: 'mia', say: 'bittet dich um Freigabe', when: 'vor 5 Std.', text: 'Die Doppelseite ist fertig, die Bildrechte sind geklärt.',
      next: 'Passt alles, gibst du sie frei. Wenn nicht, schreib Mia, was fehlt.', cta: 'Freigeben', alt: 'Änderungen wünschen', toast: 'Du hast die Doppelseite freigegeben.',
    },
    {
      id: 't9', title: 'Lehrerzitate sortieren', meta: 'Texte · Aufgabe',
      goal: 'Doppelte raus, dann nach Fach sortieren.',
      next: 'Wenn du fertig bist, prüft Lena das Ergebnis.', cta: 'Fertig', toast: 'Lena prüft jetzt die Lehrerzitate.', passTo: 'lena',
    },
    {
      id: 't17', title: 'Rückblick Skifahrt schreiben', meta: 'Texte · Artikel, ca. 3 Seiten', with: 'jonas',
      goal: 'Ein erster Entwurf mit Bildunterschriften.',
      next: 'Du schreibst ihn zusammen mit Jonas. Danach prüft Lena.', cta: 'Fertig', toast: 'Lena prüft jetzt den Rückblick.', passTo: 'lena',
    },
    {
      id: 't25', title: 'Fotos der Mottowoche aussortieren', meta: 'Fotos · kleine Aufgabe',
      goal: 'Pro Tag die zehn besten Fotos markieren.',
      next: 'Kleine Aufgabe: du kannst sie selbst abschließen.', cta: 'Erledigt', toast: 'Fotos aussortiert und abgeschlossen.',
    },
  ];
  const byId = (id) => TODOS.find((t) => t.id === id);

  const ELIGIBLE = 26;
  const KINDS = {
    person: { label: 'Personenwahl', icon: I.person },
    proposal: { label: 'Vorschlagswahl', icon: I.list },
    words: { label: 'Wortwolke', icon: I.words },
  };
  // end: days from today (negative = ended). results: [answer, votes]; for people and words the top entries.
  const POLLS = [
    { t: 'Ziel der Abifahrt', k: 'proposal', end: -41, date: '18. Okt.', v: 26, results: [['Mallorca', 14], ['Prag', 7], ['Amsterdam', 5]] },
    { t: 'Beste Erinnerung aus der 11. Klasse', k: 'proposal', end: -25, date: '3. Nov.', v: 24, results: [['Skifahrt im Februar', 15], ['Sommerfest auf dem Pausenhof', 9]] },
    { t: 'Lieblingstag der Mottowoche', k: 'proposal', end: -16, date: '12. Nov.', v: 26, results: [['Zeitreise 2000er', 11], ['Kindheitshelden', 8], ['Erster Schultag', 5], ['Alles außer Rucksack', 2]] },
    { t: 'Wer wird zuerst berühmt?', k: 'person', end: 1, v: 25, results: [['Ben Hoffmann', 7], ['Carla Schulz', 5], ['Noah Klein', 4], ['Weitere', 9]] },
    { t: 'Was darf auf der Abifeier nicht fehlen?', k: 'proposal', end: 5, v: 23, multi: true, results: [['Fotobox', 17], ['Live-Band', 12], ['Candybar', 10], ['Lehrer-Karaoke', 7]] },
    { t: 'Bester Ort in der Freistunde', k: 'proposal', end: 6, v: 9, results: [['Bäcker an der Ecke', 4], ['Oberstufenraum', 3], ['Pausenhof in der Sonne', 1], ['Bibliothek (angeblich lernen)', 1]] },
    { t: 'Unser Abimotto', k: 'proposal', end: 10, v: 18, results: [['Abizeitbetrug – 13 Jahre abgesessen', 9], ['ABIversal – ein Jahrgang, viele Welten', 6], ['Abikalypse – wir sind raus', 3]] },
    { t: 'Wer hat immer einen guten Spruch?', k: 'person', end: 14, v: 21, multi: true, results: [['Paul Meyer', 9], ['Mia Weber', 8], ['Luis Wolf', 6], ['Weitere', 19]] },
    { t: 'Unser Jahrgang in 3 Wörtern', k: 'words', end: 18, v: 12, multi: true, results: [['laut', 6], ['chaotisch', 5], ['legendär', 4], ['müde', 3]] },
  ];
  const DRAFTS = [
    { t: 'Lieblingslehrer:in', k: 'person', edited: 'vor 3 Tagen', rule: 'Eine Person', options: ['Alle Lehrkräfte der Oberstufe'] },
    { t: 'Song für den Einzug beim Abiball', k: 'proposal', edited: 'gestern', rule: 'Eine Antwort', options: ['Mr. Brightside', 'Don’t Stop Me Now', 'Wonderwall', 'Atemlos'] },
  ];

  /* ───────── Für dich: one card per thing to do ───────── */
  function todoCard(id) {
    const t = byId(id);
    const root = document.createElement('div');
    root.className = 'card-content q tq';
    root.innerHTML = `
      <header class="q-head">
        <h3 class="q-title">${esc(t.title)}</h3>
        <p class="q-meta">${esc(t.meta)}</p>
      </header>
      <div class="q-body">
        <div class="grp tq-box">
          ${t.from
            ? `<div class="tq-from"><span class="av">${initials(t.from)}</span><span class="tq-who"><b>${first(t.from)}</b> ${t.say}</span><span class="tq-when">${t.when}</span></div>
               <p class="tq-text">„${esc(t.text)}“</p>`
            : `<div class="tq-from"><span class="tq-who"><b>Ziel</b></span>${t.with ? `<span class="tq-when">mit ${first(t.with)}</span>` : ''}</div>
               <p class="tq-text">${esc(t.goal)}</p>`}
        </div>
        <p class="tq-next">${esc(t.next)}</p>
      </div>
      <footer class="q-foot">
        <button type="button" class="tq-alt" data-alt>${t.alt || 'Details'}</button>
        <button type="button" class="card-cta">${t.cta}</button>
      </footer>`;
    root.querySelector('.card-cta').addEventListener('click', (e) => { e.stopPropagation(); finish(id); });
    root.querySelector('[data-alt]').addEventListener('click', (e) => {
      e.stopPropagation();
      UI.toast(t.alt ? 'Hier öffnet sich das Ticket, um Mia zu schreiben.' : 'Hier öffnet sich das Ticket mit Verlauf und Kommentaren.');
    });
    return root;
  }

  let car = null;
  const waiting = [{ title: 'Sponsoren anschreiben', who: 'sophie' }];
  function finish(id) {
    const t = byId(id);
    const at = car.ids().indexOf(id);
    if (!car.leave(id, 'fade')) return;
    if (t.passTo) waiting.push({ title: t.title, who: t.passTo });
    updateCounts();
    UI.toast(t.toast, 'Widerrufen', () => {
      if (t.passTo) waiting.splice(waiting.findIndex((w) => w.title === t.title), 1);
      car.insert(id, at);
      updateCounts();
    });
  }

  function updateCounts() {
    const n = car.ids().length;
    $('todoCount').textContent = n === 0 ? 'Nichts zu tun' : n === 1 ? '1 Aufgabe' : `${n} Aufgaben`;
    $('waitSub').textContent = waiting.length === 1
      ? `„${waiting[0].title}“ liegt gerade bei ${first(waiting[0].who)}.`
      : `${waiting.length} deiner Tickets liegen gerade bei anderen.`;
  }

  /* ───────── Umfragen ───────── */
  const leader = (p) => {
    const top = p.results.filter(([a]) => a !== 'Weitere')[0];
    return `${p.end < 0 ? 'Gewonnen' : 'Vorne'}: ${p.k === 'words' ? `„${top[0]}“` : top[0]}`;
  };
  const when = (p) => (p.end < 0 ? `Beendet am ${p.date}` : p.end === 0 ? 'Endet heute' : p.end === 1 ? 'Endet morgen' : `Noch ${p.end} Tage`);

  const pollRow = (p, i) => `
    <button class="irow prow" type="button" data-poll="${i}">
      <span class="picon">${KINDS[p.k].icon}</span>
      <span class="p-main">
        <span class="p-title">${esc(p.t)}</span>
        <span class="p-sub">${when(p)} · ${esc(leader(p))}</span>
      </span>
      <span class="p-num" aria-label="${p.v} von ${ELIGIBLE} haben abgestimmt">${p.v}/${ELIGIBLE}</span>${I.chevR}
    </button>`;

  function resultsModal(p) {
    const root = document.createElement('div');
    root.className = 'card-content q';
    const total = p.results.reduce((a, [, n]) => a + n, 0);
    root.innerHTML = `
      <header class="q-head">
        <button type="button" class="q-close" data-modal-close aria-label="Schließen">${ICONS.xmark}</button>
        <h3 class="q-title">${esc(p.t)}</h3>
        <p class="q-meta">${p.v} von ${ELIGIBLE} haben abgestimmt · ${when(p)}</p>
      </header>
      <div class="q-body">
        <div class="grp res">${p.results.map(([a, n]) => `
          <div class="row res-row"><span class="res-label">${esc(p.k === 'words' ? `„${a}“` : a)}</span><span class="res-n">${n}</span></div>`).join('')}
        </div>
        <p class="res-note">${p.multi ? 'Mehrere Antworten pro Person. ' : ''}${total} Stimmen insgesamt. Die Ergebnisse sieht nur die Redaktion.</p>
      </div>`;
    return root;
  }

  function draftModal(d, i) {
    const root = document.createElement('div');
    root.className = 'card-content q';
    root.innerHTML = `
      <header class="q-head">
        <button type="button" class="q-close" data-modal-close aria-label="Schließen">${ICONS.xmark}</button>
        <h3 class="q-title">${esc(d.t)}</h3>
        <p class="q-meta">${KINDS[d.k].label} · ${d.rule}</p>
      </header>
      <div class="q-body">
        <div class="grp res">${d.options.map((o) => `<div class="row res-row"><span class="res-label">${esc(o)}</span></div>`).join('')}</div>
        <p class="res-note">So sieht die Frage für den Jahrgang aus. Nach dem Veröffentlichen lässt sie sich nicht mehr ändern, nur noch das Enddatum.</p>
      </div>
      <footer class="q-foot">
        <button type="button" class="tq-alt" data-edit>Bearbeiten</button>
        <button type="button" class="card-cta" data-publish>Veröffentlichen</button>
      </footer>`;
    root.querySelector('[data-edit]').addEventListener('click', () => UI.toast('Hier öffnet sich der Editor für die Frage.'));
    root.querySelector('[data-publish]').addEventListener('click', () => {
      UI.closeModal();
      const [gone] = DRAFTS.splice(i, 1);
      renderDrafts();
      UI.toast(`„${gone.t}“ ist jetzt für alle sichtbar.`);
    });
    return root;
  }

  /* ───────── page ───────── */
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

  const navRow = (icon, label, value, href = '#') => `
    <a class="irow vrow" href="${href}"${href === '#' ? ' data-dead' : ''}><span class="picon">${icon}</span><span class="v-label">${label}</span>${value}${I.chevR}</a>`;

  function renderStart() {
    $('rd').innerHTML = `
      <section class="rd-sec">
        <div class="rd-head"><h2 class="section-title">Für dich</h2><span class="rd-count" id="todoCount"></span></div>
        <div id="todos" class="todos"></div>
        <div class="ig after-car">
          <a class="irow vrow" href="#" data-dead>
            <span class="p-main"><span class="v-label">Alle Tickets</span><span class="p-sub" id="waitSub"></span></span>
            <span class="nav-val">${ALL_TICKETS}</span>${I.chevR}
          </a>
        </div>
      </section>
      <section class="rd-sec">
        <div class="rd-head"><h2 class="section-title">Umfragen</h2>
          <button class="small-btn head-btn" type="button" data-new>${I.plus}Neue Umfrage</button></div>
        <div class="ig" id="pollList">${POLLS.map(pollRow).join('')}</div>
        <p class="rd-foot" id="pollNone" hidden>Keine Umfrage gefunden.</p>
        <div class="ig after-list">${navRow(I.draft, 'Entwürfe', `<span class="nav-val">${DRAFTS.length}</span>`, link({ seite: 'entwuerfe' }))}</div>
      </section>
      <section class="rd-sec">
        <div class="rd-head"><h2 class="section-title">Sammeln</h2></div>
        ${sammeln()}
      </section>
      <section class="rd-sec">
        <div class="rd-head"><h2 class="section-title">Verwaltung</h2></div>
        <div class="ig">
          ${navRow(I.people, 'Personen', '<span class="nav-val">2 warten auf Freigabe</span>')}
          ${navRow(I.mail, 'E-Mail', '<span class="nav-val">34 von 100 heute</span>')}
          ${navRow(I.log, 'Protokoll', '')}
        </div>
      </section>`;

    car = Carousel($('todos'), {
      ids: TODOS.map((t) => t.id),
      render: todoCard,
      label: (id) => byId(id).title,
      emptyHTML: () => `<div class="empty-icon">${ICONS.check.replace('width="24" height="24"', 'width="30" height="30"')}</div><div class="empty-title">Nichts zu tun</div><div class="empty-sub">Sobald dir jemand etwas zuweist oder um Freigabe bittet, steht es hier.</div>`,
    });
    updateCounts();
  }

  function renderDrafts() {
    $('rd').innerHTML = DRAFTS.length
      ? `<section class="rd-sec"><div class="ig">${DRAFTS.map((d, i) => `
          <button class="irow prow" type="button" data-draft="${i}">
            <span class="picon">${KINDS[d.k].icon}</span>
            <span class="p-main"><span class="p-title">${esc(d.t)}</span><span class="p-sub">${KINDS[d.k].label} · bearbeitet ${d.edited}</span></span>
            ${I.chevR}
          </button>`).join('')}</div>
          <p class="rd-foot">Entwürfe sieht nur die Redaktion. Tippe einen an, um ihn anzusehen und zu veröffentlichen.</p></section>`
      : '<section class="rd-sec"><p class="rd-foot">Keine Entwürfe.</p></section>';
  }

  function search(qs) {
    const list = $('pollList');
    if (!list) return;
    const q = qs.trim().toLocaleLowerCase('de');
    let shown = 0;
    list.querySelectorAll('.prow').forEach((r) => {
      const hit = !q || POLLS[Number(r.dataset.poll)].t.toLocaleLowerCase('de').includes(q);
      r.hidden = !hit;
      if (hit) shown++;
    });
    list.hidden = shown === 0;
    $('pollNone').hidden = shown !== 0;
  }

  document.addEventListener('click', (e) => {
    const pr = e.target.closest('[data-poll]');
    if (pr) { UI.showModal(resultsModal(POLLS[Number(pr.dataset.poll)])); return; }
    const dr = e.target.closest('[data-draft]');
    if (dr) { const i = Number(dr.dataset.draft); UI.showModal(draftModal(DRAFTS[i], i)); return; }
    if (e.target.closest('[data-new]')) { UI.toast('Hier öffnet sich eine neue, leere Umfrage.'); return; }
    if (e.target.closest('[data-dead]')) e.preventDefault();
  });
  document.addEventListener('keydown', (e) => {
    if (!car || UI.overlayOpen() || e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowRight') car.nudge(1);
    else if (e.key === 'ArrowLeft') car.nudge(-1);
  });

  // Bar: the same Abgegeben capsule as on the home screen, a search field, or just the account button.
  const C = window.Cards;
  const lists = { done: [...C.INITIAL.done], closed: [...C.INITIAL.closed] };
  let steckbriefDone = false;
  const snapshot = () => ({ open: C.INITIAL.open.length, done: lists.done.length, closed: lists.closed.length, steckbriefDone });
  document.querySelector('.large-title').textContent = PAGE === 'entwuerfe' ? 'Entwürfe' : 'Redaktion';
  document.title = PAGE === 'entwuerfe' ? '03 · Entwürfe' : '03 · Redaktion';
  UI.mount({
    title: PAGE === 'entwuerfe' ? 'Entwürfe' : 'Redaktion',
    backHref: PAGE === 'entwuerfe' ? link() : './02-swipe-stack.html',
    capsule: BAR === 'suche' ? 'suche' : BAR === 'profil' ? 'none' : undefined,
    searchPlaceholder: 'Umfragen suchen',
    onSearch: search,
    getLists: () => lists,
    describe: C.describe,
    onSteckbrief: () => { steckbriefDone = !steckbriefDone; UI.update(snapshot()); },
  });
  if (BAR === 'abgegeben') UI.update(snapshot());
  if (PAGE === 'entwuerfe') renderDrafts(); else renderStart();
})();
