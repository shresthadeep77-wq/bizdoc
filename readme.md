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
  Pages serves, and what works offline or straight off a `file://` path.
- `src/` is the same code split up so it is comfortable to edit.
- `node build.js` concatenates `src/` back into `index.html`.

```
src/
  index.html      page shell — <head>, meta tags, include markers
  styles.css      all styling, design tokens at the top (:root)
  pwa.js          registers the service worker / manifest (http(s) only)
  vendor/         bundled libraries: qrcode, html2canvas, jspdf
  app/            the app itself, numbered in load order
build.js          the only build step
sw.js             service worker, so the app opens with no internet
manifest.webmanifest, icon.svg    install-to-home-screen
```

`src/app/` files are numbered because they are concatenated into one shared
scope, so order matters. `src/app/_order.json` is the list the build reads —
if you add or rename a file, add it there too.

## Working on it

```
node build.js          rebuild index.html from src/
node build.js --check  fail if index.html is out of date (run before committing)
```

**Always edit `src/`, never `index.html` directly** — the next build overwrites
it. Then open `index.html` in a browser to see the change; there is no dev
server to start.

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