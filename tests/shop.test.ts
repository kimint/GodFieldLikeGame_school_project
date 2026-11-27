// Unlock rules (src/model/shop.ts): Guardian is free, normal cards come with
// the class, rare / legend cards have to be bought, admins own everything,
// and the "Win: +N G" preview respects the first-win bonus and the daily cap.
// The database functions charge and pay with the same numbers
// (supabase/migrations/*_rewards_and_unlocks.sql).

import { beforeAll, describe, expect, it } from "vitest";
import { allCards, findClassById, useLocalCatalog } from "../src/model/catalog.ts";
import { cardRarity } from "../src/model/cardTypes.ts";
import { starterDeckList } from "../src/model/decks.ts";
import { CLASS_PRICES, REWARDS, cardPrice, lockedCardsIn, ownsCard, ownsClass, winPreview, type Economy } from "../src/model/shop.ts";

const player = (over: Partial<Economy> = {}): Economy => ({
  admin: false,
  gold: 0,
  dailyGold: 0,
  firstWinAvailable: true,
  classes: ["guardian"],
  cards: [],
  ...over,
});

beforeAll(() => {
  useLocalCatalog();
});

describe("class ownership", () => {
  it("every player owns Guardian and nothing else to start", () => {
    expect(ownsClass(player(), "guardian")).toBe(true);
    expect(ownsClass(player({ classes: [] }), "guardian")).toBe(true);
    expect(ownsClass(player(), "necromancer")).toBe(false);
    expect(ownsClass(player({ classes: ["guardian", "necromancer"] }), "necromancer")).toBe(true);
  });

  it("admins and offline play own everything", () => {
    expect(ownsClass(player({ admin: true }), "necromancer")).toBe(true);
    expect(ownsClass(null, "necromancer")).toBe(true);
  });

  it("every class has a price, Guardian is free", () => {
    for (const id of ["guardian", "pyromancer", "black_mage", "craftsman", "necromancer"]) findClassById(id);
    expect(CLASS_PRICES["guardian"]).toBe(0);
    expect(CLASS_PRICES["necromancer"]).toBe(2500);
  });
});

describe("card ownership", () => {
  const rare = () => allCards().find((c) => cardRarity(c.props) === "rare")!;
  const legend = () => allCards().find((c) => cardRarity(c.props) === "legend")!;
  const normal = () => allCards().find((c) => cardRarity(c.props) === "normal")!;

  it("prices by rarity; normal cards aren't sold", () => {
    expect(cardPrice(normal())).toBeNull();
    expect(cardPrice(rare())).toBe(300);
    expect(cardPrice(legend())).toBe(800);
  });

  it("normal cards are owned, rare / legend only once bought", () => {
    expect(ownsCard(player(), normal())).toBe(true);
    expect(ownsCard(player(), rare())).toBe(false);
    expect(ownsCard(player({ cards: [rare().id] }), rare())).toBe(true);
    expect(ownsCard(player({ admin: true }), legend())).toBe(true);
  });

  it("lists the locked cards in a deck", () => {
    const list = starterDeckList(findClassById("guardian"));
    const locked = lockedCardsIn(player(), list);
    const expected = list.filter((e) => cardPrice(allCards().find((c) => c.id === e.cardId)) !== null).length;
    expect(locked).toHaveLength(expected);
    expect(lockedCardsIn(player({ admin: true }), list)).toEqual([]);
    expect(lockedCardsIn(null, list)).toEqual([]);
  });
});

describe("win preview", () => {
  it("adds the first-win bonus and stops at the daily cap", () => {
    expect(winPreview(player())).toBe(REWARDS.win + REWARDS.firstWinBonus);
    expect(winPreview(player({ firstWinAvailable: false }))).toBe(REWARDS.win);
    expect(winPreview(player({ firstWinAvailable: false, dailyGold: 950 }))).toBe(50);
    expect(winPreview(player({ dailyGold: REWARDS.dailyCap }))).toBe(0);
  });
});
