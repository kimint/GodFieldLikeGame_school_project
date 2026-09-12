// Example data used only to exercise the model above (see model-demo.html).
// Names, numbers, and flavor here are placeholders for wiring the pieces
// together -- not final game design.

const exampleSynergyBulwark = createSynergy({
  id: "bulwark",
  name: "Bulwark (example)",
  description: "Placeholder synergy: rewards playing defend cards.",
  tiers: [
    { count: 2, effects: [statModifier("def", MODIFIER_MODE.FLAT, 5)] },
    { count: 4, effects: [statModifier("def", MODIFIER_MODE.FLAT, 12)] },
  ],
});

const exampleClassGuardian = createClass({
  id: "guardian",
  name: "Guardian (example)",
  baseStats: { hp: 40, def: 5, mr: 2, er: 2, ur: 1 },
  synergyPool: [exampleSynergyBulwark],
  ultimate: createUltimate({
    id: "guardian_ultimate",
    name: "TBD",
    description: "Placeholder -- ultimate name/theme is still an open question.",
    cost: 100,
  }),
  passives: [],
});

const exampleAttackCard = createAttackCard({
  name: "Slash",
  damageType: DAMAGE_TYPE.PHYSICAL,
  value: 10,
});

const exampleDefendCard = createDefendCard({
  name: "Iron Wall",
  damageType: DAMAGE_TYPE.PHYSICAL,
  mode: MODIFIER_MODE.FLAT,
  amount: 4,
  stacking: STACKING.NONSTACKABLE,
  duration: 1,
});

const exampleBuffCard = createBuffCard({
  name: "Second Wind",
  effects: [energyRegen(MODIFIER_MODE.FLAT, 5)],
  duration: 2,
});

const exampleDebuffCard = createDebuffCard({
  name: "Drain",
  effects: [meterSiphon(10)],
  duration: 1,
});
