# Cash

A simple cash book. How much you have, what came in, what went out.

Runs entirely on your phone. No account, no server, nothing sent anywhere.

> This is the **`basic`** branch. The `main` branch has a much bigger version with
> double-entry bookkeeping and full Japanese tax calculation — useful once you
> register a business and need to file. This one is for tracking cash.

---

## What it does

- **Cash on hand** — one number, the biggest thing on the screen
- **Money out** — everyday spending in twelve plain categories
- **Money in** — kept separate by source: apartment rent, freelance, gifts, other
- **Foreign currency** — record dollars or rubles and the yen you actually got
- **Count my cash** — when the wallet disagrees with the app, recount and the
  difference is recorded honestly instead of quietly drifting
- **Passcode** — optional, and it genuinely encrypts your data rather than just
  hiding the screen

That is the whole app. Three screens.

---

## Money from abroad

You get rent from a flat you let out overseas, and freelance work. Enter the
amount in its own currency and then the **yen you actually received** — after the
exchange, after fees. That way your balance matches what is really in your hand,
and the recorded yen figure is the one that would matter on a tax return.

The two sources stay tagged separately all the way through. That is not
bureaucracy for its own sake: in Japan, rent from a foreign property and freelance
work you perform here are taxed under quite different rules, and having them
already separated is the difference between an hour's work and a weekend's.

**Worth knowing, even with no registered business:** freelance work you do while
living in Japan is taxable here from the first yen, whatever country the client is
in. There is no threshold that makes it invisible. Nothing to do about it today —
but keep the records, which is what this app is for. `docs/tax-guide.md` has the
detail when you need it.

---

## Your data

It lives in this browser, on this phone. There is no account and no sync, and
nothing you type is ever transmitted. The only network request the app can make is
an optional exchange-rate lookup, which works fine offline by simply not
happening.

### The passcode

Turning it on encrypts everything with AES-GCM, using a key stretched from your
passcode with 250,000 rounds of PBKDF2. Both come from the browser's own crypto —
nothing hand-rolled.

**The passcode is not stored anywhere.** That is what makes it work, and it means
nobody can recover your data if you forget it. Not you, not me, not a support
desk. The app says so before you turn it on.

### Back up

Settings → Save a backup writes one JSON file with everything in it. Do this
occasionally and keep it somewhere you will still have it if the phone goes in a
river.

Clearing your browser data, switching phone, or reinstalling deletes everything
otherwise. The backup file is plain text so it can always be restored — keep it
somewhere private.

---

## Running it

No build step, no dependencies.

```bash
npm run serve      # then open the Network address it prints, on your phone
npm test           # 24 checks: balance arithmetic, amount parsing, encryption
npm run smoke      # drives the real app in Chromium (needs Playwright)
```

`npm test` needs nothing but Node.

## Installing on your phone

1. Open the site in Chrome
2. Menu (⋮) → **Add to Home screen**
3. It opens full-screen, works offline, and keeps everything locally

Installing needs HTTPS, which GitHub Pages provides.

## Deploying

The GitHub Actions workflow publishes on push to **`main`**, which currently holds
the full accounting version. To make *this* one the live site, either:

```bash
git checkout main && git merge basic     # replace main with the simple version
```

or edit `.github/workflows/pages.yml` and change the trigger branch to `basic`.

---

## How it is built

```
index.html            the shell
css/app.css           one stylesheet, light and dark
sw.js                 offline support and installability

js/
  app.js              boot, lock screen, navigation
  store.js            state, storage, balance arithmetic
  crypto.js           passcode encryption
  money.js            currencies, parsing, formatting
  categories.js       the category lists
  ui.js               DOM helpers and icons
  views/
    home.js           balance, this month, breakdown
    history.js        everything, grouped by month
    entry.js          adding and editing
    settings.js       passcode, backup, currencies
```

Around 2,000 lines, against roughly 10,000 on `main`. Plain JavaScript, no
framework, no build.

Two things worth knowing if you change it:

**Amounts are stored twice** — what you received (`amount` + `currency`) and what
it was worth (`jpy`). Every total uses `jpy`. Never total the `amount` field
across currencies.

**Adjustments carry their own sign.** A cash count that comes up short stores a
negative `jpy`, so `signedJpy` adds it rather than subtracting. That keeps a
shortfall visible as its own entry instead of silently altering the numbers you
already recorded.

---

MIT licensed.
