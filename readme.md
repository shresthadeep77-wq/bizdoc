# PI & PO Maker

A single-page app for creating business documents — proforma invoices, purchase
orders, quotations, tax invoices and delivery notes — with PDF, PNG, print and
WhatsApp output.

Live: https://shresthadeep77-wq.github.io/bizdoc/

There is no server and no account. Everything you enter is stored in your own
browser (localStorage), which means **data is per browser and per device**. Use
Settings -> Data & backup to move it anywhere else.

## How the project is put together

- **No framework, no dependencies, no install.** Plain JavaScript that builds
  the screen with a small `el()` helper.
- `index.html` at the root is the whole app in one file — that is what GitHub
  Pages serves, and it works offline or straight off a `file://` path. The two
  PDF libraries sit beside it in `lib/` and are fetched only when needed.
- Around it sit a handful of ordinary HTML pages — the written guides — plus a
  custom `404.html`, a sitemap and a robots file.
- `src/` is the same code split up so it is comfortable to edit.
- `node build.js` builds all of it. It is the only build step.

```
src/
  index.html      app shell — <head>, meta tags, include markers
  styles.css      all styling, design tokens at the top (:root)
  pwa.js          registers the service worker / manifest (http(s) only)
  vendor/         bundled libraries: qrcode, html2canvas, jspdf
  app/            the app itself, numbered in load order
    00-money.js   every calculation involving money (see "The money")
  admin/          the /admin dashboard (see "The admin panel")
  site/           the written guide pages (see "The site around the app")
    pages.json    every route, its title, description and copy — one source
    layout.html   shared page shell for the guides and the 404
    site.css      styling for those pages only
    body-*.html   the prose of each page
build.js          the only build step
sw.js             service worker, so the app opens with no internet
tools/            the tests, plus the script that regenerates assets/
```

Built into the repo root, and served from there by GitHub Pages:

```
index.html                    the app
lib/jspdf.js, html2canvas.js  fetched only when someone exports
documents/ customers/ products/ offline/ privacy/    the guides
admin/                        the private usage dashboard (noindex)
404.html sitemap.xml robots.txt llms.txt
assets/  favicon.ico  icon.svg  manifest.webmanifest
```

`src/app/` files are numbered because they are concatenated into one shared
scope, so order matters. `src/app/_order.json` is the list the build reads —
if you add or rename a file, add it there too.

## Working on it

```
node build.js          rebuild everything from src/
node tools/test.js     run every check (npm test does the same)
node build.js --check  fail if the built files are stale (run before committing)
node build.js --single [out.html]
                       one fully self-contained file, libraries and all
node tools/make-assets.js
                       redraw the icons and the social card (needs Edge/Chrome)
```

There is a `package.json`, but it has no dependencies and nothing to install —
it exists only so `npm run build` and `npm test` work for people who expect
them. Every script is plain Node and runs the same way without npm.

## The tests

`node tools/test.js` runs all of these and stops at the first failure.

| Test | What it protects |
| --- | --- |
| `tools/test-money.js` | Every calculation involving money. Pure Node, instant. |
| `tools/test-document.js` | Renders real documents in headless Edge/Chrome and checks nothing falls off an A4 page, the printed column adds up to the subtotal, and every type still renders. |
| `tools/test-responsive.js` | Loads the app in an iframe at 320, 390, 768 and 1280px and checks nothing scrolls sideways, every button is big enough to tap, and every field has a label. |
| `tools/test-links.js` | Every internal link, the sitemap and robots.txt agree with each other. |

The two browser tests skip themselves if neither Edge nor Chrome is installed.
They need a browser because the things they catch — a table row that wraps onto
a third line and pushes the last row off the page — only exist once something
has actually laid the page out.

`node build.js` also refuses to build JavaScript that does not parse. The whole
app is one `<script>`, so a single stray character anywhere in `src/app/` used
to produce a blank white page with nothing in the build output to explain it.

## The money

Everything that touches an amount goes through `src/app/00-money.js`, and
`tools/test-money.js` covers it. The rules it exists to enforce:

- **Round like a person, not like a float.** `Math.round(n * 100) / 100` turns
  1.005 into 1.00, because the stored value is really 1.00499999999999989.
  `round2()` decides on the decimal digits instead.
- **Multiply in whole numbers.** `2.5 * 33.33` is 83.32499999999999, which
  rounds *down* and loses a paisa on every line like it. `mulExact()` multiplies
  25 by 3333 and puts the point back.
- **"Rate includes VAT" is a property of the product, so it is always honoured.**
  A product priced at 113 including 13% VAT is worth 100 plus 13 VAT — never 113
  with another 14.69 added on top.
- **What is printed always adds up to the totals beside it.** Whichever way a
  document is laid out, the TOTAL AMOUNT column sums to the Subtotal underneath
  it, and Subtotal + VAT + charges is the grand total.

### The two layout switches

Both live in the builder's Charges step, and **neither changes a single figure
the customer owes.** `tools/test-money.js` runs six shapes of document through
both settings and insists the grand total and the taxable value come out
identical; if a change ever breaks that, the tests fail.

**Separate VAT from prices**

- *Off* (the default) — every price prints exactly as it was typed. A rate with
  no VAT in it, and a non-taxable product, are untouched; a VAT-inclusive rate
  still prints as the full 113 the customer pays. The totals block then states
  how much VAT is already inside those prices, so the arithmetic can be checked
  by hand.
- *On* — for products whose rate already includes VAT, the price prints without
  the VAT and the VAT goes in its own column. Everything else is left alone.

Same document, same total, stated two ways:

| | Subtotal | VAT to add | VAT already in prices | Total |
| --- | --- | --- | --- | --- |
| Off | 1,856 | 52 | 156 | **2,158** |
| On | 1,700 | 208 | – | **2,158** |

**Show the discount for each line** adds a DISCOUNT column with the percentage
off and the list price it came off, replacing the plain "TAX" column. It turns
itself on the first time a line is actually discounted, and stays wherever the
user puts it after that.

## Autosave

A document being built is written into Documents as a Draft every three seconds
(`src/app/21-document-builder.js`), so a closed tab or a flat battery cannot
lose it. From the first autosave it is a real document: it has an id, it takes
its number from the series, and it appears in the list with a Draft badge.
Pressing Save updates that same record — it never leaves a duplicate behind,
and never takes a second number. Nothing is written until there is a customer or
at least one line item, so opening the builder and changing your mind leaves
nothing behind.

Documents saved before this was fixed keep their stored totals — they may
already have been sent — but opening one shows a notice with what the figures
should be, and a button to correct it.

**Always edit `src/`, never the built files directly** — the next build
overwrites them. Then open `index.html` in a browser to see the change; there is
no dev server to start.

## The site around the app

The app is one page. The written guides beside it — `documents/`, `customers/`,
`products/`, `offline/`, `privacy/` — are separate, ordinary HTML pages, each
with its own title, meta description, canonical URL, single `<h1>` and
breadcrumb. They exist because a crawler can read them without running any
JavaScript, and because they load in about 16 KB rather than 400.

Everything about them comes from `src/site/pages.json`: the nav, the footer, the
breadcrumbs, `sitemap.xml` and `llms.txt` are all generated from that one list,
so a new page cannot end up missing from half of them. Add an entry, add a
matching `body-*.html`, rebuild.

Inside the app, each tab is a real address (`#/customers`, `#/products`,
`#/documents`). The browser tab, the heading and the breadcrumb follow it. The
canonical link deliberately does not — a fragment is not a separate URL.

### Structured data

`SoftwareApplication`, `Organization`, `WebSite` and `BreadcrumbList` are emitted
at build time, and every claim in them is true of the app as built. There is no
hardcoded `LocalBusiness`: this is a tool, not a business with a street address,
and inventing one would be structured-data spam. Instead the app emits a real
`LocalBusiness` at runtime from whatever the user has actually filled in under
Settings — fields they have left blank are left out rather than guessed at. See
`src/app/28-routing-seo.js`.

## The admin panel

`/admin/` is a private usage dashboard. Nothing in the app links to it, and it is
marked `noindex` and disallowed in `robots.txt`. Open it by typing the address.

It reads a usage log the app keeps in `localStorage` (see
`src/app/00-analytics.js`): an action name, a time, and a few small non-identifying
properties. It never records document contents, customer or product details, or
anything typed into a field.

**It measures one browser — this one.** A static site has no server, so a
visitor's browser never reports back. Visitor counts, active users and traffic
sources therefore cannot be measured at all, and the dashboard says so on every
one of those tiles rather than showing a zero. `src/admin/admin-data.js` holds a
`remoteSource` stub documenting exactly what a backend would have to provide to
fill them in.

There is no password on it, deliberately. Any password in frontend code is
downloaded by every visitor, and the data shown is already in this browser —
a login would be decoration, not protection. Real access control starts with a
backend; see the Settings page inside the panel.

### Why the PDF libraries are separate

jsPDF and html2canvas are about 550 KB together — larger than the whole rest of
the app — and are only touched when someone exports. They are written to `lib/`
and fetched on first use (`src/app/00-pdf-libs.js`), which takes `index.html`
from 943 KB to 411 KB on every visit. The service worker precaches them, so the
second export works offline.

The one thing that costs: a lone `index.html` copied somewhere with no `lib/`
folder beside it can do everything except export a PDF, and says so rather than
failing silently. `node build.js --single` produces a genuinely self-contained
file for that case.

## Where things live

| I want to change... | Look in |
| --- | --- |
| colours, spacing, fonts | `src/styles.css` (tokens in `:root` at the top) |
| what a saved document looks like | `src/app/23-preview-paginated-a4-book.js` |
| the new/edit document screen | `src/app/21-document-builder.js` |
| customers | `src/app/12-customers.js`, `13-customer-report.js` |
| products, categories, units | `src/app/14-products.js`, `17-products-views.js` |
| settings screens | `src/app/19-forms.js` |
| popups, confirmations | `src/app/20-modals.js` |
| loading/repairing saved data | `src/app/01-storage.js` |
| PDF / PNG / WhatsApp export | `src/app/24-share.js` |
| routing, page titles, structured data | `src/app/28-routing-seo.js` |
| any calculation involving money | `src/app/00-money.js` |
| what gets recorded for /admin | `src/app/00-analytics.js` |
| the admin dashboard | `src/admin/` |
| the guide pages' wording | `src/site/body-*.html` |
| titles, descriptions, the sitemap | `src/site/pages.json` |

---

# Git cheat sheet

**git check status**
git status


**git add changes**
git add .


**git commit changes**
git commit -m "Your commit message"


**git push code**
git push


**git push first time**
git push -u origin main


**git pull latest code**
git pull origin main


**git clone repository**
git clone https://github.com/your-username/your-repository.git


**git create new branch**
git branch branch-name


**git switch branch**
git checkout branch-name


**git create and switch branch**
git checkout -b branch-name


**git see all branches**
git branch


**git delete branch**
git branch -d branch-name


**git merge branch**
git checkout main
git merge branch-name


**git view commit history**
git log


**git view short commit history**
git log --oneline


**git undo last commit (keep changes)**
git reset --soft HEAD~1


**git undo last commit (remove changes)**
git reset --hard HEAD~1


**git remove file from git tracking**
git rm --cached filename


**git update remote URL**
git remote set-url origin https://github.com/your-username/your-repository.git


**git check remote repository**
git remote -v


**git stash changes**
git stash


**git restore stash changes**
git stash pop


**git discard file changes**
git checkout -- filename


**git fetch latest updates**
git fetch


**git compare changes**
git diff


**git tag release version**
git tag v1.0.0


**git push tag**
git push origin v1.0.0


**git delete remote branch**
git push origin --delete branch-name


**git delete local branch**
git branch -D branch-name


**git configure username**
git config --global user.name "Your Name"


**git configure email**
git config --global user.email "your-email@example.com"


**git view git configuration**
git config --list