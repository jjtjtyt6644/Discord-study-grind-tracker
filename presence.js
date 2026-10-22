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
  client.user?.setActivity(activity).catch((e) => {
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

export function buildActivity(stats, largeImage) {
  const { mode, study, played, steam } = stats;
  const game = steam?.profile.currentGame;
  const goalPct = study.todayMs / 60000 / study.goalMinutes;
  const studying = study.subject ? `locked in · ${study.subject.toLowerCase()}` : "locked in";
  const label = mode === "study" ? studying : mode === "gaming" ? `in ${game.name.toLowerCase()}` : "on break";
  const level = stats.progress ? `  ·  lv ${stats.progress.level}` : "";
  const activity = {
    type: 0,
    details: `${hm(study.todayMs / 60000)} studied  ·  ${hm(played.todayMinutes)} played${level}`,
    state: `${label}  ${bar(goalPct)}  ${Math.round(goalPct * 100)}%`.slice(0, 128),
  };

  const start = mode === "study" ? study.activeSince : mode === "gaming" ? played.sessionStart : null;
  if (start) activity.startTimestamp = start;

  const big = mode === "gaming" ? game.header : largeImage || steam?.profile.avatar;
  if (big) {
    activity.largeImageKey = big;
    const rank = stats.progress ? `lv ${stats.progress.level} ${stats.progress.rank.toLowerCase()} · ` : "";
    activity.largeImageText = `${rank}${hm(study.todayMs / 60000)} of ${hm(study.goalMinutes)} goal`;
  }
  if (mode === "gaming" && steam.profile.avatar) {
    activity.smallImageKey = steam.profile.avatar;
    activity.smallImageText = steam.profile.level ? `Steam level ${steam.profile.level}` : steam.profile.name;
  }
  if (steam?.profile.url) activity.buttons = [{ label: "My Steam profile", url: steam.profile.url }];
  return activity;
}
