// Browser side of online PvP. Everything that changes a match goes through
// the `game` Edge Function (supabase/functions/game/); the browser itself
// can only READ -- its match row and its own hand, as the RLS policies in
// supabase/migrations/*_online_pvp.sql allow.
//
// Sign-in is anonymous (no account needed), and the session lives in
// sessionStorage rather than localStorage, so every browser tab is its own
// player -- two tabs on one machine can play each other for testing.

import { createClient } from "@supabase/supabase-js";
import { deserializeFighter } from "../model/serialize.js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Realtime is the fast path; this poll only catches anything it missed.
const POLL_INTERVAL_MS = 3000;

export const onlineAvailable = Boolean(SUPABASE_URL && SUPABASE_KEY);

const supabase = onlineAvailable
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { storage: window.sessionStorage } })
  : null;

// Returns the signed-in user's id, signing in anonymously first if needed.
export async function ensureSignedIn() {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.user.id;

  const { data: signedIn, error } = await supabase.auth.signInAnonymously();
  if (error) {
    throw new Error(`Couldn't sign in (${error.message}). Is "Allow anonymous sign-ins" on in the Supabase dashboard?`);
  }
  return signedIn.user.id;
}

async function callGame(body) {
  const { data, error } = await supabase.functions.invoke("game", { body });
  if (error) {
    // The function answers errors as { error: "..." }; prefer that over
    // supabase-js's generic "non-2xx status code".
    let message = error.message;
    try {
      const payload = await error.context.json();
      if (payload?.error) message = payload.error;
    } catch {
      // not a JSON error body -- keep the generic message
    }
    throw new Error(message);
  }
  return data;
}

export const createMatch = (classId) => callGame({ op: "create", classId });
export const joinMatch = (code, classId) => callGame({ op: "join", code, classId });
export const leaveMatch = (matchId) => callGame({ op: "leave", matchId });

// action: an engine action from cardAction()/ultimateAction(); only the card
// id goes over the wire -- the server re-checks it against its own copy.
export function submitAction(matchId, action) {
  const wire = action.kind === "card" ? { kind: "card", cardId: action.card.id } : { kind: "ultimate" };
  return callGame({ op: "submit", matchId, action: wire });
}

export async function fetchMatch(matchId) {
  const { data, error } = await supabase.from("matches").select("*").eq("id", matchId).single();
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchHand(matchId, userId) {
  const { data, error } = await supabase
    .from("match_hands")
    .select("hand")
    .eq("match_id", matchId)
    .eq("player", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.hand ?? [];
}

// Call onChange() whenever the match or this player's hand might have
// changed. Returns a function that stops watching.
export function watchMatch(matchId, onChange) {
  const channel = supabase
    .channel(`match:${matchId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "matches", filter: `id=eq.${matchId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "match_hands", filter: `match_id=eq.${matchId}` }, onChange)
    .subscribe((status) => {
      if (status === "SUBSCRIBED") onChange();
    });
  const timer = setInterval(onChange, POLL_INTERVAL_MS);

  return () => {
    clearInterval(timer);
    supabase.removeChannel(channel);
  };
}

// Turn a match row + this player's hand into the same { player, cpu, ... }
// shape engine.js battles have, from this player's point of view -- `player`
// is always "me" and `cpu` always the opponent, so BattleScene can render it
// unchanged. The opponent's hand is always empty here: it's never sent.
export function buildBattleView(match, hand, userId) {
  const mySide = match.p1 === userId ? "p1" : "p2";
  const p1 = deserializeFighter(match.fighters.player, mySide === "p1" ? hand : []);
  const p2 = deserializeFighter(match.fighters.cpu, mySide === "p2" ? hand : []);
  const me = mySide === "p1" ? p1 : p2;
  const opponent = mySide === "p1" ? p2 : p1;

  return {
    player: me,
    cpu: opponent,
    round: match.round,
    log: match.log,
    winner: match.winner === mySide ? me : match.winner && match.winner !== "draw" ? opponent : null,
    draw: match.winner === "draw",
    status: match.status,
    myReady: match[`${mySide}_ready`],
    opponentReady: match[`${mySide === "p1" ? "p2" : "p1"}_ready`],
  };
}
