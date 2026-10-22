// XP, levels and badges. Everything is derived from the study history in data.json - nothing extra is stored,
// so old sessions count too and changing a rule re-scores your whole history.

const XP_PER_MINUTE = 2;
const XP_PER_GOAL_DAY = 100; // bonus for every day you hit your goal
export const MAX_LEVEL = 50;

// 10 ranks x 5 divisions (I-V) = levels 1-50
const TIERS = ["Rookie", "Apprentice", "Scholar", "Strategist", "Sage", "Mastermind", "Virtuoso", "Grandmaster", "Mythic", "Legend"];
const DIVISIONS = ["I", "II", "III", "IV", "V"];

// level L needs 25·(L−1)·L XP in total. At 2 XP/min: L2 ≈ 25 min, L5 ≈ 4h, L10 ≈ 19h, L25 ≈ 125h, L50 ≈ 510h
const xpAt = (level) => 25 * (level - 1) * level;
const levelFromXp = (xp) => Math.min(MAX_LEVEL, Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * xp) / 25)) / 2)));
const tierOf = (level) => TIERS[Math.floor((level - 1) / 5)];
const divisionOf = (level) => DIVISIONS[(level - 1) % 5];
const rankFor = (level) => `${tierOf(level)} ${divisionOf(level)}`;

// cat groups badges in the UI; need/have drive the progress bar
const BADGES = [
  { id: "first", cat: "Start", name: "First Blood", icon: "01", desc: "Finish your very first study session.", need: 1, have: (s) => s.sessionCount },
  { id: "streak3", cat: "Streak", name: "On Fire", icon: "3D", desc: "Study at least a little on 3 days in a row.", need: 3, have: (s) => s.bestStreak },
  { id: "streak7", cat: "Streak", name: "Unstoppable", icon: "7D", desc: "Keep a 7-day study streak alive.", need: 7, have: (s) => s.bestStreak },
  { id: "streak30", cat: "Streak", name: "Iron Will", icon: "30", desc: "A full month: study 30 days in a row.", need: 30, have: (s) => s.bestStreak },
  { id: "perfect", cat: "Streak", name: "Perfect Week", icon: "7G", desc: "Hit your daily goal 7 days in a row.", need: 7, have: (s) => s.bestGoalStreak },
  { id: "comeback", cat: "Streak", name: "Comeback", icon: "↺", desc: "Get back to studying after 3+ days off. Everyone falls off sometimes.", need: 1, have: (s) => +s.comeback },
  { id: "marathon", cat: "Focus", name: "Marathon", icon: "2H", desc: "Stay locked in for one session of 2 hours or more.", need: 120, have: (s) => s.longestMin },
  { id: "deep", cat: "Focus", name: "Deep Focus", icon: "3×", desc: "Do three 45-minute (or longer) sessions in a single day.", need: 3, have: (s) => s.deepDayMax },
  { id: "owl", cat: "Habit", name: "Night Owl", icon: "☾", desc: "Study past midnight (a session that starts after 11pm or crosses midnight).", need: 1, have: (s) => +s.night },
  { id: "bird", cat: "Habit", name: "Early Bird", icon: "◐", desc: "Start a session between 4am and 7am.", need: 1, have: (s) => +s.early },
  { id: "weekend", cat: "Habit", name: "Weekend Warrior", icon: "SS", desc: "Study on both Saturday and Sunday of the same weekend.", need: 1, have: (s) => +s.weekend },
  { id: "goal5", cat: "Goal", name: "Goal Crusher", icon: "◎", desc: "Hit your daily study goal on 5 different days.", need: 5, have: (s) => s.goalDays },
  { id: "budget", cat: "Balance", name: "Budget Keeper", icon: "≤", desc: "Hit your study goal and stay under your game budget on the same day.", need: 1, have: (s) => +s.budgetDay },
  { id: "balanced", cat: "Balance", name: "Balanced", icon: "⇌", desc: "Study more than you game on 7 days (needs Steam connected).", need: 7, have: (s) => s.balancedDays },
  { id: "polymath", cat: "Subject", name: "Polymath", icon: "✦", desc: "Study 3 different subjects in one day.", need: 3, have: (s) => s.maxSubjectsDay },
  { id: "specialist", cat: "Subject", name: "Specialist", icon: "S", desc: "Put 10 hours into a single subject.", need: 600, have: (s) => s.maxSubjectMin },
  { id: "ten", cat: "Total", name: "Ten-Hour Club", icon: "10", desc: "Study 10 hours in total.", need: 600, have: (s) => s.totalMin },
  { id: "quester", cat: "Goal", name: "Quest Master", icon: "Q", desc: "Clear all 3 daily quests on 5 different days.", need: 5, have: (s) => s.questDays },
  { id: "hundred", cat: "Total", name: "Centurion", icon: "C", desc: "Study 100 hours in total. Legendary dedication.", need: 6000, have: (s) => s.totalMin },
];

/**
 * @param data      the whole data.json object
 * @param studyMin  (dayKey) => minutes studied that day, including a running session
 * @param dayKey    (Date?) => "YYYY-MM-DD" in local time
 */
export function computeProgress(data, studyMin, dayKey, quests = { xp: 0, fullDays: 0 }, goalFor = () => data.settings.goalMinutes) {
  const { days, settings } = data;
  const today = dayKey();

  const sessions = Object.values(days).flatMap((d) => d.sessions ?? []);
  if (data.activeStudy) sessions.push({ start: data.activeStudy, end: Date.now(), subject: data.activeSubject });

  const keys = Object.keys(days);
  if (!keys.includes(today)) keys.push(today);
  keys.sort();

  const s = {
    sessionCount: sessions.length, totalMin: 0, goalDays: 0, bestStreak: 0, bestGoalStreak: 0, longestMin: 0,
    night: false, early: false, weekend: false, comeback: false, budgetDay: false,
    maxSubjectsDay: 0, maxSubjectMin: 0, deepDayMax: 0, balancedDays: 0, questDays: quests.fullDays,
  };
  const subjectMin = {};

  for (const k of keys) {
    const min = studyMin(k);
    s.totalMin += min;
    const goal = goalFor(k);
    if (min >= goal) s.goalDays++;
    const played = days[k]?.playedMinutes;
    if (min >= goal && played != null && played <= settings.playBudgetMinutes) s.budgetDay = true;
    if (min > 0 && played != null && min > played) s.balancedDays++;
    for (const x of days[k]?.sessions ?? []) if (x.subject) subjectMin[x.subject] = (subjectMin[x.subject] ?? 0) + (x.end - x.start) / 60_000;
    for (const [sub, m] of Object.entries(days[k]?.manualBySubject ?? {})) subjectMin[sub] = (subjectMin[sub] ?? 0) + m;
    const daySessions = [...(days[k]?.sessions ?? []), ...(k === today && data.activeStudy ? [{ start: data.activeStudy, end: Date.now() }] : [])];
    s.deepDayMax = Math.max(s.deepDayMax, daySessions.filter((x) => x.end - x.start >= 45 * 60_000).length);
    const subjects = new Set([
      ...(days[k]?.sessions ?? []).map((x) => x.subject),
      ...Object.keys(days[k]?.manualBySubject ?? {}),
      ...(k === today && data.activeStudy ? [data.activeSubject] : []),
    ]);
    subjects.delete(undefined);
    subjects.delete(null);
    s.maxSubjectsDay = Math.max(s.maxSubjectsDay, subjects.size);
  }

  if (data.activeStudy && data.activeSubject) subjectMin[data.activeSubject] = (subjectMin[data.activeSubject] ?? 0) + (Date.now() - data.activeStudy) / 60_000;
  s.maxSubjectMin = Math.max(0, ...Object.values(subjectMin));

  // walk every calendar day: streaks, goal streaks, comebacks, weekends
  let run = 0;
  let goalRun = 0;
  let gap = 0;
  let studiedBefore = false;
  let saturday = false;
  const cursor = new Date(`${keys[0]}T12:00`);
  for (const end = new Date(`${today}T12:00`); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const min = studyMin(dayKey(cursor));
    run = min > 0 ? run + 1 : 0;
    goalRun = min >= goalFor(dayKey(cursor)) ? goalRun + 1 : 0;
    s.bestStreak = Math.max(s.bestStreak, run);
    s.bestGoalStreak = Math.max(s.bestGoalStreak, goalRun);
    if (min > 0) {
      if (studiedBefore && gap >= 3) s.comeback = true;
      studiedBefore = true;
      gap = 0;
    } else gap++;
    if (cursor.getDay() === 6) saturday = min > 0;
    if (cursor.getDay() === 0 && saturday && min > 0) s.weekend = true;
  }

  for (const x of sessions) {
    s.longestMin = Math.max(s.longestMin, (x.end - x.start) / 60_000);
    const startH = new Date(x.start).getHours();
    const crossesMidnight = dayKey(new Date(x.end)) !== dayKey(new Date(x.start));
    if (startH >= 23 || startH < 4 || crossesMidnight) s.night = true;
    if (startH >= 4 && startH < 7) s.early = true;
  }

  const xp = Math.round(s.totalMin * XP_PER_MINUTE) + XP_PER_GOAL_DAY * s.goalDays + quests.xp;
  const level = levelFromXp(xp);
  const maxed = level >= MAX_LEVEL;
  const nextTierLevel = Math.floor((level - 1) / 5) * 5 + 6; // first level of the next rank
  return {
    xp,
    level,
    rank: rankFor(level),
    tier: tierOf(level),
    division: (level - 1) % 5, // 0-4 → I-V
    maxed,
    maxLevel: MAX_LEVEL,
    levelXp: xpAt(level),
    nextXp: maxed ? null : xpAt(level + 1),
    nextRank: nextTierLevel <= MAX_LEVEL ? { level: nextTierLevel, name: `${tierOf(nextTierLevel)} I` } : null,
    // the rules, so the Guide page explains exactly what the code does
    rules: {
      xpPerMinute: XP_PER_MINUTE,
      xpPerGoalDay: XP_PER_GOAL_DAY,
      xpPerQuest: quests.perQuest ?? 0,
      xpAllQuests: quests.allBonus ?? 0,
      maxLevel: MAX_LEVEL,
      ranks: TIERS.map((name, i) => ({ level: i * 5 + 1, toLevel: i * 5 + 5, name, xp: xpAt(i * 5 + 1) })),
    },
    badges: BADGES.map((b) => {
      const have = Math.min(b.need, Math.floor(b.have(s)));
      return { id: b.id, cat: b.cat, name: b.name, icon: b.icon, desc: b.desc, unlocked: have >= b.need, have, need: b.need };
    }),
  };
}
