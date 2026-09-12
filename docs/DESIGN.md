# Design Notes — Core Gameplay Mechanics (v2 concept)

Status: **not implemented yet.** This is a working spec for where the game is headed,
kept separate from the current playable prototype (sequential turns, fully visible
state, single-file client, CPU opponent — see the root [README](../README.md)).
Building the mechanics below is a bigger architectural step than the current
prototype; see "Architecture implications" at the bottom.

## Turn resolution

- Both players take their turns at the same time; all actions resolve simultaneously
  (not sequential like the current prototype).
- Fog of war when placing troops.

## Class system / deck synergy system

- Each class has access to certain deck synergies.
- Synergy levels
  - Synergies can include passive effects or active effects (buffs/debuffs).
  - Open question: can a class have multiple active synergies at once?
- Each class has access to a unique ultimate.
  - Naming idea: something themed around an "all-in" concept — needs a real name.

## Base stats

Class-based, and modified by synergies.

- HP
- DEF
- MR (Magic Resist)
- ER (Element Resistance)
- UR (Ultimate Regen)
- Crit? (open question — not decided whether crit is in scope)
- Passives
  - Class-based
  - Synergy-based

## Card types

### Attack

- Damage types: Physical / Magic / Element / True / etc.

### Defend

- Flat reduction
- Percent reduction
- Typed: Physical / Magic / Element
- Stackable vs. non-stackable
- Lasts X turns

### Buff

- Energy regen increase
- Conditional effects
- Summoning?
- etc.

### Debuff

- Damage / defense / MR reduction
- Disables a synergy
- Meter siphon? (drains an opponent's ultimate/energy meter)

## Architecture implications

The current prototype is a single static-HTML page with no server: one browser tab
runs both the player and a scripted CPU, and all state (both hands, both HP bars) is
visible in the same page. Two mechanics above break that model:

- **Simultaneous resolution** — both sides commit an action before either is
  revealed, so one player's client can't just read the other's move out of shared
  in-memory state the way the CPU does now.
- **Fog of war** — each player must see less than the full game state, which means
  the state can't simply live in one page's `game` object either.

Either of these needs a source of truth outside a single browser tab that hides
each player's pending action until both are submitted (a server, or something like
a shared session both clients poll/connect to) before the client-only prototype can
grow into this design.

## Open questions to resolve before implementation

- Can a class have more than one synergy active at once?
- Is crit in scope for v1 of this system?
- What counts as "troops" for fog-of-war placement, and how is placement resolved
  when hidden from the opponent?
- Ultimate name/theme.
