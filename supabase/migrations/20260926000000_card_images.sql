-- Card artwork for the card gallery (src/scenes/CardGalleryScene.js).
--
-- `image_url` is optional: null means "no artwork yet", and the game falls
-- back to the card category's built-in SVG icon. It can be
--   - a full URL, e.g. a file in the `card-images` Storage bucket below:
--     https://<project>.supabase.co/storage/v1/object/public/card-images/shield_bash.png
--   - or a path served by the site itself, e.g. /cards/shield_bash.png
--     (a file at public/cards/shield_bash.png in this repo).
--
-- The existing "catalog is public" select policy and grant on `cards` already
-- cover the new column.

alter table public.cards add column image_url text;

-- Public bucket for card art: anyone can view files by their public URL;
-- upload them from the Supabase dashboard (Storage > card-images).
insert into storage.buckets (id, name, public)
values ('card-images', 'card-images', true)
on conflict (id) do nothing;
