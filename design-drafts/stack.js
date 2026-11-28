'use strict';
/* The swipe-away card stack, shared by the polls and the Redaktion to-dos (02).
   Swipe either way (or ←/→, trackpad) sends the top card to the back; pull it down to commit (it drops
   into the bar's capsule); tap a card behind to bring it forward. Each card shows its place ("3/6").

   P.Stack(host, {
     ids, render(id),     // ids in queue order; render → the card's .card-content (with a .q-count slot)
     order,               // fixed order for the "3/6" numbering
     countLabel(i, n),    // accessible label for the count
     canCommit(id), onRefuse(id, el), onCommit(id, fromSwipe),
     emptyHTML(),
   }) → { ids(), topId(), commit(id, fromSwipe), throwTop(dir), insert(id, at), resize() } */
(function () {
  const { clamp, lerp, smoothstep, rubberBand, springStep, isWide, CommitPill, Drop, gesture, makeVelocity } = window.P;
  const THROW_X = 90;
  const M = 10;

  function Stack(host, opts) {
    host.classList.add('stack');
    host.innerHTML = '<div class="sizer"></div><div class="commit-pill"></div>';
    const stage = host;
    const vel = makeVelocity();
    const order = opts.order || opts.ids;

    const state = {
      queue: [...opts.ids],
      armed: false,
      bump: 0, bumpV: 0,
      dragProgress: 0,
      dropPullY: 0,
      dropActive: false,
      dragId: null,
      dragMode: null, // 'horiz' | 'drop' | 'scroll'
    };
    const cards = new Map();
    const pill = new CommitPill(host.querySelector('.commit-pill'));
    pill.revealFrom = 0.28; // first you see the stack behind, then the well forms over it
    let W = 360, H = 420, R = 30, ARM = 100, SLOT = [];

    // Rest poses. Scale is about the centre, so y also compensates to keep a clean bottom peek.
    function measure() {
      W = host.querySelector('.sizer').offsetWidth;
      H = host.querySelector('.sizer').offsetHeight;
      R = parseFloat(getComputedStyle(stage).getPropertyValue('--card-r')) || 30;
      ARM = isWide() ? 124 : 100;
      const peek = isWide() ? [0, 12, 23, 29] : [0, 10, 19, 24];
      const scale = [1, 0.95, 0.9, 0.85];
      SLOT = scale.map((s, i) => ({ y: peek[i] + (H * (1 - s)) / 2, scale: s, opacity: i < 3 ? 1 : 0, z: 40 - i * 10 }));
    }

    function slotPose(depth, promote = 0) {
      const i = Math.min(depth, SLOT.length - 1);
      if (depth === 0 || promote <= 0) return SLOT[i];
      const prev = SLOT[i - 1], cur = SLOT[i];
      return { y: lerp(cur.y, prev.y, promote), scale: lerp(cur.scale, prev.scale, promote), opacity: lerp(cur.opacity, prev.opacity, promote), z: cur.z };
    }

    function ensureCard(id) {
      let c = cards.get(id);
      if (!c) {
        const el = document.createElement('div');
        el.className = 'stack-card';
        el.innerHTML = '<div class="card"></div>';
        el.firstChild.appendChild(opts.render(id));
        el.addEventListener('click', () => {
          if (didDrag) return;
          const idx = state.queue.indexOf(id);
          if (idx > 0) bringToFront(idx);
        });
        stage.appendChild(el);
        const p = SLOT[3];
        c = {
          id, el,
          x: 0, y: p.y, scale: p.scale, rot: 0, opacity: 0,
          vx: 0, vy: 0, vScale: 0, vRot: 0,
          tx: 0, ty: p.y, tScale: p.scale, tRot: 0, tOpacity: 0, z: 10,
          mode: 'stack', throwDir: -1,
        };
        cards.set(id, c);
      }
      return c;
    }

    function setArmed(a) {
      if (a === state.armed) return;
      state.armed = a;
      pill.setArmed(a);
      state.bumpV += a ? 300 : -170;
      if (navigator.vibrate) navigator.vibrate(a ? 12 : 6);
      wakeLoop();
    }

    function syncTargets() {
      const emptyEl = stage.querySelector('.empty');
      if (!state.queue.length) {
        if (!emptyEl) {
          const e = document.createElement('div');
          e.className = 'empty';
          e.innerHTML = opts.emptyHTML ? opts.emptyHTML() : '';
          stage.appendChild(e);
        }
      } else if (emptyEl) emptyEl.remove();

      // Pulling down only moves the top card; the cards behind move up one slot as it leaves.
      const dropPromote = state.dragMode === 'drop' && opts.canCommit(state.queue[0]) ? smoothstep(0, ARM, state.dropPullY) : 0;
      const promote = state.dragMode === 'horiz' ? state.dragProgress : dropPromote;

      // Every open card knows its place ("3/6"), counted in a fixed order, so skipping round the stack
      // counts up and wraps, and committing one renumbers the rest.
      const ordered = [...state.queue].sort((a, b) => order.indexOf(a) - order.indexOf(b));

      state.queue.forEach((id, depth) => {
        const c = ensureCard(id);
        if (c.mode !== 'stack') return;
        const pose = slotPose(depth, promote);
        if (state.dragId !== id) {
          c.tx = 0; c.ty = pose.y; c.tScale = pose.scale; c.tRot = 0; c.tOpacity = pose.opacity;
        }
        c.z = pose.z;
        const i = ordered.indexOf(id) + 1;
        const count = ordered.length > 1 ? `${i}/${ordered.length}` : '';
        if (c.count !== count) {
          c.count = count;
          const el = c.el.querySelector('.q-count');
          if (el) {
            el.textContent = count;
            el.setAttribute('aria-label', count && opts.countLabel ? opts.countLabel(i, ordered.length) : '');
          }
        }
        c.el.dataset.depth = String(Math.min(depth, 3));
        c.el.style.setProperty('--reveal', depth === 1 ? state.dragProgress.toFixed(3) : '0');
        c.el.classList.toggle('is-top', depth === 0);
        c.el.classList.toggle('is-behind', depth === 1 || depth === 2);
        c.el.style.pointerEvents = depth <= 2 ? '' : 'none';
      });
    }

    function resetGesture() {
      state.dragProgress = 0;
      state.dropPullY = 0;
      state.dropActive = false;
      state.dragId = null;
      state.dragMode = null;
    }

    function throwTop(dir = -1, initialVx = 0) {
      const top = cards.get(state.queue[0]);
      if (state.queue.length <= 1) { if (top) { top.vx += dir * 260; wakeLoop(); } return; }
      setArmed(false);
      const id = state.queue.shift();
      state.queue.push(id);
      const c = cards.get(id);
      if (c) {
        c.mode = 'flying';
        c.throwDir = dir;
        c.vx = dir < 0 ? Math.min(-1100, initialVx) : Math.max(1100, initialVx);
        c.vy = 20;
        c.z = 50;
        c.el.style.pointerEvents = 'none';
      }
      // Rapid double-throw on 2 cards: catch the returning card straight back into the deck.
      const nextTop = cards.get(state.queue[0]);
      if (nextTop && nextTop.mode === 'flying') {
        nextTop.mode = 'stack';
        nextTop.x = -dir * 160; nextTop.y = 8; nextTop.rot = -dir * 4; nextTop.opacity = 0; nextTop.vx = dir * 400;
      }
      resetGesture();
      syncTargets();
      wakeLoop();
    }

    function bringToFront(idx) {
      if (idx <= 0 || idx >= state.queue.length) return;
      const [picked] = state.queue.splice(idx, 1);
      state.queue.unshift(picked);
      const c = cards.get(picked);
      if (c) c.vy = -260;
      resetGesture();
      syncTargets();
      wakeLoop();
    }

    // Commit the top card: it drops into the bar's capsule.
    function commit(id = state.queue[0], fromSwipe = false) {
      if (!state.queue.length || id !== state.queue[0]) return false;
      const c = cards.get(id);
      if (!c || c.mode !== 'stack') return false;
      if (!opts.canCommit(id)) { if (opts.onRefuse) opts.onRefuse(id, c.el); return false; }
      if (c.el.contains(document.activeElement)) document.activeElement.blur();
      if (fromSwipe && state.armed) pill.complete();
      state.armed = false;
      pill.setArmed(fromSwipe && pill.completing);

      state.queue.shift();
      c.el.classList.remove('dragging', 'is-top');
      Drop.start(c, stage, H);
      c.z = 300;
      resetGesture();
      const next = state.queue.length ? cards.get(state.queue[0]) : null;
      if (next && fromSwipe) {
        next.el.classList.add('enter-late');
        setTimeout(() => next.el.classList.remove('enter-late'), 600);
      }
      syncTargets();
      wakeLoop();
      opts.onCommit(id, fromSwipe);
      return true;
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
      if (Math.abs(state.bump) > 0.05 || Math.abs(state.bumpV) > 0.5) { moving = true; if (state.dragMode === 'drop') syncTargets(); }
      else { state.bump = 0; state.bumpV = 0; }

      if (!state.dragId && state.dragProgress > 0) {
        state.dragProgress *= Math.pow(0.015, dt);
        if (state.dragProgress < 0.002) state.dragProgress = 0;
        syncTargets();
        moving = true;
      }

      const top = state.queue.length ? cards.get(state.queue[0]) : null;
      if (top && state.dragId === top.id && state.dragMode === 'drop') top.y = state.dropPullY + state.bump;

      for (const [id, c] of cards) {
        if (c.mode === 'dropping') {
          const finished = Drop.step(c, dt);
          c.el.style.transform = `translate3d(${c.x}px, ${c.y}px, 0) scale(${c.scale}) rotate(${c.rot}deg)`;
          c.el.style.opacity = String(c.opacity);
          c.el.style.zIndex = '300';
          if (finished) { c.el.remove(); cards.delete(id); } else moving = true;
          continue;
        }

        if (c.mode === 'flying') {
          c.vx += c.throwDir * 1400 * dt;
          c.x += c.vx * dt;
          c.y += (c.vy + 70) * dt;
          c.rot += c.throwDir * 18 * dt;
          const dist = Math.abs(c.x);
          c.opacity = clamp(1 - smoothstep(W * 0.25, W * 0.75, dist), 0, 1);
          c.el.style.transform = `translate3d(${c.x}px, ${c.y}px, 0) scale(${c.scale}) rotate(${c.rot}deg)`;
          c.el.style.opacity = String(c.opacity);
          c.el.style.zIndex = String(c.z);
          if (dist > W * 0.8 || c.opacity <= 0.01) {
            const back = SLOT[3];
            c.mode = 'stack';
            c.x = 0; c.y = back.y; c.scale = back.scale; c.rot = 0; c.opacity = 0;
            c.vx = c.vy = c.vScale = c.vRot = 0;
            syncTargets();
          }
          moving = true;
          continue;
        }

        if (state.dragId !== c.id) {
          const k = state.dragMode === 'drop' ? 420 : 310;
          const d = state.dragMode === 'drop' ? 34 : 29;
          [c.x, c.vx] = springStep(c.x, c.vx, c.tx, k, d, dt);
          [c.y, c.vy] = springStep(c.y, c.vy, c.ty, k, d, dt);
          [c.scale, c.vScale] = springStep(c.scale, c.vScale, c.tScale, k, d, dt);
          [c.rot, c.vRot] = springStep(c.rot, c.vRot, c.tRot, k, d, dt);
          c.opacity += (c.tOpacity - c.opacity) * Math.min(1, 15 * dt);
          const settled =
            Math.abs(c.tx - c.x) < 0.25 && Math.abs(c.vx) < 0.5 &&
            Math.abs(c.ty - c.y) < 0.25 && Math.abs(c.vy) < 0.5 &&
            Math.abs(c.tScale - c.scale) < 0.0008 && Math.abs(c.vScale) < 0.002 &&
            Math.abs(c.tRot - c.rot) < 0.05 &&
            Math.abs(c.tOpacity - c.opacity) < 0.004;
          if (settled) {
            c.x = c.tx; c.y = c.ty; c.scale = c.tScale; c.rot = c.tRot; c.opacity = c.tOpacity;
            c.vx = c.vy = c.vScale = c.vRot = 0;
          } else moving = true;
        } else moving = true;

        c.el.style.transform = `translate3d(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px, 0) scale(${c.scale.toFixed(4)}) rotate(${c.rot.toFixed(3)}deg)`;
        c.el.style.opacity = String(clamp(c.opacity, 0, 1));
        c.el.style.zIndex = String(c.z);
      }

      // Commit capsule tracks the top card's real offset (also while it springs back).
      if (state.dropActive && state.dragMode !== 'drop' && (!top || top.mode !== 'stack' || (top.y < 0.5 && Math.abs(top.vy) < 4))) state.dropActive = false;
      const pull = state.dropActive && top && top.mode === 'stack' && opts.canCommit(top.id) ? Math.max(0, top.y) : 0;
      if (pill.step(pull, W, R, ARM, M, dt)) moving = true;

      rafId = moving ? requestAnimationFrame(stepFrame) : 0;
    }

    /* Pointer: left or right = skip (the card goes to the back), down = commit, up (touch) = scroll page */
    let pid = null, sx = 0, sy = 0, startScroll = 0, didDrag = false, ptrType = 'mouse', inScroller = false;

    stage.addEventListener('pointerdown', (e) => {
      if (!state.queue.length || e.target.closest('.card-cta, input, .no-drag') || e.button > 0) return;
      inScroller = e.pointerType === 'touch' && !!e.target.closest('.is-top .scroll-fade.overflowing');
      const top = cards.get(state.queue[0]);
      ptrType = e.pointerType;
      const onTop = top && top.mode === 'stack' && top.el.contains(e.target);
      if (!onTop && ptrType !== 'touch') return;
      pid = e.pointerId;
      sx = e.clientX;
      vel.reset(e.clientX);
      sy = e.clientY;
      startScroll = window.scrollY;
      state.dragMode = null;
      state.onTop = onTop;
      didDrag = false;
    });

    stage.addEventListener('pointermove', (e) => {
      if (pid !== e.pointerId) return;
      const top = cards.get(state.queue[0]);
      if (!top || top.mode !== 'stack') return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;

      if (!state.dragMode) {
        if (Math.hypot(dx, dy) < 7) return;
        if (state.onTop && Math.abs(dx) >= Math.abs(dy)) {
          state.dragMode = 'horiz';
          state.dropActive = false;
        } else if (inScroller) { pid = null; return; } // let a list inside the card scroll natively
        else if (state.onTop && dy > 0) {
          state.dragMode = 'drop';
          state.dropActive = true;
          if (pill.completing) pill.reset();
        } else if (ptrType === 'touch' && Math.abs(dy) > Math.abs(dx)) {
          state.dragMode = 'scroll';
        } else { pid = null; return; }
        didDrag = true;
        gesture.moved = true;
        if (state.dragMode !== 'scroll') {
          state.dragId = top.id;
          top.el.classList.add('dragging');
        }
        stage.setPointerCapture(pid);
        wakeLoop();
      }

      vel.add(e.clientX);

      if (state.dragMode === 'scroll') {
        window.scrollTo(0, startScroll - dy);
      } else if (state.dragMode === 'horiz') {
        state.dropPullY = 0;
        if (state.queue.length <= 1) {
          const rx = rubberBand(dx, 48);
          top.x = rx; top.y = 0; top.rot = rx * 0.035; top.scale = 1;
          state.dragProgress = 0;
        } else {
          // Either way: the top card follows the finger off the stack, the next one comes forward.
          top.x = dx;
          top.y = Math.abs(dx) * 0.02;
          top.rot = dx * 0.024;
          top.scale = 1;
          state.dragProgress = smoothstep(0, W * 0.4, Math.abs(dx));
        }
        syncTargets();
      } else if (state.dragMode === 'drop') {
        const raw = Math.max(0, dy);
        const ok = opts.canCommit(top.id);
        // Not ready yet: the card resists and never arms.
        state.dropPullY = !ok ? rubberBand(raw, 34) : raw <= ARM ? raw : ARM + rubberBand(raw - ARM, 120);
        top.x = 0; top.rot = 0;
        top.scale = 1;
        top.y = state.dropPullY + state.bump;
        state.dragProgress = 0;
        setArmed(ok && (state.armed ? state.dropPullY > ARM - 16 : state.dropPullY >= ARM));
        syncTargets();
      }
    });

    const endDrag = (e) => {
      if (pid !== e.pointerId) return;
      const top = state.queue.length ? cards.get(state.queue[0]) : null;
      if (top) top.el.classList.remove('dragging');
      const m = state.dragMode;
      const pulled = state.dropPullY;
      state.dragId = null;
      state.dragMode = null;
      state.dropPullY = 0;
      if (m === 'drop' && top && !opts.canCommit(top.id) && pulled > 14 && opts.onRefuse) opts.onRefuse(top.id, top.el);

      const vxPx = vel.get();
      // A flick decides the direction unless it fights a card that is already far out; otherwise distance does.
      let dir = 0;
      if (m === 'horiz' && top && state.queue.length > 1) {
        const x = top.x;
        if (Math.abs(vxPx) > 0.5 && (Math.sign(vxPx) === Math.sign(x) || Math.abs(x) < 24)) dir = Math.sign(vxPx);
        else if (Math.abs(x) > THROW_X && vxPx * Math.sign(x) > -0.3) dir = Math.sign(x);
      }
      if (dir) throwTop(dir, vxPx * 1000);
      else if (m === 'drop' && top && state.armed) commit(top.id, true);
      else { setArmed(false); syncTargets(); wakeLoop(); }

      pid = null;
      setTimeout(() => { didDrag = false; gesture.moved = false; }, 0);
    };
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);

    // Trackpad: one horizontal swipe = one card.
    let wheelAcc = 0, wheelLockUntil = 0, wheelResetT = null;
    stage.addEventListener('wheel', (e) => {
      if (state.queue.length <= 1) return;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
      if (!d) return;
      e.preventDefault();
      const now = performance.now();
      clearTimeout(wheelResetT);
      wheelResetT = setTimeout(() => { wheelAcc = 0; }, 140);
      if (now < wheelLockUntil) return;
      wheelAcc += d;
      if (Math.abs(wheelAcc) > 44) {
        throwTop(wheelAcc > 0 ? -1 : 1);
        wheelAcc = 0;
        wheelLockUntil = now + 340;
      }
    }, { passive: false });

    function placeAtRest() {
      state.queue.forEach((id, depth) => {
        const c = cards.get(id);
        const p = SLOT[Math.min(depth, 3)];
        if (c && c.mode === 'stack') { c.x = 0; c.y = p.y; c.scale = p.scale; c.opacity = p.opacity; c.rot = 0; c.vx = c.vy = c.vScale = c.vRot = 0; }
      });
    }
    function resize() { measure(); syncTargets(); placeAtRest(); wakeLoop(); }

    // Put a card (back) on top, rising into place.
    function insert(id, at = 0) {
      if (state.queue.includes(id)) return;
      const old = cards.get(id);
      if (old) { old.el.remove(); cards.delete(id); }
      state.queue.splice(Math.min(at, state.queue.length), 0, id);
      const c = ensureCard(id);
      c.x = 0; c.y = SLOT[0].y + 40; c.scale = 0.94; c.opacity = 0; c.rot = 0;
      resetGesture();
      syncTargets();
      wakeLoop();
    }
    window.addEventListener('resize', resize);
    measure();
    syncTargets();
    placeAtRest();
    wakeLoop();

    return {
      ids: () => state.queue,
      topId: () => state.queue[0] || null,
      cardEl: (id) => (cards.get(id) || {}).el,
      commit,
      throwTop,
      insert,
      resize,
    };
  }

  window.P.Stack = Stack;
})();
