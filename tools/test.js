#!/usr/bin/env node
/**
 * Runs every check, in order, and stops at the first failure.
 *
 *   node tools/test.js       (or: npm test)
 *
 *   1. the build is up to date with src/
 *   2. the money and VAT arithmetic
 *   3. the printed document, in a real browser
 *   4. the screens at phone, tablet and laptop widths
 *   5. every internal link and the sitemap
 *   6. the cloud sync rules (fake server)
 *   7. sign-in states and offline account data, in a real browser
 *
 * The database's Row Level Security has its own runner, tools/test-rls.mjs,
 * because it needs PGlite installed first (see SUPABASE_SETUP.md).
 *
 * Checks 3 and 4 need Edge or Chrome; they skip themselves if neither is here.
 */
const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const STEPS = [
  ["The built files match src/", ["build.js", "--check"]],
  ["Money and VAT arithmetic", ["tools/test-money.js"]],
  ["The printed document", ["tools/test-document.js"]],
  ["Screens at every width", ["tools/test-responsive.js"]],
  ["Links and the sitemap", ["tools/test-links.js"]],
  ["Cloud sync rules", ["tools/test-sync.js"]],
  ["Sign-in and sync in a real browser", ["tools/test-browser.mjs"]],
];

let failed = 0;
for (const [name, args] of STEPS) {
  process.stdout.write(`\n• ${name}\n  `);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) {
    failed++;
    console.error(`\n  ✗ ${name} failed.`);
    break; // a later check on a broken build only produces noise
  }
}

if (failed) {
  console.error("\nSomething is wrong — see above.");
  process.exit(1);
}
console.log("\nEverything passed.\n");
