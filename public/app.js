const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const hm = (min) => {
  min = Math.max(0, Math.floor(min));
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
};
const hms = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [s / 3600, (s / 60) % 60, s % 60].map((n) => String(Math.floor(n)).padStart(2, "0")).join(":");
};
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* ================= animated background ================= */
const BG = (() => {
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
    if (!reduceMotion) {
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

/* ================= character panel ================= */
const LINES = {
  idle: ["on break? don't take too long.", "i'll wait. not forever though.", "hit start when you're ready."],
  study: ["locked in. i'm watching.", "eyes on the page.", "keep going, you're doing fine."],
  gaming: ["one more game... then back to work.", "winning? good. now study.", "i saw that. budget's ticking."],
  goal: ["goal cleared. not bad at all.", "that's the grind. proud of you."],
};
const PLATE = { idle: "STANDBY", study: "LOCKED IN", gaming: "IN GAME" };
let typing = null;
function say(kind) {
  const bubble = $("bubble");
  const pool = LINES[kind];
  const line = pool[Math.floor(Math.random() * pool.length)];
  clearInterval(typing);
  bubble.classList.remove("pop", "done");
  void bubble.offsetWidth;
  bubble.classList.add("pop");
  if (reduceMotion) {
    bubble.textContent = line;
    bubble.classList.add("done");
    return;
  }
  let i = 0;
  bubble.textContent = "";
  typing = setInterval(() => {
    bubble.textContent = line.slice(0, ++i);
    if (i >= line.length) {
      clearInterval(typing);
      bubble.classList.add("done");
    }
  }, 32);
}
$("artImg").addEventListener("error", () => document.body.classList.add("no-art"));
$("logo").addEventListener("error", (e) => e.target.replaceWith(el("span", "logo-fallback", "◆")));

/* ================= segmented bars ================= */
function setSeg(node, pct, n = Number(node.dataset.n || 20)) {
  if (node.children.length !== n) {
    node.style.setProperty("--n", n);
    node.replaceChildren(...Array.from({ length: n }, () => el("i")));
  }
  const filled = Math.round(Math.min(1, Math.max(0, pct)) * n);
  [...node.children].forEach((cell, i) => {
    const on = i < filled;
    if (cell.classList.contains("on") !== on) {
      cell.style.transitionDelay = `${(on ? i : n - i) * 25}ms`;
      cell.classList.toggle("on", on);
    }
  });
}

/* ================= data ================= */
let stats = null;
let skew = 0;
let lastMode = null;
let goalCelebrated = null;

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error || res.statusText);
  return out;
}

async function refresh() {
  try {
    apply(await api("/api/stats"));
  } catch {
    showNotice("Can't reach the Grind Tracker server. Is `npm start` still running?");
  }
}

function apply(next) {
  stats = next;
  skew = stats.now - Date.now();
  render();
  tick();
}

function showNotice(msg) {
  const n = $("notice");
  n.hidden = !msg;
  n.textContent = msg || "";
}

const liveStudyMs = () => {
  if (!stats) return 0;
  const { todayMs, activeSince } = stats.study;
  return activeSince ? todayMs + (Date.now() + skew - stats.now) : todayMs;
};

/* ================= render ================= */
function render() {
  const { mode, study, played, steam, steamError, discord } = stats;
  document.body.dataset.mode = mode;
  BG.setMode(mode);
  $("modeLabel").textContent = mode === "study" ? "LOCKED IN" : mode === "gaming" ? "IN GAME" : "ON BREAK";
  $("plateMode").textContent = PLATE[mode];
  if (mode !== lastMode) {
    say(mode);
    lastMode = mode;
  }

  const notes = [];
  if (steamError) notes.push(`Steam: ${steamError}`);
  if (steam?.demo) notes.push("Demo mode: add your Steam key and SteamID to .env to see your real stats.");
  showNotice(notes.join("  ·  "));

  // hero side
  const playMin = played.todayMinutes;
  const over = playMin > played.budgetMinutes;
  $("playToday").textContent = hm(playMin);
  setSeg($("playSeg"), playMin / played.budgetMinutes, 12);
  $("playSeg").classList.toggle("over", over);
  $("playTxt").textContent = over ? `${hm(playMin - played.budgetMinutes)} over budget` : `of ${hm(played.budgetMinutes)} budget`;
  $("goalTxt").textContent = `of ${hm(study.goalMinutes)} goal`;

  // session button
  $("studyBtn").classList.toggle("running", !!study.activeSince);
  $("studyBtnText").textContent = study.activeSince ? "End session" : "Start studying";

  renderSteam(steam);
  renderAchievements(steam?.achievements);
  if (JSON.stringify(steam?.recent) !== renderGames.last) renderGames(steam?.recent ?? []);
  renderWeek(study.week, study.goalMinutes);
  renderDiscord(discord);
}

function renderSteam(steam) {
  const av = $("avatar");
  if (!steam) {
    av.replaceChildren();
    $("pname").textContent = "Steam not connected";
    $("pstatus").textContent = "add your key to .env";
    $("now").replaceChildren(el("div", "empty", "Add STEAM_API_KEY and STEAM_ID64 to .env"));
    return;
  }
  const p = steam.profile;
  if (av.dataset.src !== (p.avatar ?? "")) {
    av.dataset.src = p.avatar ?? "";
    av.replaceChildren();
    if (p.avatar) {
      const img = el("img");
      img.src = p.avatar;
      img.alt = "";
      av.append(img);
    } else av.textContent = (p.name || "?").slice(0, 1).toUpperCase();
  }
  av.className = "avatar " + (p.currentGame ? "ingame" : p.status !== "Offline" ? "online" : "");
  $("pname").textContent = p.name;
  $("pstatus").textContent = p.currentGame ? "In-game" : p.status;
  $("pdot").className = "dot" + (p.status !== "Offline" ? " on" : "");
  $("level").textContent = p.level ?? "-";
  $("owned").textContent = steam.ownedCount.toLocaleString();
  $("lifetime").textContent = steam.totalHours.toLocaleString();

  const now = $("now");
  const g = p.currentGame ?? steam.recent[0];
  const key = String(p.currentGame ? `live-${g.appid}` : `last-${g?.appid}`);
  if (now.dataset.key === key) return;
  now.dataset.key = key;
  now.classList.toggle("live", !!p.currentGame);
  if (!g) return now.replaceChildren(el("div", "empty", "No recent games."));
  const img = el("img");
  img.src = g.header;
  img.alt = "";
  img.onerror = () => img.remove();
  const cap = el("div", "cap");
  cap.append(el("small", null, p.currentGame ? "● NOW PLAYING" : "LAST PLAYED"), document.createTextNode(g.name));
  now.replaceChildren(img, cap);
}

function renderAchievements(a) {
  const body = $("achBody");
  const sig = JSON.stringify(a);
  if (body.dataset.sig === sig) return;
  body.dataset.sig = sig;
  if (!a) return body.replaceChildren(el("p", "muted", "No achievement data for this game."));

  const count = el("div", "count");
  count.append(document.createTextNode(`${a.unlocked}`), el("small", null, ` / ${a.total}`));
  const bar = el("div", "bar");
  const fill = el("i");
  bar.append(fill);
  const meta = el("div", "meta");
  meta.append(el("span", null, `${Math.round((a.unlocked / a.total) * 100)}% complete`), el("span", null, a.unlocked === a.total ? "PERFECT" : `${a.total - a.unlocked} left`));
  body.replaceChildren(el("div", "game", a.game), count, bar, meta);
  setTimeout(() => (fill.style.width = `${(a.unlocked / a.total) * 100}%`), 60);

  if (a.latest) {
    const row = el("div", "latest");
    const ic = el("div", "ic");
    if (a.latest.icon) {
      const img = el("img");
      img.src = a.latest.icon;
      img.alt = "";
      ic.append(img);
    } else ic.textContent = "★";
    const txt = el("div");
    txt.append(el("small", null, `Latest unlock · ${ago(a.latest.time)}`), el("b", null, a.latest.name));
    row.append(ic, txt);
    body.append(row);
  }
}

function renderGames(games) {
  renderGames.last = JSON.stringify(games);
  const strip = $("strip");
  strip.replaceChildren();
  if (!games.length) return strip.append(el("p", "muted", "Nothing played in the last 2 weeks."));
  const max = Math.max(...games.map((g) => g.minutes2w), 1);
  games.slice(0, 6).forEach((g, i) => {
    const tile = el("div", "tile");
    tile.style.animationDelay = `${i * 0.06}s`;
    const img = el("img");
    img.src = g.header;
    img.alt = "";
    img.loading = "lazy";
    const meta = el("div", "meta");
    meta.append(el("b", null, g.name), el("span", null, `${(g.minutes2w / 60).toFixed(1)}h recent · ${Math.round(g.minutesTotal / 60)}h total`));
    const bar = el("div", "tbar");
    const glare = el("div", "glare");
    tile.append(img, meta, bar, glare);
    strip.append(tile);
    setTimeout(() => (bar.style.transform = `scaleX(${g.minutes2w / max})`), 60);

    if (!reduceMotion) {
      tile.addEventListener("pointermove", (e) => {
        const r = tile.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        tile.style.transform = `rotateY(${(x - 0.5) * 12}deg) rotateX(${(0.5 - y) * 12}deg) translateZ(8px)`;
        glare.style.background = `radial-gradient(circle at ${x * 100}% ${y * 100}%, rgba(255,255,255,.2), transparent 60%)`;
      });
      tile.addEventListener("pointerleave", () => (tile.style.transform = ""));
    }
  });
}

function renderWeek(week, goal) {
  const chart = $("chart");
  const minutesFor = (d, i) => (i === week.length - 1 ? liveStudyMs() / 60000 : d.minutes);
  const max = Math.max(goal * 1.15, ...week.map(minutesFor), 1);
  let cols = chart.querySelectorAll(".col");
  if (cols.length !== week.length) {
    chart.querySelectorAll(".col").forEach((c) => c.remove());
    for (let i = 0; i < week.length; i++) {
      const col = el("div", "col");
      col.append(el("div", "b"), el("span", "lbl"));
      chart.append(col);
    }
    cols = chart.querySelectorAll(".col");
  }
  // chart area excludes the 22px label gutter
  $("goalLine").style.bottom = `calc(22px + (100% - 22px) * ${goal / max})`;
  week.forEach((d, i) => {
    const col = cols[i];
    const minutes = minutesFor(d, i);
    col.className = "col" + (i === week.length - 1 ? " today" : "") + (minutes >= goal ? " hit" : "");
    col.title = `${d.date}: ${hm(minutes)}`;
    col.lastChild.textContent = new Date(d.date + "T12:00").toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2);
    setTimeout(() => (col.firstChild.style.height = `${(minutes / max) * 100}%`), 30);
  });

  const total = week.reduce((s, d, i) => s + minutesFor(d, i), 0);
  $("weekTotal").textContent = hm(total);
  let streak = 0;
  for (let i = week.length - 1; i >= 0; i--) {
    if (minutesFor(week[i], i) > 0) streak++;
    else if (i !== week.length - 1) break;
  }
  $("streak").textContent = streak ? `${streak}-day streak` : "no streak yet";
}

function renderDiscord(d) {
  const chip = $("discordChip");
  chip.querySelector(".dot").className = "dot" + (d.connected ? " on" : d.enabled ? " warn" : "");
  chip.lastChild.textContent = d.connected ? "Discord live" : d.enabled ? "Waiting for Discord" : "Discord off";
  $("dcHint").textContent = d.connected
    ? "Live on your profile · refreshes every 15s"
    : d.enabled
      ? "Open the Discord desktop app and it'll connect automatically."
      : "Set DISCORD_CLIENT_ID in .env to show this on your profile.";

  const a = d.activity;
  $("dcDetails").textContent = a.details;
  $("dcState").textContent = a.state;
  const img = $("dcImg");
  const src = a.largeImageKey?.startsWith("http") ? a.largeImageKey : a.largeImageKey ? "img/logo.png" : null;
  if (img.dataset.src !== (src ?? "")) {
    img.dataset.src = src ?? "";
    img.replaceChildren();
    if (src) {
      const i = el("img");
      i.src = src;
      i.alt = "";
      img.append(i);
    }
  }
}

/* ================= live ticking ================= */
function renderTimer(text, idle) {
  const timer = $("timer");
  timer.classList.toggle("idle", idle);
  if (timer.children.length !== text.length) {
    timer.replaceChildren(...[...text].map((ch) => el("span", ch === ":" ? "c" : "d", ch)));
    return;
  }
  [...text].forEach((ch, i) => {
    const span = timer.children[i];
    if (span.textContent !== ch) {
      span.textContent = ch;
      span.classList.remove("tick");
      void span.offsetWidth;
      span.classList.add("tick");
    }
  });
}

function renderBig(min) {
  const big = $("bigStudy");
  const [hEl, , mEl] = big.children;
  hEl.textContent = String(Math.floor(min / 60));
  mEl.textContent = String(Math.floor(min % 60)).padStart(2, "0");
}

function tick() {
  const now = new Date();
  $("clock").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("dateLabel").textContent = now.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }).toUpperCase();
  if (!stats) return;
  const { study, discord } = stats;
  const nowServer = Date.now() + skew;
  const todayMin = liveStudyMs() / 60000;
  const pct = todayMin / study.goalMinutes;

  renderBig(todayMin);
  // the running session counts too
  const liveMs = study.activeSince ? nowServer - study.activeSince : 0;
  $("sessCount").textContent = (study.sessionsToday ?? 0) + (study.activeSince ? 1 : 0);
  $("sessLong").textContent = hm(Math.max(study.longestSessionMs ?? 0, liveMs) / 60000).replace(/^0h /, "");
  setSeg($("goalSeg"), pct, 20);
  $("goalPct").textContent = `${Math.round(pct * 100)}%`;
  renderTimer(hms(study.activeSince ? nowServer - study.activeSince : 0), !study.activeSince);
  $("timerSub").textContent = study.activeSince
    ? `session started ${new Date(study.activeSince).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "ready when you are";

  if (goalCelebrated === null) goalCelebrated = pct >= 1;
  if (!goalCelebrated && pct >= 1) {
    goalCelebrated = true;
    const r = $("goalSeg").getBoundingClientRect();
    BG.burst(r.right, r.top);
    say("goal");
  }

  const start = discord.activity.startTimestamp;
  $("dcTime").textContent = start ? `${hms(nowServer - start)} elapsed` : "";
}

/* ================= controls ================= */
async function toggleStudy(e) {
  const btn = $("studyBtn");
  if (e?.clientX) {
    const r = btn.getBoundingClientRect();
    const rip = el("span", "rip");
    const size = Math.max(r.width, r.height);
    Object.assign(rip.style, { width: `${size}px`, height: `${size}px`, left: `${e.clientX - r.left - size / 2}px`, top: `${e.clientY - r.top - size / 2}px` });
    btn.append(rip);
    setTimeout(() => rip.remove(), 600);
  }
  btn.disabled = true;
  try {
    apply(await api(stats?.study.activeSince ? "/api/study/stop" : "/api/study/start", {}));
  } catch (err) {
    showNotice(err.message);
  } finally {
    btn.disabled = false;
  }
}
$("studyBtn").addEventListener("click", toggleStudy);
addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat || $("settings").open) return;
  if (["INPUT", "BUTTON", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  e.preventDefault();
  toggleStudy();
});

$("addForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("addMin");
  try {
    apply(await api("/api/study/add", { minutes: Number(input.value) }));
    input.value = "";
  } catch (err) {
    showNotice(err.message);
  }
});

const dialog = $("settings");
$("settingsBtn").addEventListener("click", () => {
  $("goalIn").value = stats?.study.goalMinutes ?? 240;
  $("budgetIn").value = stats?.played.budgetMinutes ?? 120;
  dialog.showModal();
});
dialog.addEventListener("close", async () => {
  if (dialog.returnValue !== "save") return;
  try {
    apply(await api("/api/settings", { goalMinutes: Number($("goalIn").value), playBudgetMinutes: Number($("budgetIn").value) }));
    goalCelebrated = liveStudyMs() / 60000 >= stats.study.goalMinutes;
  } catch (err) {
    showNotice(err.message);
  }
});

tick();
refresh();
setInterval(refresh, 5000);
setInterval(tick, 1000);
