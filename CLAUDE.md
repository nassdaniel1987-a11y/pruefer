# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Prüfer is a German-language holiday childcare management system ("Ferienversorgung"). It reconciles children's registrations (Liste A) against meal bookings from a caterer (Liste B) using fuzzy name matching, and handles billing/financial calculations.

## Tech Stack

- **Frontend:** React 18 single-page app, built with Vite
- **Backend:** Netlify Functions (Node.js serverless lambdas, CommonJS)
- **Database:** PostgreSQL on Neon (`DATABASE_URL` env var, SSL required)
- **Styling:** Tailwind CSS (built locally via PostCSS) over Material-3 CSS variables
- **Excel:** XLSX library, loaded on demand

## Commands

```bash
npm run dev          # Start Vite dev server (port 5173)
npm run build        # Production build to dist/
npm run preview      # Preview production build
npm test             # Run the test suite (node:test)
npx netlify dev      # Full local dev with functions (port 8888, proxies to Vite)
```

Local development requires `npx netlify dev` to run both the frontend and serverless functions together. The Vite config proxies `/.netlify/functions` to `localhost:8888`.

There is no lint script.

## Architecture

### Frontend

`src/App.jsx` (~240 lines) is only the shell: auth check, theme handling (light / dark / aurora), history-based routing off `window.location.pathname`, a 30-minute inactivity logout, and the sidebar layout. Every page lives in its own component under `src/components/` — the largest are `AbgleichTool.jsx` (reconciliation wizard) and `KinderVerzeichnis.jsx` (child directory).

There is no router library; navigation is state plus `history.pushState`.

Shared helpers live in `src/utils/`:

| File | Purpose |
|------|---------|
| `api.js` | Central `API` object, Bearer token from `localStorage`, 401 forces re-login |
| `matching.js` | **Canonical** name-matching implementation (see below) |
| `helpers.js` | `normalizeDate`, date formatting, score classes |
| `xlsx.js` | `ladeXLSX()` — dynamic import so the Excel library stays out of the initial bundle |
| `diff.js`, `print.js`, `toast.jsx`, `confirm.jsx` | Diffing, printing, notifications, confirm dialogs |

### Styling

Tailwind is compiled at build time (`tailwind.config.js` + `postcss.config.js`), **not** loaded from a CDN. Colors map onto CSS variables defined in `src/style.css`; themes switch by setting a class on `<html>`.

Note: opacity modifiers on the custom colors (e.g. `border-outline-variant/20`) do not take effect, because the variables hold complete hex values rather than channel values. Tailwind then falls back to its default border color.

### Backend (Netlify Functions)

Each function in `netlify/functions/` is a standalone handler — one per domain. They multiplex operations through an `action` field in the POST body and each validate the Bearer token against the `sessions` table.

| Function | Purpose |
|----------|---------|
| `auth.js` | Login/logout/token validation/password change, user management. Locks an account for 15 minutes after 5 failed attempts (`login_versuche`) |
| `ferienblock.js` | Holiday block CRUD |
| `kinder.js` | Children master data, sync from lists, import |
| `listen.js` | Bulk import of Liste A and Liste B; supports a merge mode (`merge_von`/`merge_bis`) that replaces only a date range instead of the whole block |
| `kitafino.js` | Fetches Liste B straight from the caterer's facility portal (see below) |
| `abgleich.js` | Save/load reconciliation matches, dashboard stats, propagates `kitafino_id` onto children |
| `angebote.js` | Activity offers with day and child assignments |
| `finanzen.js` | Financial calculations per child |
| `backup.js` | Full data export/import |
| `einstellungen.js` | Key/value app settings (allow-listed keys only) and the automation log |
| `taeglicher-abgleich.js` | **Scheduled** daily run (see below). Exports `fuehreAus` — the actual job |
| `automatik-jetzt.js` | Triggers the same job over HTTP for the "Jetzt testen" button, since a `schedule()`-wrapped handler is not reachable via HTTP |
| `setup-db.js` | Initial schema creation. **Protected** — needs `SETUP_SECRET` or a valid session |
| `migrate.js` | Idempotent schema migrations. **Protected** the same way |

Shared function helpers in `netlify/functions/utils/`:

- `datum.js` — `toYmd()`, the single correct way to turn a DB date into `YYYY-MM-DD` (see pitfall below)
- `nameMatch.js` — CommonJS mirror of `src/utils/matching.js`
- `guard.js` — access check for the maintenance endpoints
- `import.js` — bulk import for both lists, incl. merge mode and import log. Used by `listen.js` and the scheduled run
- `kitafinoClient.js` — all portal knowledge (login, roster, per-day fetch)
- `firebase.js` — decrypts and shapes Liste A from the Firebase realtime DB
- `vergleich.js` — server-side reconciliation (see below)
- `bericht.js` / `mail.js` — daily report as HTML/text, and the Resend transport

### Daily automatic reconciliation

`taeglicher-abgleich.js` runs `schedule('1 7,8 * * *', …)`. Netlify schedules in
**UTC only**, so 09:01 German time shifts with daylight saving — hence two cron
candidates plus a check whether it is currently 9 o'clock in `Europe/Berlin`.

The job only runs when a Ferienblock covers today. It fetches both lists, imports
them, computes the comparison, saves it as a **new** Abgleich (leaving previous
ones untouched), mails the report, and writes to `automatik_log` — including on
failure, so a silent breakdown becomes visible. A failed run also triggers its
own mail; the log alone would go unnoticed.

**Scope:** the comparison always covers the whole block, but the mail lists only
**today's** discrepancies (block-wide totals stay in the header). Reporting the
full block would repeat the same entries every morning for weeks.

**Automatic matching only accepts scores ≥ 75** (`STRONG_MATCH_THRESHOLD`).
Pairs between 60 and 74 are deliberately *not* matched; they are returned as
`unsicher` and listed in their own section of the mail. Consequence to keep in
mind: those entries also appear under `nur_in_a` / `nur_in_b` in the stored
Abgleich, because there is no match type for "undecided".

Functions have their own `package.json` with `pg` and `bcryptjs`, and stay CommonJS even though the frontend package is `"type": "module"`.

### Environment variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Neon connection string |
| `SETUP_SECRET` | Guards `setup-db` and `migrate` (passed as `?secret=` or `X-Setup-Secret`) |
| `SETUP_ADMIN_PASSWORD` | Optional. Otherwise `setup-db` generates a random admin password and returns it once |
| `KITAFINO_USER`, `KITAFINO_PASSWORD`, `KITAFINO_PROJEKT_ID` | Caterer portal credentials |
| `FIREBASE_PASSWORD` | Decrypts the Liste A payload (password of the offline app) |
| `RESEND_API_KEY` | Mail delivery |
| `MAIL_ABSENDER` | Sender address. Defaults to the Resend test sender, which only delivers to the Resend account owner |
| `MAIL_EMPFAENGER` | Fallback recipient when none is configured in the settings |

### Database

PostgreSQL with cascading foreign keys. Core tables: `users`, `sessions`, `login_versuche`, `ferienblock`, `liste_a`, `liste_b`, `abgleich`, `abgleich_matches`, `import_log`, `kinder`, `angebote`, `angebot_tage`, `angebot_kinder`.

Schema is initialized via `setup-db` and evolved via `migrate`. Both are idempotent.

### Name Matching (core business logic)

`src/utils/matching.js` is the canonical implementation; `netlify/functions/utils/nameMatch.js` is a CommonJS mirror of it. They cannot be a single module because the frontend is ESM and the functions are CommonJS. **Any change must be made in both files** — `tests/matching.test.mjs` compares them over a corpus of name pairs and fails otherwise.

The algorithm combines:
- **Jaro-Winkler** distance for string similarity
- **Kölner Phonetik** for German phonetic matching
- Token comparison with nickname mappings (Alex→Alexander)
- Penalties for missing/extra tokens, plus a surname gate (≥0.82 similarity or a phonetic match)

The surname gate accepts *any* matching token pair, so a shared first name already satisfies it. That is why `AbgleichTool` additionally checks `hasSameFirstName` and routes those pairs to manual review rather than auto-matching them.

Thresholds live in `AbgleichTool.jsx`: `STRONG_MATCH_THRESHOLD = 75` (automatic), `REVIEW_MATCH_THRESHOLD = 60` (manual review).

### kitafino integration

The caterer has no documented API, so `kitafino.js` drives the same endpoints the facility portal itself uses:

- Login: `POST auth.kitafino.de/sys_k2/index.php?action=do_login` (`benutzername`, `passwort`, `rememberme`)
- Roster: `GET facility.kitafino.de/sys_k2/caterer/index.php?action=listen&pid=…` — the only place carrying the stable `kitafino_id` per child
- One day of bookings: `POST …?action=lib_orders_content` with `projekt_id, tag, monat, jahr`

Things that will bite you here:

- `auth` and `facility` each issue their **own** `PHPSESSID`. The cookie jar is keyed by name *and* domain; collapsing them logs you out of the portal.
- A failed login still answers HTTP 200 with the login mask, so success is verified explicitly by probing for the logout form.
- The day view emits every section **twice** with identical content — entries are deduplicated per day, otherwise every booking counts double.
- The "Gruppe/Klasse" column holds the facility name, not a class, and the balance column only holds categories ("über € 5"). Neither is imported.

## Pitfalls

**Dates from the database.** `node-postgres` returns `DATE` columns as JS `Date` objects at *local* midnight. Both obvious conversions are wrong:

- `String(datum).split('T')[0]` → `""`, because the string starts with `"Tue May 26 …"`
- `datum.toISOString().split('T')[0]` → one day early, because Germany is UTC+1/+2

Always use `toYmd()` from `netlify/functions/utils/datum.js`. In the frontend, values arrive as ISO strings through JSON, where `split('T')[0]` is fine.

## Conventions

- All UI text, data field names, and user-facing strings are in **German**
- Date handling must support Excel serial numbers, ISO format, and DD.MM.YYYY (`normalizeDate` in `src/utils/helpers.js`)
- Backend functions create a fresh `pg.Client` per request (no persistent pool)
- SQL queries use parameterized values (`$1`, `$2`) throughout — maintain this for injection safety
- Never commit credentials; they belong in Netlify environment variables
