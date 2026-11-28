'use strict';
/* Redaktion mode, everything below the ticket deck: all polls in one list (finished at the top,
   running at the bottom, x/y participation, results in a modal), drafts on their own page,
   contributions, and the admin tools. Placeholder data only. */
(function () {
  const { ICONS, UI } = window.P;
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
    board: S('<rect x="3.75" y="4.75" width="16.5" height="14.5" rx="2.5"/><path d="M9.25 4.75v14.5M14.75 4.75v14.5"/>', 22, 'stroke-width="1.8"'),
    plus: S('<path d="M12 5.5v13M5.5 12h13"/>', 15, 'stroke-width="2.4"'),
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const ELIGIBLE = 26;
  const KINDS = {
    person: { label: 'Personenwahl', icon: I.person },
    proposal: { label: 'Vorschlagswahl', icon: I.list },
    words: { label: 'Wortwolke', icon: I.words },
  };
  // end: days from today (negative = ended). Ordered by end date: finished first, running last.
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

  function draftModal(d, i, onPublished) {
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
      onPublished();
      UI.toast(`„${gone.t}“ ist jetzt für alle sichtbar.`);
    });
    return root;
  }

  const tiles = () => `
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

  // Everything below the deck. draftsHref: the drafts page (with a way back to this mode).
  function sectionsHTML(draftsHref) {
    return `
      <div class="ig after-deck">${navRow(I.board, 'Alle Tickets', '<span class="nav-val">23</span>')}</div>
      <section class="rd-sec">
        <div class="rd-head"><h2 class="section-title">Umfragen</h2>
          <button class="small-btn head-btn" type="button" data-new>${I.plus}Neue Umfrage</button></div>
        <div class="ig">${POLLS.map(pollRow).join('')}</div>
        <div class="ig after-list">${navRow(I.draft, 'Entwürfe', `<span class="nav-val">${DRAFTS.length}</span>`, draftsHref)}</div>
      </section>
      <section class="rd-sec">
        <div class="rd-head"><h2 class="section-title">Beiträge</h2></div>
        ${tiles()}
      </section>
      <section class="rd-sec">
        <div class="rd-head"><h2 class="section-title">Verwaltung</h2></div>
        <div class="ig">
          ${navRow(I.people, 'Personen', '<span class="nav-val">2 warten auf Freigabe</span>')}
          ${navRow(I.mail, 'E-Mail', '<span class="nav-val">34 von 100 heute</span>')}
          ${navRow(I.log, 'Protokoll', '')}
        </div>
      </section>`;
  }

  function renderDrafts(host) {
    host.innerHTML = DRAFTS.length
      ? `<section class="rd-sec"><div class="ig">${DRAFTS.map((d, i) => `
          <button class="irow prow" type="button" data-draft="${i}">
            <span class="picon">${KINDS[d.k].icon}</span>
            <span class="p-main"><span class="p-title">${esc(d.t)}</span><span class="p-sub">${KINDS[d.k].label} · bearbeitet ${d.edited}</span></span>
            ${I.chevR}
          </button>`).join('')}</div>
          <p class="rd-foot">Entwürfe sieht nur die Redaktion. Tippe einen an, um ihn anzusehen und zu veröffentlichen.</p></section>`
      : '<section class="rd-sec"><p class="rd-foot">Keine Entwürfe.</p></section>';
  }

  // One delegated handler for both the mode and the drafts page.
  function wire(draftsHost) {
    document.addEventListener('click', (e) => {
      const pr = e.target.closest('[data-poll]');
      if (pr) { UI.showModal(resultsModal(POLLS[Number(pr.dataset.poll)])); return; }
      const dr = e.target.closest('[data-draft]');
      if (dr) { const i = Number(dr.dataset.draft); UI.showModal(draftModal(DRAFTS[i], i, () => renderDrafts(draftsHost))); return; }
      if (e.target.closest('[data-new]')) { UI.toast('Hier öffnet sich eine neue, leere Umfrage.'); return; }
      if (e.target.closest('[data-ticket-more]')) { UI.toast('Hier öffnet sich das Ticket mit Kommentaren und Verlauf.'); return; }
      if (e.target.closest('[data-dead]')) e.preventDefault();
    });
  }

  window.Redaktion = { sectionsHTML, renderDrafts, wire };
})();
