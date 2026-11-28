'use strict';
/* The home screen with its two equally weighted modes, Schüler and Redaktion, switched at the top.
   Both modes mirror each other: a deck of cards that need you (polls / tickets) in the page's concept
   (carousel or stack), and a bar capsule that collects what you have handled (Abgegeben / Erledigt).
   App.start('carousel' | 'stack'). ?modus=redaktion opens the Redaktion mode. */
(function () {
  const { $, UI, ICONS, Carousel, Stack } = window.P;
  const check30 = ICONS.check.replace('width="24" height="24"', 'width="30" height="30"');

  function start(kind) {
    const file = kind === 'stack' ? '02-swipe-stack.html' : '01-carousel.html';
    const params = new URLSearchParams(location.search);
    let mode = params.get('modus') === 'redaktion' ? 'redaktion' : 'schueler';

    const S = { done: [...Cards.INITIAL.done], closed: [...Cards.INITIAL.closed], steckbriefDone: false };
    const R = { done: [...Tickets.INITIAL.done] };
    const decks = {};

    const snapS = () => ({ open: decks.schueler ? decks.schueler.ids().length : Cards.INITIAL.open.length, done: S.done.length, closed: S.closed.length, steckbriefDone: S.steckbriefDone });
    const snapR = () => ({ open: decks.redaktion ? decks.redaktion.ids().length : Tickets.INITIAL.open.length, done: R.done.length, closed: 0, steckbriefDone: S.steckbriefDone });

    // A card was committed (button or pull): it is on its way into the capsule.
    function landed(m, id) {
      if (m === 'schueler') S.done.unshift(id); else R.done.unshift(id);
      UI.update(m === 'schueler' ? snapS() : snapR(), { defer: true });
      UI.refreshPanel();
    }

    function commit(m, id, fromSwipe = false) {
      const deck = decks[m];
      if (!deck || !id) return;
      if (kind === 'stack') { deck.commit(id, fromSwipe); return; }
      const el = deck.cardEl(id);
      if (m === 'schueler') {
        if (!Cards.isValid(id)) { Cards.shake(el); return; }
        Cards.blurInside(el);
      }
      if (deck.leave(id, 'drop', fromSwipe)) landed(m, id);
    }

    // Tickets you handed on can be taken back; they return to the top of the deck.
    function takeBack(id, row) {
      R.done = R.done.filter((x) => x !== id);
      row.classList.add('leaving');
      setTimeout(() => UI.refreshPanel(), 280);
      decks.redaktion.insert(id, 0);
      UI.update(snapR());
    }

    function buildDeck(m) {
      const isS = m === 'schueler';
      const host = $(isS ? 'deckS' : 'deckR');
      const src = isS ? Cards : Tickets;
      const render = (id) => {
        const root = src.render(id);
        root.querySelector('.card-cta').addEventListener('click', (e) => { e.stopPropagation(); commit(m, id); });
        return root;
      };
      const empty = isS
        ? () => (window.Theme && Theme.emptyHTML && Theme.emptyHTML()) || `<div class="empty-icon">${check30}</div><div class="empty-title">Alles abgegeben</div><div class="empty-sub">Du kannst Antworten ändern, solange die Umfrage läuft.</div>`
        : () => `<div class="empty-icon">${check30}</div><div class="empty-title">Nichts zu tun</div><div class="empty-sub">Sobald dir jemand etwas zuweist oder um Freigabe bittet, steht es hier.</div>`;
      const canCommit = isS ? Cards.isValid : () => true;
      const onRefuse = (id, el) => Cards.shake(el);
      if (kind === 'stack') {
        decks[m] = Stack(host, {
          ids: src.INITIAL.open,
          order: isS ? Object.keys(Cards.POLLS) : Tickets.ORDER,
          countLabel: (i, n) => (isS ? `Frage ${i} von ${n}` : `Aufgabe ${i} von ${n}`),
          render, canCommit, onRefuse, emptyHTML: empty,
          onCommit: (id) => landed(m, id),
        });
      } else {
        decks[m] = Carousel(host, {
          ids: src.INITIAL.open,
          render,
          label: isS ? (id) => Cards.POLLS[id].title : Tickets.label,
          pull: { canCommit, onRefuse, onCommit: (id) => commit(m, id, true) },
          emptyHTML: empty,
        });
      }
    }

    function configureBar(m) {
      if (m === 'schueler') {
        UI.configure({ capTitle: 'Abgegeben', panelTitle: 'Abgegeben', getLists: () => ({ done: S.done, closed: S.closed }), describe: Cards.describe });
        UI.update(snapS());
      } else {
        UI.configure({
          capTitle: 'Erledigt', panelTitle: 'Erledigt', themed: false, panelEmpty: 'Noch nichts erledigt.',
          getLists: () => ({ done: R.done, closed: [] }),
          panelGroups: () => Tickets.groups(R.done, takeBack),
        });
        UI.update(snapR());
      }
    }

    function show(m, animate) {
      mode = m;
      const on = $(m === 'schueler' ? 'modeS' : 'modeR');
      const off = $(m === 'schueler' ? 'modeR' : 'modeS');
      off.hidden = true;
      on.hidden = false;
      if (!decks[m]) buildDeck(m); else decks[m].resize ? decks[m].resize() : decks[m].refresh();
      configureBar(m);
      if (animate) {
        window.scrollTo(0, 0);
        on.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
        const cap = $('abgBtn');
        cap.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
        const u = new URL(location.href);
        if (m === 'redaktion') u.searchParams.set('modus', 'redaktion'); else u.searchParams.delete('modus');
        history.replaceState(null, '', u);
      }
    }

    document.querySelector('main').innerHTML = `
      <div class="mode-pane" id="modeS" hidden>
        <div class="deck" id="deckS"></div>
        <div class="page"><section class="section" id="sammeln"></section></div>
      </div>
      <div class="mode-pane" id="modeR" hidden>
        <div class="deck" id="deckR"></div>
        <div class="page rd">${Redaktion.sectionsHTML(`./entwuerfe.html?von=${file.slice(0, 2)}`)}</div>
      </div>`;

    UI.mount({
      brand: true,
      modes: [{ id: 'schueler', label: 'Schüler' }, { id: 'redaktion', label: 'Redaktion' }],
      mode,
      onMode: (m) => show(m, true),
      getLists: () => ({ done: S.done, closed: S.closed }),
      describe: Cards.describe,
      onSteckbrief: () => { S.steckbriefDone = !S.steckbriefDone; UI.update(mode === 'schueler' ? snapS() : snapR()); },
    });
    Redaktion.wire(null);
    show(mode, false);

    document.addEventListener('keydown', (e) => {
      if (UI.overlayOpen() || e.key === 'Escape') return;
      const deck = decks[mode];
      if (!deck || e.target.closest('input, textarea')) return;
      const id = kind === 'stack' ? deck.topId() : deck.currentId();
      if (!id) return;
      if (mode === 'schueler' && /^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (Cards.pressDigit(deck.cardEl(id).querySelector('.q'), id, Number(e.key) - 1)) e.preventDefault();
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        if (kind === 'stack') deck.throwTop(dir); else deck.nudge(dir);
      } else if (e.key === 'ArrowDown' || (e.key === 'Enter' && (!e.target.closest('button, a') || e.target.closest('.q .row')))) {
        e.preventDefault();
        commit(mode, id);
      }
    });
  }

  window.App = { start };
})();
