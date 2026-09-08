// ==================== ROUTING & PAGE METADATA ====================
// Each tab is a real address (#/customers, #/products, #/documents) rather than
// a variable nobody outside the page can see. That buys three things: the back
// button moves between tabs instead of leaving the app, a tab can be linked to
// or bookmarked, and the browser tab, the heading and the breadcrumb can say
// which section you are actually in.
//
// The canonical link deliberately does NOT change per route. A fragment is not
// a separate URL — this is one document — so pointing the canonical at
// /bizdoc/customers/ (the written guide, a genuinely different page) would tell
// search engines the app and the guide are the same thing. The guides carry
// their own canonicals; this page keeps one.

const ROUTES = {
  dashboard: {
    hash: "#/",
    h1: "Dashboard",
    lede: "Proforma invoices, purchase orders and quotations — created here, stored on this device.",
    title: null, // home keeps the document's own title — see applyRouteMeta
    description: null,
    crumb: null, // home is the breadcrumb root, not a step inside it
  },
  customers: {
    hash: "#/customers",
    h1: "Customers",
    title: "Customers — PI & PO Maker",
    description: "Your customer list: companies, contacts, tax numbers and the discount rules applied to their documents.",
    crumb: "Customers",
    guide: "customers/",
  },
  products: {
    hash: "#/products",
    h1: "Products",
    title: "Products — PI & PO Maker",
    description: "Your product catalogue: part numbers, descriptions, units, rates, weights and HSN codes, grouped into categories.",
    crumb: "Products",
    guide: "products/",
  },
  documents: {
    hash: "#/documents",
    h1: "Documents",
    title: "Documents — PI & PO Maker",
    description: "Every proforma invoice, purchase order, quotation, tax invoice and delivery note you have raised.",
    crumb: "Documents",
    guide: "documents/",
  },
};

// The title and description the page was served with. Restored whenever the
// user is back on the home route, so the indexed metadata is what a crawler
// landing on the bare URL sees.
const BASE_TITLE = document.title;
const BASE_DESCRIPTION = (document.querySelector('meta[name="description"]') || {}).content || "";

const tabFromHash = () => {
  const h = (location.hash || "").replace(/^#\/?/, "").replace(/\/$/, "").toLowerCase();
  return ROUTES[h] ? h : "dashboard";
};

// Swap in the metadata for a route. Called on every render, so it stays correct
// no matter which way the tab changed — a click, the back button, or a link
// someone was sent.
let _lastTrackedTab = null;
const applyRouteMeta = (tab) => {
  const r = ROUTES[tab] || ROUTES.dashboard;
  // renderApp() runs on every change, not just navigation, so only a genuine
  // section change counts as a page view.
  if (tab !== _lastTrackedTab) { _lastTrackedTab = tab; track("page.viewed", { section: tab }); }
  document.title = r.title || BASE_TITLE;
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.content = r.description || BASE_DESCRIPTION;
  applyBreadcrumbSchema(tab);
};

// ---- structured data ------------------------------------------------------

const setJSONLD = (id, data) => {
  let tag = document.getElementById(id);
  if (!data) { if (tag) tag.remove(); return; }
  if (!tag) {
    tag = document.createElement("script");
    tag.type = "application/ld+json";
    tag.id = id;
    document.head.appendChild(tag);
  }
  tag.textContent = JSON.stringify(data);
};

const siteOrigin = () => {
  // Resolve against the page itself so the same code is right on GitHub Pages,
  // on a custom domain, and on localhost. From file:// there is no meaningful
  // URL to publish, so structured data is skipped entirely.
  if (!location.protocol.startsWith("http")) return null;
  return location.origin + location.pathname.replace(/[^/]*$/, "");
};

const applyBreadcrumbSchema = (tab) => {
  const base = siteOrigin();
  const r = ROUTES[tab] || ROUTES.dashboard;
  if (!base || !r.crumb) { setJSONLD("ld-breadcrumb", null); return; }
  setJSONLD("ld-breadcrumb", {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "PI & PO Maker", item: base },
      { "@type": "ListItem", position: 2, name: r.crumb, item: base + r.hash },
    ],
  });
};

// The one piece of LocalBusiness data on this site that is real: the business
// the user has actually set up in Settings. Nothing is invented — a field that
// has not been filled in is left out rather than guessed at, and if there is no
// business configured the block is not emitted at all.
const applyBusinessSchema = () => {
  const base = siteOrigin();
  const biz = (typeof activeBiz === "function") ? activeBiz() : null;
  if (!base || !biz || !biz.name) { setJSONLD("ld-business", null); return; }

  // Only the fields the business form actually collects, and only the ones that
  // have been filled in. The address is one free-text block in this app, so it
  // goes out as streetAddress rather than being split into guesses about which
  // line is the city.
  const data = { "@context": "https://schema.org", "@type": "LocalBusiness", name: biz.name };
  const street = [biz.address1, biz.address2].map(v => (v || "").trim()).filter(Boolean).join(", ");
  if (street) data.address = { "@type": "PostalAddress", streetAddress: street };
  if (biz.phone) data.telephone = biz.phone;
  if (biz.email) data.email = biz.email;
  if (biz.website) data.url = biz.website;
  if (biz.pan) data.taxID = biz.pan;
  if (biz.currency) data.currenciesAccepted = biz.currency;

  setJSONLD("ld-business", data);
};

// ---- navigation -----------------------------------------------------------

// The single way the app changes section. currentTab is set before the address
// is, so the hashchange this triggers sees nothing left to do and the redraw
// happens exactly once.
const navigateTo = (tab) => {
  const r = ROUTES[tab];
  if (!r) return;
  currentTab = tab;
  bulkSel.kind = null;
  bulkSel.ids.clear();
  if (location.hash !== r.hash) location.hash = r.hash;
  render();
};

// Back, forward, or a pasted link. Only acts when the address disagrees with
// what is on screen, which is what makes navigateTo's own hash write a no-op.
window.addEventListener("hashchange", () => {
  const tab = tabFromHash();
  if (tab === currentTab) return;
  currentTab = tab;
  bulkSel.kind = null;
  bulkSel.ids.clear();
  render();
});

// A visible breadcrumb, matching the BreadcrumbList above it. Home is a real
// link back to the dashboard; the current section is marked, not linked.
const renderBreadcrumb = (tab) => {
  const r = ROUTES[tab] || ROUTES.dashboard;
  if (!r.crumb) return null;
  const nav = el("nav", { class: "crumbs", "aria-label": "Breadcrumb" });
  const ol = el("ol");
  const home = el("li");
  home.appendChild(el("a", { href: ROUTES.dashboard.hash,
    onclick: (e) => { e.preventDefault(); navigateTo("dashboard"); } }, "Home"));
  ol.appendChild(home);
  const here = el("li");
  here.appendChild(el("span", { "aria-current": "page" }, r.crumb));
  ol.appendChild(here);
  nav.appendChild(ol);
  return nav;
};

// Quiet links out to the written guides. They are the pages a search engine can
// actually read, and this is the only thing linking to them from inside the app.
const renderAppFooter = (tab) => {
  const r = ROUTES[tab] || ROUTES.dashboard;
  const foot = el("footer", { class: "app-foot" });
  const links = el("div", { class: "app-foot-links" });
  const seen = new Set();
  const add = (href, label) => {
    if (seen.has(href)) return; // the documents tab's own guide is also the general one
    seen.add(href);
    links.appendChild(el("a", { href }, label));
  };
  if (r.guide) add(r.guide, `How ${r.crumb.toLowerCase()} work`);
  add("documents/", "Document types");
  add("offline/", "Offline & install");
  add("privacy/", "Privacy");
  foot.appendChild(links);
  return foot;
};
