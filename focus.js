// Pomodoro-style focus timer. Lives on the server so it keeps running with the window closed;
// each finished focus phase is a normal study session (tagged focus: true), so it counts for
// study time, XP, subjects and quests like any other session.
export const FOCUS_DEFAULTS = { focus: 25, short: 5, long: 15, every: 4, autoNext: true };

/**
 * @param data       the data.json object (state is kept in data.focus so it survives restarts)
 * @param startStudy () => void            start the study timer if it isn't running
 * @param stopStudy  (extra) => void       end the running study session, merging `extra` into it
 * @param save       () => void
 * @param notify     (title, body) => void
 */
export function createFocus({ data, startStudy, stopStudy, save, notify }) {
  data.focus ??= { phase: "idle", endsAt: null, round: 0 };
  data.settings.focus = { ...FOCUS_DEFAULTS, ...data.settings.focus };
  const f = data.focus;
  const cfg = () => data.settings.focus;
  const lengthOf = (phase) => (phase === "focus" ? cfg().focus : phase === "long" ? cfg().long : cfg().short);

  function begin(phase) {
    f.phase = phase;
    f.endsAt = Date.now() + lengthOf(phase) * 60_000;
    if (phase === "focus") startStudy();
    save();
  }

  // a phase ran out (auto) or the user hit Skip
  function advance(auto) {
    if (f.phase === "focus") {
      stopStudy({ focus: true });
      f.round++;
      const long = f.round % cfg().every === 0;
      begin(long ? "long" : "short");
      notify(long ? `Round ${f.round} done: long break` : `Round ${f.round} done`, `Take ${lengthOf(f.phase)} minutes. Stretch, drink some water.`);
    } else if (f.phase === "short" || f.phase === "long") {
      if (f.phase === "long") f.round = 0; // a full cycle is done; the next one starts at round 1
      if (cfg().autoNext || !auto) {
        begin("focus");
        notify("Break's over", `Focus round ${f.round + 1} has started (${cfg().focus} min).`);
      } else {
        f.phase = "ready";
        f.endsAt = null;
        save();
        notify("Break's over", "Hit Start focus when you're ready.");
      }
    }
  }

  setInterval(() => f.endsAt && Date.now() >= f.endsAt && advance(true), 1000).unref();

  return {
    isFocusing: () => f.phase === "focus",
    inBreak: () => f.phase === "short" || f.phase === "long" || f.phase === "ready",
    start() {
      if (f.phase === "idle") f.round = 0;
      begin("focus");
    },
    skip: () => advance(false),
    stop() {
      if (f.phase === "focus") stopStudy({}); // a cut-short round still counts as study time, not as a focus round
      Object.assign(f, { phase: "idle", endsAt: null, round: 0 });
      save();
    },
    state: () => ({ phase: f.phase, endsAt: f.endsAt, round: f.round, every: cfg().every, settings: cfg() }),
  };
}
