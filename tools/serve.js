#!/usr/bin/env node
/**
 * Serves the built site the way GitHub Pages does: under /bizdoc/, with the
 * custom 404 page. No dependencies.
 *
 *   node tools/serve.js [port]        default 8080 → http://localhost:8080/bizdoc/
 *
 * Opening index.html straight from disk still works for everything except
 * Google sign-in, which has to return to a real http(s) address — and that
 * address must be in Supabase's redirect allow-list (see SUPABASE_SETUP.md).
 * Serving under the same /bizdoc/ path as production also catches anything
 * that would only break once deployed under a subpath.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BASE = "/bizdoc/";
const port = Number(process.argv[2]) || 8080;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8",
};

const send = (res, status, file) => {
  res.writeHead(status, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(file).pipe(res);
};

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/" || url.pathname === "/bizdoc") { res.writeHead(302, { Location: BASE }); res.end(); return; }
  if (!url.pathname.startsWith(BASE)) { send(res, 404, path.join(ROOT, "404.html")); return; }
  let rel = decodeURIComponent(url.pathname.slice(BASE.length));
  let file = path.normalize(path.join(ROOT, rel));
  // Never serve outside the repo, nor the parts GitHub Pages would not have.
  if (!file.startsWith(ROOT) || /(^|[\\/])\.(git|cache|env)/.test(path.relative(ROOT, file))) { send(res, 404, path.join(ROOT, "404.html")); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file)) { send(res, 404, path.join(ROOT, "404.html")); return; }
  send(res, 200, file);
}).listen(port, () => console.log(`Serving ${ROOT}\n  → http://localhost:${port}${BASE}`));
