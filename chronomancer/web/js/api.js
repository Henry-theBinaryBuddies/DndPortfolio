// Thin fetch wrapper. Throws Error with the server's message on non-2xx.
window.Api = (function () {
  async function call(method, url, body) {
    const res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      let msg = res.statusText;
      if (data && data.detail) {
        const d = data.detail;
        if (typeof d === "string") msg = d;
        else if (Array.isArray(d)) {
          // FastAPI validation errors: [{loc: [...], msg: "..."}] -> "field: message"
          msg = d.map((x) => {
            const field = Array.isArray(x.loc) ? x.loc[x.loc.length - 1] : "";
            return field ? `${field}: ${x.msg}` : String(x.msg);
          }).join("; ");
        } else msg = d.message || JSON.stringify(d);
      }
      const err = new Error(msg);
      err.status = res.status;
      err.detail = data && data.detail;
      throw err;
    }
    return data;
  }
  return {
    get: (u) => call("GET", u),
    post: (u, b) => call("POST", u, b === undefined ? {} : b),
    put: (u, b) => call("PUT", u, b),
    patch: (u, b) => call("PATCH", u, b),
    del: (u) => call("DELETE", u),
  };
})();

// Tell the server which timezone this browser is in, so poll hours an organizer types mean their
// own time. Runs on every page; does nothing when logged out or already up to date.
(async function syncTimezone() {
  try {
    const res = await fetch("/api/me", { credentials: "same-origin" });
    if (!res.ok) return;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && (await res.json()).timezone !== zone) await window.Api.put("/api/me", { timezone: zone });
  } catch (e) { /* best effort */ }
})();

// Safe DOM helper: el("div", {class: "x"}, "text", childEl)
window.el = function (tag, attrs, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
};

window.fmtDateTime = (iso) =>
  new Date(iso).toLocaleString([], {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
