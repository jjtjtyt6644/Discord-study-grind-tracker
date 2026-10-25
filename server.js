import http from "node:http";
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { isDesktop, ROOT, APP_DIR, ART_DIR, VERSION, readAsset, hasCustomArt, openAppWindow, findPortOwner, askYesNo, closeProcess, autostartSupported, getAutostart, setAutostart } from "./desktop.js";
import { getSteam, getAchievementsFor, clearSteamCache, resolveSteamId, verifySteam } from "./steam.js";
import { startPresence, updatePresence, presenceState, buildActivity, reconnectPresence, PRIVACY_DEFAULTS } from "./presence.js";
import { createFocus } from "./focus.js";
import { questsToday, questTotals, QUEST_XP, ALL_QUESTS_BONUS } from "./quests.js";
import { createNotifier, startReminders, NOTIFY_DEFAULTS } from "./notify.js";
import { createGameDetector } from "./games.js";
import { vocab } from "./vocab.js";
import { computeProgress, studyMinutesOf, streakInfo } from "./progress.js";
import { update, checkForUpdate, checkIfStale, installLatest, restartIntoUpdate, startUpdateChecks } from "./updater.js";
import { createStore } from "./store.js";

const ENV_FILE = process.env.ENV_FILE || path.join(APP_DIR, ".env");
try {
  process.loadEnvFile(ENV_FILE);
} catch {}

// first choice; if it's taken by another program we walk up to BASE_PORT + PORT_TRIES
const BASE_PORT = Number(process.env.PORT) || 3000;
const PORT_TRIES = 20;
let PORT = BASE_PORT; // the port we actually got (set once listening)
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

const store = createStore(DATA_FILE); // atomic saves + daily backups + restore (see store.js)
const data = store.load();
const save = () => store.save(data);

const DEFAULT_SUBJECTS = ["Math", "Science", "Coding", "Language", "Reading"];
data.subjects ??= DEFAULT_SUBJECTS;
data.activeSubject ??= null;
data.settings.autoUpdate ??= true;
data.settings.privacy = { ...PRIVACY_DEFAULTS, ...data.settings.privacy };
data.settings.notify = { ...NOTIFY_DEFAULTS, ...data.settings.notify };
data.settings.theme ??= { preset: "mode", accent: null, accent2: null };
data.settings.games = { detect: true, endStudy: true, custom: [], ignore: [], ...data.settings.games };
data.settings.activity ??= "study"; // "study" | "work": only changes the words
data.settings.weekendGoal ??= null; // minutes, or null = same as weekdays
data.settings.autoStudy = { on: true, stop: true, apps: [], ...data.settings.autoStudy }; // apps: [{ exe, name, subject }]
data.settings.status = { text: null, presets: ["cramming for finals", "deep work, no distractions", "studying with friends"], ...data.settings.status };
data.settings.subjectGoals ??= {}; // subject -> minutes per week (Mon-Sun)
data.settings.listStatus ??= "stats"; // what the member list shows after "Playing": stats | game | name
data.paused ??= null; // { at } while a session is paused

// Earned badges are kept for good (id -> when). The first time this runs, every backup is scored too,
// so badges that older versions lost (after edits or goal changes) come back.
if (!data.badges) {
  data.badges = {};
  for (const b of store.readBackups().reverse()) {
    try {
      const p = computeProgress(b.data, studyMinutesOf(b.data), dayKey);
      for (const x of p.badges) if (x.unlocked) data.badges[x.id] ??= Math.round(b.at);
    } catch {}
  }
  save();
}
store.prune();

function keepBadges(p) {
  let added = false;
  for (const b of p.badges) {
    if (b.unlocked && !data.badges[b.id]) {
      data.badges[b.id] = Date.now();
      b.earnedAt = data.badges[b.id];
      added = true;
    }
  }
  if (added) save();
  return p;
}

// the goal for a given day (weekends can have their own)
function goalFor(key = dayKey()) {
  const dow = new Date(`${key}T12:00`).getDay();
  return (dow === 0 || dow === 6) && data.settings.weekendGoal ? data.settings.weekendGoal : data.settings.goalMinutes;
}
const words = (text) => vocab(text, data.settings.activity);

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

const hmText = (m) => `${Math.floor(m / 60)}h ${String(Math.floor(m % 60)).padStart(2, "0")}m`;

// Monday-Sunday weeks, for the weekly report and subject goals
function weekStart(t = new Date()) {
  const d = new Date(t);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
const weekKeysFrom = (start) =>
  Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return dayKey(d);
  });

function weekReport(start) {
  const keys = weekKeysFrom(start);
  const prev = new Date(start);
  prev.setDate(prev.getDate() - 7);
  const days = keys.map((k) => ({ date: k, minutes: Math.round(studyMin(k)) }));
  const best = days.reduce((a, b) => (b.minutes > a.minutes ? b : a));
  const subjects = Object.entries(minutesBySubject(keys)).sort((a, b) => b[1] - a[1]);
  const sessions = keys.flatMap((k) => data.days[k]?.sessions ?? []);
  return {
    from: keys[0],
    to: keys[6],
    days,
    studyMin: days.reduce((s, d) => s + d.minutes, 0),
    prevStudyMin: Math.round(weekKeysFrom(prev).reduce((s, k) => s + studyMin(k), 0)),
    goalDays: keys.filter((k) => k <= dayKey() && studyMin(k) >= goalFor(k)).length,
    best: best.minutes ? best : null,
    subjects: subjects.filter(([, m]) => m >= 1).slice(0, 4).map(([name, minutes]) => ({ name, minutes })),
    playedMin: keys.reduce((s, k) => s + (data.days[k]?.playedMinutes ?? 0), 0),
    sessions: sessions.length,
    focusRounds: sessions.filter((x) => x.focus).length,
    questDays: keys.filter((k) => data.quests?.[k] && data.quests[k].ids.every((id) => data.quests[k].done[id])).length,
  };
}

// the Monday notification
function weeklyText() {
  const start = weekStart();
  start.setDate(start.getDate() - 7);
  const r = weekReport(start);
  const change = r.prevStudyMin ? Math.round(((r.studyMin - r.prevStudyMin) / r.prevStudyMin) * 100) : null;
  const best = r.best ? `, best day ${new Date(`${r.best.date}T12:00`).toLocaleDateString("en-US", { weekday: "long" })} (${hmText(r.best.minutes)})` : "";
  return `${hmText(r.studyMin)} studied${change == null ? "" : ` (${change >= 0 ? "+" : ""}${change}% vs the week before)`}, goal hit on ${r.goalDays}/7 days${best}. Open the dashboard for the full report.`;
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
    ...d.sessions.map((s) => ({ kind: "session", at: s.start, end: s.end, minutes: Math.round((s.end - s.start) / 60_000), subject: s.subject ?? null, note: s.note ?? null, focus: Boolean(s.focus) })),
    ...(d.manualEntries ?? []).map((e) => ({ kind: "added", at: e.at, minutes: e.minutes, subject: e.subject ?? null, note: e.note ?? null })),
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
  const rows = [["date", "type", "start", "end", "minutes", "subject", "note"]];
  for (const k of Object.keys(data.days).sort()) {
    const d = data.days[k];
    for (const s of d.sessions) rows.push([k, s.focus ? "focus" : "session", time(s.start), time(s.end), Math.round((s.end - s.start) / 60_000), s.subject, s.note]);
    for (const e of d.manualEntries ?? []) rows.push([k, "added", time(e.at), "", e.minutes, e.subject, e.note]);
    for (const g of d.games ?? []) rows.push([k, "game", time(g.start), time(g.end), Math.round((g.end - g.start) / 60_000), g.name, ""]);
  }
  return rows.map((r) => r.map(q).join(",")).join("\r\n");
}

function checkSubject(subject) {
  if (subject == null || subject === "") return null;
  if (!data.subjects.includes(subject)) throw new Error(`Unknown subject "${subject}"`);
  return subject;
}

function stopSession(at = Date.now(), extra = {}) {
  splitAtMidnight();
  if (!data.activeStudy) return;
  day(dayKey(new Date(data.activeStudy))).sessions.push({ start: data.activeStudy, end: at, subject: data.activeSubject, ...extra });
  data.activeStudy = null;
}

const nextMidnight = (t) => {
  const d = new Date(t);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
};

// record start → end as study sessions, one piece per calendar day
function addStudySpan(start, end, subject) {
  for (let from = start; from < end; ) {
    const to = Math.min(end, nextMidnight(from));
    if (to - from >= 30_000) day(dayKey(new Date(from))).sessions.push({ start: from, end: to, subject });
    from = to;
  }
}

// The timer only counts while this PC is on and Grind Tracker is running. If it was closed, or the PC
// was off or asleep, during a session (no sign of life for 5+ minutes), the session ends where it was
// last seen running. You get a notification, and the dashboard offers to keep the missing time.
const ALIVE_GAP = 5 * 60_000;
let aliveSaved = 0;
function checkGap(now = Date.now()) {
  const last = data.lastAlive;
  data.lastAlive = now;
  if (last && now - last >= ALIVE_GAP && data.activeStudy && data.activeStudy < last) {
    const subject = data.activeSubject;
    addStudySpan(data.activeStudy, last, subject);
    const kept = (last - data.activeStudy) / 60_000;
    data.activeStudy = null;
    if (focus.isFocusing()) focus.stop(); // the round is already saved above (cut short, so not a focus round)
    data.paused = null;
    data.autoStudy = null;
    data.offlineGap = { from: last, to: now, subject };
    save();
    const at = new Date(last).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    notify("gap", "Study timer stopped", `Grind Tracker wasn't running from ${at} (PC off, asleep or app closed), so your session ended there with ${hmText(kept)} saved. Studied through it? Open the dashboard to keep the missing ${hmText((now - last) / 60_000)}.`);
    return;
  }
  if (now - aliveSaved > 60_000) {
    aliveSaved = now;
    save(); // so a crash or power cut loses at most a minute
  }
}

// A session (or detected game) still running after midnight is cut there, so yesterday keeps its part
// and today starts counting from 00:00. The piece before midnight never counts as a focus round.
function splitAtMidnight() {
  checkGap();
  let changed = false;
  while (data.activeStudy && dayKey(new Date(data.activeStudy)) !== dayKey()) {
    const cut = nextMidnight(data.activeStudy);
    day(dayKey(new Date(data.activeStudy))).sessions.push({ start: data.activeStudy, end: cut, subject: data.activeSubject });
    data.activeStudy = cut;
    changed = true;
  }
  while (data.gameLive && dayKey(new Date(data.gameLive.start)) !== dayKey()) {
    const cut = nextMidnight(data.gameLive.start);
    (day(dayKey(new Date(data.gameLive.start))).games ??= []).push({ name: data.gameLive.name, start: data.gameLive.start, end: cut });
    data.gameLive.start = cut;
    changed = true;
  }
  if (changed) save();
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
  // write-then-rename so a crash mid-save can never leave a half-written keys file
  await writeFile(`${ENV_FILE}.tmp`, lines.join("\n").replace(/\n*$/, "\n"));
  await rename(`${ENV_FILE}.tmp`, ENV_FILE);
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
// ---------- focus timer, quests, notifications ----------
const NOTIFY_ICON = path.join(APP_DIR, "notify-icon.png");
const notifier = createNotifier({
  windowsToasts: isDesktop && process.platform === "win32",
  iconPath: () => (hasCustomArt("logo-small.png") ? path.join(ART_DIR, "logo-small.png") : NOTIFY_ICON),
  getSettings: () => data.settings.notify,
});
if (isDesktop) {
  const icon = readAsset("public/img/logo-small.png"); // toasts need the logo as a real file
  if (icon) writeFile(NOTIFY_ICON, icon).catch(() => {});
}
const notify = (kind, title, body) => notifier.notify(kind, words(title), words(body));

const focus = createFocus({
  data,
  startStudy: () => (data.activeStudy ??= Date.now()),
  stopStudy: (extra) => stopSession(Date.now(), extra),
  save: () => {
    save();
    pushPresence();
  },
  notify: (title, body) => notify("focus", title, body),
});

// today's numbers, for quests and reminders
function todayFacts() {
  const k = dayKey();
  const d = data.days[k] ?? { sessions: [] };
  const finished = d.sessions.map((x) => ({ min: (x.end - x.start) / 60_000, start: x.start, subject: x.subject, focus: x.focus }));
  const live = data.activeStudy && dayKey(new Date(data.activeStudy)) === k ? { min: (Date.now() - data.activeStudy) / 60_000, start: data.activeStudy, subject: data.activeSubject } : null;
  const all = live ? [...finished, live] : finished;
  const subjects = new Set([...all.map((x) => x.subject), ...Object.keys(d.manualBySubject ?? {})].filter(Boolean));
  return {
    day: k,
    studyMin: studyMin(k),
    sessions45: finished.filter((x) => x.min >= 45).length,
    sessions25: finished.filter((x) => x.min >= 25).length,
    longest: Math.max(0, ...all.map((x) => x.min)),
    focusRounds: finished.filter((x) => x.focus).length,
    subjects: subjects.size,
    early: all.some((x) => new Date(x.start).getHours() < 10),
    played: d.playedMinutes ?? 0,
  };
}

function currentQuests() {
  const q = questsToday(data, dayKey(), todayFacts(), { ...data.settings, goalMinutes: goalFor() });
  for (const x of q.list) x.text = words(x.text);
  if (q.fresh.length) {
    save();
    for (const text of q.fresh) notify("quests", `Quest complete  +${QUEST_XP} XP`, text);
    if (q.allDone) notify("quests", `All 3 quests cleared  +${ALL_QUESTS_BONUS} XP`, `Quest streak: ${q.streak} day${q.streak === 1 ? "" : "s"}. See you tomorrow.`);
  }
  return q;
}

startReminders({
  data,
  save,
  notify,
  getSettings: () => data.settings.notify,
  facts: () => ({ ...todayFacts(), goal: goalFor(), budget: data.settings.playBudgetMinutes, activeSince: data.activeStudy, focusing: focus.isFocusing() }),
  recap: () => {
    const q = currentQuests();
    const p = computeProgress(data, studyMin, dayKey, questTotals(data), goalFor);
    const t = todayFacts();
    const hm = (m) => `${Math.floor(m / 60)}h ${String(Math.floor(m % 60)).padStart(2, "0")}m`;
    return `${hm(t.studyMin)} studied · ${hm(t.played)} played · ${q.list.filter((x) => x.done).length}/3 quests · lv ${p.level} ${p.rank}`;
  },
  weekly: weeklyText,
});
setInterval(splitAtMidnight, 30_000).unref();
setInterval(currentQuests, 30_000).unref(); // quests also complete while the window is closed

let artVersion = Date.now(); // bumped on upload so the dashboard reloads the images

// ---------- any-game detection (Discord's game list + your own programs) ----------
const games = createGameDetector({ cacheFile: path.join(APP_DIR, "games-db.json"), getSettings: () => data.settings.games });
let lastSteam = null; // latest Steam result, so a Steam game isn't counted twice
let detected = null; // what the last scan found (even if Steam is the one tracking it)
const norm = (n) => String(n ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// finished detected-game sessions live in data.days[day].games; the running one in data.gameLive
function endLiveGame(at) {
  const live = data.gameLive;
  if (!live) return;
  const end = Math.max(live.start, Math.min(at, (live.seen ?? at) + 20_000)); // app closed meanwhile? stop at last sighting
  (day(dayKey(new Date(live.start))).games ??= []).push({ name: live.name, start: live.start, end });
  data.gameLive = null;
}

async function scanGames() {
  const found = await games.scan().catch(() => null);
  detected = found;
  const steamGame = lastSteam?.profile.currentGame;
  const g = found && !(steamGame && norm(steamGame.name) === norm(found.name)) ? found : null; // Steam already counts its own games
  const live = data.gameLive;
  if (live && (!g || g.name !== live.name)) {
    endLiveGame(Date.now());
    save();
  }
  if (g && !data.gameLive) {
    data.gameLive = { name: g.name, icon: g.icon, exe: g.exe, source: g.source, start: Date.now(), seen: Date.now() };
    save();
    pushPresence();
  } else if (data.gameLive) data.gameLive.seen = Date.now();
  gameOpened(steamGame?.name ?? found?.name ?? null);
  autoStudy(games.running());
}

// A game that opens while you're studying ends the session (it's saved) and you switch to gaming.
// Only an actual launch counts: a game that was already running when you pressed Start is left alone.
let gameBefore; // game seen at the last scan (undefined until the first scan)
function gameOpened(name) {
  const before = gameBefore;
  gameBefore = name;
  if (before === undefined || !name || name === before) return;
  if (!data.activeStudy || data.settings.games.endStudy === false) return;
  const mins = (Date.now() - data.activeStudy) / 60_000;
  if (focus.isFocusing()) focus.stop(); // a cut-short focus round still counts as study time
  else stopSession();
  data.paused = null;
  data.autoStudy = null;
  save();
  pushPresence();
  notify("auto", `${name} opened`, `Study session saved (${hmText(mins)}). Switched to gaming. Have fun!`);
}

// Settings → Auto-start: opening one of your study apps starts the timer (with that app's subject),
// and closing them all stops it again - but only a session that was started this way.
let studyAppsOpen = null; // study apps seen at the last scan (null until the first scan)
function autoStudy(running) {
  const s = data.settings.autoStudy;
  const open = s.apps.filter((a) => running.includes(a.exe));
  const before = studyAppsOpen;
  studyAppsOpen = open.map((a) => a.exe);
  if (!before || !s.on) return; // apps already open when Grind Tracker starts don't count as "opened"
  const opened = open.find((a) => !before.includes(a.exe));
  if (opened && !data.activeStudy && !focus.isFocusing()) {
    if (opened.subject && data.subjects.includes(opened.subject)) data.activeSubject = opened.subject;
    data.paused = null;
    data.activeStudy = Date.now();
    data.autoStudy = opened.exe;
    save();
    pushPresence();
    notify("auto", "Started studying", `${opened.name} opened, so your timer is running${data.activeSubject ? ` (${data.activeSubject})` : ""}.`);
  } else if (!open.length && before.length && data.autoStudy && data.activeStudy && s.stop && !focus.isFocusing()) {
    const name = s.apps.find((a) => a.exe === data.autoStudy)?.name ?? "Your study app";
    const mins = (Date.now() - data.activeStudy) / 60_000;
    stopSession();
    data.autoStudy = null;
    save();
    pushPresence();
    notify("auto", "Session saved", `${name} closed, so the timer stopped after ${Math.floor(mins / 60)}h ${String(Math.floor(mins % 60)).padStart(2, "0")}m.`);
  }
}
if (data.gameLive) setTimeout(scanGames, 3000); // finish or continue a game from before a restart

function localPlayed(key) {
  let min = (data.days[key]?.games ?? []).reduce((sum, g) => sum + (g.end - g.start) / 60_000, 0);
  if (data.gameLive && dayKey(new Date(data.gameLive.start)) === key) min += (Date.now() - data.gameLive.start) / 60_000;
  return min;
}

async function buildStats() {
  splitAtMidnight();
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

  lastSteam = steam;
  const steamPlayed = !steam ? 0 : steam.demo ? steam.demoPlayedToday : playedToday(steam);
  const playedMin = steamPlayed + localPlayed(dayKey());
  const steamGame = steam?.profile.currentGame;
  // the game you're in, from Steam or detected on your PC
  const game = steamGame
    ? { name: steamGame.name, icon: steamGame.header, source: "steam", since: data.gameSession?.start ?? null }
    : data.gameLive
      ? { name: data.gameLive.name, icon: data.gameLive.icon, source: data.gameLive.source, since: data.gameLive.start }
      : null;
  // keep a per-day record of play time: budget alerts, quests, recap and badges all read it
  // (Steam + detected games; skipped in demo mode so sample data never lands in your history)
  if (!steam?.demo && day().playedMinutes !== Math.round(playedMin)) {
    day().playedMinutes = Math.round(playedMin);
    save();
  }
  const weekKeys = week.map((d) => d.date);
  const thisWeek = weekStart();
  const lastWeek = new Date(thisWeek);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const subjectWeek = minutesBySubject(weekKeysFrom(thisWeek));
  const mode = data.activeStudy ? "study" : game ? "gaming" : "idle";
  const sessions = (data.days[dayKey()]?.sessions ?? []).map((s) => s.end - s.start);

  const stats = {
    now: Date.now(),
    mode,
    study: {
      todayMs: studyMs(dayKey()),
      activeSince: data.activeStudy,
      goalMinutes: goalFor(),
      sessionsToday: sessions.length,
      longestSessionMs: Math.max(0, ...sessions),
      subject: data.activeSubject,
      pausedAt: data.paused?.at ?? null,
      offlineGap: data.offlineGap ?? null,
      autoStarted: data.activeStudy && data.autoStudy ? (data.settings.autoStudy.apps.find((a) => a.exe === data.autoStudy)?.name ?? null) : null,
      log: todayLog(),
      week,
    },
    streak: streakInfo(data, studyMin, dayKey, goalFor),
    weekly: { last: weekReport(lastWeek), current: weekReport(thisWeek) },
    subjects: {
      list: data.subjects,
      today: minutesBySubject([dayKey()]),
      week: minutesBySubject(weekKeys),
      // this week's (Mon-Sun) progress toward each weekly subject goal
      goals: Object.entries(data.settings.subjectGoals)
        .filter(([s]) => data.subjects.includes(s))
        .map(([subject, goal]) => ({ subject, goal, done: subjectWeek[subject] ?? 0 })),
    },
    heatmap: heatmap(),
    quests: currentQuests(),
    focus: focus.state(),
    progress: keepBadges(computeProgress(data, studyMin, dayKey, questTotals(data), goalFor)),
    game,
    games: { ...games.info(), detect: data.settings.games.detect !== false, endStudy: data.settings.games.endStudy !== false, custom: data.settings.games.custom, ignore: data.settings.games.ignore, detected },
    played: {
      todayMinutes: playedMin,
      budgetMinutes: data.settings.playBudgetMinutes,
      sessionStart: game?.since ?? null,
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
      autoUpdate: data.settings.autoUpdate !== false,
      backups: store.info(),
      update,
      dataDir: isDesktop ? APP_DIR : null,
    },
    prefs: { privacy: data.settings.privacy, notify: data.settings.notify, theme: data.settings.theme, focus: data.settings.focus, activity: data.settings.activity, weekendGoal: data.settings.weekendGoal, weekdayGoal: data.settings.goalMinutes, status: data.settings.status, listStatus: data.settings.listStatus, autoStudy: data.settings.autoStudy, subjectGoals: data.settings.subjectGoals },
    art: { bg: hasCustomArt("bg.jpg"), logo: hasCustomArt("logo-small.png"), v: artVersion },
    inbox: notifier.inbox(),
  };
  for (const b of stats.progress.badges) b.desc = words(b.desc);
  const activity = buildActivity(stats, process.env.LARGE_IMAGE, data.settings.privacy);
  // (a game's name is left exactly as it is)
  const gameLine = stats.mode === "gaming" && stats.game;
  if (activity) for (const k of ["details", "state", "largeImageText"]) if (activity[k] && !(k === "details" && gameLine)) activity[k] = words(activity[k]);
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

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("That image is too big (15 MB max)"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const json = (res, code, obj) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
};
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n))));
const MAX_MINUTES = 100_000; // ~69 days: a typo guard, not a real limit

// More than 24h in one day is allowed, but the dashboard asks first (it's usually a typo).
function confirmOverDay(dayMinutes, body) {
  if (dayMinutes <= 1440 || body.force) return;
  const err = new Error(`That puts the day at ${Math.floor(dayMinutes / 60)}h ${String(Math.round(dayMinutes % 60)).padStart(2, "0")}m, more than 24 hours. Add it anyway?`);
  err.confirm = true;
  throw err;
}

const routes = {
  "GET /api/stats": async () => buildStats(),
  // cheap "are you Grind Tracker?" check used to find a running copy on any port
  "GET /api/ping": async () => ({ app: "grind-tracker", version: VERSION }),
  "POST /api/study/start": async (body) => {
    if (focus.inBreak()) focus.stop(); // starting a normal session ends a focus break
    if (body.subject !== undefined) data.activeSubject = checkSubject(body.subject);
    data.activeStudy ??= Date.now();
    data.paused = null;
    data.autoStudy = null; // started by hand, so closing a study app won't stop it
    save();
  },
  "POST /api/study/stop": async () => {
    if (focus.isFocusing()) focus.stop();
    else stopSession();
    data.paused = null;
    data.autoStudy = null;
    save();
  },
  // pause = save the session so far; resume starts a new one with the same subject
  "POST /api/study/pause": async () => {
    if (focus.isFocusing()) throw new Error("The focus timer has its own breaks. Use Skip or Stop");
    if (!data.activeStudy) throw new Error("Nothing to pause");
    stopSession();
    data.paused = { at: Date.now() };
    save();
  },
  // after a gap (PC off/asleep, app closed): keep that time as studied too, or just dismiss the notice
  "POST /api/study/gap": async (body) => {
    const g = data.offlineGap;
    if (!g) throw new Error("Nothing to keep");
    if (body.keep) addStudySpan(g.from, g.to, g.subject);
    data.offlineGap = null;
    save();
    return { kept: body.keep ? Math.round((g.to - g.from) / 60_000) : 0 };
  },
  "POST /api/study/resume": async () => {
    if (!data.paused) throw new Error("Nothing is paused");
    data.paused = null;
    data.activeStudy ??= Date.now();
    save();
  },
  "POST /api/focus/start": async () => {
    data.paused = null;
    return focus.start();
  },
  "POST /api/focus/skip": async () => focus.skip(),
  "POST /api/focus/stop": async () => focus.stop(),
  "POST /api/notify/test": async () => notifier.test(),
  // Settings → Games → "Add a program": what's running right now
  "GET /api/processes": async () => games.candidates(),
  "POST /api/games/rescan": async () => scanGames(),
  // a short note on a log entry ("chapter 4 problems")
  "POST /api/study/note": async (body) => {
    const at = Number(body.at);
    const note = String(body.note ?? "").trim().slice(0, 140);
    const d = data.days[dayKey(new Date(at))];
    const item = body.kind === "session" ? d?.sessions.find((x) => x.start === at) : body.kind === "added" ? d?.manualEntries?.find((x) => x.at === at) : null;
    if (!item) throw new Error("Entry not found");
    if (note) item.note = note;
    else delete item.note;
    save();
  },
  "POST /api/art/reset": async (body) => {
    const files = body.slot === "bg" ? ["bg.jpg"] : body.slot === "logo" ? ["logo-small.png", "logo.png"] : [];
    for (const f of files) await rm(path.join(ART_DIR, f), { force: true });
    artVersion = Date.now();
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
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_MINUTES) throw new Error("Enter a number of minutes (1 or more)");
    const subject = checkSubject(body.subject ?? data.activeSubject);
    const d = day();
    const m = Math.round(minutes);
    confirmOverDay(studyMin(dayKey()) + m, body);
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
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_MINUTES) throw new Error("Enter a number of minutes (1 or more)");
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
      if (delta > 0) confirmOverDay(studyMin(dayKey(new Date(at))) + delta, body);
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
  "POST /api/update/check": async () => {
    await checkForUpdate({ autoInstall: data.settings.autoUpdate !== false });
  },
  "POST /api/update/install": async () => {
    await installLatest();
    if (update.status === "error") throw new Error(update.error);
  },
  "POST /api/update/restart": async () => {
    if (update.status !== "ready") throw new Error("No update is waiting");
    setTimeout(restartNow, 200);
  },
  // Settings → Data: show the data or backups folder in Explorer (desktop app only)
  "POST /api/open-folder": async (body) => {
    if (!isDesktop) throw new Error("Open the project folder to find data.json");
    const dir = body.which === "backups" ? store.info().folder : APP_DIR;
    mkdirSync(dir, { recursive: true });
    execFile("explorer", [dir]);
  },
  "POST /api/window": async () => {
    if (isDesktop) showWindow();
    reconnectPresence(false); // opening the app again also revives a dead Discord connection
  },
  "POST /api/discord/reconnect": async () => {
    if (!reconnectPresence()) throw new Error("Add your Discord Application ID first");
  },
  "POST /api/heartbeat": async () => {
    if (!win.open && isDesktop) checkIfStale(autoInstall); // window just opened
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
    if (body.goalMinutes != null) data.settings.goalMinutes = clamp(body.goalMinutes, 1, MAX_MINUTES);
    if (body.playBudgetMinutes != null) data.settings.playBudgetMinutes = clamp(body.playBudgetMinutes, 1, MAX_MINUTES);
    if (body.closeToBackground != null) data.settings.closeToBackground = Boolean(body.closeToBackground);
    if (body.autoUpdate != null) data.settings.autoUpdate = Boolean(body.autoUpdate);
    // only known switches get through; everything else is ignored
    const bools = (target, src, keys) => {
      for (const k of keys) if (typeof src?.[k] === "boolean") target[k] = src[k];
    };
    if (body.privacy) bools(data.settings.privacy, body.privacy, Object.keys(PRIVACY_DEFAULTS));
    if (body.notify) {
      bools(data.settings.notify, body.notify, ["on", "goal", "budget", "focus", "quests", "nudge", "recap", "auto", "weekly"]);
      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(body.notify.recapAt ?? "")) data.settings.notify.recapAt = body.notify.recapAt;
      if (body.notify.breakAfter != null) data.settings.notify.breakAfter = clamp(body.notify.breakAfter, 0, 600);
      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(body.notify.nudgeAt ?? "")) data.settings.notify.nudgeAt = body.notify.nudgeAt;
    }
    if (body.theme) {
      const hex = (v) => (/^#[0-9a-f]{6}$/i.test(v ?? "") ? v : null);
      const PRESETS = ["mode", "sakura", "ocean", "ember", "matcha", "mono", "custom"];
      data.settings.theme = {
        preset: PRESETS.includes(body.theme.preset) ? body.theme.preset : data.settings.theme.preset,
        accent: hex(body.theme.accent) ?? data.settings.theme.accent,
        accent2: hex(body.theme.accent2) ?? data.settings.theme.accent2,
      };
    }
    if (body.activity === "study" || body.activity === "work") data.settings.activity = body.activity;
    if (["stats", "game", "name"].includes(body.listStatus)) data.settings.listStatus = body.listStatus;
    if (body.weekendGoal !== undefined) data.settings.weekendGoal = body.weekendGoal ? clamp(body.weekendGoal, 1, MAX_MINUTES) : null;
    if (body.games) {
      const g = data.settings.games;
      const exe = (v) => (/^[\w .()+-]{1,80}\.exe$/i.test(String(v ?? "").trim()) ? String(v).trim().toLowerCase() : null);
      if (typeof body.games.detect === "boolean") g.detect = body.games.detect;
      if (typeof body.games.endStudy === "boolean") g.endStudy = body.games.endStudy;
      if (body.games.addCustom) {
        const e = exe(body.games.addCustom.exe);
        const name = String(body.games.addCustom.name ?? "").trim().slice(0, 60) || e?.replace(/\.exe$/, "");
        if (!e) throw new Error("Pick a program (.exe) to add");
        g.custom = [...g.custom.filter((c) => c.exe !== e), { exe: e, name }];
        g.ignore = g.ignore.filter((x) => x !== e);
      }
      if (body.games.removeCustom) g.custom = g.custom.filter((c) => c.exe !== String(body.games.removeCustom).toLowerCase());
      if (body.games.addIgnore && exe(body.games.addIgnore)) g.ignore = [...new Set([...g.ignore, exe(body.games.addIgnore)])];
      if (body.games.removeIgnore) g.ignore = g.ignore.filter((x) => x !== String(body.games.removeIgnore).toLowerCase());
      setTimeout(scanGames, 100); // apply right away
    }
    if (body.autoStudy) {
      const a = data.settings.autoStudy;
      if (typeof body.autoStudy.on === "boolean") a.on = body.autoStudy.on;
      if (typeof body.autoStudy.stop === "boolean") a.stop = body.autoStudy.stop;
      if (body.autoStudy.add) {
        const exe = String(body.autoStudy.add.exe ?? "").trim().toLowerCase();
        if (!/^[\w .()+-]{1,80}\.exe$/.test(exe)) throw new Error("Pick a program (.exe) to add");
        const name = String(body.autoStudy.add.name ?? "").trim().slice(0, 60) || exe.replace(/\.exe$/, "");
        const subject = body.autoStudy.add.subject ? checkSubject(body.autoStudy.add.subject) : null;
        a.apps = [...a.apps.filter((x) => x.exe !== exe), { exe, name, subject }];
        if (a.apps.length > 20) throw new Error("You can add up to 20 study apps");
        if (studyAppsOpen && games.running().includes(exe)) studyAppsOpen.push(exe); // already open: wait for the next launch
      }
      if (body.autoStudy.remove) a.apps = a.apps.filter((x) => x.exe !== String(body.autoStudy.remove).toLowerCase());
    }
    if (body.status) {
      const st = data.settings.status;
      const clean = (v) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
      if (body.status.text !== undefined) st.text = clean(body.status.text) || null;
      if (body.status.add) {
        const t = clean(body.status.add);
        if (!t) throw new Error("Type a status first");
        if (!st.presets.includes(t)) st.presets = [...st.presets, t].slice(-12);
      }
      if (body.status.remove) {
        st.presets = st.presets.filter((p) => p !== body.status.remove);
        if (st.text === body.status.remove) st.text = null;
      }
    }
    if (body.subjectGoal) {
      const subject = checkSubject(body.subjectGoal.subject);
      if (!subject) throw new Error("Pick a subject");
      const min = Math.round(Number(body.subjectGoal.minutes));
      if (min > 0) data.settings.subjectGoals[subject] = clamp(min, 1, 10_080);
      else delete data.settings.subjectGoals[subject];
    }
    if (body.focus) {
      const f = data.settings.focus;
      if (body.focus.focus != null) f.focus = clamp(body.focus.focus, 1, 240);
      if (body.focus.short != null) f.short = clamp(body.focus.short, 1, 120);
      if (body.focus.long != null) f.long = clamp(body.focus.long, 1, 240);
      if (body.focus.every != null) f.every = clamp(body.focus.every, 1, 12);
      if (typeof body.focus.autoNext === "boolean") f.autoNext = body.focus.autoNext;
    }
    save();
  },
};

// Only this machine's browser may talk to the API: other websites can't reach it (Origin check),
// and DNS-rebinding tricks fail the Host check.
function isLocalRequest(req) {
  const LOCAL_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
  if (!LOCAL_HOSTS.has(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin && !LOCAL_HOSTS.has(origin.replace(/^http:\/\//, ""))) return false;
  const type = String(req.headers["content-type"]);
  const isUpload = req.url.startsWith("/api/art/upload") && /^image\/(png|jpeg|webp|gif)$/.test(type);
  if (req.method === "POST" && !type.startsWith("application/json") && !isUpload) return false;
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const route = routes[`${req.method} ${url.pathname}`];
  if (url.pathname.startsWith("/api/") && !isLocalRequest(req)) return json(res, 403, { error: "local requests only" });
  // Settings → Appearance: your own character art / logo (raw image body, up to 15 MB)
  if (req.method === "POST" && url.pathname === "/api/art/upload") {
    const slot = { bg: "bg.jpg", logo: "logo-small.png", "logo-full": "logo.png" }[url.searchParams.get("slot")];
    if (!slot) return json(res, 400, { error: "unknown slot" });
    try {
      const buf = await readRaw(req, 15 * 1024 * 1024);
      const magic = buf.subarray(0, 12).toString("latin1");
      const isImage = magic.startsWith("\x89PNG") || magic.startsWith("\xff\xd8\xff") || magic.startsWith("GIF8") || (magic.startsWith("RIFF") && magic.slice(8, 12) === "WEBP");
      if (!isImage) return json(res, 400, { error: "That file isn't a PNG, JPG, WebP or GIF image" });
      mkdirSync(ART_DIR, { recursive: true });
      await writeFile(path.join(ART_DIR, slot), buf);
      artVersion = Date.now();
      return json(res, 200, { ok: true, v: artVersion });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }
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
      return json(res, 400, { error: e.message, confirm: Boolean(e.confirm) });
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
  store.saveNow(data);
  process.exit(0);
}

const urlHome = () => `http://localhost:${PORT}`;
const background = process.argv.includes("--background"); // started by Windows at login: stay quiet

// ---------- the app window (desktop exe only) ----------
// The window's page (bg.js) sends a heartbeat every few seconds and a "closing" beacon when it
// goes away. A beacon with no new heartbeat shortly after (i.e. not just a page change), or a
// long silence (crash, force-close), means the window is gone: quit and free the port.
const win = { open: false, lastBeat: 0, closing: null };

function showWindow() {
  openAppWindow(`${urlHome()}/?window=1`);
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

// Is Grind Tracker already running on one of our ports? (/api/ping is cheap, unlike /api/stats)
async function findRunningCopy() {
  const ports = Array.from({ length: PORT_TRIES + 1 }, (_, i) => BASE_PORT + i);
  const hits = await Promise.all(
    ports.map((p) =>
      fetch(`http://localhost:${p}/api/ping`, { signal: AbortSignal.timeout(1500) })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => (j?.app === "grind-tracker" ? p : null))
        .catch(() => null)
    )
  );
  return hits.find(Boolean) ?? null;
}

const listenOn = (port) =>
  new Promise((resolve, reject) => {
    const fail = (e) => {
      server.off("listening", ok);
      reject(e);
    };
    const ok = () => {
      server.off("error", fail);
      resolve();
    };
    server.once("error", fail);
    server.once("listening", ok);
    server.listen(port, "127.0.0.1");
  });

// The usual port first. If another program holds it, the desktop app names that program and
// asks whether to close it - nothing is closed without a Yes. No (or silent startup) = next port.
async function claimBasePort() {
  const tryBase = () =>
    listenOn(BASE_PORT).then(
      () => true,
      (e) => {
        if (e.code !== "EADDRINUSE" && e.code !== "EACCES") throw e;
        return e.code;
      }
    );
  const first = await tryBase();
  if (first === true) return (PORT = BASE_PORT), true;
  console.warn(`Port ${BASE_PORT} is unavailable (${first})`);
  if (first !== "EADDRINUSE" || !isDesktop || background) return false;

  const owner = await findPortOwner(BASE_PORT);
  if (!owner) return false;
  const yes = await askYesNo(
    "Grind Tracker - port in use",
    `Port ${BASE_PORT} is being used by ${owner.name} (process ${owner.pid}).\n\n` +
      `Close ${owner.name} so Grind Tracker can use port ${BASE_PORT}?\n\n` +
      `Choose No to leave it running. Grind Tracker will use the next free port instead.`
  );
  if (!yes) {
    console.log(`Kept ${owner.name} running; using another port`);
    return false;
  }
  console.log(`Closing ${owner.name} (${owner.pid}) to free port ${BASE_PORT}`);
  await closeProcess(owner.pid);
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 300)); // give Windows a moment to release the port
    if ((await tryBase()) === true) return (PORT = BASE_PORT), true;
  }
  console.warn(`Port ${BASE_PORT} still busy after closing ${owner.name}; using another port`);
  return false;
}

async function start() {
  const running = await findRunningCopy();
  if (running) {
    // already open (double-clicked again, or started with Windows): just bring up its window
    if (!background) {
      await fetch(`http://localhost:${running}/api/window`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {});
    }
    process.exit(0);
  }

  let bound = (await claimBasePort()) || false;
  for (let p = BASE_PORT + 1; p <= BASE_PORT + PORT_TRIES && !bound; p++) {
    try {
      await listenOn(p);
      PORT = p;
      bound = true;
    } catch (e) {
      // EADDRINUSE: another program has it. EACCES: Windows reserves some port ranges (Hyper-V, WSL...)
      if (e.code !== "EADDRINUSE" && e.code !== "EACCES") throw e;
      console.warn(`Port ${p} is unavailable (${e.code}), trying ${p + 1}`);
    }
  }
  if (!bound) {
    console.error(`Ports ${BASE_PORT}-${BASE_PORT + PORT_TRIES} are all in use. Set a different PORT in ${ENV_FILE}`);
    process.exit(1);
  }

  console.log(`✓ Grind Tracker ${VERSION} running at ${urlHome()}${isDesktop ? ` (data: ${APP_DIR})` : ""}`);
  if (!process.env.STEAM_API_KEY || !process.env.STEAM_ID64) console.log("  Steam: demo mode (connect it in the dashboard)");
  if (!process.env.DISCORD_CLIENT_ID) console.log("  Discord: off (connect it in the dashboard)");
  if (isDesktop && !background) showWindow();

  startPresence(process.env.DISCORD_CLIENT_ID);
  scanGames();
  setInterval(scanGames, 15_000);
  setInterval(pushPresence, 15_000);
  pushPresence();
  startUpdater();
}

const autoInstall = () => data.settings.autoUpdate !== false;

// free the port, then start the new exe; an open window keeps beating to the same port
function restartNow() {
  restartIntoUpdate((done) => {
    store.saveNow(data);
    server.close();
    server.closeAllConnections();
    setTimeout(done, 300);
  });
}

function startUpdater() {
  startUpdateChecks(autoInstall, {
    beforeInstall: (version) => store.backup(data, `before-v${version}`),
    // nobody's looking at the window: switch to the new version right away, silently
    onReady: () => {
      if (!win.open) {
        console.log("Window is closed; restarting into the update now");
        setTimeout(restartNow, 1000);
      }
    },
  });
}

start();

process.on("SIGINT", flushAndExit);
