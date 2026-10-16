// ==================== CLOUD SYNC — CORE ====================
// The rules for keeping this device's `db` and the signed-in user's cloud copy
// in step. No network and no screen code lives here: it is handed the data and
// an `api` object, which is what lets tools/test-sync.js run it under Node
// against a fake server.
//
// How changes are found. Rather than logging every edit as it happens — the
// app mutates `db` from a hundred places and then calls saveDB() — sync keeps,
// per account, a note of every record as it last agreed with the cloud: its
// version and a hash of its contents ("base"). Any record whose hash differs is
// a pending change; any base entry with no record left is a pending delete.
// Both db and base live in localStorage, so pending work survives a refresh, a
// crash or a week offline, and working it out again is always safe to repeat.
//
// How conflicts are caught. Every cloud row has a version the server bumps on
// each write. An upload says "I am changing version N"; if the cloud is
// already past N, someone else got there first and the write is refused rather
// than overwriting it. The user then picks which copy to keep.
//
// Identity. The app's ids are small numbers handed out per device, so two
// devices working offline will both create "product 41". Every record also
// carries `_uid`, a UUID made on the device that created it, which is the
// cloud's primary key. When two devices did pick the same number, the one not
// yet uploaded is renumbered, and everything pointing at it follows.

const SYNC_KINDS = [
  { kind: "businesses", table: "bizdoc_businesses", idKey: "biz",  label: "Business" },
  { kind: "customers",  table: "bizdoc_customers",  idKey: "cust", label: "Customer" },
  { kind: "products",   table: "bizdoc_products",   idKey: "prod", label: "Product" },
  { kind: "documents",  table: "bizdoc_documents",  idKey: "doc",  label: "Document" },
];
const SYNC_KIND = Object.fromEntries(SYNC_KINDS.map(k => [k.kind, k]));

// Fields that describe this device rather than the business. The save folder
// is a handle to a folder on this computer, meaningless anywhere else.
const DEVICE_LOCAL_FIELDS = { businesses: ["saveFolderDisplayName"] };

// Number-series counters. Two devices issuing invoices offline both bump them,
// which would otherwise be a conflict on the whole business every time.
const BIZ_COUNTER_FIELDS = ["nextPi", "nextPo", "nextQt", "nextInv", "nextDn"];

const SYNC_META_VERSION = 1;
const PUSH_CHUNK = 200;
const PULL_PAGE = 500;
// Rows are stamped with the time their transaction started, so one that
// commits late can carry a timestamp older than rows already pulled. Each pull
// re-reads this far back; versions make the overlap harmless.
const PULL_OVERLAP_MS = 60 * 1000;

const emptySyncMeta = (userId) => ({
  v: SYNC_META_VERSION,
  userId,
  base: { businesses: {}, customers: {}, products: {}, documents: {} },
  cursors: {},        // kind -> { t, id } — where the last pull got to
  maxIds: {},         // idKey -> highest local_id seen in the cloud, tombstones included
  conflicts: [],      // { kind, uid, remote, at }
  failed: {},         // "kind:uid" -> { message, at } — uploads the server refused
  lastSyncAt: null,
  firstPullDone: false,
  migrationOffered: false,
});

const normalizeSyncMeta = (raw, userId) => {
  const m = (raw && typeof raw === "object" && raw.userId === userId) ? raw : emptySyncMeta(userId);
  const e = emptySyncMeta(userId);
  m.base = Object.assign(e.base, m.base || {});
  SYNC_KINDS.forEach(k => { if (!m.base[k.kind] || typeof m.base[k.kind] !== "object") m.base[k.kind] = {}; });
  if (!m.cursors || typeof m.cursors !== "object") m.cursors = {};
  if (!m.maxIds || typeof m.maxIds !== "object") m.maxIds = {};
  if (!Array.isArray(m.conflicts)) m.conflicts = [];
  if (!m.failed || typeof m.failed !== "object") m.failed = {};
  return m;
};

// ---- hashing ----------------------------------------------------------------

// JSON with keys sorted at every level. The database stores records as jsonb,
// which does not keep key order, so a record that went up and came back has
// its keys shuffled — a plain JSON.stringify would call that a change.
const canonJSON = (v) => {
  if (v === null || typeof v !== "object") {
    const s = JSON.stringify(v);
    return s === undefined ? "null" : s;
  }
  if (Array.isArray(v)) return "[" + v.map(canonJSON).join(",") + "]";
  return "{" + Object.keys(v).filter(k => v[k] !== undefined && typeof v[k] !== "function").sort()
    .map(k => JSON.stringify(k) + ":" + canonJSON(v[k])).join(",") + "}";
};

// cyrb53: a fast 53-bit string hash. It only has to tell "same contents" from
// "different contents" for one record at a time, not resist an attacker.
const hash53 = (str) => {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};

// What goes to the cloud for a record: everything except this device's own fields.
const cloudView = (kind, rec) => {
  const drop = DEVICE_LOCAL_FIELDS[kind];
  if (!drop) return rec;
  const out = Object.assign({}, rec);
  drop.forEach(f => { delete out[f]; });
  return out;
};
const recordHash = (kind, rec) => hash53(canonJSON(cloudView(kind, rec)));

// Turn a cloud row back into an app record. The row's columns are the truth
// for identity, whatever the JSON says.
const recordFromRow = (row) => Object.assign({}, row.data || {}, { id: Number(row.local_id), _uid: row.id });

// ---- identity -----------------------------------------------------------------

const newUuid = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

// Give every record a unique `_uid`. Returns true if anything changed.
//
// Missing: a record created since the last sync. If base already knows a uid
// for this record's number and nothing else holds it, the record is that one
// (restored from a backup made before sign-in, say) and takes it back, so it
// updates the cloud row instead of duplicating it.
// Duplicated: "duplicate product" copies the whole object, `_uid` included.
// The copy whose number matches what base recorded keeps it; others get new ones.
const ensureUids = (db, meta, genUuid = newUuid) => {
  let changed = false;
  SYNC_KINDS.forEach(({ kind }) => {
    const base = meta.base[kind];
    const byLocalId = {};
    Object.keys(base).forEach(uid => { byLocalId[base[uid].id] = uid; });
    const holders = {};
    db[kind].forEach(r => { if (r._uid) (holders[r._uid] = holders[r._uid] || []).push(r); });
    Object.keys(holders).forEach(uid => {
      const list = holders[uid];
      if (list.length < 2) return;
      const keeper = list.find(r => base[uid] && r.id === base[uid].id) || list[0];
      list.forEach(r => { if (r !== keeper) { r._uid = genUuid(); changed = true; } });
    });
    const taken = new Set(db[kind].map(r => r._uid).filter(Boolean));
    db[kind].forEach(r => {
      if (r._uid) return;
      const prior = byLocalId[r.id];
      r._uid = (prior && !taken.has(prior)) ? prior : genUuid();
      taken.add(r._uid);
      changed = true;
    });
  });
  return changed;
};

// ---- renumbering --------------------------------------------------------------

const highestId = (list) => list.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);

// Next number nobody — on this device or in the cloud — has used for `kind`.
const reserveId = (db, meta, kind) => {
  const { idKey } = SYNC_KIND[kind];
  const n = Math.max(Number(db.nextIds[idKey]) || 1, highestId(db[kind]) + 1, (Number(meta.maxIds[idKey]) || 0) + 1);
  db.nextIds[idKey] = n + 1;
  return n;
};

// Every place one record points at another by number. Renumbering a record
// has to follow all of them, or the pointer quietly lands on something else.
const rewriteRefs = (r, kind, from, to) => {
  let hit = false;
  if (kind === "businesses" && r.businessId === from) { r.businessId = to; hit = true; }
  if (kind === "customers" && r.customerId === from) { r.customerId = to; hit = true; }
  if (kind === "products" && Array.isArray(r.lineItems)) {
    r.lineItems.forEach(li => { if (li && li.productId === from) { li.productId = to; hit = true; } });
  }
  if (kind === "documents" && r.fromDoc && r.fromDoc.id === from) { r.fromDoc.id = to; hit = true; }
  return hit;
};

// Move a not-yet-uploaded record to a new number. Only records with local,
// unsynced changes follow it: a record that matches the cloud exactly cannot
// be pointing at something that has never been uploaded, and its references
// to the same number mean the cloud's record, which is keeping it.
const renumberLocal = (db, meta, kind, rec, newId) => {
  const oldId = rec.id;
  const holders = SYNC_KINDS.filter(k => k.kind !== "businesses").map(k => k.kind);
  holders.forEach(hk => {
    db[hk].forEach(r => {
      if (r === rec) return;
      const b = r._uid && meta.base[hk][r._uid];
      if (b && b.h === recordHash(hk, r)) return;
      rewriteRefs(r, kind, oldId, newId);
    });
  });
  if (kind === "businesses" && db.activeBusinessId === oldId) db.activeBusinessId = newId;
  rec.id = newId;
};

// ---- working out what to upload -----------------------------------------------

const conflictKey = (kind, uid) => kind + ":" + uid;
const hasConflict = (meta, kind, uid) => meta.conflicts.some(c => c.kind === kind && c.uid === uid);

// [{ kind, uid, op, rec, hash, baseVersion }] for one kind, or all of them.
const computeChanges = (db, meta, onlyKind) => {
  const out = [];
  SYNC_KINDS.forEach(({ kind }) => {
    if (onlyKind && kind !== onlyKind) return;
    const base = meta.base[kind];
    const present = new Set();
    db[kind].forEach(rec => {
      // Uids are handed out when a sync starts, so a record made while
      // offline or signed out of the session has none yet. It is still a
      // change waiting to go up, and the status has to say so.
      if (!rec._uid) { out.push({ kind, uid: null, op: "insert", rec, hash: null }); return; }
      present.add(rec._uid);
      if (hasConflict(meta, kind, rec._uid)) return;
      const h = recordHash(kind, rec);
      const b = base[rec._uid];
      if (!b) out.push({ kind, uid: rec._uid, op: "insert", rec, hash: h });
      else if (b.h !== h) out.push({ kind, uid: rec._uid, op: "update", rec, hash: h, baseVersion: b.v });
    });
    Object.keys(base).forEach(uid => {
      if (present.has(uid) || hasConflict(meta, kind, uid)) return;
      out.push({ kind, uid, op: "delete", rec: null, hash: null, baseVersion: base[uid].v });
    });
  });
  return out;
};

const pendingSummary = (db, meta) => {
  const changes = computeChanges(db, meta);
  const byKind = {};
  changes.forEach(c => { byKind[c.kind] = (byKind[c.kind] || 0) + 1; });
  return { count: changes.length, byKind };
};

// ---- taking in cloud rows -------------------------------------------------------

// Replace a record's contents in place. Screens hold references to the live
// object (the settings popup edits `biz` directly), so swapping in a new
// object would leave their next save writing into one nobody can see.
const overwriteRecord = (kind, target, incoming) => {
  const keep = {};
  (DEVICE_LOCAL_FIELDS[kind] || []).forEach(f => { if (target[f] !== undefined) keep[f] = target[f]; });
  Object.keys(target).forEach(k => { delete target[k]; });
  Object.assign(target, incoming, keep);
};

// Two edits to a business that differ only in number counters merge cleanly:
// keep the higher counter so neither device re-issues a number.
const tryAutoMerge = (kind, local, remoteRec) => {
  if (kind !== "businesses") return null;
  const a = cloudView(kind, local), b = cloudView(kind, remoteRec);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (BIZ_COUNTER_FIELDS.includes(k)) continue;
    if (canonJSON(a[k]) !== canonJSON(b[k])) return null;
  }
  const merged = Object.assign({}, remoteRec);
  BIZ_COUNTER_FIELDS.forEach(k => { merged[k] = Math.max(Number(a[k]) || 1, Number(b[k]) || 1); });
  return merged;
};

const recordConflict = (meta, kind, uid, row) => {
  meta.conflicts = meta.conflicts.filter(c => !(c.kind === kind && c.uid === uid));
  meta.conflicts.push({ kind, uid, remote: row || null, at: new Date().toISOString() });
};

// Free `localId` for a cloud record by moving whichever different local
// record holds it.
const clearIdFor = (db, meta, kind, uid, localId) => {
  const clash = db[kind].find(r => r.id === localId && r._uid !== uid);
  if (clash) renumberLocal(db, meta, kind, clash, reserveId(db, meta, kind));
};

const noteMaxId = (meta, kind, localId) => {
  const { idKey } = SYNC_KIND[kind];
  meta.maxIds[idKey] = Math.max(Number(meta.maxIds[idKey]) || 0, Number(localId) || 0);
};

// Apply one cloud row. Returns "applied" (this device changed), "same",
// "conflict" or "skip".
const applyRemoteRow = (db, meta, kind, row) => {
  const uid = row.id;
  noteMaxId(meta, kind, row.local_id);
  const existing = meta.conflicts.find(c => c.kind === kind && c.uid === uid);
  if (existing) { existing.remote = row; return "conflict"; }

  const base = meta.base[kind];
  const b = base[uid];
  if (b && Number(row.version) <= Number(b.v)) return "skip";

  const local = db[kind].find(r => r._uid === uid);
  const localHash = local ? recordHash(kind, local) : null;
  const localChanged = local ? (!b || b.h !== localHash) : !!b;
  const remoteRec = row.deleted ? null : recordFromRow(row);
  const remoteHash = remoteRec ? recordHash(kind, remoteRec) : null;

  if (!localChanged) {
    if (row.deleted) {
      if (local) db[kind] = db[kind].filter(r => r !== local);
      delete base[uid];
      return local ? "applied" : "skip";
    }
    clearIdFor(db, meta, kind, uid, remoteRec.id);
    if (local) overwriteRecord(kind, local, remoteRec);
    else db[kind].push(remoteRec);
    base[uid] = { v: Number(row.version), h: remoteHash, id: remoteRec.id };
    return "applied";
  }

  // Both sides moved.
  if (row.deleted && !local) { delete base[uid]; return "same"; }
  if (row.deleted && local && !b) {
    // Never synced from here, yet the cloud has it deleted: this record was
    // brought back (undo, or a restored backup). Revive it.
    base[uid] = { v: Number(row.version), h: "revive", id: local.id };
    return "same";
  }
  if (!row.deleted && local && localHash === remoteHash) {
    base[uid] = { v: Number(row.version), h: remoteHash, id: local.id };
    return "same";
  }
  if (!row.deleted && local) {
    const merged = tryAutoMerge(kind, local, remoteRec);
    if (merged) {
      overwriteRecord(kind, local, merged);
      base[uid] = { v: Number(row.version), h: remoteHash, id: local.id };
      return "applied";
    }
  }
  recordConflict(meta, kind, uid, row);
  return "conflict";
};

// ---- resolving conflicts --------------------------------------------------------

// "Keep this device's copy": take the cloud's version number as the starting
// point, so the next upload is an ordinary update that replaces it.
const resolveKeepLocal = (db, meta, kind, uid) => {
  const c = meta.conflicts.find(x => x.kind === kind && x.uid === uid);
  if (!c) return;
  const local = db[kind].find(r => r._uid === uid);
  if (c.remote) meta.base[kind][uid] = { v: Number(c.remote.version), h: "keep-local", id: local ? local.id : Number(c.remote.local_id) };
  else delete meta.base[kind][uid];     // gone from the cloud entirely: upload as new
  meta.conflicts = meta.conflicts.filter(x => x !== c);
};

// "Use the cloud copy": overwrite (or remove) this device's record.
const resolveUseCloud = (db, meta, kind, uid) => {
  const c = meta.conflicts.find(x => x.kind === kind && x.uid === uid);
  if (!c) return;
  meta.conflicts = meta.conflicts.filter(x => x !== c);
  const local = db[kind].find(r => r._uid === uid);
  if (!c.remote || c.remote.deleted) {
    if (local) db[kind] = db[kind].filter(r => r !== local);
    delete meta.base[kind][uid];
    return;
  }
  const rec = recordFromRow(c.remote);
  clearIdFor(db, meta, kind, uid, rec.id);
  if (local) overwriteRecord(kind, local, rec);
  else db[kind].push(rec);
  meta.base[kind][uid] = { v: Number(c.remote.version), h: recordHash(kind, rec), id: rec.id };
};

// ---- pull -----------------------------------------------------------------------

// Fetch everything changed in the cloud since the last pull and apply it.
// `api.pull(table, sinceIso, afterUuid, limit)` returns rows in (updated_at, id) order.
const pullAll = async (db, meta, api) => {
  let applied = 0;
  for (const { kind, table } of SYNC_KINDS) {
    const cur = meta.cursors[kind];
    let since = cur ? new Date(new Date(cur.t).getTime() - PULL_OVERLAP_MS).toISOString() : null;
    let after = null;
    for (;;) {
      const rows = await api.pull(table, since, after, PULL_PAGE);
      rows.forEach(row => { if (applyRemoteRow(db, meta, kind, row) === "applied") applied++; });
      if (rows.length) {
        const last = rows[rows.length - 1];
        // Keep the server's own timestamp string: it has microseconds, which a
        // JS Date would round away and then re-read a row on every page.
        since = last.updated_at; after = last.id;
        const prev = meta.cursors[kind];
        if (!prev || new Date(last.updated_at) >= new Date(prev.t)) meta.cursors[kind] = { t: last.updated_at, id: last.id };
      }
      if (rows.length < PULL_PAGE) break;
    }
  }
  SYNC_KINDS.forEach(({ kind, idKey }) => {
    const floor = (Number(meta.maxIds[idKey]) || 0) + 1;
    if (!(Number(db.nextIds[idKey]) >= floor)) db.nextIds[idKey] = floor;
  });
  meta.firstPullDone = true;
  return applied;
};

// ---- push -----------------------------------------------------------------------

const uidOf = (db, kind, localId) => {
  if (localId === null || localId === undefined) return null;
  const r = db[kind].find(x => x.id === localId);
  return r ? r._uid || null : null;
};

// Build the server op for a change, or return a reason it cannot be sent yet.
const opPayload = (db, ch) => {
  if (ch.op === "delete") return { op: { op: "delete", id: ch.uid, base_version: ch.baseVersion } };
  const rec = ch.rec;
  const op = { op: ch.op, id: ch.uid, local_id: rec.id, data: cloudView(ch.kind, rec) };
  if (ch.op === "update") op.base_version = ch.baseVersion;
  if (ch.kind !== "businesses") {
    op.business_id = uidOf(db, "businesses", rec.businessId);
    if (!op.business_id) return { error: "Belongs to a business that no longer exists on this device, so it can't be uploaded." };
  }
  if (ch.kind === "documents") op.customer_id = uidOf(db, "customers", rec.customerId);
  return { op };
};

// Upload every pending change. Each successful write is recorded in base as it
// lands, so an interrupted push resumes where it stopped. A record edited
// again while its upload was in flight keeps the hash taken before the
// upload, so it simply shows up as changed again next time.
const pushAll = async (db, meta, api, onProgress) => {
  const stats = { ok: 0, conflicts: 0, failed: 0, renumbered: 0, again: false };
  for (const { kind, table } of SYNC_KINDS) {
    const changes = computeChanges(db, meta, kind).filter(ch => ch.uid);   // ensureUids runs first
    const ready = [];
    changes.forEach(ch => {
      const p = opPayload(db, ch);
      if (p.error) { meta.failed[conflictKey(kind, ch.uid)] = { message: p.error, at: new Date().toISOString() }; stats.failed++; }
      else ready.push({ ch, op: p.op });
    });
    for (let i = 0; i < ready.length; i += PUSH_CHUNK) {
      const chunk = ready.slice(i, i + PUSH_CHUNK);
      const results = await api.push(table, chunk.map(x => x.op));
      const byId = {};
      (results || []).forEach(r => { byId[r.id] = r; });
      chunk.forEach(({ ch }) => {
        const res = byId[ch.uid];
        const key = conflictKey(kind, ch.uid);
        const base = meta.base[kind];
        if (!res) { stats.again = true; return; }
        if (res.status === "ok") {
          delete meta.failed[key];
          if (ch.op === "delete") delete base[ch.uid];
          else base[ch.uid] = { v: Number(res.version), h: ch.hash, id: ch.rec.id };
          noteMaxId(meta, kind, ch.rec ? ch.rec.id : 0);
          stats.ok++;
        } else if (res.status === "conflict" || res.status === "exists") {
          delete meta.failed[key];
          if (res.row) {
            const out = applyRemoteRow(db, meta, kind, res.row);
            if (out === "conflict") stats.conflicts++; else stats.again = true;
          } else if (res.status === "exists") {
            // That id belongs to a row this account cannot see. Take a new one.
            if (ch.rec) { ch.rec._uid = newUuid(); stats.again = true; }
          } else if (ch.op === "delete") {
            delete base[ch.uid];          // already gone from the cloud: nothing to do
          } else {
            recordConflict(meta, kind, ch.uid, null);
            stats.conflicts++;
          }
        } else if (res.status === "id_taken") {
          // Another device used this number first. This record has not been
          // uploaded yet, so it is the one that moves.
          delete meta.failed[key];
          if (ch.rec && ch.op === "insert") {
            noteMaxId(meta, kind, ch.rec.id);
            renumberLocal(db, meta, kind, ch.rec, reserveId(db, meta, kind));
            stats.renumbered++; stats.again = true;
          }
        } else {
          meta.failed[key] = { message: res.message || "Rejected by the server", code: res.code, at: new Date().toISOString() };
          stats.failed++;
        }
      });
      if (onProgress) onProgress(Math.min(i + PUSH_CHUNK, ready.length), ready.length, kind);
    }
  }
  // Failures for records that no longer exist (or no longer differ) are stale.
  const live = new Set(computeChanges(db, meta).map(c => conflictKey(c.kind, c.uid)));
  Object.keys(meta.failed).forEach(k => { if (!live.has(k)) delete meta.failed[k]; });
  return stats;
};

// ---- bringing in a whole database -----------------------------------------------

// Add every record from `incoming` to `target` as new records: fresh numbers
// that clash with nothing in either, fresh uids, and every reference inside
// `incoming` carried across. Used to move a device's signed-out data into an
// account without disturbing anything the account already holds.
const mergeIntoAccount = (target, meta, incoming, genUuid = newUuid) => {
  const src = normalizeDB(JSON.parse(JSON.stringify(incoming)));
  const maps = {};
  const counts = {};
  SYNC_KINDS.forEach(({ kind }) => {
    maps[kind] = new Map();
    counts[kind] = src[kind].length;
    src[kind].forEach(r => {
      const n = reserveId(target, meta, kind);
      maps[kind].set(r.id, n);
      r.id = n;
      r._uid = genUuid();
    });
  });
  const mapOrNull = (kind, v) => (maps[kind].has(v) ? maps[kind].get(v) : null);
  ["customers", "products", "documents"].forEach(kind => {
    src[kind].forEach(r => { r.businessId = mapOrNull("businesses", r.businessId); });
  });
  src.documents.forEach(d => {
    d.customerId = mapOrNull("customers", d.customerId);
    (d.lineItems || []).forEach(li => { if (li && li.productId != null) li.productId = mapOrNull("products", li.productId); });
    if (d.fromDoc && d.fromDoc.id != null) d.fromDoc.id = mapOrNull("documents", d.fromDoc.id);
  });
  SYNC_KINDS.forEach(({ kind }) => { target[kind].push(...src[kind]); });
  if (!target.activeBusinessId && target.businesses.length) target.activeBusinessId = target.businesses[0].id;
  return counts;
};
