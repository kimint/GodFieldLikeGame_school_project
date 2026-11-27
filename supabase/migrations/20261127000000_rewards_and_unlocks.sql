-- Gold rewards and the Unlock Shop.
--
--   player_wallets  -- one row per player: Gold, Gold earned today (for the
--                      daily cap) and the day the first-win bonus was last paid.
--   player_unlocks  -- classes and cards a player has bought.
--   admins          -- accounts that own everything (and see admin tools).
--
-- Every player owns Guardian. Owning a class gives its starter deck and its
-- normal cards; its rare and legend cards are bought one by one or from a
-- card pack, and a custom deck can only use cards the player owns. Admins
-- own every class and card.
--
-- Nothing here can be written from the browser directly:
--   * Gold is only paid by grant_match_reward(), which only the Colyseus
--     server (service role) can call when a random match ends,
--   * Gold is only spent by unlock_class() / unlock_card() / open_card_pack(),
--     which check the price and the balance in one transaction.
-- The browser reads its own state with my_economy().
--
-- Prices and reward numbers are mirrored in src/model/shop.ts; change both.
-- The "day" for the daily cap and the first-win bonus is the calendar day in
-- New York (REWARD_TIME_ZONE in src/model/shop.ts).

-- --- admins (same as the hand-run setup script; safe to run again) ------------

create table if not exists public.admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

alter table public.admins enable row level security;
drop policy if exists "read own admin row" on public.admins;
create policy "read own admin row" on public.admins
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.admins from anon, authenticated;
grant select on public.admins to authenticated;
grant select, insert, update, delete on public.admins to service_role;

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;
grant execute on function public.is_admin() to authenticated;

insert into public.admins (user_id)
select id from auth.users where email = 'zenkake.noreply@gmail.com'
on conflict do nothing;

-- --- tables --------------------------------------------------------------------

create table public.player_wallets (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  gold            integer not null default 0 check (gold >= 0),
  daily_gold      integer not null default 0 check (daily_gold >= 0),
  daily_date      date not null default ((now() at time zone 'America/New_York')::date),
  first_win_date  date, -- the day the first-win bonus was last paid
  updated_at      timestamptz not null default now()
);

create table public.player_unlocks (
  user_id      uuid not null references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('class', 'card')),
  item_id      text not null,
  price        integer not null default 0, -- Gold paid (a card from a pack records the pack's price)
  unlocked_at  timestamptz not null default now(),
  primary key (user_id, kind, item_id)
);

alter table public.player_wallets enable row level security;
alter table public.player_unlocks enable row level security;

create policy "players can read their own wallet"
  on public.player_wallets for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "players can read their own unlocks"
  on public.player_unlocks for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.player_wallets, public.player_unlocks from anon, authenticated;
grant select on public.player_wallets, public.player_unlocks to authenticated;
grant select, insert, update, delete on public.player_wallets, public.player_unlocks to service_role;

-- --- rules ---------------------------------------------------------------------

create or replace function public.reward_today() returns date
  language sql stable set search_path = ''
as $$ select (now() at time zone 'America/New_York')::date $$;

-- What a class costs; null for a class that isn't sold. Guardian is free.
create or replace function public.class_unlock_price(p_class_id text) returns integer
  language sql immutable set search_path = ''
as $$
  select case p_class_id
    when 'guardian' then 0
    when 'pyromancer' then 1500
    when 'black_mage' then 1500
    when 'craftsman' then 2000
    when 'necromancer' then 2500
  end
$$;

-- What a card costs by rarity; null for normal cards (they come with the class).
create or replace function public.card_unlock_price(p_card_id text) returns integer
  language sql stable set search_path = ''
as $$
  select case coalesce(c.props ->> 'rarity', 'normal')
    when 'rare' then 300
    when 'legend' then 800
  end
  from public.cards c
  where c.id = p_card_id
$$;

-- A player's wallet row, created on first use and moved to today, locked for
-- the rest of the transaction.
create or replace function public.lock_wallet(p_user_id uuid) returns public.player_wallets
  language plpgsql security definer set search_path = ''
as $$
declare
  w public.player_wallets;
  today date := public.reward_today();
begin
  insert into public.player_wallets (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into w from public.player_wallets where user_id = p_user_id for update;
  if w.daily_date <> today then
    update public.player_wallets set daily_gold = 0, daily_date = today
    where user_id = p_user_id
    returning * into w;
  end if;
  return w;
end;
$$;

-- Everything a player owns, for the server's checks and for my_economy():
-- { admin, classes: [...], cards: [...] } -- cards = the rare / legend cards
-- they bought (normal cards come with the class). Admins get every class and
-- every card.
create or replace function public.unlocks_for(p_user_id uuid) returns jsonb
  language sql stable security definer set search_path = ''
as $$
  with adm as (select exists (select 1 from public.admins where user_id = p_user_id) as yes)
  select jsonb_build_object(
    'admin', adm.yes,
    'classes', case when adm.yes
      then (select coalesce(jsonb_agg(id order by sort_order), '[]'::jsonb) from public.classes)
      else (select jsonb_agg(distinct x) from (
              select 'guardian' as x
              union select item_id from public.player_unlocks where user_id = p_user_id and kind = 'class'
            ) s)
    end,
    'cards', case when adm.yes
      then (select coalesce(jsonb_agg(id order by id), '[]'::jsonb) from public.cards)
      else (select coalesce(jsonb_agg(item_id order by item_id), '[]'::jsonb)
            from public.player_unlocks where user_id = p_user_id and kind = 'card')
    end
  )
  from adm;
$$;

-- The logged-in player's Gold and unlocks, for the menu and the shop.
create or replace function public.my_economy() returns jsonb
  language plpgsql stable security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  w public.player_wallets;
  today date := public.reward_today();
begin
  if uid is null then raise exception 'Log in first'; end if;
  select * into w from public.player_wallets where user_id = uid;
  return public.unlocks_for(uid) || jsonb_build_object(
    'gold', coalesce(w.gold, 0),
    'dailyGold', case when w.daily_date = today then w.daily_gold else 0 end,
    'firstWinAvailable', w.first_win_date is distinct from today
  );
end;
$$;

-- --- earning -------------------------------------------------------------------

-- Gold for one player at the end of a random match (called by
-- server/BattleRoom.ts with the service role). p_turns = rounds actually
-- played; p_surrendered = this player left the match. Returns the breakdown
-- the result screen shows.
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

-- --- spending ------------------------------------------------------------------

-- Buy a class. Returns my_economy() after the purchase.
create or replace function public.unlock_class(p_class_id text) returns jsonb
  language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  price integer := public.class_unlock_price(p_class_id);
  w public.player_wallets;
begin
  if uid is null then raise exception 'Log in first'; end if;
  if price is null or not exists (select 1 from public.classes where id = p_class_id) then
    raise exception 'That class isn''t for sale';
  end if;
  if exists (select 1 from public.admins where user_id = uid) or price = 0
     or exists (select 1 from public.player_unlocks where user_id = uid and kind = 'class' and item_id = p_class_id) then
    raise exception 'You already own this class';
  end if;
  w := public.lock_wallet(uid);
  if w.gold < price then raise exception 'Not enough Gold (% / % G)', w.gold, price; end if;
  update public.player_wallets set gold = gold - price, updated_at = now() where user_id = uid;
  insert into public.player_unlocks (user_id, kind, item_id, price) values (uid, 'class', p_class_id, price);
  return public.my_economy();
end;
$$;

-- Buy one rare / legend card of a class the player owns.
create or replace function public.unlock_card(p_card_id text) returns jsonb
  language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  price integer := public.card_unlock_price(p_card_id);
  owned jsonb;
  w public.player_wallets;
begin
  if uid is null then raise exception 'Log in first'; end if;
  if price is null then raise exception 'That card isn''t for sale'; end if;
  owned := public.unlocks_for(uid);
  if (owned ->> 'admin')::boolean or (owned -> 'cards') ? p_card_id then
    raise exception 'You already own this card';
  end if;
  if not exists (
    select 1 from public.class_deck_cards d
    where d.card_id = p_card_id and (owned -> 'classes') ? d.class_id
  ) then
    raise exception 'Unlock a class that uses this card first';
  end if;
  w := public.lock_wallet(uid);
  if w.gold < price then raise exception 'Not enough Gold (% / % G)', w.gold, price; end if;
  update public.player_wallets set gold = gold - price, updated_at = now() where user_id = uid;
  insert into public.player_unlocks (user_id, kind, item_id, price) values (uid, 'card', p_card_id, price);
  return public.my_economy();
end;
$$;

-- A card pack: 300 G for one random rare / legend card the player doesn't own
-- yet, from the classes they own (rare 3 : legend 1). Returns my_economy()
-- plus "granted": the card id.
create or replace function public.open_card_pack() returns jsonb
  language plpgsql security definer set search_path = ''
as $$
declare
  pack_price constant integer := 300;
  uid uuid := (select auth.uid());
  owned jsonb;
  w public.player_wallets;
  v_card_id text;
begin
  if uid is null then raise exception 'Log in first'; end if;
  owned := public.unlocks_for(uid);
  if (owned ->> 'admin')::boolean then raise exception 'You already own every card'; end if;

  select c.id into v_card_id
  from public.cards c
  where c.props ->> 'rarity' in ('rare', 'legend')
    and not (owned -> 'cards') ? c.id
    and exists (
      select 1 from public.class_deck_cards d
      where d.card_id = c.id and (owned -> 'classes') ? d.class_id
    )
  -- weighted pick: rare 3, legend 1
  order by -ln(random()) / case c.props ->> 'rarity' when 'rare' then 3 else 1 end
  limit 1;
  if v_card_id is null then raise exception 'You already own every card your classes can use'; end if;

  w := public.lock_wallet(uid);
  if w.gold < pack_price then raise exception 'Not enough Gold (% / % G)', w.gold, pack_price; end if;
  update public.player_wallets set gold = gold - pack_price, updated_at = now() where user_id = uid;
  insert into public.player_unlocks (user_id, kind, item_id, price) values (uid, 'card', v_card_id, pack_price);
  return public.my_economy() || jsonb_build_object('granted', v_card_id);
end;
$$;

-- --- who may call what -----------------------------------------------------------

revoke all on function
  public.reward_today(), public.class_unlock_price(text), public.card_unlock_price(text),
  public.lock_wallet(uuid), public.unlocks_for(uuid), public.my_economy(),
  public.grant_match_reward(uuid, text, integer, boolean),
  public.unlock_class(text), public.unlock_card(text), public.open_card_pack()
from public, anon, authenticated;

grant execute on function public.my_economy(), public.unlock_class(text), public.unlock_card(text), public.open_card_pack()
  to authenticated;
grant execute on function
  public.reward_today(), public.class_unlock_price(text), public.card_unlock_price(text),
  public.lock_wallet(uuid), public.unlocks_for(uuid), public.my_economy(),
  public.grant_match_reward(uuid, text, integer, boolean),
  public.unlock_class(text), public.unlock_card(text), public.open_card_pack()
to service_role;
