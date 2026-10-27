// Shared engine for the ball toy and its tuner. Every tuning value lives in the settings object
// passed to start() and is read each frame, so the tuner can change it live.
window.BallToy = (() => {
  // Calm defaults for a young baby, tuned by hand: responses scale with the action, nothing escalates.
  const DEFAULTS = {
    ballSize: 0.14,        // ball radius as a fraction of the shorter screen side
    maxSpeed: 800,         // px/s cap on throws and hits
    friction: 2.2,         // how quickly the ball slows (higher stops sooner)
    bounce: 0.8,           // fraction of speed kept off a wall
    swipeStrength: 1,      // how hard a swipe knocks the ball
    tapNudge: 500,         // px/s push away from the finger when the ball is tapped (0 = off)
    squashMax: 0.12,       // deepest squash on a wall hit
    squashSpeed: 1500,     // impact speed that reaches the deepest squash
    squashRecover: 6,      // how fast the ball springs back to round
    pressSquash: 0.15,     // deepest squash when the held ball is pushed into a wall (0 = off)
    colorMode: 'random',   // 'none' | 'cycle' | 'random'
    colorEvery: 10,        // wall hits per color change
    minImpact: 110,        // slowest wall hit that sparks or changes color
    sparkColors: 'ball',   // 'match' | 'ball' | 'rainbow'
    sparkMax: 10,          // sparks from the hardest hit (fewer for softer ones)
    sparkLife: 0.4,        // seconds a spark lasts
    sparkSize: 1,          // spark size multiplier
    speedTrail: 0,         // sparks trailing a fast ball (0 = off)
    ribbonLife: 480,       // ms a swipe ribbon lingers (0 = off)
    ribbonWidth: 0.5,      // swipe ribbon thickness multiplier
    ribbonBright: 0.85,    // swipe ribbon brightness
    glow: 0.1,             // halo around the ball
    soundVolume: 0.4,      // overall volume of every sound (0 = off)
    soundPitch: 0.8,       // pitch multiplier for all sounds
    sndPress: 0.2,         // squeak when the held ball is squished into a wall or rubbed along it
    pressGap: 200,         // ms of quiet after a squeak before the next one can play
    sndWhiff: 0.25,        // faint whoosh when a swipe misses the ball
  };

  // The earlier, busier version, kept for comparison in the tuner.
  const ORIGINAL = {
    ballSize: 0.11, maxSpeed: 4200, friction: 0.9, bounce: 0.82, swipeStrength: 1.15, tapNudge: 0,
    squashMax: 0.32, squashSpeed: 1600, squashRecover: 10, pressSquash: 0,
    colorMode: 'random', colorEvery: 1, minImpact: 90,
    sparkColors: 'ball', sparkMax: 40, sparkLife: 0.78, sparkSize: 1, speedTrail: 1,
    ribbonLife: 260, ribbonWidth: 1, ribbonBright: 1, glow: 0.35, soundVolume: 0, soundPitch: 1, sndPress: 0, pressGap: 600, sndWhiff: 0,
  };

  // Fixed color order for 'cycle' mode; the ball starts with the first three.
  const PALETTE = [355, 50, 205, 135, 28, 275];

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

  function start(cv, T, opts = {}) {
    const ctx = cv.getContext('2d');
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const MAX_PARTICLES = reduceMotion ? 150 : 700;

    let W = 0, H = 0;
    const ball = { x: 0, y: 0, vx: 0, vy: 0, r: 60, colors: PALETTE.slice(0, 3), accent: 2, ang: 0, sx: 1, sy: 1, pressX: 0, pressY: 0 };
    const particles = [];
    const strokes = [];          // finger swipe ribbons: { pts: [{ x, y, t }], hue, live }
    let trailAcc = 0, wallHits = 0, cycleSlot = 0, paletteIdx = 3;

    const pickHue = () => ball.colors[Math.floor(Math.random() * 3)];
    const accentHue = () => ball.colors[ball.accent];
    const radius = () => Math.max(30, Math.min(W, H) * T.ballSize);

    function resize() {
      const rect = cv.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = rect.width; H = rect.height;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ball.r = radius();
      if (!ball.x) { ball.x = W / 2; ball.y = H / 2; }
      ball.x = clamp(ball.x, ball.r, W - ball.r);
      ball.y = clamp(ball.y, ball.r, H - ball.r);
    }
    if (window.ResizeObserver) new ResizeObserver(resize).observe(cv);
    window.addEventListener('resize', resize);
    resize();

    // ---- color ----
    function nextHue(slot) {
      if (T.colorMode === 'random') {
        const others = ball.colors.filter((_, j) => j !== slot);
        let h = 0;
        for (let tries = 0; tries < 40; tries++) {
          h = Math.floor(rand(0, 360));
          if (hueDist(h, ball.colors[slot]) >= 60 && others.every(o => hueDist(o, h) >= 60)) break;
        }
        return h;
      }
      for (let k = 0; k < PALETTE.length; k++) {
        const h = PALETTE[paletteIdx++ % PALETTE.length];
        if (!ball.colors.includes(h)) return h;
      }
      return PALETTE[0];
    }

    // Called on each real wall hit; returns the hue that hit's sparks should use.
    function onWallHitColor() {
      wallHits++;
      const every = Math.max(1, Math.round(T.colorEvery));
      if (T.colorMode === 'none' || wallHits % every) return accentHue();
      const i = T.colorMode === 'cycle' ? cycleSlot++ % 3 : Math.floor(Math.random() * 3);
      ball.colors[i] = nextHue(i);
      ball.accent = i;
      return ball.colors[i];
    }

    // ---- particles ----
    function sparkHue(hue) {
      if (T.sparkColors === 'rainbow') return rand(0, 360);
      if (T.sparkColors === 'ball') return pickHue() + rand(-15, 15);
      return hue + rand(-8, 8);
    }

    function spark(x, y, vx, vy, hue, size, life) {
      if (particles.length >= MAX_PARTICLES) particles.shift();
      particles.push({ x, y, vx, vy, h: hue, s: size, life, max: life });
    }

    // Burst of sparks; with a normal (nx, ny) they spray away from it, otherwise all around.
    function burst(x, y, count, power, nx = 0, ny = 0, hue = accentHue()) {
      count = Math.round(count);
      const base = Math.atan2(ny, nx);
      const spread = nx || ny ? Math.PI * 0.45 : Math.PI;
      for (let i = 0; i < count; i++) {
        const a = nx || ny ? base + rand(-spread, spread) : rand(0, Math.PI * 2);
        const v = rand(0.25, 1) * power + 60;
        spark(x, y, Math.cos(a) * v, Math.sin(a) * v,
          sparkHue(hue), rand(2, 5) * T.sparkSize, T.sparkLife * rand(0.7, 1.3));
      }
    }

    // Soft actions give a couple of sparks; the hardest give sparkMax.
    const sparksFor = speed => T.sparkMax <= 0 ? 0 : Math.max(2, T.sparkMax * Math.min(1, speed / T.maxSpeed));

    // ---- sound ----
    // Short synthesized tones through a low-pass filter, so nothing is sharp or loud.
    let audio = null, master = null, lastSound = 0;

    function unlockAudio() {
      if (!audio) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audio = new AC();
        const soften = audio.createBiquadFilter();
        soften.type = 'lowpass'; soften.frequency.value = 2800;
        master = audio.createGain();
        master.connect(soften); soften.connect(audio.destination);
      }
      if (audio.state === 'suspended') audio.resume().catch(() => {});
    }

    // One tone whose pitch glides from f0 to f1 while its volume falls away over `dur` seconds.
    function tone(type, f0, f1, gain, dur, delay = 0) {
      const t = audio.currentTime + delay;
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.02);
    }

    // At most one sound every 60ms, so a corner hit or a fast scribble doesn't clatter.
    function canPlay() {
      if (!audio || T.soundVolume <= 0 || audio.state !== 'running') return false;
      const now = performance.now();
      if (now - lastSound < 60) return false;
      lastSound = now;
      master.gain.value = T.soundVolume;
      return true;
    }

    // Soft rubbery bonk for a wall hit; strength 0..1 sets loudness and a little pitch.
    function playBonk(strength) {
      if (!canPlay()) return;
      const p = T.soundPitch, g = 0.25 + 0.55 * strength;
      tone('sine', 200 * p * (1 + strength * 0.3), 120 * p, g, 0.22);
      tone('triangle', 400 * p, 260 * p, g * 0.25, 0.12);
    }

    // Light rising boop when a swipe knocks the ball.
    function playBoop(strength) {
      if (!canPlay()) return;
      const p = T.soundPitch, g = 0.2 + 0.5 * strength;
      tone('sine', 330 * p, 560 * p, g, 0.16);
      tone('sine', 660 * p, 990 * p, g * 0.2, 0.1, 0.02);
    }

    // Rubbery squeak: a quick upward chirp, a little higher when squished into a corner.
    function playSqueak(strength, corner) {
      if (T.sndPress <= 0 || !canPlay()) return;
      const p = T.soundPitch * (corner ? 1.25 : 1), g = (0.2 + 0.4 * strength) * T.sndPress;
      tone('sine', 520 * p, 780 * p, g, 0.14);
      tone('sine', 780 * p, 640 * p, g * 0.5, 0.1, 0.05);
    }

    // Very faint airy whoosh for a swipe that misses: band-passed noise sweeping upward.
    let noiseBuf = null;
    function playWhiff(strength) {
      if (T.sndWhiff <= 0 || !canPlay()) return;
      if (!noiseBuf) {
        noiseBuf = audio.createBuffer(1, Math.round(audio.sampleRate * 0.4), audio.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const t = audio.currentTime, dur = 0.2, p = T.soundPitch;
      const src = audio.createBufferSource(), band = audio.createBiquadFilter(), g = audio.createGain();
      src.buffer = noiseBuf;
      band.type = 'bandpass'; band.Q.value = 1.2;
      band.frequency.setValueAtTime(700 * p, t);
      band.frequency.exponentialRampToValueAtTime(1600 * p, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime((0.15 + 0.25 * strength) * T.sndWhiff, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(band); band.connect(g); g.connect(master);
      src.start(t); src.stop(t + dur + 0.02);
    }

    // Press sounds: one squeak when the held ball reaches full squish (re-armed once it eases off),
    // then a quieter squeak for each stretch it's rubbed along the wall while pressed.
    let pressArmed = true, rubDist = 0, lastSqueak = -Infinity;

    // ---- pointer handling ----
    const pointers = new Map();   // pointerId -> { x, y, hist, grab, ox, oy, lastHit, moved, stroke }
    let grabId = null;

    function pos(e) {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    // Finger velocity over roughly the last 100ms, in px/s.
    function velocity(rec) {
      const h = rec.hist, a = h[0], b = h[h.length - 1];
      const dt = (b.t - a.t) / 1000;
      if (dt < 0.008) return { x: 0, y: 0 };
      return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
    }

    function capSpeed(v) {
      const s = Math.hypot(v.x, v.y);
      return s > T.maxSpeed ? { x: v.x / s * T.maxSpeed, y: v.y / s * T.maxSpeed } : v;
    }

    // Does the segment (x1,y1)->(x2,y2) pass within the ball? Returns the closest point or null.
    function segmentHit(x1, y1, x2, y2) {
      const dx = x2 - x1, dy = y2 - y1;
      const len2 = dx * dx + dy * dy || 1;
      const t = clamp(((ball.x - x1) * dx + (ball.y - y1) * dy) / len2, 0, 1);
      const cx = x1 + dx * t, cy = y1 + dy * t;
      return Math.hypot(ball.x - cx, ball.y - cy) <= ball.r * 1.05 ? { x: cx, y: cy } : null;
    }

    let woke = false, wakeLock = null;
    async function keepAwake() {
      try { wakeLock = await navigator.wakeLock?.request('screen'); } catch (_) {}
    }
    document.addEventListener('visibilitychange', () => {
      if (woke && document.visibilityState === 'visible') keepAwake();
    });

    function onTouchStart(e) {
      unlockAudio();   // browsers only allow sound after a touch or click
      if (!woke) {
        woke = true;
        if (opts.hint) opts.hint.style.opacity = '0';
        keepAwake();
      }
      // Full screen only for real touches, so testing with a mouse on a computer stays normal.
      const d = document.documentElement;
      if (opts.fullscreen && e.pointerType === 'touch' && !document.fullscreenElement && d.requestFullscreen) {
        d.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
      }
    }

    cv.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch (_) {}
      onTouchStart(e);
      const p = pos(e), t = performance.now();
      const rec = { x: p.x, y: p.y, t0: t, hist: [{ x: p.x, y: p.y, t }], grab: false, ox: 0, oy: 0, lastHit: 0, moved: 0, stroke: null };
      if (grabId === null && Math.hypot(p.x - ball.x, p.y - ball.y) < ball.r * 1.35) {
        rec.grab = true;
        grabId = e.pointerId;
        rec.ox = ball.x - p.x; rec.oy = ball.y - p.y;
        ball.vx = ball.vy = 0;
        const k = T.squashMax * 0.6;
        ball.sx = 1 + k; ball.sy = 1 - k;
        burst(ball.x, ball.y, T.sparkMax * 0.5, 140);
      } else {
        rec.stroke = { pts: [{ x: p.x, y: p.y, t }], hue: accentHue(), live: true };
        strokes.push(rec.stroke);
        if (strokes.length > 12) strokes.shift();
      }
      pointers.set(e.pointerId, rec);
    });

    cv.addEventListener('pointermove', e => {
      const rec = pointers.get(e.pointerId);
      if (!rec) return;
      const p = pos(e), t = performance.now();
      const px = rec.x, py = rec.y;
      rec.moved += Math.hypot(p.x - px, p.y - py);
      rec.x = p.x; rec.y = p.y;
      rec.hist.push({ x: p.x, y: p.y, t });
      while (rec.hist.length > 2 && t - rec.hist[0].t > 100) rec.hist.shift();

      if (rec.grab) {
        // Pushing the held ball past a wall presses it flat against that wall; step() keeps it flush.
        const tx = p.x + rec.ox, ty = p.y + rec.oy, r = ball.r;
        const over = (v, hi) => v < r ? r - v : v > hi ? hi - v : 0;   // + past the left/top wall, - past the right/bottom
        const depth = d => Math.sign(d) * T.pressSquash * Math.min(1, Math.abs(d) / (r * 0.6));
        ball.pressX = depth(over(tx, W - r));
        ball.pressY = depth(over(ty, H - r));
        rec.tx = tx; rec.ty = ty;
        ball.x = tx; ball.y = ty;
        const v = velocity(rec);
        ball.vx = v.x; ball.vy = v.y;   // only drives the trail and spin while held
        return;
      }

      rec.stroke.pts.push({ x: p.x, y: p.y, t });
      const fv = velocity(rec);
      rec.peak = Math.max(rec.peak || 0, Math.hypot(fv.x, fv.y));

      // A swipe that starts off the ball and crosses it knocks the ball away.
      if (grabId !== null || t - rec.lastHit < 180) return;
      const hit = segmentHit(px, py, p.x, p.y);
      if (!hit) return;
      const v = velocity(rec);
      const sp = Math.hypot(v.x, v.y);
      if (sp < 250) return;
      rec.lastHit = t;
      rec.hit = true;
      const nv = capSpeed({ x: ball.vx * 0.3 + v.x * T.swipeStrength, y: ball.vy * 0.3 + v.y * T.swipeStrength });
      ball.vx = nv.x; ball.vy = nv.y;
      const ux = v.x / sp, uy = v.y / sp;
      const k = T.squashMax * Math.min(1, sp / T.squashSpeed);
      ball.sx = 1 - Math.abs(ux) * k + Math.abs(uy) * k * 0.5;
      ball.sy = 1 - Math.abs(uy) * k + Math.abs(ux) * k * 0.5;
      burst(hit.x, hit.y, sparksFor(sp), Math.min(sp * 0.4, 600), ux, uy);
      playBoop(Math.min(1, sp / 2000));
    });

    function endPointer(e) {
      const rec = pointers.get(e.pointerId);
      if (!rec) return;
      pointers.delete(e.pointerId);
      if (rec.stroke) rec.stroke.live = false;
      if (rec.grab) {
        grabId = null;
        const last = rec.hist[rec.hist.length - 1];
        // If the finger stopped before lifting, drop the ball in place instead of throwing it.
        const v = performance.now() - last.t > 70 ? { x: 0, y: 0 } : capSpeed(velocity(rec));
        ball.vx = v.x; ball.vy = v.y;
        const sp = Math.hypot(v.x, v.y);
        // A quick tap or pat on the ball nudges it away from the finger, so even a baby's slap moves it.
        if (T.tapNudge > 0 && rec.moved < 12 && performance.now() - rec.t0 < 400) {
          const len = Math.hypot(rec.ox, rec.oy);
          const a = len > ball.r * 0.15 ? Math.atan2(rec.oy, rec.ox) : rand(0, Math.PI * 2);
          ball.vx = Math.cos(a) * T.tapNudge; ball.vy = Math.sin(a) * T.tapNudge;
          burst(ball.x, ball.y, T.sparkMax * 0.5, 160);
        } else if (sp < 120) burst(ball.x, ball.y, T.sparkMax * 0.8, 200);   // a gentle drop: small ring
        else burst(ball.x, ball.y, sparksFor(sp) * 0.6, Math.min(sp * 0.3, 400));
        // A ball let go while pressed flat springs gently off the wall.
        ball.vx += ball.pressX * 2000; ball.vy += ball.pressY * 2000;
        ball.pressX = ball.pressY = 0;
        pressArmed = true; rubDist = 0;
      } else if (rec.moved < 12) {
        burst(rec.x, rec.y, T.sparkMax * 0.6, 150);                   // tapping empty space still sparkles
      } else if (!rec.hit && rec.moved > 60 && rec.peak > 500) {
        playWhiff(Math.min(1, rec.peak / 2500));                      // a real swipe that missed the ball
      }
    }
    cv.addEventListener('pointerup', endPointer);
    cv.addEventListener('pointercancel', endPointer);
    cv.addEventListener('contextmenu', e => e.preventDefault());

    // ---- simulation ----
    function wallHit(speed, x, y, nx, ny) {
      if (speed < T.minImpact) return;
      const k = T.squashMax * Math.min(1, speed / T.squashSpeed);
      if (nx) { ball.sx = 1 - k; ball.sy = 1 + k * 0.6; }
      else    { ball.sy = 1 - k; ball.sx = 1 + k * 0.6; }
      const hue = onWallHitColor();
      burst(x, y, sparksFor(speed), Math.min(speed * 0.45, 700), nx, ny, hue);
      playBonk(Math.min(1, speed / T.maxSpeed));
    }

    function step(dt) {
      ball.r = radius();
      const r = ball.r;
      if (grabId !== null) {
        const rec = pointers.get(grabId);
        const last = rec && rec.hist[rec.hist.length - 1];
        if (last && performance.now() - last.t > 70) { ball.vx = 0; ball.vy = 0; }
        // Follow the finger's target each frame so the ball stays flush as its squash deepens.
        if (rec && rec.tx !== undefined) { ball.x = rec.tx; ball.y = rec.ty; }
      } else {
        ball.x += ball.vx * dt; ball.y += ball.vy * dt;
        const f = Math.exp(-T.friction * dt);
        ball.vx *= f; ball.vy *= f;
        if (Math.hypot(ball.vx, ball.vy) < 5) { ball.vx = 0; ball.vy = 0; }

        if (ball.x < r && ball.vx < 0)     { wallHit(-ball.vx, ball.x - r, ball.y, 1, 0);  ball.vx = -ball.vx * T.bounce; }
        if (ball.x > W - r && ball.vx > 0) { wallHit(ball.vx, ball.x + r, ball.y, -1, 0);  ball.vx = -ball.vx * T.bounce; }
        if (ball.y < r && ball.vy < 0)     { wallHit(-ball.vy, ball.x, ball.y - r, 0, 1);  ball.vy = -ball.vy * T.bounce; }
        if (ball.y > H - r && ball.vy > 0) { wallHit(ball.vy, ball.x, ball.y + r, 0, -1);  ball.vy = -ball.vy * T.bounce; }
      }
      // Ease toward round, or toward the pressed shape while held against a wall.
      const kx = Math.abs(ball.pressX), ky = Math.abs(ball.pressY);
      const relax = Math.min(1, dt * T.squashRecover);
      ball.sx += (1 - kx + ky * 0.6 - ball.sx) * relax;
      ball.sy += (1 - ky + kx * 0.6 - ball.sy) * relax;
      // Keep the squashed outline, not the round one, inside the screen.
      ball.x = clamp(ball.x, r * ball.sx, W - r * ball.sx);
      ball.y = clamp(ball.y, r * ball.sy, H - r * ball.sy);

      const speed = Math.hypot(ball.vx, ball.vy);
      ball.ang += (ball.vx + ball.vy * 0.4) * dt / r;

      if (grabId !== null && T.pressSquash > 0) {
        const depth = Math.max(Math.abs(ball.pressX), Math.abs(ball.pressY)) / T.pressSquash;   // 0..1
        const corner = ball.pressX !== 0 && ball.pressY !== 0;
        const rested = performance.now() - lastSqueak > T.pressGap;
        if (depth >= 0.9 && pressArmed && rested) {
          pressArmed = false; rubDist = 0; lastSqueak = performance.now();
          playSqueak(1, corner);
        } else if (depth < 0.3) {
          pressArmed = true;   // must ease well off before the full-squish squeak can repeat
        }
        // Rubbing counts only movement along a single wall; wiggling in a corner stays quiet.
        if (depth >= 0.3 && !corner) {
          const along = ball.pressX ? Math.abs(ball.vy) : Math.abs(ball.vx);
          rubDist += along * dt;
          if (rubDist > r * 2 && rested) {
            rubDist = 0; lastSqueak = performance.now();
            playSqueak(0.5 * depth * Math.min(1, along / 800), false);
          }
        } else {
          rubDist = 0;
        }
      }

      // Sparks trailing behind a fast ball.
      if (T.speedTrail > 0 && speed > 300) {
        trailAcc += dt * speed * 0.03 * T.speedTrail * (reduceMotion ? 0.3 : 1);
        while (trailAcc >= 1) {
          trailAcc -= 1;
          const a = rand(0, Math.PI * 2), d = rand(0, r * 0.7);
          spark(ball.x + Math.cos(a) * d, ball.y + Math.sin(a) * d,
            -ball.vx * 0.08 + rand(-40, 40), -ball.vy * 0.08 + rand(-40, 40),
            sparkHue(accentHue()), rand(2, 5) * T.sparkSize, T.sparkLife * rand(0.4, 0.9));
        }
      } else {
        trailAcc = 0;
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        const drag = Math.exp(-2.4 * dt);
        p.vx *= drag; p.vy = p.vy * drag + 40 * dt;   // gentle settle downward
        p.x += p.vx * dt; p.y += p.vy * dt;
      }

      const now = performance.now();
      for (let i = strokes.length - 1; i >= 0; i--) {
        const s = strokes[i];
        while (s.pts.length > (s.live ? 1 : 0) && now - s.pts[0].t > T.ribbonLife) s.pts.shift();
        if (!s.live && !s.pts.length) strokes.splice(i, 1);
      }
    }

    // ---- drawing ----
    const WEDGES = 6;
    function draw() {
      ctx.clearRect(0, 0, W, H);

      ctx.globalCompositeOperation = 'lighter';
      for (const p of particles) {
        const a = p.life / p.max;
        ctx.fillStyle = `hsla(${p.h}, 100%, 62%, ${a * 0.25})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.s * 2.4 * (0.5 + a * 0.5), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `hsla(${p.h}, 100%, 75%, ${a})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (0.4 + a * 0.6), 0, Math.PI * 2); ctx.fill();
      }

      // Swipe ribbons: a glowing line that thins and fades behind the finger.
      if (T.ribbonLife > 0 && T.ribbonBright > 0) {
        const now = performance.now();
        ctx.lineCap = 'round';
        for (const s of strokes) {
          for (let i = 1; i < s.pts.length; i++) {
            const a0 = s.pts[i - 1], a1 = s.pts[i];
            const life = 1 - (now - a1.t) / T.ribbonLife;
            if (life <= 0) continue;
            ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y);
            ctx.strokeStyle = `hsla(${s.hue}, 100%, 65%, ${life * 0.22 * T.ribbonBright})`;
            ctx.lineWidth = (6 + 26 * life) * T.ribbonWidth;
            ctx.stroke();
            ctx.strokeStyle = `hsla(${s.hue}, 100%, 85%, ${life * 0.9 * T.ribbonBright})`;
            ctx.lineWidth = (2 + 8 * life) * T.ribbonWidth;
            ctx.stroke();
          }
        }
      }
      ctx.globalCompositeOperation = 'source-over';

      const r = ball.r;
      ctx.save();
      ctx.translate(ball.x, ball.y);
      ctx.scale(ball.sx, ball.sy);

      if (T.glow > 0) {
        const glow = ctx.createRadialGradient(0, 0, r * 0.8, 0, 0, r * 1.7);
        glow.addColorStop(0, `hsla(${accentHue()}, 100%, 65%, ${T.glow})`);
        glow.addColorStop(1, `hsla(${accentHue()}, 100%, 65%, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(0, 0, r * 1.7, 0, Math.PI * 2); ctx.fill();
      }

      // Beach-ball stripes in three colors that spin as it rolls.
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
      ctx.rotate(ball.ang);
      for (let i = 0; i < WEDGES; i++) {
        const a0 = i * Math.PI * 2 / WEDGES, a1 = (i + 1) * Math.PI * 2 / WEDGES;
        ctx.fillStyle = `hsl(${ball.colors[i % 3]}, 88%, 60%)`;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r + 1, a0, a1); ctx.closePath(); ctx.fill();
      }
      ctx.restore();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.17, 0, Math.PI * 2); ctx.fill();

      const shade = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.05, 0, 0, r);
      shade.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
      shade.addColorStop(0.35, 'rgba(255, 255, 255, 0)');
      shade.addColorStop(0.75, 'rgba(10, 14, 50, 0)');
      shade.addColorStop(1, 'rgba(10, 14, 50, 0.45)');
      ctx.fillStyle = shade;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    let lastT = performance.now();
    function frame(t) {
      const dt = Math.min(0.033, Math.max(0, (t - lastT) / 1000));
      lastT = t;
      step(dt);
      draw();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return { ball };
  }

  return { DEFAULTS, ORIGINAL, start };
})();
