// Study data on disk. Built so an update, a crash or a power cut can't wipe anyone's history:
//   - saves are atomic: write data.json.tmp, then rename over data.json (never half-written)
//   - one backup per day in backups/, plus one right before every update; only the newest 3 are kept
//   - if data.json is missing or unreadable at start, the newest good backup is restored instead
//     of starting empty (a broken file is kept aside as data.broken-<time>.json, never deleted)
import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, statSync, rmSync, existsSync } from "node:fs";
import { writeFile, rename } from "node:fs/promises";
import path from "node:path";

const KEEP = 3; // only the newest 3 backups are kept, to save space

export function createStore(file) {
  const dir = path.join(path.dirname(file), "backups");
  const tmp = `${file}.tmp`;
  const today = () => new Date().toLocaleDateString("en-CA");
  const fresh = () => ({ settings: { goalMinutes: 240, playBudgetMinutes: 120 }, days: {}, activeStudy: null, gameSession: null });

  const parse = (text) => {
    const d = JSON.parse(text);
    if (!d || typeof d !== "object" || typeof d.days !== "object" || typeof d.settings !== "object") throw new Error("not Grind Tracker data");
    return d;
  };

  const backups = () => {
    try {
      return readdirSync(dir)
        .filter((f) => /^data-.+\.json$/.test(f))
        .map((f) => ({ name: f, at: statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.at - a.at);
    } catch {
      return [];
    }
  };

  function load() {
    try {
      return parse(readFileSync(file, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT") {
        const aside = file.replace(/\.json$/, `.broken-${Date.now()}.json`);
        try {
          renameSync(file, aside);
        } catch {}
        console.error(`data.json couldn't be read (${e.message}); kept it as ${path.basename(aside)}`);
      }
      for (const b of backups()) {
        try {
          const d = parse(readFileSync(path.join(dir, b.name), "utf8"));
          console.warn(`Restored your study data from backups/${b.name}`);
          return d;
        } catch {}
      }
      return fresh();
    }
  }

  // delete everything but the newest KEEP backups
  function prune() {
    for (const b of backups().slice(KEEP)) rmSync(path.join(dir, b.name), { force: true });
  }

  /** Every readable backup, newest first, with when it was made. */
  function readBackups() {
    const out = [];
    for (const b of backups()) {
      try {
        out.push({ at: b.at, data: parse(readFileSync(path.join(dir, b.name), "utf8")) });
      } catch {}
    }
    return out;
  }

  /** Copy the current data into backups/data-<tag>.json. */
  function backup(data, tag = today()) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `data-${tag}.json`), JSON.stringify(data, null, 2));
    prune();
  }

  const dailyBackup = (data) => {
    if (!existsSync(path.join(dir, `data-${today()}.json`))) backup(data);
  };

  let timer;
  return {
    load,
    backup,
    prune,
    readBackups,
    /** Debounced save for normal changes. */
    save(data) {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          await writeFile(tmp, JSON.stringify(data, null, 2));
          await rename(tmp, file);
          dailyBackup(data);
        } catch (e) {
          console.error("save failed:", e.message);
        }
      }, 200);
    },
    /** Immediate save, for quitting and restarting. */
    saveNow(data) {
      clearTimeout(timer);
      writeFileSync(tmp, JSON.stringify(data, null, 2));
      renameSync(tmp, file);
    },
    info() {
      const all = backups();
      return { count: all.length, latest: all[0] ? { name: all[0].name, at: all[0].at } : null, folder: dir };
    },
  };
}
