# GodFieldLikeGame_school_project

A card battle game prototype based on the browser game [Godfield](https://godfield.net/).
There's no illustrated artwork — each card has a small hand-drawn SVG icon (see "Card art" below)
plus a category and some numbers. Classes have their own stats, a synergy that gets stronger the
more you lean into it, and an ultimate that charges up over time. See
[docs/DESIGN.md](docs/DESIGN.md) for the full design notes this is built from.

## Running it

Built with [Vite](https://vitejs.dev/) + [Phaser](https://phaser.io/) — the whole UI (class select,
battle screen) is drawn on a Phaser canvas; see "Architecture" below. Requires Node.js.

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173`). Vite serves `index.html`,
`model-demo.html`, and `legacy/index.html` directly — navigate to whichever you want.

```bash
npm run build     # production build to dist/ (index.html + model-demo.html)
npm run preview   # serve that production build locally
```

`legacy/` isn't part of the production build — its scripts are plain global `<script>` tags with
no build step by design (see `legacy/` below), so there's nothing for Rollup to bundle. It's only
served during `npm run dev`; if you need it in `dist/` too, copy `legacy/` over by hand.

`src/**` is plain ES modules now (`import`/`export`), so Vite handles bundling and cache-busting
(hashed filenames) automatically — the old `?v=N` query-string convention is gone from `index.html`
and `model-demo.html`. `legacy/` is untouched (still global `<script>` tags with no build step);
Vite serves it as-is.

## How it plays

1. Pick a class (currently **Guardian** — tanky, physical, rewards playing defend cards; or
   **Pyromancer** — fragile, elemental, faster ultimate charge). The CPU gets the other one.
2. Each round, you and the CPU pick a card (or ultimate) **at the same time** — the CPU commits
   to its move without knowing yours, and then both resolve together:
   - **Attack**: deals damage of a type (physical / magic / element / true). The defender's
     matching resistance stat (DEF / MR / ER — true ignores all of them) reduces it, and so does
     any active defend card of the same type — including one committed this same round.
   - **Defend**: blocks incoming damage of one type, flat or percent, for a number of rounds.
     Because it's simultaneous, a defend you commit this round can block an attack the CPU
     commits this same round.
   - **Buff**: a positive effect on yourself (e.g. more ultimate regen).
   - **Debuff**: a negative effect on the opponent (e.g. drain their ultimate meter, or disable
     one of their synergies for a few rounds).
3. Your class's synergy gets stronger tiers the more you play the card type it rewards (e.g.
   Guardian's Bulwark synergy raises DEF further the more defend cards you've played).
4. Every round your ultimate meter fills by your UR (ultimate regen) stat. Once it's full, "Use
   Ultimate" becomes available as an extra action instead of playing a card.
5. Reduce the opponent's HP to 0 to win. If a round drops both fighters to 0 HP at once, it's a
   draw.

Card names/numbers and the two example classes are placeholders for wiring the system together,
not tuned game balance — see the open questions in `docs/DESIGN.md`.

## Architecture

`src/model/*` is the entire game engine (classes, cards, synergies, the round loop) and knows
nothing about rendering — no DOM, no Phaser. `src/scenes/*` is the Phaser UI on top of it:
`ClassSelectScene` and `BattleScene` each call the model's functions (`createBattle`, `playRound`,
...) and redraw themselves from the returned state. `src/phaserIcons.js` bridges the hand-authored
SVG strings from `src/icons.js` into Phaser textures (base64 data URI → `this.load.svg`), so the
icon art didn't need to be redrawn with Phaser's Graphics API.

## Online PvP (Supabase)

Pick a class, then **Create online room** (you get a 5-letter code to send a friend) or **Join
with code**. Sign-in is anonymous and kept per browser tab, so two tabs on one machine can play
each other for testing.

The same `src/model/` engine runs on the server instead of in the browser:

- `supabase/functions/game/` — an Edge Function that imports `src/model/*` directly. Creating /
  joining a room and submitting a move all go through it; it checks the move is legal and, once
  both players have locked in, resolves the round with `resolveRound()`.
- `supabase/migrations/` — the tables. `matches` (what both players may see) and
  `match_hands` (each player can read only their own row) are readable from the browser;
  `match_secrets` (both decks/hands and the pending moves) has no RLS policies at all, so only
  the Edge Function can read it. That's what keeps a player from reading the other side's hand or
  move out of the page.
- `src/online/matchApi.js` — the browser side: sign-in, calls to the function, and Realtime
  updates (plus a slow poll as a fallback).
- `.env` — the project URL and *publishable* key. Both are public by design and committed.
  Never put the secret / service_role key there.

After changing anything under `supabase/` (or `src/model/`, which the function bundles), push it
from the repo root, logged in with `npx supabase login` and linked with
`npx supabase link --project-ref vygltqnmontwxyyeyfyb`:

```bash
npx supabase db push                  # apply new migrations
npx supabase functions deploy game    # redeploy the server
```

The project also needs **Authentication → Sign In / Providers → Allow anonymous sign-ins** turned
on in the Supabase dashboard (a one-time setting).

## Card art

There's no tool in this environment that generates illustrations, so cards, classes, and the
ultimate each get a small hand-authored SVG icon instead (`src/icons.js`):

- **Cards**: one base shape per category — sword (attack), shield (defend), upward spark (buff),
  downward drain (debuff) — plus a small colored corner dot on attack/defend cards showing their
  damage type (grey physical, violet magic, orange element, gold true). Driven by the card's data
  (`category`/`damageType`), not its name, so any new card automatically gets a sensible icon
  without adding one by hand.
- **Classes**: one emblem per class id (a blue crest-shield for Guardian, a two-tone flame for
  Pyromancer), shown on the class-select card and the fighter panel heading. A class with no
  entry in `CLASS_ICON_BODY` just renders without an icon rather than erroring, so adding a new
  class doesn't require adding its icon at the same time.
- **Ultimate**: a single generic gold "burst" icon shared by every class, next to the "Use
  Ultimate" button, each class-select card's ultimate line, and the ultimate meter label. It's
  shared rather than per-class because the ultimate's actual theme/name is still an open question
  (see `docs/DESIGN.md`) — a per-class ultimate icon would be guessing at design that hasn't
  happened yet.

## File layout

| Path | Purpose |
| --- | --- |
| `index.html` | The game above — just a `#game` div; Phaser owns everything inside it |
| `src/main.js` | Creates the `Phaser.Game` and registers the scenes |
| `src/scenes/ClassSelectScene.js` | Class-select screen + vs CPU / online buttons |
| `src/scenes/BattleScene.js` | Battle screen: renders the model's battle state, turns clicks into `playRound()` calls |
| `src/scenes/LobbyScene.js` | Online: create/join a room, wait for the opponent |
| `src/scenes/OnlineBattleScene.js` | Online battle screen — `BattleScene`'s drawing, fed by the server instead of a local engine |
| `src/online/matchApi.js` | Supabase client for online PvP (see "Online PvP" above) |
| `supabase/` | Supabase config, database migrations, and the `game` Edge Function |
| `src/scenes/theme.js` | Shared colors/fonts + small draw helpers (`roundedRect`, `createButton`) |
| `src/icons.js` | Small hand-authored SVG icon per card category (+ a damage-type accent dot) — see "Card art" below |
| `src/phaserIcons.js` | Loads `src/icons.js`'s SVG markup as Phaser textures — see "Architecture" below |
| `src/style.css` | Just positions the Phaser canvas; the UI itself has no DOM/CSS anymore |
| `src/model/` | The class/stat/synergy/card data model + battle engine (see below) |
| `docs/DESIGN.md` | Design notes this is built from, including what's still open/unimplemented |
| `model-demo.html` | Standalone smoke test for `src/model/`, independent of the UI |
| `legacy/` | The original simple attack/defense-only prototype (no classes/synergies), kept for reference |

### `src/model/`

| File | Purpose |
| --- | --- |
| `util.js` | Shuffle helper |
| `stats.js` | Stat block shape (`hp, def, mr, er, ur, crit`) |
| `damageTypes.js` | Damage types and which stat resists each one |
| `effects.js` | Shared effect shapes used by synergies, class passives, buffs, and debuffs |
| `cardTypes.js` | The 4 card categories (attack/defend/buff/debuff) and defend-vs-attack resolution |
| `synergies.js` | Tiered synergy definitions and resolution |
| `classes.js` | Class definitions and effective-stat calculation |
| `data.js` | The two example classes/synergies, the `ALL_CLASSES` list, and some example cards |
| `decks.js` | Deck blueprints for the two example classes (used by the actual game) |
| `engine.js` | The round loop: simultaneous card/ultimate resolution, damage/effects, a simple CPU |
| `serialize.js` | Battle state ↔ plain JSON, and the public (no hands/decks) view of it, for online PvP |
| `demo.js` | The assertions rendered by `model-demo.html` |

## Known simplifications (see docs/DESIGN.md for the full list)

- Online PvP has no matchmaking, reconnect-after-closing-the-tab, or turn timer: a room is
  joined by code, and a player who never picks a card stalls the match until they press Leave.
- No fog of war / troop placement.
- A defend card fully replaces an earlier one of the same damage type rather than stacking
  amounts, even when marked stackable.
- `CONDITIONAL` and `SUMMON` effects are accepted by the data model but are no-ops in the engine.

## Ideas for next steps

- Online PvP: turn timer, matchmaking, rejoining a match after closing the tab
- Fog of war
- More classes/synergies/cards with real (not placeholder) names and balance
- Real stacking for stackable defend cards
- Draw only 1 card per turn to add a resource-management element
- Animations / sound effects
- Tests for the rules logic (currently just the in-browser checks in `model-demo.html`; now that
  the project has npm via Vite, a real test runner like Vitest is an option)
