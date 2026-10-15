// Availability grid. One column per poll day (the organizer's day), one row per slot of elapsed
// time within that day, so a window that crosses midnight or a DST change still lines up. Slot
// times are UTC ISO strings throughout; everything is displayed in the viewer's own timezone.
//
// Marking: click or tap a box to cycle it: green (available) -> yellow (maybe) -> red (not
// available) -> unmarked. With a mouse you can drag to paint the same state across boxes. Tap a
// day or a time to cycle a whole column or row (this is what makes phones practical: touch drags
// are left to scrolling).
window.AvailabilityGrid = function (container, poll, onChange) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const pollDay = new Intl.DateTimeFormat("en-CA", { timeZone: poll.timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  const weekdayFmt = new Intl.DateTimeFormat([], { timeZone: tz, weekday: "short" });
  const monthDayFmt = new Intl.DateTimeFormat([], { timeZone: tz, month: "short", day: "numeric" });
  const fullFmt = new Intl.DateTimeFormat([], { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  const LABEL = { free: "Available", maybe: "Maybe", no: "Not available" };
  function nextState(level) {
    if (level === "free") return "maybe";
    if (level === "maybe") return "no";
    if (level === "no") return undefined; // back to unmarked
    return "free";
  }

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
  let painting = false;
  let brush;               // the state being painted by the current drag
  let last = null;         // the previous box of the drag
  let suppressClick = false;
  const nodes = new Map(); // iso -> element
  const pos = new Map();   // iso -> {c, r}
  const at = new Map();    // "c|r" -> iso

  function paintNode(iso) {
    const node = nodes.get(iso);
    const level = mine[iso];
    for (const state of ["free", "maybe", "no"]) node.classList.toggle("cell-" + state, level === state);
    const c = poll.slot_counts[iso];
    const total = c ? c.free + c.maybe : 0;
    node.style.setProperty("--heat", String(total / maxCount));
    const when = fullFmt.format(new Date(iso));
    node.title = `${when}: ${level ? LABEL[level] : "not marked"}` + (c ? ` (${c.free} free, ${c.maybe} maybe)` : "");
    node.setAttribute("aria-label", node.title);
  }

  function set(iso, level) {
    if (!editable) return;
    if (level === undefined) delete mine[iso];
    else mine[iso] = level;
    paintNode(iso);
    onChange && onChange(mine);
  }

  // Paint the rectangle between the previous and the current box, so a fast drag still fills
  // everything it crossed.
  function paintTo(iso) {
    const to = pos.get(iso);
    const from = last ? pos.get(last) : to;
    for (let c = Math.min(from.c, to.c); c <= Math.max(from.c, to.c); c++) {
      for (let r = Math.min(from.r, to.r); r <= Math.max(from.r, to.r); r++) {
        const s = at.get(c + "|" + r);
        if (s) set(s, brush);
      }
    }
    last = iso;
  }

  // A whole day or time: if its boxes all share a state, move them all to the next one;
  // otherwise start them all at green.
  function cycleGroup(isos) {
    if (!editable || !isos.length) return;
    const states = new Set(isos.map((i) => mine[i]));
    const target = states.size === 1 ? nextState([...states][0]) : "free";
    isos.forEach((i) => set(i, target));
  }

  // Which rows get a time label: the hour rows, or every Nth row when slots do not start on
  // the hour (for example +5:30 timezones), so the grid is never left unlabeled.
  const first = columns.get(dayKeys[0]) || [];
  const hourRows = first.map((iso, r) => (timeFmt.format(new Date(iso)).endsWith(":00") ? r : -1)).filter((r) => r >= 0);
  const every = Math.max(1, Math.round(60 / poll.slot_minutes));
  const labelled = (r) => (hourRows.length ? hourRows.includes(r) : r % every === 0);

  const table = el("table", { class: "grid" + (editable ? "" : " readonly") });
  const head = el("tr", {}, el("th", {}));
  dayKeys.forEach((d) => {
    const slots = columns.get(d);
    const when = new Date(slots[0]);
    // One date per column, e.g. "Wed, Oct 14": a window that runs past midnight stays one column.
    const th = el("th", { class: "day-head", role: "button", tabindex: editable ? "0" : "-1" },
      el("span", { class: "dow" }, weekdayFmt.format(when) + ","), " ", el("span", { class: "md" }, monthDayFmt.format(when)));
    th.addEventListener("click", () => cycleGroup(slots));
    head.append(th);
  });
  table.append(head);
  for (let r = 0; r < rowCount; r++) {
    const rowIsos = dayKeys.map((d) => columns.get(d)[r]).filter(Boolean);
    const label = first[r] && labelled(r) ? timeFmt.format(new Date(first[r])) : "";
    const th = el("th", { class: "time-label" }, label);
    if (label) th.addEventListener("click", () => cycleGroup(rowIsos));
    const row = el("tr", {}, th);
    dayKeys.forEach((d, c) => {
      const iso = columns.get(d)[r];
      if (!iso) { row.append(el("td", { class: "cell-empty" })); return; }
      const td = el("td", { class: "cell", "data-slot": iso, role: "button", tabindex: editable ? "0" : "-1" });
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
    const node = document.elementFromPoint(e.clientX, e.clientY);
    const cell = node && node.closest ? node.closest("[data-slot]") : null;
    return cell && table.contains(cell) ? cell.dataset.slot : null;
  }

  // Mouse and pen: press to mark, drag to paint the same state across boxes.
  table.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.pointerType === "touch" || !editable) return;
    const iso = slotUnder(e);
    if (!iso) return;
    painting = true;
    suppressClick = true;
    last = null;
    brush = nextState(mine[iso]);
    paintTo(iso);
    e.preventDefault();
  });
  table.addEventListener("pointermove", (e) => {
    if (!painting) return;
    const iso = slotUnder(e);
    if (iso) paintTo(iso);
  });
  const stop = () => {
    painting = false;
    last = null;
    setTimeout(() => { suppressClick = false; }, 0); // a click, if any, has fired by now
  };
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);

  // Touch taps and keyboard: a plain click on a box cycles it.
  table.addEventListener("click", (e) => {
    const cell = e.target.closest("[data-slot]");
    if (!cell || suppressClick) return;
    set(cell.dataset.slot, nextState(mine[cell.dataset.slot]));
  });
  table.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const target = e.target.closest("[data-slot], .day-head");
    if (!target) return;
    e.preventDefault();
    target.click();
  });

  return {
    marks: () => Object.entries(mine).map(([start, level]) => ({ start, level })),
    marksObject: () => ({ ...mine }),
    destroy: () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    },
    timezone: tz,
  };
};
