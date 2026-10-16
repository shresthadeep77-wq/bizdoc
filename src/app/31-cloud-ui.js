// ==================== CLOUD — SCREENS ====================
// The topbar status button, the Account & sync panel (also a Settings
// section), conflict review, the "bring this device's data in" question and
// sign-out. The status shown is always the truth as far as this device knows
// it: "Synced" only after the server confirmed every change, never on the
// strength of a save that has only reached this browser.

const timeAgo = (iso) => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + "s")}`;

const pendingWords = (byKind) => SYNC_KINDS
  .filter(k => byKind[k.kind])
  .map(k => plural(byKind[k.kind], k.label.toLowerCase()))
  .join(", ");

// { key, label, detail } — key picks the colour: local ok pending sync offline warn error
const cloudStatus = () => {
  if (!cloudAccount) return { key: "local", label: "Sign in", detail: "Saved on this device only. Sign in to keep a private copy in your account and use it on other devices." };
  if (cloud.state === "blocked") return { key: "error", label: "Reload", detail: "You signed in or out in another tab. Reload this tab to carry on." };
  const p = cloudPending();
  const conflicts = cloud.meta ? cloud.meta.conflicts.length : 0;
  const failed = cloud.meta ? Object.keys(cloud.meta.failed).length : 0;
  const waiting = p.count ? `${plural(p.count, "change")} saved on this device, not yet in your account.` : "";
  if (cloud.state === "expired") return { key: "warn", label: "Sign in again", detail: "Your sign-in has ended. " + (waiting || "Everything here is kept.") + " Sign in again to sync." };
  if (cloud.state === "starting") return { key: "sync", label: "Connecting…", detail: waiting || "Checking your account." };
  if (cloud.phase === "syncing") return { key: "sync", label: cloud.progress ? `Syncing ${cloud.progress}` : "Syncing…", detail: waiting || "Checking for changes." };
  if (conflicts) return { key: "warn", label: `${conflicts} to review`, detail: `${plural(conflicts, "record")} changed both here and on another device. Choose which copy to keep.` };
  if (!cloud.online) return { key: "offline", label: p.count ? `Offline · ${p.count}` : "Offline", detail: waiting ? waiting + " They upload automatically when the connection is back." : "Everything was uploaded before the connection dropped." };
  if (cloud.error) return { key: "error", label: "Sync error", detail: cloud.error };
  if (failed) return { key: "error", label: `${failed} not uploaded`, detail: `${plural(failed, "record")} couldn't be uploaded. They are safe on this device — see below.` };
  if (p.count) return { key: "pending", label: `${p.count} to upload`, detail: waiting };
  return { key: "ok", label: "Synced", detail: "Every change is saved in your account." };
};

const CLOUD_ICON = "M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z";

const fillCloudButton = (btn) => {
  const st = cloudStatus();
  btn.className = "cloud-btn cloud-" + st.key;
  btn.title = st.detail;
  btn.setAttribute("aria-label", `${st.label}. ${st.detail}`);
  btn.innerHTML = "";
  if (cloudAccount && cloudAccount.avatar) {
    btn.appendChild(avatarEl(cloudAccount, "cloud-btn-avatar"));
  } else {
    const ico = document.createElement("span");
    ico.className = "cloud-btn-icon";
    ico.innerHTML = `<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="${CLOUD_ICON}"/></svg>`;
    btn.appendChild(ico);
  }
  btn.appendChild(el("span", { class: "cloud-dot", "aria-hidden": "true" }));
  btn.appendChild(el("span", { class: "cloud-btn-label" }, st.label));
};

const renderCloudButton = () => {
  const btn = el("button", { type: "button", id: "cloudStatusBtn", onclick: openAccountModal });
  fillCloudButton(btn);
  return btn;
};

// Status changes often (every save, every sync). Patch the pieces in place
// instead of redrawing the page under whatever the user is doing.
const cloudUpdateUI = () => {
  const btn = document.getElementById("cloudStatusBtn");
  if (btn) fillCloudButton(btn);
  const panel = document.getElementById("cloudPanel");
  if (panel) drawCloudPanel(panel);
  const conflicts = document.getElementById("cloudConflicts");
  if (conflicts) drawConflictList(conflicts);
};

const initialsOf = (acct) => ((acct.name || acct.email || "?").trim()[0] || "?").toUpperCase();

const avatarEl = (acct, cls) => {
  const fallback = () => el("span", { class: cls + " avatar-initial", "aria-hidden": "true" }, initialsOf(acct));
  if (!acct.avatar) return fallback();
  // Google serves profile pictures only without a referrer. Offline, the
  // picture cannot load at all, so fall back to an initial.
  const img = el("img", { class: cls, src: acct.avatar, alt: "", referrerpolicy: "no-referrer" });
  img.addEventListener("error", () => { if (img.parentNode) img.parentNode.replaceChild(fallback(), img); });
  return img;
};

const GOOGLE_G = '<svg viewBox="0 0 48 48" aria-hidden="true" width="18" height="18"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

const googleButton = () => {
  const b = el("button", { type: "button", class: "btn btn-google btn-full", onclick: (e) => cloudSignIn(e.currentTarget) });
  const g = document.createElement("span");
  g.className = "btn-google-g";
  g.innerHTML = GOOGLE_G;
  b.appendChild(g);
  b.appendChild(el("span", {}, "Continue with Google"));
  return b;
};

const cloudNote = (text) => el("div", { class: "cloud-note" }, text);

// ---- the panel ----------------------------------------------------------------

const drawCloudPanel = (box) => {
  box.innerHTML = "";

  if (!cloudAccount) {
    box.appendChild(el("div", { class: "cloud-lede" },
      "Sign in to keep a private copy of your businesses, customers, products and documents in your own account, and to pick up where you left off on another device."));
    if (!cloudConfigured()) {
      box.appendChild(cloudNote("Cloud sign-in isn't set up in this build of the app."));
    } else if (!cloudSupportedHere()) {
      box.appendChild(cloudNote("Sign-in needs the app opened from its web address. This copy was opened from a file on this device, so it can only save here."));
    } else {
      box.appendChild(googleButton());
    }
    box.appendChild(cloudNote("Optional. Without signing in, nothing changes: everything stays on this device, exactly as before, and works offline."));
    return;
  }

  const prof = el("div", { class: "cloud-profile" });
  prof.appendChild(avatarEl(cloudAccount, "cloud-avatar"));
  const who = el("div", { style: { minWidth: "0", flex: "1" } });
  who.appendChild(el("div", { class: "cloud-name" }, cloudAccount.name || cloudAccount.email));
  if (cloudAccount.name && cloudAccount.email) who.appendChild(el("div", { class: "cloud-email" }, cloudAccount.email));
  prof.appendChild(who);
  box.appendChild(prof);

  const st = cloudStatus();
  const card = el("div", { class: "cloud-status cloud-" + st.key, role: "status" });
  card.appendChild(el("div", { class: "cloud-status-label" }, el("span", { class: "cloud-dot", "aria-hidden": "true" }), st.label));
  card.appendChild(el("div", { class: "cloud-status-detail" }, st.detail));
  const p = cloudPending();
  if (p.count) card.appendChild(el("div", { class: "cloud-status-detail" }, "Waiting: " + pendingWords(p.byKind) + "."));
  card.appendChild(el("div", { class: "cloud-status-meta" }, "Last synced: " + timeAgo(cloud.meta && cloud.meta.lastSyncAt)));
  box.appendChild(card);

  const failed = cloud.meta ? Object.entries(cloud.meta.failed) : [];
  if (failed.length) {
    const list = el("ul", { class: "cloud-failed" });
    failed.slice(0, 8).forEach(([key, f]) => {
      const [kind, uid] = key.split(":");
      const rec = (db[kind] || []).find(r => r._uid === uid);
      list.appendChild(el("li", {}, el("strong", {}, recordLabel(kind, rec)), " — " + f.message));
    });
    if (failed.length > 8) list.appendChild(el("li", {}, `…and ${failed.length - 8} more`));
    box.appendChild(list);
  }

  const actions = el("div", { class: "cloud-actions" });
  if (cloud.state === "expired") {
    actions.appendChild(googleButton());
  } else if (cloud.state === "blocked") {
    actions.appendChild(el("button", { class: "btn btn-primary btn-full", onclick: () => location.reload() }, "Reload this tab"));
  } else {
    if (cloud.meta && cloud.meta.conflicts.length) {
      actions.appendChild(el("button", { class: "btn btn-primary btn-full", onclick: openConflictsModal },
        `Review ${plural(cloud.meta.conflicts.length, "conflict")}`));
    }
    const syncBtn = el("button", { class: "btn btn-secondary btn-full", disabled: cloud.phase === "syncing" || cloud.state !== "ready",
      onclick: () => { cloud.backoff = 0; cloudRequestSync(0); } }, cloud.phase === "syncing" ? "Syncing…" : "Sync now");
    actions.appendChild(syncBtn);
  }
  if (deviceLocalData() && cloud.state !== "blocked") {
    actions.appendChild(el("button", { class: "btn btn-secondary btn-full", onclick: openMigrationModal },
      "Add this device's signed-out data to my account"));
  }
  actions.appendChild(el("button", { class: "btn btn-secondary btn-full", onclick: openSignOutModal }, "Sign out"));
  box.appendChild(actions);

  box.appendChild(cloudNote("Your records are private to this account: the database only ever returns them to you. A copy stays on this device so the app keeps working offline; changes upload when there is a connection."));
};

const renderCloudPanel = () => {
  const box = el("div", { id: "cloudPanel", class: "cloud-panel" });
  drawCloudPanel(box);
  return box;
};
// Same panel, as a Settings section.
const renderSettingsAccount = () => renderCloudPanel();

const openAccountModal = () => {
  if (cloudAccount && cloud.state === "ready") cloudRequestSync(0);
  openModal("Account & sync", renderCloudPanel(), { guard: false });
};

// ---- conflicts ------------------------------------------------------------------

const recordLabel = (kind, rec) => {
  if (!rec) return SYNC_KIND[kind] ? SYNC_KIND[kind].label : "Record";
  if (kind === "businesses") return rec.name || "Business";
  if (kind === "customers") return rec.companyName || rec.contactName || "Customer";
  if (kind === "products") return rec.description || rec.partNumber || "Product";
  if (kind === "documents") {
    const t = (typeof DOC_TYPES === "object" && DOC_TYPES[rec.type]) ? DOC_TYPES[rec.type].shortLabel : "Document";
    return `${t} ${rec.number ? "#" + rec.number : ""}`.trim();
  }
  return "Record";
};

const humanField = (k) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());

const changedFields = (kind, a, b) => {
  if (!a || !b) return [];
  const x = cloudView(kind, a), y = cloudView(kind, b);
  return [...new Set([...Object.keys(x), ...Object.keys(y)])]
    .filter(k => k !== "_uid" && canonJSON(x[k]) !== canonJSON(y[k]));
};

const drawConflictList = (box) => {
  box.innerHTML = "";
  const list = cloud.meta ? cloud.meta.conflicts : [];
  if (!list.length) {
    box.appendChild(el("div", { class: "picker-empty" }, "Nothing left to review. Every record agrees with your account."));
    return;
  }
  box.appendChild(el("div", { class: "cloud-lede" },
    "These were changed on this device and somewhere else before the two could sync. Nothing has been overwritten. Pick the copy to keep for each one."));
  list.forEach(c => {
    const local = (db[c.kind] || []).find(r => r._uid === c.uid) || null;
    const remote = c.remote && !c.remote.deleted ? recordFromRow(c.remote) : null;
    const row = el("div", { class: "cloud-conflict" });
    row.appendChild(el("div", { class: "cloud-conflict-title" },
      `${SYNC_KIND[c.kind].label}: ${recordLabel(c.kind, local || remote)}`));
    row.appendChild(el("div", { class: "cloud-conflict-sides" },
      el("div", {}, el("strong", {}, "This device: "), local ? "edited" : "deleted"),
      el("div", {}, el("strong", {}, "Your account: "),
        !c.remote ? "no longer exists" : c.remote.deleted ? "deleted" : "edited " + timeAgo(c.remote.updated_at))));
    const fields = changedFields(c.kind, local, remote);
    if (fields.length) {
      row.appendChild(el("div", { class: "cloud-conflict-fields" },
        "Differs in: " + fields.slice(0, 6).map(humanField).join(", ") + (fields.length > 6 ? ` +${fields.length - 6} more` : "")));
    }
    const bar = el("div", { class: "cloud-conflict-actions" });
    bar.appendChild(el("button", { class: "btn btn-secondary", onclick: () => cloudResolve(c.kind, c.uid, "local") },
      local ? "Keep this device's" : "Keep it deleted"));
    bar.appendChild(el("button", { class: "btn btn-secondary", onclick: () => cloudResolve(c.kind, c.uid, "cloud") },
      remote ? "Use the account's" : "Delete it here too"));
    row.appendChild(bar);
    box.appendChild(row);
  });
};

const openConflictsModal = () => {
  const box = el("div", { id: "cloudConflicts" });
  drawConflictList(box);
  const wrap = el("div");
  wrap.appendChild(box);
  const bar = el("div", { class: "action-bar" });
  bar.appendChild(el("button", { class: "btn btn-primary", onclick: closeModal }, "Done"));
  wrap.appendChild(bar);
  openModal("Review changes", wrap, { guard: false });
};

// ---- bringing signed-out data in ------------------------------------------------

const openMigrationModal = () => {
  const local = deviceLocalData();
  if (!local || !cloudAccount) return;
  const summary = [
    plural(local.businesses.length, "business", "businesses"),
    plural(local.customers.length, "customer"),
    plural(local.products.length, "product"),
    plural(local.documents.length, "document"),
  ].join(", ");
  const has = db.businesses.length;
  const answer = (fn) => () => {
    if (cloud.meta) { cloud.meta.migrationOffered = true; saveSyncMeta(); }
    closeModal();
    fn();
  };
  const wrap = el("div");
  wrap.appendChild(el("div", { class: "cloud-lede" },
    `This browser has data saved from before you signed in: ${summary}.`));
  wrap.appendChild(el("div", { class: "cloud-lede" }, has
    ? `Your account already has ${plural(has, "business", "businesses")}. Adding copies this device's records alongside them — nothing already in your account is changed.`
    : "Your account is empty. Adding it uploads a copy so it's available wherever you sign in."));
  wrap.appendChild(cloudNote("Only copied, never moved: the original stays on this device, untouched, and is what you see whenever you're signed out. If you've already added it once, adding it again makes duplicates."));
  const bar = el("div", { class: "action-bar" });
  bar.appendChild(el("button", { class: "btn btn-secondary", onclick: answer(() => toast("You can add it later from Account & sync.", "ok", 3500)) }, "Not now"));
  bar.appendChild(el("button", { class: "btn btn-primary", onclick: answer(() => {
    const n = cloudMergeDeviceData();
    if (n) toast(`Added ${plural(n.businesses, "business", "businesses")} and everything in them — uploading now`, "ok", 4000);
  }) }, "Add to my account"));
  wrap.appendChild(bar);
  openModal("Add this device's data to your account?", wrap, { guard: false });
};

// ---- signing out ------------------------------------------------------------------

const openSignOutModal = () => {
  const p = cloudPending();
  const conflicts = cloud.meta ? cloud.meta.conflicts.length : 0;
  const unsent = p.count + conflicts;
  const email = cloudAccount.email || "this account";
  const wrap = el("div");
  wrap.appendChild(el("div", { class: "cloud-lede" }, unsent
    ? `${plural(unsent, "change")} haven't reached your account yet. Signing out keeps them safely on this device; they upload the next time you sign in here as ${email}.`
    : "Everything is saved in your account."));
  wrap.appendChild(cloudNote("This device then shows its own signed-out data again. Your account's copy stays here too, so signing back in is instant, even offline — unless you choose to remove it."));
  const bar = el("div", { class: "action-bar cloud-signout-bar" });
  bar.appendChild(el("button", { class: "btn btn-secondary", onclick: closeModal }, "Cancel"));
  bar.appendChild(el("button", { class: "btn btn-danger", onclick: () => {
    closeModal();
    const go = () => cloudSignOut({ erase: true });
    if (unsent) {
      confirmModal(`${plural(unsent, "change")} made on this device will be lost — they are not in your account yet.`, go,
        { title: "Remove unsynced changes?", confirmLabel: "Remove from this device" });
    } else go();
  } }, "Sign out and remove from this device"));
  bar.appendChild(el("button", { class: "btn btn-primary", onclick: () => { closeModal(); cloudSignOut(); } }, "Sign out"));
  wrap.appendChild(bar);
  openModal("Sign out?", wrap, { guard: false });
};

const openAccountChangedModal = () => {
  const wrap = el("div");
  wrap.appendChild(el("div", { class: "cloud-lede" },
    "You signed in or out in another tab. This tab has stopped syncing so changes can't end up in the wrong account. Anything you save here is still kept on this device."));
  const bar = el("div", { class: "action-bar" });
  bar.appendChild(el("button", { class: "btn btn-secondary", onclick: closeModal }, "Not now"));
  bar.appendChild(el("button", { class: "btn btn-primary", onclick: () => location.reload() }, "Reload"));
  wrap.appendChild(bar);
  openModal("Account changed", wrap, { guard: false });
};
