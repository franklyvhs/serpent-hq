# SERPENT HQ

A browser-based, Zelda-style adventure set in the SERPENT headquarters,
by Hacktoria (hacktoria.com): walk HQ, open the Contract Console, solve
real-world OSINT contracts, climb the global scoreboard.

- **Live:** https://play.hacktoria.com
- **Spec:** see the SERPENT HQ v2 Build Plan canvas
- **Status:** v0 skeleton (custom canvas renderer; Kaplay + Tiled land in M3)

## Quick start

```
npm install
npm run dev
```

Contracts are checked by the Supabase Edge Function `check-answer`
when `VITE_CHECK_ANSWER_URL` is set. Locally you can copy
`public/content/contracts/answers.dev.example.json` to
`answers.dev.json` (gitignored) to check answers without Supabase.

## Anti-cheat model

- Answers NEVER ship to the browser: not in this repo, not in the built site.
- Real answers live only in Supabase `contract_answers` as SHA-256 hashes,
  readable exclusively by the `check-answer` Edge Function (RLS: zero policies).
- Points are computed server-side; the client never reports its own score.

## Layout

```
index.html              game shell + console modal markup
src/                    client code (main.ts, styles.css)
public/content/         public contract data (no answers)
supabase/schema.sql     one-shot database setup (tables, RLS, seed)
supabase/functions/     check-answer Edge Function (Deno)
docs/RUNBOOK.md         step-by-step deployment
```

## Authoring contracts

Add a JSON object to `public/content/contracts/index.json`, and matching rows
in `contracts` + `contract_answers` (see `docs/RUNBOOK.md` and
`supabase/functions/check-answer/GENERATE_HASHES.md`).

> Build pipeline note (2026-11-21): Tiled maps must have every tile layer data array at width*height; loader rejects malformed maps.
