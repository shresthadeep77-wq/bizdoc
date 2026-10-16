#!/usr/bin/env node
/**
 * Tests for the sync rules in src/app/29-cloud-sync-core.js and the per-account
 * storage in src/app/01-storage.js.
 *
 *   node tools/test-sync.js
 *
 * The app's files are plain scripts sharing one scope, so they are loaded here
 * the same way the build joins them, into a sandbox with a fake localStorage.
 * The "server" is an in-memory stand-in for the two RPC functions in
 * supabase/migrations — same statuses, same version rule, same uniqueness and
 * foreign-key rules, and it reorders JSON keys the way jsonb does. Real Row
 * Level Security is tested separately against Postgres (tools/test-rls.mjs).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { webcrypto } = require("crypto");

const SRC = path.join(__dirname, "..", "src", "app");

const load = () => {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  // Object.keys(localStorage) is how 26-backup lists keys.
  const lsProxy = new Proxy(localStorage, { ownKeys: () => [...store.keys()], getOwnPropertyDescriptor: (t, k) => (store.has(k) ? { enumerable: true, configurable: true, value: store.get(k) } : undefined) });
  const ctx = vm.createContext({ localStorage: lsProxy, crypto: webcrypto, console, toast: () => {}, JSON, Math, Date, Map, Set, Number, String, Object, Array, Promise });
  const code = ["01-storage.js", "26-backup.js", "29-cloud-sync-core.js"]
    .map((f) => fs.readFileSync(path.join(SRC, f), "utf8")).join("\n\n");
  const api = vm.runInContext(code + `
;({ normalizeDB, defaultDB, saveDB, readDBAt, activeDbKey, scanDeviceData, DB_KEY,
    setAccount: (a) => { cloudAccount = a; }, setDB: (d) => { db = d; }, getDB: () => db,
    emptySyncMeta, ensureUids, computeChanges, pendingSummary, pullAll, pushAll,
    resolveKeepLocal, resolveUseCloud, mergeIntoAccount, recordHash, canonJSON })`, ctx);
  api.store = store;
  return api;
};

const A = load();

// ---- fake server -------------------------------------------------------------

const TABLES = ["bizdoc_businesses", "bizdoc_customers", "bizdoc_products", "bizdoc_documents"];
// jsonb orders object keys by length, then bytewise — not insertion order.
const jsonbize = (v) => {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(jsonbize);
  const out = {};
  Object.keys(v).filter((k) => v[k] !== undefined).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
    .forEach((k) => { out[k] = jsonbize(v[k]); });
  return out;
};
// Also turns objects made inside the sandbox into this realm's own, which
// deepStrictEqual needs (arrays from another realm never compare equal).
const clone = (x) => JSON.parse(JSON.stringify(x));

class FakeServer {
  constructor() {
    this.t = Object.fromEntries(TABLES.map((n) => [n, new Map()]));
    this.tick = 0;
    this.offline = false;
    this.dropNextResponse = false;
  }
  stamp() { this.tick++; return new Date(Date.UTC(2026, 9, 16, 0, 0, 0) + this.tick * 1000).toISOString(); }
  rowOut(r) { return r ? clone({ id: r.id, local_id: r.local_id, data: r.data, version: r.version, deleted: r.deleted, updated_at: r.updated_at }) : null; }
  mine(table, owner, id) { const r = this.t[table].get(id); return r && r.owner === owner ? r : null; }
  localIdTaken(table, owner, localId, exceptId) {
    for (const r of this.t[table].values()) if (r.owner === owner && r.local_id === localId && r.id !== exceptId) return true;
    return false;
  }
  fkOk(table, owner, op) {
    if (table !== "bizdoc_businesses" && !this.mine("bizdoc_businesses", owner, op.business_id)) return "business";
    if (table === "bizdoc_documents" && op.customer_id && !this.mine("bizdoc_customers", owner, op.customer_id)) return "customer";
    return null;
  }
  push(owner, table, ops) {
    const out = [];
    for (const op of clone(ops)) {
      const t = this.t[table];
      if (op.op === "insert") {
        if (t.has(op.id)) { out.push({ id: op.id, status: "exists", row: this.rowOut(this.mine(table, owner, op.id)) }); continue; }
        if (this.localIdTaken(table, owner, op.local_id)) { out.push({ id: op.id, status: "id_taken" }); continue; }
        const fk = this.fkOk(table, owner, op);
        if (fk) { out.push({ id: op.id, status: "error", code: "23503", message: "missing " + fk }); continue; }
        const r = { id: op.id, owner, local_id: op.local_id, data: jsonbize(op.data), version: 1, deleted: false, updated_at: this.stamp(),
          business_id: op.business_id, customer_id: op.customer_id };
        t.set(op.id, r);
        out.push({ id: op.id, status: "ok", version: 1, updated_at: r.updated_at });
      } else {
        const r = this.mine(table, owner, op.id);
        if (!r || r.version !== op.base_version) { out.push({ id: op.id, status: "conflict", row: this.rowOut(r) }); continue; }
        if (op.op === "update") {
          if (this.localIdTaken(table, owner, op.local_id, op.id)) { out.push({ id: op.id, status: "id_taken" }); continue; }
          const fk = this.fkOk(table, owner, op);
          if (fk) { out.push({ id: op.id, status: "error", code: "23503", message: "missing " + fk }); continue; }
          Object.assign(r, { local_id: op.local_id, data: jsonbize(op.data), deleted: false, business_id: op.business_id, customer_id: op.customer_id });
        } else {
          r.deleted = true;
        }
        r.version++;
        r.updated_at = this.stamp();
        out.push({ id: op.id, status: "ok", version: r.version, updated_at: r.updated_at });
      }
    }
    return out;
  }
  pull(owner, table, since, after, limit) {
    const s = since || "0000", a = after || "";
    return clone([...this.t[table].values()]
      .filter((r) => r.owner === owner && (r.updated_at > s || (r.updated_at === s && r.id > a)))
      .sort((x, y) => (x.updated_at < y.updated_at ? -1 : x.updated_at > y.updated_at ? 1 : x.id < y.id ? -1 : 1))
      .slice(0, limit)
      .map((r) => this.rowOut(r)));
  }
  api(owner) {
    const net = () => { if (this.offline) { const e = new Error("Failed to fetch"); e.network = true; throw e; } };
    return {
      pull: async (table, since, after, limit) => { net(); return this.pull(owner, table, since, after, limit); },
      push: async (table, ops) => {
        net();
        const res = this.push(owner, table, ops);
        if (this.dropNextResponse) { this.dropNextResponse = false; const e = new Error("Failed to fetch"); e.network = true; throw e; }
        return res;
      },
    };
  }
  live(table, owner) { return [...this.t[table].values()].filter((r) => r.owner === owner && !r.deleted); }
}

// ---- devices -------------------------------------------------------------------

const device = (server, owner) => ({
  db: A.normalizeDB({}),
  meta: A.emptySyncMeta(owner),
  api: server.api(owner),
});

// The same loop the app runs (30-cloud-auth.js cloudRunSync).
const sync = async (dev) => {
  A.ensureUids(dev.db, dev.meta);
  let last;
  for (let round = 0; round < 3; round++) {
    if (await A.pullAll(dev.db, dev.meta, dev.api)) A.normalizeDB(dev.db);
    last = await A.pushAll(dev.db, dev.meta, dev.api);
    if (!last.again) break;
    A.ensureUids(dev.db, dev.meta);
  }
  return last;
};

const nextId = (db, k) => { const id = db.nextIds[k]; db.nextIds[k]++; return id; };

const seed = (dev) => {
  const { db } = dev;
  const biz = { id: nextId(db, "biz"), name: "Deepjyoti Plastics", currency: "NPR", taxRate: 13, nextInv: 1 };
  db.businesses.push(biz);
  db.activeBusinessId = biz.id;
  const cust = { id: nextId(db, "cust"), businessId: biz.id, companyName: "Himal Traders", discountRules: [] };
  db.customers.push(cust);
  // 113.00 is VAT-inclusive at 13%: 100.00 + 13.00.
  const prod = { id: nextId(db, "prod"), businessId: biz.id, description: "PVC pipe 1in", unit: "pcs", rate: 113, rateIncludesVat: true, taxable: true };
  db.products.push(prod);
  const doc = {
    id: nextId(db, "doc"), businessId: biz.id, customerId: cust.id, type: "INV", number: "INV-2026-0001",
    lineItems: [{ productId: prod.id, description: prod.description, qty: 3, rate: 113, listRate: 113 }],
    totals: { subtotal: 300, taxable: 300, tax: 39, total: 339.0, taxRate: 13 },
  };
  db.documents.push(doc);
  biz.nextInv = 2;
  A.normalizeDB(db);
  return { biz, cust, prod, doc };
};

const same = (actual, expected, msg) => assert.deepEqual(clone(actual), clone(expected), msg);

// ---- tests ---------------------------------------------------------------------

test("uploads every record with stable ids and owner-scoped references", async () => {
  const s = new FakeServer();
  const a = device(s, "user-1");
  const { biz, cust } = seed(a);
  await sync(a);
  assert.equal(A.pendingSummary(a.db, a.meta).count, 0, "nothing left pending");
  assert.equal(s.live("bizdoc_businesses", "user-1").length, 1);
  const doc = s.live("bizdoc_documents", "user-1")[0];
  assert.equal(doc.business_id, biz._uid);
  assert.equal(doc.customer_id, cust._uid);
  assert.equal(doc.data.totals.total, 339, "totals arrive exactly");
});

test("a second device receives everything, identical, and a VAT-inclusive rate survives the round trip", async () => {
  const s = new FakeServer();
  const a = device(s, "u"), b = device(s, "u");
  seed(a);
  await sync(a);
  await sync(b);
  for (const k of ["businesses", "customers", "products", "documents"]) {
    same(b.db[k].map((r) => A.canonJSON(r)), a.db[k].map((r) => A.canonJSON(r)), k + " match");
  }
  assert.equal(b.db.products[0].rate, 113);
  assert.equal(b.db.products[0].rateIncludesVat, true);
  assert.equal(A.pendingSummary(b.db, b.meta).count, 0, "jsonb key order does not count as a change");
  assert.ok(b.db.nextIds.prod > a.db.products[0].id, "new ids on B start above the cloud's");
});

test("edits and deletions propagate, and edits land in the same object screens hold", async () => {
  const s = new FakeServer();
  const a = device(s, "u"), b = device(s, "u");
  seed(a);
  await sync(a); await sync(b);
  const heldByAScreen = a.db.customers[0];
  b.db.customers[0].companyName = "Himal Traders Pvt Ltd";
  b.db.products = [];
  await sync(b);
  await sync(a);
  assert.equal(heldByAScreen.companyName, "Himal Traders Pvt Ltd");
  assert.equal(a.db.customers[0], heldByAScreen, "same object, updated in place");
  assert.equal(a.db.products.length, 0, "deletion reached A");
  assert.equal(s.live("bizdoc_products", "u").length, 0);
  assert.equal(s.t.bizdoc_products.size, 1, "a tombstone is kept");
});

test("records created offline on two devices with the same number are both kept, and references follow", async () => {
  const s = new FakeServer();
  const a = device(s, "u"), b = device(s, "u");
  const { biz } = seed(a);
  await sync(a); await sync(b);
  // Both offline: each adds a product with the same next number, and B uses its
  // new product on a new document.
  const pa = { id: nextId(a.db, "prod"), businessId: biz.id, description: "Elbow 1in", rate: 45 };
  a.db.products.push(pa);
  const pb = { id: nextId(b.db, "prod"), businessId: biz.id, description: "Tee 1in", rate: 50 };
  b.db.products.push(pb);
  assert.equal(pa.id, pb.id, "the clash this test is about");
  const dB = { id: nextId(b.db, "doc"), businessId: biz.id, customerId: b.db.customers[0].id, type: "QT", number: "QT-1",
    lineItems: [{ productId: pb.id, description: "Tee 1in", qty: 1, rate: 50 }], totals: { total: 50 } };
  b.db.documents.push(dB);
  await sync(a);
  await sync(b);
  await sync(a);
  const names = (dev) => dev.db.products.map((p) => p.description).sort();
  same(names(a), ["Elbow 1in", "PVC pipe 1in", "Tee 1in"]);
  same(names(b), names(a));
  const tee = b.db.products.find((p) => p.description === "Tee 1in");
  assert.notEqual(tee.id, pa.id, "B's product was renumbered");
  assert.equal(b.db.documents.find((d) => d.number === "QT-1").lineItems[0].productId, tee.id, "B's document followed it");
  assert.equal(a.db.documents.find((d) => d.number === "QT-1").lineItems[0].productId, a.db.products.find((p) => p.description === "Tee 1in").id);
  assert.equal(new Set(a.db.products.map((p) => p.id)).size, 3, "no two products share a number");
});

test("the same record edited on two devices is a conflict, never a silent overwrite", async () => {
  const s = new FakeServer();
  const a = device(s, "u"), b = device(s, "u");
  seed(a);
  await sync(a); await sync(b);
  a.db.customers[0].phone = "01-4000001";
  b.db.customers[0].phone = "98000000";
  await sync(a);
  const stats = await sync(b);
  assert.equal(b.meta.conflicts.length, 1);
  assert.ok(stats.conflicts >= 0);
  assert.equal(b.db.customers[0].phone, "98000000", "B's edit is kept locally");
  assert.equal(s.live("bizdoc_customers", "u")[0].data.phone, "01-4000001", "the cloud was not overwritten");
  // B decides its copy wins.
  A.resolveKeepLocal(b.db, b.meta, "customers", b.db.customers[0]._uid);
  await sync(b);
  assert.equal(b.meta.conflicts.length, 0);
  assert.equal(s.live("bizdoc_customers", "u")[0].data.phone, "98000000");
  await sync(a);
  assert.equal(a.db.customers[0].phone, "98000000");
});

test("'use the account's copy' replaces the local edit", async () => {
  const s = new FakeServer();
  const a = device(s, "u"), b = device(s, "u");
  seed(a);
  await sync(a); await sync(b);
  a.db.products[0].rate = 120;
  b.db.products[0].rate = 99;
  await sync(a); await sync(b);
  A.resolveUseCloud(b.db, b.meta, "products", b.db.products[0]._uid);
  assert.equal(b.db.products[0].rate, 120);
  await sync(b);
  assert.equal(A.pendingSummary(b.db, b.meta).count, 0);
});

test("edited here but deleted elsewhere is a conflict", async () => {
  const s = new FakeServer();
  const a = device(s, "u"), b = device(s, "u");
  seed(a);
  await sync(a); await sync(b);
  a.db.products = [];
  b.db.products[0].rate = 130;
  await sync(a); await sync(b);
  assert.equal(b.meta.conflicts.length, 1);
  assert.equal(b.db.products.length, 1, "the edited copy is still here to choose");
});

test("number counters on a business merge by taking the higher value", async () => {
  const s = new FakeServer();
  const a = device(s, "u"), b = device(s, "u");
  seed(a);
  await sync(a); await sync(b);
  a.db.businesses[0].nextInv = 3;
  b.db.businesses[0].nextInv = 5;
  b.db.businesses[0].nextQt = 2;
  await sync(a); await sync(b); await sync(a);
  assert.equal(b.meta.conflicts.length, 0);
  assert.equal(a.db.businesses[0].nextInv, 5);
  assert.equal(a.db.businesses[0].nextQt, 2);
});

test("a write that succeeded but whose reply was lost is not duplicated", async () => {
  const s = new FakeServer();
  const a = device(s, "u");
  seed(a);
  s.dropNextResponse = true;
  await assert.rejects(sync(a), (e) => e.network);
  assert.equal(s.t.bizdoc_businesses.size, 1, "the server did get it");
  await sync(a);
  assert.equal(s.t.bizdoc_businesses.size, 1, "and still has exactly one");
  assert.equal(A.pendingSummary(a.db, a.meta).count, 0);
  assert.equal(a.meta.conflicts.length, 0);
});

test("offline: changes stay pending, nothing is marked synced, and they upload later", async () => {
  const s = new FakeServer();
  const a = device(s, "u");
  seed(a);
  s.offline = true;
  await assert.rejects(sync(a), (e) => e.network);
  assert.equal(A.pendingSummary(a.db, a.meta).count, 4);
  assert.equal(Object.keys(a.meta.base.businesses).length, 0, "no record recorded as uploaded");
  s.offline = false;
  await sync(a);
  assert.equal(A.pendingSummary(a.db, a.meta).count, 0);
});

test("pending state survives a restart (it is derived from what is stored)", async () => {
  const s = new FakeServer();
  const a = device(s, "u");
  seed(a);
  await sync(a);
  a.db.products[0].rate = 150;
  // "Restart": everything goes through JSON, as localStorage does.
  const restarted = { db: A.normalizeDB(clone(a.db)), meta: clone(a.meta), api: s.api("u") };
  assert.equal(A.pendingSummary(restarted.db, restarted.meta).count, 1);
  await sync(restarted);
  assert.equal(s.live("bizdoc_products", "u")[0].data.rate, 150);
});

test("a duplicated record that copied the original's uid gets its own", async () => {
  const s = new FakeServer();
  const a = device(s, "u");
  seed(a);
  await sync(a);
  const copy = { ...a.db.products[0], id: nextId(a.db, "prod"), description: "PVC pipe 1in (copy)" };
  a.db.products.push(copy);
  await sync(a);
  assert.equal(s.live("bizdoc_products", "u").length, 2);
  assert.notEqual(a.db.products[0]._uid, a.db.products[1]._uid);
  assert.equal(s.live("bizdoc_products", "u").find((r) => r.local_id === a.db.products[0].id).data.description, "PVC pipe 1in");
});

test("undo after the delete already synced brings the record back", async () => {
  const s = new FakeServer();
  const a = device(s, "u");
  seed(a);
  await sync(a);
  const gone = a.db.products.pop();
  await sync(a);
  assert.equal(s.live("bizdoc_products", "u").length, 0);
  a.db.products.push(gone);
  await sync(a);
  assert.equal(s.live("bizdoc_products", "u").length, 1);
  assert.equal(A.pendingSummary(a.db, a.meta).count, 0);
});

test("signed-out data merges into an account without touching what is there", async () => {
  const s = new FakeServer();
  const acct = device(s, "u");
  seed(acct);
  await sync(acct);
  const before = acct.db.documents.map((d) => A.canonJSON(d));
  const local = device(s, "nobody");
  const l = seed(local);
  const counts = A.mergeIntoAccount(acct.db, acct.meta, clone(local.db));
  same({ ...counts }, { businesses: 1, customers: 1, products: 1, documents: 1 });
  same(acct.db.documents.slice(0, 1).map((d) => A.canonJSON(d)), before, "existing records untouched");
  const doc = acct.db.documents[1], biz = acct.db.businesses[1];
  assert.equal(doc.businessId, biz.id);
  assert.equal(doc.customerId, acct.db.customers[1].id);
  assert.equal(doc.lineItems[0].productId, acct.db.products[1].id);
  assert.notEqual(biz.id, l.biz.id, "renumbered clear of the account's own");
  await sync(acct);
  assert.equal(s.live("bizdoc_documents", "u").length, 2);
  assert.equal(A.pendingSummary(acct.db, acct.meta).count, 0);
});

test("one user's sync never sees another user's rows", async () => {
  const s = new FakeServer();
  const u1 = device(s, "user-1"), u2 = device(s, "user-2");
  seed(u1);
  await sync(u1);
  await sync(u2);
  assert.equal(u2.db.businesses.length, 0);
  seed(u2);
  await sync(u2);
  assert.equal(s.live("bizdoc_businesses", "user-1").length, 1);
  assert.equal(s.live("bizdoc_businesses", "user-2").length, 1);
});

test("a record whose business is gone is reported, not uploaded with a broken link", async () => {
  const s = new FakeServer();
  const a = device(s, "u");
  seed(a);
  a.db.products.push({ id: nextId(a.db, "prod"), businessId: 999, description: "Orphan" });
  await sync(a);
  assert.equal(Object.keys(a.meta.failed).length, 1);
  assert.equal(s.live("bizdoc_products", "u").length, 1);
});

test("signed in, data lives under the account's own key; the device's data is untouched", () => {
  A.store.clear();
  A.setAccount(null);
  A.setDB(A.normalizeDB({ businesses: [{ id: 1, name: "Device biz" }] }));
  A.saveDB();
  assert.equal(A.activeDbKey(), A.DB_KEY);
  A.setAccount({ id: "acct-1", email: "a@example.com" });
  A.setDB(A.normalizeDB({ businesses: [{ id: 1, name: "Account biz" }] }));
  A.saveDB();
  assert.equal(A.activeDbKey(), A.DB_KEY + ":user:acct-1");
  assert.equal(A.readDBAt(A.DB_KEY).businesses[0].name, "Device biz");
  assert.equal(A.readDBAt(A.activeDbKey()).businesses[0].name, "Account biz");
  // Another account's copy is never offered as "data saved on this device".
  A.store.set(A.DB_KEY + ":user:acct-2", JSON.stringify({ businesses: [{ id: 1, name: "Someone else" }] }));
  const offered = A.scanDeviceData().map((e) => e.names[0]).sort();
  same(offered, ["Account biz", "Device biz"]);
  A.setAccount(null);
  same(A.scanDeviceData().map((e) => e.names[0]), ["Device biz"]);
});
