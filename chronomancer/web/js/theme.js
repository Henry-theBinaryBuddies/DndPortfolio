// Theme loader: wording from /themes/<name>.json, styling from /css/themes/<name>.css.
// Elements with data-t="key" get their text from the active theme. Never uses innerHTML.
(function () {
  const THEMES = ["dnd", "plain"];
  const KEY = "chronomancer-theme";
  let words = {};

  function saved() {
    try {
      const v = localStorage.getItem(KEY);
      return THEMES.includes(v) ? v : "dnd";
    } catch (e) {
      return "dnd";
    }
  }

  function apply() {
    document.querySelectorAll("[data-t]").forEach((el) => {
      const text = words[el.dataset.t];
      if (text !== undefined) el.textContent = text;
    });
    document.querySelectorAll("[data-t-placeholder]").forEach((el) => {
      const text = words[el.dataset.tPlaceholder];
      if (text !== undefined) el.placeholder = text;
    });
  }

  async function load(name) {
    const link = document.getElementById("theme-css");
    link.href = "/css/themes/" + name + ".css";
    document.documentElement.dataset.theme = name;
    const res = await fetch("/themes/" + name + ".json");
    words = await res.json();
    apply();
    window.dispatchEvent(new CustomEvent("themechange", { detail: name }));
  }

  function setTheme(name) {
    if (!THEMES.includes(name)) return;
    try { localStorage.setItem(KEY, name); } catch (e) { /* storage unavailable */ }
    return load(name);
  }

  window.Theme = {
    THEMES,
    t: (key) => words[key] ?? key,
    apply,
    set: setTheme,
    current: saved,
    ready: load(saved()),
  };

  document.addEventListener("DOMContentLoaded", () => {
    const sel = document.getElementById("theme-select");
    if (!sel) return;
    sel.value = saved();
    sel.addEventListener("change", () => setTheme(sel.value));
  });
})();
