// ==================== ANALYTICS (THIS DEVICE ONLY) ====================
// Records what happens in the app so /admin can show real numbers instead of
// invented ones. Everything here stays in this browser's localStorage. Nothing
// is uploaded, because there is nothing to upload it to: BizDoc has no server.
//
// What that means, stated plainly so nobody reads more into the dashboard than
// is there: this measures ONE browser on ONE device. It cannot tell you how
// many people use BizDoc, because a static page has no way to report back.
// Those numbers need a backend — see the remoteSource stub in
// src/admin/admin-data.js, which documents exactly what one would have to provide.
//
// What is recorded: an event name, a timestamp, and a few small non-identifying
// properties (a document TYPE like "PI", a count, a duration).
// What is never recorded: document contents, customer or product names,
// amounts, business details, file names, or anything typed into a field.
//
// Loaded first so the error handlers are installed before anything else runs.

const ANALYTICS_KEY = "pipomaker_analytics_v1";
const ANALYTICS_MAX_EVENTS = 3000;   // ring buffer — oldest fall off the end
const ANALYTICS_MAX_ERRORS = 200;
const ANALYTICS_VERSION = 1;

const emptyAnalytics = () => ({
  v: ANALYTICS_VERSION,
  enabled: true,
  firstSeen: null,     // when this browser first opened the app
  sessions: 0,         // how many times it has been opened
  retentionDays: 90,   // events older than this are dropped on load
  events: [],          // { t, e, p }
  errors: [],          // { t, m, src, n, first, last }
  sessionLog: [],      // { t, ref, w, h } — one per app open
});

// Read-modify-write against localStorage each time. The volumes here are tiny
// (a few hundred KB at the cap) and it keeps the store correct if the app is
// open in two tabs, which a single in-memory copy would not.
const readAnalytics = () => {
  try {
    const raw = localStorage.getItem(ANALYTICS_KEY);
    if (!raw) return emptyAnalytics();
    const a = JSON.parse(raw);
    if (!a || typeof a !== "object") return emptyAnalytics();
    return Object.assign(emptyAnalytics(), a, {
      events: Array.isArray(a.events) ? a.events : [],
      errors: Array.isArray(a.errors) ? a.errors : [],
      sessionLog: Array.isArray(a.sessionLog) ? a.sessionLog : [],
    });
  } catch (e) {
    return emptyAnalytics();
  }
};

const writeAnalytics = (a) => {
  try {
    localStorage.setItem(ANALYTICS_KEY, JSON.stringify(a));
    return true;
  } catch (e) {
    // Storage full, or blocked in a private window. Analytics must never be the
    // reason the app stops working, so this fails silently and the app carries
    // on — the dashboard will simply show fewer events.
    return false;
  }
};

const analyticsEnabled = () => {
  try { return readAnalytics().enabled !== false; } catch (e) { return false; }
};

// Drop anything past the retention window and past the size caps.
const pruneAnalytics = (a) => {
  const days = Number(a.retentionDays) > 0 ? Number(a.retentionDays) : 90;
  const cutoff = Date.now() - days * 86400000;
  a.events = a.events.filter(x => x && x.t >= cutoff).slice(-ANALYTICS_MAX_EVENTS);
  a.sessionLog = a.sessionLog.filter(x => x && x.t >= cutoff).slice(-ANALYTICS_MAX_EVENTS);
  a.errors = a.errors.filter(x => x && x.last >= cutoff).slice(-ANALYTICS_MAX_ERRORS);
  return a;
};

// Property values are deliberately restricted: short strings, finite numbers
// and booleans only. Anything else is dropped rather than stringified, so a
// whole customer object can never end up in the log by accident.
const safeProps = (props) => {
  if (!props || typeof props !== "object") return undefined;
  const out = {};
  Object.keys(props).slice(0, 8).forEach((k) => {
    const v = props[k];
    if (typeof v === "number" && isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = v.slice(0, 40);
  });
  return Object.keys(out).length ? out : undefined;
};

// The one function the rest of the app calls.
//   track("document.created", { type: "PI", lines: 4 })
const track = (name, props) => {
  try {
    if (typeof name !== "string" || !name) return;
    const a = readAnalytics();
    if (a.enabled === false) return;
    a.events.push({ t: Date.now(), e: name.slice(0, 60), p: safeProps(props) });
    if (a.events.length > ANALYTICS_MAX_EVENTS) a.events = a.events.slice(-ANALYTICS_MAX_EVENTS);
    writeAnalytics(a);
  } catch (e) { /* never let measurement break the thing being measured */ }
};

// Errors are grouped by message rather than logged one per occurrence, so a
// loop that throws a thousand times is one row with a count, not a thousand
// rows that push everything else out of the buffer.
const trackError = (message, source) => {
  try {
    const a = readAnalytics();
    if (a.enabled === false) return;
    const m = String(message || "Unknown error").slice(0, 200);
    const src = String(source || "").split("/").pop().slice(0, 60);
    const now = Date.now();
    const hit = a.errors.find(x => x.m === m && x.src === src);
    if (hit) { hit.n += 1; hit.last = now; }
    else a.errors.push({ m, src, n: 1, first: now, last: now });
    if (a.errors.length > ANALYTICS_MAX_ERRORS) {
      // Keep the most frequent, then the most recent — dropping a one-off is
      // less costly than dropping the error that is happening constantly.
      a.errors.sort((x, y) => (y.n - x.n) || (y.last - x.last));
      a.errors = a.errors.slice(0, ANALYTICS_MAX_ERRORS);
    }
    writeAnalytics(a);
  } catch (e) { /* ignore */ }
};

// ---- automatic capture -----------------------------------------------------

window.addEventListener("error", (e) => {
  if (!e) return;
  trackError(e.message || (e.error && e.error.message), e.filename);
});

window.addEventListener("unhandledrejection", (e) => {
  const r = e && e.reason;
  trackError((r && r.message) || String(r || "Unhandled promise rejection"), "promise");
});

// One entry per app open. The referrer is kept only as a hostname (where the
// visit came from), never the full URL, which can carry search terms.
(() => {
  try {
    const a = pruneAnalytics(readAnalytics());
    if (a.enabled === false) { writeAnalytics(a); return; }
    const now = Date.now();
    if (!a.firstSeen) a.firstSeen = now;
    a.sessions = (a.sessions || 0) + 1;
    let ref = "";
    try { ref = document.referrer ? new URL(document.referrer).hostname : ""; } catch (err) { ref = ""; }
    a.sessionLog.push({
      t: now,
      ref: ref.slice(0, 60),
      w: screen && screen.width ? screen.width : 0,
      h: screen && screen.height ? screen.height : 0,
      standalone: !!(window.matchMedia && matchMedia("(display-mode: standalone)").matches),
    });
    writeAnalytics(a);
  } catch (e) { /* ignore */ }
})();
