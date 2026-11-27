// Leaderboard rankings (supabase/migrations/*_leaderboard.sql). One database
// function returns the top 50 for a category plus the caller's own row.
// Only random matches count, and the Gold ranking uses lifetime Gold earned
// (spending in the shop never lowers it).

import { supabase } from "./supabaseClient.ts";

export type LeaderboardCategory = "wins" | "gold";

export interface LeaderboardEntry {
  rank: number | null; // null = not ranked yet (no score in this category)
  isMe: boolean;
  name: string;
  avatarUrl: string | null;
  mainClass: string; // class id the player has played most in PvP
  wins: number;
  draws: number;
  losses: number;
  earned: number; // lifetime Gold earned
  balance: number; // Gold they have right now
}

export interface LeaderboardData {
  rows: LeaderboardEntry[]; // rank 1.., at most LEADERBOARD_SIZE
  me: LeaderboardEntry | null;
}

export const LEADERBOARD_SIZE = 50;

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0)) || 0;

function toEntry(raw: unknown): LeaderboardEntry {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    rank: r.rank === null || r.rank === undefined ? null : num(r.rank),
    isMe: r.isMe === true,
    name: typeof r.name === "string" && r.name ? r.name : "Player",
    avatarUrl: typeof r.avatarUrl === "string" && r.avatarUrl ? r.avatarUrl : null,
    mainClass: typeof r.mainClass === "string" && r.mainClass ? r.mainClass : "guardian",
    wins: num(r.wins),
    draws: num(r.draws),
    losses: num(r.losses),
    earned: num(r.earned),
    balance: num(r.balance),
  };
}

export async function fetchLeaderboard(category: LeaderboardCategory): Promise<LeaderboardData> {
  const { data, error } = await supabase.rpc("leaderboard", { p_category: category });
  if (error) {
    if (error.message.includes("leaderboard") && error.message.includes("schema cache")) {
      throw new Error("The leaderboard isn't set up on this server yet (run the leaderboard migration).");
    }
    throw new Error(error.message);
  }
  const d = (data ?? {}) as { rows?: unknown[]; me?: unknown };
  return {
    rows: Array.isArray(d.rows) ? d.rows.map(toEntry) : [],
    me: d.me ? toEntry(d.me) : null,
  };
}
