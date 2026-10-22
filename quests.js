// Daily quests: 3 missions a day, picked from a pool by the date (so they're stable all day and
// the same after a restart). Completing one is permanent for that day and gives bonus XP.
export const QUEST_XP = 30;
export const ALL_QUESTS_BONUS = 50;

// have(t) reads today's facts (see todayFacts in server.js); need may depend on settings
const POOL = [
  { id: "study60", group: "time", text: "Study for 60 minutes", need: () => 60, have: (t) => t.studyMin, unit: "min" },
  { id: "study90", group: "time", text: "Study for 90 minutes", need: () => 90, have: (t) => t.studyMin, unit: "min" },
  { id: "study120", group: "time", text: "Study for 2 hours", need: () => 120, have: (t) => t.studyMin, unit: "min" },
  { id: "goal", group: "time", text: "Hit your daily goal", need: (s) => s.goalMinutes, have: (t) => t.studyMin, unit: "min" },
  { id: "deep2", group: "sessions", text: "Finish 2 sessions of 45 minutes or more", need: () => 2, have: (t) => t.sessions45 },
  { id: "short3", group: "sessions", text: "Finish 3 sessions of 25 minutes or more", need: () => 3, have: (t) => t.sessions25 },
  { id: "long60", group: "sessions", text: "Stay locked in for one 60-minute session", need: () => 1, have: (t) => +(t.longest >= 60) },
  { id: "focus2", group: "focus", text: "Complete 2 focus rounds", need: () => 2, have: (t) => t.focusRounds },
  { id: "focus4", group: "focus", text: "Complete a full focus cycle (4 rounds)", need: () => 4, have: (t) => t.focusRounds },
  { id: "subjects2", group: "variety", text: "Study 2 different subjects", need: () => 2, have: (t) => t.subjects },
  { id: "early", group: "habit", text: "Start a session before 10am", need: () => 1, have: (t) => +t.early },
  { id: "balance", group: "balance", text: "Study 30 minutes while staying under your game budget", need: () => 1, have: (t, s) => +(t.studyMin >= 30 && t.played <= s.playBudgetMinutes) },
];

// small deterministic RNG seeded by the date string
function rng(seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296);
}

/** Today's 3 quest ids: one from each of 3 different groups, so a day is never all "study X min". */
function pick(day) {
  const r = rng(`grind-${day}`);
  const shuffled = [...POOL].sort(() => r() - 0.5);
  const out = [];
  const groups = new Set();
  for (const q of shuffled) {
    if (groups.has(q.group)) continue;
    groups.add(q.group);
    out.push(q.id);
    if (out.length === 3) break;
  }
  return out;
}

/**
 * Today's quests with progress. Marks newly finished ones as done (sticky) and returns them in `fresh`.
 * @param data  data.json object (completions live in data.quests[day])
 * @param facts today's facts (studyMin, sessions45, …)
 */
export function questsToday(data, day, facts) {
  data.quests ??= {};
  const rec = (data.quests[day] ??= { ids: pick(day), done: {} });
  const fresh = [];
  const list = rec.ids.map((id) => {
    const q = POOL.find((x) => x.id === id);
    const need = q.need(data.settings);
    const have = Math.min(need, Math.floor(q.have(facts, data.settings)));
    if (have >= need && !rec.done[id]) {
      rec.done[id] = Date.now();
      fresh.push(q.text);
    }
    return { id, text: q.text, need, have: rec.done[id] ? need : have, unit: q.unit ?? null, done: Boolean(rec.done[id]), xp: QUEST_XP };
  });
  const allDone = list.every((q) => q.done);
  return { list, allDone, bonus: ALL_QUESTS_BONUS, streak: questStreak(data, day), fresh };
}

const fullDay = (rec) => rec && rec.ids.every((id) => rec.done[id]);

/** Consecutive days (ending today, or yesterday if today isn't finished yet) with all 3 quests done. */
function questStreak(data, today) {
  let streak = 0;
  const d = new Date(`${today}T12:00`);
  if (!fullDay(data.quests[today])) d.setDate(d.getDate() - 1);
  while (fullDay(data.quests[d.toLocaleDateString("en-CA")])) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

/** XP earned from quests over all time, and how many days had every quest done. */
export function questTotals(data) {
  let xp = 0;
  let fullDays = 0;
  for (const rec of Object.values(data.quests ?? {})) {
    const n = rec.ids.filter((id) => rec.done[id]).length;
    xp += n * QUEST_XP;
    if (n === rec.ids.length) {
      xp += ALL_QUESTS_BONUS;
      fullDays++;
    }
  }
  return { xp, fullDays };
}
