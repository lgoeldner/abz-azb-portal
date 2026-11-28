'use strict';
/* The card carousel, shared by the poll carousel (01) and the Redaktion to-dos (03).
   Infinite ring for 3+ cards, bounded row for 2; neighbours fade with their position; hover paddles on
   desktop; scrub across the dots; trackpad swipes page one card; optional pull-down-to-commit.

   P.Carousel(host, {
     ids,                 // initial card ids
     render(id),          // → the card's .card-content element
     label(id),           // dot label
     pull: { canCommit(id), onCommit(id) }   // optional: pull the centre card down to commit
     emptyHTML(),         // shown when nothing is left
   }) → { ids(), currentId(), goTo(i), nudge(dir), leave(id, mode, onDone), insert(id, at), refresh() }
   leave(): mode 'drop' flies the card into the bar's capsule (Drop), 'fade' lets it sink away. */
(function () {
  const { clamp, smoothstep, rubberBand, springStep, isWide, CommitPill, Drop, ICONS, gesture, makeVelocity } = window.P;
  const mod = (n, m) => ((n % m) + m) % m;

  function Carousel(host, opts) {
    host.classList.add('carousel');
    host.innerHTML = `
      <div class="sizer"></div>
      <div class="ring-viewport">${opts.pull ? '<div class="commit-pill"></div>' : ''}</div>
      <button class="paddle prev glass" type="button" aria-label="Vorherige Karte">${ICONS.back}</button>
      <button class="paddle next glass" type="button" aria-label="Nächste Karte">${ICONS.back.replace('<svg ', '<svg style="transform:scaleX(-1)" ')}</button>
      <div class="dots" role="tablist" aria-label="Karten"></div>`;
    const q = (s) => host.querySelector(s);
    const viewport = q('.ring-viewport');
    const dotsEl = q('.dots');
    const prevBtn = q('.paddle.prev');
    const nextBtn = q('.paddle.next');
    const pill = opts.pull ? new CommitPill(q('.commit-pill')) : null;
    const vel = makeVelocity();
    const M = 10;
    let W = 360, H = 420, R = 30, ARM = 100;

    const state = {
      open: [...opts.ids],
      pos: 0, posVel: 0, targetPos: 0,
      dragging: false,
      dragMode: null, // 'pan' | 'drop' | 'scroll'
      dropY: 0,
      dropActive: false,
      armed: false,
      bump: 0, bumpV: 0,
    };
    const cards = new Map();

    function measure() {
      W = q('.sizer').offsetWidth;
      H = q('.sizer').offsetHeight;
      R = parseFloat(getComputedStyle(host).getPropertyValue('--card-r')) || 30;
      ARM = isWide() ? 124 : 100;
    }
    const nearShrink = () => (isWide() ? 0.04 : 0.05);
    const gapPx = () => (isWide() ? 14 : 10);
    const stepPx = () => (W * (2 - nearShrink())) / 2 + gapPx();

    // Signed distance (in cards) from the centre slot. Ring for n >= 3, bounded row for n <= 2.
    function cardDelta(index, pos, n) {
      if (n <= 1) return -pos;
      if (n === 2) return index - pos;
      let d = mod(index - pos, n);
      if (d > n / 2) d -= n;
      return d;
    }
    // Whole-card opacity purely from position; reaches 0 before the ring's wrap seam.
    function cardOpacity(absD, n) {
      if (n <= 1) return 1;
      const near = isWide() ? 0.5 : 0.55;
      if (n === 2) return 1 - smoothstep(0, 1, absD) * (1 - near) - smoothstep(1, 1.8, absD) * near * 0.6;
      const fadeEnd = Math.min(2.3, n / 2 - 0.08);
      if (absD <= 1) return 1 - smoothstep(0, 1, absD) * (1 - near);
      return near * (1 - smoothstep(1, fadeEnd, absD));
    }
    const cardScale = (absD) => 1 - smoothstep(0, 1, absD) * nearShrink() - smoothstep(1, 2, absD) * 0.04;

    function currentIdx() {
      const n = state.open.length;
      if (!n) return 0;
      if (n <= 2) return clamp(Math.round(state.pos), 0, n - 1);
      return mod(Math.round(state.pos), n);
    }
    const targetIdx = () => {
      const n = state.open.length;
      return n <= 2 ? clamp(Math.round(state.targetPos), 0, Math.max(0, n - 1)) : mod(Math.round(state.targetPos), n);
    };

    function goTo(idx) {
      const n = state.open.length;
      if (n <= 1 || idx < 0) return;
      if (n === 2) state.targetPos = idx;
      else {
        const base = Math.round(state.targetPos);
        state.targetPos = base + Math.round(cardDelta(idx, base, n));
      }
      updatePaddles();
      wakeLoop();
    }

    function ensureCard(id) {
      let c = cards.get(id);
      if (!c) {
        const el = document.createElement('div');
        el.className = 'ring-card';
        el.innerHTML = '<div class="card"></div>';
        el.firstChild.appendChild(opts.render(id));
        // A tap on a neighbour brings it to the centre (its own controls are inert until then).
        el.addEventListener('click', (e) => {
          if (didDrag) { e.stopPropagation(); return; }
          if (!el.classList.contains('is-center')) { e.stopPropagation(); goTo(state.open.indexOf(id)); }
        }, true);
        viewport.appendChild(el);
        c = { id, el, x: 0, vx: 0, y: 0, vy: 0, scale: 0.93, vScale: 0, rot: 0, opacity: 0, mode: 'ring' };
        cards.set(id, c);
      }
      return c;
    }

    function syncDom(snap = false) {
      const empty = viewport.querySelector('.empty');
      if (!state.open.length) {
        if (!empty) {
          const e = document.createElement('div');
          e.className = 'empty';
          e.innerHTML = opts.emptyHTML ? opts.emptyHTML() : '';
          viewport.appendChild(e);
        }
        dotsEl.innerHTML = '';
        updatePaddles();
        return;
      }
      if (empty) empty.remove();

      const n = state.open.length;
      state.open.forEach((id, idx) => {
        const c = ensureCard(id);
        if (c.mode !== 'ring') return;
        if (snap) {
          const absD = Math.abs(cardDelta(idx, state.pos, n));
          c.x = cardDelta(idx, state.pos, n) * stepPx(); c.vx = 0;
          c.y = 0; c.vy = 0;
          c.scale = cardScale(absD); c.vScale = 0;
          c.opacity = cardOpacity(absD, n);
        }
      });

      dotsEl.innerHTML = n > 1
        ? state.open.map((id, i) => `<button type="button" class="dot" data-i="${i}" aria-label="${opts.label ? opts.label(id) : i + 1}"></button>`).join('')
        : '';
      dotsEl.querySelectorAll('.dot').forEach((d) => { d.onclick = () => goTo(Number(d.dataset.i)); });
      updatePaddles();
    }

    function updatePaddles() {
      const n = state.open.length;
      const t = Math.round(state.targetPos);
      prevBtn.classList.toggle('off', n <= 1 || (n === 2 && t <= 0));
      nextBtn.classList.toggle('off', n <= 1 || (n === 2 && t >= 1));
    }

    function setArmed(a) {
      if (!pill || a === state.armed) return;
      state.armed = a;
      pill.setArmed(a);
      state.bumpV += a ? 300 : -170;
      if (navigator.vibrate) navigator.vibrate(a ? 12 : 6);
      wakeLoop();
    }

    // Take a card out of the carousel. The others close the gap.
    function leave(id, mode = 'fade', fromSwipe = false) {
      const c = cards.get(id);
      if (!c || c.mode !== 'ring' || !state.open.includes(id)) return false;
      if (pill) {
        if (fromSwipe && state.armed) pill.complete();
        state.armed = false;
        pill.setArmed(fromSwipe && pill.completing);
      }
      state.dropActive = false;
      state.dropY = 0;
      if (mode === 'drop') Drop.start(c, viewport, H);
      else { c.mode = 'fading'; c.t = 0; c.from = { y: c.y, scale: c.scale, opacity: c.opacity }; c.el.style.pointerEvents = 'none'; }
      c.el.classList.remove('is-center');

      const oldN = state.open.length;
      const idx = state.open.indexOf(id);
      if (oldN === 3) {
        // 3 → 2: keep the left card left and glide the right card into the centre.
        state.open = [state.open[mod(idx - 1, 3)], state.open[mod(idx + 1, 3)]];
        state.pos = state.targetPos = 1;
      } else {
        state.open = state.open.filter((x) => x !== id);
        const nextIdx = state.open.length ? Math.min(idx, state.open.length - 1) : 0;
        state.pos = state.targetPos = nextIdx;
      }
      state.posVel = 0;
      syncDom(false);
      wakeLoop();
      return true;
    }

    // Put a card (back) in and bring it to the centre.
    function insert(id, at = 0) {
      if (state.open.includes(id)) return;
      const old = cards.get(id);
      if (old) { old.el.remove(); cards.delete(id); }
      at = clamp(at, 0, state.open.length);
      state.open.splice(at, 0, id);
      const c = ensureCard(id);
      c.y = 24; c.scale = 0.94; c.opacity = 0;
      state.pos = state.targetPos = at;
      state.posVel = 0;
      syncDom(false);
      c.x = 0;
      wakeLoop();
    }

    let rafId = 0, lastTs = 0;
    function wakeLoop() {
      if (!rafId) { lastTs = performance.now(); rafId = requestAnimationFrame(stepFrame); }
    }

    function stepFrame(ts) {
      const dt = Math.min(0.034, Math.max(0.001, (ts - lastTs) / 1000));
      lastTs = ts;
      let moving = false;

      [state.bump, state.bumpV] = springStep(state.bump, state.bumpV, 0, 620, 24, dt);
      if (Math.abs(state.bump) > 0.05 || Math.abs(state.bumpV) > 0.5) moving = true;
      else { state.bump = 0; state.bumpV = 0; }

      if (!state.dragging) {
        [state.pos, state.posVel] = springStep(state.pos, state.posVel, state.targetPos, 280, 30, dt);
        if (Math.abs(state.targetPos - state.pos) > 0.0008 || Math.abs(state.posVel) > 0.002) moving = true;
        else { state.pos = state.targetPos; state.posVel = 0; }
      } else moving = true;

      const n = state.open.length;
      const step = stepPx();
      const centerI = currentIdx();
      const centerId = n ? state.open[centerI] : null;

      for (const [id, c] of cards) {
        if (c.mode === 'dropping') {
          const finished = Drop.step(c, dt);
          c.el.style.transform = `translate3d(${c.x}px, ${c.y}px, 0) scale(${c.scale})`;
          c.el.style.opacity = String(c.opacity);
          c.el.style.zIndex = '300';
          if (finished) { c.el.remove(); cards.delete(id); } else moving = true;
          continue;
        }
        if (c.mode === 'fading') {
          c.t += dt / 0.34;
          const p = clamp(c.t, 0, 1);
          const e = 1 - Math.pow(1 - p, 3);
          c.el.style.transform = `translate3d(${c.x}px, ${(c.from.y + 18 * e).toFixed(2)}px, 0) scale(${(c.from.scale * (1 - 0.08 * e)).toFixed(4)})`;
          c.el.style.opacity = String(c.from.opacity * (1 - smoothstep(0, 1, p)));
          if (p >= 1) { c.el.remove(); cards.delete(id); } else moving = true;
          continue;
        }

        const idx = state.open.indexOf(id);
        if (idx < 0) { c.el.remove(); cards.delete(id); continue; }

        const delta = cardDelta(idx, state.pos, n);
        const absD = Math.abs(delta);
        const isCenter = id === centerId;
        const tx = delta * step;
        const pulling = isCenter && state.dropActive;
        const ty = pulling ? (state.dragMode === 'drop' ? state.dropY : 0) + state.bump : 0;
        const tScale = cardScale(absD);
        const tOpacity = cardOpacity(absD, n);

        if (n >= 3 && Math.abs(tx - c.x) > step * n * 0.55) {
          // Wrap across the far seam, where opacity is already 0.
          c.x = tx; c.vx = 0;
          c.opacity = Math.min(c.opacity, tOpacity);
        } else if (state.dragging && state.dragMode === 'pan') {
          c.x += (tx - c.x) * Math.min(1, 34 * dt);
          [c.y, c.vy] = springStep(c.y, c.vy, 0, 320, 30, dt);
          c.scale += (tScale - c.scale) * Math.min(1, 26 * dt);
          c.opacity += (tOpacity - c.opacity) * Math.min(1, 28 * dt);
        } else {
          [c.x, c.vx] = springStep(c.x, c.vx, tx, 300, 31, dt);
          if (pulling && state.dragMode === 'drop') { c.y = ty; c.vy = 0; }
          else [c.y, c.vy] = springStep(c.y, c.vy, ty, 340, 30, dt);
          [c.scale, c.vScale] = springStep(c.scale, c.vScale, tScale, 300, 30, dt);
          c.opacity += (tOpacity - c.opacity) * Math.min(1, 15 * dt);
          if (
            Math.abs(tx - c.x) > 0.3 || Math.abs(c.vx) > 0.6 ||
            Math.abs(ty - c.y) > 0.3 || Math.abs(c.vy) > 0.6 ||
            Math.abs(tScale - c.scale) > 0.0008 || Math.abs(c.vScale) > 0.002 ||
            Math.abs(tOpacity - c.opacity) > 0.004
          ) moving = true;
          else { c.x = tx; c.vx = 0; c.y = ty; c.vy = 0; c.scale = tScale; c.vScale = 0; c.opacity = tOpacity; }
        }

        c.el.style.transform = `translate3d(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px, 0) scale(${c.scale.toFixed(4)})`;
        c.el.style.opacity = String(clamp(c.opacity, 0, 1));
        c.el.style.zIndex = String(100 - Math.round(absD * 10));
        c.el.style.pointerEvents = c.opacity < 0.12 ? 'none' : '';
        c.el.classList.toggle('is-center', isCenter);
        c.el.style.setProperty('--focus', (1 - smoothstep(0, 0.75, absD)).toFixed(3));
      }

      if (pill) {
        // Commit capsule follows the centre card's real position (so it never overlaps the card).
        const cc = centerId ? cards.get(centerId) : null;
        if (state.dropActive && !state.dragging && (!cc || (cc.y < 0.5 && Math.abs(cc.vy) < 4))) state.dropActive = false;
        const pull = state.dropActive && cc && cc.mode === 'ring' && opts.pull.canCommit(centerId) ? Math.max(0, cc.y) : 0;
        if (pill.step(pull, W, R, ARM, M, dt)) moving = true;
      }

      const activeI = scrubbing ? targetIdx() : centerI;
      dotsEl.querySelectorAll('.dot').forEach((d, i) => d.classList.toggle('active', i === activeI));

      rafId = moving ? requestAnimationFrame(stepFrame) : 0;
    }

    /* Pointer: horizontal = browse, down on the centre card = commit (if enabled), up (touch) = scroll page */
    let pid = null, sx = 0, sy = 0, startPos = 0, startScroll = 0, didDrag = false, startedOnCenter = false, ptrType = 'mouse', inScroller = false;

    viewport.addEventListener('pointerdown', (e) => {
      if (!state.open.length || e.target.closest('.card-cta, input, .no-drag') || e.button > 0) return;
      inScroller = e.pointerType === 'touch' && !!e.target.closest('.is-center .scroll-fade.overflowing');
      const cc = cards.get(state.open[currentIdx()]);
      startedOnCenter = !!(cc && cc.mode === 'ring' && cc.el.contains(e.target));
      pid = e.pointerId;
      ptrType = e.pointerType;
      sx = e.clientX;
      sy = e.clientY;
      vel.reset(e.clientX);
      startPos = state.pos;
      startScroll = window.scrollY;
      state.dragMode = null;
      didDrag = false;
    });

    viewport.addEventListener('pointermove', (e) => {
      if (pid !== e.pointerId) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (!state.dragMode) {
        if (Math.hypot(dx, dy) < 7) return;
        if (Math.abs(dx) >= Math.abs(dy)) state.dragMode = 'pan';
        else if (inScroller) { pid = null; return; } // let a list inside the card scroll natively
        else if (dy > 0 && startedOnCenter && pill) {
          state.dragMode = 'drop';
          if (pill.completing) pill.reset();
          state.dropActive = true;
        } else if (ptrType === 'touch') state.dragMode = 'scroll';
        else { pid = null; return; }
        didDrag = true;
        gesture.moved = true;
        state.dragging = state.dragMode !== 'scroll';
        viewport.classList.add('dragging');
        host.classList.add('is-dragging');
        viewport.setPointerCapture(pid);
        wakeLoop();
      }

      vel.add(e.clientX);

      if (state.dragMode === 'scroll') {
        window.scrollTo(0, startScroll - dy);
      } else if (state.dragMode === 'pan') {
        const n = state.open.length;
        const step = stepPx();
        if (n <= 1) state.pos = -rubberBand(dx, 48) / step;
        else if (n === 2) {
          const raw = startPos - dx / step;
          if (raw < 0) state.pos = -rubberBand(-raw * step, 48) / step;
          else if (raw > 1) state.pos = 1 + rubberBand((raw - 1) * step, 48) / step;
          else state.pos = raw;
        } else state.pos = startPos - dx / step;
      } else if (state.dragMode === 'drop') {
        const raw = Math.max(0, dy);
        if (!opts.pull.canCommit(state.open[currentIdx()])) {
          // Not ready yet: the card resists and never arms.
          state.dropY = rubberBand(raw, 34);
          setArmed(false);
        } else {
          state.dropY = raw <= ARM ? raw : ARM + rubberBand(raw - ARM, 120);
          setArmed(state.armed ? state.dropY > ARM - 16 : state.dropY >= ARM);
        }
      }
    });

    const endDrag = (e) => {
      if (pid !== e.pointerId) return;
      const m = state.dragMode;
      state.dragging = false;
      state.dragMode = null;
      viewport.classList.remove('dragging');
      host.classList.remove('is-dragging');

      if (m === 'pan') {
        const n = state.open.length;
        if (n <= 1) { state.targetPos = 0; state.posVel = 0; }
        else {
          // A fifth of a card or a flick is enough to page; longer drags/flicks can skip several.
          const velCards = (-vel.get() * 1000) / stepPx();
          const base = Math.round(startPos);
          const moved = state.pos - base;
          let target = base;
          if (Math.abs(velCards) > 1.1) target = base + Math.sign(velCards) * Math.max(1, Math.round(Math.abs(moved) + Math.abs(velCards) * 0.12));
          else if (Math.abs(moved) > 0.2) target = base + Math.sign(moved) * Math.max(1, Math.round(Math.abs(moved)));
          state.posVel = velCards * 0.4;
          state.targetPos = n === 2 ? clamp(target, 0, 1) : target;
        }
        updatePaddles();
      } else if (m === 'drop') {
        const id = state.open[currentIdx()];
        if (state.armed) opts.pull.onCommit(id, true);
        else if (!opts.pull.canCommit(id) && state.dropY > 14 && opts.pull.onRefuse) opts.pull.onRefuse(id, cards.get(id).el);
        state.dropY = 0;
      }
      wakeLoop();
      pid = null;
      setTimeout(() => { didDrag = false; gesture.moved = false; }, 0);
    };
    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);

    // Trackpad: one horizontal swipe = one card (momentum tail ignored).
    let wheelAcc = 0, wheelLockUntil = 0, wheelResetT = null;
    viewport.addEventListener('wheel', (e) => {
      const n = state.open.length;
      if (n <= 1) return;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
      if (!d) return;
      e.preventDefault();
      const now = performance.now();
      clearTimeout(wheelResetT);
      wheelResetT = setTimeout(() => { wheelAcc = 0; }, 140);
      if (now < wheelLockUntil) return;
      wheelAcc += d;
      if (Math.abs(wheelAcc) > 42) {
        const dir = wheelAcc > 0 ? 1 : -1;
        if (n === 2) {
          const next = clamp(Math.round(state.targetPos) + dir, 0, 1);
          if (next === state.targetPos) state.posVel += dir * 2.4;
          state.targetPos = next;
        } else state.targetPos = Math.round(state.targetPos) + dir;
        wheelAcc = 0;
        wheelLockUntil = now + 320;
        updatePaddles();
        wakeLoop();
      }
    }, { passive: false });

    function nudge(dir) {
      const n = state.open.length;
      if (n === 1 || (n === 2 && Math.round(state.targetPos) === (dir > 0 ? 1 : 0))) state.posVel += dir * 2.2;
      else if (n === 2) state.targetPos = dir > 0 ? 1 : 0;
      else state.targetPos = Math.round(state.targetPos) + dir;
      updatePaddles();
      wakeLoop();
    }

    /* Scrub across the dots: the card under the nearest dot comes to the centre. */
    let scrubbing = false, scrubPid = null, scrubIdx = -1;
    function scrubTo(clientX) {
      const dots = [...dotsEl.querySelectorAll('.dot')];
      if (!dots.length) return;
      let best = 0, bestD = Infinity;
      dots.forEach((d, i) => {
        const r = d.getBoundingClientRect();
        const dist = Math.abs(clientX - (r.left + r.width / 2));
        if (dist < bestD) { bestD = dist; best = i; }
      });
      if (best !== scrubIdx) {
        if (scrubIdx !== -1 && navigator.vibrate) navigator.vibrate(4);
        scrubIdx = best;
        goTo(best);
      }
    }
    dotsEl.addEventListener('pointerdown', (e) => {
      if (state.open.length <= 1 || e.button > 0) return;
      e.preventDefault();
      scrubbing = true; scrubPid = e.pointerId; scrubIdx = targetIdx();
      dotsEl.setPointerCapture(e.pointerId);
      dotsEl.classList.add('scrub');
      host.classList.add('is-scrubbing');
      scrubTo(e.clientX);
    });
    dotsEl.addEventListener('pointermove', (e) => { if (scrubbing && e.pointerId === scrubPid) scrubTo(e.clientX); });
    const endScrub = (e) => {
      if (!scrubbing || e.pointerId !== scrubPid) return;
      scrubbing = false; scrubPid = null; scrubIdx = -1;
      dotsEl.classList.remove('scrub');
      host.classList.remove('is-scrubbing');
      wakeLoop();
    };
    dotsEl.addEventListener('pointerup', endScrub);
    dotsEl.addEventListener('pointercancel', endScrub);

    prevBtn.addEventListener('click', () => nudge(-1));
    nextBtn.addEventListener('click', () => nudge(1));

    window.addEventListener('resize', () => { measure(); syncDom(true); wakeLoop(); });
    measure();
    syncDom(true);
    wakeLoop();

    return {
      ids: () => state.open,
      currentId: () => (state.open.length ? state.open[currentIdx()] : null),
      cardEl: (id) => (cards.get(id) || {}).el,
      goTo,
      nudge,
      leave,
      insert,
      refresh: () => { syncDom(false); wakeLoop(); },
      resize: () => { measure(); syncDom(true); wakeLoop(); },
    };
  }

  window.P.Carousel = Carousel;
})();
