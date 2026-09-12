// Turn-based battle engine wiring the class/card/synergy model above into an
// actual playable loop, used by index.html. See docs/DESIGN.md for the design
// this is built from, and README.md for how this differs from the original
// simple prototype kept under legacy/.
//
// Simplifications vs. docs/DESIGN.md (kept deliberately, not silently
// dropped):
// - Turns are sequential (player, then CPU), not simultaneous -- true
//   simultaneous resolution needs a server; see "Architecture implications"
//   in docs/DESIGN.md.
// - No fog of war / troop placement yet.
// - A defend card fully replaces any earlier active defend of the same damage
//   type rather than adding to it, even when `stacking` is STACKABLE -- true
//   stacking amounts aren't modeled yet either (STACKABLE currently only
//   means "don't consume this on the first hit it blocks").
// - CONDITIONAL and SUMMON effects are accepted but are currently no-ops.

const HAND_SIZE = 5;

// --- fighter state -----------------------------------------------------

function createFighter(classDef, deck) {
  return {
    classDef,
    hp: classDef.baseStats.hp,
    maxHp: classDef.baseStats.hp,
    deck,
    discard: [],
    hand: [],
    ultimateMeter: 0,
    cardsPlayedByCategory: { attack: 0, defend: 0, buff: 0, debuff: 0 },
    activeDefends: {}, // damageType -> { card, remaining }
    tempModifiers: [], // [{ effect, remaining }] from buff/debuff cards
    disabledSynergies: new Set(),
    disabledSynergyTimers: {}, // synergyId -> remaining turns
  };
}

function drawCard(fighter) {
  if (fighter.deck.length === 0) {
    if (fighter.discard.length === 0) return null;
    fighter.deck = shuffle(fighter.discard);
    fighter.discard = [];
  }
  return fighter.deck.pop();
}

function drawUpTo(fighter) {
  while (fighter.hand.length < HAND_SIZE) {
    const card = drawCard(fighter);
    if (!card) break;
    fighter.hand.push(card);
  }
}

// --- stats, derived from class + active synergies + temporary effects --

function computeActiveSynergyEffects(fighter) {
  const pool = fighter.classDef.synergyPool.filter((s) => !fighter.disabledSynergies.has(s.id));
  const activeCounts = {};
  for (const synergy of pool) {
    activeCounts[synergy.id] = fighter.cardsPlayedByCategory[synergy.countsCategory] ?? 0;
  }
  return resolveSynergies(pool, activeCounts);
}

function computeCurrentStats(fighter) {
  const synergyEffects = computeActiveSynergyEffects(fighter);
  const tempStatEffects = fighter.tempModifiers
    .map((m) => m.effect)
    .filter((e) => e.kind === EFFECT_KIND.STAT_MODIFIER);
  return computeEffectiveStats(fighter.classDef, [...synergyEffects, ...tempStatEffects]);
}

function currentUltimateRegen(fighter) {
  const stats = computeCurrentStats(fighter);
  let regen = stats.ur;
  for (const mod of fighter.tempModifiers) {
    if (mod.effect.kind === EFFECT_KIND.ENERGY_REGEN) {
      regen += mod.effect.mode === MODIFIER_MODE.PERCENT ? stats.ur * mod.effect.amount : mod.effect.amount;
    }
  }
  return regen;
}

function canUseUltimate(fighter) {
  return fighter.ultimateMeter >= fighter.classDef.ultimate.cost;
}

// --- resolving a played card --------------------------------------------

function resolveAttack(attacker, defender, card) {
  const defenderStats = computeCurrentStats(defender);
  const activeDefend = defender.activeDefends[card.damageType] ?? null;
  let value = applyDefend(card, activeDefend ? activeDefend.card : null);

  const resistKey = RESIST_STAT[card.damageType]; // undefined for TRUE damage
  if (resistKey) {
    value = Math.max(0, value - defenderStats[resistKey]);
  }

  if (activeDefend && activeDefend.card.stacking === STACKING.NONSTACKABLE) {
    delete defender.activeDefends[card.damageType];
  }

  defender.hp = Math.max(0, defender.hp - value);
  return value;
}

function resolveDefend(actor, card) {
  actor.activeDefends[card.damageType] = { card, remaining: card.duration };
}

function resolveStatusEffects(actor, target, card) {
  for (const effect of card.effects) {
    switch (effect.kind) {
      case EFFECT_KIND.METER_SIPHON:
        target.ultimateMeter = Math.max(0, target.ultimateMeter - effect.amount);
        break;
      case EFFECT_KIND.SYNERGY_DISABLE:
        target.disabledSynergies.add(effect.synergyId);
        target.disabledSynergyTimers[effect.synergyId] = card.duration;
        break;
      case EFFECT_KIND.STAT_MODIFIER:
      case EFFECT_KIND.ENERGY_REGEN:
        target.tempModifiers.push({ effect, remaining: card.duration });
        break;
      default:
        // CONDITIONAL / SUMMON: not implemented yet, see docs/DESIGN.md.
        break;
    }
  }
}

function playCard(actor, opponent, card) {
  switch (card.category) {
    case CARD_CATEGORY.ATTACK:
      resolveAttack(actor, opponent, card);
      break;
    case CARD_CATEGORY.DEFEND:
      resolveDefend(actor, card);
      break;
    case CARD_CATEGORY.BUFF:
      resolveStatusEffects(actor, actor, card);
      break;
    case CARD_CATEGORY.DEBUFF:
      resolveStatusEffects(actor, opponent, card);
      break;
  }

  actor.cardsPlayedByCategory[card.category] += 1;
  const index = actor.hand.findIndex((c) => c.id === card.id);
  if (index !== -1) actor.hand.splice(index, 1);
  actor.discard.push(card);
}

function useUltimate(actor, opponent) {
  actor.ultimateMeter -= actor.classDef.ultimate.cost;
  const damage = actor.classDef.ultimate.damage ?? 0;
  opponent.hp = Math.max(0, opponent.hp - damage);
  return damage;
}

// Tick every duration a fighter is carrying (active defends, temporary
// buff/debuff modifiers, disabled synergies) down by one. Called at the
// START of that fighter's own turn -- NOT right after they play the card
// that created them -- so e.g. a duration:1 defend card actually survives to
// see the opponent's next attack instead of expiring before the opponent
// ever gets a turn.
function tickStatusDurations(fighter) {
  for (const type of Object.keys(fighter.activeDefends)) {
    fighter.activeDefends[type].remaining -= 1;
    if (fighter.activeDefends[type].remaining <= 0) delete fighter.activeDefends[type];
  }

  fighter.tempModifiers = fighter.tempModifiers
    .map((m) => ({ effect: m.effect, remaining: m.remaining - 1 }))
    .filter((m) => m.remaining > 0);

  for (const id of Object.keys(fighter.disabledSynergyTimers)) {
    fighter.disabledSynergyTimers[id] -= 1;
    if (fighter.disabledSynergyTimers[id] <= 0) {
      fighter.disabledSynergies.delete(id);
      delete fighter.disabledSynergyTimers[id];
    }
  }
}

// Right after a fighter's own action: regen their ultimate meter and refill
// their hand. (Duration ticking is deliberately NOT here -- see
// tickStatusDurations above.)
function regenAndDraw(fighter) {
  fighter.ultimateMeter += currentUltimateRegen(fighter);
  drawUpTo(fighter);
}

// --- battle-level state --------------------------------------------------

function createBattle(playerClass, cpuClass) {
  const battle = {
    player: createFighter(playerClass, buildDeckForClass(playerClass)),
    cpu: createFighter(cpuClass, buildDeckForClass(cpuClass)),
    turn: "player",
    winner: null,
    log: [],
  };
  drawUpTo(battle.player);
  drawUpTo(battle.cpu);
  addLog(battle, `${battle.player.classDef.name} vs ${battle.cpu.classDef.name}. Fight!`);
  return battle;
}

function addLog(battle, message) {
  battle.log.unshift(message);
}

function checkWinner(battle) {
  if (battle.cpu.hp <= 0) battle.winner = battle.player;
  else if (battle.player.hp <= 0) battle.winner = battle.cpu;
  if (battle.winner) addLog(battle, `${battle.winner.classDef.name} wins!`);
}

function playerPlayCard(battle, cardId) {
  if (battle.winner || battle.turn !== "player") return;
  const card = battle.player.hand.find((c) => c.id === cardId);
  if (!card) return;

  tickStatusDurations(battle.player);
  playCard(battle.player, battle.cpu, card);
  addLog(battle, `You play ${card.name} (${card.category}).`);
  checkWinner(battle);
  if (battle.winner) return;

  regenAndDraw(battle.player);
  battle.turn = "cpu";
}

function playerUseUltimate(battle) {
  if (battle.winner || battle.turn !== "player" || !canUseUltimate(battle.player)) return;

  tickStatusDurations(battle.player);
  const damage = useUltimate(battle.player, battle.cpu);
  addLog(battle, `You unleash your ultimate for ${damage} damage!`);
  checkWinner(battle);
  if (battle.winner) return;

  regenAndDraw(battle.player);
  battle.turn = "cpu";
}

// Very simple CPU: use its ultimate the moment it's ready, otherwise defend
// when low on HP, otherwise favor its strongest attack, with occasional
// debuff/buff plays.
function chooseCpuCard(battle) {
  const hand = battle.cpu.hand;
  if (hand.length === 0) return null;

  const attacks = hand.filter((c) => c.category === CARD_CATEGORY.ATTACK);
  const defends = hand.filter((c) => c.category === CARD_CATEGORY.DEFEND);
  const debuffs = hand.filter((c) => c.category === CARD_CATEGORY.DEBUFF);
  const buffs = hand.filter((c) => c.category === CARD_CATEGORY.BUFF);

  const lowHp = battle.cpu.hp <= battle.cpu.maxHp * 0.4;

  if (lowHp && defends.length > 0) {
    return defends.reduce((a, b) => (a.amount >= b.amount ? a : b));
  }
  if (attacks.length > 0 && Math.random() < 0.7) {
    return attacks.reduce((a, b) => (a.value >= b.value ? a : b));
  }
  if (debuffs.length > 0 && Math.random() < 0.5) return debuffs[0];
  if (buffs.length > 0) return buffs[0];
  return hand[0];
}

function cpuTakeTurn(battle) {
  if (battle.winner || battle.turn !== "cpu") return;
  const cpu = battle.cpu;
  tickStatusDurations(cpu);

  if (canUseUltimate(cpu)) {
    const damage = useUltimate(cpu, battle.player);
    addLog(battle, `CPU unleashes its ultimate for ${damage} damage!`);
  } else {
    const card = chooseCpuCard(battle);
    if (!card) {
      battle.turn = "player";
      return;
    }
    playCard(cpu, battle.player, card);
    addLog(battle, `CPU plays ${card.name} (${card.category}).`);
  }

  checkWinner(battle);
  if (battle.winner) return;

  regenAndDraw(cpu);
  battle.turn = "player";
}

// --- small text helpers used by the UI -----------------------------------

function describeEffect(effect) {
  switch (effect.kind) {
    case EFFECT_KIND.STAT_MODIFIER: {
      const amount = effect.mode === MODIFIER_MODE.PERCENT ? `${effect.amount * 100}%` : effect.amount;
      return `${effect.stat.toUpperCase()} ${effect.amount >= 0 ? "+" : ""}${amount}`;
    }
    case EFFECT_KIND.ENERGY_REGEN:
      return `UR regen +${effect.amount}`;
    case EFFECT_KIND.METER_SIPHON:
      return `Drain ${effect.amount} UR`;
    case EFFECT_KIND.SYNERGY_DISABLE:
      return "Disables a synergy";
    default:
      return effect.kind;
  }
}

function describeCard(card) {
  switch (card.category) {
    case CARD_CATEGORY.ATTACK:
      return `${card.damageType} ${card.value}`;
    case CARD_CATEGORY.DEFEND: {
      const amount = card.mode === MODIFIER_MODE.PERCENT ? `${card.amount * 100}%` : card.amount;
      return `${card.damageType} block ${amount} (${card.duration}t)`;
    }
    case CARD_CATEGORY.BUFF:
    case CARD_CATEGORY.DEBUFF:
      return card.effects.map(describeEffect).join(", ");
    default:
      return "";
  }
}
