// Deck blueprints for the two example classes in data.js. Card names and
// values here are placeholders for wiring up the engine end to end, not
// tuned game balance.

import { createAttackCard, createDefendCard, createBuffCard, createDebuffCard, STACKING } from "./cardTypes.js";
import { DAMAGE_TYPE } from "./damageTypes.js";
import { MODIFIER_MODE, energyRegen, meterSiphon, statModifier } from "./effects.js";
import { shuffle } from "./util.js";
import { exampleClassGuardian, exampleClassPyromancer } from "./data.js";

const guardianDeckBlueprint = [
  { count: 4, make: () => createAttackCard({ name: "Shield Bash", damageType: DAMAGE_TYPE.PHYSICAL, value: 6 }) },
  { count: 3, make: () => createAttackCard({ name: "Heavy Slam", damageType: DAMAGE_TYPE.PHYSICAL, value: 9 }) },
  {
    count: 4,
    make: () =>
      createDefendCard({
        name: "Iron Wall",
        damageType: DAMAGE_TYPE.PHYSICAL,
        mode: MODIFIER_MODE.FLAT,
        amount: 5,
        stacking: STACKING.NONSTACKABLE,
        duration: 1,
      }),
  },
  {
    count: 3,
    make: () =>
      createDefendCard({
        name: "Brace",
        damageType: DAMAGE_TYPE.PHYSICAL,
        mode: MODIFIER_MODE.PERCENT,
        amount: 0.3,
        stacking: STACKING.NONSTACKABLE,
        duration: 2,
      }),
  },
  {
    count: 2,
    make: () => createBuffCard({ name: "Second Wind", effects: [energyRegen(MODIFIER_MODE.FLAT, 2)], duration: 3 }),
  },
  {
    count: 2,
    make: () => createDebuffCard({ name: "Taunt", effects: [meterSiphon(5)], duration: 1 }),
  },
];

const pyromancerDeckBlueprint = [
  { count: 4, make: () => createAttackCard({ name: "Ember Dart", damageType: DAMAGE_TYPE.ELEMENT, value: 5 }) },
  { count: 3, make: () => createAttackCard({ name: "Fire Lance", damageType: DAMAGE_TYPE.ELEMENT, value: 8 }) },
  {
    count: 3,
    make: () =>
      createDefendCard({
        name: "Heat Shroud",
        damageType: DAMAGE_TYPE.ELEMENT,
        mode: MODIFIER_MODE.FLAT,
        amount: 4,
        stacking: STACKING.NONSTACKABLE,
        duration: 1,
      }),
  },
  {
    count: 3,
    make: () =>
      createBuffCard({ name: "Stoke the Flame", effects: [energyRegen(MODIFIER_MODE.FLAT, 3)], duration: 2 }),
  },
  {
    count: 3,
    make: () =>
      createDebuffCard({ name: "Scorch", effects: [statModifier("er", MODIFIER_MODE.FLAT, -2)], duration: 2 }),
  },
];

// Build actual card instances from a blueprint (a list of { count, make }).
export function buildDeckFromBlueprint(blueprint) {
  const deck = [];
  for (const entry of blueprint) {
    for (let i = 0; i < entry.count; i++) {
      deck.push(entry.make());
    }
  }
  return shuffle(deck);
}

// classId -> blueprint, so the engine/UI can build a deck just from the class
// the player or CPU picked.
export const DECK_BLUEPRINTS = {
  [exampleClassGuardian.id]: guardianDeckBlueprint,
  [exampleClassPyromancer.id]: pyromancerDeckBlueprint,
};

export function buildDeckForClass(classDef) {
  const blueprint = DECK_BLUEPRINTS[classDef.id];
  if (!blueprint) throw new Error(`No deck blueprint for class "${classDef.id}"`);
  return buildDeckFromBlueprint(blueprint);
}
