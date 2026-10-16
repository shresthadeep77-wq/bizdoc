#!/usr/bin/env node
/**
 * Smoke test of the built app in real headless Chrome/Edge, served under
 * /bizdoc/ like GitHub Pages. Drives the browser over the DevTools protocol
 * directly (Node 22+ has WebSocket built in), so there is nothing to install.
 *
 *   node build.js && node tools/test-browser.mjs [--shots <dir>]
 *
 * It cannot complete a Google sign-in — that needs a person and a Google
 * account — so it covers everything around it: the signed-out app is unchanged
 * and never loads the Supabase library, a signed-in device opens its own
 * account's data offline-style with no session, sign-out returns to the
 * device's data, an OAuth error return is explained and cleaned from the
 * address bar, the layout holds at phone width, and PDF export still loads.
 * Any uncaught error or console error on the page fails the run.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const shotsIdx = process.argv.indexOf("--shots");
const SHOTS = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const CANDIDATES = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
].filter(Boolean);
const chromePath = CANDIDATES.find((p) => existsSync(p));
if (!chromePath) { console.error("No Chrome/Edge found. Set CHROME=/path/to/browser."); process.exit(2); }

const PORT = 8000 + Math.floor(Math.random() * 900);
const DEBUG_PORT = 9300 + Math.floor(Math.random() * 600);
const BASE = `http://localhost:${PORT}/bizdoc/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, [join(ROOT, "tools", "serve.js"), String(PORT)], { stdio: "ignore" });
const profile = mkdtempSync(join(tmpdir(), "bizdoc-smoke-"));
const chrome = spawn(chromePath, [
  "--headless=new", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions", "about:blank",
], { stdio: "ignore" });

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failures++; };

const cleanup = () => {
  try { chrome.kill(); } catch (e) { /* ignore */ }
  try { server.kill(); } catch (e) { /* ignore */ }
  setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* locked on Windows; harmless */ } }, 500);
};

try {
  let pageWs = null;
  for (let i = 0; i < 50 && !pageWs; i++) {
    await sleep(200);
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) pageWs = page.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
  }
  if (!pageWs) throw new Error("Browser did not start");

  const ws = new WebSocket(pageWs);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const waiting = new Map();
  const listeners = [];
  const pageErrors = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { const { resolve, reject } = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); return; }
    if (msg.method === "Runtime.exceptionThrown") pageErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") pageErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") pageErrors.push(msg.params.entry.text + " " + (msg.params.entry.url || ""));
    listeners.forEach((fn) => fn(msg));
  };
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; waiting.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("evaluate: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const waitFor = async (expression, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { try { if (await evaluate(expression)) return true; } catch (e) { /* page mid-load */ } await sleep(100); }
    return false;
  };
  const navigate = async (url) => {
    const loaded = new Promise((r) => { const fn = (m) => { if (m.method === "Page.loadEventFired") { listeners.splice(listeners.indexOf(fn), 1); r(); } }; listeners.push(fn); });
    await cdp("Page.navigate", { url });
    await loaded;
    await sleep(300);
  };
  const shot = async (name) => {
    if (!SHOTS) return;
    const { data } = await cdp("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(SHOTS, name + ".png"), Buffer.from(data, "base64"));
  };
  const toastText = () => evaluate(`(document.querySelector(".toast") || {}).textContent || ""`);

  await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Log.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });

  // 1. First visit, signed out.
  await navigate(BASE);
  ok(await waitFor(`!!document.querySelector(".onboard")`), "first visit shows onboarding");
  ok(await evaluate(`[...document.querySelectorAll(".btn-google")].some(b => /Continue with Google/.test(b.textContent))`), "onboarding offers Google sign-in");
  await shot("1-onboarding");

  await evaluate(`(() => {
    const id = uid("biz");
    db.businesses.push({ id, name: "Smoke Test Co", currency: "NPR", taxRate: 13 });
    db.activeBusinessId = id; db = normalizeDB(db); saveDB(); render(); return true; })()`);
  ok(await evaluate(`document.getElementById("cloudStatusBtn")?.textContent.includes("Sign in")`), "topbar shows a Sign in button when signed out");
  ok(await evaluate(`!performance.getEntriesByType("resource").some(e => /supabase\\.js/.test(e.name)) && typeof window.supabase === "undefined"`),
    "signed-out visit never downloads the Supabase library");
  await shot("2-signed-out-desktop");

  // 2. Account panel and the disabled-provider guard (only while Google is off).
  await evaluate(`document.getElementById("cloudStatusBtn").click()`);
  ok(await waitFor(`document.getElementById("cloudPanel")?.textContent.includes("Optional")`), "account panel opens and explains sign-in is optional");
  await shot("3-account-panel-signed-out");
  const cfg = JSON.parse((await import("node:fs")).readFileSync(join(ROOT, "src", "cloud.config.json"), "utf8"));
  let googleOn = null;
  try { googleOn = !!(await (await fetch(cfg.url + "/auth/v1/settings", { headers: { apikey: cfg.publishableKey } })).json()).external.google; } catch (e) { /* offline */ }
  if (googleOn === false) {
    await evaluate(`document.querySelector("#cloudPanel .btn-google").click()`);
    ok(await waitFor(`(document.querySelector(".toast")||{}).textContent?.includes("isn't switched on")`), "with Google disabled in Supabase, sign-in explains instead of redirecting to an error page");
    ok(await evaluate(`location.href === ${JSON.stringify(BASE)}`), "…and the page did not navigate away");
  } else {
    console.log(`SKIP  disabled-provider guard (Google is ${googleOn ? "enabled" : "unreachable"})`);
  }
  await evaluate(`closeModal(); true`);

  // 3. Settings carries the same panel.
  await evaluate(`openSettingsModal(); [...document.querySelectorAll(".settings-side-item")].find(b => b.textContent.includes("Account & sync")).click(); true`);
  ok(await evaluate(`!!document.querySelector(".settings-content #cloudPanel")`), "Settings → Account & sync shows the panel");
  await evaluate(`closeModal(); true`);

  // 4. A device that was signed in: its account's data, not the device's, even with no session.
  const uid = "00000000-0000-4000-8000-0000000000aa";
  await evaluate(`localStorage.setItem("pipomaker_account", JSON.stringify({ id: "${uid}", email: "smoke@example.invalid", name: "Smoke Tester" }));
    localStorage.setItem("pipomaker_v1:user:${uid}", JSON.stringify({ businesses: [{ id: 1, name: "Account Co" }], activeBusinessId: 1 })); true`);
  await navigate(BASE);
  ok(await evaluate(`db.businesses[0]?.name === "Account Co"`), "signed-in device opens its account's own data");
  ok(await evaluate(`JSON.parse(localStorage.getItem("pipomaker_v1")).businesses[0].name === "Smoke Test Co"`), "the device's signed-out data is untouched");
  ok(await waitFor(`typeof window.supabase === "object" && cloud.state === "expired"`), "loads the library and, with no session, reports the sign-in ended");
  ok(await evaluate(`document.getElementById("cloudStatusBtn").textContent.includes("Sign in again")`), "topbar says Sign in again");
  await evaluate(`db.products.push({ id: uid("prod"), businessId: 1, description: "Offline edit", rate: 113 }); saveDB(); true`);
  ok(await evaluate(`cloudPending().count >= 2 && cloudStatus().detail.includes("not yet in your account")`), "edits are kept and shown as not yet uploaded (never as synced)");
  await shot("4-signed-in-expired");

  // 5. Sign out: back to the device's own data; the account copy is kept unless asked.
  await evaluate(`cloudSignOut().then(() => true)`);
  ok(await evaluate(`db.businesses[0]?.name === "Smoke Test Co" && !localStorage.getItem("pipomaker_account")`), "sign-out shows the device's data again");
  ok(await evaluate(`!!localStorage.getItem("pipomaker_v1:user:${uid}")`), "…and keeps the account's copy (with its unsent edit) for next time");
  ok(await evaluate(`!Object.keys(localStorage).some(k => k.startsWith("bizdoc-auth"))`), "…and no session is left in storage");

  // 6. Coming back from Google with an error.
  await navigate(BASE + "?error=access_denied&error_code=access_denied&error_description=The+user+cancelled#/products");
  ok(await waitFor(`(document.querySelector(".toast")||{}).textContent?.includes("cancelled")`), "a cancelled sign-in is explained");
  ok(await evaluate(`location.search === "" && location.hash === "#/products" && currentTab === "products"`), "…and the address bar is cleaned, keeping the route");

  // 7. Phone width.
  await cdp("Emulation.setDeviceMetricsOverride", { width: 375, height: 760, deviceScaleFactor: 2, mobile: true });
  await navigate(BASE);
  await sleep(300);
  ok(await evaluate(`document.documentElement.scrollWidth <= 375`), "no horizontal scroll at 375px (signed out)");
  await shot("5-mobile-signed-out");
  await evaluate(`localStorage.setItem("pipomaker_account", JSON.stringify({ id: "${uid}", email: "smoke@example.invalid", name: "Smoke Tester" })); true`);
  await navigate(BASE);
  await waitFor(`cloud.state === "expired"`);
  ok(await evaluate(`document.documentElement.scrollWidth <= 375`), "no horizontal scroll at 375px (signed in)");
  await shot("6-mobile-signed-in");
  await evaluate(`document.getElementById("cloudStatusBtn").click(); true`);
  await sleep(300);
  await shot("7-mobile-account-panel");
  await evaluate(`closeModal(); cloudSignOut().then(() => true)`);

  // 8. Existing features still load.
  ok(await evaluate(`ensurePdfLibs()`), "PDF export libraries still load");
  ok(await waitFor(`navigator.serviceWorker.ready.then(() => caches.keys()).then(k => k.includes("pipo-v5"))`, 10000), "service worker installed the new cache");
  ok(await waitFor(`caches.open("pipo-v5").then(c => c.match("lib/supabase.js")).then(r => !!r)`, 10000), "…with the Supabase library precached for offline sign-in");

  const relevant = pageErrors.filter((e) => !/favicon/.test(e));
  ok(relevant.length === 0, "no page errors" + (relevant.length ? ":\n      " + relevant.join("\n      ") : ""));
  ws.close();
} catch (e) {
  console.error("ERROR", e.message);
  failures++;
} finally {
  cleanup();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall browser checks passed");
process.exitCode = failures ? 1 : 0;
setTimeout(() => process.exit(process.exitCode), 800);
