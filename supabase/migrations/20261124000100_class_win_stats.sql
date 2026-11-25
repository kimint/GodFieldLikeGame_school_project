-- Win rate per class (for balancing, and the poster), for everyone and for
-- each player.
--
--   class_win_stats     -- all players: wins / draws / losses per (class, mode)
--   player_class_stats  -- the same per player (user_id, class, mode)
--     mode 'pvp' -- every PvP game, one row per side, counted by the
--                   match_history trigger below (random and room-code matches),
--     mode 'cpu' -- vs-CPU games, the player's class only, sent by the browser
--                   through record_cpu_game().
--   class_win_rates     -- class_win_stats with games and win rate worked out
--                          (draws count half), readable by everyone
--                          (the "Class stats" page, src/components/ClassStats.tsx).
--   my_class_win_rates  -- the same from player_class_stats; row-level
--                          security leaves each player only their own rows
--                          (the "My record" page).
--
-- match_history only keeps each player's last 5 games, so these totals are
-- the all-time numbers; existing match_history rows are counted once below.
-- vs-CPU results come from the browser, so treat the 'cpu' numbers as a
-- guide, not as tamper-proof.

create table public.class_win_stats (
  class_id    text not null,
  mode        text not null check (mode in ('pvp', 'cpu')),
  wins        integer not null default 0,
  draws       integer not null default 0,
  losses      integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (class_id, mode)
);

create table public.player_class_stats (
  user_id     uuid not null references auth.users (id) on delete cascade,
  class_id    text not null,
  mode        text not null check (mode in ('pvp', 'cpu')),
  wins        integer not null default 0,
  draws       integer not null default 0,
  losses      integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, class_id, mode)
);

alter table public.class_win_stats enable row level security;
alter table public.player_class_stats enable row level security;

create policy "class win stats are public"
  on public.class_win_stats for select
  to anon, authenticated
  using (true);

create policy "players can read their own class stats"
  on public.player_class_stats for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.class_win_stats, public.player_class_stats from anon, authenticated;
grant select on public.class_win_stats to anon, authenticated;
grant select on public.player_class_stats to authenticated;
grant select, insert, update, delete on public.class_win_stats, public.player_class_stats to service_role;

-- Add one game to the class's tally, overall and for that player.
create function public.count_class_result(p_user uuid, p_class text, p_mode text, p_result text) returns void
  language sql
  security definer
  set search_path = ''
as $$
  insert into public.class_win_stats as s (class_id, mode, wins, draws, losses)
  values (p_class, p_mode, (p_result = 'win')::int, (p_result = 'draw')::int, (p_result = 'loss')::int)
  on conflict (class_id, mode) do update set
    wins = s.wins + excluded.wins,
    draws = s.draws + excluded.draws,
    losses = s.losses + excluded.losses,
    updated_at = now();

  insert into public.player_class_stats as s (user_id, class_id, mode, wins, draws, losses)
  values (p_user, p_class, p_mode, (p_result = 'win')::int, (p_result = 'draw')::int, (p_result = 'loss')::int)
  on conflict (user_id, class_id, mode) do update set
    wins = s.wins + excluded.wins,
    draws = s.draws + excluded.draws,
    losses = s.losses + excluded.losses,
    updated_at = now();
$$;

-- The match_history trigger from *_match_history.sql, now also counting the
-- game toward the player's class.
create or replace function public.count_match_history() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.pvp_records as r (user_id, wins, draws, losses)
  values (new.user_id,
          (new.result = 'win')::int, (new.result = 'draw')::int, (new.result = 'loss')::int)
  on conflict (user_id) do update set
    wins = r.wins + excluded.wins,
    draws = r.draws + excluded.draws,
    losses = r.losses + excluded.losses,
    updated_at = now();

  perform public.count_class_result(new.user_id, new.my_class, 'pvp', new.result);

  delete from public.match_history h
  where h.user_id = new.user_id
    and h.id not in (
      select k.id from public.match_history k
      where k.user_id = new.user_id
      order by k.finished_at desc, k.id desc
      limit 5
    );
  return null;
end;
$$;

-- A finished vs-CPU game, from the logged-in player's browser.
create function public.record_cpu_game(p_class text, p_result text) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'not logged in';
  end if;
  if p_result not in ('win', 'loss', 'draw') then
    raise exception 'bad result %', p_result;
  end if;
  if not exists (select 1 from public.classes c where c.id = p_class) then
    raise exception 'unknown class %', p_class;
  end if;
  perform public.count_class_result(uid, p_class, 'cpu', p_result);
end;
$$;

revoke execute on function public.count_class_result(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.record_cpu_game(text, text) from public, anon;
grant execute on function public.record_cpu_game(text, text) to authenticated;

create view public.class_win_rates
  with (security_invoker = true)
as
select
  s.class_id,
  s.mode,
  s.wins,
  s.draws,
  s.losses,
  s.wins + s.draws + s.losses as games,
  round((s.wins + s.draws * 0.5) / nullif(s.wins + s.draws + s.losses, 0) * 100, 1) as win_rate
from public.class_win_stats s;

create view public.my_class_win_rates
  with (security_invoker = true)
as
select
  s.class_id,
  s.mode,
  s.wins,
  s.draws,
  s.losses,
  s.wins + s.draws + s.losses as games,
  round((s.wins + s.draws * 0.5) / nullif(s.wins + s.draws + s.losses, 0) * 100, 1) as win_rate
from public.player_class_stats s;

grant select on public.class_win_rates to anon, authenticated;
grant select on public.my_class_win_rates to authenticated;

-- Count the PvP games already in match_history (each player's last 5).
insert into public.class_win_stats as s (class_id, mode, wins, draws, losses)
select h.my_class, 'pvp',
       count(*) filter (where h.result = 'win'),
       count(*) filter (where h.result = 'draw'),
       count(*) filter (where h.result = 'loss')
from public.match_history h
group by h.my_class
on conflict (class_id, mode) do update set
  wins = s.wins + excluded.wins,
  draws = s.draws + excluded.draws,
  losses = s.losses + excluded.losses,
  updated_at = now();

insert into public.player_class_stats as s (user_id, class_id, mode, wins, draws, losses)
select h.user_id, h.my_class, 'pvp',
       count(*) filter (where h.result = 'win'),
       count(*) filter (where h.result = 'draw'),
       count(*) filter (where h.result = 'loss')
from public.match_history h
group by h.user_id, h.my_class
on conflict (user_id, class_id, mode) do update set
  wins = s.wins + excluded.wins,
  draws = s.draws + excluded.draws,
  losses = s.losses + excluded.losses,
  updated_at = now();
