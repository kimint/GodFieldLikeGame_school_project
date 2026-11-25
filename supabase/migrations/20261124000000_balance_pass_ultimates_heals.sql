-- Balance pass (mirrors src/model/catalogData.ts; tuned with `npm run balance`
-- until every class wins 44-53% of CPU-vs-CPU games):
--   * every ultimate costs more meter, Master Craftsman's the most
--     (Guardian 24 -> 30, Pyromancer 20 -> 25, Black Mage 22 -> 26,
--     Master Craftsman 16 -> 24, Necromancer 20 -> 27),
--   * ultimates are now aimed like attack cards (engine.ts), so guard
--     monsters soak them; base HP evened out to make up for it
--     (Guardian 44 -> 40, Master Craftsman 36 -> 41, Necromancer 45 -> 38),
--   * heal cards cost more and heal less per AP (Healing Potion 2 AP / 6 HP -> 4 AP /
--     8 HP, Purify 2 AP / 3 HP -> 3 AP / 2 HP),
--   * decks need 20 cards now (DECK_RULES.minCards), so Master Craftsman's
--     starter deck gets a second Quick Jab (19 -> 20 cards).
-- Safe to run more than once.

update public.classes set
  base_stats = base_stats || '{"hp":40}'::jsonb,
  ultimate = ultimate || '{"cost":30}'::jsonb
where id = 'guardian';

update public.classes set ultimate = ultimate || '{"cost":25}'::jsonb where id = 'pyromancer';

update public.classes set ultimate = ultimate || '{"cost":26}'::jsonb where id = 'black_mage';

update public.classes set
  base_stats = base_stats || '{"hp":41}'::jsonb,
  ultimate = ultimate || '{"cost":24}'::jsonb
where id = 'craftsman';

update public.classes set
  base_stats = base_stats || '{"hp":38}'::jsonb,
  ultimate = ultimate || '{"cost":27}'::jsonb
where id = 'necromancer';

update public.cards
set props = props || '{"cost":4,"effects":[{"kind":"heal","amount":8}]}'::jsonb
where id = 'healing_potion';

update public.cards
set props = props || '{"cost":3,"effects":[{"kind":"cleanse"},{"kind":"heal","amount":2}]}'::jsonb
where id = 'purify';

insert into public.class_deck_cards (class_id, card_id, copies)
values ('craftsman', 'quick_jab', 2)
on conflict (class_id, card_id) do update set copies = excluded.copies;
