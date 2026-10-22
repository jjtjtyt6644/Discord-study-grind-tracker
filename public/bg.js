// Animated aurora + stars background shared by every page. Exposes window.BG.setMode / BG.burst.
window.BG = (() => {
  const $ = (id) => document.getElementById(id);
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const c = $("bg");
  const ctx = c.getContext("2d");
  const themes = {
    idle: [[139, 156, 255], [196, 181, 253], [40, 46, 120]],
    study: [[183, 148, 255], [94, 234, 212], [76, 29, 149]],
    gaming: [[255, 107, 139], [255, 180, 84], [136, 19, 55]],
  };
  const cur = themes.idle.map((col) => [...col]);
  let target = themes.idle;
  let w, h;
  const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
  const stars = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random() * 0.9 + 0.1, tw: Math.random() * 6.28 }));
  const shooters = [];
  const sparks = [];
  const artFrame = $("artFrame");

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    w = innerWidth;
    h = innerHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reduceMotion) frame(0);
  }
  addEventListener("resize", resize);
  addEventListener("pointermove", (e) => {
    mouse.tx = e.clientX / w;
    mouse.ty = e.clientY / h;
    if (!reduceMotion && artFrame) {
      artFrame.style.setProperty("--px", `${(mouse.tx - 0.5) * -18}px`);
      artFrame.style.setProperty("--py", `${(mouse.ty - 0.5) * -10}px`);
    }
  });
  const rgba = (col, a) => `rgba(${col[0] | 0},${col[1] | 0},${col[2] | 0},${a})`;

  function frame(ms) {
    const t = ms / 1000;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cur[i][j] += (target[i][j] - cur[i][j]) * 0.025;
    mouse.x += (mouse.tx - mouse.x) * 0.05;
    mouse.y += (mouse.ty - mouse.y) * 0.05;

    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#07080f";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";

    const big = Math.max(w, h);
    const blobs = [
      [0.15 + 0.1 * Math.sin(t * 0.11), 0.2 + 0.1 * Math.cos(t * 0.15), 0.5, cur[0], 0.12],
      [0.55 + 0.12 * Math.cos(t * 0.09), 0.75 + 0.1 * Math.sin(t * 0.08), 0.55, cur[2], 0.22],
      [0.85, 0.3 + 0.1 * Math.sin(t * 0.1), 0.45, cur[1], 0.08],
    ];
    for (const [bx, by, r, col, a] of blobs) {
      const g = ctx.createRadialGradient(bx * w, by * h, 0, bx * w, by * h, r * big);
      g.addColorStop(0, rgba(col, a));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // two faint aurora ribbons
    for (let k = 0; k < 2; k++) {
      ctx.beginPath();
      for (let x = -40; x <= w + 40; x += 24) {
        const y = h * (0.62 + k * 0.05) + Math.sin(x * 0.003 + t * 0.3 + k * 1.7) * h * 0.06 + Math.sin(x * 0.009 - t * 0.4) * h * 0.015;
        x === -40 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(cur[k], 0.035);
      ctx.lineWidth = 70 + k * 40;
      ctx.stroke();
    }

    for (const s of stars) {
      if (!reduceMotion) s.x = (s.x + 0.00002 * s.z) % 1;
      const px = s.x * w + (mouse.x - 0.5) * -30 * s.z;
      const py = s.y * h + (mouse.y - 0.5) * -30 * s.z;
      const a = 0.2 + 0.6 * Math.abs(Math.sin(t * s.z * 1.4 + s.tw));
      ctx.fillStyle = `rgba(255,255,255,${a * s.z})`;
      ctx.beginPath();
      ctx.arc(px, py, s.z * 1.3, 0, 6.283);
      ctx.fill();
    }

    if (!reduceMotion && Math.random() < 0.004) {
      shooters.push({ x: Math.random() * w * 0.7, y: Math.random() * h * 0.4, vx: -(6 + Math.random() * 5), vy: 2.5 + Math.random() * 2.5, life: 1 });
    }
    for (let i = shooters.length - 1; i >= 0; i--) {
      const s = shooters[i];
      s.x += s.vx;
      s.y += s.vy;
      s.life -= 0.02;
      const g = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * 12, s.y - s.vy * 12);
      g.addColorStop(0, `rgba(255,255,255,${s.life * 0.8})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - s.vx * 12, s.y - s.vy * 12);
      ctx.stroke();
      if (s.life <= 0) shooters.splice(i, 1);
    }

    ctx.globalCompositeOperation = "source-over";
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      p.vy += 0.12;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.01;
      ctx.fillStyle = rgba(p.col, Math.max(0, p.life));
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.r += p.vr));
      ctx.fillRect(-4, -2, 8, 4);
      ctx.restore();
      if (p.life <= 0) sparks.splice(i, 1);
    }

    if (!reduceMotion) requestAnimationFrame(frame);
  }

  resize();
  if (!reduceMotion) requestAnimationFrame(frame);

  return {
    setMode(m) {
      target = themes[m] ?? themes.idle;
    },
    burst(x, y) {
      if (reduceMotion) return;
      const palette = [...cur, [255, 255, 255]];
      for (let i = 0; i < 150; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 3 + Math.random() * 9;
        sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 4, life: 1, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, col: palette[i % palette.length] });
      }
    },
  };
})();

// App-window heartbeat: the desktop app opens the dashboard with ?window=1. That window (and the
// Guide/About pages it navigates to, via sessionStorage) tells the app it's alive, so closing it
// can quit the app and free the port. Normal browser tabs never send this.
(() => {
  let isWindow = false;
  try {
    if (new URLSearchParams(location.search).has("window")) sessionStorage.setItem("gt-window", "1");
    isWindow = sessionStorage.getItem("gt-window") === "1";
  } catch {}
  if (!isWindow) return;
  const post = (p) => fetch(p, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", keepalive: true }).catch(() => {});
  post("/api/heartbeat");
  setInterval(() => post("/api/heartbeat"), 5000);
  addEventListener("pagehide", () => navigator.sendBeacon("/api/closing", new Blob(["{}"], { type: "application/json" })));
})();
