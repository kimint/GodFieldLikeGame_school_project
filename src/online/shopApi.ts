// The logged-in player's Gold and unlocks, and the Unlock Shop purchases
// (supabase/migrations/*_rewards_and_unlocks.sql). Every purchase runs as
// one database function that checks the price and the balance; the UI only
// shows the new state once the server has answered (no optimistic updates).

import type { Economy } from "../model/shop.ts";
import { supabase } from "./supabaseClient.ts";

function fail(error: { message: string }): never {
  if (error.message.includes("my_economy") || error.message.includes("schema cache")) {
    throw new Error("The shop isn't set up on this server yet (run the rewards_and_unlocks migration).");
  }
  throw new Error(error.message);
}

const toEconomy = (data: unknown): Economy => {
  const d = (data ?? {}) as Partial<Economy>;
  return {
    admin: d.admin === true,
    gold: Number(d.gold ?? 0),
    dailyGold: Number(d.dailyGold ?? 0),
    firstWinAvailable: d.firstWinAvailable !== false,
    classes: Array.isArray(d.classes) ? d.classes : [],
    cards: Array.isArray(d.cards) ? d.cards : [],
  };
};

export async function fetchEconomy(): Promise<Economy> {
  const { data, error } = await supabase.rpc("my_economy");
  if (error) fail(error);
  return toEconomy(data);
}

export async function unlockClass(classId: string): Promise<Economy> {
  const { data, error } = await supabase.rpc("unlock_class", { p_class_id: classId });
  if (error) fail(error);
  return toEconomy(data);
}

export async function unlockCard(cardId: string): Promise<Economy> {
  const { data, error } = await supabase.rpc("unlock_card", { p_card_id: cardId });
  if (error) fail(error);
  return toEconomy(data);
}

// The new state, plus the card the pack gave.
export async function openCardPack(): Promise<{ economy: Economy; cardId: string }> {
  const { data, error } = await supabase.rpc("open_card_pack");
  if (error) fail(error);
  return { economy: toEconomy(data), cardId: String((data as { granted?: string }).granted ?? "") };
}
