// General card schema: attack / defend / buff / debuff, per docs/DESIGN.md
// ("General card types"). This is a richer replacement for the plain
// attack/defense cards in src/cards.js, but it is NOT wired into the playable
// prototype (index.html) yet -- see model-demo.html for a standalone smoke test.

import { MODIFIER_MODE } from "./effects.js";

let modelCardIdCounter = 0;

export const CARD_CATEGORY = {
  ATTACK: "attack",
  DEFEND: "defend",
  BUFF: "buff",
  DEBUFF: "debuff",
};

export const STACKING = {
  STACKABLE: "stackable",
  NONSTACKABLE: "nonstackable",
};

// Attack card: deals `value` damage of `damageType`.
export function createAttackCard({ name, damageType, value }) {
  return {
    id: ++modelCardIdCounter,
    category: CARD_CATEGORY.ATTACK,
    name,
    damageType,
    value,
  };
}

// Defend card: reduces incoming damage of `damageType` for `duration` turns.
export function createDefendCard({ name, damageType, mode, amount, stacking, duration }) {
  return {
    id: ++modelCardIdCounter,
    category: CARD_CATEGORY.DEFEND,
    name,
    damageType,
    mode,     // MODIFIER_MODE.FLAT | MODIFIER_MODE.PERCENT
    amount,
    stacking, // STACKING.STACKABLE | STACKING.NONSTACKABLE
    duration, // number of turns this defend lasts
  };
}

// Buff card: grants one or more positive effects for `duration` turns.
export function createBuffCard({ name, effects, duration }) {
  return {
    id: ++modelCardIdCounter,
    category: CARD_CATEGORY.BUFF,
    name,
    effects,
    duration,
  };
}

// Debuff card: grants one or more negative effects for `duration` turns.
export function createDebuffCard({ name, effects, duration }) {
  return {
    id: ++modelCardIdCounter,
    category: CARD_CATEGORY.DEBUFF,
    name,
    effects,
    duration,
  };
}

// Resolve a defend card against an incoming attack card, returning the damage
// that actually gets through. A defend card only applies to a matching
// damageType (a "physical" defend does nothing against "magic" damage, and
// "true" damage only gets blocked by a defend card that explicitly names
// "true"). Stacking multiple simultaneous defend cards is intentionally not
// modeled yet -- see docs/DESIGN.md.
export function applyDefend(attackCard, defendCard) {
  if (!defendCard || defendCard.damageType !== attackCard.damageType) {
    return attackCard.value;
  }
  if (defendCard.mode === MODIFIER_MODE.PERCENT) {
    return Math.max(0, attackCard.value * (1 - defendCard.amount));
  }
  return Math.max(0, attackCard.value - defendCard.amount);
}
