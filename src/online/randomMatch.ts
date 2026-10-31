// Random match and private rooms through the Colyseus server
// (server/BattleRoom.ts). The room
// lives from the lobby ("looking for an opponent") into the battle scene, so
// this wrapper keeps the latest view and hands it to whoever is listening.
import { Client, type Room } from "@colyseus/sdk";
import { supabase } from "./supabaseClient.ts";
import { toClientAction, type Action } from "../model/engine.ts";
import type { RandomMatchView, RematchEndReason } from "./randomMatchView.ts";

export type { RandomMatchView, RematchEndReason };

const COLYSEUS_URL = import.meta.env.VITE_COLYSEUS_URL ?? "ws://localhost:2567";
// Lets a reloaded tab get back into its match (the server holds the seat for
// 30 seconds). Per tab, like the Supabase session.
const TOKEN_KEY = "zenkake.randomMatch.reconnect";

function saveToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage blocked: reloading just won't rejoin
  }
}

function savedToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export class RandomMatch {
  readonly code: string; // the room id; for a private room, the code to share
  latest: RandomMatchView | null = null;
  closed = false;
  reconnecting = false; // our own connection dropped; the SDK is retrying
  // Local-clock deadlines (ms) from the latest view.
  turnDeadline: number | null = null;
  opponentDeadline: number | null = null;
  rematchDeadline: number | null = null; // while the post-battle rematch window is open
  rematchEnded: RematchEndReason | null = null; // why the room closed without a rematch
  private viewListeners = new Set<(view: RandomMatchView) => void>();
  private errorListeners = new Set<(message: string) => void>();
  private closeListeners = new Set<() => void>();
  private connectionListeners = new Set<() => void>();
  private newGameListeners = new Set<() => void>();
  private rematchEndListeners = new Set<(reason: RematchEndReason) => void>();

  constructor(private room: Room) {
    this.code = room.roomId;
    saveToken(room.reconnectionToken);
    room.onMessage("state", (view: RandomMatchView) => {
      const now = Date.now();
      const newGame = this.latest !== null && view.game !== this.latest.game;
      this.latest = view;
      this.turnDeadline = view.turnMsLeft === null ? null : now + view.turnMsLeft;
      this.opponentDeadline = view.opponentReconnectMsLeft === null ? null : now + view.opponentReconnectMsLeft;
      this.rematchDeadline = view.rematchMsLeft === null ? null : now + view.rematchMsLeft;
      // A rematch started: the battle screen starts over instead of updating.
      if (newGame) for (const l of this.newGameListeners) l();
      else for (const l of this.viewListeners) l(view);
    });
    room.onMessage("rematchEnded", (reason: RematchEndReason) => {
      this.rematchEnded = reason;
      this.rematchDeadline = null;
      saveToken(null);
      for (const l of this.rematchEndListeners) l(reason);
    });
    room.onMessage("error", (message: string) => {
      for (const l of this.errorListeners) l(message);
    });
    room.onMessage("waiting", () => {});
    // Wifi blip / sleeping laptop: the SDK reconnects on its own.
    room.onDrop(() => {
      this.reconnecting = true;
      for (const l of this.connectionListeners) l();
    });
    room.onReconnect(() => {
      this.reconnecting = false;
      saveToken(room.reconnectionToken);
      for (const l of this.connectionListeners) l();
    });
    room.onLeave(() => {
      this.closed = true;
      this.reconnecting = false;
      saveToken(null);
      for (const l of this.closeListeners) l();
    });
  }

  onConnectionChange(listener: () => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  onNewGame(listener: () => void): () => void {
    this.newGameListeners.add(listener);
    return () => this.newGameListeners.delete(listener);
  }

  onRematchEnded(listener: (reason: RematchEndReason) => void): () => void {
    this.rematchEndListeners.add(listener);
    return () => this.rematchEndListeners.delete(listener);
  }

  // Ask for a rematch once the battle is over.
  rematch(): void {
    if (!this.closed) this.room.send("rematch");
  }

  onView(listener: (view: RandomMatchView) => void): () => void {
    this.viewListeners.add(listener);
    return () => this.viewListeners.delete(listener);
  }

  onError(listener: (message: string) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  // This turn's plays; only card ids go over the wire, the server re-checks them.
  pick(action: Action): void {
    this.room.send("pick", toClientAction(action));
  }

  leave(): void {
    saveToken(null);
    if (!this.closed) void this.room.leave(true);
  }
}

// The Supabase login the server checks in onAuth.
async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Log in to an account to play online");
  return token;
}

// A reloaded tab still inside its 30 seconds goes back to the same match.
async function resumeSavedMatch(client: Client): Promise<RandomMatch | null> {
  const previous = savedToken();
  if (!previous) return null;
  try {
    return new RandomMatch(await client.reconnect(previous));
  } catch {
    saveToken(null); // too late, or that match is over
    return null;
  }
}

export async function findRandomMatch(classId: string, deckId: string | null): Promise<RandomMatch> {
  const token = await accessToken();
  const client = new Client(COLYSEUS_URL);
  const resumed = await resumeSavedMatch(client);
  if (resumed) return resumed;
  // Joins a room that is waiting for a second player, or opens a new one.
  const room = await client.joinOrCreate("battle", { token, classId, deckId });
  return new RandomMatch(room);
}

// Private room: a room only reachable by its code (the room id). Same
// server room, so it has the same turn timer and reconnection.
export async function createPrivateMatch(classId: string, deckId: string | null): Promise<RandomMatch> {
  const token = await accessToken();
  const client = new Client(COLYSEUS_URL);
  const resumed = await resumeSavedMatch(client);
  if (resumed) return resumed;
  const room = await client.create("battle", { private: true, token, classId, deckId });
  return new RandomMatch(room);
}

export async function joinPrivateMatch(code: string, classId: string, deckId: string | null): Promise<RandomMatch> {
  const token = await accessToken();
  const client = new Client(COLYSEUS_URL);
  const resumed = await resumeSavedMatch(client);
  if (resumed) return resumed;
  const roomCode = code.trim().toUpperCase();
  try {
    return new RandomMatch(await client.joinById(roomCode, { token, classId, deckId }));
  } catch (err) {
    const message = (err as Error).message ?? "";
    // The server's own reasons (own room, bad deck, ...) are shown as-is.
    if (/not found|locked|full|invalid/i.test(message)) throw new Error(`No open room with code ${roomCode}`);
    throw err;
  }
}
