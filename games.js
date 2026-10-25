// Detects running games the way Discord does: Discord publishes the list of games it can detect
// (≈10k with Windows .exe names). We cache a compact version, refresh it weekly, and match it
// against the programs that are running. Users can add their own programs or ignore false hits.
//
// Most entries include part of the game's folder ("6.0.0/dotnet.exe" is tModLoader's bundled .NET,
// not every .NET program), so a match needs the running program's real path to end with it.
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const DB_URL = "https://discord.com/api/v9/applications/detectable";
const DB_VERSION = 2; // bump when the cached format changes
const REFRESH_EVERY = 7 * 24 * 3600e3;

// .exe names that host many different apps (javaw = Minecraft *and* every other Java program),
// plus browsers, launchers and our own process: never treat these as "a game is running"
const GENERIC = new Set([
  "javaw.exe", "java.exe", "python.exe", "pythonw.exe", "node.exe", "electron.exe", "cmd.exe", "powershell.exe", "pwsh.exe",
  "explorer.exe", "chrome.exe", "msedge.exe", "firefox.exe", "opera.exe", "brave.exe", "discord.exe", "steam.exe", "steamwebhelper.exe",
  "epicgameslauncher.exe", "grindtracker.exe", "code.exe", "conhost.exe", "svchost.exe", "dllhost.exe", "rundll32.exe",
  "unitycrashhandler64.exe", "unitycrashhandler32.exe", "crashpad_handler.exe", "launcher.exe", "game.exe", "start.exe",
  "setup.exe", "update.exe", "updater.exe", "uninstall.exe", "client.exe", "app.exe", "main.exe", "run.exe", "bootstrapper.exe",
]);
// runtimes some games bundle: fine when the folder matches, never on the name alone
const RUNTIMES = new Set(["dotnet.exe", "busybox.exe", "busybox64.exe", "mono.exe", "nw.exe", "love.exe", "dosbox.exe", "hl2.exe", "python3.exe"]);

const base = (p) => p.replace(/^>/, "").split(/[\\/]/).pop().toLowerCase();
const iconUrl = (id, hash) => (hash ? `https://cdn.discordapp.com/app-icons/${id}/${hash}.png?size=256` : null);

/** Running processes: [{ exe (lowercase basename), pid }]. */
function listProcesses() {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      execFile("ps", ["-A", "-o", "pid=,comm="], (err, out) =>
        resolve(err ? [] : out.split("\n").map((l) => l.trim().match(/^(\d+)\s+(.+)$/)).filter(Boolean).map((m) => ({ pid: Number(m[1]), exe: base(m[2]) })))
      );
      return;
    }
    execFile("tasklist", ["/FO", "CSV", "/NH"], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve([]);
      resolve(out.split(/\r?\n/).map((l) => l.match(/^"([^"]+)","(\d+)"/)).filter(Boolean).map((m) => ({ exe: m[1].toLowerCase(), pid: Number(m[2]) })));
    });
  });
}
const runningPrograms = async () => [...new Set((await listProcesses()).map((p) => p.exe))];

/** Full paths for these process ids (lowercase, "/" separators; "" when Windows won't say, e.g. anti-cheat games). */
function processPaths(pids) {
  return new Promise((resolve) => {
    if (!pids.length || process.platform !== "win32") return resolve(new Map());
    const ps = `Get-Process -Id ${pids.join(",")} -ErrorAction SilentlyContinue | ForEach-Object { [string]$_.Id + [char]9 + $_.Path }`;
    execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, timeout: 8000 }, (err, out) => {
      const map = new Map(pids.map((p) => [p, ""]));
      for (const line of (out ?? "").split(/\r?\n/)) {
        const [pid, path] = line.split("\t");
        if (pid && map.has(Number(pid))) map.set(Number(pid), (path ?? "").trim().toLowerCase().replace(/\\/g, "/"));
      }
      resolve(map);
    });
  });
}

/** Programs with a visible window, with its title ("Visual Studio Code", "Anki"…). Windows only. */
function windowedPrograms() {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve([]);
    const ps = "Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object { $_.ProcessName + [char]9 + $_.MainWindowTitle }";
    execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024 }, (err, out) => {
      if (err) return resolve([]);
      resolve(
        out
          .split(/\r?\n/)
          .map((l) => l.split("\t"))
          .filter(([name, title]) => name && title)
          .map(([name, title]) => ({ exe: `${name.trim().toLowerCase()}.exe`, title: title.trim().slice(0, 120) }))
      );
    });
  });
}

/**
 * @param cacheFile   where the compact game list is kept
 * @param getSettings () => { detect, custom: [{exe, name}], ignore: [exe] }
 */
export function createGameDetector({ cacheFile, getSettings }) {
  let db = null; // exe basename -> [{ path: "folder/game.exe" | null, name, id, icon }]
  let updatedAt = 0;
  let gameCount = 0;
  const pathCache = new Map(); // pid -> full path ("" = unknown); a process's path never changes
  let loading = null;
  let lastRunning = []; // every program seen by the last scan (auto-start studying reads this too)

  async function refresh() {
    try {
      const res = await fetch(DB_URL, { headers: { "user-agent": "GrindTracker" }, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`Discord answered ${res.status}`);
      const list = await res.json();
      const map = {};
      for (const g of list) {
        for (const e of g.executables ?? []) {
          if (e.os !== "win32" || e.is_launcher) continue;
          const full = e.name.replace(/^>/, "").toLowerCase().replace(/\\/g, "/");
          const exe = full.split("/").pop();
          if (!exe.endsWith(".exe") || GENERIC.has(exe)) continue;
          (map[exe] ??= []).push({ path: full.includes("/") ? full : null, name: g.name, id: g.id, icon: iconUrl(g.id, g.icon_hash) });
        }
      }
      setDb(map, Date.now());
      await writeFile(cacheFile, JSON.stringify({ v: DB_VERSION, updatedAt, games: map }));
      console.log(`Game list updated: ${gameCount} detectable games`);
    } catch (e) {
      console.error("game list update failed:", e.message); // keep using the cached list
    }
  }

  function setDb(map, at) {
    db = map;
    updatedAt = at;
    gameCount = new Set(Object.values(map).flatMap((list) => list.map((e) => e.id))).size;
  }

  async function ensureDb() {
    if (!db) {
      try {
        const cached = JSON.parse(await readFile(cacheFile, "utf8"));
        if (cached.v === DB_VERSION) setDb(cached.games, cached.updatedAt); // older caches get rebuilt
      } catch {}
    }
    if (!db || Date.now() - updatedAt > REFRESH_EVERY) loading ??= refresh().finally(() => (loading = null));
    if (!db) await loading;
  }

  /** The game that's running now ({ name, exe, icon, source }) or null. Your own programs win over the list. */
  // Which game (if any) this running program is. With its path known, Discord's folder part must
  // match (".../tmodloader/dotnet/6.0.0/dotnet.exe"). Without one (protected processes hide it), only
  // names that belong to exactly one game and aren't a bundled runtime count.
  function identify(exe, path) {
    const entries = db?.[exe];
    if (!entries) return null;
    if (path) {
      return entries.find((e) => e.path && (path === e.path || path.endsWith(`/${e.path}`))) ?? entries.find((e) => !e.path && !RUNTIMES.has(exe)) ?? null;
    }
    if (RUNTIMES.has(exe) || new Set(entries.map((e) => e.id)).size !== 1) return null;
    return entries[0];
  }

  /** The game that's running now ({ name, exe, icon, source }) or null. Your own programs win over the list. */
  async function scan() {
    const s = getSettings();
    const procs = await listProcesses();
    lastRunning = [...new Set(procs.map((p) => p.exe))];
    if (s.detect === false) return null;
    await ensureDb();
    const ignore = new Set((s.ignore ?? []).map((x) => x.toLowerCase()));
    const custom = new Map((s.custom ?? []).map((c) => [c.exe.toLowerCase(), c.name]));
    for (const exe of lastRunning) if (custom.has(exe) && !ignore.has(exe)) return { name: custom.get(exe), exe, icon: null, source: "custom" };

    const cands = procs.filter((p) => db?.[p.exe] && !ignore.has(p.exe));
    const live = new Set(procs.map((p) => p.pid));
    for (const pid of pathCache.keys()) if (!live.has(pid)) pathCache.delete(pid);
    const unknown = cands.filter((p) => !pathCache.has(p.pid)).map((p) => p.pid);
    for (const [pid, path] of await processPaths(unknown)) pathCache.set(pid, path);
    for (const p of cands) {
      const hit = identify(p.exe, pathCache.get(p.pid));
      if (hit) return { name: hit.name, icon: hit.icon, exe: p.exe, source: "detected" };
    }
    return null;
  }

  /**
   * For "Add a program" pickers: { apps: [{ exe, title }], other: [exe] }. Apps with an open window
   * (what you'd actually pick) come first with their window title; background programs follow.
   */
  async function candidates() {
    const skip = /^(system|registry|smss|csrss|wininit|services|lsass|svchost|fontdrvhost|winlogon|dwm|sihost|taskhostw|ctfmon|searchhost|startmenuexperiencehost|runtimebroker|textinputhost|shellexperiencehost|securityhealth|nvcontainer|nvdisplay|audiodg|spoolsv|wmiprvse|msmpeng|nissrv|tasklist|conhost|dllhost|memory compression|system idle process|applicationframehost|explorer)/;
    const [running, windows] = await Promise.all([runningPrograms(), windowedPrograms()]);
    const ok = (e) => e.endsWith(".exe") && !skip.test(e) && !GENERIC.has(e);
    const apps = [...new Map(windows.filter((w) => ok(w.exe)).map((w) => [w.exe, w])).values()].sort((a, b) => a.exe.localeCompare(b.exe));
    const shown = new Set(apps.map((a) => a.exe));
    return { apps, other: running.filter((e) => ok(e) && !shown.has(e)).sort() };
  }

  return { scan, candidates, running: () => lastRunning, info: () => ({ games: gameCount, updatedAt }) };
}
