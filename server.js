import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getSteam } from "./steam.js";
import { startPresence, updatePresence, presenceState, buildActivity } from "./presence.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {}

const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = path.join(ROOT, "data.json");
const PUBLIC = path.join(ROOT, "public");
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" };

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

const day = (key = dayKey()) => (data.days[key] ??= { sessions: [], manualMinutes: 0, snapshot: null });

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
      week,
    },
    played: {
      todayMinutes: playedMin,
      budgetMinutes: data.settings.playBudgetMinutes,
      sessionStart: data.gameSession?.start ?? null,
    },
    steam: steam && { ...steam, playtimes: undefined },
    steamError,
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
  "POST /api/study/start": async () => {
    data.activeStudy ??= Date.now();
    save();
  },
  "POST /api/study/stop": async () => {
    if (data.activeStudy) {
      day(dayKey(new Date(data.activeStudy))).sessions.push({ start: data.activeStudy, end: Date.now() });
      data.activeStudy = null;
      save();
    }
  },
  "POST /api/study/add": async (body) => {
    const minutes = Number(body.minutes);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 720) throw new Error("minutes must be 1-720");
    day().manualMinutes += Math.round(minutes);
    save();
  },
  "POST /api/settings": async (body) => {
    if (body.goalMinutes != null) data.settings.goalMinutes = clamp(body.goalMinutes, 15, 1440);
    if (body.playBudgetMinutes != null) data.settings.playBudgetMinutes = clamp(body.playBudgetMinutes, 15, 1440);
    save();
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const route = routes[`${req.method} ${url.pathname}`];
  if (route) {
    try {
      const body = req.method === "POST" ? await readBody(req) : null;
      const out = await route(body);
      if (req.method === "POST") {
        pushPresence();
        return json(res, 200, await buildStats());
      }
      return json(res, 200, out);
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
  const file = path.join(PUBLIC, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname));
  if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: "forbidden" });
  try {
    const content = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    res.end(content);
  } catch {
    json(res, 404, { error: "not found" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`✓ Grind Tracker running at http://localhost:${PORT}`);
  if (!process.env.STEAM_API_KEY || !process.env.STEAM_ID64) console.log("  Steam: demo mode (set STEAM_API_KEY + STEAM_ID64 in .env)");
  if (!process.env.DISCORD_CLIENT_ID) console.log("  Discord: off (set DISCORD_CLIENT_ID in .env)");
});

startPresence(process.env.DISCORD_CLIENT_ID);
setInterval(pushPresence, 15_000);
pushPresence();

process.on("SIGINT", () => {
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  process.exit(0);
});
