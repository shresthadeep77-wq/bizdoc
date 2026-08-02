// ==================== SAVE FOLDER (File System Access API) ====================
// Directory handles can't go in localStorage (not JSON-serializable), so they live in IndexedDB.
const IDB_NAME = "pipomaker_fsa";
const idbOpen = () => new Promise((res, rej) => {
  const req = indexedDB.open(IDB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore("handles");
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});
const idbSet = async (key, val) => {
  const d = await idbOpen();
  return new Promise((res, rej) => {
    const tx = d.transaction("handles", "readwrite");
    tx.objectStore("handles").put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
};
const idbGet = async (key) => {
  const d = await idbOpen();
  return new Promise((res, rej) => {
    const tx = d.transaction("handles", "readonly");
    const req = tx.objectStore("handles").get(key);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
};
const idbDelete = async (key) => {
  const d = await idbOpen();
  return new Promise((res, rej) => {
    const tx = d.transaction("handles", "readwrite");
    tx.objectStore("handles").delete(key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
};

const supportsFSA = () => "showDirectoryPicker" in window;

const verifyDirPermission = async (handle, write = true) => {
  const opts = { mode: write ? "readwrite" : "read" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  if ((await handle.requestPermission(opts)) === "granted") return true;
  return false;
};

const chooseSaveFolder = async () => {
  if (!supportsFSA()) { toast("Folder picking needs Chrome or Edge on desktop", "err"); return; }
  try {
    const handle = await window.showDirectoryPicker();
    const ok = await verifyDirPermission(handle);
    if (!ok) { toast("Permission to that folder was denied", "err"); return; }
    await idbSet(`dir_${db.activeBusinessId}`, handle);
    const biz = activeBiz();
    if (biz) { biz.saveFolderDisplayName = handle.name; saveDB(); }
    toast(`Save folder set to "${handle.name}"`);
    render();
  } catch (e) {
    if (e.name !== "AbortError") { console.error(e); toast("Couldn't set that folder", "err"); }
  }
};

const clearSaveFolder = async () => {
  await idbDelete(`dir_${db.activeBusinessId}`);
  const biz = activeBiz();
  if (biz) { delete biz.saveFolderDisplayName; saveDB(); }
  toast("Save folder cleared");
  render();
};

const getSaveFolderHandle = async () => {
  if (!supportsFSA()) return null;
  try { return (await idbGet(`dir_${db.activeBusinessId}`)) || null; }
  catch (e) { return null; }
};

// Writes a Blob straight into the chosen folder. Returns true on success, false to fall back to a normal download.
const writeToFolder = async (blob, filename, subfolder) => {
  const dirHandle = await getSaveFolderHandle();
  if (!dirHandle) return false;
  try {
    const ok = await verifyDirPermission(dirHandle);
    if (!ok) return false;
    let target = dirHandle;
    if (subfolder) target = await target.getDirectoryHandle(subfolder, { create: true });
    const fileHandle = await target.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    // Report where it actually landed so the file is findable.
    return { name: dirHandle.name || "chosen folder", sub: subfolder || "" };
  } catch (e) {
    console.error("writeToFolder failed:", e);
    return false;
  }
};
