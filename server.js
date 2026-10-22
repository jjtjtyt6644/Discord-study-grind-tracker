import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDesktop, ROOT, APP_DIR, ART_DIR, VERSION, readAsset, hasCustomArt, openAppWindow, autostartSupported, getAutostart, setAutostart } from "./desktop.js";
import { getSteam, getAchievementsFor, clearSteamCache, resolveSteamId, verifySteam } from "./steam.js";
import { startPresence, updatePresence, presenceState, buildActivity } from "./presence.js";
import { computeProgress } from "./progress.js";

const ENV_FILE = process.env.ENV_FILE || path.join(APP_DIR, ".env");
try {
  process.loadEnvFile(ENV_FILE);
} catch {}

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(APP_DIR, "data.json");
const PUBLIC = path.join(ROOT, "public");
// cached: asking the registry on every refresh would be wasteful (no top-level await: the exe bundle is CommonJS)
let autostart = false;
getAutostart().then((v) => (autostart = v));
const TYPES = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
};

// ---------- persistence ----------
const dayKey = (d = new Date()) => d.toLocaleDateString("en-CA"); // local YYYY-MM-DD

function load() {
  try {
    return JSON.parse(readFileSync(DATA_FILE, "utf8"));
  } catch {
    return { settings: { goalMinutes: 240, playBudgetMinutes: 120 }, days: {}, activeStudy: null, gameSession: null };
  }
}
const data = load();

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeFile(DATA_FILE, JSON.stringify(data, null, 2)).catch(console.error), 200);
}

const DEFAULT_SUBJECTS = ["Math", "Science", "Coding", "Language", "Reading"];
data.subjects ??= DEFAULT_SUBJECTS;
data.activeSubject ??= null;

const day = (key = dayKey()) => (data.days[key] ??= { sessions: [], manualMinutes: 0, snapshot: null });
const studyMin = (key) => studyMs(key) / 60_000;

// "Untagged" covers sessions from before subjects existed and timer runs with no subject picked
function minutesBySubject(keys) {
  const out = {};
  const add = (subject, min) => {
    if (min > 0) out[subject || "Untagged"] = (out[subject || "Untagged"] ?? 0) + min;
  };
  for (const k of keys) {
    const d = data.days[k];
    if (d) {
      for (const s of d.sessions) add(s.subject, (s.end - s.start) / 60_000);
      let tagged = 0;
      for (const [subject, min] of Object.entries(d.manualBySubject ?? {})) {
        add(subject, min);
        tagged += min;
      }
      add(null, d.manualMinutes - tagged);
    }
    if (data.activeStudy && dayKey(new Date(data.activeStudy)) === k) add(data.activeSubject, (Date.now() - data.activeStudy) / 60_000);
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k]);
  return out;
}

// 53 week-columns ending this week, Sunday first - same shape as GitHub's contribution graph
function heatmap() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - (52 * 7 + end.getDay()));
  const cells = [];
  for (const d = start; d <= end; d.setDate(d.getDate() + 1)) {
    const k = dayKey(d);
    cells.push({ date: k, minutes: Math.round(studyMin(k)) });
  }
  return cells;
}

// newest first: the running session, finished sessions and manually added time
function todayLog() {
  const d = data.days[dayKey()] ?? { sessions: [], manualEntries: [] };
  const log = [
    ...d.sessions.map((s) => ({ kind: "session", at: s.start, end: s.end, minutes: Math.round((s.end - s.start) / 60_000), subject: s.subject ?? null })),
    ...(d.manualEntries ?? []).map((e) => ({ kind: "added", at: e.at, minutes: e.minutes, subject: e.subject ?? null })),
  ];
  // time added before the log existed has no entries; show it as one row so it can still be removed
  const legacy = (d.manualMinutes ?? 0) - (d.manualEntries ?? []).reduce((sum, e) => sum + e.minutes, 0);
  if (legacy > 0) log.push({ kind: "legacy", at: new Date(`${dayKey()}T00:00`).getTime(), minutes: legacy, subject: null });
  if (data.activeStudy && dayKey(new Date(data.activeStudy)) === dayKey()) {
    log.push({ kind: "live", at: data.activeStudy, minutes: Math.round((Date.now() - data.activeStudy) / 60_000), subject: data.activeSubject });
  }
  return log.sort((a, b) => b.at - a.at);
}

// shrink (or with a negative t, grow) one "added minutes" entry, keeping the day's totals in sync
function trimEntry(d, e, t) {
  e.minutes -= t;
  d.manualMinutes -= t;
  if (e.subject) {
    d.manualBySubject ??= {};
    d.manualBySubject[e.subject] = Math.max(0, (d.manualBySubject[e.subject] ?? 0) - t);
    if (!d.manualBySubject[e.subject]) delete d.manualBySubject[e.subject];
  }
  if (e.minutes <= 0) d.manualEntries.splice(d.manualEntries.indexOf(e), 1);
}

// Remove up to m minutes from today: newest added time, then older added time,
// then finished sessions (newest first, trimmed from the end), then the running timer.
function removeMinutes(m) {
  const d = day();
  let left = m;
  const take = (available) => {
    const t = Math.min(left, Math.max(0, available));
    left -= t;
    return t;
  };
  const entries = d.manualEntries ?? [];
  for (const e of [...entries].sort((a, b) => b.at - a.at)) if (left > 0) trimEntry(d, e, take(e.minutes));
  const legacy = d.manualMinutes - entries.reduce((sum, e) => sum + e.minutes, 0);
  if (left > 0 && legacy > 0) d.manualMinutes -= take(legacy);
  for (const s of [...d.sessions].sort((a, b) => b.start - a.start)) if (left > 0) s.end -= take((s.end - s.start) / 60_000) * 60_000;
  d.sessions = d.sessions.filter((s) => s.end - s.start >= 30_000); // drop sessions trimmed to nothing
  if (left > 0 && data.activeStudy && dayKey(new Date(data.activeStudy)) === dayKey()) {
    data.activeStudy = Math.min(Date.now(), data.activeStudy + take((Date.now() - data.activeStudy) / 60_000) * 60_000);
  }
  return m - left;
}

function exportCsv() {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const time = (t) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const rows = [["date", "type", "start", "end", "minutes", "subject"]];
  for (const k of Object.keys(data.days).sort()) {
    const d = data.days[k];
    for (const s of d.sessions) rows.push([k, "session", time(s.start), time(s.end), Math.round((s.end - s.start) / 60_000), s.subject]);
    for (const e of d.manualEntries ?? []) rows.push([k, "added", time(e.at), "", e.minutes, e.subject]);
  }
  return rows.map((r) => r.map(q).join(",")).join("\r\n");
}

function checkSubject(subject) {
  if (subject == null || subject === "") return null;
  if (!data.subjects.includes(subject)) throw new Error(`Unknown subject "${subject}"`);
  return subject;
}

function stopSession(at = Date.now()) {
  if (!data.activeStudy) return;
  day(dayKey(new Date(data.activeStudy))).sessions.push({ start: data.activeStudy, end: at, subject: data.activeSubject });
  data.activeStudy = null;
}

function studyMs(key) {
  const d = data.days[key];
  let ms = 0;
  if (d) {
    for (const s of d.sessions) ms += s.end - s.start;
    ms += d.manualMinutes * 60_000;
  }
  if (data.activeStudy && dayKey(new Date(data.activeStudy)) === key) ms += Date.now() - data.activeStudy;
  return ms;
}

// Steam only reports lifetime playtime, so "today" = lifetime now - lifetime at the first poll of the day.
// The game you're in right now also gets live minutes, because Steam updates its playtime slowly.
function playedToday(steam) {
  const d = day();
  const totals = steam.playtimes;
  d.snapshot ??= {};
  const perGame = {};
  let sum = 0;
  for (const [id, minutes] of Object.entries(totals)) {
    // A game we haven't seen today (first poll, or Steam just started listing it) starts from its current total,
    // otherwise its whole lifetime would count as today.
    if (!(id in d.snapshot)) {
      d.snapshot[id] = minutes;
      save();
    }
    const diff = minutes - d.snapshot[id];
    if (diff > 0) {
      perGame[id] = diff;
      sum += diff;
    }
  }

  const cur = steam.profile.currentGame;
  if (!cur) {
    if (data.gameSession) {
      data.gameSession = null;
      save();
    }
    return sum;
  }
  const s = data.gameSession;
  if (!s || s.appid !== cur.appid || dayKey(new Date(s.start)) !== dayKey()) {
    data.gameSession = { appid: cur.appid, start: Date.now(), diffAtStart: perGame[cur.appid] ?? 0 };
    save();
  }
  const live = data.gameSession.diffAtStart + (Date.now() - data.gameSession.start) / 60_000;
  const recorded = perGame[cur.appid] ?? 0;
  return sum + Math.max(0, live - recorded);
}

// ---------- config (keys entered in the dashboard) ----------
const mask = (v) => (v ? `${"•".repeat(Math.max(0, v.length - 4))}${v.slice(-4)}` : "");

// Never sends the Steam key back to the page, only whether it's set.
function configStatus() {
  const e = process.env;
  return {
    discordClientId: e.DISCORD_CLIENT_ID || "",
    steamApiKey: mask(e.STEAM_API_KEY),
    steamId: e.STEAM_ID64 || "",
    largeImage: e.LARGE_IMAGE || "",
    complete: Boolean(e.DISCORD_CLIENT_ID && e.STEAM_API_KEY && e.STEAM_ID64),
  };
}

async function writeEnv(updates) {
  let text;
  try {
    text = await readFile(ENV_FILE, "utf8");
  } catch {
    text = readAsset(".env.example")?.toString("utf8") ?? (await readFile(path.join(ROOT, ".env.example"), "utf8").catch(() => ""));
  }
  const lines = text.split(/\r?\n/);
  for (const [k, v] of Object.entries(updates)) {
    const i = lines.findIndex((l) => l.startsWith(`${k}=`));
    if (i >= 0) lines[i] = `${k}=${v}`;
    else lines.push(`${k}=${v}`);
    process.env[k] = v;
  }
  await writeFile(ENV_FILE, lines.join("\n").replace(/\n*$/, "\n"));
}

async function saveConfig(body) {
  const clean = (v) => String(v ?? "").trim();
  const discordId = clean(body.discordClientId);
  const steamKey = clean(body.steamApiKey);
  const steamInput = clean(body.steamId);
  const largeImage = clean(body.largeImage);
  const updates = {};

  if (discordId) {
    if (!/^\d{17,20}$/.test(discordId)) throw new Error("Discord Application ID should be 17-20 digits");
    updates.DISCORD_CLIENT_ID = discordId;
  }
  if (steamKey && !/^[A-Fa-f0-9]{32}$/.test(steamKey)) throw new Error("Steam API key should be 32 letters/numbers");
  if (largeImage && !/^([\w-]{1,64}|https:\/\/\S{1,500})$/.test(largeImage)) {
    throw new Error("Large image must be an Art Asset name or an https:// link");
  }
  if (body.largeImage !== undefined) updates.LARGE_IMAGE = largeImage;

  // Check Steam before saving anything, so a typo never replaces working keys.
  let steamName = null;
  if (steamKey || steamInput) {
    const key = steamKey || process.env.STEAM_API_KEY;
    if (!key) throw new Error("Add your Steam API key too");
    const id = await resolveSteamId(steamInput || process.env.STEAM_ID64 || "", key);
    steamName = await verifySteam(key, id);
    if (steamKey) updates.STEAM_API_KEY = steamKey;
    updates.STEAM_ID64 = id;
  }

  await writeEnv(updates);
  clearSteamCache();
  if (updates.DISCORD_CLIENT_ID) startPresence(updates.DISCORD_CLIENT_ID);
  return { ok: true, steamName, config: configStatus() };
}

// ---------- stats ----------
async function buildStats() {
  let steam = null;
  let steamError = null;
  try {
    steam = await getSteam({ key: process.env.STEAM_API_KEY, steamid: process.env.STEAM_ID64 });
  } catch (e) {
    steamError = e.message;
  }

  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 6 + i);
    const k = dayKey(d);
    return { date: k, minutes: Math.round(studyMs(k) / 60_000) };
  });

  const playedMin = !steam ? 0 : steam.demo ? steam.demoPlayedToday : playedToday(steam);
  // keep a per-day record of play time (the Budget Keeper badge needs past days)
  if (steam && !steam.demo && day().playedMinutes !== Math.round(playedMin)) {
    day().playedMinutes = Math.round(playedMin);
    save();
  }
  const weekKeys = week.map((d) => d.date);
  const mode = data.activeStudy ? "study" : steam?.profile.currentGame ? "gaming" : "idle";
  const sessions = (data.days[dayKey()]?.sessions ?? []).map((s) => s.end - s.start);

  const stats = {
    now: Date.now(),
    mode,
    study: {
      todayMs: studyMs(dayKey()),
      activeSince: data.activeStudy,
      goalMinutes: data.settings.goalMinutes,
      sessionsToday: sessions.length,
      longestSessionMs: Math.max(0, ...sessions),
      subject: data.activeSubject,
      log: todayLog(),
      week,
    },
    subjects: {
      list: data.subjects,
      today: minutesBySubject([dayKey()]),
      week: minutesBySubject(weekKeys),
    },
    heatmap: heatmap(),
    progress: computeProgress(data, studyMin, dayKey),
    played: {
      todayMinutes: playedMin,
      budgetMinutes: data.settings.playBudgetMinutes,
      sessionStart: data.gameSession?.start ?? null,
    },
    steam: steam && { ...steam, playtimes: undefined },
    steamError,
    config: configStatus(),
    app: {
      version: VERSION,
      desktop: isDesktop,
      autostartSupported,
      autostart,
      closeToBackground: Boolean(data.settings.closeToBackground),
      dataDir: isDesktop ? APP_DIR : null,
    },
  };
  const activity = buildActivity(stats, process.env.LARGE_IMAGE);
  stats.discord = { ...presenceState(), activity };
  return stats;
}

async function pushPresence() {
  try {
    const stats = await buildStats();
    updatePresence(stats.discord.activity);
  } catch (e) {
    console.error("presence update failed:", e.message);
  }
}

// ---------- http ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 10_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const json = (res, code, obj) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
};
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n))));

const routes = {
  "GET /api/stats": async () => buildStats(),
  "POST /api/study/start": async (body) => {
    if (body.subject !== undefined) data.activeSubject = checkSubject(body.subject);
    data.activeStudy ??= Date.now();
    save();
  },
  "POST /api/study/stop": async () => {
    stopSession();
    save();
  },
  // switching mid-session closes the current piece under the old subject, so time is split correctly
  "POST /api/study/subject": async (body) => {
    const subject = checkSubject(body.subject);
    if (data.activeStudy && subject !== data.activeSubject) {
      const now = Date.now();
      stopSession(now);
      data.activeStudy = now;
    }
    data.activeSubject = subject;
    save();
  },
  "POST /api/study/add": async (body) => {
    const minutes = Number(body.minutes);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 720) throw new Error("minutes must be 1-720");
    const subject = checkSubject(body.subject ?? data.activeSubject);
    const d = day();
    const m = Math.round(minutes);
    if (studyMin(dayKey()) + m > 1440) throw new Error(`That would put today over 24 hours (you're at ${Math.floor(studyMin(dayKey()) / 60)}h already)`);
    d.manualMinutes += m;
    if (subject) {
      d.manualBySubject ??= {};
      d.manualBySubject[subject] = (d.manualBySubject[subject] ?? 0) + m;
    }
    // kept separately so it shows in the log and can be deleted
    (d.manualEntries ??= []).push({ at: Date.now(), minutes: m, subject });
    save();
  },
  // remove a finished session or an "added minutes" entry, e.g. a timer left running by mistake
  // take minutes off today, newest time first (see removeMinutes)
  "POST /api/study/remove": async (body) => {
    const minutes = Math.round(Number(body.minutes));
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) throw new Error("minutes must be 1-1440");
    const today = Math.floor(studyMin(dayKey()));
    if (today < 1) throw new Error("There's no study time today to remove");
    const removed = removeMinutes(Math.min(minutes, today));
    save();
    return { removed: Math.round(removed) };
  },
  // set one log entry to an exact length; timed sessions can only get shorter
  "POST /api/study/edit": async (body) => {
    const at = Number(body.at);
    const minutes = Math.round(Number(body.minutes));
    if (!Number.isFinite(minutes) || minutes < 1) throw new Error("Use at least 1 minute (or delete the entry)");
    const d = data.days[dayKey(new Date(at))];
    if (!d) throw new Error("Entry not found");
    if (body.kind === "session") {
      const s = d.sessions.find((x) => x.start === at);
      if (!s) throw new Error("Session not found");
      if (minutes > (s.end - s.start) / 60_000 + 0.5) throw new Error("Timed sessions can only be shortened. Use Add for extra time");
      s.end = s.start + minutes * 60_000;
    } else if (body.kind === "added") {
      const e = (d.manualEntries ?? []).find((x) => x.at === at);
      if (!e) throw new Error("Entry not found");
      const delta = minutes - e.minutes;
      if (delta > 0 && studyMin(dayKey(new Date(at))) + delta > 1440) throw new Error("That would put the day over 24 hours");
      trimEntry(d, e, -delta);
    } else if (body.kind === "legacy") {
      const legacy = d.manualMinutes - (d.manualEntries ?? []).reduce((sum, e) => sum + e.minutes, 0);
      if (minutes > legacy) throw new Error("Earlier added time can only be lowered");
      d.manualMinutes -= legacy - minutes;
    } else throw new Error("kind must be session, added or legacy");
    save();
  },
  "POST /api/study/delete": async (body) => {
    const at = Number(body.at);
    const d = data.days[dayKey(new Date(at))];
    if (!d) throw new Error("Entry not found");
    if (body.kind === "session") {
      const i = d.sessions.findIndex((s) => s.start === at);
      if (i < 0) throw new Error("Session not found");
      d.sessions.splice(i, 1);
    } else if (body.kind === "added") {
      const i = (d.manualEntries ?? []).findIndex((e) => e.at === at);
      if (i < 0) throw new Error("Entry not found");
      const [e] = d.manualEntries.splice(i, 1);
      d.manualMinutes = Math.max(0, d.manualMinutes - e.minutes);
      if (e.subject && d.manualBySubject?.[e.subject] != null) {
        d.manualBySubject[e.subject] = Math.max(0, d.manualBySubject[e.subject] - e.minutes);
        if (!d.manualBySubject[e.subject]) delete d.manualBySubject[e.subject];
      }
    } else if (body.kind === "legacy") {
      // keep only the time that has log entries
      const entries = d.manualEntries ?? [];
      d.manualMinutes = entries.reduce((sum, e) => sum + e.minutes, 0);
      d.manualBySubject = {};
      for (const e of entries) if (e.subject) d.manualBySubject[e.subject] = (d.manualBySubject[e.subject] ?? 0) + e.minutes;
    } else throw new Error("kind must be session, added or legacy");
    save();
  },
  "POST /api/subjects": async (body) => {
    if (body.add != null) {
      const name = String(body.add).trim().replace(/\s+/g, " ");
      if (!name || name.length > 24) throw new Error("Subject names are 1-24 characters");
      if (data.subjects.some((s) => s.toLowerCase() === name.toLowerCase())) throw new Error(`"${name}" already exists`);
      if (data.subjects.length >= 12) throw new Error("You can have up to 12 subjects");
      data.subjects = [...data.subjects, name];
    }
    if (body.remove != null) {
      data.subjects = data.subjects.filter((s) => s !== body.remove);
      // past sessions keep their label; only the picker forgets it
      if (data.activeSubject === body.remove) {
        if (data.activeStudy) {
          const now = Date.now();
          stopSession(now);
          data.activeStudy = now;
        }
        data.activeSubject = null;
      }
    }
    save();
  },
  "POST /api/config": saveConfig,
  "POST /api/autostart": async (body) => {
    autostart = await setAutostart(Boolean(body.enabled));
  },
  "POST /api/quit": async () => {
    setTimeout(flushAndExit, 300);
  },
  "POST /api/window": async () => {
    if (isDesktop) showWindow();
  },
  "POST /api/heartbeat": async () => {
    win.open = true;
    win.lastBeat = Date.now();
    clearTimeout(win.closing);
  },
  "POST /api/closing": async () => {
    const at = Date.now();
    clearTimeout(win.closing);
    // a page change reloads within ~1s and beats again; give it 4s before calling it closed
    win.closing = setTimeout(() => win.lastBeat < at && windowGone("closed"), 4_000);
  },
  "POST /api/settings": async (body) => {
    if (body.goalMinutes != null) data.settings.goalMinutes = clamp(body.goalMinutes, 15, 1440);
    if (body.playBudgetMinutes != null) data.settings.playBudgetMinutes = clamp(body.playBudgetMinutes, 15, 1440);
    if (body.closeToBackground != null) data.settings.closeToBackground = Boolean(body.closeToBackground);
    save();
  },
};

// Only this machine's browser may talk to the API: other websites can't reach it (Origin check),
// and DNS-rebinding tricks fail the Host check.
const LOCAL_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
function isLocalRequest(req) {
  if (!LOCAL_HOSTS.has(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin && !LOCAL_HOSTS.has(origin.replace(/^http:\/\//, ""))) return false;
  if (req.method === "POST" && !String(req.headers["content-type"]).startsWith("application/json")) return false;
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const route = routes[`${req.method} ${url.pathname}`];
  if (url.pathname.startsWith("/api/") && !isLocalRequest(req)) return json(res, 403, { error: "local requests only" });
  if (req.method === "GET" && url.pathname === "/api/achievements") {
    const appid = Number(url.searchParams.get("appid"));
    if (!Number.isInteger(appid) || appid <= 0) return json(res, 400, { error: "appid required" });
    const name = url.searchParams.get("name")?.slice(0, 120) ?? null;
    return json(res, 200, await getAchievementsFor({ key: process.env.STEAM_API_KEY, steamid: process.env.STEAM_ID64 }, appid, name));
  }
  if (req.method === "GET" && url.pathname === "/api/export.csv") {
    res.writeHead(200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="grind-tracker-${dayKey()}.csv"` });
    return res.end("﻿" + exportCsv()); // BOM so Excel reads the UTF-8 correctly
  }
  if (route) {
    try {
      const body = req.method === "POST" ? await readBody(req) : null;
      const out = await route(body);
      if (url.pathname === "/api/heartbeat" || url.pathname === "/api/closing") return json(res, 200, { ok: true });
      if (req.method === "POST") {
        pushPresence();
        return json(res, 200, { ...(await buildStats()), result: out ?? null });
      }
      return json(res, 200, out);
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
  const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: "forbidden" });
  try {
    const content = await loadStatic(rel, file);
    // no-cache = browser revalidates, so dashboard updates show up without a hard refresh
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
    res.end(content);
  } catch {
    json(res, 404, { error: "not found" });
  }
});

// custom art in %APPDATA%\GrindTracker\img wins, then the files baked into the exe, then the source folder
async function loadStatic(rel, file) {
  const posix = rel.split(path.sep).join("/");
  if (posix.startsWith("img/") && !posix.slice(4).includes("/") && hasCustomArt(posix.slice(4))) return readFile(path.join(ART_DIR, posix.slice(4)));
  return readAsset(`public/${posix}`) ?? (await readFile(file));
}

function flushAndExit() {
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  process.exit(0);
}

const URL_HOME = `http://localhost:${PORT}`;
const background = process.argv.includes("--background"); // started by Windows at login: stay quiet

// ---------- the app window (desktop exe only) ----------
// The window's page (bg.js) sends a heartbeat every few seconds and a "closing" beacon when it
// goes away. A beacon with no new heartbeat shortly after (i.e. not just a page change), or a
// long silence (crash, force-close), means the window is gone: quit and free the port.
const WINDOW_URL = `${URL_HOME}/?window=1`;
const win = { open: false, lastBeat: 0, closing: null };

function showWindow() {
  openAppWindow(WINDOW_URL);
}

function windowGone(why) {
  if (!win.open) return;
  win.open = false;
  if (data.settings.closeToBackground) console.log(`Window closed (${why}); still running in the background`);
  else {
    console.log(`Window closed (${why}); quitting`);
    flushAndExit(); // frees the port
  }
}

setInterval(() => {
  if (win.open && Date.now() - win.lastBeat > 45_000) windowGone("no heartbeat");
}, 5_000).unref();

server.on("error", async (e) => {
  if (e.code !== "EADDRINUSE") throw e;
  // already running (e.g. double-clicked twice): just bring up the dashboard
  const alive = await fetch(`${URL_HOME}/api/stats`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok).catch(() => false);
  if (alive) {
    // ask the running copy to open its window (or a browser tab, from source)
    if (!background) await fetch(`${URL_HOME}/api/window`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {});
    process.exit(0);
  }
  console.error(`Port ${PORT} is used by another program. Set a different PORT in ${ENV_FILE}`);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`✓ Grind Tracker ${VERSION} running at ${URL_HOME}${isDesktop ? ` (data: ${APP_DIR})` : ""}`);
  if (!process.env.STEAM_API_KEY || !process.env.STEAM_ID64) console.log("  Steam: demo mode (connect it in the dashboard)");
  if (!process.env.DISCORD_CLIENT_ID) console.log("  Discord: off (connect it in the dashboard)");
  if (isDesktop && !background) showWindow();

  startPresence(process.env.DISCORD_CLIENT_ID);
  setInterval(pushPresence, 15_000);
  pushPresence();
});

process.on("SIGINT", flushAndExit);
