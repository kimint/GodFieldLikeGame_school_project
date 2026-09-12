# GodFieldLikeGame_school_project

A card battle game prototype based on the browser game [Godfield](https://godfield.net/).
There is no art — cards are just a category and some numbers on them. Classes have their own
stats, a synergy that gets stronger the more you lean into it, and an ultimate that charges up
over time. See [docs/DESIGN.md](docs/DESIGN.md) for the full design notes this is built from.

## Running it

No build step required. Open `index.html` in a browser.

Or serve it locally (requires Python):

```bash
python -m http.server 8000
```

Then open `http://localhost:8000` in a browser.

## How it plays

1. Pick a class (currently **Guardian** — tanky, physical, rewards playing defend cards; or
   **Pyromancer** — fragile, elemental, faster ultimate charge). The CPU gets the other one.
2. Each turn, play one card from your hand:
   - **Attack**: deals damage of a type (physical / magic / element / true). The defender's
     matching resistance stat (DEF / MR / ER — true ignores all of them) reduces it, and so does
     any active defend card of the same type.
   - **Defend**: blocks incoming damage of one type, flat or percent, for a number of turns.
   - **Buff**: a positive effect on yourself (e.g. more ultimate regen).
   - **Debuff**: a negative effect on the opponent (e.g. drain their ultimate meter, or disable
     one of their synergies for a few turns).
3. Your class's synergy gets stronger tiers the more you play the card type it rewards (e.g.
   Guardian's Bulwark synergy raises DEF further the more defend cards you've played).
4. Every turn your ultimate meter fills by your UR (ultimate regen) stat. Once it's full, "Use
   Ultimate" becomes available as an extra action instead of playing a card.
5. Reduce the opponent's HP to 0 to win.

Card names/numbers and the two example classes are placeholders for wiring the system together,
not tuned game balance — see the open questions in `docs/DESIGN.md`.

## File layout

| Path | Purpose |
| --- | --- |
| `index.html` | The game above |
| `src/app.js` | UI: class select, battle screen, rendering, input handling |
| `src/style.css` | Styling |
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
| `engine.js` | The turn loop: playing cards, resolving damage/effects, ultimates, a simple CPU |
| `demo.js` | The assertions rendered by `model-demo.html` |

## Known simplifications (see docs/DESIGN.md for the full list)

- Turns are sequential (player, then CPU) — not the simultaneous resolution described in the
  design notes, which needs a server.
- No fog of war / troop placement.
- A defend card fully replaces an earlier one of the same damage type rather than stacking
  amounts, even when marked stackable.
- `CONDITIONAL` and `SUMMON` effects are accepted by the data model but are no-ops in the engine.

## Ideas for next steps

- Two-player hotseat, or online multiplayer
- A server (or shared session) to support simultaneous turns and fog of war
- More classes/synergies/cards with real (not placeholder) names and balance
- Real stacking for stackable defend cards
- Draw only 1 card per turn to add a resource-management element
- Animations / sound effects

- Tests for the rules logic (currently just the in-browser checks in `model-demo.html` and
  ad hoc console scripts — no test runner, since this environment has no Node/npm)
