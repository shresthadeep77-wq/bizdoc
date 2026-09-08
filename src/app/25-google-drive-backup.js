// ==================== GOOGLE DRIVE BACKUP ====================
const GDRIVE_CLIENT_ID = "875334449474-2uqcceb5134tbpbk0e2spv67c5ah4muh.apps.googleusercontent.com";
const GDRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GDRIVE_FILENAME = "pipomaker_backup.json";
let _gdriveToken = null;

// Google's sign-in script used to sit in the page <head>, which meant every
// visit hit accounts.google.com whether or not Drive was ever used — a wasted
// third-party request online, and a console error every time the app opened
// offline. It is fetched here instead, the first time someone asks for Drive.
let _gsiPromise = null;
const loadGoogleSignIn = () => {
  if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
  if (!_gsiPromise) {
    _gsiPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Google sign-in couldn't be reached — check your connection"));
      document.head.appendChild(s);
    });
    _gsiPromise.catch(() => { _gsiPromise = null; }); // let a later attempt retry
  }
  return _gsiPromise;
};

// Get an access token (opens Google's consent popup the first time).
const gdriveAuth = () => loadGoogleSignIn().then(() => new Promise((resolve, reject) => {
  if (!window.google || !google.accounts || !google.accounts.oauth2) {
    reject(new Error("Google sign-in not loaded — check your connection")); return;
  }
  const client = google.accounts.oauth2.initTokenClient({
    client_id: GDRIVE_CLIENT_ID, scope: GDRIVE_SCOPE,
    callback: (resp) => { if (resp && resp.access_token) { _gdriveToken = resp.access_token; resolve(resp.access_token); } else reject(new Error("Authorization failed")); },
    error_callback: () => reject(new Error("Authorization cancelled")),
  });
  client.requestAccessToken({ prompt: _gdriveToken ? "" : "consent" });
}));

// Find our existing backup file id (drive.file only sees files we created).
const gdriveFindFile = async (token) => {
  const q = encodeURIComponent(`name='${GDRIVE_FILENAME}' and trashed=false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)`, { headers: { Authorization: "Bearer " + token } });
  const data = await res.json();
  return (data.files && data.files[0] && data.files[0].id) || null;
};

const gdriveBackup = async (btn) => {
  const orig = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = "Connecting…"; }
  try {
    const token = await gdriveAuth();
    if (btn) btn.textContent = "Uploading…";
    const content = JSON.stringify(db);
    const existingId = await gdriveFindFile(token);
    const metadata = { name: GDRIVE_FILENAME, mimeType: "application/json" };
    const boundary = "-------pipo" + Date.now();
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
    const url = existingId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
      : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
    const res = await fetch(url, {
      method: existingId ? "PATCH" : "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!res.ok) throw new Error("Upload failed (" + res.status + ")");
    track("drive.backup");
    toast("Backed up to Google Drive", "ok", 5000);
  } catch (e) {
    track("drive.failed", { op: "backup" });
    toast(e.message || "Drive backup failed", "err", 5000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
};

const gdriveRestore = async (btn) => {
  const orig = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = "Connecting…"; }
  try {
    const token = await gdriveAuth();
    if (btn) btn.textContent = "Fetching…";
    const id = await gdriveFindFile(token);
    if (!id) { toast("No backup found in Drive", "err"); return; }
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers: { Authorization: "Bearer " + token } });
    if (!res.ok) throw new Error("Download failed");
    const imported = JSON.parse(await res.text());
    if (!imported.businesses) throw new Error("Backup file is invalid");
    confirmModal(
      "This replaces all current data with the backup from Google Drive. Your current data will be lost.",
      () => { replaceDB(imported); render(); toast("Restored from Google Drive"); },
      { title: "Replace all data?", confirmLabel: "Replace data" }
    );
  } catch (e) {
    track("drive.failed", { op: "restore" });
    toast(e.message || "Drive restore failed", "err", 5000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = orig; }
  }
};
