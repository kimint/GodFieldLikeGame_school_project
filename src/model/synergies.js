// Synergy definitions, per docs/DESIGN.md ("Class system / deck synergy
// system"). A class has access to a pool of synergies, and each synergy
// unlocks stronger effects at higher tiers as more copies of it become active
// (modeled after tiered trait/synergy systems in auto-battlers).
//
// Open question (docs/DESIGN.md): can more than one synergy be active on a
// class at the same time? Nothing here prevents it -- `resolveSynergies` just
// resolves each synergy in the pool independently, so the caller decides how
// many can be active at once.

// tiers: [{ count, effects }], meant to be given in ascending order of `count`.
function createSynergy({ id, name, description, tiers }) {
  return { id, name, description, tiers };
}

// Given how many pieces of a synergy are currently active (e.g. cards of that
// synergy in play), return the highest tier reached, or null if none.
function getActiveTier(synergy, activeCount) {
  let best = null;
  for (const tier of synergy.tiers) {
    if (activeCount >= tier.count) {
      best = tier;
    }
  }
  return best;
}

// Resolve every synergy in a pool against a map of { synergyId: activeCount }
// and return the flat list of effects granted by whichever tier each synergy
// reached.
function resolveSynergies(synergyPool, activeCounts) {
  const effects = [];
  for (const synergy of synergyPool) {
    const tier = getActiveTier(synergy, activeCounts[synergy.id] ?? 0);
    if (tier) effects.push(...tier.effects);
  }
  return effects;
}
