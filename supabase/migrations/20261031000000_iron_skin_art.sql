-- Painted artwork for Iron Skin, served by the site itself from
-- public/cards/iron_skin.jpg (see *_card_images.sql: image_url may be a
-- site path). `npm run cards:art -- --upload` keeps this pointer instead of
-- replacing it with the generated SVG -- see scripts/card-art.ts.

update public.cards set image_url = '/cards/iron_skin.jpg' where id = 'iron_skin';
