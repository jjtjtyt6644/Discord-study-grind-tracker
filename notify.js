// Notifications + reminders.
//   - In the desktop app on Windows: real Windows toast notifications (with the app logo), shown even
//     when the window is closed.
//   - Everywhere: an in-app "inbox" the dashboard shows as toasts (used when there are no Windows toasts).
import { execFile } from "node:child_process";

export const NOTIFY_DEFAULTS = { on: true, goal: true, budget: true, focus: true, quests: true, breakAfter: 90, nudge: false, nudgeAt: "19:00", recap: false, recapAt: "21:30", auto: true, weekly: true };

// Windows PowerShell can raise toasts through the WinRT API. Text and paths go in via env vars
// and createTextNode, so nothing user-typed is ever spliced into the script.
const TOAST = [
  "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
  "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null",
  "$x = New-Object Windows.Data.Xml.Dom.XmlDocument",
  "$x.LoadXml(\"<toast><visual><binding template='ToastGeneric'><text/><text/></binding></visual><audio src='ms-winsoundevent:Notification.Default'/></toast>\")",
  "$t = $x.GetElementsByTagName('text'); $t.Item(0).AppendChild($x.CreateTextNode($env:GT_TITLE)) > $null; $t.Item(1).AppendChild($x.CreateTextNode($env:GT_BODY)) > $null",
  "if ($env:GT_ICON) { $img = $x.CreateElement('image'); $img.SetAttribute('placement', 'appLogoOverride'); $img.SetAttribute('hint-crop', 'circle'); $img.SetAttribute('src', $env:GT_ICON); $x.GetElementsByTagName('binding').Item(0).AppendChild($img) > $null }",
  "$n = [Windows.UI.Notifications.ToastNotification]::new($x)",
  "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show($n)",
].join("; ");

export function createNotifier({ windowsToasts, iconPath, getSettings }) {
  const inbox = [];
  let nextId = 1;

  function toast(title, body) {
    execFile(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", TOAST],
      { windowsHide: true, env: { ...process.env, GT_TITLE: title, GT_BODY: body, GT_ICON: iconPath?.() ?? "" } },
      (err) => err && console.error("notification failed:", err.message)
    );
  }

  /** kind is a NOTIFY_DEFAULTS key ("goal", "focus", …) so each type can be switched off. */
  function notify(kind, title, body) {
    const s = { ...NOTIFY_DEFAULTS, ...getSettings() };
    if (!s.on || (kind in s && s[kind] === false)) return;
    inbox.push({ id: nextId++, title, body, at: Date.now() });
    if (inbox.length > 20) inbox.shift();
    console.log(`notify: ${title} - ${body}`);
    if (windowsToasts) toast(title, body);
  }

  return { notify, inbox: () => inbox, test: () => notify("test", "Notifications are on", "This is how Grind Tracker will nudge you.") };
}

/**
 * Checks every 20s for: goal reached, game budget exceeded, a long session with no break,
 * and the optional "haven't studied today" nudge. Each fires once (per day / per session).
 * @param facts () => { day, studyMin, goal, played, budget, activeSince, focusing }
 */
export const BUDGET_HEADS_UP = 15; // minutes

export function startReminders({ data, save, notify, facts, getSettings, recap, weekly }) {
  const hm = (m) => `${Math.floor(m / 60)}h ${String(Math.floor(m % 60)).padStart(2, "0")}m`;
  setInterval(() => {
    const s = { ...NOTIFY_DEFAULTS, ...getSettings() };
    if (!s.on) return;
    const f = facts();
    const flags = ((data.days[f.day] ??= { sessions: [], manualMinutes: 0, snapshot: null }).notified ??= {});
    const once = (key, kind, title, body) => {
      if (flags[key]) return;
      flags[key] = Date.now();
      save();
      notify(kind, title, body);
    };

    if (f.studyMin >= f.goal) once("goal", "goal", "Daily goal reached", `${hm(f.studyMin)} studied today. That's the grind.`);
    // a heads-up before the budget runs out, then the "used up" one
    if (f.budget > BUDGET_HEADS_UP && f.played >= f.budget - BUDGET_HEADS_UP && f.played <= f.budget) {
      once("budget-soon", "budget", `${BUDGET_HEADS_UP} minutes of game time left`, `${hm(f.played)} played of your ${hm(f.budget)} budget today. Good time to wrap up the match.`);
    }
    if (f.played > f.budget) once("budget", "budget", "Game budget used up", `${hm(f.played)} played today, ${hm(f.played - f.budget)} over your ${hm(f.budget)} budget.`);

    // Monday morning: how last week went
    const now = new Date();
    if (s.weekly && weekly && now.getDay() === 1 && now.getHours() >= 9) once("weekly", "weekly", "Your week in review", weekly());

    // long session without a break (focus mode has its own breaks)
    if (s.breakAfter > 0 && f.activeSince && !f.focusing) {
      const mins = (Date.now() - f.activeSince) / 60_000;
      const step = Math.floor(mins / s.breakAfter);
      if (step >= 1) once(`break-${f.activeSince}-${step}`, "breakAfter", "Time for a short break", `You've been studying for ${hm(mins)}. Five minutes away from the screen helps.`);
    }

    // end-of-day summary at the chosen time
    if (s.recap && recap) {
      const [h, m] = s.recapAt.split(":").map(Number);
      if (now.getHours() * 60 + now.getMinutes() >= h * 60 + m) once("recap", "recap", "Today's recap", recap());
    }

    if (s.nudge && f.studyMin < 1) {
      const [h, m] = s.nudgeAt.split(":").map(Number);
      if (now.getHours() * 60 + now.getMinutes() >= h * 60 + m) once("nudge", "nudge", "No study yet today", "Even 25 minutes keeps your streak alive. Hit Start when you're ready.");
    }
  }, 20_000).unref();
}
