// ==================== BACKUP ====================
const exportBackup = async () => {
  const filename = `pipomaker_backup_${today()}.json`;
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
  const savedBk = await writeToFolder(blob, filename, "backups");
  if (savedBk) {
    toast(`Backup saved to "${savedBk.name}/backups"`, "ok", 6000);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  a.click(); URL.revokeObjectURL(url);
  toast("Backup downloaded");
};

const importBackup = () => {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "application/json";
  inp.onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const imported = JSON.parse(r.result);
        if (!imported.businesses) throw new Error("Invalid backup");
        confirmModal(
          "This replaces every business, customer, product, and document currently in the app with what's in this backup file. Your current data will be lost.",
          () => { db = imported; saveDB(); render(); toast("Backup restored"); },
          { title: "Replace all data?", confirmLabel: "Replace data" }
        );
      } catch (e) { toast("Invalid backup file: " + e.message, "err"); }
    };
    r.readAsText(f);
  };
  inp.click();
};
