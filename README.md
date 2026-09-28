# Aoiro 青

Expense tracking, double-entry bookkeeping, tax calculation and advice for a
**foreign sole proprietor filing a blue return in Japan**.

It runs entirely in your browser, installs to an Android home screen, works
offline, and never sends your financial data anywhere — there is no server to
send it to.

---

## What it does

**Tracks money in three currencies.** Yen, dollars and rubles, with the exchange
rate locked per transaction and an audit trail behind it. When your bank converts
incoming dollars itself, you enter the yen it actually credited and the rate is
derived from that — the strongest possible evidence, and the least typing.

**Keeps real double-entry books.** Every entry posts a balanced journal entry,
builds a general ledger, and produces a balance sheet that reconciles. That is
what the ¥650,000 blue-return deduction is paid for; simple bookkeeping only earns
¥100,000.

**Calculates every levy, with the working shown.** Income tax, the reconstruction
surtax, resident tax, enterprise tax, consumption tax, national health insurance
and national pension — each with a line-by-line derivation and the statute it
rests on.

**Advises, in yen.** Each recommendation is re-run through the tax engine so it
can state what it actually saves. Compliance risks are ranked above savings.

**Handles the non-permanent resident rules properly**, including the remittance
ordering in 所得税法施行令 17条 and the traps that catch people out.

---

## The thing most people get wrong

If you are on a spouse visa doing freelance work for a foreign client, it is
tempting to think the income is foreign-source and therefore shielded by your
non-permanent resident status.

It almost certainly is not.

Business income is sourced **where the work is performed**. If you are sitting in
Japan when you do it, you have a permanent establishment here, and the income is
attributable to it — which makes it Japan-source and fully taxable from your first
day of residence. The client's location, the invoice currency, and which bank gets
paid change none of that.

And separately: anything paid **into a Japanese account is "paid in Japan"**
(国内払い) and taxable immediately, with no remittance analysis at all.

The non-permanent resident shelter is real, but it covers foreign rent, foreign
dividends, foreign interest and — most valuably — **capital gains on foreign
securities**, as long as they are paid abroad and stay abroad. If you hold
appreciated foreign assets, realising them before you cross five years of
residence is the single largest tax decision available to you.

The app is built around these rules rather than around the hopeful version, and
explains its reasoning on screen.

---

## Running it

No build step, no dependencies, no bundler.

```bash
npm run serve          # http://localhost:8080
```

Open the Network address it prints to try it on your phone over Wi-Fi.

```bash
npm test               # 57 assertions against hand-checked NTA figures
npm run smoke          # drives the real app in Chromium (needs Playwright)
npm run icons          # regenerate the PWA icons
```

`npm test` needs nothing but Node. Playwright is only for the browser test.

---

## Deploying to GitHub Pages

```bash
git add -A
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR-USERNAME/aoiro.git
git push -u origin main
```

Then in the repository: **Settings → Pages → Source → GitHub Actions**.

The included workflow runs the tests and publishes on every push to `main`. Your
app appears at `https://YOUR-USERNAME.github.io/aoiro/`.

Every path in the app is relative, so it works from that sub-path with no
configuration.

> **Make the repository private if you like** — GitHub Pages on a private repo
> needs a paid plan, but it changes nothing about your data either way. Nothing
> you enter is ever committed, uploaded, or transmitted. The repository holds the
> program; your phone holds the books.

---

## Installing on Android

1. Open the GitHub Pages URL in Chrome.
2. Menu (⋮) → **Add to Home screen** (or **Install app**).
3. Launch it from the home screen. It opens full-screen with no browser chrome
   and works with no connection.

Installing needs HTTPS, which GitHub Pages provides automatically.

---

## Where your data lives

In this browser, on this device, in IndexedDB. That is the whole story.

There is no account, no sync, no analytics, and no network request carrying your
figures. The only outbound request the app can make is an optional exchange-rate
lookup, which is clearly labelled as a reference rate and fails quietly offline.

**Which means: back up.** Clearing site data, switching browser, or resetting the
phone deletes your books permanently. Settings → Export writes one JSON file
holding everything. The app nags you about it, increasingly, and it is right to.

Keep the export next to your receipts. The tax office expects you to retain both
for seven years.

---

## How it is put together

```
index.html              app shell
manifest.webmanifest    PWA manifest, installable on Android
sw.js                   service worker: offline + installability

css/
  base.css              design tokens; light and dark are two selected palettes
  components.css        cards, forms, charts, sheets
  views.css             navigation and per-screen layout

js/
  app.js                boot, hash routing, render loop
  store.js              state and the single write path
  db.js                 IndexedDB persistence, export and restore
  derive.js             one cached derivation feeding every screen
  fx.js                 exchange-rate locking, validation, audit scoring

  tax/
    rates.js            every statutory figure, per year, with sources
    engine.js           the computation, with statutory rounding
    sourcing.js         Japan- vs foreign-source, and the remittance rules
    advisor.js          recommendations, priced by re-running the engine

  accounting/
    accounts.js         chart of accounts (勘定科目), mapped to form boxes
    journal.js          double-entry posting and the ledger
    reports.js          P&L, balance sheet, 青色申告決算書, CSV export
    depreciation.js     fixed assets and the three write-off treatments

  ui/                   DOM helpers, inline-SVG charts, icons
  views/                one module per screen
```

Two design decisions worth knowing about:

**Rates are data, not code.** `js/tax/rates.js` holds every statutory figure in a
frozen per-year object with source links and a `verified` date. Updating for a new
tax year means editing one file, and the app warns you on screen when the tables go
stale.

**Nothing computes twice.** `derive.js` produces one cached result that the
dashboard, the tax screen and the advisor all read, so they can never quietly
disagree about what you owe.

---

## Updating for a new tax year

1. Open `js/tax/rates.js`.
2. Copy the most recent `buildYear(...)` entry and adjust what the reform changed.
3. Update `meta.verified`.
4. Run `npm test`.

The figures most likely to move each year: the basic deduction, the national
pension premium, your municipality's health insurance rates, and the consumption
tax special measures.

Note that the 2025 reform's raised basic deduction has a **two-year bonus tier**
for lower incomes that lapses after 2026 — `rates.js` already models this, and 2027
reverts correctly.

---

## Limits you should know about

- **Health insurance figures are estimates.** Every municipality sets its own
  rates and revises them each April. Four presets ship with the app; override them
  from your own 保険料決定通知書 in Settings and the number becomes exact.
- **The ふるさと納税 ceiling is approximate.** It uses the standard approximation,
  which lands within a few percent. Leave headroom.
- **Enterprise tax category is your call.** Whether your work is 請負業 (taxed at
  5%) or falls outside the 70 listed categories (taxed at nothing) depends on what
  your contracts actually describe. Ask your prefectural tax office.
- **It does not file for you.** It produces the figures and the statements; you
  still enter them into e-Tax.

---

## This is not tax advice

It is a calculator and a rule-based reading of the general position, written by
someone who is not a tax professional. Every recommendation names the statute
behind it so you can check the reasoning.

Anything with real money attached is worth an hour with a 税理士 who works with
foreign residents. That hour usually pays for itself several times over — and this
app will make it a much shorter hour, because you will arrive with balanced books
and specific questions.

---

MIT licensed. See `LICENSE`.
