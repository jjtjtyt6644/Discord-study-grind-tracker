// XP, levels and badges. Everything is derived from the study history in data.json - nothing extra is stored,
// so old sessions count too and changing a rule re-scores your whole history.

const XP_PER_GOAL_DAY = 60; // bonus on top of 1 XP per minute studied

const RANKS = [
  [0, "Rookie"],
  [3, "Apprentice"],
  [6, "Scholar"],
  [10, "Strategist"],
  [15, "Sage"],
  [20, "Mastermind"],
  [30, "Legend"],
];

// level L needs 50·L·(L+1) XP in total: L1 = 100 (~1.7h), L5 = 1500, L10 = 5500
const xpAt = (level) => 50 * level * (level + 1);
const levelFromXp = (xp) => Math.floor((-1 + Math.sqrt(1 + (4 * xp) / 50)) / 2);
const rankFor = (level) => RANKS.filter(([min]) => level >= min).at(-1)[1];

const BADGES = [
  { id: "first", name: "First Blood", icon: "01", desc: "Finish your first study session", need: 1, have: (s) => s.sessionCount },
  { id: "streak3", name: "On Fire", icon: "3D", desc: "Study 3 days in a row", need: 3, have: (s) => s.bestStreak },
  { id: "streak7", name: "Unstoppable", icon: "7D", desc: "Study 7 days in a row", need: 7, have: (s) => s.bestStreak },
  { id: "marathon", name: "Marathon", icon: "2H", desc: "One session of 2+ hours", need: 120, have: (s) => s.longestMin },
  { id: "owl", name: "Night Owl", icon: "☾", desc: "Study past midnight", need: 1, have: (s) => +s.night },
  { id: "bird", name: "Early Bird", icon: "◐", desc: "Start a session before 7am", need: 1, have: (s) => +s.early },
  { id: "goal5", name: "Goal Crusher", icon: "◎", desc: "Hit your daily goal on 5 days", need: 5, have: (s) => s.goalDays },
  { id: "budget", name: "Budget Keeper", icon: "≤", desc: "Hit your goal and stay under your game budget the same day", need: 1, have: (s) => +s.budgetDay },
  { id: "polymath", name: "Polymath", icon: "✦", desc: "Study 3 different subjects in one day", need: 3, have: (s) => s.maxSubjectsDay },
  { id: "ten", name: "Ten-Hour Club", icon: "10", desc: "Study 10 hours in total", need: 600, have: (s) => s.totalMin },
  { id: "hundred", name: "Centurion", icon: "C", desc: "Study 100 hours in total", need: 6000, have: (s) => s.totalMin },
];

/**
 * @param data      the whole data.json object
 * @param studyMin  (dayKey) => minutes studied that day, including a running session
 * @param dayKey    (Date?) => "YYYY-MM-DD" in local time
 */
export function computeProgress(data, studyMin, dayKey) {
  const { days, settings } = data;
  const goal = settings.goalMinutes;
  const today = dayKey();

  const sessions = Object.values(days).flatMap((d) => d.sessions ?? []);
  if (data.activeStudy) sessions.push({ start: data.activeStudy, end: Date.now(), subject: data.activeSubject });

  const keys = Object.keys(days);
  if (!keys.includes(today)) keys.push(today);
  keys.sort();

  const s = { sessionCount: sessions.length, totalMin: 0, goalDays: 0, bestStreak: 0, longestMin: 0, night: false, early: false, budgetDay: false, maxSubjectsDay: 0 };

  for (const k of keys) {
    const min = studyMin(k);
    s.totalMin += min;
    if (min >= goal) s.goalDays++;
    const played = days[k]?.playedMinutes;
    if (min >= goal && played != null && played <= settings.playBudgetMinutes) s.budgetDay = true;
    const subjects = new Set([
      ...(days[k]?.sessions ?? []).map((x) => x.subject),
      ...Object.keys(days[k]?.manualBySubject ?? {}),
      ...(k === today && data.activeStudy ? [data.activeSubject] : []),
    ]);
    subjects.delete(undefined);
    subjects.delete(null);
    s.maxSubjectsDay = Math.max(s.maxSubjectsDay, subjects.size);
  }

  // longest run of consecutive calendar days with any study
  let run = 0;
  const cursor = new Date(`${keys[0]}T12:00`);
  for (const end = new Date(`${today}T12:00`); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    run = studyMin(dayKey(cursor)) > 0 ? run + 1 : 0;
    s.bestStreak = Math.max(s.bestStreak, run);
  }

  for (const x of sessions) {
    s.longestMin = Math.max(s.longestMin, (x.end - x.start) / 60_000);
    const startH = new Date(x.start).getHours();
    const crossesMidnight = dayKey(new Date(x.end)) !== dayKey(new Date(x.start));
    if (startH >= 23 || startH < 4 || crossesMidnight) s.night = true;
    if (startH >= 4 && startH < 7) s.early = true;
  }

  const xp = Math.round(s.totalMin) + XP_PER_GOAL_DAY * s.goalDays;
  const level = levelFromXp(xp);
  const next = RANKS.find(([min]) => min > level);
  return {
    xp,
    level,
    rank: rankFor(level),
    levelXp: xpAt(level),
    nextXp: xpAt(level + 1),
    nextRank: next ? { level: next[0], name: next[1] } : null,
    badges: BADGES.map((b) => {
      const have = Math.min(b.need, Math.floor(b.have(s)));
      return { id: b.id, name: b.name, icon: b.icon, desc: b.desc, unlocked: have >= b.need, have, need: b.need };
    }),
  };
}
