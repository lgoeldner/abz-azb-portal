'use strict';
/* Shared chrome for the card prototypes: floating top/bottom bars, account menu,
   Abgegeben sheet/popover, the pull-down commit capsule and the drop-into-dock flight. */
(function () {
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const rubberBand = (x, limit) => (x * limit) / (Math.abs(x) + limit);
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const wideQuery = window.matchMedia('(min-width: 744px)');
  const isWide = () => wideQuery.matches;

  // Damped spring, sub-stepped so stiff springs stay stable at low frame rates.
  function springStep(val, vel, target, k, d, dt) {
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      vel += ((target - val) * k - vel * d) * h;
      val += vel * h;
    }
    return [val, vel];
  }

  const S = (inner, size = 24, extra = '') =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" ${extra}>${inner}</svg>`;

  const ICONS = {
    back: S('<path d="M14.5 4.75 7.25 12l7.25 7.25"/>', 22, 'stroke-width="2.4"'),
    person: `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8.1" r="4.1"/><path d="M4.4 19.3c1.25-3.5 4.2-5.3 7.6-5.3s6.35 1.8 7.6 5.3c.2.55-.2 1.1-.8 1.1H5.2c-.6 0-1-.55-.8-1.1z"/></svg>`,
    check: S('<path d="M4.3 11.8 9.3 16.8 18.8 5.8"/>', 24, 'stroke-width="3"'),
    checkSmall: S('<path d="M5.3 11.6 9.5 15.6 17.3 6.6"/>', 16, 'stroke-width="3"'),
    search: S('<circle cx="10.75" cy="10.75" r="6.25"/><path d="m15.5 15.5 4.25 4.25"/>', 17, 'stroke-width="2.2"'),
    clock: S('<circle cx="12" cy="12" r="8.75"/><path d="M12 7.25V12l3.1 1.9"/>', 15, 'stroke-width="2"'),
    chevUp: S('<path d="M6.5 14.5 12 9l5.5 5.5"/>', 15, 'stroke-width="2.6"'),
    xmark: S('<path d="M7 7l10 10M17 7 7 17"/>', 17, 'stroke-width="2.4"'),
    lock: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10V8a5 5 0 0 1 10 0v2h.5A2.5 2.5 0 0 1 20 12.5v7A2.5 2.5 0 0 1 17.5 22h-11A2.5 2.5 0 0 1 4 19.5v-7A2.5 2.5 0 0 1 6.5 10H7zm2.6 0h4.8V8a2.4 2.4 0 0 0-4.8 0v2z"/></svg>`,
    steckbrief: S('<rect x="2.75" y="4.75" width="18.5" height="14.5" rx="3.2"/><circle cx="8.6" cy="10.4" r="2.1"/><path d="M5.6 15.9c.6-1.6 1.7-2.4 3-2.4s2.4.8 3 2.4M14.25 10h4.25M14.25 13.75h2.75"/>', 22, 'stroke-width="1.8"'),
    gear: S('<circle cx="12" cy="12" r="3"/><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>', 21, 'stroke-width="1.8"'),
    logout: S('<path d="M13.5 4.75H7.25a2 2 0 0 0-2 2v10.5a2 2 0 0 0 2 2h6.25"/><path d="M10.75 12h9.5M17 8.5l3.5 3.5-3.5 3.5"/>', 21, 'stroke-width="1.9"'),
    photo: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M5 4h14a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zm3.5 4.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zM4.5 17.5h15l-4.4-5.5a1 1 0 0 0-1.56 0l-3.1 3.85-1.58-1.9a1 1 0 0 0-1.54 0L4.5 17.5z"/></svg>`,
    quote: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M4.5 5h4.2A2.3 2.3 0 0 1 11 7.3v5.2c0 4.2-2.2 6.8-6.4 7.5a.8.8 0 0 1-.92-.8v-1.7c0-.4.28-.74.67-.84 1.85-.46 2.85-1.56 3.05-3.46H5.2A2.2 2.2 0 0 1 3 11V7.2A2.2 2.2 0 0 1 4.5 5zm10.5 0h4.2A2.3 2.3 0 0 1 21.5 7.3v5.2c0 4.2-2.2 6.8-6.4 7.5a.8.8 0 0 1-.92-.8v-1.7c0-.4.28-.74.67-.84 1.85-.46 2.85-1.56 3.05-3.46h-2.2A2.2 2.2 0 0 1 13.5 11V7.2A2.2 2.2 0 0 1 15 5z"/></svg>`,
    sparkle: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.4c.42 0 .79.26.93.66l1.95 5.66 5.66 1.95a.98.98 0 0 1 0 1.86l-5.66 1.95-1.95 5.66a.98.98 0 0 1-1.86 0l-1.95-5.66-5.66-1.95a.98.98 0 0 1 0-1.86l5.66-1.95 1.95-5.66c.14-.4.51-.66.93-.66z"/></svg>`,
    // The portal's logo (deployables/portal/web/src/App.tsx, Mark): a tilted notebook with the year on it.
    mark: `<svg class="brand-mark" viewBox="0 0 40 40" aria-hidden="true"><g transform="rotate(-7 20 20)"><path d="M5 4h30a2 2 0 0 1 2 2v28a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#15181F"/><path d="M37 6v11H26a2 2 0 0 1-2-2V4h11a2 2 0 0 1 2 2z" fill="#D81E44"/><path d="M24 4v11a2 2 0 0 0 2 2h11" fill="none" stroke-width="1.5" stroke="var(--bg)"/><text x="4.5" y="31" font-size="21" font-weight="800" letter-spacing="-1.5" fill="#C8F23C" style="font-family: inherit">27</text><rect x="6" y="9" width="13" height="2.4" rx="1.2" fill="#F5F6EC"/></g></svg>`,
    bulb: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5a6.8 6.8 0 0 0-4.1 12.22c.68.52 1.1 1.32 1.1 2.18v.35A1.25 1.25 0 0 0 10.25 18.5h3.5A1.25 1.25 0 0 0 15 17.25v-.35c0-.86.42-1.66 1.1-2.18A6.8 6.8 0 0 0 12 2.5zM9.6 20a.9.9 0 0 0 0 1.8h4.8a.9.9 0 1 0 0-1.8H9.6z"/></svg>`,
  };

  /* ─────────────────────────── Pull-down commit capsule ───────────────────────────
     Lives in the gap a pulled card leaves behind. Below the threshold it scales up
     uniformly (fixed aspect) so it reaches exactly 100% card width at the threshold;
     past the threshold the width stays locked and it only grows taller. */
  class CommitPill {
    constructor(el) {
      this.el = el;
      this.el.innerHTML = `<span class="pill-knob">${ICONS.check}</span>`;
      this.icon = el.firstElementChild;
      this.armed = false;
      this.w = 0; this.vw = 0;
      this.pop = 0; this.vpop = 0;
      this.completing = false;
      this.fade = 1;
      this.last = null;
      this.revealFrom = null; // e.g. 0.35: stay invisible for the first 35% of the pull
    }
    setArmed(a) {
      if (a === this.armed) return;
      this.armed = a;
      this.el.classList.toggle('armed', a);
      this.vpop += a ? 7 : -3;
      if (a) this.vw += 420; // tiny elastic overshoot past the card edges
    }
    complete() {
      if (!this.last) return;
      this.completing = true;
      this.el.classList.add('completing');
      this.fade = 1;
    }
    reset() {
      this.completing = false;
      this.el.classList.remove('completing');
      this.fade = 1;
      this.setArmed(false);
      this.w = 0; this.vw = 0; this.pop = 0; this.vpop = 0;
      this.last = null;
      this.el.style.opacity = '0';
    }
    draw(w, h, r, opacity, extraScale) {
      const s = this.el.style;
      s.width = w.toFixed(2) + 'px';
      s.height = h.toFixed(2) + 'px';
      s.borderRadius = Math.min(h / 2, r).toFixed(2) + 'px';
      s.transform = `translate3d(${(-w / 2).toFixed(2)}px, ${this.m}px, 0) scale(${extraScale})`;
      s.opacity = String(clamp(opacity, 0, 1));
    }
    // pull: how far the card currently sits below its resting slot.
    // The well lives inside the card's resting footprint, inset by M on every side,
    // so its corners are concentric with the card (radius R − M) and it is W − 2M wide.
    step(pull, W, R, ARM, M, dt) {
      W -= 2 * M;
      R -= M;
      this.m = M;
      if (this.completing) {
        this.fade -= dt / 0.16;
        const f = this.last;
        if (this.fade <= 0) { this.reset(); return false; }
        this.draw(f.w, f.h, f.r, f.op * smoothstep(0, 1, this.fade), 1 - (1 - this.fade) * 0.04);
        return true;
      }
      const h = Math.max(0, pull - 2 * M);
      const hT = ARM - 2 * M;
      const geomW = this.armed ? W : Math.min(W, (W * h) / hT);
      [this.w, this.vw] = springStep(this.w, this.vw, geomW, 1100, 50, dt);
      [this.pop, this.vpop] = springStep(this.pop, this.vpop, 0, 520, 20, dt);
      const w = clamp(this.w, 0, W + 8);
      const t = clamp(h / hT, 0, 1);
      let op = smoothstep(10, 20, h);
      if (this.revealFrom != null) op *= smoothstep(this.revealFrom, this.revealFrom + 0.14, t);
      this.el.style.setProperty('--t', t.toFixed(3));
      const iconScale = (this.armed ? 1 : clamp((h - 8) / 44, 0.4, 0.86)) * (1 + this.pop * 0.14);
      this.icon.style.transform = `scale(${iconScale.toFixed(3)})`;
      this.icon.style.opacity = String(smoothstep(18, 34, h));
      this.draw(w, h, R, op, 1);
      this.last = { w, h, r: R, op };
      return (
        Math.abs(geomW - this.w) > 0.25 || Math.abs(this.vw) > 0.5 ||
        Math.abs(this.pop) > 0.002 || Math.abs(this.vpop) > 0.02
      );
    }
  }

  /* ─────────────────────────── Drop into the dock capsule ─────────────────────────── */
  const Drop = {
    // Offset from a card's resting centre (inside `host`) to the centre of the Abgegeben capsule.
    target(host, H) {
      const cap = $('abgBtn').getBoundingClientRect();
      const st = host.getBoundingClientRect();
      return {
        x: cap.left + cap.width / 2 - (st.left + st.width / 2),
        y: cap.top + cap.height / 2 - (st.top + H / 2),
        scale: clamp(62 / H, 0.08, 0.2),
      };
    },
    start(c, host, H) {
      c.mode = 'dropping';
      c.t = 0;
      // A theme may hold the card in place for a beat (e.g. to let a stamp land).
      const hold = (window.Theme && Theme.onDrop && Theme.onDrop(c.el, c.id)) || 0;
      c.dur = 0.52;
      c.caught = false;
      c.t = -hold / c.dur;
      c.from = { x: c.x, y: c.y, scale: c.scale, rot: c.rot || 0, opacity: c.opacity };
      c.to = Drop.target(host, H);
      c.el.style.pointerEvents = 'none';
    },
    step(c, dt) {
      c.t += dt / c.dur;
      const p = clamp(c.t, 0, 1);
      const ex = easeInOutCubic(p);
      const ey = p * (0.28 + 0.72 * p); // starts moving immediately, accelerates into the dock
      c.x = lerp(c.from.x, c.to.x, ex);
      c.y = lerp(c.from.y, c.to.y, ey);
      c.scale = lerp(c.from.scale, c.to.scale, easeInOutCubic(Math.min(1, p * 1.08)));
      c.rot = lerp(c.from.rot, 0, ex);
      c.opacity = c.from.opacity * (1 - smoothstep(0.62, 1, p));
      if (!c.caught && p > 0.84) { c.caught = true; UI.bounce(c.id); }
      return p >= 1;
    },
  };

  /* ─────────────────────────── Chrome (bars, menu, panel) ─────────────────────────── */
  let opts = null;
  let pendingCapsule = null;
  const RING_C = 2 * Math.PI * 14.5;

  function mount(o) {
    opts = o;
    const top = document.createElement('div');
    top.className = 'top-chrome';
    top.id = 'topChrome';
    top.innerHTML = `
      <div class="edge-top"><div class="pblur"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div>
      <div class="top-row">
        ${o.backHref ? `<a class="back-btn glass" href="${o.backHref}" aria-label="Zurück">${ICONS.back}</a>` : ''}
        ${o.brand
          ? `<span class="brand">${ICONS.mark}<span class="brand-word">AbiZeit<span>Betrug</span></span></span>`
          : `<span class="inline-title">${o.title}</span>`}
      </div>`;
    document.body.prepend(top);
    const tint = document.createElement('div');
    tint.className = 'edge-tint';
    tint.style.webkitMaskImage = tint.style.maskImage = `url(${edgeTint()})`;
    top.querySelector('.edge-top').appendChild(tint);

    const edge = document.createElement('div');
    edge.className = 'edge-bottom';
    const dock = document.createElement('nav');
    dock.className = 'dock';
    dock.setAttribute('aria-label', 'Leiste');
    dock.innerHTML = `
      <div class="dock-row">
        <button class="dock-capsule" id="abgBtn" type="button" aria-haspopup="dialog" aria-expanded="false">
          <span class="ring" id="ring">
            <svg class="ring-svg" viewBox="0 0 36 36" fill="none">
              <circle class="ring-track" cx="18" cy="18" r="14.5" stroke-width="3.5"/>
              <circle class="ring-fill" id="ringFill" cx="18" cy="18" r="14.5" stroke-width="3.5" stroke-linecap="round"
                stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${RING_C.toFixed(2)}"/>
            </svg>
            <span class="ring-disc"></span>
            <span class="ring-check">${ICONS.checkSmall}</span>
          </span>
          <span class="cap-text">
            <span class="cap-title">Abgegeben</span>
            <span class="cap-sub" id="capSub">–</span>
          </span>
          <span class="cap-chev">${ICONS.chevUp}</span>
        </button>
        <div class="menu-anchor">
          <button class="dock-circle" id="accountBtn" type="button" aria-label="Konto" aria-haspopup="menu">
            ${ICONS.person}<span class="badge-dot" id="badgeDot"></span>
          </button>
          <div class="menu" id="accountMenu" role="menu">
            <button class="menu-item" id="steckbriefItem" type="button" role="menuitem">
              <span class="mi-icon">${ICONS.steckbrief}</span><span class="mi-label">Steckbrief</span><span class="mi-badge" id="steckbriefBadge">Offen</span>
            </button>
            <button class="menu-item" type="button" role="menuitem" data-close>
              <span class="mi-icon">${ICONS.gear}</span><span class="mi-label">Einstellungen</span>
            </button>
            <div class="menu-sep"></div>
            <button class="menu-item destructive" type="button" role="menuitem" data-close>
              <span class="mi-icon">${ICONS.logout}</span><span class="mi-label">Abmelden</span>
            </button>
          </div>
        </div>
      </div>`;
    edge.style.webkitMaskImage = edge.style.maskImage = `url(${easedTint({ maxAlpha: 0.9, reverse: true })})`;

    // Everything that floats (bar, account menu, Abgegeben) lives on one layer with one shared shadow,
    // so a menu never casts a shadow onto the bar it comes out of. The scrim sits underneath that layer.
    const layer = document.createElement('div');
    layer.className = 'float-layer';
    const scrimRoot = document.createElement('div');
    scrimRoot.className = 'scrim-root';
    scrimRoot.id = 'scrimRoot';
    scrimRoot.innerHTML = '<div class="scrim" id="scrim"></div>';
    document.body.append(edge, scrimRoot, layer);
    layer.append(dock);

    const panelRoot = document.createElement('div');
    panelRoot.className = 'panel-root';
    panelRoot.id = 'panelRoot';
    panelRoot.innerHTML = `
      <section class="panel" id="panel" role="dialog" aria-modal="true" aria-labelledby="panelTitle">
        <div id="panelGrip">
          <div class="panel-edge"><div class="pblur"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div>
          <div class="grabber"></div>
          <div class="panel-head">
            <h2 class="panel-title" id="panelTitle">Abgegeben</h2>
            <button class="panel-close" id="panelClose" type="button" aria-label="Schließen">${ICONS.xmark}</button>
          </div>
        </div>
        <div class="panel-body" id="panelBody"></div>
      </section>`;
    layer.append(panelRoot);

    // "Ändern": the submitted poll opens as a card of its own above everything (it never goes back into
    // the stack: a submitted answer can be changed, but not un-submitted).
    const editRoot = document.createElement('div');
    editRoot.className = 'edit-root';
    editRoot.id = 'editRoot';
    editRoot.innerHTML = '<div class="edit-scrim" id="editScrim"></div><div class="edit-host" id="editHost" role="dialog" aria-modal="true"></div>';
    document.body.append(editRoot);

    const sammeln = $('sammeln');
    if (sammeln) {
      const tiles = [
        ['Fotos', 'photo', 'var(--blue)', 12],
        ['Zitate', 'quote', 'var(--orange)', 3],
        ['Erinnerungen', 'sparkle', 'var(--purple)', 0],
        ['Ideen', 'bulb', 'var(--green)', 1],
      ];
      sammeln.innerHTML = `
        <h2 class="section-title">Sammeln</h2>
        <div class="tiles">${tiles.map(([label, icon, color, count]) => `
          <button class="tile" type="button">
            <span class="tile-icon" style="--c:${color}">${ICONS[icon]}</span>
            <span class="tile-count">${count}</span>
            <span class="tile-label">${label}</span>
          </button>`).join('')}
        </div>`;
    }

    if (window.Theme && Theme.mount) Theme.mount();
    wireTop();
    wireDock();
    wirePanel();
    wireEditor();
  }

  // Scroll-edge fades: a solid page-coloured layer shaped by an alpha mask that is rendered once to a tall
  // 1px-wide PNG. Solid colour + image mask keeps flat areas exact (CSS gradients get dithered, and a
  // tinted image drifts by a level when scaled). Curve: smootherstep, so the fade has no visible start or end.
  const smootherstep = (x) => x * x * x * (x * (6 * x - 15) + 10);
  function easedTint({ opaqueUntil = 0, maxAlpha = 1, reverse = false } = {}) {
    const H = 512;
    const c = document.createElement('canvas');
    c.width = 1; c.height = H;
    const g = c.getContext('2d');
    const img = g.createImageData(1, H);
    for (let y = 0; y < H; y++) {
      let t = y / (H - 1);
      if (reverse) t = 1 - t;
      const u = Math.min(1, Math.max(0, (t - opaqueUntil) / (1 - opaqueUntil)));
      const a = maxAlpha * (1 - smootherstep(u));
      img.data.set([0, 0, 0, Math.round(a * 255)], y * 4);
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }
  const edgeTint = () => easedTint({ opaqueUntil: 0.12 });

  function wireTop() {
    const top = $('topChrome');
    const title = document.querySelector('.large-title');
    const edge = top.querySelector('.edge-top');
    const onScroll = () => {
      const y = Math.max(0, window.scrollY);
      top.classList.toggle('scrolled', y > 2);
      top.classList.toggle('collapsed', !!title && title.getBoundingClientRect().bottom < 62);
      // The edge always starts at the top of the screen. At rest it only covers the bar itself (58px); as
      // content scrolls under the bar it grows to its full 108px. Pages with a large title (subpages) have
      // nothing under the bar for a while on wide screens, so there it grows over ~90px; otherwise the
      // content sits right under the bar and the edge reaches full height within the first ~24px.
      const REST = 58, FULL = 108, ramp = title && isWide() ? 90 : 24;
      const h = REST + (FULL - REST) * Math.min(1, y / ramp);
      edge.style.height = `calc(${h.toFixed(1)}px + env(safe-area-inset-top))`;
    };
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // While one popup is open, the other button in the bar is muted (that is how you see where it came from).
  function setMenu(open) {
    $('accountMenu').classList.toggle('open', open);
    $('abgBtn').classList.toggle('muted', open);
  }
  function closeMenu() { setMenu(false); }
  function wireDock() {
    const menu = $('accountMenu');
    $('accountBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (isPanelOpen()) closePanel();
      setMenu(!menu.classList.contains('open'));
    });
    $('steckbriefItem').addEventListener('click', () => { opts.onSteckbrief && opts.onSteckbrief(); closeMenu(); });
    menu.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeMenu));
    document.addEventListener('pointerdown', (e) => {
      if (menu.classList.contains('open') && !e.target.closest('.menu-anchor')) closeMenu();
    }, true);

    // Tap toggles the list; swiping up on the capsule opens it (like the mini player).
    const cap = $('abgBtn');
    let sy = null, swiped = false;
    cap.addEventListener('pointerdown', (e) => { sy = e.clientY; swiped = false; });
    cap.addEventListener('pointermove', (e) => {
      if (sy !== null && sy - e.clientY > 22) { sy = null; swiped = true; if (!isPanelOpen()) openPanel(); }
    });
    const clear = () => { sy = null; };
    cap.addEventListener('pointerup', clear);
    cap.addEventListener('pointercancel', clear);
    cap.addEventListener('click', () => {
      if (swiped) { swiped = false; return; }
      isPanelOpen() ? closePanel() : openPanel();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (isPanelOpen()) closePanel();
      closeMenu();
    });
  }

  /* Abgegeben list: a popover above the bar, exactly as wide as the bar, growing out of the capsule */
  const isPanelOpen = () => $('panelRoot').classList.contains('shown');
  let closeTimer = null;
  let panelFade = () => {};

  function positionPanel() {
    const panel = $('panel');
    const row = document.querySelector('.dock-row').getBoundingClientRect();
    const cap = $('abgBtn').getBoundingClientRect();
    panel.style.left = row.left + 'px';
    panel.style.width = row.width + 'px';
    panel.style.bottom = (window.innerHeight - row.top + 10) + 'px';
    panel.style.transformOrigin = `${(cap.left + cap.width / 2 - row.left).toFixed(1)}px calc(100% + ${(10 + cap.height / 2).toFixed(1)}px)`;
  }

  // The panel and its scrim live on different layers but open and close together.
  const panelRoots = () => [$('panelRoot'), $('scrimRoot')];
  function openPanel() {
    const root = $('panelRoot');
    clearTimeout(closeTimer);
    closeMenu();
    panelRoots().forEach((r) => r.classList.add('open'));
    positionPanel();
    hasRendered = false;
    refreshPanel();
    $('panelBody').scrollTop = 0;
    $('panel').classList.remove('scrolled');
    $('abgBtn').setAttribute('aria-expanded', 'true');
    $('accountBtn').classList.add('muted');
    void root.offsetWidth;
    panelRoots().forEach((r) => r.classList.add('shown'));
  }

  function closePanel() {
    const root = $('panelRoot');
    panelRoots().forEach((r) => r.classList.remove('shown'));
    $('abgBtn').setAttribute('aria-expanded', 'false');
    $('accountBtn').classList.remove('muted');
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (!root.classList.contains('shown')) {
        panelRoots().forEach((r) => r.classList.remove('open'));
      }
    }, 420);
  }

  function wirePanel() {
    $('scrim').addEventListener('click', closePanel);
    $('panelClose').addEventListener('click', closePanel);
    window.addEventListener('resize', () => { if (isPanelOpen()) positionPanel(); });
    const body = $('panelBody');
    body.addEventListener('scroll', () => $('panel').classList.toggle('scrolled', body.scrollTop > 2), { passive: true });
    panelFade = scrollFade(body, { top: false });
  }

  let hasRendered = false;
  let renderedIds = new Set();

  function refreshPanel() {
    if (!$('panelRoot').classList.contains('open')) return;
    const { done, closed } = opts.getLists();
    const body = $('panelBody');
    body.innerHTML = '';
    const fresh = [];
    const mkLabel = (t) => { const el = document.createElement('div'); el.className = 'group-label'; el.textContent = t; return el; };
    const mkGroup = () => { const el = document.createElement('div'); el.className = 'group'; return el; };

    if (!done.length && !closed.length) {
      body.innerHTML = '<div class="panel-empty">Noch nichts abgegeben.</div>';
    }
    if (done.length) {
      const g = mkGroup();
      done.forEach((id) => {
        const row = document.createElement('div');
        row.className = 'lrow';
        const d = opts.describe(id);
        row.dataset.id = id;
        row.innerHTML = `<span class="lrow-icon">${ICONS.checkSmall}</span><span class="lrow-text"><span class="lrow-title"></span><span class="lrow-sub"></span></span><button class="small-btn" type="button">Ändern</button>`;
        row.querySelector('.lrow-title').textContent = d.title;
        row.querySelector('.lrow-sub').textContent = d.detail;
        row.querySelector('button').addEventListener('click', (e) => {
          e.stopPropagation();
          openEditor(id);
        });
        if (hasRendered && !renderedIds.has(id)) fresh.push(row);
        g.append(row);
      });
      body.append(mkLabel('Noch änderbar'), g);
    }
    if (closed.length) {
      const g = mkGroup();
      closed.forEach((id) => {
        const row = document.createElement('div');
        row.className = 'lrow muted';
        const d = opts.describe(id);
        row.innerHTML = `<span class="lrow-icon closed">${ICONS.lock}</span><span class="lrow-text"><span class="lrow-title"></span><span class="lrow-sub"></span></span>`;
        row.querySelector('.lrow-title').textContent = d.title;
        row.querySelector('.lrow-sub').textContent = d.detail;
        g.append(row);
      });
      body.append(mkLabel('Beendet'), g);
    }
    renderedIds = new Set([...done, ...closed]);
    hasRendered = true;
    requestAnimationFrame(() => panelFade());
    fresh.forEach((row) => {
      row.classList.add('entering');
      void row.offsetHeight;
      requestAnimationFrame(() => row.classList.remove('entering'));
    });
  }

  /* ─────────── "Ändern" modal ─────────── */
  let editing = null; // { id, snap, root }
  const isEditorOpen = () => !!editing;

  function openEditor(id) {
    const host = $('editHost');
    closeMenu();
    host.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card edit-card';
    const root = Cards.render(id, { edit: true });
    card.appendChild(root);
    host.appendChild(card);
    editing = { id, snap: Cards.snapshot(id), root };
    root.querySelector('.q-close').addEventListener('click', cancelEditor);
    root.querySelector('.card-cta').addEventListener('click', saveEditor);
    const er = $('editRoot');
    er.classList.add('open');
    void er.offsetWidth;
    er.classList.add('shown');
  }

  function closeEditor() {
    const er = $('editRoot');
    const id = editing && editing.id;
    editing = null;
    er.classList.remove('shown');
    setTimeout(() => { if (!editing) { er.classList.remove('open'); $('editHost').innerHTML = ''; } }, 260);
    return id;
  }

  function cancelEditor() {
    if (!editing) return;
    Cards.restore(editing.id, editing.snap);
    closeEditor();
  }

  function saveEditor() {
    if (!editing) return;
    const { id, root } = editing;
    if (!Cards.isValid(id)) { Cards.shake(root.parentElement.parentElement); return; }
    if (!Cards.hasChanged(root, id)) { cancelEditor(); return; }
    closeEditor();
    refreshPanel();
    // The row that changed acknowledges the save.
    const row = $('panelBody').querySelector(`.lrow[data-id="${id}"]`);
    if (row) { row.classList.remove('saved'); void row.offsetWidth; row.classList.add('saved'); }
  }

  function wireEditor() {
    $('editScrim').addEventListener('click', cancelEditor);
    document.addEventListener('keydown', (e) => {
      if (!editing) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancelEditor(); return; }
      if (e.target.closest('input, textarea')) return;
      if (e.key === 'Enter') { e.preventDefault(); saveEditor(); }
      else if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (Cards.pressDigit(editing.root, editing.id, Number(e.key) - 1)) e.preventDefault();
      }
    }, true);
  }

  function applyCapsule(s) {
    if (window.Theme && Theme.capsule && Theme.capsule(s, opts.getLists(), $('ring'), $('capSub'))) return;
    const total = s.open + s.done;
    const frac = total ? s.done / total : 1;
    $('ringFill').style.strokeDashoffset = (RING_C * (1 - frac)).toFixed(2);
    $('ring').classList.toggle('complete', s.open === 0);
    $('capSub').textContent = s.open === 0 ? 'Alles erledigt' : `${s.done} von ${total}`;
  }

  const UI = {
    mount,
    // s = { open, done, closed, steckbriefDone } (counts). defer: wait for the card to land.
    update(s, { defer = false } = {}) {
      const sub = $('heroSub');
      const themed = window.Theme && Theme.subtitle && Theme.subtitle(s);
      if (sub) sub.textContent = themed || (s.open === 0 ? 'Alles abgegeben' : s.open === 1 ? '1 Frage offen' : `${s.open} Fragen offen`);
      $('badgeDot').classList.toggle('hidden', !!s.steckbriefDone);
      $('steckbriefBadge').classList.toggle('hidden', !!s.steckbriefDone);
      if (defer) pendingCapsule = s;
      else { pendingCapsule = null; applyCapsule(s); }
    },
    bounce(id) {
      if (pendingCapsule) { applyCapsule(pendingCapsule); pendingCapsule = null; }
      const cap = $('abgBtn');
      if (id && window.Theme && Theme.onCatch) Theme.onCatch(id, cap.getBoundingClientRect());
      cap.classList.remove('catch');
      void cap.offsetWidth;
      cap.classList.add('catch');
    },
    refreshPanel,
    openPanel,
    closePanel,
    openEditor,
    overlayOpen: () => isEditorOpen() || isPanelOpen() || $('accountMenu').classList.contains('open'),
  };

  const gesture = { moved: false };

  // Fade a scroll container's edges only where there is more content beyond them.
  function scrollFade(el, { top = true, bottom = true, max = 28 } = {}) {
    const update = () => {
      const room = el.scrollHeight - el.clientHeight;
      const over = room > 1;
      el.classList.toggle('overflowing', over);
      if (top) el.style.setProperty('--fade-top', (over ? Math.min(max, el.scrollTop) : 0).toFixed(1) + 'px');
      if (bottom) el.style.setProperty('--fade-bot', (over ? Math.min(max, room - el.scrollTop) : 0).toFixed(1) + 'px');
    };
    el.addEventListener('scroll', update, { passive: true });
    if (window.ResizeObserver) new ResizeObserver(update).observe(el);
    update();
    return update;
  }

  // Release velocity from the last ~100 ms of samples (px/ms), not just the final event.
  function makeVelocity() {
    let pts = [];
    return {
      reset(x) { pts = [[x, performance.now()]]; },
      add(x) {
        const t = performance.now();
        pts.push([x, t]);
        while (pts.length > 2 && t - pts[0][1] > 100) pts.shift();
      },
      get() {
        if (pts.length < 2) return 0;
        const [x0, t0] = pts[0];
        const [x1, t1] = pts[pts.length - 1];
        if (performance.now() - t1 > 80) return 0; // finger rested before letting go
        return (x1 - x0) / Math.max(8, t1 - t0);
      },
    };
  }
  window.P = { gesture, makeVelocity, scrollFade, $, clamp, lerp, smoothstep, rubberBand, springStep, easeInOutCubic, isWide, CommitPill, Drop, UI, ICONS };
})();
