# Runbook — putting SERPENT HQ online

Follow this top to bottom. Nothing here needs secrets pasted anywhere except
the places marked ⚠️ (your own dashboards/terminals, never into chat or the repo).

## 0. Prerequisites
- [ ] GitHub repo `serpent-hq` (private, exists)
- [ ] Vercel account connected to GitHub
- [ ] Supabase account: https://supabase.com → New project
      - Name: `serpent-hq`, region: EU Central, strong DB password (⚠️ store in a password manager)

## 1. Supabase database + security
1. In the Supabase dashboard open **SQL Editor → New query**.
2. Paste the entire contents of `supabase/schema.sql` → **Run**. This creates
   tables, the leaderboard view, RLS policies, and seeds the 6 starter contracts.
3. Open **Table Editor → contract_answers**: it should be empty. For each contract,
   add a row using `supabase/functions/check-answer/GENERATE_HASHES.md` to compute
   the SHA-256 of each normalized answer (⚠️ do this only in the dashboard; never
   commit hashes to the repo).
   - `ghost-domain` → 2019 · `impostor-handler` → varnyr · `rack-radiation` → ser
   - `forensic-first-contact` → west · `serpents-cipher` → 10 · `ghost-ship` → 7

## 2. Auth (magic links only)
1. Dashboard → **Authentication → Providers → Email**: ensure **Confirm email** is ON
   (this is what makes magic links work).
2. Leave signup open for the beta.
3. Under **Authentication → URL Configuration**, set Site URL to your final game URL
   (e.g. `https://play.hacktoria.com`) once it exists.

## 3. Answer-check Edge Function
In the dashboard: **Edge Functions → New Function → name it `check-answer`**, paste
`supabase/functions/check-answer/index.ts`, deploy. Supabase injects
`SUPABASE_SERVICE_ROLE_KEY` automatically; also set `SUPABASE_ANON_KEY`
as a secret (from Settings → API).
Test (expect `{"error":"unauthorized"}`):
`curl -X POST <function-url> -H 'Content-Type: application/json' -d '{"slug":"x","answer":"y"}'`

## 4. Deploy the game
1. Vercel → **Add New → Project → import `serpent-hq`**. Defaults are fine → Deploy.
2. Vercel → Project → **Settings → Environment Variables**, add:
   - `VITE_SUPABASE_URL` = your project URL (Settings → API)
   - `VITE_SUPABASE_ANON_KEY` = the anon/public key (safe to expose)
   - `VITE_CHECK_ANSWER_URL` = the Edge Function URL from step 3
   - ⚠️ Never add the service-role key anywhere in Vercel.
3. Redeploy once so the env vars are picked up.

## 5. Domain
In your DNS panel for hacktoria.com add:
```
play  CNAME  cname.vercel-dns.com.
```
Then Vercel → Project → Domains → add `play.hacktoria.com`.

## 6. Local development
```
npm install
npm run dev
```
Without env vars set, the game runs in **DEV MODE**: contracts are read from
`public/content/contracts/index.json` and checked locally (answers included).
Set `VITE_CHECK_ANSWER_URL` to switch to server checking.
