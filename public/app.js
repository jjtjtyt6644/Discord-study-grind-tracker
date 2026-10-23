const $ = (id) => document.getElementById(id);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const hm = (min) => {
  min = Math.max(0, Math.floor(min));
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
};
// "7m" under an hour, "1h 05m" after
const mins = (m) => (m < 60 ? `${Math.floor(Math.max(0, m))}m` : hm(m));
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
  if (!res.ok) throw Object.assign(new Error(out.error || res.statusText), { confirm: Boolean(out.confirm) });
  return out;
}

async function refresh() {
  try {
    apply(await api("/api/stats"));
  } catch {
    if ($("quitScreen").hidden) showNotice(stats?.app?.desktop ? "Can't reach Grind Tracker. Is GrindTracker.exe still running?" : "Can't reach the Grind Tracker server. Is `npm start` still running?");
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
  $("modeLabel").textContent = mode === "study" ? "LOCKED IN" : mode === "gaming" ? (stats.game ? `IN ${stats.game.name.toUpperCase()}`.slice(0, 32) : "IN GAME") : study.pausedAt ? "PAUSED" : "ON BREAK";
  $("plateMode").textContent = PLATE[mode];
  if (mode !== lastMode) {
    say(mode);
    lastMode = mode;
  }

  const notes = [];
  if (steamError) notes.push(`Steam: ${steamError}`);
  if (!stats.config.complete) notes.push("Demo mode: click here to connect your Steam & Discord.");
  showNotice(notes.join("  ·  "));
  $("watermark").textContent = `${$("modeLabel").textContent} · ${$("modeLabel").textContent}`;

  // hero side
  const playMin = played.todayMinutes;
  const over = playMin > played.budgetMinutes;
  $("playToday").textContent = hm(playMin);
  setSeg($("playSeg"), playMin / played.budgetMinutes, 12);
  $("playSeg").classList.toggle("over", over);
  const left = played.budgetMinutes - playMin;
  const soon = !over && left <= 15 && played.budgetMinutes > 15;
  $("playTxt").textContent = over ? `${hm(playMin - played.budgetMinutes)} over budget` : soon ? `only ${hm(left)} left of ${hm(played.budgetMinutes)}` : `of ${hm(played.budgetMinutes)} budget`;
  $("playTxt").classList.toggle("warn", soon);
  $("goalTxt").textContent = `of ${hm(study.goalMinutes)} goal`;
  renderNowPlaying();

  // session buttons: Start → (End | Pause) → paused: (Resume | End)
  const paused = !study.activeSince && study.pausedAt;
  $("studyBtn").classList.toggle("running", !!study.activeSince);
  $("studyBtn").classList.toggle("paused", !!paused);
  $("studyBtnText").textContent = study.activeSince ? "End session" : paused ? "Resume" : "Start studying";
  const inFocus = stats.focus?.phase === "focus";
  $("pauseBtn").hidden = !(study.activeSince || paused) || inFocus;
  $("pauseBtn").textContent = paused ? "End" : "Pause";
  $("pauseBtn").title = paused ? "End the session (it's already saved)" : "Pause (P)";
  renderStatusPick();
  renderSubjectGoals();
  $("weekReportBtn").classList.toggle("new", weekReportIsNew());

  renderSteam(steam);
  renderAchievements();
  if (JSON.stringify(steam?.recent) !== renderGames.last) renderGames(steam?.recent ?? []);
  renderWeek(study.week, study.goalMinutes);
  renderDiscord(discord);
  renderSubjectPick();
  renderSubjects();
  renderLog();
  renderProgress();
  renderHeatmap();
  renderMarquee();
  renderUpdate();
  renderActivity();
  renderFocus();
  renderQuests();
  applyTheme(stats.prefs?.theme);
  showInbox();
  if (settingsDlg.open) renderSettings();
  maybeOpenSetup();
  window.GT_vocab(stats.prefs?.activity); // studied → worked etc. everywhere, if Working is on
}

/* ================= updates ================= */
function renderUpdate() {
  const u = stats.app?.update;
  const bar = $("updateBar");
  if (!u) return (bar.hidden = true);
  const dismissed = store.get("gt-update-dismissed") === u.latest;
  const sig = JSON.stringify([u.status, u.latest, u.error, dismissed, Math.round((u.progress ?? 0) * 100)]);
  if (bar.dataset.sig === sig) return;
  bar.dataset.sig = sig;

  const link = (text, href) => {
    const a = el("a", "ub-btn ghost", text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    return a;
  };
  const btn = (text, cls, fn) => {
    const b = el("button", `ub-btn ${cls}`, text);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  };
  const close = btn("×", "ub-x", () => {
    store.set("gt-update-dismissed", u.latest);
    bar.hidden = true;
  });
  close.setAttribute("aria-label", "Dismiss");

  let parts = null;
  if (u.status === "ready") {
    parts = [el("span", "ub-dot"), el("b", null, `Grind Tracker v${u.latest} is installed.`), el("span", null, "Restart to start using it, or it'll be there next time you open the app."), btn("Restart now", "solid", restartForUpdate)];
  } else if (u.status === "downloading") {
    const pct = Math.round((u.progress ?? 0) * 100);
    const bar = el("span", "ub-bar");
    const fill = el("i");
    fill.style.width = `${pct}%`;
    bar.append(fill);
    parts = [el("span", "ub-spin"), el("b", null, `Downloading v${u.latest}… ${pct}%`), bar];
  } else if (u.status === "available" && !dismissed) {
    parts = [el("span", "ub-dot"), el("b", null, `v${u.latest} is out.`), u.canInstall ? btn("Install now", "solid", installUpdate) : link("Download ↗", u.url), link("What's new ↗", u.url), close];
  } else if (u.status === "error" && u.latest && u.latest !== stats.app.version && !dismissed) {
    parts = [el("span", "ub-dot err"), el("b", null, `Couldn't install v${u.latest}.`), el("span", null, u.error ?? ""), link("Download manually ↗", u.url), close];
  }
  bar.hidden = !parts;
  if (parts) bar.replaceChildren(...parts);
}

async function installUpdate() {
  try {
    toast("Downloading the update…");
    apply(await api("/api/update/install", {}));
  } catch (err) {
    toast(err.message, true);
  }
}

async function restartForUpdate() {
  const target = stats.app.update.latest;
  try {
    await api("/api/update/restart", {});
  } catch (err) {
    return toast(err.message, true);
  }
  $("restartScreen").hidden = false;
  // wait for the new version to answer on the same port, then load its dashboard
  const started = Date.now();
  const poll = setInterval(async () => {
    const v = await fetch("/api/ping").then((r) => r.json()).then((j) => j.version).catch(() => null);
    if (v === target) {
      clearInterval(poll);
      location.reload();
    } else if (Date.now() - started > 40_000) {
      clearInterval(poll);
      $("restartMsg").textContent = "The new version didn't start. Open GrindTracker.exe again; it's already updated.";
    }
  }, 1000);
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
  // a game from another launcher (detected on your PC) shows here too while you play it
  const other = !p.currentGame && stats.game && stats.game.source !== "steam" ? stats.game : null;
  const g = p.currentGame ?? other ?? steam.recent[0];
  const key = String(p.currentGame ? `live-${g.appid}` : other ? `pc-${other.name}` : `last-${g?.appid}`);
  if (now.dataset.key === key) return;
  now.dataset.key = key;
  now.classList.toggle("live", !!(p.currentGame || other));
  now.classList.toggle("detected", !!other);
  if (!g) return now.replaceChildren(el("div", "empty", "No recent games."));
  const img = el("img");
  img.src = other ? (other.icon ?? "") : g.header;
  img.alt = "";
  img.onerror = () => img.remove();
  if (other && !other.icon) img.remove();
  const cap = el("div", "cap");
  cap.append(el("small", null, p.currentGame ? "● NOW PLAYING" : other ? "● NOW PLAYING · NOT ON STEAM" : "LAST PLAYED"), document.createTextNode(g.name));
  now.replaceChildren(...(other && !other.icon ? [] : [img]), cap);
}

// rarity tiers by % of all Steam players who have the achievement
const rarity = (pct) => (pct == null ? null : pct < 5 ? ["ultra", "Ultra rare"] : pct < 15 ? ["rare", "Rare"] : pct < 40 ? ["uncommon", "Uncommon"] : ["common", "Common"]);

function achRow(x, note) {
  const row = el("li", "arow");
  const ic = el("div", "ic");
  if (x.icon) {
    const img = el("img");
    img.src = x.icon;
    img.alt = "";
    img.loading = "lazy";
    ic.append(img);
  } else ic.textContent = x.time ? "★" : "?";
  const txt = el("div", "atxt");
  txt.append(el("b", null, x.name), el("small", null, x.desc || note || ""));
  row.append(ic, txt);
  const r = rarity(x.pct);
  if (r) {
    const pill = el("span", `pill ${r[0]}`, `${x.pct.toFixed(1)}%`);
    pill.title = `${r[1]}: ${x.pct.toFixed(1)}% of players have this`;
    row.append(pill);
  }
  return row;
}

// "auto" follows your current / last played game; picking a game pins the card to it
let achPick = "auto";
let achPicked = null; // { appid, at, data }

async function loadPickedAchievements() {
  if (achPick === "auto") return;
  const g = stats.steam?.recent.find((x) => String(x.appid) === achPick);
  try {
    const data = await api(`/api/achievements?appid=${achPick}&name=${encodeURIComponent(g?.name ?? "")}`);
    achPicked = { appid: achPick, at: Date.now(), data };
  } catch (err) {
    achPicked = { appid: achPick, at: Date.now(), data: { error: "failed", message: err.message } };
  }
  renderAchievements();
}

$("achPick").addEventListener("change", (e) => {
  achPick = e.target.value;
  achPicked = null;
  if (achPick === "auto") renderAchievements();
  else {
    $("achBody").replaceChildren(el("p", "muted", "Loading achievements…"));
    $("achBody").dataset.sig = "";
    loadPickedAchievements();
  }
});

function renderAchPicker() {
  const pick = $("achPick");
  const games = stats.steam?.recent ?? [];
  const sig = JSON.stringify(games.map((g) => g.appid));
  pick.hidden = games.length < 2;
  if (pick.dataset.sig === sig) return;
  pick.dataset.sig = sig;
  const auto = el("option", null, "Current / last game");
  auto.value = "auto";
  pick.replaceChildren(
    auto,
    ...games.map((g) => {
      const o = el("option", null, g.name);
      o.value = String(g.appid);
      return o;
    })
  );
  pick.value = games.some((g) => String(g.appid) === achPick) ? achPick : "auto";
}

function achProblem(a) {
  const box = el("div", "ach-empty");
  if (a.error === "private") {
    box.classList.add("private");
    const steps = el("ol");
    for (const t of ["Open your Steam privacy settings", "Set Game details to Public", "Wait a few minutes; this card updates on its own"]) steps.append(el("li", null, t));
    const link = el("a", "cta-link small-cta", "Open Steam privacy settings ↗");
    link.href = "https://steamcommunity.com/my/edit/settings";
    link.target = "_blank";
    link.rel = "noopener";
    const lock = el("div", "lock");
    lock.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
    box.append(lock, el("b", null, "Your achievements are hidden"), el("p", null, `Steam only shares achievements${a.game ? ` for ${a.game}` : ""} when your profile's Game details are Public.`), steps, link);
  } else if (a.error === "none") {
    box.append(el("b", null, `${a.game ?? "This game"} has no Steam achievements`), el("p", null, "Pick another game from the menu above."));
  } else {
    box.append(el("b", null, "Couldn't load achievements"), el("p", null, a.message ?? "Steam didn't answer. It'll retry on its own."));
  }
  return box;
}

function renderAchievements() {
  renderAchPicker();
  if (achPick !== "auto" && achPicked && Date.now() - achPicked.at > 60_000) loadPickedAchievements();
  const a = achPick === "auto" ? stats.steam?.achievements : achPicked?.data;
  if (achPick !== "auto" && !achPicked) return;
  const body = $("achBody");
  const sig = JSON.stringify(a);
  if (body.dataset.sig === sig) return;
  body.dataset.sig = sig;
  if (!a) return body.replaceChildren(el("p", "muted", stats.steam ? "Play a game on Steam and its achievements show up here." : "Connect Steam to see your achievements."));
  if (a.error) return body.replaceChildren(achProblem(a));

  const count = el("div", "count");
  count.append(document.createTextNode(`${a.unlocked}`), el("small", null, ` / ${a.total}`));
  const bar = el("div", "bar");
  const fill = el("i");
  bar.append(fill);
  const meta = el("div", "meta");
  meta.append(el("span", null, `${Math.round((a.unlocked / a.total) * 100)}% complete`), el("span", null, a.unlocked === a.total ? "PERFECT" : `${a.total - a.unlocked} left`));
  body.replaceChildren(el("div", "game", a.game), count, bar, meta);
  setTimeout(() => (fill.style.width = `${(a.unlocked / a.total) * 100}%`), 60);

  if (a.rarest) {
    const r = rarity(a.rarest.pct);
    const flex = el("div", `rarest ${r?.[0] ?? ""}`);
    const txt = el("div");
    txt.append(el("small", null, "Rarest unlock"), el("b", null, a.rarest.name));
    flex.append(txt, el("span", "rarest-pct", `${a.rarest.pct.toFixed(1)}%`), el("span", "rarest-tier", `${r[1]} · only ${a.rarest.pct.toFixed(1)}% of players`));
    body.append(flex);
  }

  const recent = a.recent ?? (a.latest ? [a.latest] : []);
  if (recent.length) {
    const list = el("ul", "alist");
    recent.forEach((x) => list.append(achRow(x)));
    list.querySelectorAll("small").forEach((sm, i) => (sm.textContent = `${ago(recent[i].time)}${recent[i].desc ? ` · ${recent[i].desc}` : ""}`));
    body.append(el("div", "asub", "Recent unlocks"), list);
  }
  if (a.next?.length) {
    const list = el("ul", "alist next");
    a.next.forEach((x) => list.append(achRow(x, "Locked")));
    body.append(el("div", "asub", "Easiest to get next"), list);
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
  renderStreak();
}

// streak + streak freezes (worked out on the server from your whole history)
function renderStreak() {
  const s = stats.streak ?? { days: 0, freezes: 0 };
  const box = $("streak");
  const sig = JSON.stringify([s.days, s.freezes, s.frozen?.length, s.nextIn]);
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.replaceChildren(s.days ? `${s.days}-day streak` : "no streak yet");
  if (s.freezes) box.append(" ", el("span", "freeze", `❄ ${s.freezes}`));
  box.title =
    `Streak freezes: ${s.freezes}/${s.max ?? 3}. You earn one for every ${s.every ?? 7} days you hit your goal (${s.nextIn} more to the next one). ` +
    `A day with no study uses one automatically, so your streak survives it.` +
    (s.frozen?.length ? ` Saved by a freeze: ${s.frozen.map((d) => new Date(`${d}T12:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })).join(", ")}.` : "");
}

function renderDiscord(d) {
  const chip = $("discordChip");
  chip.querySelector(".dot").className = "dot" + (d.connected ? " on" : d.enabled ? " warn" : "");
  chip.lastChild.textContent = d.connected ? "Discord live" : d.enabled ? "Waiting for Discord" : "Discord off";
  $("dcHint").textContent = d.connected
    ? "Live on your profile · refreshes every 15s"
    : d.enabled
      ? "Open the Discord desktop app and it'll connect automatically."
      : "Click the Discord chip (top right) to connect your profile.";

  const a = d.activity;
  $("dcDetails").textContent = a.details;
  $("dcState").textContent = a.state;
  const img = $("dcImg");
  const src = a.largeImageKey?.startsWith("http") ? a.largeImageKey : a.largeImageKey ? "img/logo-small.png" : null;
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

// the game you're in right now (Steam or detected on your PC), under "Played today"
function renderNowPlaying() {
  const g = stats.game;
  const box = $("nowPlay");
  box.hidden = !g;
  if (!g || box.dataset.name === g.name + g.icon) return;
  box.dataset.name = g.name + g.icon;
  $("npName").textContent = g.name;
  const ic = $("npIc");
  ic.replaceChildren(g.name.slice(0, 1));
  if (g.icon) {
    const i = el("img");
    i.src = g.icon;
    i.alt = "";
    i.onload = () => ic.replaceChildren(i);
  }
}

// Discord card → "Status": your own line instead of "locked in" / "on break"
function renderStatusPick() {
  const st = stats.prefs?.status ?? { presets: [] };
  const pick = $("statusPick");
  const sig = JSON.stringify(st);
  if (pick.dataset.sig === sig || document.activeElement === pick) return;
  pick.dataset.sig = sig;
  const opt = (value, text) => Object.assign(el("option", null, text), { value });
  const list = [...new Set([...st.presets, ...(st.text ? [st.text] : [])])];
  pick.replaceChildren(opt("", "Automatic"), ...list.map((t) => opt(t, t)), opt("__edit", "Edit statuses…"));
  pick.value = st.text ?? "";
}
$("statusPick").addEventListener("change", (e) => {
  const v = e.target.value;
  if (v === "__edit") {
    e.target.value = stats.prefs?.status?.text ?? "";
    openSettings("privacy");
    $("stChips").scrollIntoView({ block: "center" });
    return;
  }
  saveSetting({ status: { text: v } }, v ? `Discord now says “${v}”` : "Status back to automatic");
});

// Subjects card: this week's progress toward each weekly subject goal
function renderSubjectGoals() {
  const box = $("subjGoals");
  const goals = stats.subjects.goals ?? [];
  const sig = JSON.stringify(goals.map((g) => [g.subject, g.goal, Math.floor(g.done)]));
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  const setBtn = (text) => {
    const b = el("button", "sg-set", text);
    b.type = "button";
    b.addEventListener("click", () => openSettings("goals"));
    return b;
  };
  if (!goals.length) return box.replaceChildren(setBtn("+ Set weekly subject goals"));
  const head = el("div", "sg-head");
  head.append(el("span", null, "This week's goals"), setBtn("Edit"));
  const short = (m) => hm(m).replace(/ 00m$/, "").replace(/^0h /, "");
  box.replaceChildren(
    head,
    ...goals.map((g) => {
      const row = el("div", "sg-row" + (g.done >= g.goal ? " done" : ""));
      row.style.setProperty("--c", colorFor(g.subject));
      const bar = el("i");
      const fill = el("b");
      fill.style.width = `${Math.min(100, (g.done / g.goal) * 100)}%`;
      bar.append(fill);
      row.append(el("span", "nm", g.subject), bar, el("span", "mn", g.done >= g.goal ? `✓ ${short(g.done)}` : `${short(g.done)} / ${short(g.goal)}`));
      return row;
    })
  );
}

/* ================= weekly report ================= */
let wkView = "last";
const weekReportIsNew = () => {
  const r = stats.weekly?.last;
  return Boolean(r?.studyMin) && new Date().getDay() === 1 && store.get("gt-week-seen") !== r.from;
};

function openWeekReport(view = "last") {
  wkView = view;
  renderWeekReport();
  if (!$("weekDlg").open) $("weekDlg").showModal();
  if (stats.weekly?.last) store.set("gt-week-seen", stats.weekly.last.from);
  $("weekReportBtn").classList.remove("new");
}

function renderWeekReport() {
  const r = stats.weekly?.[wkView];
  if (!r) return;
  document.querySelectorAll("#wkTabs button").forEach((b) => b.classList.toggle("on", b.dataset.w === wkView));
  const fmt = (k, o) => new Date(`${k}T12:00`).toLocaleDateString(undefined, o);
  $("wkRange").textContent = `${fmt(r.from, { day: "numeric", month: "short" })} – ${fmt(r.to, { day: "numeric", month: "short" })}${wkView === "current" ? " · so far" : ""}`;
  $("wkTotal").textContent = hm(r.studyMin);
  const ch = $("wkChange");
  if (r.prevStudyMin) {
    const pct = Math.round(((r.studyMin - r.prevStudyMin) / r.prevStudyMin) * 100);
    ch.textContent = `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct)}% vs the week before (${hm(r.prevStudyMin)})`;
    ch.className = pct >= 0 ? "up" : "down";
  } else {
    ch.textContent = r.studyMin ? "Your first tracked week" : "Nothing tracked this week yet";
    ch.className = "";
  }
  const goal = stats.study.goalMinutes;
  const max = Math.max(1, goal, ...r.days.map((d) => d.minutes));
  $("wkBars").replaceChildren(
    ...r.days.map((d) => {
      const col = el("div", "wb" + (d.minutes >= goal ? " hit" : "") + (r.best?.date === d.date ? " best" : ""));
      const bar = el("i");
      bar.style.height = `${(d.minutes / max) * 100}%`;
      col.title = `${fmt(d.date, { weekday: "long" })}: ${hm(d.minutes)}`;
      col.append(bar, el("span", null, fmt(d.date, { weekday: "short" }).slice(0, 2)));
      return col;
    })
  );
  const cell = (value, label) => {
    const d = el("div");
    d.append(el("b", null, value), el("span", null, label));
    return d;
  };
  $("wkGrid").replaceChildren(
    cell(`${r.goalDays}/7`, "goal days"),
    cell(r.best ? fmt(r.best.date, { weekday: "short" }) : "-", r.best ? `best day · ${hm(r.best.minutes)}` : "best day"),
    cell(hm(r.playedMin), "played"),
    cell(String(r.sessions), "sessions"),
    cell(String(r.focusRounds), "focus rounds"),
    cell(`${r.questDays}/7`, "quest days")
  );
  const total = r.subjects.reduce((s, x) => s + x.minutes, 0);
  $("wkSubjects").replaceChildren(
    ...(r.subjects.length ? [el("small", null, "Top subjects")] : []),
    ...r.subjects.map((x) => {
      const row = el("div", "ws");
      row.style.setProperty("--c", colorFor(x.name));
      const bar = el("i");
      const fill = el("b");
      fill.style.width = `${total ? (x.minutes / total) * 100 : 0}%`;
      bar.append(fill);
      row.append(el("span", null, x.name), bar, el("em", null, hm(x.minutes)));
      return row;
    })
  );
  window.GT_vocab(stats.prefs?.activity);
}
$("weekReportBtn").addEventListener("click", () => openWeekReport());
document.querySelectorAll("#wkTabs button").forEach((b) => b.addEventListener("click", () => openWeekReport(b.dataset.w)));

/* ================= subjects ================= */
const SUBJECT_COLORS = ["#b794ff", "#5eead4", "#ffb454", "#ff6b8b", "#60a5fa", "#a3e635", "#f472b6", "#facc15", "#38bdf8", "#fb923c", "#c084fc", "#4ade80"];
const colorFor = (name) => {
  const i = stats.subjects.list.indexOf(name);
  return i < 0 ? "#5a5f78" : SUBJECT_COLORS[i % SUBJECT_COLORS.length];
};
let subjRange = "today";

async function setSubject(subject) {
  try {
    apply(await api("/api/study/subject", { subject }));
  } catch (err) {
    showNotice(err.message);
  }
}

function renderSubjectPick() {
  const pick = $("subjectPick");
  const { list } = stats.subjects;
  const active = stats.study.subject;
  const sig = JSON.stringify([list, active]);
  if (pick.dataset.sig === sig) return;
  pick.dataset.sig = sig;
  pick.replaceChildren(
    ...list.map((name) => {
      const b = el("button", null, name);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(name === active));
      b.style.setProperty("--c", colorFor(name));
      if (list.indexOf(name) < 9) b.title = `Shortcut: ${list.indexOf(name) + 1}`;
      // clicking the active subject again clears it
      b.addEventListener("click", () => setSubject(name === active ? null : name));
      return b;
    })
  );
}

function renderSubjects() {
  const data = stats.subjects[subjRange];
  const names = [...new Set([...Object.keys(data), ...stats.subjects.list])];
  const rows = names.map((n) => [n, data[n] ?? 0]).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((s, [, m]) => s + m, 0);

  $("subjStack").replaceChildren(
    ...rows.filter(([, m]) => m > 0).map(([n, m]) => {
      const seg = el("i");
      seg.style.background = colorFor(n);
      seg.style.flexGrow = m;
      seg.title = `${n}: ${hm(m)}`;
      return seg;
    })
  );

  const legend = $("subjLegend");
  const active = stats.study.subject;
  const sig = JSON.stringify([rows, subjRange, active]);
  if (legend.dataset.sig === sig) return;
  legend.dataset.sig = sig;
  if (!rows.length) return legend.replaceChildren(el("li", "empty", "Add a subject below to start tagging sessions."));
  legend.replaceChildren(
    ...rows.map(([n, m]) => {
      const pickable = stats.subjects.list.includes(n);
      const li = el("li", (pickable ? "pick" : "") + (n === active ? " active" : ""));
      const sw = el("span", "sw");
      sw.style.background = colorFor(n);
      li.style.setProperty("--c", colorFor(n));
      const name = el("span", "nm", n);
      if (n === active) name.append(el("em", null, stats.study.activeSince ? "studying" : "selected"));
      li.append(sw, name, el("span", "mn", hm(m)), el("span", "pc", total ? `${Math.round((m / total) * 100)}%` : "-"));
      if (pickable) {
        li.tabIndex = 0;
        li.title = n === active ? `Clear ${n}` : `Study ${n}`;
        const pick = () => setSubject(n === active ? null : n);
        li.addEventListener("click", (e) => !e.target.closest(".rm") && pick());
        li.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && !e.target.closest(".rm") && (e.preventDefault(), pick()));
        const rm = el("button", "rm", "×");
        rm.type = "button";
        rm.title = `Remove ${n} (its past time is kept)`;
        rm.setAttribute("aria-label", `Remove ${n}`);
        rm.addEventListener("click", async () => {
          try {
            apply(await api("/api/subjects", { remove: n }));
          } catch (err) {
            showNotice(err.message);
          }
        });
        li.append(rm);
      }
      return li;
    })
  );
}

document.querySelectorAll(".c-subjects .tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    subjRange = b.dataset.range;
    document.querySelectorAll(".c-subjects .tabs button").forEach((x) => x.classList.toggle("on", x === b));
    renderSubjects();
  })
);

$("subjForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("subjIn");
  try {
    apply(await api("/api/subjects", { add: input.value }));
    input.value = "";
  } catch (err) {
    showNotice(err.message);
  }
});

/* ================= rank, xp, badges ================= */
function renderProgress() {
  const p = stats.progress;
  $("lvlPill").textContent = `LV ${p.level}`;
  $("lvlNum").textContent = p.level;
  $("rankName").textContent = p.rank;
  $("xpNow").textContent = `${p.xp.toLocaleString()} XP`;
  $("xpNext").textContent = p.maxed ? `Level ${p.maxLevel}: max level` : `${(p.nextXp - p.xp).toLocaleString()} XP to level ${p.level + 1}`;
  $("xpFill").style.width = p.maxed ? "100%" : `${((p.xp - p.levelXp) / (p.nextXp - p.levelXp)) * 100}%`;
  // the 5 divisions of the current rank (I-V)
  const divs = $("rankDivs");
  if (divs.children.length !== 5) divs.replaceChildren(...["I", "II", "III", "IV", "V"].map((d) => el("i", null, d)));
  [...divs.children].forEach((d, i) => (d.className = i < p.division ? "done" : i === p.division ? "now" : ""));
  const r = p.rules;
  $("xpRule").textContent = `${r.xpPerMinute} XP per minute studied · +${r.xpPerGoalDay} XP each goal day · +${r.xpPerQuest} XP per quest`;
  const next = $("nextRank");
  next.replaceChildren();
  if (p.nextRank) next.append("Next rank: ", el("b", null, p.nextRank.name), ` at level ${p.nextRank.level}`);
  else next.textContent = p.maxed ? "Legend V. You've reached the top." : "Final rank: Legend. Push to level 50.";

  // celebrate new levels and badges, but not on the very first visit
  const unlocked = p.badges.filter((b) => b.unlocked).map((b) => b.id);
  const prevLevel = store.get("gt-level");
  const prevBadges = JSON.parse(store.get("gt-badges") ?? "null");
  const fresh = prevBadges ? unlocked.filter((id) => !prevBadges.includes(id)) : [];
  if (prevLevel != null && p.level > Number(prevLevel)) levelUp(p.level, p.rank);
  fresh.forEach((id, i) => setTimeout(() => toast(`Badge unlocked · ${p.badges.find((b) => b.id === id).name}`), 1200 + i * 3800));
  store.set("gt-level", String(p.level));
  store.set("gt-badges", JSON.stringify(unlocked));

  $("badgeCount").replaceChildren(el("b", null, String(unlocked.length)), ` / ${p.badges.length} badges unlocked`);
  renderBadges(fresh);
}

let badgeFilter = "all";
const fmtNeed = (b, v) => (b.id === "marathon" || b.need >= 600 ? hm(v).replace(/ 00m$/, "") : String(v)); // time badges read better as hours

function renderBadges(fresh = []) {
  const p = stats.progress;
  const box = $("badges");
  const sig = JSON.stringify([p.badges.map((b) => [b.id, b.have]), badgeFilter]);
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  const shown = p.badges.filter((b) => badgeFilter === "all" || (badgeFilter === "unlocked") === b.unlocked);
  if (!shown.length) return box.replaceChildren(el("p", "muted", badgeFilter === "unlocked" ? "No badges yet. Start a session to earn your first one!" : "You've unlocked every badge. Legend."));
  box.replaceChildren(
    ...shown.map((b) => {
      // compact tile; the description lives in a popup so the grid stays tight
      const tile = el("button", "badge" + (b.unlocked ? " on" : "") + (fresh.includes(b.id) ? " fresh" : ""));
      tile.type = "button";
      tile.setAttribute("aria-label", `${b.name}: ${b.unlocked ? "unlocked" : "locked"}. Show details`);
      tile.append(el("div", "hex", b.icon), el("b", null, b.name));
      if (b.unlocked) tile.append(el("span", "bcheck", "✓"));
      else if (b.need > 1) {
        const bar = el("div", "mini");
        const fill = el("i");
        fill.style.width = `${(b.have / b.need) * 100}%`;
        bar.append(fill);
        tile.append(bar);
      }
      tile.addEventListener("click", (e) => {
        e.stopPropagation();
        openBadgePop(b, tile);
      });
      return tile;
    })
  );
}

function openBadgePop(b, anchor) {
  const pop = $("bpop");
  if (!pop.hidden && pop.dataset.id === b.id) return closeBadgePop();
  pop.dataset.id = b.id;
  pop.className = "bpop" + (b.unlocked ? " on" : "");
  const head = el("div", "bp-head");
  const titles = el("div");
  titles.append(el("span", "bcat", b.cat), el("b", null, b.name));
  head.append(el("div", "hex", b.icon), titles);
  const status = el("div", "bp-status");
  if (b.unlocked) status.append(el("span", "ok", "✓ Unlocked"));
  else {
    const bar = el("div", "xpbar");
    const fill = el("i");
    fill.style.width = `${(b.have / b.need) * 100}%`;
    bar.append(fill);
    status.append(el("span", null, b.need > 1 ? `Progress: ${fmtNeed(b, b.have)} / ${fmtNeed(b, b.need)}` : "Not unlocked yet"), bar);
  }
  pop.replaceChildren(head, el("p", null, b.desc), status);
  pop.hidden = false;

  // place above the tile (or below if there's no room), kept inside the viewport
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const left = Math.min(innerWidth - w - 12, Math.max(12, r.left + r.width / 2 - w / 2));
  const above = r.top - h - 12 > 8;
  pop.style.left = `${left}px`;
  pop.style.top = `${above ? r.top - h - 12 : r.bottom + 12}px`;
  pop.style.setProperty("--arrow", `${r.left + r.width / 2 - left}px`);
  pop.classList.toggle("below", !above);
  anchor.setAttribute("aria-expanded", "true");
  closeBadgePop.anchor = anchor;
}

function closeBadgePop() {
  const pop = $("bpop");
  pop.hidden = true;
  pop.dataset.id = "";
  closeBadgePop.anchor?.setAttribute("aria-expanded", "false");
}
document.addEventListener("click", (e) => !e.target.closest("#bpop") && closeBadgePop());
addEventListener("scroll", closeBadgePop, { passive: true });
addEventListener("resize", closeBadgePop);
addEventListener("keydown", (e) => e.key === "Escape" && closeBadgePop());

document.querySelectorAll("#badgeTabs button").forEach((b) =>
  b.addEventListener("click", () => {
    badgeFilter = b.dataset.f;
    document.querySelectorAll("#badgeTabs button").forEach((x) => x.classList.toggle("on", x === b));
    renderBadges();
  })
);

function levelUp(level, rank) {
  const lu = $("levelup");
  $("luLevel").textContent = level;
  $("luRank").textContent = rank;
  lu.classList.add("show");
  BG.burst(innerWidth / 2, innerHeight / 2);
  say("goal");
  const hide = () => lu.classList.remove("show");
  lu.onclick = hide;
  setTimeout(hide, 4200);
}

/* ================= year heatmap ================= */
function renderHeatmap() {
  const cells = stats.heatmap;
  const goal = stats.study.goalMinutes;
  const sig = JSON.stringify([cells.at(-1).date, cells.map((c) => c.minutes).join(), goal]);
  const heat = $("heat");
  if (heat.dataset.sig === sig) return;
  heat.dataset.sig = sig;

  const level = (m) => (m <= 0 ? 0 : m < goal * 0.25 ? 1 : m < goal * 0.6 ? 2 : m < goal ? 3 : 4);
  const fmt = (d) => new Date(`${d}T12:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  heat.replaceChildren(
    ...cells.map((c, i) => {
      const cell = el("i", `l${level(c.minutes)}` + (i === cells.length - 1 ? " today" : ""));
      cell.title = `${fmt(c.date)} · ${c.minutes ? hm(c.minutes) : "no study"}`;
      return cell;
    })
  );

  // month label over each week-column where the month changes (dropping one that would collide with the next)
  const labels = [];
  let last = -1;
  for (let col = 0; col * 7 < cells.length; col++) {
    const date = new Date(`${cells[col * 7].date}T12:00`);
    if (date.getMonth() !== last && col < 51) {
      if (labels.length && col - labels.at(-1).col < 3) labels.pop();
      labels.push({ col, text: date.toLocaleDateString(undefined, { month: "short" }) });
    }
    last = date.getMonth();
  }
  $("heatMonths").replaceChildren(
    ...labels.map(({ col, text }) => {
      const s = el("span", null, text);
      s.style.gridColumn = `${col + 1} / span 3`;
      return s;
    })
  );

  const active = cells.filter((c) => c.minutes > 0);
  const total = active.reduce((s, c) => s + c.minutes, 0);
  const best = active.reduce((b, c) => (c.minutes > b.minutes ? c : b), { minutes: 0 });
  const foot = $("heatTotal");
  foot.replaceChildren(
    el("b", null, hm(total)), " this year · ",
    el("b", null, String(active.length)), ` active day${active.length === 1 ? "" : "s"}`,
    ...(best.minutes ? [" · best ", el("b", null, hm(best.minutes)), ` on ${fmt(best.date)}`] : [])
  );
}

function renderMarquee() {
  const { study, played, steam } = stats;
  const items = [
    `lv ${stats.progress.level} ${stats.progress.rank}`,
    `${hm(liveStudyMs() / 60000)} studied`,
    `${hm(played.todayMinutes)} played`,
    $("streak").textContent,
    `goal ${hm(study.goalMinutes)}`,
    steam && `steam lvl ${steam.profile.level ?? "?"}`,
    steam && `${steam.ownedCount} games`,
    steam?.profile.currentGame ? `now playing ${steam.profile.currentGame.name}` : "stay locked in",
  ].filter(Boolean);
  const sig = items.join("|");
  const track = $("marquee");
  if (track.dataset.sig === sig) return; // rebuilding restarts the scroll, so only on real changes
  track.dataset.sig = sig;
  // two copies back to back make the -50% loop seamless
  const nodes = [];
  for (let copy = 0; copy < 2; copy++) for (const t of items) nodes.push(el("span", null, t), el("span", null, "✦"));
  track.replaceChildren(...nodes);
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
  // "01:33" with a small "am", so the clock never wraps onto two lines
  const parts = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).formatToParts(now);
  const period = parts.find((p) => p.type === "dayPeriod")?.value;
  const time = parts.filter((p) => p.type !== "dayPeriod").map((p) => p.value).join("").trim();
  if ($("clock").dataset.t !== time + period) {
    $("clock").dataset.t = time + period;
    $("clock").replaceChildren(time, ...(period ? [el("small", null, period)] : []));
  }
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
  const at = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("timerSub").textContent = study.activeSince
    ? `session started ${at(study.activeSince)}${study.subject ? ` · ${study.subject}` : ""}${study.autoStarted ? ` · auto-started by ${study.autoStarted}` : ""}`
    : study.pausedAt ? `paused for ${mins((nowServer - study.pausedAt) / 60000)} · Resume to keep going`
    : study.subject ? `ready to study ${study.subject}` : "pick a subject, or just start";
  if (stats.game?.since) $("npTime").textContent = mins((nowServer - stats.game.since) / 60000);

  if (goalCelebrated === null) goalCelebrated = pct >= 1;
  if (!goalCelebrated && pct >= 1) {
    goalCelebrated = true;
    const r = $("goalSeg").getBoundingClientRect();
    BG.burst(r.right, r.top);
    say("goal");
  }

  const start = discord.activity.startTimestamp;
  $("dcTime").textContent = start ? `${hms(nowServer - start)} elapsed` : "";

  // live timer in the browser tab, so you can see it from any other tab
  document.title = study.activeSince ? `● ${hms(nowServer - study.activeSince)} · ${study.subject ?? "studying"}` : "Grind Tracker";
  if (stats.focus?.phase === "idle" || !stats.focus) checkLongSession(study.activeSince ? nowServer - study.activeSince : 0);
  tickFocus();
  if (settingsDlg.open) renderPrivacyPreview();
}

// Run a request; if the server wants a yes first (e.g. a day over 24h), ask and retry with force.
async function withConfirm(send) {
  try {
    return await send(false);
  } catch (err) {
    if (!err.confirm) throw err;
    if (!confirm(err.message)) throw Object.assign(new Error("Not added"), { cancelled: true });
    return send(true);
  }
}

/* ================= today's log ================= */
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function renderLog() {
  const list = $("log");
  if (list.querySelector(".ledit, .lnote-in")) return; // don't wipe something someone is editing
  const log = stats.study.log;
  const sig = JSON.stringify(log.map((x) => [x.kind, x.at, x.kind === "live" ? 0 : x.minutes, x.subject, x.note]));
  if (list.dataset.sig === sig) return;
  list.dataset.sig = sig;
  if (!log.length) return list.replaceChildren(el("li", "empty", "Nothing yet today. Hit Start studying (or press Space) to begin."));
  list.replaceChildren(
    ...log.map((x) => {
      const li = el("li", `lrow ${x.kind}`);
      const when = x.kind === "added" ? `+ added at ${clock(x.at)}` : x.kind === "legacy" ? "+ added earlier" : `${clock(x.at)} – ${x.kind === "live" ? "now" : clock(x.end)}`;
      const tag = el("span", "ltag", x.subject ?? "untagged");
      if (x.subject) tag.style.setProperty("--c", colorFor(x.subject));
      const dur = el(x.kind === "live" ? "span" : "button", "ldur", x.kind === "live" ? "live" : hm(x.minutes).replace(/^0h /, ""));
      if (x.kind !== "live") {
        dur.type = "button";
        dur.title = x.kind === "session" ? "Click to shorten this session" : "Click to change this amount";
        dur.addEventListener("click", () => editDuration(li, dur, x));
      }
      li.append(el("span", "lwhen", when), tag, dur);
      if (x.kind === "session" || x.kind === "added") {
        const pen = el("button", "lnote-btn", x.note ? "✎" : "+ note");
        pen.type = "button";
        pen.title = x.note ? "Edit note" : "Add a note (what did you work on?)";
        pen.addEventListener("click", () => editNote(li, x));
        li.append(pen);
      }
      if (x.note) li.append(el("span", "lnote", x.note));
      if (x.kind !== "live") {
        // two-step delete: first click arms it, second click within 3s deletes
        const del = el("button", "ldel", "×");
        del.type = "button";
        del.setAttribute("aria-label", "Delete entry");
        del.addEventListener("click", async () => {
          if (!del.classList.contains("armed")) {
            del.classList.add("armed");
            del.textContent = "Delete?";
            setTimeout(() => {
              del.classList.remove("armed");
              del.textContent = "×";
            }, 3000);
            return;
          }
          try {
            apply(await api("/api/study/delete", { kind: x.kind, at: x.at }));
            toast("Entry deleted");
          } catch (err) {
            toast(err.message, true);
          }
        });
        li.append(del);
      }
      return li;
    })
  );
}

// a short note under a log entry; Enter saves, Esc cancels, empty removes it
function editNote(li, x) {
  if (li.querySelector(".lnote-in")) return;
  const input = el("input", "lnote-in");
  input.maxLength = 140;
  input.placeholder = "What did you work on?";
  input.value = x.note ?? "";
  li.querySelector(".lnote")?.remove();
  li.append(input);
  input.focus();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    input.remove();
    $("log").dataset.sig = "";
    if (save && input.value.trim() !== (x.note ?? "")) {
      try {
        apply(await api("/api/study/note", { kind: x.kind, at: x.at, note: input.value }));
        toast(input.value.trim() ? "Note saved" : "Note removed");
      } catch (err) {
        toast(err.message, true);
      }
    } else renderLog();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

// swap the duration for a small number field; Enter saves, Esc cancels
function editDuration(li, dur, x) {
  const input = el("input", "ledit");
  input.type = "number";
  input.min = "1";
  input.value = String(Math.max(1, x.minutes));
  input.setAttribute("aria-label", "Minutes");
  if (x.kind !== "added") input.max = String(Math.max(1, x.minutes));
  dur.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const minutes = Number(input.value);
    if (!save || !minutes || minutes === x.minutes) {
      input.replaceWith(dur);
      return;
    }
    input.replaceWith(dur); // close the editor first so the log can re-render with the new value
    try {
      $("log").dataset.sig = "";
      apply(await withConfirm((force) => api("/api/study/edit", { kind: x.kind, at: x.at, minutes, force })));
      toast(`Changed to ${hm(minutes)}`);
    } catch (err) {
      toast(err.message, true);
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

/* ================= long-session check ================= */
// After 3h (and every 2h after "still here"), ask - a forgotten timer shouldn't inflate your stats.
const STILL_FIRST = 3 * 3600e3;
const STILL_AGAIN = 2 * 3600e3;
function checkLongSession(elapsed) {
  const dlg = $("still");
  if (!elapsed) return;
  const key = `gt-still-${stats.study.activeSince}`;
  const nextAt = Number(store.get(key) ?? STILL_FIRST);
  if (elapsed < nextAt || dlg.open || document.querySelector("dialog[open]")) return;
  $("stillFor").textContent = hm(elapsed / 60000);
  // schedule the next check now: "close" fires async, and the 1s tick could otherwise reopen it first
  store.set(key, String(elapsed + STILL_AGAIN));
  dlg.returnValue = "";
  dlg.showModal();
  dlg.onclose = () => dlg.returnValue === "end" && toggleStudy();
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
    apply(await api(stats?.study.activeSince ? "/api/study/stop" : stats?.study.pausedAt ? "/api/study/resume" : "/api/study/start", {}));
  } catch (err) {
    showNotice(err.message);
  } finally {
    btn.disabled = false;
  }
}
$("studyBtn").addEventListener("click", toggleStudy);

// Pause while running; while paused the same button ends the session (it's already saved)
async function pauseOrEnd() {
  if (!stats) return;
  const s = stats.study;
  try {
    if (s.activeSince) {
      apply(await api("/api/study/pause", {}));
      toast("Paused. Your time so far is saved");
    } else if (s.pausedAt) {
      apply(await api("/api/study/stop", {}));
      toast("Session ended");
    }
  } catch (err) {
    toast(err.message, true);
  }
}
$("pauseBtn").addEventListener("click", pauseOrEnd);
addEventListener("keydown", (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || document.querySelector("dialog[open]")) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (e.code === "Space") {
    if (tag === "BUTTON") return; // let Space press the focused button
    e.preventDefault();
    if (sessView === "focus") {
      const ph = stats?.focus?.phase ?? "idle";
      focusCall(ph === "idle" || ph === "ready" ? "/api/focus/start" : "/api/focus/stop");
    } else toggleStudy();
  } else if (/^[1-9]$/.test(e.key) && stats) {
    const name = stats.subjects.list[Number(e.key) - 1];
    if (name) setSubject(name === stats.study.subject ? null : name);
  } else if (e.key === "a" || e.key === "A") {
    e.preventDefault();
    $("addMin").scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    $("addMin").focus({ preventScroll: true });
  } else if ((e.key === "p" || e.key === "P") && stats && stats.focus?.phase !== "focus") {
    if (stats.study.pausedAt && !stats.study.activeSince) toggleStudy(); // P again resumes
    else if (stats.study.activeSince) pauseOrEnd();
  } else if (e.key === "w" || e.key === "W") {
    if (stats) openWeekReport();
  } else if (e.key === "g" || e.key === "G") {
    openSettings();
  } else if (e.key === "c" || e.key === "C") {
    openSetup();
  } else if (e.key === "?") {
    $("help").showModal();
  }
});

$("addForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("addMin");
  const remove = e.submitter?.value === "remove";
  const minutes = Number(input.value);
  try {
    if (remove) {
      const out = await api("/api/study/remove", { minutes });
      apply(out);
      toast(out.result.removed < minutes ? `Removed ${hm(out.result.removed)} (that's all of today)` : `Removed ${hm(out.result.removed)} from today`);
    } else {
      apply(await withConfirm((force) => api("/api/study/add", { minutes, force })));
      toast(`Added ${hm(minutes)}`);
    }
    input.value = "";
  } catch (err) {
    showNotice(err.message);
  }
});

/* ================= setup wizard ================= */
const setup = $("setup");
const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

function toast(msg, isError = false) {
  const t = $("toast");
  t.textContent = window.GT_words(msg, stats?.prefs?.activity);
  t.classList.toggle("err", isError);
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 3500);
}

function openSetup() {
  const c = stats?.config ?? {};
  const state = (id, ok, text) => {
    $(id).className = "state " + (ok ? "ok" : "missing");
    $(id).textContent = ok ? `✓ ${text}` : "not set";
  };
  state("stDiscord", c.discordClientId, "connected");
  state("stKey", c.steamApiKey, `saved ${c.steamApiKey?.slice(-4) ?? ""}`);
  state("stId", c.steamId, "connected");
  // saved values show as placeholders; leaving a field blank keeps what's saved
  $("inDiscord").placeholder = c.discordClientId || "e.g. 123456789012345678";
  $("inKey").placeholder = c.steamApiKey ? `saved (${c.steamApiKey}) - leave blank to keep` : "32-character key";
  $("inId").placeholder = c.steamId || "https://steamcommunity.com/id/yourname or 7656119…";
  $("inImage").value = c.largeImage || "";
  $("setupError").textContent = "";
  $("setupSkip").textContent = c.complete ? "Close" : "Use demo data for now";
  if (!setup.open) setup.showModal();
}

function maybeOpenSetup() {
  if (maybeOpenSetup.done) return;
  maybeOpenSetup.done = true;
  if (!stats.config.complete && store.get("gt-setup-skipped") !== "1") openSetup();
}

$("setupSkip").addEventListener("click", () => {
  store.set("gt-setup-skipped", "1");
  setup.close();
});
$("setupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("setupSave");
  btn.disabled = true;
  btn.textContent = "Checking with Steam…";
  $("setupError").textContent = "";
  try {
    const out = await api("/api/config", {
      discordClientId: $("inDiscord").value,
      steamApiKey: $("inKey").value,
      steamId: $("inId").value,
      largeImage: $("inImage").value,
    });
    for (const id of ["inDiscord", "inKey", "inId"]) $(id).value = "";
    apply(out);
    setup.close();
    toast(out.result?.steamName ? `Connected as ${out.result.steamName}` : "Saved");
  } catch (err) {
    $("setupError").textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = "Save & connect";
  }
});
$("discordChip").addEventListener("click", openSetup);
$("notice").addEventListener("click", openSetup);
/* ================= focus timer ================= */
const F_RING = 2 * Math.PI * 88;
let sessView = (() => {
  try {
    return localStorage.getItem("gt-sess-view") || "timer";
  } catch {
    return "timer";
  }
})();
let lastPhase = null;

function setSessView(v) {
  sessView = v;
  store.set("gt-sess-view", v);
  renderFocus();
}
document.querySelectorAll("#sessMode button").forEach((b) => b.addEventListener("click", () => setSessView(b.dataset.m)));

function renderFocus() {
  const f = stats.focus ?? { phase: "idle" };
  const running = f.phase !== "idle";
  if (running && sessView !== "focus") sessView = "focus"; // a running focus cycle always shows itself
  const showFocus = sessView === "focus";
  document.querySelectorAll("#sessMode button").forEach((b) => b.classList.toggle("on", b.dataset.m === sessView));
  $("timerView").hidden = showFocus;
  $("focusView").hidden = !showFocus;

  // chime + nudge when the server moves to a new phase while the window is open
  if (lastPhase && lastPhase !== f.phase && f.phase !== "idle") chime(f.phase === "focus" ? "up" : "down");
  lastPhase = f.phase;

  const s = f.settings ?? {};
  for (const k of ["focus", "short", "long", "every"]) {
    const input = $(`fl-${k}`);
    if (document.activeElement !== input && !input.dataset.pending) input.value = s[k] ?? "";
  }
  const key = [s.focus, s.short, s.long, s.every].join(",");
  document.querySelectorAll("#fPresets button").forEach((b) => b.classList.toggle("on", b.dataset.p === key));
  $("fHint").textContent = running ? "Changes apply from the next phase." : "Set the lengths here, then hit Start focus.";
  $("fStart").hidden = running && f.phase !== "ready";
  $("fStart").querySelector("span").textContent = f.phase === "ready" ? "Start next round" : "Start focus";
  $("fSkip").hidden = !running || f.phase === "ready";
  $("fStop").hidden = !running;
  $("fSkip").textContent = f.phase === "focus" ? "Skip to break" : "Skip break";
  $("focusView").dataset.phase = f.phase;

  const every = f.every ?? 4;
  const dots = $("fDots");
  if (dots.children.length !== every) dots.replaceChildren(...Array.from({ length: every }, () => el("i")));
  [...dots.children].forEach((d, i) => d.className = i < f.round ? "done" : i === f.round && f.phase === "focus" ? "now" : "");
  $("fRound").textContent = running ? `round ${Math.min(f.round + (f.phase === "focus" ? 1 : 0), every) || 1} of ${every}` : `${every} rounds per cycle`;
  tickFocus();
}

function tickFocus() {
  const f = stats?.focus;
  if (!f || $("focusView").hidden) return;
  const s = f.settings ?? {};
  const total = (f.phase === "focus" ? s.focus : f.phase === "long" ? s.long : s.short) * 60_000;
  const left = f.endsAt ? Math.max(0, f.endsAt - (Date.now() + skew)) : (s.focus ?? 25) * 60_000;
  const mm = Math.floor(left / 60_000);
  const ss = Math.floor((left % 60_000) / 1000);
  $("fTime").textContent = `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  $("fPhase").textContent = { idle: "Ready", focus: "Focus", short: "Short break", long: "Long break", ready: "Break's over" }[f.phase];
  // the ring drains as the phase runs out (full when idle)
  $("fFill").style.strokeDashoffset = f.endsAt && total ? F_RING * (1 - left / total) : 0;
  if (f.phase === "focus" || f.phase === "short" || f.phase === "long") document.title = `${$("fTime").textContent} · ${$("fPhase").textContent}`;
}

// a soft two-note chime (no audio files): up for "focus", down for "break"
function chime(dir) {
  try {
    const ctx = (chime.ctx ??= new AudioContext());
    const notes = dir === "up" ? [523.25, 783.99] : [783.99, 523.25];
    notes.forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      const t = ctx.currentTime + i * 0.22;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.65);
    });
  } catch {}
}

const focusCall = (path) => api(path, {}).then(apply).catch((err) => toast(err.message, true));

// focus lengths, editable right on the card: +/- steps, typing, or a preset
const F_STEP = { focus: 5, short: 1, long: 5, every: 1 };
const F_MAX = { focus: 240, short: 120, long: 240, every: 12 };
function saveFocusLen(k, v) {
  const input = $(`fl-${k}`);
  v = Math.min(F_MAX[k], Math.max(1, Math.round(v) || 1));
  input.value = v;
  input.dataset.pending = "1"; // keep the typed value until the server confirms
  clearTimeout(saveFocusLen[k]);
  saveFocusLen[k] = setTimeout(async () => {
    try {
      apply(await api("/api/settings", { focus: { [k]: v } }));
    } catch (err) {
      toast(err.message, true);
    }
    delete input.dataset.pending;
    renderFocus();
  }, 450); // a few quick clicks on +/- become one save
}
document.querySelectorAll(".f-len").forEach((box) => {
  const k = box.dataset.k;
  const input = $(`fl-${k}`);
  box.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      const cur = Number(input.value) || 1;
      const d = Number(b.dataset.d);
      // focus/long move in 5s but can still land on 1-4
      const next = d > 0 ? (cur < F_STEP[k] ? cur + 1 : cur + F_STEP[k]) : cur <= F_STEP[k] ? cur - 1 : cur - F_STEP[k];
      saveFocusLen(k, next);
    })
  );
  input.addEventListener("change", () => saveFocusLen(k, Number(input.value)));
  input.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), input.blur()));
});
document.querySelectorAll("#fPresets button").forEach((b) =>
  b.addEventListener("click", async () => {
    const [focus, short, long, every] = b.dataset.p.split(",").map(Number);
    try {
      apply(await api("/api/settings", { focus: { focus, short, long, every } }));
      toast(`${b.textContent}: ${focus} min focus, ${short} min breaks`);
    } catch (err) {
      toast(err.message, true);
    }
  })
);
$("fStart").addEventListener("click", () => focusCall("/api/focus/start"));
$("fSkip").addEventListener("click", () => focusCall("/api/focus/skip"));
$("fStop").addEventListener("click", () => focusCall("/api/focus/stop"));

/* ================= daily quests ================= */
function renderQuests() {
  const q = stats.quests;
  if (!q) return;
  const sig = JSON.stringify(q.list.map((x) => [x.id, x.have, x.done]));
  const list = $("quests");
  if (list.dataset.sig !== sig) {
    list.dataset.sig = sig;
    list.replaceChildren(
      ...q.list.map((x) => {
        const li = el("li", "quest" + (x.done ? " done" : ""));
        const check = el("span", "q-check", x.done ? "✓" : "");
        const body = el("div", "q-body");
        const bar = el("div", "q-bar");
        const fill = el("i");
        fill.style.width = `${(x.have / x.need) * 100}%`;
        bar.append(fill);
        const prog = x.unit === "min" ? `${hm(x.have).replace(/^0h /, "")} / ${hm(x.need).replace(/^0h /, "").replace(/ 00m$/, "")}` : `${x.have} / ${x.need}`;
        body.append(el("b", null, x.text), bar, el("small", null, x.done ? "Done" : prog));
        li.append(check, body, el("span", "q-xp", `+${x.xp} XP`));
        return li;
      })
    );
  }
  $("qStreak").textContent = q.streak ? `${q.streak}-day streak` : "";
  $("qFoot").textContent = q.allDone ? `All 3 cleared: +${q.bonus} bonus XP. New quests at midnight.` : `Clear all 3 for +${q.bonus} bonus XP · new quests every day at midnight`;
  $("qFoot").classList.toggle("won", q.allDone);
}

/* ================= studying / working ================= */
function renderActivity() {
  const a = stats.prefs?.activity ?? "study";
  document.querySelectorAll("#actToggle button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.a === a)));
  document.body.dataset.activity = a;
}
document.querySelectorAll("#actToggle button").forEach((b) =>
  b.addEventListener("click", async () => {
    if (stats?.prefs?.activity === b.dataset.a) return;
    try {
      apply(await api("/api/settings", { activity: b.dataset.a }));
      toast(b.dataset.a === "work" ? "Tracking work: everything now says worked / working" : "Tracking study again");
    } catch (err) {
      toast(err.message, true);
    }
  })
);

/* ================= theme ================= */
function applyTheme(theme) {
  window.GT_applyTheme?.(theme);
}

/* ================= notifications inbox (shown in-app when there are no Windows toasts) ================= */
let inboxSeen = null;
function showInbox() {
  const box = stats.inbox ?? [];
  const newest = box.at(-1)?.id ?? 0;
  if (inboxSeen === null) return void (inboxSeen = newest); // don't replay old ones on load
  if (stats.app?.desktop) return void (inboxSeen = newest); // Windows already showed them
  for (const n of box) if (n.id > inboxSeen) toast(`${n.title} · ${n.body}`);
  inboxSeen = newest;
}

/* ================= settings ================= */
const settingsDlg = $("settings");
const PANE_TITLES = { games: "Games", auto: "Auto-start", goals: "Goals", focus: "Focus timer", privacy: "Privacy", notify: "Notifications", appearance: "Appearance", app: "App", updates: "Updates", connections: "Connections", data: "Data & backups", shortcuts: "Keyboard shortcuts" };

function showPane(name) {
  document.querySelectorAll(".set-tab").forEach((t) => {
    const on = t.dataset.pane === name;
    t.classList.toggle("on", on);
    t.setAttribute("aria-selected", String(on));
  });
  document.querySelectorAll(".set-pane").forEach((p) => p.classList.toggle("on", p.dataset.pane === name));
  $("paneTitle").textContent = PANE_TITLES[name];
}
document.querySelectorAll(".set-tab").forEach((t) => t.addEventListener("click", () => showPane(t.dataset.pane)));

function openSettings(pane = "goals") {
  showPane(pane);
  renderSettings(true);
  settingsDlg.showModal();
}
$("settingsBtn").addEventListener("click", () => openSettings());
$("setClose").addEventListener("click", () => settingsDlg.close());
// click on the dimmed backdrop closes it too
settingsDlg.addEventListener("click", (e) => e.target === settingsDlg && settingsDlg.close());

function flashSaved() {
  const s = $("setSaved");
  s.classList.remove("show");
  void s.offsetWidth;
  s.classList.add("show");
}

// everything in Settings saves the moment you change it
async function saveSetting(body, okMsg) {
  try {
    apply(await api("/api/settings", body));
    flashSaved();
    if (okMsg) toast(okMsg);
    renderSettings(true);
    return true;
  } catch (err) {
    toast(err.message, true);
    renderSettings(true);
    return false;
  }
}

/** Fill the panel from stats. `full` also resets inputs (not while someone is typing in them). */
function renderSettings(full = false) {
  if (!stats) return;
  const a = stats.app ?? {};
  const u = a.update ?? {};
  $("setVer").textContent = `Grind Tracker v${a.version ?? "?"}`;

  // goals
  for (const [key, val] of [["goal", stats.study.goalMinutes], ["budget", stats.played.budgetMinutes]]) {
    $(`${key}Val`).textContent = hm(val);
    document.querySelectorAll(`.presets[data-target="${key}"] button`).forEach((b) => b.classList.toggle("on", Number(b.dataset.min) === val));
    const input = $(`${key}In`);
    if (full && document.activeElement !== input) input.value = val;
  }

  // app
  $("desktopCard").hidden = !a.autostartSupported;
  $("desktopNote").hidden = Boolean(a.autostartSupported);
  $("quitCard").hidden = !a.desktop;
  $("autostartIn").checked = Boolean(a.autostart);
  $("bgIn").checked = Boolean(a.closeToBackground);

  // updates
  $("vcVer").textContent = `v${a.version ?? "?"}`;
  $("autoUpdateCard").hidden = !a.desktop;
  $("autoUpdateIn").checked = a.autoUpdate !== false;
  const when = u.checkedAt ? ` · checked ${ago(u.checkedAt)}` : "";
  $("updateStatus").textContent =
    u.status === "current" ? `You're up to date${when}`
    : u.status === "ready" ? `v${u.latest} is installed. Restart to switch over.`
    : u.status === "downloading" ? `Downloading v${u.latest}… ${Math.round((u.progress ?? 0) * 100)}%`
    : u.status === "available" ? `v${u.latest} is available.`
    : u.status === "checking" ? "Checking GitHub…"
    : u.status === "error" ? `Couldn't update: ${u.error}`
    : "Not checked yet";
  $("updateStatus").className = `vc-status ${u.status ?? ""}`;
  $("vcBar").hidden = u.status !== "downloading";
  $("vcFill").style.width = `${Math.round((u.progress ?? 0) * 100)}%`;
  $("vcInstall").hidden = !(u.status === "available" && u.canInstall);
  $("vcRestart").hidden = u.status !== "ready";
  $("vcNotes").href = u.url ?? "#";

  // connections
  const c = stats.config ?? {};
  const d = stats.discord ?? {};
  $("connDiscord").textContent = !c.discordClientId ? "Not connected" : d.connected ? "Live on your profile" : "Waiting for the Discord desktop app";
  $("connDiscordDot").className = "dot" + (d.connected ? " on" : c.discordClientId ? " warn" : "");
  const steamName = stats.steam && !stats.steam.demo ? stats.steam.profile.name : null;
  $("connSteam").textContent = steamName ? `Connected as ${steamName}` : c.steamApiKey ? "Key saved, profile not set" : "Not connected (showing demo data)";
  $("connSteamDot").className = "dot" + (steamName ? " on" : c.steamApiKey ? " warn" : "");

  // focus timer
  const fs = stats.prefs?.focus ?? {};
  for (const [id, k] of [["fFocusIn", "focus"], ["fShortIn", "short"], ["fLongIn", "long"], ["fEveryIn", "every"]]) if (full && document.activeElement !== $(id)) $(id).value = fs[k] ?? "";
  $("fAutoIn").checked = fs.autoNext !== false;
  document.querySelectorAll("#focusPresets button").forEach((b) => b.classList.toggle("on", b.dataset.p === [fs.focus, fs.short, fs.long, fs.every].join(",")));

  // weekend goal
  const wk = stats.prefs?.weekendGoal;
  $("wkOn").checked = Boolean(wk);
  $("wkRow").hidden = !wk;
  if (wk && document.activeElement !== $("wkIn")) $("wkIn").value = wk;
  $("wkVal").textContent = wk ? `${hm(wk)} on Saturdays and Sundays` : "";

  // games
  const gs = stats.games ?? {};
  $("gDetect").checked = gs.detect !== false;
  $("gDbInfo").textContent = gs.games
    ? `Watching for ${gs.games.toLocaleString()} games from Discord's list (updated ${ago(gs.updatedAt)}), plus your own programs.`
    : "Downloading Discord's game list… (needs internet once; it's cached after that)";
  renderGameNow(gs);
  renderProgList("gCustom", gs.custom ?? [], (c) => [c.name, c.exe], (c) => saveSetting({ games: { removeCustom: c.exe } }), "No programs added yet.");
  renderProgList("gIgnore", gs.ignore ?? [], (e) => [e, ""], (e) => saveSetting({ games: { removeIgnore: e } }), "");
  $("gIgnoreCard").hidden = !(gs.ignore ?? []).length;

  renderSubjectGoalSettings();
  renderStatusChips();
  renderAutoStudy();

  // privacy
  const pv = stats.prefs?.privacy ?? {};
  for (const k of Object.keys(pv)) if ($(`pv-${k}`)) $(`pv-${k}`).checked = pv[k] !== false;
  $("pvList").classList.toggle("off", pv.show === false);
  renderPrivacyPreview();

  // notifications
  const nt = stats.prefs?.notify ?? {};
  for (const k of ["on", "goal", "budget", "focus", "quests", "nudge", "auto", "weekly"]) $(`nt-${k}`).checked = nt[k] !== false && (k !== "nudge" || nt.nudge === true);
  $("ntList").classList.toggle("off", nt.on === false);
  $("ntBreak").value = String(nt.breakAfter ?? 90);
  if (document.activeElement !== $("ntNudgeAt")) $("ntNudgeAt").value = nt.nudgeAt ?? "19:00";
  $("nt-recap").checked = nt.recap === true;
  if (document.activeElement !== $("ntRecapAt")) $("ntRecapAt").value = nt.recapAt ?? "21:30";
  $("ntRecapAt").disabled = nt.recap !== true;
  $("ntNudgeAt").disabled = nt.nudge !== true; // the time only matters when the nudge is on
  $("ntWhere").textContent = a.desktop ? "Sends a Windows notification right now." : "Shows a test notification inside the dashboard.";

  // appearance
  const th = stats.prefs?.theme ?? { preset: "mode" };
  document.querySelectorAll("#themes button").forEach((b) => b.classList.toggle("on", b.dataset.t === th.preset));
  $("customColors").hidden = th.preset !== "custom";
  if (th.accent) $("tAccent").value = th.accent;
  if (th.accent2) $("tAccent2").value = th.accent2;
  $("customSwatch").style.background = `linear-gradient(135deg, ${$("tAccent").value}, ${$("tAccent2").value})`;
  const v = stats.art?.v ?? 0;
  if ($("artBgPrev").dataset.v !== String(v)) {
    $("artBgPrev").dataset.v = String(v);
    $("artBgPrev").src = `img/bg.jpg?v=${v}`;
    $("artLogoPrev").src = `img/logo-small.png?v=${v}`;
  }

  // data
  $("dataPath").textContent = a.dataDir ?? "data.json in the project folder";
  const bk = a.backups;
  $("backupInfo").textContent = !bk ? "-" : bk.count ? `${bk.count} saved · latest ${ago(bk.latest.at)}` : "First backup is made with today's first save";
  document.querySelectorAll("[data-open]").forEach((b) => (b.hidden = !a.desktop));
}

document.querySelectorAll(".presets").forEach((group) =>
  group.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const key = group.dataset.target === "goal" ? "goalMinutes" : "playBudgetMinutes";
    saveSetting({ [key]: Number(b.dataset.min) }).then(() => (goalCelebrated = liveStudyMs() / 60000 >= stats.study.goalMinutes));
  })
);
for (const [id, key] of [["goalIn", "goalMinutes"], ["budgetIn", "playBudgetMinutes"]]) {
  const input = $(id);
  let t;
  // typed values save after a short pause (or right away on Enter / leaving the field)
  const commit = () => {
    clearTimeout(t);
    const v = Math.round(Number(input.value));
    if (!v || v < 1) return;
    const current = key === "goalMinutes" ? stats.study.goalMinutes : stats.played.budgetMinutes;
    if (v !== current) saveSetting({ [key]: v });
  };
  input.addEventListener("input", () => {
    clearTimeout(t);
    if (Number(input.value) >= 1) $(id.replace("In", "Val")).textContent = hm(Number(input.value));
    t = setTimeout(commit, 700);
  });
  input.addEventListener("change", commit);
  input.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), commit()));
}

$("autostartIn").addEventListener("change", async (e) => {
  try {
    apply(await api("/api/autostart", { enabled: e.target.checked }));
    flashSaved();
    toast(stats.app.autostart ? "Grind Tracker will start with Windows" : "Won't start with Windows anymore");
  } catch (err) {
    toast(err.message, true);
  }
  renderSettings(true);
});
$("bgIn").addEventListener("change", (e) => saveSetting({ closeToBackground: e.target.checked }, e.target.checked ? "Closing the window keeps Grind Tracker running" : "Closing the window quits Grind Tracker"));
$("autoUpdateIn").addEventListener("change", (e) => saveSetting({ autoUpdate: e.target.checked }, e.target.checked ? "Updates will install automatically" : "You'll be asked before updates install"));

$("checkUpdate").addEventListener("click", async () => {
  $("updateStatus").textContent = "Checking GitHub…";
  try {
    apply(await api("/api/update/check", {}));
  } catch (err) {
    toast(err.message, true);
  }
  renderSettings();
});
$("vcInstall").addEventListener("click", () => installUpdate().then(() => renderSettings()));
$("vcRestart").addEventListener("click", () => {
  settingsDlg.close();
  restartForUpdate();
});

$("openSetup").addEventListener("click", () => {
  settingsDlg.close();
  openSetup();
});

// ---- focus timer settings
for (const [id, k] of [["fFocusIn", "focus"], ["fShortIn", "short"], ["fLongIn", "long"], ["fEveryIn", "every"]]) {
  $(id).addEventListener("change", (e) => Number(e.target.value) >= 1 && saveSetting({ focus: { [k]: Number(e.target.value) } }));
}
$("fAutoIn").addEventListener("change", (e) => saveSetting({ focus: { autoNext: e.target.checked } }));
document.querySelectorAll("#focusPresets button").forEach((b) =>
  b.addEventListener("click", () => {
    const [focus, short, long, every] = b.dataset.p.split(",").map(Number);
    saveSetting({ focus: { focus, short, long, every } });
  })
);

// ---- privacy: every switch saves at once and the preview updates from the server's real card
document.querySelectorAll('[id^="pv-"]').forEach((input) =>
  input.addEventListener("change", () => saveSetting({ privacy: { [input.id.slice(3)]: input.checked } }))
);

function renderPrivacyPreview() {
  const act = stats.discord?.activity;
  $("pvHidden").hidden = Boolean(act);
  document.querySelector(".pv-preview .dc").hidden = !act;
  if (!act) return;
  $("pvDetails").textContent = act.details ?? "";
  $("pvState").textContent = act.state ?? "";
  const now = Date.now() + skew;
  $("pvTime").textContent = act.endTimestamp ? `${hms(act.endTimestamp - now)} left` : act.startTimestamp ? `${hms(now - act.startTimestamp)} elapsed` : "";
  const img = $("pvImg");
  const src = act.largeImageKey ? (act.largeImageKey.startsWith("http") ? act.largeImageKey : `img/logo-small.png?v=${stats.art?.v ?? 0}`) : "";
  img.hidden = !src;
  if (src && img.dataset.src !== src) {
    img.dataset.src = src;
    const i = el("img");
    i.src = src;
    i.alt = "";
    img.replaceChildren(i);
  }
}

// ---- notifications
for (const k of ["on", "goal", "budget", "focus", "quests", "nudge", "recap", "auto", "weekly"]) $(`nt-${k}`).addEventListener("change", (e) => saveSetting({ notify: { [k]: e.target.checked } }));
$("ntRecapAt").addEventListener("change", (e) => e.target.value && saveSetting({ notify: { recapAt: e.target.value } }));

// ---- weekend goal
$("wkOn").addEventListener("change", (e) => saveSetting({ weekendGoal: e.target.checked ? Math.round(stats.study.goalMinutes / 2) || 60 : null }));
$("wkIn").addEventListener("change", (e) => Number(e.target.value) >= 1 && saveSetting({ weekendGoal: Number(e.target.value) }));

// ---- games
$("gDetect").addEventListener("change", (e) => saveSetting({ games: { detect: e.target.checked } }));
async function loadPrograms(id = "gPick") {
  try {
    const { list } = await api("/api/processes");
    const pick = $(id);
    const keep = pick.value;
    pick.replaceChildren(el("option", null, list.length ? "Choose a running program…" : "No programs found"), ...list.map((exe) => Object.assign(el("option", null, exe), { value: exe })));
    pick.firstChild.value = "";
    if (list.includes(keep)) pick.value = keep;
  } catch (err) {
    toast(err.message, true);
  }
}
const niceName = (exe) => exe.replace(/\.exe$/i, "").replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
for (const [pick, refresh, name] of [["gPick", "gRefresh", "gName"], ["asPick", "asRefresh", "asName"]]) {
  $(refresh).addEventListener("click", () => loadPrograms(pick));
  $(pick).addEventListener("focus", () => $(pick).options.length <= 1 && loadPrograms(pick));
  $(pick).addEventListener("change", (e) => {
    if (!$(name).value && e.target.value) $(name).value = niceName(e.target.value);
  });
}

// ---- weekly subject goals (Settings → Goals)
function renderSubjectGoalSettings() {
  const ul = $("sgList");
  const goals = stats.prefs?.subjectGoals ?? {};
  const sig = JSON.stringify([stats.subjects.list, goals]);
  if (ul.dataset.sig === sig || ul.contains(document.activeElement)) return;
  ul.dataset.sig = sig;
  ul.replaceChildren(
    ...stats.subjects.list.map((s) => {
      const li = el("li");
      const sw = el("span", "sw");
      sw.style.background = colorFor(s);
      const input = Object.assign(el("input"), { type: "number", min: "0", step: "0.5", placeholder: "-", value: goals[s] ? String(+(goals[s] / 60).toFixed(2)) : "" });
      input.className = "sel";
      input.setAttribute("aria-label", `${s}: hours per week`);
      input.addEventListener("change", () => {
        const h = Number(input.value) || 0;
        saveSetting({ subjectGoal: { subject: s, minutes: Math.round(h * 60) } }, h > 0 ? `${s}: ${h}h a week` : `${s}: no weekly goal`);
      });
      li.append(sw, el("span", "nm", s), input, el("small", null, "h / week"));
      return li;
    })
  );
}

// ---- custom Discord statuses (Settings → Privacy)
function renderStatusChips() {
  const st = stats.prefs?.status ?? { presets: [] };
  const box = $("stChips");
  const sig = JSON.stringify(st);
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  if (!st.presets.length) return box.replaceChildren(el("span", "muted", "No statuses yet. Add one below."));
  box.replaceChildren(
    ...st.presets.map((t) => {
      const on = t === st.text;
      const chip = el("span", "st-chip" + (on ? " on" : ""));
      const use = el("button", null, t);
      use.type = "button";
      use.title = on ? "In use. Click to go back to automatic" : "Use this status";
      use.addEventListener("click", () => saveSetting({ status: { text: on ? "" : t } }, on ? "Status back to automatic" : `Discord now says “${t}”`));
      const rm = el("button", "rm", "×");
      rm.type = "button";
      rm.setAttribute("aria-label", `Remove ${t}`);
      rm.addEventListener("click", () => saveSetting({ status: { remove: t } }));
      chip.append(use, rm);
      return chip;
    })
  );
}
$("stForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (await saveSetting({ status: { add: $("stIn").value } }, "Status added")) $("stIn").value = "";
});

// ---- auto-start studying (Settings → Auto-start)
function renderAutoStudy() {
  const a = stats.prefs?.autoStudy ?? { apps: [] };
  $("asOn").checked = a.on !== false;
  $("asStop").checked = a.stop !== false;
  renderProgList("asList", a.apps, (x) => [x.name, `${x.exe}${x.subject ? ` · ${x.subject}` : ""}`], (x) => saveSetting({ autoStudy: { remove: x.exe } }), "No study apps yet.");
  const sub = $("asSubject");
  const sig = JSON.stringify(stats.subjects.list);
  if (sub.dataset.sig === sig) return;
  sub.dataset.sig = sig;
  const keep = sub.value;
  sub.replaceChildren(Object.assign(el("option", null, "No subject"), { value: "" }), ...stats.subjects.list.map((s) => Object.assign(el("option", null, s), { value: s })));
  sub.value = stats.subjects.list.includes(keep) ? keep : "";
}
$("asOn").addEventListener("change", (e) => saveSetting({ autoStudy: { on: e.target.checked } }));
$("asStop").addEventListener("change", (e) => saveSetting({ autoStudy: { stop: e.target.checked } }));
$("asAdd").addEventListener("click", async () => {
  const exe = $("asPick").value;
  if (!exe) return toast("Choose a running program first", true);
  const name = $("asName").value || niceName(exe);
  if (await saveSetting({ autoStudy: { add: { exe, name, subject: $("asSubject").value || null } } }, `${name} will start your timer`)) {
    $("asName").value = "";
    $("asPick").value = "";
  }
});
$("gAdd").addEventListener("click", async () => {
  const exe = $("gPick").value;
  if (!exe) return toast("Choose a running program first", true);
  if (await saveSetting({ games: { addCustom: { exe, name: $("gName").value } } }, `Added: ${$("gName").value || exe}`)) {
    $("gName").value = "";
    $("gPick").value = "";
  }
});

function renderGameNow(gs) {
  const box = $("gNow");
  const d = gs.detected;
  const sig = JSON.stringify([d?.name, d?.exe, gs.detect]);
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  if (!d) return box.replaceChildren(el("b", null, "No game running"), el("small", null, "Start one and it shows up here within 15 seconds."));
  const ic = el("div", "ng-ic");
  if (d.icon) ic.append(Object.assign(el("img"), { src: d.icon, alt: "" }));
  else ic.textContent = d.name.slice(0, 1);
  const txt = el("div", "ng-txt");
  txt.append(el("small", null, d.source === "custom" ? "Playing now · your program" : "Playing now · detected"), el("b", null, d.name), el("small", "mono", d.exe));
  const ignore = el("button", "btn-ghost", "Not a game");
  ignore.type = "button";
  ignore.title = `Ignore ${d.exe} from now on`;
  ignore.addEventListener("click", () => saveSetting({ games: { addIgnore: d.exe } }, `${d.name} won't count as a game anymore`));
  box.replaceChildren(ic, txt, ignore);
}

function renderProgList(id, items, label, remove, empty) {
  const ul = $(id);
  const sig = JSON.stringify(items);
  if (ul.dataset.sig === sig) return;
  ul.dataset.sig = sig;
  if (!items.length) return ul.replaceChildren(...(empty ? [el("li", "empty", empty)] : []));
  ul.replaceChildren(
    ...items.map((it) => {
      const [name, sub] = label(it);
      const li = el("li");
      const txt = el("div");
      txt.append(el("b", null, name), ...(sub ? [el("small", "mono", sub)] : []));
      const rm = el("button", "rm", "×");
      rm.type = "button";
      rm.setAttribute("aria-label", `Remove ${name}`);
      rm.addEventListener("click", () => remove(it));
      li.append(txt, rm);
      return li;
    })
  );
}
$("ntBreak").addEventListener("change", (e) => saveSetting({ notify: { breakAfter: Number(e.target.value) } }));
$("ntNudgeAt").addEventListener("change", (e) => e.target.value && saveSetting({ notify: { nudgeAt: e.target.value } }));
$("ntTest").addEventListener("click", async () => {
  try {
    apply(await api("/api/notify/test", {}));
    if (stats.app?.desktop) toast("Sent. Check the corner of your screen");
  } catch (err) {
    toast(err.message, true);
  }
});

// ---- appearance
document.querySelectorAll("#themes button").forEach((b) =>
  b.addEventListener("click", () => {
    const body = { preset: b.dataset.t };
    if (b.dataset.t === "custom") Object.assign(body, { accent: $("tAccent").value, accent2: $("tAccent2").value });
    saveSetting({ theme: body });
  })
);
for (const id of ["tAccent", "tAccent2"]) {
  $(id).addEventListener("input", () => applyTheme({ preset: "custom", accent: $("tAccent").value, accent2: $("tAccent2").value })); // live while dragging
  $(id).addEventListener("change", () => saveSetting({ theme: { preset: "custom", accent: $("tAccent").value, accent2: $("tAccent2").value } }));
}

async function uploadArt(slot, blob) {
  const res = await fetch(`/api/art/upload?slot=${slot}`, { method: "POST", headers: { "content-type": blob.type }, body: blob });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error);
}

$("artBgIn").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const crop = await cropImage(file, { title: "Crop character art", aspect: 9 / 16, round: false });
  if (!crop) return;
  try {
    await uploadArt("bg", await crop(900, 1600, "image/jpeg"));
    refreshArt();
    toast("Character art updated");
  } catch (err) {
    toast(err.message, true);
  }
});
$("artLogoIn").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const crop = await cropImage(file, { title: "Crop logo", aspect: 1, round: true });
  if (!crop) return;
  try {
    await uploadArt("logo", await crop(256, 256, "image/png"));
    await uploadArt("logo-full", await crop(1024, 1024, "image/png")); // full size, for the Discord Developer Portal
    refreshArt();
    toast("Logo updated");
  } catch (err) {
    toast(err.message, true);
  }
});

/* ---- image cropper: the frame stays put, you drag and zoom the image behind it ---- */
/**
 * Opens the crop dialog. Resolves to null on cancel, or to crop(width, height, type) → Blob
 * that renders exactly what was inside the frame at that output size.
 */
function cropImage(file, { title, aspect, round }) {
  return new Promise((resolve, reject) => {
    const dlg = $("cropDlg");
    const view = $("cropView");
    const img = $("cropImg");
    const zoom = $("cropZoom");
    const url = URL.createObjectURL(file);
    $("cropTitle").textContent = title;
    view.classList.toggle("round", round);
    view.style.aspectRatio = String(aspect);

    let s0 = 1; // "cover" scale at zoom 1
    let z = 1;
    let x = 0;
    let y = 0;
    // layout size, not getBoundingClientRect: the dialog's opening animation scales it
    const size = () => ({ width: view.clientWidth, height: view.clientHeight });
    const clamp = () => {
      const { width: vw, height: vh } = size();
      const sc = s0 * z;
      x = Math.min(0, Math.max(vw - img.naturalWidth * sc, x));
      y = Math.min(0, Math.max(vh - img.naturalHeight * sc, y));
    };
    const draw = () => {
      clamp();
      img.style.transform = `translate(${x}px, ${y}px) scale(${s0 * z})`;
    };
    const fit = () => {
      const { width: vw, height: vh } = size();
      s0 = Math.max(vw / img.naturalWidth, vh / img.naturalHeight);
      z = 1;
      zoom.value = "1";
      x = (vw - img.naturalWidth * s0) / 2; // centered
      y = (vh - img.naturalHeight * s0) / 2;
      draw();
    };
    // zoom around a point in the frame (the cursor, or the center for the slider)
    const zoomTo = (nz, px, py) => {
      nz = Math.min(4, Math.max(1, nz));
      const { width: vw, height: vh } = size();
      px ??= vw / 2;
      py ??= vh / 2;
      const ix = (px - x) / (s0 * z);
      const iy = (py - y) / (s0 * z);
      z = nz;
      zoom.value = String(z);
      x = px - ix * s0 * z;
      y = py - iy * s0 * z;
      draw();
    };

    let drag = null;
    const down = (e) => {
      drag = { px: e.clientX, py: e.clientY, x, y };
      view.setPointerCapture(e.pointerId);
      view.classList.add("dragging");
    };
    const move = (e) => {
      if (!drag) return;
      x = drag.x + e.clientX - drag.px;
      y = drag.y + e.clientY - drag.py;
      draw();
    };
    const up = () => {
      drag = null;
      view.classList.remove("dragging");
    };
    const wheel = (e) => {
      e.preventDefault();
      const r = view.getBoundingClientRect();
      const k = view.clientWidth / r.width; // screen px → frame px (in case it's scaled)
      zoomTo(z * (e.deltaY < 0 ? 1.08 : 1 / 1.08), (e.clientX - r.left) * k, (e.clientY - r.top) * k);
    };
    const slide = () => zoomTo(Number(zoom.value));

    const cleanup = () => {
      view.removeEventListener("pointerdown", down);
      view.removeEventListener("pointermove", move);
      view.removeEventListener("pointerup", up);
      view.removeEventListener("wheel", wheel);
      zoom.removeEventListener("input", slide);
      $("cropReset").onclick = $("cropSave").onclick = $("cropCancel").onclick = dlg.oncancel = null;
      dlg.close();
    };
    $("cropCancel").onclick = dlg.oncancel = (e) => {
      e?.preventDefault?.();
      cleanup();
      URL.revokeObjectURL(url);
      resolve(null);
    };
    $("cropReset").onclick = fit;
    $("cropSave").onclick = () => {
      const { width: vw } = size();
      const crop = { x, y, scale: s0 * z, vw };
      cleanup();
      resolve(
        (w, h, type) =>
          new Promise((done) => {
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            const r = w / crop.vw; // frame px → output px
            const ctx = c.getContext("2d");
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(img, crop.x * r, crop.y * r, img.naturalWidth * crop.scale * r, img.naturalHeight * crop.scale * r);
            c.toBlob(done, type, 0.92);
          })
      );
    };

    view.addEventListener("pointerdown", down);
    view.addEventListener("pointermove", move);
    view.addEventListener("pointerup", up);
    view.addEventListener("wheel", wheel, { passive: false });
    zoom.addEventListener("input", slide);
    img.onerror = () => {
      cleanup();
      reject(new Error("That image couldn't be opened"));
    };
    img.onload = () => {
      dlg.showModal();
      setTimeout(fit, 30); // the frame needs to be on screen (laid out) to measure it
    };
    img.src = url;
  }).catch((err) => {
    toast(err.message, true);
    return null;
  });
}
document.querySelectorAll("[data-reset]").forEach((b) =>
  b.addEventListener("click", async () => {
    try {
      apply(await api("/api/art/reset", { slot: b.dataset.reset }));
      refreshArt();
      toast("Back to the default");
    } catch (err) {
      toast(err.message, true);
    }
  })
);

// swap every art image on the page for the new version without a reload
async function refreshArt() {
  apply(await api("/api/stats"));
  const v = stats.art.v;
  $("artImg").src = `img/bg.jpg?v=${v}`;
  document.body.classList.remove("no-art");
  document.querySelectorAll('img[src*="logo-small.png"]').forEach((img) => (img.src = `img/logo-small.png?v=${v}`));
  document.querySelector('link[rel="icon"]').href = `img/logo-small.png?v=${v}`;
  renderSettings(true);
}
document.querySelectorAll("[data-open]").forEach((b) =>
  b.addEventListener("click", () => api("/api/open-folder", { which: b.dataset.open }).catch((err) => toast(err.message, true)))
);

$("quitBtn").addEventListener("click", async () => {
  settingsDlg.close();
  await api("/api/quit", {}).catch(() => {});
  window.close(); // works in the app window; in a normal tab the screen below explains instead
  $("quitScreen").hidden = false;
  document.title = "Grind Tracker (closed)";
});

tick();
refresh();
setInterval(refresh, 5000);
setInterval(tick, 1000);
