#!/usr/bin/env node
/**
 * Bundles src/ back into a single self-contained index.html.
 *
 * The app ships as one file so it runs offline, installs as a PWA, and works
 * straight off GitHub Pages or a file:// path. Source lives split up under
 * src/ purely for editing; this script is the only build step.
 *
 *   node build.js          build ./index.html
 *   node build.js --check  verify ./index.html matches src/ (exit 1 if stale)
 *
 * No dependencies, no install.
 */
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "src");
const OUT = path.join(__dirname, "index.html");

const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

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

const build = () => {
  const parts = {
    "styles.css": () => read("styles.css").trimEnd(),
    "vendor/qrcode.js": () => read(path.join("vendor", "qrcode.js")).trimEnd(),
    "vendor/html2canvas.js": () => read(path.join("vendor", "html2canvas.js")).trimEnd(),
    "vendor/jspdf.js": () => read(path.join("vendor", "jspdf.js")).trimEnd(),
    "pwa.js": () => read("pwa.js").trimEnd(),
    "app/*": () => appOrder()
      .map((f) => read(path.join("app", f)).trimEnd())
      .join("\n\n"),
  };

  const shell = read("index.html");
  const out = shell.replace(/<!--include:(.+?)-->/g, (_, key) => {
    const fn = parts[key];
    if (!fn) throw new Error(`Unknown include in src/index.html: ${key}`);
    return fn();
  });

  const left = out.match(/<!--include:.+?-->/);
  if (left) throw new Error(`Unresolved include: ${left[0]}`);
  return out;
};

const out = build();

if (process.argv.includes("--check")) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (current !== out) {
    console.error("index.html is out of date — run: node build.js");
    process.exit(1);
  }
  console.log("index.html is up to date");
} else {
  fs.writeFileSync(OUT, out);
  const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
  console.log(`built index.html (${kb} KB)`);
}
