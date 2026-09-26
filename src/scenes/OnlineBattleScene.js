// Online PvP battle screen. Draws exactly like the vs-CPU BattleScene -- it
// only swaps where the battle comes from: instead of running engine.js
// locally, it shows the server's copy (via src/online/matchApi.js) and sends
// each click to the `game` Edge Function, which resolves the round once both
// players have picked.

import { BattleScene } from "./BattleScene.js";
import { isBattleOver } from "../model/engine.js";
import { buildBattleView, fetchHand, fetchMatch, leaveMatch, submitAction, watchMatch } from "../online/matchApi.js";

export class OnlineBattleScene extends BattleScene {
  constructor() {
    super("OnlineBattleScene");
  }

  // data: { matchId, userId, match, hand } from LobbyScene
  setupBattle(data) {
    this.matchId = data.matchId;
    this.userId = data.userId;
    this.submitting = false;
    this.pendingPick = null; // name of what we just locked in, until the round resolves
    this.errorMessage = null;
    this.refreshSeq = 0;
    this.lastSignature = signature(data.match, data.hand);

    this.stopWatching = watchMatch(this.matchId, () => this.refresh());
    this.events.once("shutdown", () => this.stopWatching());

    return buildBattleView(data.match, data.hand, this.userId);
  }

  get playerLabel() {
    return "You";
  }

  get opponentLabel() {
    return "Opponent";
  }

  get leaveLabel() {
    return "Leave";
  }

  canAct() {
    return !isBattleOver(this.battle) && !this.battle.myReady && !this.submitting && !this.pendingPick;
  }

  commitAction(action) {
    this.submitting = true;
    this.errorMessage = null;
    this.pendingPick = action.kind === "card" ? action.card.name : "your ultimate";
    this.render();

    submitAction(this.matchId, action)
      .catch((err) => {
        this.errorMessage = err.message;
        this.pendingPick = null;
      })
      .finally(() => {
        this.submitting = false;
        this.refresh();
        this.render();
      });
  }

  onLeave() {
    const inProgress = !isBattleOver(this.battle);
    if (inProgress && !window.confirm("Leave this match? It counts as a loss.")) return;
    if (inProgress) leaveMatch(this.matchId).catch(() => {});
    this.scene.start("ClassSelectScene");
  }

  statusMessage() {
    const b = this.battle;
    if (b.draw) return `Draw! Press "Leave" to go back.`;
    if (b.winner) return `${b.winner === b.player ? "You win!" : "Your opponent wins."} Press "Leave" to go back.`;
    if (this.errorMessage) return `Round ${b.round} — ${this.errorMessage}`;
    if (this.pendingPick || b.myReady) {
      const what = this.pendingPick ?? "your move";
      return `Round ${b.round} — you locked in ${what}. ${b.opponentReady ? "Resolving…" : "Waiting for your opponent…"}`;
    }
    return `Round ${b.round} — pick a card. ${
      b.opponentReady ? "Your opponent has already chosen." : "Your opponent is choosing at the same time."
    }`;
  }

  // Pull the latest match + hand and redraw if anything changed. Called by
  // Realtime events, the fallback poll, and after our own submit; only the
  // newest call's result is applied so a slow response can't roll the screen
  // back.
  async refresh() {
    const seq = ++this.refreshSeq;
    let match, hand;
    try {
      [match, hand] = await Promise.all([fetchMatch(this.matchId), fetchHand(this.matchId, this.userId)]);
    } catch {
      return; // transient network error; the next poll will try again
    }
    if (seq !== this.refreshSeq || !this.scene.isActive()) return;

    const sig = signature(match, hand);
    if (sig === this.lastSignature) return;
    this.lastSignature = sig;

    this.battle = buildBattleView(match, hand, this.userId);
    if (!this.battle.myReady && !this.submitting) this.pendingPick = null;
    this.render();
  }
}

function signature(match, hand) {
  return [match.updated_at, match.status, match.p1_ready, match.p2_ready, hand.map((c) => c.id).join(",")].join("|");
}
