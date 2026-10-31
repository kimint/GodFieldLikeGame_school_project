-- PvP record, for the panel on the main menu (src/components/MatchHistory.tsx).
--
--   pvp_records    -- one row per player: all-time wins / draws / losses.
--   match_history  -- that player's last 5 PvP games (older ones are deleted
--                     as new ones come in), for the "last games" list.
--
-- Both are written server-side only -- the browser can just read its own
-- rows, so a record can't be forged from the page:
--   * room-code matches: the trigger on `matches` below, when a match turns
--     'finished' with two players (last round resolved, or a forfeit),
--   * random matches: server/BattleRoom.ts (service role).
-- Either way they only insert into match_history; the trigger on
-- match_history keeps pvp_records and the 5-game limit in step.
--
-- vs-CPU games aren't recorded.

create table public.pvp_records (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  wins        integer not null default 0,
  draws       integer not null default 0,
  losses      integer not null default 0,
  updated_at  timestamptz not null default now()
);

create table public.match_history (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  result          text not null check (result in ('win', 'loss', 'draw')),
  my_class        text not null,
  opponent_class  text not null,
  opponent_name   text not null, -- the opponent's username at the time
  rounds          integer not null default 0,
  match_id        uuid references public.matches (id) on delete set null, -- room-code matches only
  finished_at     timestamptz not null default now(),
  unique (match_id, user_id)
);

create index match_history_user_idx on public.match_history (user_id, finished_at desc);

alter table public.pvp_records enable row level security;
alter table public.match_history enable row level security;

create policy "players can read their own record"
  on public.pvp_records for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "players can read their own history"
  on public.match_history for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.pvp_records, public.match_history from anon, authenticated;
grant select on public.pvp_records, public.match_history to authenticated;
grant select, insert, update, delete on public.pvp_records, public.match_history to service_role;

-- Every recorded game: count it in pvp_records, then drop that player's
-- games beyond the newest 5 (RECENT_LIMIT in src/online/historyApi.ts).
create function public.count_match_history() returns trigger
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

create trigger match_history_count after insert on public.match_history
  for each row execute function public.count_match_history();

-- Display name for a user, the same way src/online/authApi.ts toAccount()
-- picks it: the username in their metadata, else the part of the email
-- before the @.
create function public.player_display_name(uid uuid) returns text
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce(nullif(u.raw_user_meta_data ->> 'username', ''), nullif(split_part(u.email, '@', 1), ''), 'Player')
  from auth.users u
  where u.id = uid;
$$;

-- Room-code matches: record both sides once the match row turns 'finished'.
-- A waiting room closed before anyone joined has no p2/winner and is skipped.
create function public.record_match_history() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  p1_result text;
begin
  if new.p2 is null or new.winner is null or new.p2_class is null then
    return new;
  end if;
  p1_result := case new.winner when 'p1' then 'win' when 'p2' then 'loss' else 'draw' end;
  insert into public.match_history
    (user_id, result, my_class, opponent_class, opponent_name, rounds, match_id, finished_at)
  values
    (new.p1, p1_result, new.p1_class, new.p2_class,
     coalesce(public.player_display_name(new.p2), 'Player'), new.round, new.id, new.updated_at),
    (new.p2, case p1_result when 'win' then 'loss' when 'loss' then 'win' else 'draw' end,
     new.p2_class, new.p1_class, coalesce(public.player_display_name(new.p1), 'Player'), new.round, new.id, new.updated_at)
  on conflict (match_id, user_id) do nothing;
  return new;
end;
$$;

create trigger matches_record_history after update of status on public.matches
  for each row
  when (new.status = 'finished' and old.status is distinct from 'finished')
  execute function public.record_match_history();

revoke execute on function public.player_display_name(uuid), public.count_match_history(), public.record_match_history()
  from public, anon, authenticated;
