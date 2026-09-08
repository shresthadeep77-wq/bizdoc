#!/usr/bin/env node
/**
 * The only build step. No dependencies, no install.
 *
 *   node build.js            build the site
 *   node build.js --check    verify the built files match src/ (exit 1 if stale)
 *   node build.js --single [out.html]
 *                            one fully self-contained HTML file, libraries and
 *                            all, for putting on a USB stick
 *
 * What it produces:
 *
 *   index.html               the app — one file, minus the two PDF libraries
 *   lib/*.js                 those libraries, fetched only when someone exports
 *   <section>/index.html     the written guides, one real page each
 *   404.html                 custom not-found page
 *   sitemap.xml robots.txt llms.txt
 *
 * The app ships as a single file so it runs offline, installs as a PWA and
 * works straight off GitHub Pages or a file:// path. src/ is the same code
 * split up purely for editing. The guides are separate pages because they are
 * text, not app: a crawler can read them without running any JavaScript, and
 * they load in a few KB instead of half a megabyte.
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SRC = path.join(ROOT, "src");
const SITE = path.join(SRC, "site");

const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const readSite = (name) => fs.readFileSync(path.join(SITE, name), "utf8");

const site = JSON.parse(readSite("pages.json"));
const { origin, base, pages } = site;
const absolute = (slug) => origin + base + slug;

/* -- shared bits ---------------------------------------------------------- */

// jsPDF ships with a //# sourceMappingURL comment pointing at a .map file we do
// not publish. Left in, every visitor with devtools open gets a 404 for it.
const stripSourceMaps = (js) =>
  js.replace(/^[ \t]*\/\/[#@] sourceMappingURL=.*$/gm, "")
    .replace(/\/\*[#@] sourceMappingURL=[\s\S]*?\*\//g, "")
    .trimEnd();

const escapeAttr = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// App files concatenate into one shared scope, so order matters. _order.json is
// the source of truth; it is rewritten whenever files are added or renamed.
const appOrder = () => {
  const order = JSON.parse(read(path.join("app", "_order.json")));
  const onDisk = fs.readdirSync(path.join(SRC, "app"))
    .filter((f) => f.endsWith(".js"))
    .sort();
  const missing = onDisk.filter((f) => !order.includes(f));
  const stale = order.filter((f) => !onDisk.includes(f));
  if (missing.length) throw new Error(`src/app/_order.json is missing: ${missing.join(", ")}`);
  if (stale.length) throw new Error(`src/app/_order.json lists absent files: ${stale.join(", ")}`);
  return order;
};

const appCode = () => appOrder()
  .map((f) => read(path.join("app", f)).trimEnd())
  .join("\n\n");

/* -- structured data ------------------------------------------------------ */

// Everything asserted here is true of the app as built. There is deliberately
// no LocalBusiness block: this is a tool, not a business with an address, and
// inventing one would be structured-data spam. The app emits a real
// LocalBusiness at runtime from whatever business the user set up in Settings
// (see src/app/28-routing-seo.js) — that data is theirs and it is genuine.
const homeSchema = () => JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": absolute("") + "#website",
      url: absolute(""),
      name: site.siteName,
      description: pages[0].description,
      inLanguage: "en",
    },
    {
      "@type": "SoftwareApplication",
      "@id": absolute("") + "#app",
      name: site.siteName,
      url: absolute(""),
      applicationCategory: "BusinessApplication",
      operatingSystem: "Any browser. Installable on Android, iOS, Windows, macOS and Linux.",
      description: pages[0].description,
      image: absolute("assets/social-card.png"),
      browserRequirements: "Requires JavaScript.",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      featureList: [
        "Proforma invoices",
        "Purchase orders",
        "Quotations",
        "Tax invoices",
        "Delivery notes",
        "Customer database with per-customer discount rules",
        "Product catalogue with categories and bulk rate updates",
        "A4 PDF, PNG, print and WhatsApp export",
        "CSV import and export",
        "Works offline; data stored only in the browser",
      ],
    },
    {
      "@type": "Organization",
      "@id": absolute("") + "#publisher",
      name: site.siteName,
      url: absolute(""),
      logo: absolute("assets/icon-512.png"),
    },
  ],
}, null, 2);

const pageSchema = (page) => {
  const graph = [{
    "@type": "WebPage",
    "@id": absolute(page.slug) + "#page",
    url: absolute(page.slug),
    name: page.title,
    description: page.description,
    inLanguage: "en",
    isPartOf: { "@id": absolute("") + "#website" },
    primaryImageOfPage: absolute("assets/social-card.png"),
  }, {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: absolute("") },
      { "@type": "ListItem", position: 2, name: page.nav, item: absolute(page.slug) },
    ],
  }];
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2);
};

/* -- the app page --------------------------------------------------------- */

// `inlineLibs` is what --single flips: normally the two big libraries are
// written to lib/ and pulled in on demand, and here they are baked in instead.
const buildApp = ({ inlineLibs = false } = {}) => {
  const parts = {
    "schema": () => homeSchema(),
    "styles.css": () => read("styles.css").trimEnd(),
    "vendor/qrcode.js": () => stripSourceMaps(read(path.join("vendor", "qrcode.js"))),
    "app/*": () => appCode(),
    "pwa.js": () => read("pwa.js").trimEnd(),
  };

  let shell = read("index.html");
  if (inlineLibs) {
    // Both globals exist before any code runs, so ensurePdfLibs() short-circuits
    // and nothing is ever fetched from lib/.
    const libs = ["html2canvas.js", "jspdf.js"]
      .map((f) => `<script>\n${stripSourceMaps(read(path.join("vendor", f)))}\n</script>`)
      .join("\n");
    shell = shell.replace("<script>\n<!--include:app/*-->", `${libs}\n<script>\n<!--include:app/*-->`);
  }

  const out = shell.replace(/<!--include:(.+?)-->/g, (_, key) => {
    const fn = parts[key];
    if (!fn) throw new Error(`Unknown include in src/index.html: ${key}`);
    return fn();
  });
  const left = out.match(/<!--include:.+?-->/);
  if (left) throw new Error(`Unresolved include: ${left[0]}`);
  return out.trimEnd() + "\n";
};

/* -- the admin panel ------------------------------------------------------ */
// Its own page at /admin/, not part of the app bundle and not linked from it.
// It sits on the same origin as the app, which is what lets it read the app's
// stored data: a browser scopes localStorage per site, not per folder.
const ADMIN_ORDER = ["admin-data.js", "admin-ui.js", "admin-pages.js", "admin-boot.js"];

const buildAdmin = () => {
  const dir = path.join(SRC, "admin");
  const onDisk = fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort();
  const missing = onDisk.filter((f) => ADMIN_ORDER.indexOf(f) < 0);
  if (missing.length) throw new Error("build.js ADMIN_ORDER is missing: " + missing.join(", "));

  const parts = {
    "admin.css": () => fs.readFileSync(path.join(dir, "admin.css"), "utf8").trimEnd(),
    "admin/*": () => ADMIN_ORDER
      .map((f) => fs.readFileSync(path.join(dir, f), "utf8").trimEnd())
      .join("\n\n"),
  };
  const shell = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  const out = shell.replace(/<!--include:(.+?)-->/g, (_, key) => {
    const fn = parts[key];
    if (!fn) throw new Error("Unknown include in src/admin/index.html: " + key);
    return fn();
  });
  const left = out.match(/<!--include:.+?-->/);
  if (left) throw new Error("Unresolved include in admin: " + left[0]);
  return out.trimEnd() + "\n";
};

/* -- the written guides --------------------------------------------------- */

const layout = () => readSite("layout.html");
const siteCSS = () => readSite("site.css").trimEnd();

const contentPages = () => pages.filter((p) => !p.app);

// How deep this page sits, and therefore what "back to the root" looks like
// from it. The guides are all one level down, so they can stay relative and
// keep working whatever the site is hosted under. 404.html is the exception:
// it is served for a missing path at any depth, so nothing relative would
// resolve and it has to use the absolute base.
const rootFor = (page) => (page.absoluteRoot ? base : "../");

const renderNav = (current, root) => contentPages()
  .map((p) => {
    const href = root + p.slug;
    const currentAttr = p.slug === current ? ' aria-current="page"' : "";
    return `<a href="${href}"${currentAttr}>${p.nav}</a>`;
  })
  .join("\n    ");

const renderCrumbs = (page, root) => {
  if (page.noCrumbs) return "";
  return `<nav class="crumbs" aria-label="Breadcrumb">
  <ol>
    <li><a href="${root}">Home</a></li>
    <li><span aria-current="page">${page.nav}</span></li>
  </ol>
</nav>`;
};

const renderFootNav = (root) => contentPages()
  .map((p) => `<li><a href="${root}${p.slug}">${p.nav}</a></li>`)
  .join("\n        ");

const buildPage = (page) => {
  const root = rootFor(page);
  const body = readSite(page.body).replace(/\{\{root\}\}/g, root);
  const heading = page.h1
    ? `<h1>${page.h1}</h1>\n<p class="lede">${page.lede}</p>\n\n`
    : "";

  const fields = {
    title: escapeAttr(page.title),
    ogTitle: escapeAttr(page.ogTitle || page.title.split(" — ")[0]),
    description: escapeAttr(page.description),
    canonical: absolute(page.slug),
    origin,
    base,
    root,
    robots: page.noindex
      ? '<meta name="robots" content="noindex, follow">'
      : '<meta name="robots" content="index, follow, max-image-preview:large">',
    css: siteCSS(),
    schema: page.schema || pageSchema(page),
    nav: renderNav(page.slug, root),
    crumbs: renderCrumbs(page, root),
    footNav: renderFootNav(root),
    content: heading + body.trimEnd(),
  };

  const out = layout().replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in fields)) throw new Error(`Unknown placeholder {{${key}}} in src/site/layout.html`);
    return fields[key];
  });
  return out.trimEnd() + "\n";
};

// 404 is not in pages.json — it is not a destination and must never be indexed
// or listed in the sitemap, but it uses the same layout so it does not look
// like it fell off a different site.
const notFoundPage = () => buildPage({
  slug: "404.html",
  nav: "Page not found",
  title: "Page not found — PI & PO Maker",
  ogTitle: "Page not found",
  description: "That address does not match anything on this site. Everything that does exist is listed here.",
  body: "body-404.html",
  noindex: true,
  noCrumbs: true,
  absoluteRoot: true,
  schema: JSON.stringify({ "@context": "https://schema.org", "@type": "WebPage", name: "Page not found" }, null, 2),
});

/* -- sitemap, robots, llms.txt -------------------------------------------- */

// One <lastmod> for the whole site: everything is generated from the same
// source tree in the same build, so per-page dates would be invented precision.
const lastmod = () => new Date().toISOString().slice(0, 10);

const sitemap = () => {
  const day = lastmod();
  const urls = pages.map((p) => [
    "  <url>",
    `    <loc>${absolute(p.slug)}</loc>`,
    `    <lastmod>${day}</lastmod>`,
    `    <priority>${p.app ? "1.0" : "0.8"}</priority>`,
    "  </url>",
  ].join("\n")).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
};

const robots = () => `# ${site.siteName}
# Everything here is public and static. There is no user data behind any of it —
# documents live in each visitor's own browser, never on this server.

User-agent: *
Allow: /

# The admin panel is a private usage dashboard, not a page to land on. This
# keeps it out of search results. It is not access control — see /admin/#/settings.
Disallow: ${base}admin/

Sitemap: ${absolute("sitemap.xml")}
`;

const llms = () => `# ${site.siteName}

> A free, offline-first web app for creating business documents — proforma
> invoices, purchase orders, quotations, tax invoices and delivery notes — with
> PDF, PNG, print and WhatsApp output. It runs entirely in the browser: no
> account, no server, no database. Everything a user enters is stored in their
> own browser's localStorage, on their own device.

Built and used mainly for small trading and manufacturing businesses. Currency
and tax defaults lean towards Nepal (NPR, PAN, 13% VAT) but nothing is hardcoded
to one country.

## Pages

${contentPages().map((p) => `- [${p.nav}](${absolute(p.slug)}): ${p.description}`).join("\n")}
- [The app itself](${absolute("")}): the tool, which is what the site is for.

## What it does

- Five document types (proforma invoice, purchase order, quotation, tax invoice,
  delivery note), each with its own number series, format and validity default.
- Quotations convert into proforma or tax invoices; tax invoices convert into
  delivery notes, carrying line items and discounts across.
- A customer list holding contacts, addresses and tax numbers, plus discount
  rules that attach to whole branches of the product category tree.
- A product catalogue with part numbers, units, rates, weights and HSN codes,
  a nested category tree, multi-select and bulk rate updates.
- A4 paginated preview that is the same layout used for the PDF, the PNG and
  the printer.
- CSV import and export for customers, products and documents, with a preview
  before anything is written.
- Backup and restore as a JSON file, or to a single file in the user's own
  Google Drive (drive.file scope — it can only see the file it created).

## Privacy

There is no backend. No analytics, no cookies, no tracking, no account. The two
things that can leave the device are a Google Drive backup and a WhatsApp share,
both only when the user starts them. See ${absolute("privacy/")}.

## Source

Zero dependencies, no framework, no build tooling beyond one Node script.
Source: https://github.com/shresthadeep77-wq/bizdoc
`;

/* -- run ------------------------------------------------------------------ */

const outputs = () => {
  const files = {
    "index.html": buildApp(),
    "404.html": notFoundPage(),
    "sitemap.xml": sitemap(),
    "robots.txt": robots(),
    "llms.txt": llms(),
    "lib/html2canvas.js": stripSourceMaps(read(path.join("vendor", "html2canvas.js"))) + "\n",
    "lib/jspdf.js": stripSourceMaps(read(path.join("vendor", "jspdf.js"))) + "\n",
    "admin/index.html": buildAdmin(),
  };
  contentPages().forEach((p) => { files[p.file] = buildPage(p); });
  return files;
};

const args = process.argv.slice(2);

if (args.includes("--single")) {
  const out = args[args.indexOf("--single") + 1] || "bizdoc-offline.html";
  const html = buildApp({ inlineLibs: true });
  fs.writeFileSync(path.join(ROOT, out), html);
  console.log(`built ${out} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB, fully self-contained)`);
  process.exit(0);
}

const files = outputs();

if (args.includes("--check")) {
  // The sitemap carries today's date, so comparing it byte for byte would fail
  // every day whether or not anything changed. Compare it with the date lines
  // taken out of both sides.
  const undated = (s) => s.replace(/^\s*<lastmod>.*<\/lastmod>\n/gm, "");
  const stale = Object.keys(files).filter((rel) => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return true;
    const current = fs.readFileSync(abs, "utf8");
    return rel === "sitemap.xml"
      ? undated(current) !== undated(files[rel])
      : current !== files[rel];
  });
  if (stale.length) {
    console.error("Out of date — run: node build.js\n  " + stale.join("\n  "));
    process.exit(1);
  }
  console.log(`up to date (${Object.keys(files).length} files)`);
  process.exit(0);
}

let total = 0;
Object.keys(files).forEach((rel) => {
  const abs = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, files[rel]);
  total += Buffer.byteLength(files[rel]);
});

const kb = (rel) => (Buffer.byteLength(files[rel]) / 1024).toFixed(0) + " KB";
console.log(`built ${Object.keys(files).length} files (${(total / 1024).toFixed(0)} KB total)`);
console.log(`  ${"index.html".padEnd(22)}${kb("index.html")}   loaded every visit`);
console.log(`  ${"lib/".padEnd(22)}${((Buffer.byteLength(files["lib/jspdf.js"]) + Buffer.byteLength(files["lib/html2canvas.js"])) / 1024).toFixed(0)} KB   only when exporting`);
contentPages().forEach((p) => console.log(`  ${p.file.padEnd(22)}${kb(p.file)}`));
console.log(`  ${"admin/index.html".padEnd(22)}${kb("admin/index.html")}   private, noindex`);
