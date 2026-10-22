// Auto-update from GitHub Releases.
//
// Windows won't let a running exe be overwritten, but it *can* be renamed. So an update:
//   1. downloads the new GrindTracker.exe next to the current one (…exe.new), checks size + sha256
//   2. renames the running exe to …exe.old and moves the new one into its place
//   3. keeps running the old code until restart; the next launch (or "Restart now") is the new version
// The leftover …exe.old is deleted on the next start.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { writeFile, rename, rm } from "node:fs/promises";
import { isDesktop, VERSION } from "./desktop.js";

const REPO = "jjtjtyt6644/Discord-study-grind-tracker";
const ASSET = "GrindTracker.exe";
const CHECK_EVERY = 6 * 3600e3;

// what the dashboard shows; status: idle | checking | current | available | downloading | ready | error
export const update = { status: "idle", latest: null, url: `https://github.com/${REPO}/releases/latest`, error: null, checkedAt: null, canInstall: isDesktop };

const parse = (v) => String(v).replace(/^v/, "").split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
export function isNewer(a, b) {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

const exe = () => process.execPath;

export async function checkForUpdate({ autoInstall }) {
  if (update.status === "downloading" || update.status === "ready") return update;
  update.status = "checking";
  update.error = null;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: "application/vnd.github+json", "user-agent": `GrindTracker/${VERSION}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const rel = await res.json();
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
    update.status = update.latest && isNewer(update.latest, VERSION) ? "available" : "error";
    update.error = e.message;
    console.error("update check failed:", e.message);
  }
  return update;
}

/** Download + swap in the latest release now (used by "Install now" when auto-install is off). */
export async function installLatest() {
  if (!isDesktop) throw new Error("Updates install automatically only in the GrindTracker.exe app");
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { "user-agent": `GrindTracker/${VERSION}` } });
  const rel = await res.json();
  const asset = rel.assets?.find((a) => a.name === ASSET);
  if (!asset) throw new Error("The latest release has no GrindTracker.exe");
  update.latest = rel.tag_name.replace(/^v/, "");
  await install(asset);
}

async function install(asset) {
  update.status = "downloading";
  console.log(`Downloading update v${update.latest}…`);
  try {
    const res = await fetch(asset.browser_download_url, { headers: { "user-agent": `GrindTracker/${VERSION}` }, signal: AbortSignal.timeout(10 * 60_000) });
    if (!res.ok) throw new Error(`download failed (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());

    // never swap in something we can't vouch for
    if (buf.length !== asset.size) throw new Error("download was incomplete");
    if (buf.toString("latin1", 0, 2) !== "MZ") throw new Error("download isn't a Windows program");
    const sha = asset.digest?.startsWith("sha256:") ? asset.digest.slice(7) : null;
    if (sha && createHash("sha256").update(buf).digest("hex") !== sha) throw new Error("download failed its checksum");

    const target = exe();
    await writeFile(`${target}.new`, buf);
    await rm(`${target}.old`, { force: true });
    await rename(target, `${target}.old`); // allowed even while running
    try {
      await rename(`${target}.new`, target);
    } catch (e) {
      await rename(`${target}.old`, target).catch(() => {}); // put the working one back
      throw e;
    }
    update.status = "ready";
    console.log(`Update v${update.latest} installed; it starts next time (or on "Restart now")`);
  } catch (e) {
    await rm(`${exe()}.new`, { force: true }).catch(() => {});
    update.status = "error";
    // e.g. the exe sits in a folder Windows won't let us write to (Program Files)
    update.error = e.code === "EPERM" || e.code === "EACCES" ? "Couldn't replace GrindTracker.exe here. Download the new version manually." : e.message;
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

export function startUpdateChecks(getAutoInstall) {
  if (isDesktop) setTimeout(() => rm(`${exe()}.old`, { force: true }).catch(() => {}), 5_000); // leftover from the last update
  const run = () => checkForUpdate({ autoInstall: getAutoInstall() });
  setTimeout(run, 10_000).unref(); // let startup finish first
  setInterval(run, CHECK_EVERY).unref();
}
