// Example data used only to exercise the model above (see model-demo.html).
// Names, numbers, and flavor here are placeholders for wiring the pieces
// together -- not final game design.

// `countsCategory` tells the engine (src/model/engine.js) which card category
// played this match counts toward a synergy's tier -- it isn't read by
// src/model/synergies.js itself, which just takes whatever counts the caller
// hands it.
import { createSynergy } from "./synergies.js";
import { CARD_CATEGORY, STACKING, createAttackCard, createDefendCard, createBuffCard, createDebuffCard } from "./cardTypes.js";
import { MODIFIER_MODE, statModifier, energyRegen, meterSiphon } from "./effects.js";
import { createClass, createUltimate } from "./classes.js";
import { DAMAGE_TYPE } from "./damageTypes.js";

export const exampleSynergyBulwark = createSynergy({
  id: "bulwark",
  name: "Bulwark (example)",
  description: "Placeholder synergy: rewards playing defend cards.",
  countsCategory: CARD_CATEGORY.DEFEND,
  tiers: [
    { count: 2, effects: [statModifier("def", MODIFIER_MODE.FLAT, 5)] },
    { count: 4, effects: [statModifier("def", MODIFIER_MODE.FLAT, 12)] },
  ],
});

export const exampleClassGuardian = createClass({
  id: "guardian",
  name: "Guardian (example)",
  baseStats: { hp: 44, def: 6, mr: 2, er: 2, ur: 6, crit: 0 },
  synergyPool: [exampleSynergyBulwark],
  ultimate: createUltimate({
    id: "guardian_ultimate",
    name: "TBD",
    description: "Placeholder -- ultimate name/theme is still an open question.",
    cost: 24,
    damage: 14,
  }),
  passives: [],
});

// A second example class so the class system actually shows a contrast:
// squishier, faster ultimate charge, leans on element attacks instead of
// physical + defend.
export const exampleSynergyKindling = createSynergy({
  id: "kindling",
  name: "Kindling (example)",
  description: "Placeholder synergy: aggression (attack cards) fuels ultimate charge.",
  countsCategory: CARD_CATEGORY.ATTACK,
  tiers: [
    { count: 2, effects: [statModifier("ur", MODIFIER_MODE.FLAT, 2)] },
    { count: 4, effects: [statModifier("ur", MODIFIER_MODE.FLAT, 5)] },
  ],
});

export const exampleClassPyromancer = createClass({
  id: "pyromancer",
  name: "Pyromancer (example)",
  baseStats: { hp: 34, def: 2, mr: 3, er: 4, ur: 8, crit: 0 },
  synergyPool: [exampleSynergyKindling],
  ultimate: createUltimate({
    id: "pyromancer_ultimate",
    name: "TBD",
    description: "Placeholder -- ultimate name/theme is still an open question.",
    cost: 20,
    damage: 18,
  }),
  passives: [],
});

export const exampleAttackCard = createAttackCard({
  name: "Slash",
  damageType: DAMAGE_TYPE.PHYSICAL,
  value: 10,
});

export const exampleDefendCard = createDefendCard({
  name: "Iron Wall",
  damageType: DAMAGE_TYPE.PHYSICAL,
  mode: MODIFIER_MODE.FLAT,
  amount: 4,
  stacking: STACKING.NONSTACKABLE,
  duration: 1,
});

export const exampleBuffCard = createBuffCard({
  name: "Second Wind",
  effects: [energyRegen(MODIFIER_MODE.FLAT, 5)],
  duration: 2,
});

export const exampleDebuffCard = createDebuffCard({
  name: "Drain",
  effects: [meterSiphon(10)],
  duration: 1,
});

// Every playable class, in the order the class-select screen shows them.
// Also how serialized battles (src/model/serialize.js) get from a stored
// class id back to the full class definition.
export const ALL_CLASSES = [exampleClassGuardian, exampleClassPyromancer];

export function findClassById(id) {
  const classDef = ALL_CLASSES.find((c) => c.id === id);
  if (!classDef) throw new Error(`Unknown class "${id}"`);
  return classDef;
}
