// Everything that differs between `npm start` (dev) and the packaged GrindTracker.exe.
import * as sea from "node:sea";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { mkdirSync, appendFileSync, readFileSync, existsSync } from "node:fs";

export const isDesktop = sea.isSea();

// dev: the project folder. exe: the folder the exe sits in (read-only use only)
export const ROOT = isDesktop ? path.dirname(process.execPath) : path.dirname(fileURLToPath(import.meta.url));

// where data.json, .env and the log live. The exe can't write next to itself reliably
// (Program Files, Downloads...), so it uses %APPDATA%\GrindTracker.
export const APP_DIR = isDesktop ? path.join(process.env.APPDATA ?? path.join(process.env.USERPROFILE ?? ".", "AppData", "Roaming"), "GrindTracker") : ROOT;
mkdirSync(APP_DIR, { recursive: true });

// custom art: drop bg.jpg / logo-small.png etc. into %APPDATA%\GrindTracker\img to override the built-ins
export const ART_DIR = path.join(APP_DIR, "img");

export const VERSION = process.env.GT_VERSION ?? (() => {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  } catch {
    return "dev";
  }
})();

// The exe has no console window, so mirror console output into a log file.
if (isDesktop) {
  const LOG = path.join(APP_DIR, "grind-tracker.log");
  const write = (level, args) => {
    const line = args.map((a) => (a instanceof Error ? a.stack : typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    try {
      appendFileSync(LOG, `[${new Date().toISOString()}] ${level} ${line}\n`);
    } catch {}
  };
  for (const level of ["log", "warn", "error"]) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      write(level.toUpperCase(), args);
      try {
        orig(...args); // the GUI exe has no console; never let that crash the app
      } catch {}
    };
  }
  process.on("uncaughtException", (e) => console.error("uncaught:", e));
}

/** Bundled file from the exe (public/…), or null when running from source. */
export function readAsset(rel) {
  if (!isDesktop) return null;
  try {
    return Buffer.from(sea.getAsset(rel));
  } catch {
    return null;
  }
}

export const hasCustomArt = (file) => existsSync(path.join(ART_DIR, file));

export function openBrowser(url) {
  if (process.platform === "win32") execFile("rundll32", ["url.dll,FileProtocolHandler", url], { windowsHide: true });
  else if (process.platform === "darwin") execFile("open", [url]);
  else execFile("xdg-open", [url]);
}

// ---------- start with Windows (HKCU Run key: per-user, no admin needed) ----------
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_NAME = "GrindTracker";
const reg = (args) => new Promise((resolve) => execFile("reg", args, { windowsHide: true }, (err, stdout) => resolve({ ok: !err, stdout })));

export const autostartSupported = isDesktop && process.platform === "win32";

export async function getAutostart() {
  if (!autostartSupported) return false;
  const { ok, stdout } = await reg(["query", RUN_KEY, "/v", RUN_NAME]);
  // only "on" if it points at this exe (a moved exe leaves a stale entry)
  return ok && stdout.toLowerCase().includes(process.execPath.toLowerCase());
}

export async function setAutostart(enabled) {
  if (!autostartSupported) throw new Error("Start with Windows is only available in the GrindTracker.exe app");
  const res = enabled
    ? await reg(["add", RUN_KEY, "/v", RUN_NAME, "/t", "REG_SZ", "/d", `"${process.execPath}" --background`, "/f"])
    : await reg(["delete", RUN_KEY, "/v", RUN_NAME, "/f"]);
  if (!res.ok && enabled) throw new Error("Windows didn't let Grind Tracker add itself to startup");
  return getAutostart();
}
