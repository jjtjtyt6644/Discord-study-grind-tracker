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
  if (!res.ok) {
    // stats endpoints explain themselves (e.g. "Profile is not public"); keep that instead of guessing
    const reason = await res.json().then((j) => j?.playerstats?.error).catch(() => null);
    const err = new Error(reason || (res.status === 401 || res.status === 403 ? "Steam rejected the API key - double-check it" : `Steam ${method} failed (${res.status})`));
    err.steamReason = reason;
    throw err;
  }
  return res.json();
}

export const clearSteamCache = () => (cache = { at: 0, value: null });

// for the achievements card's game picker
const pickCache = new Map();
export async function getAchievementsFor({ key, steamid }, appid, gameName) {
  if (!key || !steamid) return demoSteam().achievements;
  const hit = pickCache.get(appid);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const value = await getAchievements(key, steamid, appid, gameName);
  pickCache.set(appid, { at: Date.now(), value });
  return value;
}

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

// Never throws: problems come back as { error: "private" | "none" | "failed" } so the card can explain them.
async function getAchievements(key, steamid, appid, gameName) {
  let r;
  try {
    r = await call("ISteamUserStats", "GetPlayerAchievements", "v1", { key, steamid, appid, l: "english" });
  } catch (e) {
    const reason = e.steamReason ?? "";
    const error = /not public/i.test(reason) ? "private" : /no stats|no achievements/i.test(reason) ? "none" : "failed";
    return { appid, game: gameName, error, message: reason || e.message };
  }
  const list = r.playerstats?.achievements;
  if (!list?.length) return { appid, game: r.playerstats?.gameName ?? gameName, error: "none" };

  if (!schemaCache.has(appid)) {
    const s = await call("ISteamUserStats", "GetSchemaForGame", "v2", { key, appid, l: "english" }).catch(() => null);
    const defs = s?.game?.availableGameStats?.achievements ?? [];
    schemaCache.set(appid, Object.fromEntries(defs.map((a) => [a.name, a])));
  }
  const schema = schemaCache.get(appid);
  const pct = await globalPercents(appid);
  const info = (a) => {
    const d = schema[a.apiname] ?? {};
    return {
      name: d.displayName ?? a.name ?? a.apiname,
      desc: d.description || a.description || (d.hidden ? "Hidden achievement" : ""),
      icon: (a.achieved ? d.icon : d.icongray) ?? null,
      pct: pct[a.apiname] ?? null,
      time: a.unlocktime ? a.unlocktime * 1000 : null,
    };
  };
  const unlocked = list.filter((a) => a.achieved);
  const locked = list.filter((a) => !a.achieved);
  const recent = [...unlocked].sort((a, b) => b.unlocktime - a.unlocktime).slice(0, 3).map(info);
  const withPct = (arr) => arr.filter((a) => pct[a.apiname] != null);
  const rarest = withPct(unlocked).sort((a, b) => pct[a.apiname] - pct[b.apiname])[0];

  return {
    appid,
    game: r.playerstats.gameName,
    unlocked: unlocked.length,
    total: list.length,
    latest: recent[0] ?? null,
    recent,
    rarest: rarest ? info(rarest) : null,
    // the locked ones the most players have - your easiest next unlocks
    next: withPct(locked).sort((a, b) => pct[b.apiname] - pct[a.apiname]).slice(0, 3).map(info),
  };
}

// apiname -> % of all players who have it; public data, cached for 6h
const pctCache = new Map();
async function globalPercents(appid) {
  const hit = pctCache.get(appid);
  if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.map;
  const r = await call("ISteamUserStats", "GetGlobalAchievementPercentagesForApp", "v2", { gameid: appid }).catch(() => null);
  const map = Object.fromEntries((r?.achievementpercentages?.achievements ?? []).map((a) => [a.name, Number(a.percent)]));
  pctCache.set(appid, { at: Date.now(), map });
  return map;
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

  // current game first, then recent ones, skipping games that have no achievements at all
  const candidates = [...new Map([currentGame, ...recentGames].filter(Boolean).map((g) => [g.appid, g])).values()];
  let achievements = null;
  for (const g of candidates.slice(0, 4)) {
    achievements = await getAchievements(key, steamid, g.appid, g.name);
    if (achievements.error !== "none") break;
  }

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
      latest: { name: "Elden Lord", desc: "Achieved the \"Elden Lord\" ending", icon: null, pct: 18.4, time: DEMO_UNLOCK },
      recent: [
        { name: "Elden Lord", desc: "Achieved the \"Elden Lord\" ending", icon: null, pct: 18.4, time: DEMO_UNLOCK },
        { name: "Hoarah Loux", desc: "Defeated Hoarah Loux, Warrior", icon: null, pct: 24.1, time: DEMO_UNLOCK - 86400e3 },
        { name: "Malenia", desc: "Defeated Malenia, Blade of Miquella", icon: null, pct: 31.7, time: DEMO_UNLOCK - 3 * 86400e3 },
      ],
      rarest: { name: "Elden Lord", desc: "Achieved the \"Elden Lord\" ending", icon: null, pct: 18.4, time: DEMO_UNLOCK },
      next: [
        { name: "Legendary Armaments", desc: "Acquired all legendary armaments", icon: null, pct: 22.9, time: null },
        { name: "Age of the Stars", desc: "Achieved the \"Age of the Stars\" ending", icon: null, pct: 14.2, time: null },
        { name: "Lord of Frenzied Flame", desc: "Achieved the \"Lord of Frenzied Flame\" ending", icon: null, pct: 12.6, time: null },
      ],
    },
    playtimes: null,
    demoPlayedToday: 85,
  };
}
