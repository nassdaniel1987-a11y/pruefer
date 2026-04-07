# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Prüfer is a German-language holiday childcare management system ("Ferienversorgung"). It reconciles children's registrations (Liste A) against meal bookings from a caterer (Liste B) using fuzzy name matching, and handles billing/financial calculations.

## Tech Stack

- **Frontend:** React 18 single-page app, built with Vite
- **Backend:** Netlify Functions (Node.js serverless lambdas)
- **Database:** PostgreSQL on Neon (`DATABASE_URL` env var, SSL required)
- **Styling:** Custom CSS with CSS variables and dark mode support (no framework)
- **Excel:** XLSX library for import/export

## Commands

```bash
npm run dev          # Start Vite dev server (port 5173)
npm run build        # Production build to dist/
npm run preview      # Preview production build
npx netlify dev      # Full local dev with functions (port 8888, proxies to Vite)
```

Local development requires `npx netlify dev` to run both the frontend and serverless functions together. The Vite config proxies `/.netlify/functions` to `localhost:8888`.

There are no test or lint scripts configured.

## Architecture

### Frontend

The entire UI lives in **`src/App.jsx`** (~4500 lines) as a single monolithic React component. All pages (Dashboard, Kinder, Angebote, Abgleich, Finanzen, etc.) are conditional renders based on `page` state. There is no router — navigation is state-driven.

A centralized `API` object (top of App.jsx) handles all backend calls with Bearer token auth from `localStorage`.

### Backend (Netlify Functions)

Each function in `netlify/functions/` is a standalone serverless handler — one per domain:

| Function | Purpose |
|----------|---------|
| `auth.js` | Login/logout/token validation/password change |
| `ferienblock.js` | Holiday block CRUD |
| `kinder.js` | Children master data, sync from lists, import |
| `listen.js` | Bulk import Liste A (registrations) and Liste B (meal bookings) |
| `abgleich.js` | Save/load reconciliation matches, dashboard stats |
| `angebote.js` | Activity offers with day and child assignments |
| `finanzen.js` | Financial calculations per child |
| `backup.js` | Full data export/import |
| `setup-db.js` | Initial schema creation (GET to run) |
| `migrate.js` | Idempotent schema migrations (GET to run) |

Functions use POST with an `action` field in the body to multiplex operations. Each function independently validates the Bearer token against the `sessions` table. Functions have their own `package.json` in `netlify/functions/` with `pg` and `bcryptjs` dependencies.

### Database

PostgreSQL with cascading foreign keys. Core tables: `users`, `sessions`, `ferienblock`, `liste_a`, `liste_b`, `abgleich`, `abgleich_matches`, `kinder`, `angebote`, `angebot_tage`, `angebot_kinder`.

Schema is initialized via the `setup-db` function and evolved via `migrate`. Both are idempotent.

### Name Matching (Core Business Logic)

The reconciliation engine in `App.jsx` (lines ~147-256) uses:
- **Jaro-Winkler distance** for string similarity
- **Kölner Phonetik** for German phonetic matching
- Token-based name comparison with nickname mappings (e.g., Alex→Alexander)
- Penalty system for missing/extra tokens, with a surname quality gate (≥0.82 similarity or phonetic match)

## Conventions

- All UI text, variable names in data, and user-facing strings are in **German**
- Date handling must support Excel serial numbers, ISO format, and DD.MM.YYYY (`normalizeDate` in App.jsx)
- Backend functions create a fresh `pg.Client` per request (no persistent pool)
- SQL queries use parameterized values (`$1`, `$2`) throughout — maintain this for injection safety
