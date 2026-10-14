// Availability grid (When2meet style). One column per poll day (the organizer's day), one
// row per slot of elapsed time within that day, so a window that crosses the viewer's
// midnight or a DST change still lines up. Slot times are UTC ISO strings throughout.
window.AvailabilityGrid = function (container, poll, onChange, options) {
  options = options || {};
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const pollDay = new Intl.DateTimeFormat("en-CA", { timeZone: poll.timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  const dateFmt = new Intl.DateTimeFormat([], { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
  const fullFmt = new Intl.DateTimeFormat([], { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const stepMs = poll.slot_minutes * 60000;

  // Group slots into columns by the organizer's calendar day.
  const columns = new Map(); // day -> [iso, ...] in time order
  for (const iso of [...poll.slots].sort()) {
    const day = pollDay.format(new Date(iso));
    if (!columns.has(day)) columns.set(day, []);
    columns.get(day).push(iso);
  }
  const dayKeys = [...columns.keys()].sort();
  const rowCount = Math.max(0, ...dayKeys.map((d) => columns.get(d).length));

  const mine = { ...poll.my_availability };
  const editable = poll.status === "collecting";
  const maxCount = Math.max(1, poll.members.length);
  let brush = options.brush || "free";
  let scrollMode = !!options.scrollMode;
  let painting = false;
  let last = null;
  const nodes = new Map(); // iso -> element
  const pos = new Map();   // iso -> {c, r}
  const at = new Map();    // "c|r" -> iso

  function paintNode(iso) {
    const node = nodes.get(iso);
    const level = mine[iso];
    node.classList.toggle("cell-free", level === "free");
    node.classList.toggle("cell-maybe", level === "maybe");
    const c = poll.slot_counts[iso];
    const total = c ? c.free + c.maybe : 0;
    node.style.setProperty("--heat", String(total / maxCount));
    const when = fullFmt.format(new Date(iso));
    node.title = c ? `${when}: ${c.free} free, ${c.maybe} if needed` : when;
  }

  function apply(iso) {
    if (!editable) return;
    if (brush === "erase") delete mine[iso];
    else mine[iso] = brush;
    paintNode(iso);
    onChange && onChange(mine);
  }

  // Paint the rectangle between the previous and the current cell, so a fast drag that
  // skips cells (or a finger moving between events) still paints everything it crossed.
  function paintTo(iso) {
    const to = pos.get(iso);
    const from = last ? pos.get(last) : to;
    for (let c = Math.min(from.c, to.c); c <= Math.max(from.c, to.c); c++) {
      for (let r = Math.min(from.r, to.r); r <= Math.max(from.r, to.r); r++) {
        const s = at.get(c + "|" + r);
        if (s) apply(s);
      }
    }
    last = iso;
  }

  // Which rows get a time label: the hour rows, or every Nth row when slots do not start on
  // the hour (for example +5:30 timezones), so the grid is never left unlabeled.
  const first = columns.get(dayKeys[0]) || [];
  const hourRows = first.map((iso, r) => (timeFmt.format(new Date(iso)).endsWith(":00") ? r : -1)).filter((r) => r >= 0);
  const every = Math.max(1, Math.round(60 / poll.slot_minutes));
  const labelled = (r) => (hourRows.length ? hourRows.includes(r) : r % every === 0);

  const table = el("table", { class: "grid" + (scrollMode ? " scroll-mode" : "") });
  table.append(el("tr", {}, el("th", {}), dayKeys.map((d) => {
    const slots = columns.get(d);
    const a = dateFmt.format(new Date(slots[0]));
    const b = dateFmt.format(new Date(slots[slots.length - 1]));
    return el("th", {}, a === b ? a : `${a} → ${b}`);
  })));
  for (let r = 0; r < rowCount; r++) {
    const label = first[r] && labelled(r) ? timeFmt.format(new Date(first[r])) : "";
    const row = el("tr", {}, el("th", { class: "time-label" }, label));
    dayKeys.forEach((d, c) => {
      const iso = columns.get(d)[r];
      if (!iso) { row.append(el("td", { class: "cell-empty" })); return; }
      const td = el("td", { class: "cell", "data-slot": iso });
      nodes.set(iso, td);
      pos.set(iso, { c, r });
      at.set(c + "|" + r, iso);
      row.append(td);
    });
    table.append(row);
  }
  container.replaceChildren(table);
  nodes.forEach((_, iso) => paintNode(iso));

  function slotUnder(e) {
    // elementFromPoint, not e.target: touch pointers stay "captured" by the first cell.
    const node = document.elementFromPoint(e.clientX, e.clientY);
    const cell = node && node.closest ? node.closest("[data-slot]") : null;
    return cell && table.contains(cell) ? cell.dataset.slot : null;
  }

  table.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return; // right/middle click must not paint (or leave painting stuck)
    if (scrollMode && e.pointerType === "touch") return; // let the page scroll instead
    const iso = slotUnder(e);
    if (!iso) return;
    painting = true;
    last = null;
    paintTo(iso);
    e.preventDefault();
  });
  table.addEventListener("pointermove", (e) => {
    if (!painting) return;
    const iso = slotUnder(e);
    if (iso) paintTo(iso);
  });
  const stop = () => { painting = false; last = null; };
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);

  return {
    setBrush: (b) => { brush = b; },
    setScrollMode: (on) => { scrollMode = !!on; table.classList.toggle("scroll-mode", scrollMode); },
    marks: () => Object.entries(mine).map(([start, level]) => ({ start, level })),
    marksObject: () => ({ ...mine }),
    destroy: () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    },
    timezone: tz,
  };
};
