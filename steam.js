// Steam Web API wrapper. Returns mock data when no key / SteamID is configured.
const API = "https://api.steampowered.com";
const STATUS = ["Offline", "Online", "Busy", "Away", "Snooze", "Looking to trade", "Looking to play"];
const header = (appid) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`;

const schemaCache = new Map();
let cache = { at: 0, value: null };

async function call(iface, method, version, params) {
  const url = new URL(`${API}/${iface}/${method}/${version}/`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (res.status === 401 || res.status === 403) throw new Error("Steam rejected the API key - double-check it");
  if (!res.ok) throw new Error(`Steam ${method} failed (${res.status})`);
  return res.json();
}

export const clearSteamCache = () => (cache = { at: 0, value: null });

// Accepts a SteamID64, a /profiles/ link, a /id/ custom link, or a bare custom name.
export async function resolveSteamId(input, key) {
  input = String(input).trim();
  const direct = input.match(/\b(7656\d{13})\b/);
  if (direct) return direct[1];
  const vanity = input.match(/steamcommunity\.com\/id\/([^/?#\s]+)/i)?.[1] ?? (/^[\w-]{2,32}$/.test(input) ? input : null);
  if (!vanity) throw new Error("That doesn't look like a SteamID64 or a Steam profile link");
  const r = await call("ISteamUser", "ResolveVanityURL", "v1", { key, vanityurl: vanity });
  if (r.response.success !== 1) throw new Error(`Couldn't find a Steam profile called "${vanity}"`);
  return r.response.steamid;
}

// Returns the profile name, or throws if the key/ID combo doesn't work.
export async function verifySteam(key, steamid) {
  const r = await call("ISteamUser", "GetPlayerSummaries", "v2", { key, steamids: steamid });
  const p = r.response.players[0];
  if (!p) throw new Error("The API key works, but no Steam profile matches that ID");
  return p.personaname;
}

async function getAchievements(key, steamid, appid) {
  // Games without achievements answer 400, which the caller turns into null.
  const r = await call("ISteamUserStats", "GetPlayerAchievements", "v1", { key, steamid, appid, l: "english" });
  const list = r.playerstats?.achievements;
  if (!list?.length) return null;

  if (!schemaCache.has(appid)) {
    const s = await call("ISteamUserStats", "GetSchemaForGame", "v2", { key, appid, l: "english" }).catch(() => null);
    const defs = s?.game?.availableGameStats?.achievements ?? [];
    schemaCache.set(appid, Object.fromEntries(defs.map((a) => [a.name, a])));
  }
  const schema = schemaCache.get(appid);
  const unlocked = list.filter((a) => a.achieved);
  const latest = [...unlocked].sort((a, b) => b.unlocktime - a.unlocktime)[0];

  return {
    appid,
    game: r.playerstats.gameName,
    unlocked: unlocked.length,
    total: list.length,
    latest: latest && {
      name: schema[latest.apiname]?.displayName ?? latest.name ?? latest.apiname,
      icon: schema[latest.apiname]?.icon ?? null,
      time: latest.unlocktime * 1000,
    },
  };
}

export async function getSteam({ key, steamid }) {
  if (!key || !steamid) return demoSteam();
  if (cache.value && Date.now() - cache.at < 45_000) return cache.value;

  const q = { key, steamid };
  const [summary, owned, recent, level] = await Promise.all([
    call("ISteamUser", "GetPlayerSummaries", "v2", { key, steamids: steamid }),
    call("IPlayerService", "GetOwnedGames", "v1", { ...q, include_appinfo: 1, include_played_free_games: 1 }),
    call("IPlayerService", "GetRecentlyPlayedGames", "v1", { ...q, count: 6 }).catch(() => ({ response: {} })),
    call("IPlayerService", "GetSteamLevel", "v1", q).catch(() => ({ response: {} })),
  ]);

  const p = summary.response.players[0];
  if (!p) throw new Error("Steam profile not found - check STEAM_ID64");

  const games = owned.response.games ?? [];
  const currentGame = p.gameid
    ? { appid: Number(p.gameid), name: p.gameextrainfo ?? "a game", header: header(p.gameid) }
    : null;
  const recentGames = (recent.response.games ?? []).map((g) => ({
    appid: g.appid,
    name: g.name,
    minutes2w: g.playtime_2weeks ?? 0,
    minutesTotal: g.playtime_forever,
    header: header(g.appid),
  }));

  const achApp = currentGame?.appid ?? recentGames[0]?.appid;
  const achievements = achApp ? await getAchievements(key, steamid, achApp).catch(() => null) : null;

  const value = {
    demo: false,
    profile: {
      name: p.personaname,
      avatar: p.avatarfull,
      status: STATUS[p.personastate] ?? "Offline",
      url: p.profileurl,
      level: level.response.player_level ?? null,
      currentGame,
    },
    recent: recentGames,
    ownedCount: games.length,
    totalHours: Math.round(games.reduce((sum, g) => sum + g.playtime_forever, 0) / 60),
    achievements,
    // appid -> lifetime minutes; used for the "played today" snapshot diff
    playtimes: Object.fromEntries(games.map((g) => [g.appid, g.playtime_forever])),
  };
  cache = { at: Date.now(), value };
  return value;
}

const DEMO_UNLOCK = Date.now() - 5 * 3600e3;

function demoSteam() {
  const g = (appid, name, minutes2w, minutesTotal) => ({ appid, name, minutes2w, minutesTotal, header: header(appid) });
  return {
    demo: true,
    profile: { name: "You (demo)", avatar: null, status: "Online", url: null, level: 42, currentGame: null },
    recent: [
      g(1245620, "ELDEN RING", 612, 8040),
      g(367520, "Hollow Knight", 240, 3100),
      g(730, "Counter-Strike 2", 180, 25200),
      g(413150, "Stardew Valley", 95, 4800),
      g(1086940, "Baldur's Gate 3", 60, 9600),
    ],
    ownedCount: 187,
    totalHours: 1240,
    achievements: {
      appid: 1245620,
      game: "ELDEN RING",
      unlocked: 31,
      total: 42,
      latest: { name: "Elden Lord", icon: null, time: DEMO_UNLOCK },
    },
    playtimes: null,
    demoPlayedToday: 85,
  };
}
