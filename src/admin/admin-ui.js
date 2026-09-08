// ==================== ADMIN: UI PRIMITIVES ====================
// Same el() idea as the app, plus the four states every panel needs (data,
// empty, unavailable, error) and three charts drawn as plain SVG. No chart
// library: the app has no dependencies and adding 200 KB of one to draw a line
// would undo the work just done on the bundle.

const el = (tag, attrs, kids) => {
  const n = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === false) return;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v;
    else if (k === "style") Object.assign(n.style, v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  });
  (Array.isArray(kids) ? kids : kids !== undefined ? [kids] : []).forEach((c) => {
    if (c === null || c === undefined || c === false) return;
    n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  });
  return n;
};

const $ = (sel, root) => (root || document).querySelector(sel);

/* ---- formatting --------------------------------------------------------- */

const nf = new Intl.NumberFormat();
const num = (n) => nf.format(n);

const dateShort = (t) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const dateTime = (t) => new Date(t).toLocaleString(undefined, {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
});

const ago = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return "just now";
  if (s < 5400) return Math.round(s / 60) + " min ago";
  if (s < 172800) return Math.round(s / 3600) + " h ago";
  return Math.round(s / 86400) + " days ago";
};

/* ---- states ------------------------------------------------------------- */

// A metric that cannot be measured. Says what is missing and what would fix it —
// this is the component that exists so no panel ever has to show a zero it
// cannot justify.
const unavailablePanel = (m, opts) => {
  const box = el("div", { class: "state state-unavailable" + ((opts && opts.inline) ? " state-inline" : "") });
  box.appendChild(el("div", { class: "state-title" }, "Not available yet"));
  if (m && m.reason) box.appendChild(el("p", { class: "state-reason" }, m.reason));
  if (m && m.needs) box.appendChild(el("p", { class: "state-needs" }, m.needs));
  return box;
};

// Measurable, genuinely nothing recorded yet.
const emptyPanel = (title, hint) => {
  const box = el("div", { class: "state state-empty" });
  box.appendChild(el("div", { class: "state-title" }, title || "No data collected yet"));
  if (hint) box.appendChild(el("p", { class: "state-reason" }, hint));
  return box;
};

const errorPanel = (message) => {
  const box = el("div", { class: "state state-error" });
  box.appendChild(el("div", { class: "state-title" }, "Could not read this"));
  box.appendChild(el("p", { class: "state-reason" }, message));
  return box;
};

const loadingPanel = () => el("div", { class: "state state-loading" }, [
  el("span", { class: "spin" }), el("span", {}, "Reading stored data…"),
]);

/* ---- stat tile ---------------------------------------------------------- */
// `metric` is either an ok() or a nope(). A tile never invents a value: an
// unmeasurable metric shows the gap where the number would be.

const statTile = (label, metric, opts) => {
  const o = opts || {};
  const tile = el("div", { class: "tile" + (o.wide ? " tile-wide" : "") });
  tile.appendChild(el("div", { class: "tile-label" }, label));
  if (!metric || metric.ok === false) {
    tile.appendChild(el("div", { class: "tile-na" }, "Not available"));
    tile.appendChild(el("div", { class: "tile-na-why" }, (metric && metric.reason) || "No data source"));
    if (metric && metric.needs) tile.title = metric.needs;
    tile.classList.add("tile-muted");
    return tile;
  }
  tile.appendChild(el("div", { class: "tile-value" }, typeof metric.value === "number" ? num(metric.value) : String(metric.value)));
  if (o.sub) tile.appendChild(el("div", { class: "tile-sub" }, o.sub));
  // Comparisons appear only when the previous period actually had data. No
  // baseline means no percentage — the raw previous value is shown instead.
  if (metric.delta !== null && metric.delta !== undefined) {
    const up = metric.delta > 0, flat = metric.delta === 0;
    tile.appendChild(el("div", { class: "tile-delta " + (flat ? "flat" : up ? "up" : "down") },
      (flat ? "→ " : up ? "↑ " : "↓ ") + Math.abs(metric.delta) + "% vs previous period"));
  } else if (metric.prevValue !== undefined && metric.prevValue !== null) {
    tile.appendChild(el("div", { class: "tile-delta flat" },
      metric.prevValue === 0 ? "nothing in the previous period" : "was " + num(metric.prevValue)));
  }
  return tile;
};

const panel = (title, body, actions) => {
  const p = el("section", { class: "panel" });
  const head = el("div", { class: "panel-head" });
  head.appendChild(el("h2", {}, title));
  if (actions) head.appendChild(actions);
  p.appendChild(head);
  p.appendChild(body);
  return p;
};

/* ---- charts ------------------------------------------------------------- */
// Plain SVG. Each is theme-aware through currentColor and CSS variables, and
// each degrades to an empty state rather than drawing an axis with nothing on it.

const svgNS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs) => {
  const n = document.createElementNS(svgNS, tag);
  Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
  return n;
};

// Line chart of daily counts.
const lineChart = (buckets, opts) => {
  const o = opts || {};
  if (!buckets.length) return emptyPanel("Nothing recorded in this period");
  const total = buckets.reduce((s, b) => s + b.n, 0);
  if (total === 0) return emptyPanel("Nothing recorded in this period",
    "The range is valid — there simply were no events between those dates.");

  const W = 720, H = 200, padL = 34, padB = 24, padT = 10, padR = 8;
  const max = Math.max(...buckets.map(b => b.n), 1);
  const iw = W - padL - padR, ih = H - padT - padB;
  const x = (i) => padL + (buckets.length === 1 ? iw / 2 : (i / (buckets.length - 1)) * iw);
  const y = (v) => padT + ih - (v / max) * ih;

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart chart-line",
    role: "img", "aria-label": `${o.label || "Activity"}: ${total} in ${buckets.length} days, peak ${max}` });

  // horizontal guides + y labels
  [0, 0.5, 1].forEach((f) => {
    const v = Math.round(max * f), yy = y(v);
    svg.appendChild(svgEl("line", { x1: padL, x2: W - padR, y1: yy, y2: yy, class: "grid" }));
    const t = svgEl("text", { x: padL - 7, y: yy + 4, class: "axis", "text-anchor": "end" });
    t.textContent = String(v);
    svg.appendChild(t);
  });

  const pts = buckets.map((b, i) => [x(i), y(b.n)]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = d + ` L ${pts[pts.length - 1][0].toFixed(1)} ${padT + ih} L ${pts[0][0].toFixed(1)} ${padT + ih} Z`;
  svg.appendChild(svgEl("path", { d: area, class: "line-area" }));
  svg.appendChild(svgEl("path", { d, class: "line-stroke" }));

  // Only mark points when they are far enough apart to be distinguishable.
  if (buckets.length <= 32) {
    pts.forEach((p, i) => {
      const c = svgEl("circle", { cx: p[0], cy: p[1], r: 3, class: "line-dot" });
      const tt = svgEl("title");
      tt.textContent = `${dateShort(buckets[i].t)}: ${buckets[i].n}`;
      c.appendChild(tt);
      svg.appendChild(c);
    });
  }

  // first and last date only — a label per day is unreadable over 30 days
  [[0, "start"], [buckets.length - 1, "end"]].forEach(([i, anchor]) => {
    if (buckets.length < 2 && i > 0) return;
    const t = svgEl("text", { x: x(i), y: H - 6, class: "axis", "text-anchor": anchor });
    t.textContent = dateShort(buckets[i].t);
    svg.appendChild(t);
  });

  return el("div", { class: "chart-wrap" }, svg);
};

// Horizontal bars — better than vertical for ranked lists with word labels.
const barChart = (rows, opts) => {
  const o = opts || {};
  if (!rows.length) return emptyPanel(o.emptyTitle || "Nothing recorded yet", o.emptyHint);
  const top = rows.slice(0, o.limit || 8);
  const max = Math.max(...top.map(r => r[1]), 1);
  const wrap = el("div", { class: "bars" });
  top.forEach(([name, n]) => {
    const row = el("div", { class: "bar-row" });
    row.appendChild(el("div", { class: "bar-label", title: String(name) }, o.label ? o.label(name) : String(name)));
    const track = el("div", { class: "bar-track" });
    track.appendChild(el("div", { class: "bar-fill", style: { width: Math.max(2, (n / max) * 100) + "%" } }));
    row.appendChild(track);
    row.appendChild(el("div", { class: "bar-value" }, num(n)));
    wrap.appendChild(row);
  });
  return wrap;
};

const DONUT_COLORS = ["#1F4E79", "#2f6aa0", "#5b8db8", "#89aecd", "#b4cbe0", "#d7e3ee"];

const donutChart = (rows, opts) => {
  const o = opts || {};
  if (!rows.length) return emptyPanel(o.emptyTitle || "Nothing recorded yet", o.emptyHint);
  const total = rows.reduce((s, r) => s + r[1], 0);
  if (!total) return emptyPanel(o.emptyTitle || "Nothing recorded yet", o.emptyHint);

  const size = 150, r = 60, cx = size / 2, cy = size / 2, circ = 2 * Math.PI * r;
  const svg = svgEl("svg", { viewBox: `0 0 ${size} ${size}`, class: "chart chart-donut",
    role: "img", "aria-label": rows.map(([k, v]) => `${k}: ${v}`).join(", ") });
  let offset = 0;
  rows.slice(0, DONUT_COLORS.length).forEach(([name, n], i) => {
    const frac = n / total;
    const seg = svgEl("circle", {
      cx, cy, r, fill: "none", "stroke-width": 22,
      stroke: DONUT_COLORS[i % DONUT_COLORS.length],
      "stroke-dasharray": `${(frac * circ).toFixed(2)} ${circ.toFixed(2)}`,
      "stroke-dashoffset": (-offset * circ).toFixed(2),
      transform: `rotate(-90 ${cx} ${cy})`,
    });
    const t = svgEl("title");
    t.textContent = `${name}: ${n} (${Math.round(frac * 100)}%)`;
    seg.appendChild(t);
    svg.appendChild(seg);
    offset += frac;
  });
  const mid = svgEl("text", { x: cx, y: cy + 2, class: "donut-total", "text-anchor": "middle" });
  mid.textContent = num(total);
  svg.appendChild(mid);

  const legend = el("div", { class: "legend" });
  rows.slice(0, DONUT_COLORS.length).forEach(([name, n], i) => {
    legend.appendChild(el("div", { class: "legend-row" }, [
      el("span", { class: "legend-dot", style: { background: DONUT_COLORS[i % DONUT_COLORS.length] } }),
      el("span", { class: "legend-name" }, o.label ? o.label(name) : String(name)),
      el("span", { class: "legend-val" }, num(n) + " · " + Math.round((n / total) * 100) + "%"),
    ]));
  });

  return el("div", { class: "donut-wrap" }, [el("div", { class: "chart-wrap donut-svg" }, svg), legend]);
};

/* ---- table -------------------------------------------------------------- */
// Sortable, searchable, and capped so a huge event log cannot lock the page up.

const dataTable = (cols, rows, opts) => {
  const o = opts || {};
  if (!rows.length) return emptyPanel(o.emptyTitle || "Nothing to show", o.emptyHint);

  let sortCol = o.sort !== undefined ? o.sort : null;
  let sortDir = o.dir || "desc";
  let query = "";
  const wrap = el("div", { class: "table-block" });

  if (o.search) {
    wrap.appendChild(el("div", { class: "table-search" }, el("input", {
      type: "search", placeholder: o.search, "aria-label": o.search,
      oninput: (e) => { query = e.target.value.toLowerCase().trim(); draw(); },
    })));
  }
  const scroller = el("div", { class: "table-scroll" });
  wrap.appendChild(scroller);
  const foot = el("div", { class: "table-foot" });
  wrap.appendChild(foot);

  const draw = () => {
    let view = rows;
    if (query) view = view.filter(r => cols.some((c, i) => String(c.get(r) ?? "").toLowerCase().includes(query)));
    if (sortCol !== null) {
      const c = cols[sortCol];
      view = view.slice().sort((a, b) => {
        const av = c.sortValue ? c.sortValue(a) : c.get(a);
        const bv = c.sortValue ? c.sortValue(b) : c.get(b);
        const r = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
        return sortDir === "asc" ? r : -r;
      });
    }
    const cap = o.limit || 200;
    const shown = view.slice(0, cap);

    scroller.innerHTML = "";
    if (!shown.length) { scroller.appendChild(emptyPanel("Nothing matches that search")); foot.textContent = ""; return; }

    const table = el("table");
    const thead = el("thead");
    const hr = el("tr");
    cols.forEach((c, i) => {
      const th = el("th", { scope: "col", class: c.numeric ? "num" : "" });
      if (c.sortable === false) { th.textContent = c.name; }
      else {
        const active = sortCol === i;
        th.appendChild(el("button", { type: "button", class: "th-sort" + (active ? " active" : ""),
          "aria-label": `Sort by ${c.name}`,
          onclick: () => { if (sortCol === i) sortDir = sortDir === "asc" ? "desc" : "asc"; else { sortCol = i; sortDir = "desc"; } draw(); },
        }, c.name + (active ? (sortDir === "asc" ? " ▲" : " ▼") : "")));
      }
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    const tb = el("tbody");
    shown.forEach((r) => {
      const tr = el("tr");
      cols.forEach((c) => {
        const td = el("td", { class: c.numeric ? "num" : "" });
        const v = c.render ? c.render(r) : c.get(r);
        if (v instanceof Node) td.appendChild(v); else td.textContent = v === undefined || v === null ? "—" : String(v);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    scroller.appendChild(table);
    foot.textContent = view.length > cap
      ? `Showing the first ${num(cap)} of ${num(view.length)} rows`
      : `${num(view.length)} row${view.length === 1 ? "" : "s"}`;
  };

  draw();
  return wrap;
};

/* ---- CSV ---------------------------------------------------------------- */

const csvEscape = (v) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

const downloadCSV = (filename, header, rows) => {
  const body = [header.map(csvEscape).join(",")]
    .concat(rows.map(r => r.map(csvEscape).join(",")))
    .join("\r\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
};
