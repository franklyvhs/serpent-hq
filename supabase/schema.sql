-- ============================================================
-- SERPENT HQ (a Hacktoria game) — Supabase schema v0.5
-- Run this once in the Supabase SQL editor (see docs/RUNBOOK.md).
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  codename text not null unique,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Every new auth user gets an auto-generated profile; they rename
-- themselves once, and codenames stay unique forever after.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, codename)
  values (new.id, 'agent-' || left(new.id::text, 8))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- contracts (metadata only; answers live elsewhere) ----------
create table public.contracts (
  slug text primary key,
  emoji text not null default '🧩',
  title text not null,
  discipline text not null,
  difficulty text not null check (difficulty in ('Easy','Medium','Hard')),
  points integer not null check (points > 0),
  display_order integer not null default 100,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- secret answers: NO client access, ever ----------
create table public.contract_answers (
  contract_slug text primary key references public.contracts(slug) on delete cascade,
  -- sha256 hex of the normalized answer, plus accepted aliases
  answer_hash text not null,
  alias_hashes text not null default '[]'  -- json array of sha256 hex strings
);

-- ---------- submissions (written only by the check-answer function) ----------
create table public.submissions (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  contract_slug text not null references public.contracts(slug) on delete cascade,
  correct boolean not null,
  submitted_at timestamptz not null default now()
);

-- Partial unique index: only one CORRECT submission per user per contract
-- (a UNIQUE constraint with WHERE is invalid in CREATE TABLE, hence this).
create unique index submissions_unique_correct
  on public.submissions (profile_id, contract_slug)
  where correct;

create index submissions_profile_idx on public.submissions (profile_id, submitted_at desc);
create index submissions_attempt_rate_idx on public.submissions (profile_id, submitted_at);

-- ---------- leaderboard view ----------
create or replace view public.leaderboard as
with scores as (
  select s.profile_id, sum(c.points) as total_points, count(*) as contracts_solved
  from public.submissions s
  join public.contracts c on c.slug = s.contract_slug
  where s.correct
  group by s.profile_id
)
select p.id, p.codename, p.avatar_url,
       coalesce(sc.total_points, 0) as points,
       coalesce(sc.contracts_solved, 0) as contracts_solved
from public.profiles p
left join scores sc on sc.profile_id = p.id;

-- ---------- Row Level Security ----------
alter table public.profiles enable row level security;
alter table public.contracts enable row level security;
alter table public.contract_answers enable row level security;
alter table public.submissions enable row level security;

-- profiles: public read, self update (codename rename)
create policy "profiles are public" on public.profiles for select using (true);
create policy "own profile update" on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

-- contracts: everyone can read enabled contracts
create policy "enabled contracts are public" on public.contracts for select using (enabled);

-- contract_answers: NO policies => inaccessible to all clients.
-- Only the service-role Edge Function can read it.

-- submissions: agents can read their OWN row history (score restore);
-- writes happen only via the service-role Edge Function.
create policy "agents read own submissions"
  on public.submissions for select
  using (auth.uid() = profile_id);

-- ---------- Grants ----------
-- LESSON (learned the hard way, 2026-11-20): RLS policies filter ROWS,
-- but roles also need table-level GRANTs, and SQL-editor-created tables
-- do not inherit all of them automatically. Explicit is better.
grant select on public.profiles to anon, authenticated;
grant update (codename, avatar_url) on public.profiles to authenticated;
grant select on public.contracts to anon, authenticated;
grant select on public.submissions to authenticated;
grant select on public.leaderboard to anon, authenticated;
-- service_role: used by the Edge Function. Needs full privileges, and on
-- new-generation projects (sb_secret_* keys) these grants do NOT exist
-- by default for hand-created tables either.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
-- contract_answers: intentionally NO grants to anon/authenticated.

-- ---------- seed contracts ----------
insert into public.contracts (slug, emoji, title, discipline, difficulty, points, display_order) values
  ('ghost-domain', '🌐', 'The Ghost Domain', 'Internet', 'Easy', 100, 10),
  ('impostor-handler', '🥸', 'The Impostor Handler', 'Social', 'Easy', 150, 20),
  ('rack-radiation', '💾', 'Rack Radiation', 'Data', 'Medium', 250, 30),
  ('forensic-first-contact', '🔎', 'Forensic First Contact', 'Forensics', 'Medium', 250, 40),
  ('serpents-cipher', '🧩', 'The Serpent''s Cipher', 'Logic', 'Easy', 100, 50),
  ('ghost-ship', '🚢', 'Ghost Ship of the Gulf', 'Maritime', 'Hard', 400, 60)
on conflict (slug) do nothing;

-- NOTE: seed contract_answers out-of-band (do not commit hashes to the repo).
-- One-shot seeding for the six fixture placeholder contracts:
--   insert into public.contract_answers (contract_slug, answer_hash) values
--     ('ghost-domain', encode(digest('2021','sha256'),'hex')), ... etc
--   on conflict (contract_slug) do update set answer_hash = excluded.answer_hash;
-- Real answers: hash locally, never in chat or the repo.
