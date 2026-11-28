'use strict';
/* Poll card content shared by both prototypes: proposal (single/multi), person pick, words. */
(function () {
  const { ICONS, gesture, scrollFade } = window.P;

  const COHORT = [
    'Aaliyah Becker', 'Ben Hoffmann', 'Carla Schulz', 'David Neumann', 'Elif Yılmaz', 'Emma Wagner',
    'Felix Braun', 'Finn Krüger', 'Greta Vogel', 'Hannah Zimmermann', 'Jonas Hartmann', 'Julia Koch',
    'Lara Richter', 'Leon Fischer', 'Lina Schäfer', 'Luis Wolf', 'Marie Lange', 'Mats Schröder',
    'Mia Weber', 'Nele Jung', 'Noah Klein', 'Paul Meyer', 'Sophie Schmitt', 'Tim Bauer',
    'Yusuf Demir', 'Zoe Lehmann',
  ];

  const POLLS = {
    motto: {
      title: 'Unser Abimotto', kind: 'proposal', max: 1, days: 10,
      options: ['Abizeitbetrug – 13 Jahre abgesessen', 'ABIversal – ein Jahrgang, viele Welten', 'Abikalypse – wir sind raus'],
    },
    spruch: { title: 'Wer hat immer einen guten Spruch?', kind: 'person', max: 2, days: 14 },
    woerter: { title: 'Unser Jahrgang in 3 Wörtern', kind: 'words', max: 3, days: 18 },
    abifeier: {
      title: 'Was darf auf der Abifeier nicht fehlen?', kind: 'proposal', max: 2, days: 5,
      options: ['Fotobox', 'Live-Band', 'Candybar', 'Lehrer-Karaoke'],
    },
    freistunde: {
      title: 'Bester Ort in der Freistunde', kind: 'proposal', max: 1, days: 6,
      options: ['Bäcker an der Ecke', 'Oberstufenraum', 'Bibliothek (angeblich lernen)', 'Pausenhof in der Sonne'],
    },
    beruehmt: { title: 'Wer wird zuerst berühmt?', kind: 'person', max: 1, days: 2 },
    mottowoche: {
      title: 'Lieblingstag der Mottowoche', kind: 'proposal', max: 1, days: 8,
      options: ['Kindheitshelden', 'Erster Schultag', 'Zeitreise 2000er', 'Alles außer Rucksack'],
    },
    klasse11: {
      title: 'Beste Erinnerung aus der 11. Klasse', kind: 'proposal', max: 1, days: -2,
      options: ['Sommerfest auf dem Pausenhof', 'Skifahrt im Februar'],
    },
  };

  const INITIAL = {
    open: ['motto', 'spruch', 'woerter', 'abifeier', 'freistunde', 'beruehmt'],
    done: ['mottowoche'],
    closed: ['klasse11'],
    answers: { mottowoche: [2], klasse11: [1] },
  };

  let answers = {};
  const resetAnswers = () => { answers = JSON.parse(JSON.stringify(INITIAL.answers)); };
  resetAnswers();
  const get = (id) => answers[id] || (answers[id] = POLLS[id].kind === 'words' ? Array(POLLS[id].max).fill('') : []);

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const initials = (n) => n.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  const ORD = ['Erstes', 'Zweites', 'Drittes', 'Viertes', 'Fünftes'];

  function isValid(id) {
    const a = get(id);
    return POLLS[id].kind === 'words' ? a.some((w) => w.trim()) : a.length > 0;
  }

  function summary(id) {
    const p = POLLS[id], a = get(id);
    if (p.kind === 'proposal') return a.map((i) => p.options[i]).join(', ');
    if (p.kind === 'person') return a.join(', ');
    return a.filter((w) => w.trim()).join(' · ');
  }

  function ruleText(p, a) {
    if (p.kind === 'words') {
      const n = a.filter((w) => w.trim()).length;
      return n ? `${n} von ${p.max} Wörtern` : `Bis zu ${p.max} Wörter`;
    }
    if (p.max > 1 && a.length) return `${a.length} von ${p.max} gewählt`;
    if (p.kind === 'person') return p.max === 1 ? 'Eine Person' : `Bis zu ${p.max} Personen`;
    return p.max === 1 ? 'Eine Antwort' : `Bis zu ${p.max} Antworten`;
  }

  function dueText(p) {
    if (p.days < 0) return 'Beendet';
    if (p.days === 0) return 'Endet heute';
    if (p.days === 1) return 'Endet morgen';
    return `Noch ${p.days} Tage`;
  }

  const personRow = (n, on) => `
          <button type="button" class="row pp${on ? ' on' : ''}" data-name="${esc(n)}" aria-pressed="${on}">
            <span class="av">${esc(initials(n))}</span><span class="pp-name">${esc(n)}</span><span class="tick">${ICONS.checkSmall}</span>
          </button>`;

  function bodyHtml(p) {
    if (p.kind === 'proposal') {
      return `<div class="opts grp"><div class="scroll-fade">${p.options.map((o, i) => `
        <button type="button" class="row opt" data-i="${i}" aria-pressed="false">
          <span class="tick">${ICONS.checkSmall}</span>
          <span class="opt-label">${esc(o)}</span>
          <kbd class="opt-key">${i + 1}</kbd>
        </button>`).join('')}</div></div>`;
    }
    if (p.kind === 'person') {
      return `<div class="ppl">
        <label class="search">${ICONS.search}<input type="search" placeholder="Suchen" autocomplete="off" spellcheck="false" enterkeyhint="search" aria-label="Personen suchen" /></label>
        <div class="ppl-picked" aria-label="Ausgewählt"><div class="grp"></div></div>
        <div class="ppl-list grp"><div class="scroll-fade">${COHORT.map((n) => personRow(n, false)).join('')}
          <div class="ppl-empty">Niemand gefunden</div>
        </div></div>
      </div>`;
    }
    return `<div class="words grp">${Array.from({ length: p.max }, (_, i) => `
      <label class="row w-row">
        <span class="w-num" data-n="${i + 1}"><span>${i + 1}</span></span>
        <input class="w-in" data-i="${i}" placeholder="${ORD[i] || ''} Wort" maxlength="32" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="${i < p.max - 1 ? 'next' : 'done'}" />
      </label>`).join('')}</div>`;
  }

  // Normalised answer, to tell whether an edit changed anything.
  function answerKey(id) {
    const p = POLLS[id], a = get(id);
    if (p.kind === 'words') return JSON.stringify(a.map((w) => w.trim()));
    return JSON.stringify([...a].sort());
  }
  const snapshot = (id) => JSON.stringify(get(id));
  const restore = (id, snap) => { answers[id] = JSON.parse(snap); };

  // opts.edit: the card is shown in the "Ändern" modal (close button instead of the count, "Sichern").
  function render(id, opts = {}) {
    const p = POLLS[id];
    const root = document.createElement('div');
    root.className = `card-content q q-${p.kind}`;
    const soon = p.days >= 0 && p.days <= 3 ? ' soon' : '';
    root.dataset.id = id;
    root.innerHTML = `
      <header class="q-head">
        ${opts.edit ? `<button type="button" class="q-close no-drag" aria-label="Abbrechen">${ICONS.xmark}</button>` : '<span class="q-count"></span>'}
        <h3 class="q-title">${esc(p.title)}</h3>
        <p class="q-meta"><span class="q-rule"></span><span class="q-sep">·</span><span class="q-due${soon}">${dueText(p)}</span></p>
      </header>
      <div class="q-body">${bodyHtml(p)}</div>
      <footer class="q-foot">
        <span class="q-due-foot${soon}">${ICONS.clock}${dueText(p)}</span>
        <button type="button" class="card-cta">${opts.edit ? 'Sichern' : 'Abgeben'}</button>
      </footer>`;
    if (window.Theme && Theme.decorateCard) Theme.decorateCard(root, id, p);
    root._initial = opts.edit ? answerKey(id) : null;
    wire(root, id);
    update(root, id);
    root.querySelectorAll('.scroll-fade').forEach((el) => { el._fade = scrollFade(el); });
    root._ready = true;
    return root;
  }

  function nope(el) {
    el.classList.remove('nope');
    void el.offsetWidth;
    el.classList.add('nope');
  }

  // Returns false when the tap would exceed max_choices.
  function toggle(id, v) {
    const p = POLLS[id], a = get(id);
    const k = a.indexOf(v);
    if (k >= 0) a.splice(k, 1);
    else if (p.max === 1) { a.length = 0; a.push(v); }
    else if (a.length < p.max) a.push(v);
    else return false;
    return true;
  }

  function wire(root, id) {
    const p = POLLS[id];
    root.addEventListener('click', (e) => {
      if (gesture.moved) return;
      const hit = e.target.closest('.opt, .pp');
      if (!hit) return;
      const v = hit.classList.contains('opt') ? Number(hit.dataset.i) : hit.dataset.name;
      if (!toggle(id, v)) nope(hit);
      update(root, id);
    });

    if (p.kind === 'person') {
      const input = root.querySelector('.search input');
      const list = root.querySelector('.ppl-list');
      input.addEventListener('input', () => {
        const q = input.value.trim().toLocaleLowerCase('de');
        let shown = 0;
        list.querySelectorAll('.pp').forEach((row) => {
          const match = !q || row.dataset.name.toLocaleLowerCase('de').includes(q);
          row.classList.toggle('nomatch', !match);
          applyVis(row);
          if (!row.hidden) shown++;
        });
        markFirst(list);
        list.classList.toggle('none', shown === 0);
        const sc = list.querySelector('.scroll-fade');
        sc.scrollTop = 0;
        if (sc._fade) sc._fade();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') input.blur();
        if (e.key === 'Enter') {
          e.preventDefault();
          const first = list.querySelector('.pp:not([hidden])');
          if (first) first.click();
        }
      });
    }

    if (p.kind === 'words') {
      const inputs = [...root.querySelectorAll('.w-in')];
      const a = get(id);
      inputs.forEach((inp, i) => {
        inp.addEventListener('input', () => {
          // One word per field: a space or comma moves on to the next field.
          const parts = inp.value.split(/[\s,;]+/);
          if (parts.length > 1) {
            inp.value = parts[0];
            const rest = parts.slice(1).join('');
            const next = inputs[i + 1];
            if (next) { if (rest && !next.value) next.value = rest; next.focus(); a[i + 1] = next.value.trim(); }
          }
          a[i] = inp.value.trim();
          update(root, id);
        });
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); inputs[i + 1] ? inputs[i + 1].focus() : inp.blur(); }
          else if (e.key === 'Backspace' && !inp.value && inputs[i - 1]) { e.preventDefault(); inputs[i - 1].focus(); }
          else if (e.key === 'Escape') inp.blur();
        });
      });
    }
  }

  function update(root, id) {
    const p = POLLS[id], a = get(id);
    root.querySelector('.q-rule').textContent = ruleText(p, a);
    const unchanged = root._initial != null && answerKey(id) === root._initial;
    root.querySelector('.card-cta').classList.toggle('off', !isValid(id) || unchanged);
    const full = p.max > 1 && a.length >= p.max;

    if (p.kind === 'proposal') {
      root.querySelectorAll('.opt').forEach((o) => {
        const on = a.includes(Number(o.dataset.i));
        o.classList.toggle('on', on);
        o.classList.toggle('dim', !on && full);
        o.setAttribute('aria-pressed', String(on));
      });
    } else if (p.kind === 'person') {
      root.querySelectorAll('.ppl-list .pp').forEach((o) => o.classList.toggle('dim', full));
      syncPicked(root, a, !!root._ready);
    } else {
      root.querySelectorAll('.w-in').forEach((inp) => {
        const i = Number(inp.dataset.i);
        if (document.activeElement !== inp && inp.value !== a[i]) inp.value = a[i];
        inp.closest('.w-row').classList.toggle('filled', !!a[i]);
      });
    }
  }

  /* Picked people move out of the list into their own group above it (like Screen Time's
     "Always Allowed"): the row collapses where it was and grows in up top, and the list box shrinks
     by exactly that much, so nothing ever jumps. */
  const ROW_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
  const ROW_MS = 320;
  const SHUT = { height: '0px', minHeight: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 };
  function collapse(el, done) {
    const h = el.getBoundingClientRect().height;
    el.style.overflow = 'hidden';
    el.animate([{ height: h + 'px', minHeight: '0px', opacity: 1 }, SHUT], { duration: ROW_MS, easing: ROW_EASE })
      .onfinish = () => { el.style.overflow = ''; done(); };
  }
  function expand(el) {
    const h = el.getBoundingClientRect().height;
    el.style.overflow = 'hidden';
    el.animate([SHUT, { height: h + 'px', minHeight: '0px', opacity: 1 }], { duration: ROW_MS, easing: ROW_EASE })
      .onfinish = () => { el.style.overflow = ''; };
  }
  const applyVis = (row) => { row.hidden = row.classList.contains('picked') || row.classList.contains('nomatch'); };
  // Separators sit on top of every row except the first one that is actually shown.
  function markFirst(list) {
    let first = true;
    list.querySelectorAll('.pp').forEach((r) => {
      r.classList.toggle('first-vis', first && !r.hidden);
      if (!r.hidden) first = false;
    });
  }

  function syncPicked(root, names, animate) {
    const wrap = root.querySelector('.ppl-picked');
    const grp = wrap.firstElementChild;
    const list = root.querySelector('.ppl-list');
    const live = new Map([...grp.querySelectorAll('.pp:not(.leaving)')].map((r) => [r.dataset.name, r]));
    const had = live.size > 0;
    live.forEach((r, n) => {
      if (names.includes(n)) return;
      r.classList.add('leaving');
      if (animate) collapse(r, () => r.remove()); else r.remove();
    });
    names.forEach((n) => {
      if (live.has(n)) return;
      grp.insertAdjacentHTML('beforeend', personRow(n, true));
      if (animate) expand(grp.lastElementChild);
    });
    const has = names.length > 0;
    wrap.classList.toggle('has', has);
    if (animate && has !== had) {
      wrap.animate([{ paddingBottom: has ? '0px' : '8px' }, { paddingBottom: has ? '8px' : '0px' }], { duration: ROW_MS, easing: ROW_EASE });
    }
    list.querySelectorAll('.pp').forEach((row) => {
      const picked = names.includes(row.dataset.name);
      if (picked === row.classList.contains('picked')) return;
      row.classList.toggle('picked', picked);
      if (picked && animate && !row.hidden) collapse(row, () => { applyVis(row); markFirst(list); });
      else {
        applyVis(row);
        if (!picked && animate && !row.hidden) expand(row);
      }
    });
    markFirst(list);
    const sc = list.querySelector('.scroll-fade');
    if (sc && sc._fade) { sc._fade(); setTimeout(sc._fade, ROW_MS + 20); }
  }

  // Number keys pick options on the focused proposal card.
  function pressDigit(root, id, i) {
    const p = POLLS[id];
    if (p.kind !== 'proposal' || i >= p.options.length) return false;
    if (!toggle(id, i)) nope(root.querySelectorAll('.opt')[i]);
    update(root, id);
    return true;
  }

  function shake(cardEl) {
    const c = cardEl.querySelector('.card');
    c.classList.remove('shake');
    void c.offsetWidth;
    c.classList.add('shake');
  }

  function blurInside(el) {
    if (el.contains(document.activeElement)) document.activeElement.blur();
  }

  const describe = (id) => ({ title: POLLS[id].title, detail: summary(id) || '–' });

  const hasChanged = (root, id) => root._initial != null && answerKey(id) !== root._initial;
  window.Cards = { INITIAL, POLLS, render, isValid, hasChanged, describe, pressDigit, shake, blurInside, resetAnswers, snapshot, restore };
})();
