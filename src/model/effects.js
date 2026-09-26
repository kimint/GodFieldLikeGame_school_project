// Generic effect objects used by synergy tiers, class passives, buff cards, and
// debuff cards. An "effect" describes one small rule change; a card or synergy
// tier is just a list of these. See docs/DESIGN.md ("Buff" / "Debuff").

export const EFFECT_KIND = {
  STAT_MODIFIER: "stat_modifier",     // add/scale one of the base stats
  ENERGY_REGEN: "energy_regen",       // change ultimate regen rate
  SYNERGY_DISABLE: "synergy_disable", // turn off a target synergy for its duration
  METER_SIPHON: "meter_siphon",       // drain ultimate meter from the target
  SUMMON: "summon",                   // spawn a helper unit (placeholder, unresolved)
  CONDITIONAL: "conditional",         // only applies if `condition(context)` is true
};

// Flat vs percent, reused by stat modifiers and defend cards.
export const MODIFIER_MODE = {
  FLAT: "flat",
  PERCENT: "percent",
};

// +amount (flat) or +amount*100% (percent) to `stat`.
export function statModifier(stat, mode, amount) {
  return { kind: EFFECT_KIND.STAT_MODIFIER, stat, mode, amount };
}

export function energyRegen(mode, amount) {
  return { kind: EFFECT_KIND.ENERGY_REGEN, mode, amount };
}

export function synergyDisable(synergyId) {
  return { kind: EFFECT_KIND.SYNERGY_DISABLE, synergyId };
}

export function meterSiphon(amount) {
  return { kind: EFFECT_KIND.METER_SIPHON, amount };
}

// `condition` is an open-ended predicate the engine will call later:
// (context) => boolean. Left unresolved on purpose -- see docs/DESIGN.md.
export function conditional(condition, effect) {
  return { kind: EFFECT_KIND.CONDITIONAL, condition, effect };
}
