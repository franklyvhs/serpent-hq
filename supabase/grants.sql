-- ============================================================
-- SERPENT HQ — grants fix (run in the Supabase SQL editor if you
-- see 'permission denied for table ...' errors in the game).
-- RLS policies filter ROWS; grants allow the ROLE to touch the table.
-- ============================================================

-- Everyone: profiles are publicly readable (leaderboard uses this too)
grant select on public.profiles to anon, authenticated;
-- Logged-in agents: rename themselves (codename/avatar only)
grant update (codename, avatar_url) on public.profiles to authenticated;

-- Contracts: public read
grant select on public.contracts to anon, authenticated;

-- Submissions: agents may read THEIR OWN rows (RLS narrows to profile_id)
grant select on public.submissions to authenticated;

-- contract_answers: NO grants to anon/authenticated. Only the
-- service role (Edge Function) may read it. Intentional.
