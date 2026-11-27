// Gold rewards and the Unlock Shop: prices, reward numbers, and who owns
// what. The numbers are mirrored in
// supabase/migrations/*_rewards_and_unlocks.sql, which is what actually
// charges and pays -- change both together.
//
// Every player owns Guardian. Owning a class gives its starter deck and its
// normal cards; its rare and legend cards are bought one by one or from a
// card pack, and a custom deck can only use cards the player owns. Admins
// own everything.

import { cardRarity, type Rarity } from "./cardTypes.ts";
import { getCatalog, type CatalogCardEntry } from "./catalog.ts";
import type { DeckListEntry } from "./decks.ts";

export const REWARDS = {
  win: 100,
  loss: 20, // also paid for a draw
  firstWinBonus: 150,
  dailyCap: 1000,
  minTurns: 4,
} as const;

// The day for the daily cap and the first-win bonus.
export const REWARD_TIME_ZONE = "America/New_York";

export const FREE_CLASS_ID = "guardian";

export const CLASS_PRICES: Readonly<Record<string, number>> = {
  guardian: 0,
  pyromancer: 1500,
  black_mage: 1500,
  craftsman: 2000,
  necromancer: 2500,
};

// Normal cards aren't sold: they come with the class.
export const CARD_PRICES: Readonly<Partial<Record<Rarity, number>>> = { rare: 300, legend: 800 };

export const CARD_PACK = { price: 300, odds: { rare: 3, legend: 1 } } as const;

// The logged-in player's Gold and unlocks (my_economy() in the migration).
export interface Economy {
  admin: boolean;
  gold: number;
  dailyGold: number; // Gold earned from matches today, toward REWARDS.dailyCap
  firstWinAvailable: boolean;
  classes: string[]; // owned class ids
  cards: string[]; // bought rare / legend card ids
}

// What the server paid one player for a random match (grant_match_reward()).
export interface MatchReward {
  base: number;
  firstWinBonus: number;
  capCut: number; // Gold the daily cap took off
  granted: number;
  gold: number; // balance after
  dailyGold: number; // earned today, after
  turns: number;
  blocked: Array<"min_turns" | "early_surrender">; // non-empty = 0 G, and why
}

// null = no economy (offline / not logged in): everything is open.
export function ownsClass(economy: Economy | null, classId: string): boolean {
  if (!economy || economy.admin) return true;
  return classId === FREE_CLASS_ID || economy.classes.includes(classId);
}

export function cardPrice(card: Pick<CatalogCardEntry, "props"> | null | undefined): number | null {
  return CARD_PRICES[cardRarity(card?.props)] ?? null;
}

// Whether the player may put this card in a custom deck.
export function ownsCard(economy: Economy | null, card: Pick<CatalogCardEntry, "id" | "props">): boolean {
  if (!economy || economy.admin) return true;
  return cardPrice(card) === null || economy.cards.includes(card.id);
}

// The cards in a deck list the player doesn't own yet (by name).
export function lockedCardsIn(economy: Economy | null, list: DeckListEntry[]): string[] {
  if (!economy || economy.admin) return [];
  const cards = getCatalog().cards;
  return list
    .map((e) => cards.get(e.cardId))
    .filter((c): c is CatalogCardEntry => !!c && !ownsCard(economy, c))
    .map((c) => c.name);
}

// The "Win: +N G" preview: what a win would pay right now.
export function winPreview(economy: Economy): number {
  const room = Math.max(0, REWARDS.dailyCap - economy.dailyGold);
  return Math.min(room, REWARDS.win + (economy.firstWinAvailable ? REWARDS.firstWinBonus : 0));
}

export const formatGold = (n: number): string => `${Math.round(n).toLocaleString("en-US")} G`;
