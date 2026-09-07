// ==================== RENDER ROOT ====================
// Draws the whole screen. Called after every change — there is no virtual DOM,
// the view is simply rebuilt from `db`.
const renderApp = () => {
  const root = $("#app");
  root.innerHTML = "";
  document.body.classList.toggle("modal-open", modalStack.length > 0);

  if (db.businesses.length === 0) {
    root.appendChild(renderOnboard());
    modalStack.forEach(bg => root.appendChild(bg));
    return;
  }
  if (!db.activeBusinessId) {
    db.activeBusinessId = db.businesses[0].id;
    saveDB();
  }

  const app = el("div", { class: "app" });
  app.appendChild(renderTopbar());
  app.appendChild(renderTabs());
  const content = el("main", { class: "content", id: "main" });
  if (currentTab === "customers") content.appendChild(renderCustomers());
  else if (currentTab === "products") content.appendChild(renderProducts());
  else if (currentTab === "documents") content.appendChild(renderDocuments());
  else content.appendChild(renderDashboard());
  app.appendChild(content);
  root.appendChild(app);

  // Re-append every modal still open, in order — later ones paint on top,
  // so closing the topmost one reveals the one underneath intact.
  modalStack.forEach(bg => root.appendChild(bg));
};

// Anything that throws while drawing used to leave a permanently blank white
// screen with no way out — and the bad data is already saved, so reloading
// doesn't help either. Show what went wrong plus the ways back instead.
const render = () => {
  try {
    renderApp();
  } catch (e) {
    console.error("Render failed:", e);
    renderRecovery(e);
  }
};

const renderRecovery = (err) => {
  const root = $("#app");
  root.innerHTML = "";
  modalStack = [];
  document.body.classList.remove("modal-open");
  const box = el("div", { class: "onboard" });
  box.appendChild(el("h1", {}, "Something went wrong"));
  box.appendChild(el("p", {}, "The app couldn't draw this screen — usually because some saved data is damaged. Your data is still stored on this device. Try one of these."));
  box.appendChild(el("button", { class: "btn btn-primary btn-full", style: { marginBottom: "8px" },
    onclick: () => location.reload() }, "Reload the app"));
  box.appendChild(el("button", { class: "btn btn-secondary btn-full", style: { marginBottom: "8px" },
    onclick: exportBackup }, "\u{1F4E5} Download a backup of my data"));
  box.appendChild(el("button", { class: "btn btn-secondary btn-full", style: { marginBottom: "8px" },
    onclick: importBackup }, "\u{1F4E4} Restore from a backup file"));
  box.appendChild(el("div", { style: { fontSize: "11px", color: "var(--muted)", marginTop: "12px", wordBreak: "break-word" } },
    "Technical detail: " + (err && err.message ? err.message : String(err))));
  root.appendChild(box);
};
