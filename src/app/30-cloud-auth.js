// ==================== CLOUD — ACCOUNT, SESSION, SYNC LOOP ====================
// Optional Google sign-in through Supabase Auth, and the loop that keeps the
// signed-in account's data in step with the cloud (rules in 29-cloud-sync-core).
//
// Nothing here runs for someone who never signs in: the Supabase library is
// fetched from lib/ only when a sign-in starts, or when this browser already
// holds a signed-in account. The service worker caches it with the app, so a
// signed-in device still opens — and keeps working — with no connection.
//
// The session itself (access and refresh tokens) is stored and refreshed by
// supabase-js under AUTH_STORAGE_KEY; this code never reads or copies tokens.
// CLOUD_CONFIG comes from the build (src/cloud.config.json) and holds only the
// project URL and the publishable key, both of which are public by design —
// what protects the data is Row Level Security in the database.

const AUTH_STORAGE_KEY = "bizdoc-auth";
const SYNC_META_PREFIX = "pipomaker_sync:";
const AUTH_RETURN_KEY = "bizdoc_auth_return";
const AUTH_URL_PARAMS = ["code", "error", "error_code", "error_description", "state"];
const SYNC_BACKOFF_MS = [5000, 15000, 60000, 180000, 300000];
const SYNC_IDLE_MS = 5 * 60 * 1000;     // look for other devices' changes this often
const SYNC_PENDING_MS = 30 * 1000;      // retry pending uploads this often

const cloud = {
  client: null,
  clientPromise: null,
  // local    signed out — the app as it always was
  // starting signed in on this device, session not yet confirmed
  // ready    session confirmed, syncing
  // expired  this device still shows the account's data, but the session
  //          ended; nothing uploads until they sign in again
  // blocked  another tab switched account; this tab stops touching the cloud
  state: cloudAccount ? "starting" : "local",
  phase: "idle",          // idle | syncing
  online: true,           // did the last attempt reach Supabase?
  error: null,            // last sync failure that was not just "offline"
  meta: null,             // sync state for the signed-in account (see 29-cloud-sync-core)
  gen: 0,                 // bumped on every account switch; stale syncs see it and stop
  timer: null,
  backoff: 0,
  rerun: false,
  quiet: false,           // set while sync itself saves, so it does not re-trigger
  progress: null,
};

const cloudConfigured = () => typeof CLOUD_CONFIG === "object" && !!(CLOUD_CONFIG.url && CLOUD_CONFIG.publishableKey);
// OAuth has to come back to a real web address; a file:// copy cannot sign in.
const cloudSupportedHere = () => location.protocol === "https:" || location.protocol === "http:";

const loadSyncMeta = (userId) => {
  try { return normalizeSyncMeta(JSON.parse(localStorage.getItem(SYNC_META_PREFIX + userId)), userId); }
  catch (e) { return emptySyncMeta(userId); }
};
const saveSyncMeta = () => {
  if (!cloud.meta) return;
  try { localStorage.setItem(SYNC_META_PREFIX + cloud.meta.userId, JSON.stringify(cloud.meta)); }
  catch (e) { console.error("Could not save sync state:", e); }
};
if (cloudAccount) cloud.meta = loadSyncMeta(cloudAccount.id);

const storeAccount = (acct) => {
  try {
    if (acct) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(acct));
    else localStorage.removeItem(ACCOUNT_KEY);
  } catch (e) { /* the in-memory account still applies for this visit */ }
};

const accountFromUser = (user) => {
  const m = user.user_metadata || {};
  return {
    id: user.id,
    email: user.email || m.email || "",
    name: m.full_name || m.name || "",
    avatar: m.avatar_url || m.picture || "",
  };
};

// Added to "replace all data" confirmations: while signed in, replacing the
// data here also replaces it in the account, on every device.
const cloudReplaceNote = () => (cloudAccount
  ? ` Because you're signed in as ${cloudAccount.email || "your account"}, this also replaces the data in your account on every device.`
  : "");

// ---- the Supabase client ------------------------------------------------------

const cloudClient = () => {
  if (cloud.client) return Promise.resolve(cloud.client);
  if (!cloud.clientPromise) {
    cloud.clientPromise = (window.supabase ? Promise.resolve() : loadScriptOnce("lib/supabase.js")).then(() => {
      if (!window.supabase || !window.supabase.createClient) throw new Error("Sign-in library did not load");
      cloud.client = window.supabase.createClient(CLOUD_CONFIG.url, CLOUD_CONFIG.publishableKey, {
        auth: {
          flowType: "pkce",
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          // Every site under the same github.io name shares one origin, so the
          // default key name is not ours alone to assume.
          storageKey: AUTH_STORAGE_KEY,
        },
      });
      return cloud.client;
    });
    cloud.clientPromise.catch(() => { cloud.clientPromise = null; });
  }
  return cloud.clientPromise;
};

const cloudError = (error, status) => {
  const msg = String((error && error.message) || error || "Sync failed");
  const e = new Error(msg);
  const code = error && error.code;
  if (!status && !code) e.network = true;
  else if (status === 401 || code === "PGRST301" || code === "PGRST303" || code === "42501" && /signed in/i.test(msg)) e.auth = true;
  else if (code === "PGRST202" || code === "PGRST205" || code === "42883" || code === "42P01") {
    e.message = "The BizDoc tables aren't set up in Supabase yet. Run the migration in supabase/migrations (see SUPABASE_SETUP.md).";
  }
  return e;
};

const cloudApi = {
  pull: async (table, since, after, limit) => {
    const { data, error, status } = await cloud.client.rpc("bizdoc_pull", { p_table: table, p_since: since, p_after: after, p_limit: limit });
    if (error) throw cloudError(error, status);
    return Array.isArray(data) ? data : [];
  },
  push: async (table, ops) => {
    const { data, error, status } = await cloud.client.rpc("bizdoc_push", { p_table: table, p_ops: ops });
    if (error) throw cloudError(error, status);
    return Array.isArray(data) ? data : [];
  },
};

// ---- coming back from Google ----------------------------------------------------

// Supabase sends the browser back with ?code=… (or ?error=…) on the app's own
// address. Older/implicit flows use the fragment instead, which the app also
// uses for its routes (#/products), so only a fragment that is clearly not a
// route counts.
const readAuthReturn = () => {
  const q = new URLSearchParams(location.search);
  const h = (location.hash && !location.hash.startsWith("#/")) ? new URLSearchParams(location.hash.slice(1)) : new URLSearchParams();
  const pick = (k) => q.get(k) || h.get(k);
  if (!pick("code") && !pick("error") && !pick("error_description") && !h.get("access_token")) return null;
  return { code: pick("code"), error: pick("error"), errorCode: pick("error_code"), description: pick("error_description") };
};

const cleanAuthReturn = () => {
  const url = new URL(location.href);
  AUTH_URL_PARAMS.forEach(p => url.searchParams.delete(p));
  if (url.hash && !url.hash.startsWith("#/")) url.hash = "";
  let back = null;
  try { back = JSON.parse(sessionStorage.getItem(AUTH_RETURN_KEY) || "null"); sessionStorage.removeItem(AUTH_RETURN_KEY); } catch (e) { /* ignore */ }
  if (back && back.hash && !url.hash) url.hash = back.hash;
  history.replaceState(history.state, "", url.toString());
  const tab = tabFromHash();
  if (tab !== currentTab) { currentTab = tab; render(); }
};

const explainAuthError = (ret) => {
  const d = String((ret && (ret.description || ret.error)) || "");
  let msg;
  if (/access_denied|cancel/i.test(d + (ret.error || ""))) msg = "Sign-in was cancelled. Nothing changed — you're still using this device's data.";
  else if (/code verifier|flow state|both auth code and code verifier/i.test(d)) msg = "That sign-in link was started in a different browser or has expired. Please sign in again from here.";
  else if (/provider is not enabled|unsupported provider/i.test(d)) msg = "Google sign-in isn't switched on for this app yet.";
  else msg = "Sign-in didn't complete" + (d ? `: ${d}` : ".");
  toast(msg, "err", 7000);
};

// ---- starting up ---------------------------------------------------------------

let cloudBooting = null;
const cloudBoot = () => {
  if (!cloudBooting) cloudBooting = cloudBootOnce().finally(() => { cloudBooting = null; });
  return cloudBooting;
};

const cloudBootOnce = async () => {
  if (!cloudConfigured() || !cloudSupportedHere()) return;
  const ret = readAuthReturn();
  if (!ret && !cloudAccount) return;         // never signed in here: load nothing
  if (cloud.client && !ret) return;           // already running

  let sb;
  try { sb = await cloudClient(); }
  catch (e) {
    // Offline, and the library was never cached. The account's data is
    // already on screen; try again when the connection comes back.
    cloud.online = false;
    if (ret) { cleanAuthReturn(); toast("Couldn't reach the sign-in service. Check your connection and try again.", "err", 6000); }
    cloudUpdateUI();
    return;
  }

  const { error: initError } = await sb.auth.initialize();
  let session = null;
  try { ({ data: { session } } = await sb.auth.getSession()); } catch (e) { /* treated as no session */ }

  if (ret) {
    cleanAuthReturn();
    if (ret.error || ret.description) explainAuthError(ret);
    else if (initError && !session) explainAuthError({ description: initError.message });
  }

  sb.auth.onAuthStateChange((event, s) => {
    // Never await Supabase calls inside this callback (it holds the auth
    // lock); hand off to a fresh task instead.
    setTimeout(() => cloudOnAuthEvent(event, s), 0);
  });

  cloudAdoptSession(session, { boot: true, justSignedIn: !!(ret && session && !ret.error) });
};

const cloudAdoptSession = (session, { boot = false, justSignedIn = false } = {}) => {
  if (session && session.user) {
    const acct = accountFromUser(session.user);
    if (!cloudAccount || cloudAccount.id !== acct.id) {
      // At start-up nothing is open yet, so switching is safe. Later, a
      // different account appearing means another tab signed in.
      if (!boot) { cloudBlockTab(); return; }
      switchAccount(acct);
    } else {
      cloudAccount = acct;
      storeAccount(acct);
    }
    cloud.state = "ready";
    if (justSignedIn) toast(`Signed in as ${acct.email || acct.name}`, "ok", 3500);
    cloudRequestSync(0);
  } else if (cloudAccount) {
    cloud.state = "expired";
  }
  cloudUpdateUI();
};

const cloudOnAuthEvent = (event, session) => {
  if (cloud.state === "blocked") return;
  if (event === "INITIAL_SESSION") return;    // already handled by cloudBoot
  if (event === "SIGNED_OUT") {
    if (cloudAccount) { cloud.state = "expired"; cloudUpdateUI(); }
    return;
  }
  if (session && session.user) {
    if (!cloudAccount || cloudAccount.id !== session.user.id) { cloudBlockTab(); return; }
    const wasExpired = cloud.state !== "ready";
    cloud.state = "ready";
    if (wasExpired) cloudRequestSync(0);
    cloudUpdateUI();
  }
};

// Another tab signed in or out. Two tabs on two accounts would each be
// uploading into whichever account the other last chose, so this tab stops
// syncing and asks to be reloaded.
window.addEventListener("storage", (e) => {
  if (e.key !== ACCOUNT_KEY || cloud.state === "blocked") return;
  const now = readStoredAccount();
  if ((now && now.id) !== (cloudAccount && cloudAccount.id)) cloudBlockTab();
});

const cloudBlockTab = () => {
  cloud.state = "blocked";
  cloud.gen++;
  clearTimeout(cloud.timer);
  cloudUpdateUI();
  openAccountChangedModal();
};

// ---- switching whose data is on screen ------------------------------------------

const switchAccount = (acct) => {
  clearTimeout(cloud.timer);
  cloud.gen++;
  cloud.phase = "idle";
  // Whatever the current account had is written to its own key first.
  cloud.quiet = true;
  saveDB();
  cloud.quiet = false;
  // Nothing from the previous account may carry over: no open popup, no
  // half-built document, and no "Undo" that would put a deleted record back
  // into the wrong account's list.
  modalStack = [];
  modalHistoryPushed = false;
  docBuilder = null;
  if (undoTimer) clearTimeout(undoTimer);
  document.querySelectorAll(".toast").forEach(t => t.remove());

  cloudAccount = acct;
  storeAccount(acct);
  cloud.meta = acct ? loadSyncMeta(acct.id) : null;
  cloud.error = null;
  cloud.backoff = 0;
  db = loadDB();
  cloud.quiet = true;
  saveDB();
  cloud.quiet = false;
  render();
};

// ---- sign in / sign out -----------------------------------------------------------

const cloudRedirectUrl = () => location.origin + location.pathname;

const cloudSignIn = async (btn) => {
  if (!cloudConfigured()) { toast("Cloud sign-in isn't set up in this build.", "err", 5000); return; }
  if (!cloudSupportedHere()) {
    toast("Sign-in needs the app opened from its web address, not from a saved file.", "err", 6000);
    return;
  }
  const busy = btnBusy(btn, "Opening Google…");
  try {
    // Ask first whether Google is switched on. Otherwise a disabled provider
    // sends the browser to a bare JSON error page with no way back.
    let settings = null;
    try {
      const r = await fetch(CLOUD_CONFIG.url + "/auth/v1/settings", { headers: { apikey: CLOUD_CONFIG.publishableKey } });
      settings = await r.json();
    } catch (e) {
      throw new Error("Can't reach the sign-in service. Check your internet connection and try again.");
    }
    if (!settings || !settings.external || !settings.external.google) {
      throw new Error("Google sign-in isn't switched on for this app yet.");
    }
    const sb = await cloudClient();
    try {
      sessionStorage.setItem(AUTH_RETURN_KEY, JSON.stringify({ hash: location.hash.startsWith("#/") ? location.hash : "" }));
    } catch (e) { /* only costs returning to the home tab */ }
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: cloudRedirectUrl(),
        // Always show Google's account chooser, so switching accounts works.
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) throw error;
    // The browser is leaving for Google; leave the spinner up.
  } catch (e) {
    busy.done();
    toast(e.message || "Sign-in failed", "err", 6000);
  }
};

const clearAuthStorage = () => {
  try {
    Object.keys(localStorage).forEach(k => {
      if (k === AUTH_STORAGE_KEY || k.startsWith(AUTH_STORAGE_KEY + "-")) localStorage.removeItem(k);
    });
  } catch (e) { /* nothing more to do */ }
};

// Signs out on this device only. `erase` also removes this account's copy and
// its unsent changes from this browser.
const cloudSignOut = async ({ erase = false } = {}) => {
  const acct = cloudAccount;
  if (!acct) return;
  clearTimeout(cloud.timer);
  cloud.gen++;
  try {
    if (cloud.client) {
      const { error } = await cloud.client.auth.signOut({ scope: "local" });
      // Offline, supabase-js keeps the session when it cannot reach the
      // server. Signing out of this device must still work offline.
      if (error) clearAuthStorage();
    } else {
      clearAuthStorage();
    }
  } catch (e) { clearAuthStorage(); }
  cloud.state = "local";
  switchAccount(null);
  if (erase) {
    try {
      localStorage.removeItem(ACCOUNT_DB_PREFIX + acct.id);
      localStorage.removeItem(SYNC_META_PREFIX + acct.id);
    } catch (e) { /* ignore */ }
  }
  toast(erase ? "Signed out and removed from this device" : "Signed out — showing this device's own data", "ok", 3500);
};

// ---- the sync loop -----------------------------------------------------------------

// Working out what is pending hashes every record, and the status button asks
// on every redraw. Every change to db or sync state goes through saveDB, so
// the answer only needs recomputing after one.
let cloudDataGen = 0;
let cloudPendingCache = { gen: -1, db: null, value: null };
const cloudPending = () => {
  if (!cloudAccount || !cloud.meta) return { count: 0, byKind: {} };
  const c = cloudPendingCache;
  if (c.gen !== cloudDataGen || c.db !== db) {
    cloudPendingCache = { gen: cloudDataGen, db, value: pendingSummary(db, cloud.meta) };
  }
  return cloudPendingCache.value;
};

// Save db and sync state together, without the save re-triggering a sync.
const cloudPersist = () => {
  cloud.quiet = true;
  saveDB();
  cloud.quiet = false;
  saveSyncMeta();
};

const cloudRequestSync = (delay = 2000) => {
  if (cloud.state !== "ready") return;
  clearTimeout(cloud.timer);
  cloud.timer = setTimeout(() => cloudRunSync(), delay);
};

const cloudScheduleNext = () => {
  if (cloud.state !== "ready") return;
  let delay;
  if (!cloud.online || cloud.error) {
    delay = SYNC_BACKOFF_MS[Math.min(cloud.backoff, SYNC_BACKOFF_MS.length - 1)];
    cloud.backoff++;
  } else {
    delay = cloudPending().count ? SYNC_PENDING_MS : SYNC_IDLE_MS;
  }
  cloudRequestSync(delay);
};

const cloudRunSync = async () => {
  if (cloud.state !== "ready" || !cloud.client || !cloud.meta || !cloudAccount) return;
  if (cloud.phase === "syncing") { cloud.rerun = true; return; }
  const gen = cloud.gen, d = db, m = cloud.meta;
  const firstPull = !m.firstPullDone;
  cloud.phase = "syncing";
  cloudUpdateUI();
  let applied = 0;
  let renderNeeded = false;
  try {
    // Confirm who is actually signed in before sending anything: queued
    // changes belong to the account they were made under, and to no other.
    const { data: { session } } = await cloud.client.auth.getSession();
    if (gen !== cloud.gen) return;
    if (!session) { cloud.state = "expired"; return; }
    if (session.user.id !== m.userId) { cloudBlockTab(); return; }

    if (ensureUids(d, m)) cloudPersist();
    for (let round = 0; round < 3; round++) {
      const got = await pullAll(d, m, cloudApi);
      if (gen !== cloud.gen) return;
      if (got) { applied += got; normalizeDB(d); }
      const stats = await pushAll(d, m, cloudApi, (done, total) => {
        cloud.progress = total > PUSH_CHUNK ? `${done}/${total}` : null;
        cloudUpdateUI();
      });
      if (gen !== cloud.gen) return;
      if (stats.renumbered || stats.conflicts) renderNeeded = true;
      cloudPersist();
      if (!stats.again) break;
      ensureUids(d, m);
    }
    m.lastSyncAt = new Date().toISOString();
    cloud.online = true;
    cloud.error = null;
    cloud.backoff = 0;
  } catch (e) {
    if (gen !== cloud.gen) return;
    if (e.network) cloud.online = false;
    else if (e.auth) cloud.state = "expired";
    else { cloud.online = true; cloud.error = e.message || "Sync failed"; }
    console.warn("Sync stopped:", e.message || e);
  } finally {
    if (gen === cloud.gen) {
      cloudPersist();
      cloud.phase = "idle";
      cloud.progress = null;
      // The first pull also redraws an empty account, so the welcome screen
      // stops saying "Loading your account…".
      if (applied || renderNeeded || (firstPull && m.firstPullDone && !d.businesses.length)) cloudRenderWhenIdle();
      cloudUpdateUI();
      if (m.firstPullDone && !m.migrationOffered) cloudMaybeOfferMigration();
      if (cloud.rerun) { cloud.rerun = false; cloudRequestSync(300); }
      else cloudScheduleNext();
    }
  }
};

// A remote change redraws the screen, but not under someone's fingers: a
// redraw rebuilds the page and would drop the field they are typing in. With
// a popup open, closing it redraws anyway.
let cloudRenderPending = false;
const cloudRenderWhenIdle = () => {
  if (modalStack.length) return;
  const a = document.activeElement;
  const typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && document.getElementById("app").contains(a);
  if (!typing) { render(); return; }
  if (cloudRenderPending) return;
  cloudRenderPending = true;
  a.addEventListener("blur", () => { cloudRenderPending = false; setTimeout(cloudRenderWhenIdle, 0); }, { once: true });
};

// Every local save: refresh the status soon, upload a little later so a burst
// of edits goes up together.
let cloudUiTimer = null;
onDBSaved = () => {
  cloudDataGen++;
  if (!cloudAccount || cloud.quiet) return;
  clearTimeout(cloudUiTimer);
  cloudUiTimer = setTimeout(cloudUpdateUI, 300);
  cloudRequestSync(2500);
};

// `online` only means a network interface is up, not that Supabase answers —
// so it is a hint to try now, and the attempt itself decides the status.
window.addEventListener("online", () => {
  if (!cloudAccount) return;
  cloud.backoff = 0;
  if (!cloud.client) cloudBoot();
  else cloudRequestSync(500);
});
window.addEventListener("offline", () => { if (cloudAccount) { cloud.online = false; cloudUpdateUI(); } });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || cloud.state !== "ready" || !cloud.meta) return;
  const last = cloud.meta.lastSyncAt ? Date.parse(cloud.meta.lastSyncAt) : 0;
  if (Date.now() - last > 60 * 1000) cloudRequestSync(500);
});

// ---- conflicts, migration ---------------------------------------------------------

const cloudResolve = (kind, uid, keep) => {
  if (!cloud.meta) return;
  if (keep === "local") resolveKeepLocal(db, cloud.meta, kind, uid);
  else resolveUseCloud(db, cloud.meta, kind, uid);
  normalizeDB(db);
  cloudPersist();
  if (keep !== "local") cloudRenderWhenIdle();
  cloudUpdateUI();
  cloudRequestSync(300);
};

// This device's signed-out data, if there is any worth offering.
const deviceLocalData = () => {
  const d = readDBAt(DB_KEY);
  return d.businesses.length ? d : null;
};

const cloudMaybeOfferMigration = () => {
  const m = cloud.meta;
  if (!m || m.migrationOffered) return;
  if (!deviceLocalData()) { m.migrationOffered = true; saveSyncMeta(); return; }
  // Wait for a quiet moment rather than stacking a question on top of work.
  if (modalStack.length) return;
  openMigrationModal();
};

const cloudMergeDeviceData = () => {
  const local = deviceLocalData();
  if (!local || !cloud.meta) return null;
  const counts = mergeIntoAccount(db, cloud.meta, local);
  cloud.meta.migrationOffered = true;
  normalizeDB(db);
  saveDB();          // through the hook, so the upload is scheduled
  saveSyncMeta();
  render();
  cloudRequestSync(300);
  return counts;
};
