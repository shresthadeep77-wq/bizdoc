// ==================== RENDER ROOT ====================
const render = () => {
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
  const content = el("div", { class: "content" });
  if (currentTab === "dashboard") content.appendChild(renderDashboard());
  else if (currentTab === "customers") content.appendChild(renderCustomers());
  else if (currentTab === "products") content.appendChild(renderProducts());
  else if (currentTab === "documents") content.appendChild(renderDocuments());
  else if (currentTab === "settings") content.appendChild(renderSettings());
  app.appendChild(content);
  root.appendChild(app);

  // Re-append every modal still open, in order — later ones paint on top,
  // so closing the topmost one reveals the one underneath intact.
  modalStack.forEach(bg => root.appendChild(bg));
  document.body.classList.toggle("modal-open", modalStack.length > 0);
};
