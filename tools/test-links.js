#!/usr/bin/env node
/**
 * Checks that every internal link, image and script reference in the built site
 * points at something that actually exists, and that the sitemap matches.
 *
 *   node tools/test-links.js
 *
 * No browser needed. A link that 404s is invisible until someone clicks it, and
 * the pages are generated, so a typo in pages.json breaks several at once.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "site", "pages.json"), "utf8"));
const BASE = SITE.base; // e.g. "/bizdoc/"

const failures = [];
let checked = 0;

// Every HTML file the build produces, and where it sits relative to the root.
const htmlFiles = ["index.html", "404.html", "admin/index.html"]
  .concat(SITE.pages.filter((p) => p.slug).map((p) => p.slug.replace(/\/$/, "") + "/index.html"))
  .filter((f) => fs.existsSync(path.join(ROOT, f)));

// A URL that leaves the site, or is not a file at all, is not ours to check.
const isExternal = (url) =>
  /^(https?:|mailto:|tel:|data:|blob:|javascript:|#)/i.test(url);

// Turn an href as written in a page into a path on disk. `fromFile` is the page
// the link is written in, because "../products/" means something different
// depending on which folder you are standing in.
const resolveTarget = (url, fromFile) => {
  let u = url.split("#")[0].split("?")[0];
  if (!u) return null;
  let base;
  if (u.startsWith(BASE)) { u = u.slice(BASE.length); base = ROOT; }     // "/bizdoc/products/"
  else if (u.startsWith("/")) { u = u.slice(1); base = ROOT; }           // site-absolute
  else base = path.dirname(path.join(ROOT, fromFile || "index.html"));   // relative to the page
  if (u === "" || u.endsWith("/")) u += "index.html";                    // a directory means its index
  return path.resolve(base, u);
};

htmlFiles.forEach((file) => {
  const html = fs.readFileSync(path.join(ROOT, file), "utf8");
  const refs = [];
  // href/src on real tags only — not the ones inside JavaScript strings, which
  // are built at runtime and may legitimately not exist on disk.
  const tagRe = /<(?:a|link|img|script|source)\b[^>]*?\b(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = tagRe.exec(html))) refs.push(m[1]);

  refs.forEach((url) => {
    if (isExternal(url)) return;
    const target = resolveTarget(url, file);
    if (!target) return;
    checked++;
    if (!fs.existsSync(target)) {
      failures.push(`${file} links to ${url} — no such file (${path.relative(ROOT, target).replace(/\\/g, "/")})`);
    }
  });
});

// The sitemap must list pages that exist, and must not miss any public page.
const sitemap = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
listed.forEach((loc) => {
  checked++;
  const target = resolveTarget(loc.replace(SITE.origin, ""), "index.html");
  if (!fs.existsSync(target)) failures.push(`sitemap.xml lists ${loc} — no such page`);
});
SITE.pages.filter((p) => p.slug && p.inSitemap !== false).forEach((p) => {
  checked++;
  const url = SITE.origin + BASE + p.slug;
  if (!listed.includes(url)) failures.push(`${p.slug} is a public page but is missing from sitemap.xml`);
});

// robots.txt must not disallow anything the sitemap is asking to have indexed.
const robots = fs.readFileSync(path.join(ROOT, "robots.txt"), "utf8");
robots.split("\n")
  .filter((l) => /^\s*Disallow:/i.test(l))
  .map((l) => l.split(":").slice(1).join(":").trim())
  .filter(Boolean)
  .forEach((rule) => {
    checked++;
    const blocked = listed.filter((loc) => loc.replace(SITE.origin, "").startsWith(rule));
    if (blocked.length) failures.push(`robots.txt disallows ${rule}, which blocks ${blocked.join(", ")} from the sitemap`);
  });

if (failures.length) {
  failures.forEach((f) => console.error("  ✗ " + f));
  console.error(`\n${failures.length} of ${checked} link checks FAILED.`);
  process.exit(1);
}
console.log(`All ${checked} link and sitemap checks passed.`);
