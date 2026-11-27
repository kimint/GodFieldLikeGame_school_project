-- Leaderboard (src/components/Leaderboard.tsx), plus Gold for games played
-- before the reward system existed. Run after *_rewards_and_unlocks.sql.
--
--   player_wallets.total_earned -- lifetime Gold earned from matches. Only
--     grant_match_reward() adds to it; spending in the shop never lowers it,
--     so the Gold ranking is about earning, not saving.
--   leaderboard(p_category)     -- top 50 for 'wins' (random-match wins,
--     from pvp_records) or 'gold' (total_earned), plus the caller's own row.
--
-- Only random matches count: pvp_records is filled by the match_history
-- trigger, and the Colyseus server only writes match_history for random
-- matches (server/BattleRoom.ts recordResult skips private rooms).

alter table public.player_wallets
  add column if not exists total_earned integer not null default 0 check (total_earned >= 0);

-- --- Gold for games played before the reward system ----------------------------
--
-- Every random match already in pvp_records pays what it would pay today:
-- win 100, loss or draw 20. No first-win bonus and no daily cap (there's no
-- per-day history to apply them to).
--
-- Gold a player has already had from the reward system is taken off, so a
-- game is never paid twice even if this runs after rewards went live: what
-- they already earned = Gold in the wallet + Gold spent on unlocks (each
-- player_unlocks row records its price). Only the difference is added.
--
-- Running it again right away adds nothing: after the first run "already
-- earned" equals the backfill, so the difference is 0.

insert into public.player_wallets (user_id)
select r.user_id from public.pvp_records r
on conflict (user_id) do nothing;

with owed as (
  select
    w.user_id,
    coalesce(r.wins, 0) * 100 + (coalesce(r.losses, 0) + coalesce(r.draws, 0)) * 20 as from_games,
    w.gold + coalesce((select sum(u.price) from public.player_unlocks u where u.user_id = w.user_id), 0) as already
  from public.player_wallets w
  left join public.pvp_records r on r.user_id = w.user_id
)
update public.player_wallets w set
  gold = w.gold + greatest(0, o.from_games - o.already),
  total_earned = greatest(w.total_earned, o.already, o.from_games),
  updated_at = now()
from owed o
where o.user_id = w.user_id;

-- --- earning (same as before, now also counts total_earned) ---------------------

create or replace function public.grant_match_reward(
  p_user_id uuid,
  p_result text,
  p_turns integer,
  p_surrendered boolean default false
) returns jsonb
  language plpgsql security definer set search_path = ''
as $$
declare
  win_reward constant integer := 100;
  loss_reward constant integer := 20; -- also paid for a draw
  first_win_bonus constant integer := 150;
  daily_cap constant integer := 1000;
  min_turns constant integer := 4;
  today date := public.reward_today();
  w public.player_wallets;
  base integer := 0;
  bonus integer := 0;
  gross integer;
  granted integer;
  blocked text[] := '{}';
begin
  if p_result not in ('win', 'loss', 'draw') then raise exception 'Unknown result %', p_result; end if;
  w := public.lock_wallet(p_user_id);

  if p_turns < min_turns then
    blocked := array_append(blocked, 'min_turns');
    if p_surrendered then blocked := array_append(blocked, 'early_surrender'); end if;
  else
    base := case when p_result = 'win' then win_reward else loss_reward end;
    if p_result = 'win' and w.first_win_date is distinct from today then bonus := first_win_bonus; end if;
  end if;

  gross := base + bonus;
  granted := least(gross, greatest(0, daily_cap - w.daily_gold));

  update public.player_wallets set
    gold = gold + granted,
    total_earned = total_earned + granted,
    daily_gold = daily_gold + granted,
    first_win_date = case when bonus > 0 then today else first_win_date end,
    updated_at = now()
  where user_id = p_user_id
  returning * into w;

  return jsonb_build_object(
    'base', base,
    'firstWinBonus', bonus,
    'capCut', gross - granted,
    'granted', granted,
    'gold', w.gold,
    'dailyGold', w.daily_gold,
    'turns', p_turns,
    'blocked', to_jsonb(blocked)
  );
end;
$$;

revoke all on function public.grant_match_reward(uuid, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.grant_match_reward(uuid, text, integer, boolean) to service_role;

-- --- leaderboard -------------------------------------------------------------------

-- p_category: 'wins' or 'gold'. Returns
--   { rows: [top 50], me: the caller's row (rank null = not ranked yet) }
-- Each row: { rank, isMe, name, avatarUrl, mainClass, wins, draws, losses,
-- earned, balance }. Players only appear once they have a score above 0.
-- Ties: higher win rate first, then whoever got there first.
-- mainClass = the class they've played most in PvP (Guardian if none).
create or replace function public.leaderboard(p_category text default 'wins') returns jsonb
  language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  list_size constant integer := 50;
  result jsonb;
begin
  if uid is null then raise exception 'Log in first'; end if;
  if p_category not in ('wins', 'gold') then raise exception 'Unknown leaderboard %', p_category; end if;

  with players as (
    select
      u.id as user_id,
      coalesce(r.wins, 0) as wins,
      coalesce(r.draws, 0) as draws,
      coalesce(r.losses, 0) as losses,
      coalesce(w.total_earned, 0) as earned,
      coalesce(w.gold, 0) as balance,
      least(coalesce(r.updated_at, 'infinity'), coalesce(w.updated_at, 'infinity')) as reached_at,
      coalesce(nullif(u.raw_user_meta_data ->> 'username', ''), nullif(split_part(u.email, '@', 1), ''), 'Player') as name,
      nullif(u.raw_user_meta_data ->> 'avatar_url', '') as avatar_url,
      coalesce((
        select s.class_id from public.player_class_stats s
        where s.user_id = u.id and s.mode = 'pvp'
        order by s.wins + s.draws + s.losses desc, s.wins desc, s.class_id
        limit 1
      ), 'guardian') as main_class
    from auth.users u
    left join public.pvp_records r on r.user_id = u.id
    left join public.player_wallets w on w.user_id = u.id
    where r.user_id is not null or w.user_id is not null or u.id = uid
  ),
  scored as (
    select p.*,
      case when p_category = 'wins' then p.wins else p.earned end as score,
      case when p.wins + p.draws + p.losses = 0 then 0
           else p.wins::numeric / (p.wins + p.draws + p.losses) end as win_rate
    from players p
  ),
  ranked as (
    select s.*, row_number() over (order by s.score desc, s.win_rate desc, s.reached_at asc, s.user_id) as rank
    from scored s
    where s.score > 0
  ),
  as_json as (
    select
      rk.rank,
      rk.user_id,
      jsonb_build_object(
        'rank', rk.rank,
        'isMe', rk.user_id = uid,
        'name', rk.name,
        'avatarUrl', rk.avatar_url,
        'mainClass', rk.main_class,
        'wins', rk.wins,
        'draws', rk.draws,
        'losses', rk.losses,
        'earned', rk.earned,
        'balance', rk.balance
      ) as j
    from ranked rk
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(a.j order by a.rank) from as_json a where a.rank <= list_size), '[]'::jsonb),
    'me', coalesce(
      (select a.j from as_json a where a.user_id = uid),
      (select jsonb_build_object(
         'rank', null, 'isMe', true, 'name', s.name, 'avatarUrl', s.avatar_url, 'mainClass', s.main_class,
         'wins', s.wins, 'draws', s.draws, 'losses', s.losses, 'earned', s.earned, 'balance', s.balance)
       from scored s where s.user_id = uid)
    )
  ) into result;
  return result;
end;
$$;

revoke all on function public.leaderboard(text) from public, anon, authenticated;
grant execute on function public.leaderboard(text) to authenticated, service_role;
