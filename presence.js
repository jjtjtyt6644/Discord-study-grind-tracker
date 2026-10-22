// Discord Rich Presence: shows your study/play stats on your profile while Discord desktop is open.
let Client = null;
let client = null;
let clientId = null;
let connected = false;
let enabled = false;
let retry = null;
let lastActivity = null;
let lastSent = "";

function scheduleReconnect() {
  connected = false;
  if (retry) return;
  retry = setTimeout(() => {
    retry = null;
    connect();
  }, 15_000);
}

function connect() {
  client?.destroy().catch(() => {});
  const c = new Client({ clientId });
  client = c;
  // a replaced client may still fire events; only the current one counts
  c.on("ready", () => {
    if (c !== client) return;
    connected = true;
    lastSent = "";
    console.log("✓ Discord Rich Presence connected");
    if (lastActivity) updatePresence(lastActivity);
  });
  c.on("disconnected", () => c === client && scheduleReconnect());
  c.login().catch(() => c === client && scheduleReconnect());
}

// Safe to call again with a new ID (e.g. after setup in the dashboard).
export async function startPresence(id) {
  if (!id || id === clientId) return;
  if (!Client) {
    try {
      ({ Client } = await import("@xhayper/discord-rpc"));
    } catch {
      console.warn("! Rich Presence disabled: run `npm install` first.");
      return;
    }
  }
  clientId = id;
  enabled = true;
  connected = false;
  lastSent = "";
  clearTimeout(retry);
  retry = null;
  connect();
}

export function updatePresence(activity) {
  lastActivity = activity;
  const json = JSON.stringify(activity);
  // Discord rate-limits presence updates, so only send real changes.
  if (!connected || json === lastSent) return;
  lastSent = json;
  // null = the user hid their activity in Settings → Privacy
  const req = activity ? client.user?.setActivity(activity) : client.user?.clearActivity();
  req?.catch((e) => {
    console.error("! Discord rejected the activity:", e?.message ?? e);
    lastSent = "";
  });
}

export const presenceState = () => ({ enabled, connected });

const hm = (min) => {
  min = Math.max(0, Math.floor(min));
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
};

// ▰▰▰▱▱▱▱▱▱▱ - Discord renders its own font, so the "design" has to come from plain characters
const bar = (pct, cells = 10) => {
  const filled = Math.round(Math.min(1, Math.max(0, pct)) * cells);
  return "▰".repeat(filled) + "▱".repeat(cells - filled);
};

// What the card may show (Settings → Privacy). Everything is on unless the user turns it off.
export const PRIVACY_DEFAULTS = { show: true, studyTime: true, playTime: true, level: true, subject: true, game: true, goal: true, timer: true, image: true, button: true };

export function buildActivity(stats, largeImage, privacy = {}) {
  const p = { ...PRIVACY_DEFAULTS, ...privacy };
  if (!p.show) return null;
  const { mode, study, played, steam, focus } = stats;
  const game = stats.game; // Steam or detected on the PC
  const goalPct = study.todayMs / 60000 / study.goalMinutes;
  const subject = p.subject && study.subject ? ` · ${study.subject.toLowerCase()}` : "";

  let label;
  if (focus?.phase === "focus") label = `focus ${focus.round + 1}/${focus.every}${subject}`;
  else if (focus?.phase === "short" || focus?.phase === "long") label = focus.phase === "long" ? "long break" : "short break";
  else if (mode === "study") label = `locked in${subject}`;
  else if (mode === "gaming") label = p.game ? `in ${game.name.toLowerCase()}` : "gaming";
  else label = "on break";

  const activity = { type: 0, state: (p.goal ? `${label}  ${bar(goalPct)}  ${Math.round(goalPct * 100)}%` : label).slice(0, 128) };
  const details = [
    p.studyTime && `${hm(study.todayMs / 60000)} studied`,
    p.playTime && `${hm(played.todayMinutes)} played`,
    p.level && stats.progress && `lv ${stats.progress.level}`,
  ].filter(Boolean);
  if (details.length) activity.details = details.join("  ·  ");

  if (p.timer) {
    // focus/break phases count down; everything else counts up
    if (focus?.endsAt && focus.phase !== "idle" && focus.phase !== "ready") activity.endTimestamp = focus.endsAt;
    else {
      const start = mode === "study" ? study.activeSince : mode === "gaming" ? played.sessionStart : null;
      if (start) activity.startTimestamp = start;
    }
  }

  if (p.image) {
    const big = mode === "gaming" && p.game && game.icon ? game.icon : largeImage || steam?.profile.avatar;
    if (big) {
      activity.largeImageKey = big;
      const hover = [
        p.level && stats.progress && `lv ${stats.progress.level} ${stats.progress.rank.toLowerCase()}`,
        p.goal && `${p.studyTime ? `${hm(study.todayMs / 60000)} of ` : ""}${hm(study.goalMinutes)} goal`,
      ].filter(Boolean);
      activity.largeImageText = hover.join(" · ") || "grind tracker";
    }
    if (mode === "gaming" && p.game && game.source === "steam" && steam?.profile.avatar) {
      activity.smallImageKey = steam.profile.avatar;
      activity.smallImageText = steam.profile.level ? `Steam level ${steam.profile.level}` : steam.profile.name;
    }
  }
  if (p.button && steam?.profile.url) activity.buttons = [{ label: "My Steam profile", url: steam.profile.url }];
  return activity;
}
