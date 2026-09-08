// ==================== ADMIN: DATA LAYER ====================
// Every number the dashboard shows comes through here, and every one of them is
// either measured or explicitly marked unavailable. There is no third case:
// nothing on this dashboard is estimated, sampled, extrapolated or made up.
//
// A metric is one of:
//   ok(value)                       — measured, from real stored data
//   nope(reason, needs)             — cannot be measured; says why and what for
//
// Pages render `nope` as a stated gap ("Needs a backend"), never as 0.

const ok = (value, extra) => Object.assign({ ok: true, value }, extra || {});
const nope = (reason, needs) => ({ ok: false, reason, needs });

const NEEDS_BACKEND =
  "A server that receives events from every visitor and stores them centrally. " +
  "BizDoc has none — each browser only knows about itself.";

/* ---- storage ------------------------------------------------------------ */

const A_KEY = "pipomaker_analytics_v1";
const DB_KEY = "pipomaker_v1";

const readStore = () => {
  try {
    const raw = localStorage.getItem(A_KEY);
    const a = raw ? JSON.parse(raw) : null;
    if (!a || typeof a !== "object") return null;
    return {
      enabled: a.enabled !== false,
      firstSeen: a.firstSeen || null,
      sessions: a.sessions || 0,
      retentionDays: a.retentionDays || 90,
      events: Array.isArray(a.events) ? a.events : [],
      errors: Array.isArray(a.errors) ? a.errors : [],
      sessionLog: Array.isArray(a.sessionLog) ? a.sessionLog : [],
    };
  } catch (e) { return null; }
};

const writeStore = (patch) => {
  try {
    const raw = localStorage.getItem(A_KEY);
    const a = raw ? JSON.parse(raw) : {};
    localStorage.setItem(A_KEY, JSON.stringify(Object.assign(a, patch)));
    return true;
  } catch (e) { return false; }
};

const readAppDB = () => {
  try {
    const raw = localStorage.getItem(DB_KEY);
    const d = raw ? JSON.parse(raw) : null;
    if (!d || typeof d !== "object") return null;
    return {
      businesses: Array.isArray(d.businesses) ? d.businesses : [],
      customers: Array.isArray(d.customers) ? d.customers : [],
      products: Array.isArray(d.products) ? d.products : [],
      documents: Array.isArray(d.documents) ? d.documents : [],
    };
  } catch (e) { return null; }
};

/* ---- date ranges -------------------------------------------------------- */

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x.getTime(); };
const daysAgo = (n) => startOfDay(Date.now() - n * 86400000);

const RANGES = {
  today: { label: "Today", from: () => startOfDay(Date.now()), to: () => endOfDay(Date.now()) },
  yesterday: { label: "Yesterday", from: () => daysAgo(1), to: () => endOfDay(Date.now() - 86400000) },
  "7d": { label: "Last 7 days", from: () => daysAgo(6), to: () => endOfDay(Date.now()) },
  "30d": { label: "Last 30 days", from: () => daysAgo(29), to: () => endOfDay(Date.now()) },
  month: {
    label: "This month",
    from: () => { const d = new Date(); return startOfDay(new Date(d.getFullYear(), d.getMonth(), 1)); },
    to: () => endOfDay(Date.now()),
  },
  lastMonth: {
    label: "Last month",
    from: () => { const d = new Date(); return startOfDay(new Date(d.getFullYear(), d.getMonth() - 1, 1)); },
    to: () => { const d = new Date(); return endOfDay(new Date(d.getFullYear(), d.getMonth(), 0)); },
  },
  custom: { label: "Custom range", from: () => daysAgo(6), to: () => endOfDay(Date.now()) },
};

// The equivalent window immediately before this one, for "vs previous period".
const previousWindow = (from, to) => {
  const span = to - from;
  return { from: from - span - 1, to: from - 1 };
};

/* ---- aggregation -------------------------------------------------------- */

const inWindow = (rows, from, to, key) =>
  rows.filter(r => r && typeof r[key || "t"] === "number" && r[key || "t"] >= from && r[key || "t"] <= to);

const countBy = (rows, fn) => {
  const m = new Map();
  rows.forEach(r => { const k = fn(r); if (k === undefined || k === null || k === "") return; m.set(k, (m.get(k) || 0) + 1); });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

// One bucket per day across the window, so a chart with three events still
// draws a real axis rather than three points floating in space.
const dailyBuckets = (rows, from, to) => {
  const out = [];
  const first = startOfDay(from);
  for (let t = first; t <= to; t += 86400000) {
    const next = t + 86400000;
    out.push({ t, n: rows.filter(r => r.t >= t && r.t < next).length });
  }
  return out.length > 370 ? out.slice(-370) : out;
};

// Percent change, or null when there is nothing honest to compare against.
// Growth from zero is not "+100%", it is not a percentage at all, so it
// returns null and the UI shows the raw before/after instead.
const delta = (current, prev) => {
  if (!isFinite(current) || !isFinite(prev)) return null;
  if (prev <= 0) return null;
  return Math.round(((current - prev) / prev) * 100);
};

/* ---- event vocabulary --------------------------------------------------- */
// Maps raw event names to the words a person reading the dashboard would use.
// Anything not listed still shows, under its raw name, so a newly added event
// is never silently dropped from the totals.

const EVENT_LABELS = {
  "document.created": "Document created",
  "document.edited": "Document edited",
  "document.deleted": "Document deleted",
  "document.delete_undone": "Delete undone",
  "document.exported": "Document exported",
  "document.printed": "Document printed",
  "document.shared": "Document shared",
  "export.failed": "Export failed",
  "customer.created": "Customer added",
  "customer.edited": "Customer edited",
  "product.created": "Product added",
  "product.edited": "Product edited",
  "search.performed": "Search",
  "csv.exported": "CSV export",
  "csv.template_downloaded": "CSV template",
  "backup.exported": "Backup saved",
  "backup.imported": "Backup restored",
  "backup.device_restore": "Restored from device",
  "drive.backup": "Google Drive backup",
  "drive.failed": "Google Drive failed",
  "settings.opened": "Settings opened",
  "page.viewed": "Section opened",
};
const eventLabel = (e) => EVENT_LABELS[e] || e;

// Which events count as "a feature was used". Page views and undo are movement
// and correction, not feature usage, so counting them would inflate the table.
const FEATURE_EVENTS = [
  "document.created", "document.edited", "document.exported", "document.printed",
  "document.shared", "search.performed", "csv.exported", "csv.template_downloaded",
  "backup.exported", "backup.imported", "backup.device_restore", "drive.backup",
  "customer.created", "product.created", "settings.opened",
];

const SECTION_LABELS = {
  dashboard: "Home", customers: "Customers", products: "Products", documents: "Documents",
};

/* ---- the local source --------------------------------------------------- */
// Real, measured, and strictly limited to this browser on this device.

const localSource = {
  id: "local",
  title: "This browser",
  available: () => !!readStore(),

  meta() {
    const s = readStore();
    return {
      enabled: s ? s.enabled : false,
      firstSeen: s && s.firstSeen ? s.firstSeen : null,
      sessions: s ? s.sessions : 0,
      retentionDays: s ? s.retentionDays : 90,
      events: s ? s.events.length : 0,
      errors: s ? s.errors.length : 0,
    };
  },

  // Everything a page needs for one window, computed once.
  window(from, to) {
    const s = readStore() || { events: [], errors: [], sessionLog: [], sessions: 0, firstSeen: null };
    const db = readAppDB();
    const ev = inWindow(s.events, from, to);
    const prev = previousWindow(from, to);
    const evPrev = inWindow(s.events, prev.from, prev.to);
    const sess = inWindow(s.sessionLog, from, to);
    const sessPrev = inWindow(s.sessionLog, prev.from, prev.to);

    const docsCreated = ev.filter(e => e.e === "document.created");
    const docsCreatedPrev = evPrev.filter(e => e.e === "document.created");
    const featureRows = ev.filter(e => FEATURE_EVENTS.indexOf(e.e) >= 0);
    const pageRows = ev.filter(e => e.e === "page.viewed");

    // Documents that exist but predate creation-timestamping. Counted and
    // shown as such rather than folded into a total that implies we know when
    // they were made.
    const allDocs = db ? db.documents : [];
    const undated = allDocs.filter(d => !d.createdAt).length;

    return {
      from, to, prev,
      events: ev,
      eventsPrev: evPrev,
      sessions: sess,
      sessionsPrev: sessPrev,
      db,
      docsCreated,
      docsCreatedPrev,
      featureRows,
      pageRows,
      undatedDocs: undated,
      totalDocsNow: allDocs.length,
      errors: s.errors,
      allEvents: s.events,
      firstSeen: s.firstSeen,
      totalSessions: s.sessions,
    };
  },
};

/* ---- the remote source (not connected) ---------------------------------- */
// This is the seam. It is deliberately not implemented, because implementing it
// against nothing would mean inventing the numbers. It documents the exact
// contract a backend must satisfy, so the dashboard above it needs no changes
// on the day one exists.

const remoteSource = {
  id: "remote",
  title: "All visitors (backend)",
  available: () => false,
  configured: () => false,

  // What a backend would have to expose for the greyed-out panels to light up.
  contract: [
    { name: "GET /api/stats/overview", gives: "visitors, unique visitors, sessions, new vs returning" },
    { name: "GET /api/stats/timeseries?from&to", gives: "visitors and page views per day" },
    { name: "GET /api/stats/sources", gives: "referrers, countries, devices, browsers" },
    { name: "GET /api/events?from&to", gives: "the same event names this app already emits, from every device" },
    { name: "POST /api/events", gives: "the endpoint the app would send its event batches to" },
    { name: "POST /api/auth/login", gives: "a real admin session — the only way to protect any of the above" },
  ],
};

/* ---- cross-source metrics ----------------------------------------------- */
// The audience questions. Each one states plainly that it needs a backend,
// rather than showing a number derived from a single browser and letting it be
// read as a population figure.

const audienceMetrics = () => ({
  totalVisitors: nope("Cannot be measured from the browser", NEEDS_BACKEND),
  uniqueVisitors: nope("Cannot be measured from the browser", NEEDS_BACKEND),
  activeUsers: nope("Cannot be measured from the browser", NEEDS_BACKEND),
  newUsers: nope("Cannot be measured from the browser", NEEDS_BACKEND),
  returningUsers: nope("Cannot be measured from the browser", NEEDS_BACKEND),
  countries: nope("Needs server-side IP lookup", NEEDS_BACKEND + " Country also requires resolving visitor IPs, which only a server sees."),
  trafficSources: nope("Only this browser's own referrers are known", NEEDS_BACKEND),
});
