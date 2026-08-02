// ==================== ONBOARDING ====================
const renderOnboard = () => {
  const wrap = el("div", { class: "onboard" });
  wrap.appendChild(el("h1", {}, "Welcome to PI & PO Maker"));
  wrap.appendChild(el("p", {}, "Let's set up your first business."));
  wrap.appendChild(el("button", { class: "btn btn-secondary btn-full", style: { marginBottom: "16px" }, onclick: importBackup },
    "\u{1F4E5} Already have a backup? Import it instead"));
  const form = renderBusinessForm(null, (biz) => {
    biz.id = uid("biz");
    biz.nextPi = biz.nextPi || 1;
    biz.nextPo = biz.nextPo || 1;
    biz.nextQt = biz.nextQt || 1;
    biz.nextInv = biz.nextInv || 1;
    biz.nextDn = biz.nextDn || 1;
    db.businesses.push(biz);
    db.activeBusinessId = biz.id;
    saveDB();
    render();
    toast(`Welcome, ${biz.name}! You're all set.`);
  });
  wrap.appendChild(form);
  return wrap;
};
