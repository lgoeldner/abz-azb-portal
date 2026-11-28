'use strict';
/* Ticket cards for the Redaktion mode: the same card as a poll. The title says what to do, a short
   grouped list holds the facts (who asked and what, the goal, what happens next),
   and the one button says exactly what it does. Placeholder data mirrors the portal's ticket model
   (status todo → in_progress → review → done, reviews by the area's reviewers). */
(function () {
  const { ICONS } = window.P;
  const S = (inner, size = 20, extra = 'stroke-width="1.8"') =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" ${extra}>${inner}</svg>`;
  const I = {
    goal: S('<circle cx="12" cy="12" r="8.25"/><circle cx="12" cy="12" r="4.25"/><circle cx="12" cy="12" r=".6" fill="currentColor"/>'),
    next: S('<path d="M4.75 12h13.5M13.5 6.75 18.75 12l-5.25 5.25"/>'),
    self: S('<circle cx="12" cy="12" r="8.25"/><path d="m8.25 12.25 2.6 2.5 4.9-5.25"/>'),
    bubble: S('<path d="M12 4.75c4.56 0 8.25 2.98 8.25 6.65s-3.69 6.65-8.25 6.65c-.86 0-1.7-.1-2.48-.3L5.4 19.6l.98-3.33C4.73 15.05 3.75 13.32 3.75 11.4 3.75 7.73 7.44 4.75 12 4.75z"/>'),
    chev: S('<path d="m9.5 6 6 6-6 6"/>', 14, 'stroke-width="2.6"'),
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const PEOPLE = { lena: 'Lena Fischer', mia: 'Mia Weber', jonas: 'Jonas Hartmann', paul: 'Paul Meyer', sophie: 'Sophie Schmitt' };
  const first = (k) => PEOPLE[k].split(' ')[0];
  const initials = (k) => PEOPLE[k].split(' ').map((w) => w[0]).join('');

  // cta: the button, in words of what happens. after: where the ticket goes (for the Erledigt list).
  const T = {
    t14: {
      no: 14, title: 'Interview mit der Schulleitung überarbeiten', meta: 'Texte · Artikel, ca. 2 Seiten · mit Paul',
      from: 'lena', when: 'vor 2 Std.', said: 'Einleitung kürzen und die Zitate noch mal gegenchecken.',
      goal: 'Zwei Seiten, von Frau Albers freigegeben', next: 'Lena prüft noch einmal',
      comments: 4, cta: 'Zurück an Lena', after: { who: 'lena' },
    },
    t21: {
      no: 21, title: 'Layout Seite 12–13 prüfen', meta: 'Layout · Doppelseite Kursfahrten',
      from: 'mia', when: 'vor 5 Std.', said: 'Die Doppelseite ist fertig, die Bildrechte sind geklärt.',
      goal: 'Satzspiegel stimmt, Bildrechte geklärt', next: 'Die Seite geht in den Druck-PDF',
      comments: 2, cta: 'Freigeben', after: { approved: 'Von dir freigegeben' },
    },
    t9: {
      no: 9, title: 'Lehrerzitate sortieren', meta: 'Texte · Aufgabe',
      goal: 'Doppelte raus, dann nach Fach sortieren', next: 'Lena prüft das Ergebnis',
      comments: 0, cta: 'Zur Prüfung an Lena', after: { who: 'lena' },
    },
    t17: {
      no: 17, title: 'Rückblick Skifahrt schreiben', meta: 'Texte · Artikel, ca. 3 Seiten · mit Jonas',
      goal: 'Erster Entwurf mit Bildunterschriften', next: 'Lena prüft den Entwurf',
      comments: 6, cta: 'Zur Prüfung an Lena', after: { who: 'lena' },
    },
    t25: {
      no: 25, title: 'Fotos der Mottowoche aussortieren', meta: 'Fotos · kleine Aufgabe',
      goal: 'Pro Tag die zehn besten Fotos markieren', self: true,
      comments: 1, cta: 'Abschließen', after: { approved: 'Von dir abgeschlossen' },
    },
    // already handled by you
    t23: { no: 23, title: 'Sponsoren anschreiben', after: { who: 'sophie' } },
    t11: { no: 11, title: 'Grußwort der Schulleitung einholen', after: { approved: 'Freigegeben am 21. Nov.' } },
    t6: { no: 6, title: 'Klassenfotos benennen', after: { approved: 'Abgeschlossen am 14. Nov.' } },
  };
  const INITIAL = { open: ['t14', 't21', 't9', 't17', 't25'], done: ['t23', 't11', 't6'] };
  const ORDER = ['t14', 't21', 't9', 't17', 't25'];

  const row = (icon, label, value, extra = '') => `
    <div class="row tq-row${extra}">
      <span class="tq-ic">${icon}</span>
      <span class="tq-main"><span class="tq-label">${label}</span><span class="tq-val">${value}</span></span>
    </div>`;

  function render(id) {
    const t = T[id];
    const root = document.createElement('div');
    root.className = 'card-content q tq';
    root.dataset.id = id;
    const rows = [];
    if (t.from) rows.push(row(`<span class="av">${initials(t.from)}</span>`, `${first(t.from)} · ${t.when}`, `„${esc(t.said)}“`, ' tq-said'));
    rows.push(row(I.goal, 'Ziel', esc(t.goal)));
    rows.push(t.self
      ? row(I.self, 'Danach', 'Kleine Aufgabe: du schließt sie selbst ab')
      : row(I.next, 'Danach', esc(t.next)));
    rows.push(`
      <button type="button" class="row tq-row tq-link no-drag" data-ticket-more="${id}">
        <span class="tq-ic">${I.bubble}</span>
        <span class="tq-main tq-one">${t.comments ? 'Kommentare und Verlauf' : 'Verlauf'}</span>
        ${t.comments ? `<span class="tq-n">${t.comments}</span>` : ''}${I.chev}
      </button>`);
    root.innerHTML = `
      <header class="q-head">
        <span class="q-count"></span>
        <h3 class="q-title">${esc(t.title)}</h3>
        <p class="q-meta">${esc(t.meta)}</p>
      </header>
      <div class="q-body"><div class="grp tq-list"><div class="scroll-fade">${rows.join('')}</div></div></div>
      <footer class="q-foot">
        <span class="q-due-foot">Ticket #${t.no}</span>
        <button type="button" class="card-cta">${t.cta}</button>
      </footer>`;
    const sf = root.querySelector('.scroll-fade');
    sf._fade = window.P.scrollFade(sf);
    return root;
  }

  // The Erledigt list: tickets you handed on (and can take back) and tickets that are finished.
  function groups(done, takeBack) {
    const waiting = done.filter((id) => T[id].after.who);
    const finished = done.filter((id) => !T[id].after.who);
    return [
      { label: 'Liegt bei anderen', rows: waiting.map((id) => ({ id, icon: 'clock', title: T[id].title, detail: `Bei ${first(T[id].after.who)} zur Prüfung`, action: takeBack && { label: 'Zurückholen', fn: takeBack } })) },
      { label: 'Abgeschlossen', rows: finished.map((id) => ({ id, icon: 'check', title: T[id].title, detail: T[id].after.approved })) },
    ];
  }

  window.Tickets = { T, INITIAL, ORDER, render, groups, label: (id) => T[id].title };
})();
