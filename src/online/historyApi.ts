// The logged-in player's PvP record (the `pvp_records` and `match_history`
// tables, supabase/migrations/*_match_history.sql). Both are written by the
// server only; the browser just reads its own rows. vs-CPU games aren't
// recorded.

import { supabase } from "./supabaseClient.ts";

export type MatchResult = "win" | "loss" | "draw";

export interface PvpRecord {
  wins: number;
  draws: number;
  losses: number;
}

export interface HistoryEntry {
  id: string;
  result: MatchResult;
  myClass: string;
  opponentClass: string;
  opponentName: string;
  rounds: number;
  finishedAt: string;
}

interface HistoryRow {
  id: string;
  result: MatchResult;
  my_class: string;
  opponent_class: string;
  opponent_name: string;
  rounds: number;
  finished_at: string;
}

// How many games match_history keeps per player (the trigger in the
// migration deletes older ones).
export const RECENT_LIMIT = 5;

// Everything the menu's history panel shows, in one go.
export interface MatchHistoryData {
  record: PvpRecord;
  recent: HistoryEntry[]; // newest first
  // This player's win rate with each class; null if it couldn't be loaded
  // (e.g. the class_win_stats migration isn't applied yet).
  classRates: ClassWinRate[] | null;
}

export async function fetchMatchHistory(): Promise<MatchHistoryData> {
  const classRates = fetchClassWinRates("mine").catch(() => null);
  const [recordRes, recentRes] = await Promise.all([
    supabase.from("pvp_records").select("wins, draws, losses").maybeSingle(),
    supabase
      .from("match_history")
      .select("id, result, my_class, opponent_class, opponent_name, rounds, finished_at")
      .order("finished_at", { ascending: false })
      .limit(RECENT_LIMIT),
  ]);
  if (recordRes.error) throw new Error(recordRes.error.message);
  if (recentRes.error) throw new Error(recentRes.error.message);
  // No row yet = no PvP games yet.
  const record = (recordRes.data as PvpRecord | null) ?? { wins: 0, draws: 0, losses: 0 };
  const recent = (recentRes.data as HistoryRow[]).map((row) => ({
    id: row.id,
    result: row.result,
    myClass: row.my_class,
    opponentClass: row.opponent_class,
    opponentName: row.opponent_name,
    rounds: row.rounds,
    finishedAt: row.finished_at,
  }));
  return { record, recent, classRates: await classRates };
}

// --- class win rates (supabase/migrations/*_class_win_stats.sql) ---------

export type WinRateMode = "pvp" | "cpu";

export interface ClassWinRate {
  classId: string;
  mode: WinRateMode;
  wins: number;
  draws: number;
  losses: number;
  games: number;
  winRate: number | null; // percent, draws counting half; null with no games
}

interface ClassWinRateRow {
  class_id: string;
  mode: WinRateMode;
  wins: number;
  draws: number;
  losses: number;
  games: number;
  win_rate: number | string | null; // numeric comes back as a string
}

// All-time win rate per class, PvP and vs-CPU: "all" = every player's games,
// "mine" = the logged-in player's own.
export async function fetchClassWinRates(scope: "all" | "mine"): Promise<ClassWinRate[]> {
  const { data, error } = await supabase
    .from(scope === "all" ? "class_win_rates" : "my_class_win_rates")
    .select("class_id, mode, wins, draws, losses, games, win_rate");
  if (error) throw new Error(error.message);
  return (data as ClassWinRateRow[]).map((row) => ({
    classId: row.class_id,
    mode: row.mode,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    games: row.games,
    winRate: row.win_rate === null ? null : Number(row.win_rate),
  }));
}

// Count a finished vs-CPU game toward the player's class (logged in only).
export async function recordCpuGame(classId: string, result: MatchResult): Promise<void> {
  const { error } = await supabase.rpc("record_cpu_game", { p_class: classId, p_result: result });
  if (error) throw new Error(error.message);
}
