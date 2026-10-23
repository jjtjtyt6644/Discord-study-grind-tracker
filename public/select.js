// Themed dropdowns. Windows draws native <select> lists in plain gray, so every select gets a styled
// button + list instead. The real <select> stays (hidden) as the source of truth: its value, options and
// "change" events work exactly as before, so the rest of the app doesn't need to know about this.
// Long lists get a search box; options can carry a second line via data-sub, and <optgroup>s become headings.
(() => {
  const valueProp = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  const indexProp = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "selectedIndex");
  const SEARCH_FROM = 9; // options before a search box appears

  const menu = document.createElement("div");
  menu.className = "dd-menu";
  menu.hidden = true;
  menu.dataset.raw = ""; // option text is shown as-is (no studied → worked swaps)
  const search = Object.assign(document.createElement("input"), { type: "search", className: "dd-search", placeholder: "Search…" });
  search.setAttribute("aria-label", "Search the list");
  const list = document.createElement("div");
  list.className = "dd-list";
  list.setAttribute("role", "listbox");
  menu.append(search, list);

  let open = null; // the <select> whose list is showing

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  function enhance(sel) {
    if (sel.dataset.dd) return;
    sel.dataset.dd = "1";
    const btn = el("button", `dd ${sel.className}`);
    btn.type = "button";
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    if (sel.getAttribute("aria-label")) btn.setAttribute("aria-label", sel.getAttribute("aria-label"));
    if (sel.hasAttribute("data-raw")) btn.dataset.raw = "";
    const label = el("span", "dd-label");
    btn.append(label);
    sel.after(btn);
    sel.classList.add("dd-native");
    sel.tabIndex = -1;

    const sync = () => {
      label.textContent = sel.options[indexProp.get.call(sel)]?.textContent ?? "";
      btn.hidden = sel.hidden;
      btn.disabled = sel.disabled;
      if (open === sel) renderList();
    };
    // code that sets .value / .selectedIndex directly fires no event, so keep the label in step here
    Object.defineProperty(sel, "value", { configurable: true, get: () => valueProp.get.call(sel), set: (v) => (valueProp.set.call(sel, v), sync()) });
    Object.defineProperty(sel, "selectedIndex", { configurable: true, get: () => indexProp.get.call(sel), set: (v) => (indexProp.set.call(sel, v), sync()) });
    new MutationObserver(sync).observe(sel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden", "disabled"] });
    sel.addEventListener("change", sync);
    sel._dd = { btn, sync };

    btn.addEventListener("click", () => (open === sel ? close() : show(sel)));
    btn.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        show(sel);
      }
    });
    sync();
  }

  const matches = (o, q) => !q || `${o.textContent} ${o.value} ${o.dataset.sub ?? ""}`.toLowerCase().includes(q);

  function renderList() {
    const sel = open;
    const q = search.value.trim().toLowerCase();
    const wasHidden = search.hidden;
    search.hidden = sel.options.length < SEARCH_FROM && !q; // lists that load late get it too
    if (wasHidden && !search.hidden && document.activeElement === list) search.focus({ preventScroll: true });
    const items = [];
    const add = (o) => {
      const row = el("div", "dd-opt");
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(o.selected));
      if (o.disabled) row.setAttribute("aria-disabled", "true");
      row.append(el("span", null, o.textContent));
      if (o.dataset.sub) row.append(el("small", null, o.dataset.sub));
      row._opt = o;
      items.push(row);
    };
    for (const node of sel.children) {
      if (node.tagName === "OPTGROUP") {
        const opts = [...node.children].filter((o) => matches(o, q));
        if (opts.length) {
          items.push(el("div", "dd-group", node.label));
          opts.forEach(add);
        }
      } else if (matches(node, q)) add(node);
    }
    if (!items.some((x) => x._opt)) items.push(el("div", "dd-empty", q ? "No matches" : "Nothing here yet"));
    list.replaceChildren(...items);
    setActive(list.querySelector('.dd-opt[aria-selected="true"]') ?? list.querySelector(".dd-opt"), false);
  }

  function setActive(row, scroll = true) {
    list.querySelector(".dd-opt.active")?.classList.remove("active");
    if (!row) return;
    row.classList.add("active");
    if (scroll) row.scrollIntoView({ block: "nearest" });
  }

  function place() {
    const r = open._dd.btn.getBoundingClientRect();
    const below = innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 220 && above > below;
    menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - Math.max(r.width, 220) - 8))}px`;
    menu.style.minWidth = `${Math.max(r.width, 180)}px`;
    menu.style.maxWidth = `${Math.max(r.width, Math.min(420, innerWidth - 16))}px`;
    menu.style.maxHeight = `${Math.min(340, up ? above : below)}px`;
    menu.style.top = up ? "" : `${r.bottom + 6}px`;
    menu.style.bottom = up ? `${innerHeight - r.top + 6}px` : "";
    menu.classList.toggle("up", up);
  }

  function show(sel) {
    if (open) close(false);
    open = sel;
    sel.dispatchEvent(new Event("focus")); // lets lists that load lazily (running programs) fill in
    search.value = "";
    // inside a modal <dialog> the list must live in the dialog too, or it would sit behind it
    (sel.closest("dialog[open]") ?? document.body).append(menu);
    renderList();
    menu.hidden = false;
    sel._dd.btn.setAttribute("aria-expanded", "true");
    sel._dd.btn.classList.add("open");
    // follow the button every frame while open (panes slide in, dialogs scroll, lists load late)
    const follow = () => {
      if (open !== sel) return;
      place();
      requestAnimationFrame(follow);
    };
    follow();
    list.tabIndex = -1;
    (search.hidden ? list : search).focus({ preventScroll: true });
  }

  function close(refocus = true) {
    if (!open) return;
    const { btn } = open._dd;
    btn.setAttribute("aria-expanded", "false");
    btn.classList.remove("open");
    menu.hidden = true;
    open = null;
    if (refocus) btn.focus({ preventScroll: true });
  }

  function choose(row) {
    const sel = open;
    const o = row?._opt;
    if (!o || o.disabled) return;
    close();
    if (valueProp.get.call(sel) === o.value) return;
    valueProp.set.call(sel, o.value);
    sel._dd.sync();
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }

  list.addEventListener("click", (e) => choose(e.target.closest(".dd-opt")));
  list.addEventListener("mousemove", (e) => {
    const row = e.target.closest(".dd-opt");
    if (row && !row.classList.contains("active")) setActive(row, false);
  });
  search.addEventListener("input", renderList);
  menu.addEventListener("keydown", (e) => {
    const rows = [...list.querySelectorAll(".dd-opt:not([aria-disabled])")];
    const i = rows.indexOf(list.querySelector(".dd-opt.active"));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive(rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(rows[i]);
    } else if (e.key === "Escape") {
      e.preventDefault(); // close the list, not the dialog around it
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") close();
  });
  document.addEventListener("pointerdown", (e) => open && !menu.contains(e.target) && !open._dd.btn.contains(e.target) && close(false), true);
  addEventListener("resize", () => open && close(false));

  document.querySelectorAll("select").forEach(enhance);
  window.GT_enhanceSelect = enhance;
})();
