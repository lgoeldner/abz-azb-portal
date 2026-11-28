'use strict';
/* Character variants on top of the base prototypes, picked only from the index page with
   ?v=jahrbuch|abiball|knast (no switcher in the UI, nothing remembered: a plain URL is the real UI).
   Each theme adds colour, typography and a few unexpected details through small hooks in chrome.js / cards.js. */
(function () {
  const NAMES = { basis: 'Basis', jahrbuch: 'Jahrbuch', abiball: 'Abiball', knast: 'Knast' };
  const qp = new URLSearchParams(location.search).get('v');
  const v = qp && NAMES[qp] ? qp : 'basis';
  document.documentElement.classList.add('t-' + v);

  const FONTS = {
    jahrbuch: 'family=Instrument+Serif:ital@0;1&family=Caveat:wght@500..700',
    abiball: 'family=Bricolage+Grotesque:opsz,wght@12..96,400..800',
    knast: 'family=Big+Shoulders+Stencil+Display:wght@600..900&family=JetBrains+Mono:wght@500;700',
  };
  if (FONTS[v]) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = `https://fonts.googleapis.com/css2?${FONTS[v]}&display=swap`;
    document.head.appendChild(l);
  }

  // ---------- shared data
  const ORDER = ['motto', 'spruch', 'woerter', 'abifeier', 'freistunde', 'beruehmt', 'mottowoche', 'klasse11'];
  const HUES = {
    motto: '#7A5AF8', spruch: '#FF7A1A', woerter: '#EF3F96', abifeier: '#12B06B',
    freistunde: '#2E86F5', beruehmt: '#E3A008', mottowoche: '#0FA5B5', klasse11: '#8E8E93',
  };
  const num = (id) => String(ORDER.indexOf(id) + 1).padStart(2, '0');
  const dayDiff = (a, b) => Math.round((b - a) / 864e5);
  const today = new Date();
  // Placeholder dates for the prototype.
  const ABIBALL = new Date('2027-06-25T19:00:00');
  const SCHOOL_START = new Date('2014-09-16T08:00:00'); // first day of Grundschule for Jahrgang 2027
  const de = (n) => n.toLocaleString('de-DE');
  const svg = (inner, vb = '0 0 24 24', attrs = '') => `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" ${attrs}>${inner}</svg>`;

  // ---------- unexpected bits
  function stamp(cardEl, text, sub) {
    const card = cardEl.querySelector('.card');
    if (!card || card.querySelector('.stamp')) return;
    const s = document.createElement('div');
    s.className = 'stamp';
    s.innerHTML = `<span class="stamp-main">${text}</span>${sub ? `<span class="stamp-sub">${sub}</span>` : ''}`;
    card.appendChild(s);
  }

  function confetti(x, y, colors) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cv = document.createElement('canvas');
    cv.className = 'confetti';
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    document.body.appendChild(cv);
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    const parts = Array.from({ length: 54 }, () => {
      const a = (-90 + (Math.random() - 0.5) * 110) * Math.PI / 180;
      const sp = 420 + Math.random() * 520;
      return {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        w: 6 + Math.random() * 6, h: 3 + Math.random() * 4,
        r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 16,
        c: colors[(Math.random() * colors.length) | 0],
        round: Math.random() < 0.3,
      };
    });
    let last = performance.now(), age = 0;
    const tick = (ts) => {
      const dt = Math.min(0.033, (ts - last) / 1000); last = ts; age += dt;
      g.clearRect(0, 0, innerWidth, innerHeight);
      const fade = 1 - Math.max(0, (age - 0.9) / 0.6);
      for (const p of parts) {
        p.vy += 1500 * dt; p.vx *= 0.985; p.vy *= 0.985;
        p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
        g.save(); g.globalAlpha = Math.max(0, fade); g.translate(p.x, p.y); g.rotate(p.r);
        g.fillStyle = p.c;
        if (p.round) { g.beginPath(); g.arc(0, 0, p.h, 0, 6.28); g.fill(); }
        else g.fillRect(-p.w / 2, -p.h / 2, p.w, Math.max(1.5, p.h * Math.abs(Math.cos(p.r * 1.7))));
        g.restore();
      }
      if (fade > 0) requestAnimationFrame(tick); else cv.remove();
    };
    requestAnimationFrame(tick);
  }

  function barcode(seed) {
    let h = 0;
    for (const ch of seed) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
    let x = 0, bars = '';
    while (x < 58) {
      h = (Math.imul(h, 1103515245) + 12345) >>> 0;
      const w = 1 + (h >>> 29) % 3;
      if ((h >>> 9) & 1) bars += `<rect x="${x}" y="0" width="${w}" height="16"/>`;
      x += w + 1;
    }
    return `<svg class="barcode" viewBox="0 0 60 16" fill="currentColor" aria-hidden="true">${bars}</svg>`;
  }

  function tally(n) {
    const groups = Math.ceil(n / 5), lastK = n - (groups - 1) * 5;
    const width = Math.max(0, (groups - 1) * (4 * 4.6 + 4) + (Math.min(4, lastK) - 1) * 4.6);
    let out = '', x = 18 - width / 2;
    for (let g = 0; g < Math.ceil(n / 5); g++) {
      const k = Math.min(5, n - g * 5);
      const x0 = x;
      for (let i = 0; i < Math.min(4, k); i++) { out += `<path d="M${x} 9.5 ${x + 0.6} 26.5"/>`; x += 4.6; }
      if (k === 5) out += `<path d="M${x0 - 2.2} 23 ${x - 1.6} 12"/>`;
      x += 4;
    }
    return `<svg class="tally" viewBox="0 0 36 36" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none">${out}</svg>`;
  }

  const ICON = {
    check: svg('<path d="M5.3 11.6 9.5 15.6 17.3 6.6"/>', '0 0 24 24', 'stroke-width="3" width="15" height="15"'),
    handCheck: '<svg class="hand-check" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"><path pathLength="1" d="M6.5 16.8c1.9 1.3 3.7 3.5 5.2 6.6 2.4-7 7-12.7 14.2-17.4"/></svg>',
    arrow: '<svg class="hand-arrow" viewBox="0 0 60 40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M56 6C42 4 24 9 12 28"/><path d="M10 18 11.6 29.5 22 26"/></svg>',
    key: svg('<circle cx="8" cy="15" r="4.2"/><path d="m11 12 9-9M17 6l2.6 2.6M14.6 8.4l2 2"/>', '0 0 24 24', 'stroke-width="2.2" width="30" height="30"'),
  };

  // ---------- theme definitions
  const THEMES = {
    basis: {},

    jahrbuch: {
      decorateCard(root, id, p) {
        root.querySelectorAll('.tick').forEach((t) => t.insertAdjacentHTML('beforeend', ICON.handCheck));
        if (p.days >= 0 && p.days <= 3) {
          root.querySelector('.q-head').insertAdjacentHTML('beforeend', '<span class="hand-note urgent">Eilt!</span>');
        }
      },
      onDrop(cardEl) {
        const d = today.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
        stamp(cardEl, 'Abgegeben', d);
        return 0.26;
      },
      mount() {
        const hero = document.querySelector('.hero');
        if (hero) hero.insertAdjacentHTML('beforeend', `<span class="hand-note hero-note">${ICON.arrow}Jahrgang ’27</span>`);
      },
      emptyHTML: () => `<div class="empty-icon">${ICON.check.replace('width="15" height="15"', 'width="28" height="28"')}</div>
        <div class="empty-title">Alles eingetragen</div>
        <div class="empty-sub">Du kannst Antworten ändern, solange die Umfrage läuft.</div>
        <span class="hand-note empty-note">super gemacht!</span>`,
    },

    abiball: {
      decorateCard(root, id) {
        root.style.setProperty('--hue', HUES[id] || '#7A5AF8');
        root.insertAdjacentHTML('afterbegin', `<span class="q-numeral" aria-hidden="true">${num(id)}</span>`);
      },
      onCatch(id, cap) {
        const base = HUES[id] || '#7A5AF8';
        confetti(cap.left + cap.width / 2, cap.top + 6, [base, base, '#FFC93C', '#FF6FB5', '#7A5AF8', '#2E86F5']);
      },
      subtitle(s) {
        const d = dayDiff(today, ABIBALL);
        const open = s.open === 0 ? 'Alles abgegeben' : `${s.open} offen`;
        return `${open} · ${de(d)} Tage bis zum Abiball`;
      },
      capsule(s, lists, ring, sub) {
        const total = s.open + s.done;
        const C = 2 * Math.PI * 14.5;
        const seg = total ? C / total : C;
        const gap = total > 1 ? 2.4 : 0;
        const done = [...lists.done].reverse();
        let html = '<circle class="ring-track" cx="18" cy="18" r="14.5" stroke-width="3.5"/>';
        done.forEach((id, i) => {
          html += `<circle cx="18" cy="18" r="14.5" stroke-width="3.5" stroke="${HUES[id] || '#8E8E93'}" stroke-dasharray="${Math.max(0.1, seg - gap).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-i * seg).toFixed(2)}"/>`;
        });
        ring.querySelector('svg').innerHTML = html;
        sub.textContent = s.open === 0 ? 'Alles erledigt' : `${s.done} von ${total}`;
        return true;
      },
      mount() {
        const aur = document.createElement('div');
        aur.className = 'aurora';
        aur.innerHTML = '<i></i><i></i><i></i>';
        document.body.prepend(aur);
        const hero = document.querySelector('.hero');
        if (!hero) return;
        const txt = '13 JAHRE ABGESESSEN • ABI 2027 • ';
        hero.insertAdjacentHTML('beforeend', `
          <div class="hero-sticker" aria-hidden="true">
            <svg viewBox="0 0 100 100">
              <defs><path id="stk-c" d="M50 50m-37 0a37 37 0 1 1 74 0a37 37 0 1 1 -74 0"/></defs>
              <g class="stk-spin"><text><textPath href="#stk-c" textLength="230" lengthAdjust="spacingAndGlyphs">${txt}</textPath></text></g>
            </svg>
            <span class="stk-cap">🎓</span>
          </div>`);
      },
      emptyHTML: () => `<div class="empty-icon">🎉</div>
        <div class="empty-title">Alles abgegeben!</div>
        <div class="empty-sub">Bis zum Abiball kannst du alles noch ändern.</div>`,
    },

    knast: {
      decorateCard(root, id) {
        const head = root.querySelector('.q-head');
        head.insertAdjacentHTML('afterbegin', `<div class="q-case"><span>Akte 2027/${num(id)}</span>${barcode(id)}</div>`);
      },
      onDrop(cardEl) { stamp(cardEl, 'Erledigt', 'Akte geschlossen'); return 0.26; },
      subtitle(s) {
        const d = dayDiff(SCHOOL_START, today);
        const open = s.open === 0 ? 'alle Akten erledigt' : s.open === 1 ? '1 Akte offen' : `${s.open} Akten offen`;
        return `Tag ${de(d)} · ${open}`;
      },
      capsule(s, lists, ring, sub) {
        ring.innerHTML = tally(s.done);
        const total = s.open + s.done;
        sub.textContent = s.open === 0 ? 'Freigang!' : `${s.done} von ${total}`;
        return true;
      },
      mount() {
        const hero = document.querySelector('.hero');
        if (!hero) return;
        const marks = ['2,00', '1,90', '1,80', '1,70', '1,60'];
        hero.insertAdjacentHTML('afterbegin', `<div class="height-chart" aria-hidden="true">${marks.map((m) => `<span><i></i><b>${m}</b></span>`).join('')}</div>`);
      },
      emptyHTML: () => `<div class="empty-icon">${ICON.key}</div>
        <div class="empty-title">Freigang!</div>
        <div class="empty-sub">Alle Akten erledigt. Gute Führung.</div>`,
    },
  };

  const T = Object.assign({ name: v }, THEMES[v]);

  // Rough-ink filter used by the stamps.
  const baseMount = T.mount;
  T.mount = function () {
    document.body.insertAdjacentHTML('beforeend', `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
      <filter id="ink-rough" x="-10%" y="-20%" width="120%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="7" result="noise"/>
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.4" xChannelSelector="R" yChannelSelector="G" result="rough"/>
        <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.4 1.85" result="speckle"/>
        <feComposite in="rough" in2="speckle" operator="in"/>
      </filter></svg>`);
    if (baseMount) baseMount();
  };

  window.Theme = T;
})();
