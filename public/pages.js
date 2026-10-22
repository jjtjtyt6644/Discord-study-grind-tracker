// Guide + About pages: match the dashboard's current mode color, and fill the Guide's
// rank table and badge list from the live app so they never drift from the real rules.
(async () => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const hm = (min) => `${Math.floor(min / 60)}h ${String(Math.floor(min % 60)).padStart(2, "0")}m`;

  document.querySelector(".about-art img")?.addEventListener("error", () => document.body.classList.add("no-art"));

  // highlight the section you're reading in the Guide's sidebar
  const tocLinks = [...document.querySelectorAll(".toc a")];
  if (tocLinks.length) {
    const spy = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) tocLinks.forEach((a) => a.classList.toggle("active", a.hash === `#${e.target.id}`));
        }
      },
      { rootMargin: "-30% 0px -60% 0px" }
    );
    document.querySelectorAll(".doc section[id]").forEach((s) => spy.observe(s));
  }

  let stats;
  try {
    stats = await (await fetch("/api/stats")).json();
  } catch {
    return; // static content still reads fine without the server
  }
  document.body.dataset.mode = stats.mode;
  BG.setMode(stats.mode);
  window.GT_applyTheme(stats.prefs?.theme);

  const p = stats.progress;
  if (!p || !$("rankTable")) return;

  $("ruleMin").textContent = `${p.rules.xpPerMinute} XP`;
  $("ruleGoal").textContent = `${p.rules.xpPerGoalDay} XP`;
  $("ruleQuest").textContent = `+${p.rules.xpPerQuest} XP`;
  $("rankTable").tBodies[0].replaceChildren(
    ...p.rules.ranks.map((r) => {
      const tr = el("tr", r.name === p.tier ? "current" : "");
      const name = el("td");
      name.append(el("b", null, r.name));
      if (r.name === p.tier) name.append(el("em", null, `you: ${p.rank}`));
      const hours = r.xp / p.rules.xpPerMinute / 60; // study time alone, before goal and quest bonuses
      tr.append(name, el("td", null, `${r.level}-${r.toLevel}`), el("td", null, r.xp.toLocaleString()), el("td", null, r.xp ? (hours < 1 ? `~${Math.round(hours * 60)} min` : `~${Math.round(hours)}h`) : "-"));
      return tr;
    })
  );

  const unlocked = p.badges.filter((b) => b.unlocked).length;
  $("badgeTotal").textContent = p.badges.length;
  $("badgeMine").textContent = `You've unlocked ${unlocked} so far.`;
  const groups = new Map();
  for (const b of p.badges) groups.set(b.cat, [...(groups.get(b.cat) ?? []), b]);
  const timeish = (b) => b.id === "marathon" || b.need >= 600;
  $("badgeTable").replaceChildren(
    ...[...groups].map(([cat, list]) => {
      const g = el("div", "bgroup");
      g.append(el("h3", null, cat));
      for (const b of list) {
        const row = el("div", "brow" + (b.unlocked ? " on" : ""));
        const prog = b.unlocked ? "✓ unlocked" : b.need > 1 ? `${timeish(b) ? hm(b.have) : b.have} / ${timeish(b) ? hm(b.need) : b.need}` : "locked";
        const txt = el("div");
        txt.append(el("b", null, b.name), el("p", null, b.desc));
        row.append(el("div", "hex", b.icon), txt, el("span", "bprog", prog));
        g.append(row);
      }
      return g;
    })
  );
})();
