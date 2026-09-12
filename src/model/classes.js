// Class definitions: base stats + which synergies a class can draw on + a
// unique ultimate + class-based passives. See docs/DESIGN.md ("Class system /
// deck synergy system", "Basic stats").

function createClass({ id, name, baseStats, synergyPool, ultimate, passives = [] }) {
  return {
    id,
    name,
    baseStats: createStats(baseStats),
    synergyPool,
    ultimate,
    passives,
  };
}

// Placeholder ultimate shape -- naming/theme is still an open question
// (docs/DESIGN.md: "name it something related to all in aspect maybe").
function createUltimate({ id, name, description, cost }) {
  return { id, name, description, cost };
}

// Apply a list of effects on top of a class's base stats. Only STAT_MODIFIER
// effects change the stat block here -- other kinds (energy regen, synergy
// disable, meter siphon, ...) belong to other systems and are left alone.
function computeEffectiveStats(classDef, effects) {
  const stats = createStats(classDef.baseStats);
  for (const effect of effects) {
    if (effect.kind !== EFFECT_KIND.STAT_MODIFIER) continue;
    if (effect.mode === MODIFIER_MODE.PERCENT) {
      stats[effect.stat] += classDef.baseStats[effect.stat] * effect.amount;
    } else {
      stats[effect.stat] += effect.amount;
    }
  }
  return stats;
}
