/* Katya FX — клубная атмосфера для панели: лучи света, дым, фонари, параллакс.
   Подключение: <script src="/katya-fx.js" defer></script> (после katya.css).
   Рисует на одном <canvas> за контентом. Экономно: 30 кадров/с, DPR ≤ 1,
   пауза при скрытой вкладке, уважает prefers-reduced-motion. */
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const enabled = true;

  // ---------- canvas ----------
  const canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d', { alpha: true });
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(1, devicePixelRatio || 1);
    W = canvas.width = Math.floor(innerWidth * DPR);
    H = canvas.height = Math.floor(innerHeight * DPR);
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
    buildSmoke();
  }

  // ---------- palette: Techno Punch ----------
  const BEAMS = [
    { hue: 150, sat: 70, x: 0.08, period: 23, spread: 0.34, alpha: 0.16 },   // мятный, слева
    { hue: 270, sat: 80, x: 0.55, period: 31, spread: 0.30, alpha: 0.14 },   // фиолетовый, центр
    { hue: 320, sat: 85, x: 0.92, period: 27, spread: 0.32, alpha: 0.12 },   // маджента, справа
    { hue: 195, sat: 85, x: 0.30, period: 37, spread: 0.26, alpha: 0.10 },   // циан
  ];
  const LANTERNS = Array.from({ length: 9 }, (_, i) => ({
    x: (i + 0.5) / 9 + (Math.sin(i * 7.3) * 0.03), y: 0.06 + (i % 3) * 0.035,
    hue: [150, 270, 320, 195][i % 4], size: 2.2 + (i % 3), phase: i * 0.7,
  }));

  // дым: несколько размытых пятен, предрендеренных один раз в offscreen-канвас
  let smokeSprite = null;
  const puffs = Array.from({ length: 7 }, (_, i) => ({
    x: Math.random(), y: 0.55 + Math.random() * 0.5, r: 0.28 + Math.random() * 0.22,
    vx: (0.004 + Math.random() * 0.006) * (i % 2 ? 1 : -1), vy: -(0.002 + Math.random() * 0.003),
    alpha: 0.05 + Math.random() * 0.05, phase: Math.random() * 6.28,
  }));
  function buildSmoke() {
    const s = Math.max(200, Math.floor(Math.min(W, H) * 0.6));
    smokeSprite = document.createElement('canvas');
    smokeSprite.width = smokeSprite.height = s;
    const g = smokeSprite.getContext('2d');
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(190,200,220,1)');
    grad.addColorStop(0.45, 'rgba(190,200,220,.45)');
    grad.addColorStop(1, 'rgba(190,200,220,0)');
    g.fillStyle = grad; g.fillRect(0, 0, s, s);
  }

  // ---------- parallax ----------
  const par = { mx: 0, my: 0, tx: 0, ty: 0, scroll: 0 };
  addEventListener('pointermove', e => { par.tx = (e.clientX / innerWidth - 0.5); par.ty = (e.clientY / innerHeight - 0.5); }, { passive: true });
  addEventListener('scroll', () => { par.scroll = scrollY; }, { passive: true });

  // ---------- render ----------
  const BPM = 128, beat = 60 / BPM;
  let last = 0, raf = 0;
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (t - last < 33) return;                       // ~30 fps достаточно для фона
    last = t;
    const time = t / 1000;
    par.mx += (par.tx - par.mx) * 0.06; par.my += (par.ty - par.my) * 0.06;
    const pulse = 0.5 + 0.5 * Math.pow(Math.max(0, Math.cos((time % beat) / beat * Math.PI * 2)), 6); // мягкий удар на каждую долю
    const sy = -par.scroll * 0.12 * DPR;             // фон едет медленнее контента

    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';

    // лучи из-под потолка
    for (const b of BEAMS) {
      const sway = Math.sin(time / b.period * Math.PI * 2 + b.x * 9) * 0.55;
      const ox = (b.x + par.mx * 0.08) * W, oy = -0.08 * H + sy * 0.5;
      const len = H * 1.35;
      const ang = Math.PI / 2 + sway * 0.6 + par.mx * 0.15;
      const ex = ox + Math.cos(ang) * len, ey = oy + Math.sin(ang) * len;
      const half = b.spread * W * 0.5;
      const nx = -Math.sin(ang) * half, ny = Math.cos(ang) * half;
      const grad = ctx.createLinearGradient(ox, oy, ex, ey);
      const a = b.alpha * (0.75 + pulse * 0.35);
      grad.addColorStop(0, `hsla(${b.hue},${b.sat}%,70%,${a})`);
      grad.addColorStop(0.6, `hsla(${b.hue},${b.sat}%,60%,${a * 0.35})`);
      grad.addColorStop(1, `hsla(${b.hue},${b.sat}%,55%,0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(ox - nx * 0.06, oy - ny * 0.06); ctx.lineTo(ox + nx * 0.06, oy + ny * 0.06);
      ctx.lineTo(ex + nx, ey + ny); ctx.lineTo(ex - nx, ey - ny); ctx.closePath(); ctx.fill();
    }

    // дым
    if (smokeSprite) {
      for (const p of puffs) {
        p.x += p.vx / 60; p.y += p.vy / 60;
        if (p.x < -0.4) p.x = 1.4; if (p.x > 1.4) p.x = -0.4; if (p.y < -0.3) p.y = 1.2;
        const r = p.r * Math.max(W, H) * (1 + 0.08 * Math.sin(time * 0.3 + p.phase));
        ctx.globalAlpha = p.alpha * (0.8 + 0.2 * Math.sin(time * 0.2 + p.phase));
        ctx.drawImage(smokeSprite, (p.x + par.mx * 0.03) * W - r, p.y * H + sy * 0.3 - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
    }

    // фонари под потолком
    for (const l of LANTERNS) {
      const x = (l.x + par.mx * 0.12) * W, y = l.y * H + Math.sin(time * 0.8 + l.phase) * 3 * DPR + sy * 0.8 + par.my * 10 * DPR;
      const glow = 0.35 + pulse * 0.65;
      const R = (l.size * 9) * DPR * (0.8 + glow * 0.6);
      const g = ctx.createRadialGradient(x, y, 0, x, y, R);
      g.addColorStop(0, `hsla(${l.hue},90%,80%,${0.55 * glow})`);
      g.addColorStop(0.25, `hsla(${l.hue},90%,65%,${0.25 * glow})`);
      g.addColorStop(1, `hsla(${l.hue},90%,60%,0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `hsla(${l.hue},100%,92%,${0.8 + 0.2 * glow})`;
      ctx.beginPath(); ctx.arc(x, y, l.size * DPR, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function start() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
  function stop() { cancelAnimationFrame(raf); raf = 0; }
  function apply() {
    document.documentElement.classList.toggle('fx-on', enabled);
    canvas.style.display = enabled ? 'block' : 'none';
    if (enabled && !document.hidden && !reduced) start(); else stop();
    if (enabled && reduced && !document.hidden) {
      frame(performance.now());
      stop(); // frame() планирует следующий кадр; отменяем его в режиме reduced motion
    }
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (enabled && !reduced) start(); });
  addEventListener('resize', resize, { passive: true });

  resize(); apply();
})();
