-- Online PvP: one row per match, split across three tables by who may read it.
--
--   matches        -- everything both players may see (HP, meters, log, ...).
--                     Readable by the match's two players only.
--   match_hands    -- one row per player: that player's own hand.
--                     Each player can read only their own row.
--   match_secrets  -- the server's full battle (both hands, both decks) and
--                     each side's pending action for the current round.
--                     No policies at all, so only the Edge Function (which
--                     uses the service-role key) can touch it.
--
-- Clients never write to any of these directly: creating/joining a match and
-- submitting a move all go through the `game` Edge Function, which validates
-- the move and runs src/model/engine.js. That's what keeps a player from
-- reading the other side's hand or pending move out of the page -- see
-- "Architecture implications" in docs/DESIGN.md.

create table public.matches (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  status      text not null default 'waiting' check (status in ('waiting', 'active', 'finished')),
  p1          uuid not null references auth.users (id) on delete cascade,
  p2          uuid references auth.users (id) on delete cascade,
  p1_class    text not null,
  p2_class    text,
  round       integer not null default 0,
  -- "has this side locked in a move this round?" -- the move itself stays in
  -- match_secrets, only the fact that one exists is public.
  p1_ready    boolean not null default false,
  p2_ready    boolean not null default false,
  -- src/model/serialize.js publicFighters(): { player: p1, cpu: p2 }
  fighters    jsonb,
  log         jsonb not null default '[]'::jsonb,
  winner      text check (winner in ('p1', 'p2', 'draw')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.match_hands (
  match_id  uuid not null references public.matches (id) on delete cascade,
  player    uuid not null references auth.users (id) on delete cascade,
  hand      jsonb not null default '[]'::jsonb,
  primary key (match_id, player)
);

create table public.match_secrets (
  match_id   uuid primary key references public.matches (id) on delete cascade,
  battle     jsonb not null, -- src/model/serialize.js serializeBattle()
  round      integer not null,
  p1_action  jsonb,
  p2_action  jsonb
);

alter table public.matches enable row level security;
alter table public.match_hands enable row level security;
alter table public.match_secrets enable row level security;

create policy "players can read their own matches"
  on public.matches for select
  to authenticated
  using ((select auth.uid()) in (p1, p2));

create policy "players can read their own hand"
  on public.match_hands for select
  to authenticated
  using ((select auth.uid()) = player);

-- Belt and braces on top of RLS: the browser roles get read access to the two
-- readable tables and nothing else.
revoke all on public.matches, public.match_hands, public.match_secrets from anon, authenticated;
grant select on public.matches, public.match_hands to authenticated;

create index matches_p2_idx on public.matches (p2);
create index match_hands_player_idx on public.match_hands (player);

-- Live updates to the battle screen (Realtime respects the RLS above).
alter publication supabase_realtime add table public.matches, public.match_hands;
