// Smoke tests for the game model: the offline catalog loads, the defend math
// is right, a battle can be played to the end, and battle state survives the
// JSON round trip online PvP relies on.

import { beforeAll, describe, expect, it } from "vitest";
import { applyDefend } from "../src/model/cardTypes.js";
import { DAMAGE_TYPE } from "../src/model/damageTypes.js";
import { MODIFIER_MODE } from "../src/model/effects.js";
import { allClasses, useLocalCatalog } from "../src/model/catalog.js";
import { cardAction, createBattle, isBattleOver, playRound, ultimateAction } from "../src/model/engine.js";
import { deserializeBattle, serializeBattle } from "../src/model/serialize.js";

beforeAll(() => {
  useLocalCatalog();
});

describe("applyDefend", () => {
  const attack = { damageType: DAMAGE_TYPE.PHYSICAL, value: 10 };

  it("subtracts a flat defend of the same damage type", () => {
    expect(applyDefend(attack, { damageType: DAMAGE_TYPE.PHYSICAL, mode: MODIFIER_MODE.FLAT, amount: 4 })).toBe(6);
  });

  it("scales by a percent defend", () => {
    expect(applyDefend(attack, { damageType: DAMAGE_TYPE.PHYSICAL, mode: MODIFIER_MODE.PERCENT, amount: 0.5 })).toBe(5);
  });

  it("ignores a defend of a different damage type", () => {
    expect(applyDefend(attack, { damageType: DAMAGE_TYPE.MAGIC, mode: MODIFIER_MODE.FLAT, amount: 4 })).toBe(10);
  });

  it("never goes below zero", () => {
    expect(applyDefend(attack, { damageType: DAMAGE_TYPE.PHYSICAL, mode: MODIFIER_MODE.FLAT, amount: 99 })).toBe(0);
  });
});

describe("local catalog", () => {
  it("has at least two classes", () => {
    expect(allClasses().length).toBeGreaterThanOrEqual(2);
  });
});

describe("battle engine", () => {
  it("starts both fighters with full HP and a hand", () => {
    const [a, b] = allClasses();
    const battle = createBattle(a, b);
    expect(battle.player.hp).toBe(a.baseStats.hp);
    expect(battle.cpu.hp).toBe(b.baseStats.hp);
    expect(battle.player.hand.length).toBeGreaterThan(0);
    expect(isBattleOver(battle)).toBe(false);
  });

  it("finishes a game when the player keeps playing its first card", () => {
    const [a, b] = allClasses();
    const battle = createBattle(a, b);
    for (let i = 0; i < 500 && !isBattleOver(battle); i++) {
      const action =
        ultimateAction(battle.player) ??
        (battle.player.hand[0] ? cardAction(battle.player, battle.player.hand[0].id) : { kind: "none" });
      playRound(battle, action);
    }
    expect(isBattleOver(battle)).toBe(true);
  });

  it("survives serialize -> JSON -> deserialize", () => {
    const [a, b] = allClasses();
    const battle = createBattle(a, b);
    const restored = deserializeBattle(JSON.parse(JSON.stringify(serializeBattle(battle))));
    expect(restored.player.classDef.id).toBe(a.id);
    expect(restored.player.hand.map((c) => c.id)).toEqual(battle.player.hand.map((c) => c.id));
    expect(restored.round).toBe(battle.round);
  });
});
