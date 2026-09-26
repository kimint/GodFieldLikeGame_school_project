-- Game catalog: the classes, synergies, and cards the engine plays with.
-- src/model/catalog.js loads these (browser at startup, the `game` Edge
-- Function per instance) and turns them into the same objects the engine
-- used to get from hard-coded JS. Initial rows are in the next migration.
--
-- Built to grow without schema changes:
--   - Things every row has are real columns; everything type-specific lives
--     in jsonb (`cards.props`, `classes.base_stats`, effect lists, ...), so a
--     new card attribute or effect kind is just new JSON, not a migration.
--   - Ids are stable text slugs ("shield_bash"). Rename via `name`, never
--     change an id -- stored matches and deck lists reference it.
--   - Old code that meets a card category or effect kind it doesn't know
--     skips it instead of crashing (see catalog.js / engine.js).
--
-- Read-only from the browser. Edit rows in the dashboard (or with the
-- service-role key); change the *shape* with a new migration.

create table public.synergies (
  id               text primary key,
  name             text not null,
  description      text not null default '',
  counts_category  text not null,          -- card category whose plays count toward the tier
  tiers            jsonb not null default '[]'::jsonb, -- [{ count, effects: [effect, ...] }]
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.classes (
  id          text primary key,
  name        text not null,
  base_stats  jsonb not null default '{}'::jsonb, -- { hp, def, mr, er, ur, crit }; missing keys = 0
  ultimate    jsonb not null,                     -- { id, name, description, cost, damage }
  passives    jsonb not null default '[]'::jsonb, -- [effect, ...]
  sort_order  integer not null default 0,         -- class-select screen order
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.class_synergies (
  class_id    text not null references public.classes (id) on delete cascade,
  synergy_id  text not null references public.synergies (id) on delete cascade,
  primary key (class_id, synergy_id)
);

-- props by category:
--   attack: { damageType, value }
--   defend: { damageType, mode, amount, stacking, duration }
--   buff / debuff: { effects: [effect, ...], duration }
create table public.cards (
  id          text primary key,
  name        text not null,
  category    text not null,
  props       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- A class's starting deck: `copies` of each card.
create table public.class_deck_cards (
  class_id  text not null references public.classes (id) on delete cascade,
  card_id   text not null references public.cards (id) on delete cascade,
  copies    integer not null check (copies > 0),
  primary key (class_id, card_id)
);

create index class_deck_cards_card_idx on public.class_deck_cards (card_id);
create index class_synergies_synergy_idx on public.class_synergies (synergy_id);

create function public.touch_updated_at() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger synergies_touch before update on public.synergies
  for each row execute function public.touch_updated_at();
create trigger classes_touch before update on public.classes
  for each row execute function public.touch_updated_at();
create trigger cards_touch before update on public.cards
  for each row execute function public.touch_updated_at();

alter table public.synergies enable row level security;
alter table public.classes enable row level security;
alter table public.class_synergies enable row level security;
alter table public.cards enable row level security;
alter table public.class_deck_cards enable row level security;

create policy "catalog is public" on public.synergies for select to anon, authenticated using (true);
create policy "catalog is public" on public.classes for select to anon, authenticated using (true);
create policy "catalog is public" on public.class_synergies for select to anon, authenticated using (true);
create policy "catalog is public" on public.cards for select to anon, authenticated using (true);
create policy "catalog is public" on public.class_deck_cards for select to anon, authenticated using (true);

revoke all on public.synergies, public.classes, public.class_synergies, public.cards, public.class_deck_cards
  from anon, authenticated;
grant select on public.synergies, public.classes, public.class_synergies, public.cards, public.class_deck_cards
  to anon, authenticated;
