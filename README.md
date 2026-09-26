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
| `src/main.js` | Creates the `Phaser.Game` and registers the two scenes |
| `src/scenes/ClassSelectScene.js` | Class-select screen |
| `src/scenes/BattleScene.js` | Battle screen: renders the model's battle state, turns clicks into `playRound()` calls |
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
| `data.js` | The two example classes/synergies and some example cards (used by `model-demo.html`) |
| `decks.js` | Deck blueprints for the two example classes (used by the actual game) |
| `engine.js` | The round loop: simultaneous card/ultimate resolution, damage/effects, a simple CPU |
| `demo.js` | The assertions rendered by `model-demo.html` |

## Known simplifications (see docs/DESIGN.md for the full list)

- Simultaneous resolution is PvE-only for now: the CPU genuinely doesn't look at the player's
  pending action, which is enough within one browser tab. Real PvP still needs a server so a
  human opponent's client can't just read the other player's hand/action out of shared page
  state — see "Architecture implications" in `docs/DESIGN.md`.
- No fog of war / troop placement.
- A defend card fully replaces an earlier one of the same damage type rather than stacking
  amounts, even when marked stackable.
- `CONDITIONAL` and `SUMMON` effects are accepted by the data model but are no-ops in the engine.

## Ideas for next steps

- Online PvP (a server that actually withholds each side's hand/pending action from the other)
- Fog of war
- More classes/synergies/cards with real (not placeholder) names and balance
- Real stacking for stackable defend cards
- Draw only 1 card per turn to add a resource-management element
- Animations / sound effects
- Tests for the rules logic (currently just the in-browser checks in `model-demo.html`; now that
  the project has npm via Vite, a real test runner like Vitest is an option)
