// Detects running games the way Discord does: Discord publishes the list of games it can detect
// (≈10k with Windows .exe names). We cache a compact version, refresh it weekly, and match it
// against the programs that are running. Users can add their own programs or ignore false hits.
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const DB_URL = "https://discord.com/api/v9/applications/detectable";
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

const base = (p) => p.replace(/^>/, "").split(/[\\/]/).pop().toLowerCase();
const iconUrl = (id, hash) => (hash ? `https://cdn.discordapp.com/app-icons/${id}/${hash}.png?size=256` : null);

/** Running program names (lowercase .exe basenames). */
function runningPrograms() {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      execFile("ps", ["-A", "-o", "comm="], (err, out) => resolve(err ? [] : out.split("\n").map((l) => base(l.trim())).filter(Boolean)));
      return;
    }
    execFile("tasklist", ["/FO", "CSV", "/NH"], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve([]);
      resolve([...new Set(out.split(/\r?\n/).map((l) => l.match(/^"([^"]+)"/)?.[1]?.toLowerCase()).filter(Boolean))]);
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
  let db = null; // exe basename -> { name, id, icon }
  let updatedAt = 0;
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
          const exe = base(e.name);
          if (!exe.endsWith(".exe") || GENERIC.has(exe) || map[exe]) continue;
          map[exe] = { name: g.name, id: g.id, icon: iconUrl(g.id, g.icon_hash) };
        }
      }
      db = map;
      updatedAt = Date.now();
      await writeFile(cacheFile, JSON.stringify({ updatedAt, games: map }));
      console.log(`Game list updated: ${Object.keys(map).length} detectable games`);
    } catch (e) {
      console.error("game list update failed:", e.message); // keep using the cached list
    }
  }

  async function ensureDb() {
    if (!db) {
      try {
        const cached = JSON.parse(await readFile(cacheFile, "utf8"));
        db = cached.games;
        updatedAt = cached.updatedAt;
      } catch {}
    }
    if (!db || Date.now() - updatedAt > REFRESH_EVERY) loading ??= refresh().finally(() => (loading = null));
    if (!db) await loading;
  }

  /** The game that's running now ({ name, exe, icon, source }) or null. Your own programs win over the list. */
  async function scan() {
    const s = getSettings();
    const running = await runningPrograms();
    lastRunning = running;
    if (s.detect === false) return null;
    await ensureDb();
    const ignore = new Set((s.ignore ?? []).map((x) => x.toLowerCase()));
    const custom = new Map((s.custom ?? []).map((c) => [c.exe.toLowerCase(), c.name]));
    for (const exe of running) if (custom.has(exe) && !ignore.has(exe)) return { name: custom.get(exe), exe, icon: null, source: "custom" };
    for (const exe of running) if (db?.[exe] && !ignore.has(exe)) return { ...db[exe], exe, source: "detected" };
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

  return { scan, candidates, running: () => lastRunning, info: () => ({ games: db ? Object.keys(db).length : 0, updatedAt }) };
}
