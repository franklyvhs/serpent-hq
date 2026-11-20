# SERPENT HQ

A browser-based, Zelda-style adventure set in the SERPENT headquarters,
by Hacktoria (hacktoria.com): walk HQ, open the Contract Console, solve
real-world OSINT contracts, climb the global scoreboard.

- **Live:** play.hacktoria.com (once deployed)
- **Spec:** see the SERPENT HQ v2 Build Plan canvas
- **Status:** v0 skeleton (custom canvas renderer; Kaplay + Tiled land in M3)

## Quick start

```
npm install
npm run dev
```

Runs in DEV MODE: contracts are checked locally (answers in
`public/content/contracts/index.json`). In production the Supabase
Edge Function `check-answer` validates answers server-side; answers
never ship to the browser.

## Layout

```
index.html              game shell + console modal markup
src/                    client code (main.ts, styles.css)
public/content/         public contract data (answers stripped in prod)
supabase/schema.sql     one-shot database setup (tables, RLS, seed)
supabase/functions/     check-answer Edge Function (Deno)
docs/RUNBOOK.md         step-by-step deployment
```

## Authoring contracts

Add a JSON object to `public/content/contracts/index.json`, and matching rows
in `contracts` + `contract_answers` (see `docs/RUNBOOK.md` and
`supabase/functions/check-answer/GENERATE_HASHES.md`).

## Security model (short version)

- Answers live only in `contract_answers`, unreadable by any client (RLS, zero policies).
- Points are computed by the server from accepted submissions; the client never
  reports its own score.
- Codenames are unique; profiles are auto-created at first login.
