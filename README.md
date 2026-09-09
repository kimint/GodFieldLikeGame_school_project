# GodFieldLikeGame_school_project

A first prototype of a card battle game based on the browser game [Godfield](https://godfield.net/).
There is no art — only **attack cards** and **defense cards** with a number on them. You pick a card
from your hand and use it against the CPU.

## Running it

No build step required. Open `index.html` in a browser.

Or serve it locally (requires Python):

```bash
python -m http.server 8000
```

Then open `http://localhost:8000` in a browser.

## Rules

- Both fighters (Player vs CPU) start at 40 HP with a hand of 5 cards.
- On your turn, pick one card from your hand and use it.
  - **Attack card (value N)**: the opponent's shield absorbs up to N damage first, and the rest
    comes off the opponent's HP.
  - **Defense card (value N)**: raises your own shield by N. It is spent absorbing the next attack.
- After a card is used, the hand is refilled back to 5.
- When the draw pile runs out, the discard pile is shuffled and reused.
- Reduce the opponent's HP to 0 to win.

## File layout

| File | Purpose |
| --- | --- |
| `index.html` | Page skeleton |
| `src/style.css` | Styling |
| `src/cards.js` | Card type definitions and deck creation |
| `src/game.js` | Game state and rules (pure logic, no DOM) |
| `src/ui.js` | Rendering and click handling |

## Ideas for next steps

- Two-player hotseat, or online multiplayer
- More card types (healing, reflect, status effects, and other Godfield-style items)
- Draw only 1 card per turn to add a resource-management element
- Animations / sound effects
- Tests for the rules logic

