// Discord Rich Presence: shows your study/play stats on your profile while Discord desktop is open.
let client = null;
let connected = false;
let enabled = false;
let retry = null;
let lastActivity = null;
let lastSent = "";

export async function startPresence(clientId) {
  if (!clientId) return;
  enabled = true;
  let Client;
  try {
    ({ Client } = await import("@xhayper/discord-rpc"));
  } catch {
    console.warn("! Rich Presence disabled: run `npm install` first.");
    enabled = false;
    return;
  }

  const scheduleReconnect = () => {
    connected = false;
    if (retry) return;
    retry = setTimeout(() => {
      retry = null;
      connect();
    }, 15_000);
  };

  const connect = () => {
    client?.destroy().catch(() => {});
    client = new Client({ clientId });
    client.on("ready", () => {
      connected = true;
      lastSent = "";
      console.log("✓ Discord Rich Presence connected");
      if (lastActivity) updatePresence(lastActivity);
    });
    client.on("disconnected", scheduleReconnect);
    client.login().catch(scheduleReconnect);
  };
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
  const label = mode === "study" ? "locked in" : mode === "gaming" ? `in ${game.name.toLowerCase()}` : "on break";
  const activity = {
    type: 0,
    details: `${hm(study.todayMs / 60000)} studied  ·  ${hm(played.todayMinutes)} played`,
    state: `${label}  ${bar(goalPct)}  ${Math.round(goalPct * 100)}%`.slice(0, 128),
  };

  const start = mode === "study" ? study.activeSince : mode === "gaming" ? played.sessionStart : null;
  if (start) activity.startTimestamp = start;

  const big = mode === "gaming" ? game.header : largeImage || steam?.profile.avatar;
  if (big) {
    activity.largeImageKey = big;
    activity.largeImageText = `${hm(study.todayMs / 60000)} of ${hm(study.goalMinutes)} daily goal`;
  }
  if (mode === "gaming" && steam.profile.avatar) {
    activity.smallImageKey = steam.profile.avatar;
    activity.smallImageText = steam.profile.level ? `Steam level ${steam.profile.level}` : steam.profile.name;
  }
  if (steam?.profile.url) activity.buttons = [{ label: "My Steam profile", url: steam.profile.url }];
  return activity;
}
