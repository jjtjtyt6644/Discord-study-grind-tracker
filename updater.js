// Auto-update from GitHub Releases.
//
// Windows won't let a running exe be overwritten, but it *can* be renamed. So an update:
//   1. streams the new GrindTracker.exe to …exe.new (with progress), checking size + GitHub's sha256
//   2. backs up the study data, renames the running exe to …exe.old and moves the new one into its place
//   3. keeps running the old code until restart; the next launch (or "Restart now") is the new version
// Study data lives in %APPDATA%\GrindTracker, apart from the exe, so it's never touched.
// The leftover …exe.old is deleted on the next start.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { isDesktop, VERSION } from "./desktop.js";

const REPO = "jjtjtyt6644/Discord-study-grind-tracker";
const ASSET = "GrindTracker.exe";
const CHECK_EVERY = 30 * 60_000; // GitHub allows 60 unauthenticated checks/hour; this uses 2
const FIRST_CHECK = 5_000;

// what the dashboard shows; status: idle | checking | current | available | downloading | ready | error
export const update = {
  status: "idle",
  latest: null,
  url: `https://github.com/${REPO}/releases/latest`,
  error: null,
  checkedAt: null,
  progress: 0, // 0..1 while downloading
  canInstall: isDesktop,
};

const hooks = { beforeInstall: () => {}, onReady: () => {} };

const parse = (v) => String(v).replace(/^v/, "").split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
export function isNewer(a, b) {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

const exe = () => process.execPath;
const ghHeaders = { accept: "application/vnd.github+json", "user-agent": `GrindTracker/${VERSION}` };

async function latestRelease() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: ghHeaders, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(res.status === 403 ? "GitHub is rate-limiting update checks; trying again later" : `GitHub answered ${res.status}`);
  return res.json();
}

export async function checkForUpdate({ autoInstall }) {
  if (["checking", "downloading", "ready"].includes(update.status)) return update;
  update.status = "checking";
  update.error = null;
  try {
    const rel = await latestRelease();
    update.checkedAt = Date.now();
    update.latest = rel.tag_name.replace(/^v/, "");
    update.url = rel.html_url;
    if (!isNewer(update.latest, VERSION)) {
      update.status = "current";
      return update;
    }
    update.status = "available";
    const asset = rel.assets?.find((a) => a.name === ASSET);
    if (isDesktop && asset && autoInstall) await install(asset);
  } catch (e) {
    update.checkedAt = Date.now();
    update.status = update.latest && isNewer(update.latest, VERSION) ? "available" : "error";
    update.error = e.message;
    console.error("update check failed:", e.message);
  }
  return update;
}

/** Download + swap in the latest release now (used by "Install now" when auto-install is off). */
export async function installLatest() {
  if (!isDesktop) throw new Error("Updates install automatically only in the GrindTracker.exe app");
  if (update.status === "downloading" || update.status === "ready") return;
  const rel = await latestRelease();
  const asset = rel.assets?.find((a) => a.name === ASSET);
  if (!asset) throw new Error("The latest release has no GrindTracker.exe");
  update.latest = rel.tag_name.replace(/^v/, "");
  if (!isNewer(update.latest, VERSION)) throw new Error("You already have the latest version");
  await install(asset);
}

async function install(asset) {
  update.status = "downloading";
  update.progress = 0;
  const target = exe();
  const staged = `${target}.new`;
  console.log(`Downloading update v${update.latest}…`);
  try {
    const res = await fetch(asset.browser_download_url, { headers: { "user-agent": ghHeaders["user-agent"] }, signal: AbortSignal.timeout(15 * 60_000) });
    if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);

    // stream to disk while hashing: no 90 MB buffer in memory, and live progress for the banner
    const hash = createHash("sha256");
    const out = createWriteStream(staged);
    let got = 0;
    let head = null;
    for await (const chunk of res.body) {
      head ??= Buffer.from(chunk.subarray(0, 2));
      hash.update(chunk);
      got += chunk.length;
      update.progress = Math.min(1, got / asset.size);
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));

    // never swap in something we can't vouch for
    if (got !== asset.size) throw new Error("download was incomplete");
    if (head?.toString("latin1") !== "MZ") throw new Error("download isn't a Windows program");
    const sha = asset.digest?.startsWith("sha256:") ? asset.digest.slice(7) : null;
    if (sha && hash.digest("hex") !== sha) throw new Error("download failed its checksum");

    hooks.beforeInstall(update.latest); // back up study data first, just in case
    await rm(`${target}.old`, { force: true });
    await rename(target, `${target}.old`); // allowed even while running
    try {
      await rename(staged, target);
    } catch (e) {
      await rename(`${target}.old`, target).catch(() => {}); // put the working one back
      throw e;
    }
    update.status = "ready";
    update.progress = 1;
    console.log(`Update v${update.latest} installed; it starts on restart`);
    hooks.onReady();
  } catch (e) {
    await rm(staged, { force: true }).catch(() => {});
    update.status = "error";
    update.progress = 0;
    // e.g. the exe sits in a folder Windows won't let us write to (Program Files)
    update.error = e.code === "EPERM" || e.code === "EACCES" ? "Couldn't replace GrindTracker.exe in its folder. Download the new version manually." : e.message;
    console.error("update install failed:", e.message);
  }
}

/** Start the freshly installed exe and hand over. `stopServing` must free the port first. */
export function restartIntoUpdate(stopServing) {
  if (update.status !== "ready") throw new Error("No update is waiting");
  stopServing(() => {
    spawn(exe(), ["--background"], { detached: true, stdio: "ignore" }).unref();
    process.exit(0);
  });
}

/**
 * @param getAutoInstall () => boolean
 * @param opts.beforeInstall (version) => void  e.g. back up data
 * @param opts.onReady () => void               e.g. restart now if nobody is looking
 */
export function startUpdateChecks(getAutoInstall, opts = {}) {
  Object.assign(hooks, opts);
  if (isDesktop) setTimeout(() => rm(`${exe()}.old`, { force: true }).catch(() => {}), 5_000); // leftover from the last update
  const run = () => checkForUpdate({ autoInstall: getAutoInstall() });
  setTimeout(run, FIRST_CHECK).unref();
  setInterval(run, CHECK_EVERY).unref();
}

/** Re-check if the last check is older than `maxAge` (the dashboard calls this when it opens). */
export function checkIfStale(getAutoInstall, maxAge = 10 * 60_000) {
  if (!update.checkedAt || Date.now() - update.checkedAt > maxAge) checkForUpdate({ autoInstall: getAutoInstall() });
}
