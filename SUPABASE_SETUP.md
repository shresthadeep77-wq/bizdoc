# Google sign-in and cloud sync (Supabase)

BizDoc works exactly as before for anyone who never signs in: everything stays in
the browser, on the device. Signing in with Google is **optional** and adds a
private copy of the user's businesses, customers, products and documents in
Supabase, kept in sync across their devices and usable offline.

This file covers how it is built, the one-time dashboard setup, how to test it,
and what it does not do.

---

## 1. Architecture

```
 Browser (GitHub Pages, static)                         Supabase
 ┌─────────────────────────────────────────┐            ┌──────────────────────────────┐
 │ db (in memory)  ──saveDB()──▶ localStorage│            │ Auth (Google provider)       │
 │   signed out:  pipomaker_v1              │  PKCE      │                              │
 │   signed in:   pipomaker_v1:user:<uid>   │◀─OAuth────▶│ Postgres, RLS on every table │
 │ sync state:    pipomaker_sync:<uid>      │            │   bizdoc_businesses          │
 │                                          │  RPC over  │   bizdoc_customers           │
 │ 29-cloud-sync-core  diff / merge rules   │  HTTPS     │   bizdoc_products            │
 │ 30-cloud-auth       session, sync loop   │◀──────────▶│   bizdoc_documents           │
 │ 31-cloud-ui         status, panels       │            │ bizdoc_push / bizdoc_pull    │
 └─────────────────────────────────────────┘            └──────────────────────────────┘
```

- **No framework, no server of our own.** The app is still the static page that
  `node build.js` produces. The browser talks to Supabase directly. GitHub Pages
  does not need anything new.
- **Supabase client:** the official `@supabase/supabase-js` **2.117.2** UMD build,
  vendored in `src/vendor/supabase.js` and written to `lib/supabase.js` by the
  build. It is fetched only when someone signs in, or when the browser already
  has a signed-in account. The service worker precaches it so a signed-in device
  opens offline. Signed-out visitors never download it.
- **`@supabase/ssr` is not used.** It exists for server-rendered frameworks that
  keep the session in cookies; this app has no server code that could read a
  cookie. supabase-js keeps the session in `localStorage` (key `bizdoc-auth`)
  and refreshes it itself. The app never reads or copies tokens.
- **OAuth flow:** PKCE. `signInWithOAuth` sends the browser to Google through
  Supabase, which sends it back to `https://shresthadeep77-wq.github.io/bizdoc/?code=…`.
  supabase-js swaps the code for a session, and the app strips `?code` from the
  address bar and restores the tab (`#/products` etc.) the user started from.

### Where data lives, per state

| State | What the screen shows | Stored under | Uploads? |
|---|---|---|---|
| Signed out | this device's own data | `pipomaker_v1` (unchanged from before) | never |
| Signed in | that account's copy | `pipomaker_v1:user:<user id>` | yes, when online |
| Session ended (expired/revoked) | the account's copy, still editable | same | no — "Sign in again" |
| Signed out after being signed in | this device's own data again | account copy kept unless removed | no |

Two people on one browser never see each other's data. Each account has its own
key. Another account's copy is never offered under "Data saved on this device",
and sync refuses to run if the signed-in user isn't the one the queued changes
belong to.

### Anonymous data is never uploaded on its own

The first time someone signs in on a device that already has signed-out data,
the app asks: **"Add this device's data to your account?"** Their choices:

- **Add to my account** copies the data in, with new ids that clash with nothing
  already in the account. The original stays on the device, untouched.
- **Not now** leaves everything as is. It can be done later from
  *Account & sync*.

---

## 2. Database

Migration: [`supabase/migrations/20261016000000_bizdoc_cloud_sync.sql`](supabase/migrations/20261016000000_bizdoc_cloud_sync.sql).
It is additive: four tables, one trigger function, two RPC functions. It drops
nothing and is safe to re-run.

### Tables

Each of the four tables has the same core columns:

| Column | Purpose |
|---|---|
| `id uuid` PK | made on the device that created the record, so offline records have their final id before upload |
| `owner_id uuid` | `auth.users.id`; defaults to `auth.uid()`; every policy keys off it |
| `local_id bigint` | the app's own number (customer 1001 is "Client No. C1001"); unique per owner |
| `data jsonb` | the record exactly as the app stores it |
| `version int` | bumped by the trigger on every write; the basis of conflict detection |
| `deleted bool` | soft delete, so deletions reach other devices and the last contents stay recoverable |
| `created_at`, `updated_at` | set by the trigger, never by the client |

Plus references, as **composite foreign keys that include `owner_id`**:

- `customers.business_id`, `products.business_id` and `documents.business_id`
  point at `(owner_id, id)` in `bizdoc_businesses`.
- `documents.customer_id` (nullable) points at `(owner_id, id)` in `bizdoc_customers`.

The owner is part of the key on purpose: Postgres checks foreign keys without
applying RLS, so a plain `business_id` reference would let one user attach
records to another user's business. With the owner in the key it can't happen.

**Why each record is one `jsonb` value rather than split into columns.** The app's
records are rich, change shape over time, and are all calculated in the browser:
VAT-inclusive rates, the 13% default, discount rules, totals, number formats.
Storing the record verbatim means none of that logic is duplicated or second-guessed
in SQL, and a field added to the app later syncs without a migration. `jsonb`
stores numbers as exact decimals (`113.00` stays `113.00`), so nothing is rounded
on the way through. The monetary maths stays where it already lives, in JavaScript.

**Line items stay inside their document.** They're a snapshot taken when the
document was made: a product's rate can change later, an issued invoice must not.
They're always read and written together with their document, so they share its
version.

**Generated PDFs are not stored.** They're re-created from the document on demand,
so storing them would only duplicate data.

### RPC functions

Both are `SECURITY INVOKER`: they run as the calling user, so RLS applies to every
statement inside them, exactly as it would to a direct table write.

- `bizdoc_push(p_table, p_ops)` applies up to 500 writes in one request (a CSV
  import or bulk rate update is a handful of requests, not thousands). Each op
  carries the version it last saw. It returns one status per op:
  - `ok`
  - `conflict` — someone else wrote first; the current row comes back
  - `exists` — a retried insert; the existing row comes back
  - `id_taken` — another device used that number
  - `error`
- `bizdoc_pull(p_table, p_since, p_after, p_limit)` returns my rows changed after
  a point, using keyset pagination on `(updated_at, id)`.

### Row Level Security

RLS is enabled on all four tables, with explicit policies for each verb, all scoped
`to authenticated`:

| Verb | Rule |
|---|---|
| SELECT | `(select auth.uid()) = owner_id` |
| INSERT | `with check ((select auth.uid()) = owner_id)` |
| UPDATE | `using (… = owner_id) with check (… = owner_id)` — a row can't be handed to someone else |
| DELETE | `using (… = owner_id)` |

On top of the policies:

- **Grants:** `revoke all … from public, anon, authenticated`, then
  `grant select, insert, update, delete … to authenticated`. Signed-out visitors
  get no table access at all, and no `EXECUTE` on the RPCs.
- **Trigger:** refuses any change to `owner_id` or `id`. This also covers the
  service role, which bypasses RLS.
- **Size checks:** each row's `data` is capped (5 MB for a business, since it holds
  the logo and signature images, and 1–2 MB for the others), so a runaway client
  can't fill the database.

**Security assumptions:**
- The publishable key and project URL are public by design. They're in the page
  source and that's fine. Protection comes from RLS, not from hiding the key.
- No secret key, `service_role` key, database password or Google client secret is
  anywhere in the repository or the built site. `build.js` refuses to build if
  `sb_secret_…` or a non-`anon` JWT is configured.

---

## 3. One-time setup (manual — dashboards)

The code is done. These steps need your dashboard logins and can't be done from
the repository. Do them in this order.

### 3.1 Run the migration

1. Supabase dashboard → project **hxrbntfgtkhlemdqhxlv** → **SQL Editor** → *New query*.
2. Paste the whole of `supabase/migrations/20261016000000_bizdoc_cloud_sync.sql` and click **Run**.
   With the Supabase CLI instead, run
   `supabase link --project-ref hxrbntfgtkhlemdqhxlv`, then `supabase db push`.
3. New query: paste `supabase/tests/rls_two_users.sql` and click **Run**. The last
   result should be **`ALL RLS CHECKS PASSED`**. It creates two throwaway users
   inside a transaction and rolls everything back, so nothing is left behind. If
   your project has triggers on `auth.users`, they run too and are rolled back with it.
4. **Table Editor**: the four `bizdoc_*` tables should show *RLS enabled*. Also
   check **Database → Advisors (Security)**: there should be no warnings for
   these tables or functions.

If the project's **Data API** settings don't expose the `public` schema, enable it.
The app calls the two RPCs through the Data API.

### 3.2 Google Cloud — OAuth client

1. Open <https://console.cloud.google.com/> and select (or create) a project.
   The project that already holds the Drive-backup client (`875334449474-…`)
   works; give sign-in its **own** OAuth client.
2. **Google Auth Platform → Branding.** Set:
   - app name (e.g. *PI & PO Maker*)
   - user support email
   - developer contact email
   - **Authorized domains:** add `supabase.co`

   The consent screen will say "continue to hxrbntfgtkhlemdqhxlv.supabase.co".
   Showing your own domain there needs a Supabase custom domain.
3. **Audience:** *External*. While the app is in *Testing*, only the test users
   you list can sign in. **Publish** it to let anyone sign in. The scopes used
   (`openid`, `email`, `profile`) are non-sensitive, so publishing needs no
   Google review. Brand verification may still be asked for if you upload a logo.
4. **Data access → scopes:** `openid`, `.../auth/userinfo.email` and
   `.../auth/userinfo.profile`. Nothing else.
5. **Clients → Create client → Web application.** Name it e.g. *BizDoc Supabase sign-in*.
   - **Authorized JavaScript origins:**
     - `https://shresthadeep77-wq.github.io`
     - `http://localhost:8080` (local testing with `node tools/serve.js`)
   - **Authorized redirect URIs:** the callback URL Supabase shows you in step
     3.3. For this project it should be
     `https://hxrbntfgtkhlemdqhxlv.supabase.co/auth/v1/callback`, but copy it
     exactly from the dashboard.

   Note that this is Supabase's callback, not the app's address. Google returns
   to Supabase, and Supabase then returns to the app.
6. Copy the **Client ID** and **Client secret**.

### 3.3 Supabase — Google provider and URLs

1. **Authentication → Sign In / Providers → Google** → enable it.
   - Paste the **Client ID** and **Client secret** here, and only here. They
     never go in the repository or the frontend.
   - The **Callback URL** shown on this page is the one to put in Google's
     *Authorized redirect URIs* (step 3.2.5).
2. **Authentication → URL Configuration.**
   - **Site URL:** `https://shresthadeep77-wq.github.io/bizdoc/`
   - **Redirect URLs:** add both of these:
     - `https://shresthadeep77-wq.github.io/bizdoc/**`
     - `http://localhost:8080/bizdoc/**`

   The app asks to come back to its own address (`origin + path`, i.e.
   `…/bizdoc/`). An address that isn't on this list is silently replaced with
   the Site URL.
3. Optional: under **Authentication → Providers → Email**, turn off email sign-up
   if you want Google to be the only way in. The app offers only Google, but the
   API still accepts email sign-ups while that provider is on.

Until step 3.3.1 is done, the app's sign-in button says *"Google sign-in isn't
switched on for this app yet"* instead of sending people to an error page.

---

## 4. Build, run, deploy

There is still no `package.json` and nothing to install to build or run the app.

| Command | What it does |
|---|---|
| `node build.js` | builds everything from `src/` (now including `lib/supabase.js`) |
| `node build.js --check` | fails if the built files are stale; run it before committing |
| `node tools/serve.js` | serves the site at `http://localhost:8080/bizdoc/`, like GitHub Pages; needed to test sign-in locally |

**Configuration.** The project URL and publishable key live in
[`src/cloud.config.json`](src/cloud.config.json) and are compiled into
`index.html`. To build against another project, such as a staging one, set
`BIZDOC_SUPABASE_URL` and `BIZDOC_SUPABASE_PUBLISHABLE_KEY` in the shell (see
[`.env.example`](.env.example)). The build doesn't read `.env` files: GitHub Pages
serves the committed files as they are and runs no build, so there are no
deploy-time variables to supply.

**Deploy.** Same as always:
1. `node build.js`
2. Commit, including the built `index.html`, `lib/` and the rest.
3. Push to `main`. GitHub Pages publishes it.

The service worker cache was bumped to `pipo-v5`, so existing installs pick up the
new files on their next online visit.

**Updating supabase-js.** Download the version you want, replace
`src/vendor/supabase.js` with its `dist/umd/supabase.js`, and keep the one-line
header noting the version. Then rebuild.

```sh
npm pack @supabase/supabase-js@<version>
tar xzf supabase-supabase-js-<version>.tgz
```

---

## 5. How sync behaves

- **Saving is always local first.** Every edit is written to this browser
  immediately, as before. Sync then uploads it: about 2.5 seconds after the last
  edit, on reconnect, when the tab comes back into view, and every 5 minutes
  (every 30 seconds while anything is pending).
- **What counts as pending.** For each record the app remembers the version and a
  hash of what it last agreed with the cloud. Anything that differs is pending;
  anything gone is a pending delete. This is worked out from stored data, so
  pending changes survive refreshes, crashes and restarts, and retrying is always
  safe. A write whose reply was lost is recognised on retry, not duplicated.
- **What the status shows.** The topbar shows the real state: *Synced*, *N to
  upload*, *Offline · N*, *N to review*, *Sign in again* or *Sync error*. Nothing
  is shown as synced until the server has confirmed it.
- **Connectivity.** `navigator.onLine` is treated as a hint to try, never as proof.
  The status comes from whether Supabase actually answered. Failures back off from
  5 seconds up to 5 minutes.
- **Conflicts.** If the same record changed here and elsewhere, the server refuses
  the stale write and nothing is overwritten. *Account & sync → Review* shows both
  sides and which fields differ, and you choose. One exception: a business whose
  only differences are its number-series counters merges automatically, keeping
  the higher counter.
- **Clashing numbers.** If two offline devices create "product 41", the one
  uploaded second is renumbered, and everything pointing at it (line items,
  customers' documents, converted-from links) follows.

### Recovering from a failed sync

- Nothing that failed is thrown away. *Account & sync* lists any record the server
  refused, with the reason, and it stays on the device and is retried.
- **Export backup (JSON)** still works signed in and includes everything on the
  device, unsent changes too.
- If a device ever gets truly stuck, use this last resort:
  1. Export a backup.
  2. *Sign out → Sign out and remove from this device*.
  3. Sign in again; the account's data downloads fresh.
  4. Import the backup if anything was missing.

  Importing replaces the account's data, and the app says so before it does.

---

## 6. Testing

### Automated — run these

```sh
node build.js --check                 # built files match src/
node tools/test-sync.js               # 17 tests of the sync rules (fake server)
npm install --prefix .cache/pglite --no-save @electric-sql/pglite@0.5.8
node tools/test-rls.mjs               # migration + two-user RLS test on real Postgres (PGlite)
node tools/test-browser.mjs           # 24 checks in headless Chrome/Edge, served under /bizdoc/
```

- **`test-sync.js`** covers:
  - upload with owner-scoped references
  - a second device receiving identical data
  - VAT-inclusive rates surviving the round trip
  - edits and deletions propagating
  - offline number clashes, with references following the renumbered record
  - edit/edit and edit/delete conflicts, and both resolutions
  - business counter merging
  - lost replies not duplicating records
  - offline queueing and restart survival
  - duplicated uids
  - undo after a synced delete
  - merging signed-out data into an account
  - user isolation
  - per-account storage keys
- **`test-rls.mjs`** runs the real migration (twice, to prove it's re-runnable)
  and `supabase/tests/rls_two_users.sql` on Postgres 17 in WebAssembly. It uses a
  shim of Supabase's roles, `auth.uid()` and its permissive default grants, so a
  missing `REVOKE` would fail the run.
- **`test-browser.mjs`** checks:
  - the signed-out app never loads the library
  - the disabled-provider message appears
  - a signed-in device opens its own account's data with no session
  - sign-out returns to the device's data and clears the session
  - an OAuth error return is explained and cleaned from the address bar
  - no horizontal scroll at 375 px
  - PDF libraries still load
  - the new service-worker cache holds `lib/supabase.js`
  - no page errors

### Manual — needs the dashboard setup and real Google accounts

These can't be automated from the repository. Run them once after section 3:

1. Sign in with Google on the live site. You come back to the tab you started
   from, and the status turns *Synced*.
2. Refresh; still signed in. Close and reopen the browser; still signed in.
3. Create a business, a customer, a product and an invoice. In Supabase's Table
   Editor the rows appear under your user id.
4. Sign in on a second device or browser: everything appears. Edit there, then
   refocus the first device: the edit arrives.
5. Go offline (DevTools → Network → Offline):
   - Edit something; the status shows *Offline · 1*.
   - Reload while offline; the app opens and the edit is still pending.
   - Go back online; it uploads.
6. Edit the same customer on both devices while one is offline, then reconnect.
   *1 to review* appears; resolve it either way.
7. Sign out, then sign in with a **second Google account**. None of the first
   account's data is visible. Repeat `rls_two_users.sql` if in doubt.
8. Cancel on Google's consent screen. The app says sign-in was cancelled and
   nothing changes.
9. Make a PDF of an invoice signed in: unchanged from before.

---

## 7. Limitations and next steps

- **Shared origin on github.io.** Every site published under
  `shresthadeep77-wq.github.io` shares one browser origin. That means one
  `localStorage`, including this app's data and its sign-in session. Any page
  you publish under that name can read them. Keep only trusted pages there, or
  move BizDoc to its own (custom) domain. This is the most important caveat.
- **Storage size.** Data is still in `localStorage` (about 5 MB per origin,
  shared as above). IndexedDB was considered, but the whole app loads its data
  synchronously at start-up, and moving to it means an asynchronous boot
  rewrite. Large logos are the main risk; the existing "storage may be full"
  warning still applies.
- **Document numbers.** Two devices issuing invoices offline at the same time can
  both issue the same number before they sync. The counters merge to the higher
  value afterwards, but numbers already issued are not changed. Issue numbered
  documents from one device at a time when offline.
- **Client numbers.** A customer created on two devices offline at once may be
  renumbered (a different "Client No.") on the device that syncs second.
- **Conflict granularity.** Conflicts are whole-record choices, not field-by-field
  merges, except for business number counters.
- **No live push.** Other devices' changes arrive on the next sync (focus,
  reconnect, or every 5 minutes), not instantly. Supabase Realtime could be added.
- **Deleted records** are kept as tombstones in the cloud. There's no in-app
  "restore deleted"; recover through the Table Editor if ever needed.
- **Account deletion** is not in the app. Delete the user under Authentication →
  Users; their rows go with it (`on delete cascade`).
- **Multiple tabs.** Switching account in one tab stops sync in the others until
  they're reloaded, by design, so nothing can upload into the wrong account.
- **The /admin dashboard** counts the records on screen for the signed-in account.
  Its usage log is never uploaded.
- **Page size.** The sync code adds about 64 KB (about 18 KB gzipped) to
  `index.html`. The library itself (213 KB) loads only for signed-in users.
- **Google Drive backup** is unchanged and independent of sign-in. It still uses
  its own OAuth client and asks for its own permission.
