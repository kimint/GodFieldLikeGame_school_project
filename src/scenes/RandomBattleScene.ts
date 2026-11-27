// Online battle screen (random match and private rooms). Draws exactly like the vs-CPU BattleScene; the
// battle comes from the Colyseus server (src/online/randomMatch.ts), which
// resolves the round once both players have picked.

import { BattleScene, type BattleSceneData, type ResultAction } from "./BattleScene.ts";
import { COLORS, FONT_DISPLAY, FONT_NUM, FONT_UI, GOLD, GOLD_CSS, type Button } from "./theme.ts";
import { RESULT_TEXT } from "./resultScreen.ts";
import { REWARDS, formatGold, type MatchReward } from "../model/shop.ts";
import { isBattleOver, type Action, type Fighter } from "../model/engine.ts";
import { deserializeFighter } from "../model/serialize.ts";
import type { BattleView } from "../online/matchApi.ts";
import type { RandomMatch, RandomMatchView } from "../online/randomMatch.ts";
import { confirmDialog } from "../ui/dialog.ts";

export interface RandomBattleData {
  match: RandomMatch;
  onExit?: (() => void) | null;
  onAccountSettings?: (() => void) | null;
}

function toBattleView(view: RandomMatchView): BattleView {
  const me = deserializeFighter(view.me);
  const opponent = deserializeFighter(view.opponent, []);
  return {
    player: me,
    cpu: opponent,
    round: view.round,
    log: view.log,
    winner: view.result === "win" ? me : view.result === "lose" ? opponent : null,
    draw: view.result === "draw",
    status: view.over ? "finished" : "active",
    myReady: view.myReady,
    opponentReady: view.opponentReady,
  };
}

export class RandomBattleScene extends BattleScene {
  declare battle: BattleView;
  match!: RandomMatch;
  pendingPick: string | null = null;
  errorMessage: string | null = null;
  opponentGone = false;
  // What was planned when we locked in, to hand back if the server rejects it.
  planned: Pick<RandomBattleScene, "staged" | "stagedUltimate" | "stagedTargets" | "orders"> | null = null;
  // Rematch (after the battle): whether the result screen shows Rematch /
  // Leave, whether we pressed Rematch, and when we go back to the lobby.
  rematchOffered = false;
  rematchSent = false;
  exitAt: number | null = null;
  leaving = false;
  // The Gold block on the result screen, filled in once the server has paid.
  rewardBox: { amount: Phaser.GameObjects.Text; detail: Phaser.GameObjects.Text; balance: Phaser.GameObjects.Text; today: Phaser.GameObjects.Text } | null = null;
  rewardShown = false;

  constructor() {
    super("RandomBattleScene");
  }

  override setupBattle(data: BattleSceneData | RandomBattleData): BattleView {
    const { match } = data as RandomBattleData;
    this.match = match;
    this.pendingPick = null;
    this.errorMessage = null;
    this.opponentGone = false;
    this.autoEnded = false;
    this.rematchOffered = false;
    this.rematchSent = false;
    this.exitAt = null;
    this.leaving = false;
    this.rewardBox = null;
    this.rewardShown = false;

    const unsubscribe = [
      match.onView((view) => this.applyView(view)),
      match.onError((message) => {
        this.errorMessage = message;
        this.pendingPick = null;
        // The round never resolved: give the picked cards back to plan with.
        this.pendingTurn = null;
        if (this.planned) Object.assign(this, this.planned);
        this.planned = null;
        this.render();
      }),
      match.onClose(() => {
        // The server closes the room when the match ends; before that it means
        // we lost the connection for good.
        if (!isBattleOver(this.battle)) {
          this.errorMessage = "Lost connection to the match.";
          this.render();
        } else if (this.rematchOffered && !match.rematchEnded && this.exitAt === null) {
          this.exitAt = Date.now(); // closed during the rematch window without a reason: just go back
        }
      }),
      match.onConnectionChange(() => this.render()),
      // Both pressed Rematch: start this screen over with the new battle.
      match.onNewGame(() => this.scene.restart({ match, onExit: this.onExit, onAccountSettings: this.onAccountSettings })),
      match.onRematchEnded((reason) => {
        const now = Date.now();
        if (reason === "opponentLeft") this.exitAt = now + 5000;
        else this.exitAt = match.latest?.myRematch || this.rematchSent ? now + 3000 : now;
        this.onTurnTick();
      }),
    ];
    // The countdown itself ticks in BattleScene (onTurnTick).
    this.events.once("shutdown", () => unsubscribe.forEach((off) => off()));
    return toBattleView(match.latest!);
  }

  override get playerLabel(): string {
    return "You";
  }

  override get opponentLabel(): string {
    return "Opponent";
  }

  // The opponent is a real player here, not the CPU.
  override sideTag(key: "player" | "cpu"): string {
    return key === "cpu" ? "OPP" : "YOU";
  }

  // Online, fighters are shown by player name (set by the server as the
  // fighter's label); the class still shows as the portrait icon.
  override displayName(fighter: Fighter): string {
    return fighter.label ?? super.displayName(fighter);
  }

  override resultSubtitle(): string {
    const b = this.battle;
    if (b.winner === b.player && b.log[0]?.includes("left the match")) return "Your opponent left the match.";
    const opponent = `${this.displayName(b.cpu)} (${b.cpu.classDef.name.replace(/\s*\(.*\)$/, "")})`;
    if (b.draw) return "Both fighters went down at the same time.";
    if (b.winner === b.player) return `You defeated ${opponent} in round ${b.round}.`;
    return `${opponent} wins in round ${b.round}.`;
  }

  override canAct(): boolean {
    return super.canAct() && !this.battle.myReady && !this.pendingPick && !this.match.closed && !this.match.reconnecting;
  }

  // Follow the server's clock: refresh the countdowns, and end the turn for
  // the player when time runs out.
  override onTurnTick(): void {
    if (!this.statusText?.active) return;
    if (isBattleOver(this.battle)) return this.onResultTick();
    this.turnDeadline = this.match.turnDeadline;
    if (this.autoEndTurnIfTimeUp()) return;
    this.setStatus(this.statusMessage());
  }

  // --- Gold reward ------------------------------------------------------------

  // Random matches: what this battle paid, under the HP tiles. The server pays
  // a moment after the battle ends, so it may show "Calculating…" first.
  override drawResultExtra(cx: number, y: number, width: number): { objects: Phaser.GameObjects.GameObject[]; height: number } | null {
    if (!this.match.latest?.rewards) return null;
    const h = 112;
    const box = this.add.container(cx - width / 2, y);
    const g = this.add.graphics();
    g.fillStyle(0x1a1408, 0.7);
    g.fillRoundedRect(0, 0, width, h, 12);
    g.lineStyle(1, GOLD, 0.35);
    g.strokeRoundedRect(0.5, 0.5, width - 1, h - 1, 12);
    const label = this.add
      .text(20, 14, "GOLD EARNED", { fontFamily: FONT_DISPLAY, fontSize: "15px", fontStyle: "700", color: RESULT_TEXT.label, letterSpacing: 2 })
      .setOrigin(0, 0);
    const amount = this.add
      .text(20, 34, "…", { fontFamily: FONT_NUM, fontSize: "34px", fontStyle: "700", color: GOLD_CSS })
      .setOrigin(0, 0);
    amount.setShadow(0, 0, "#e2c588", 6, false, true);
    const detail = this.add
      .text(20, h - 14, "Calculating your reward…", {
        fontFamily: FONT_UI,
        fontSize: "15px",
        fontStyle: "600",
        color: RESULT_TEXT.soft,
        wordWrap: { width: width - 40 },
      })
      .setOrigin(0, 1);
    const balanceLabel = this.add
      .text(width - 20, 14, "BALANCE", { fontFamily: FONT_DISPLAY, fontSize: "15px", fontStyle: "700", color: RESULT_TEXT.label, letterSpacing: 2 })
      .setOrigin(1, 0);
    const balance = this.add
      .text(width - 20, 36, "", { fontFamily: FONT_NUM, fontSize: "24px", fontStyle: "700", color: RESULT_TEXT.ivory })
      .setOrigin(1, 0);
    const today = this.add
      .text(width - 20, 62, "", { fontFamily: FONT_NUM, fontSize: "14px", fontStyle: "600", color: RESULT_TEXT.soft })
      .setOrigin(1, 0);
    box.add([g, label, amount, detail, balanceLabel, balance, today]);
    this.rewardBox = { amount, detail, balance, today };
    this.rewardShown = false;
    this.showReward();
    return { objects: [box], height: h };
  }

  // Fill the Gold block, rolling the numbers up from the old balance.
  private showReward(): void {
    const reward = this.match.latest?.reward;
    const box = this.rewardBox;
    if (!reward || !box || this.rewardShown || !box.amount.active) return;
    this.rewardShown = true;
    box.detail.setText(rewardDetail(reward));
    if (reward.blocked.length) box.detail.setColor("#ec8a7c");
    else if (reward.capCut > 0) box.detail.setColor("#e9c27a");
    box.today.setText(`Today ${reward.dailyGold.toLocaleString("en-US")} / ${formatGold(REWARDS.dailyCap)}`);
    const before = reward.gold - reward.granted;
    const paint = (v: number): void => {
      box.amount.setText(`+${formatGold(v * reward.granted)}`);
      box.balance.setText(formatGold(before + v * reward.granted));
    };
    paint(0);
    if (reward.granted === 0) {
      box.amount.setColor("#9a958a");
      return;
    }
    this.tweens.addCounter({
      from: 0,
      to: 1,
      delay: 650, // after the panel has faded in
      duration: 1200,
      ease: "Cubic.easeOut",
      onUpdate: (tween) => paint(tween.getValue() ?? 1),
      onComplete: () => paint(1),
    });
  }

  // --- rematch --------------------------------------------------------------

  // Rematch / Leave while the server's rematch window is open; otherwise
  // (say, the opponent forfeited mid-battle) the usual buttons.
  override resultActions(): ResultAction[] {
    this.rematchOffered = this.match.rematchDeadline !== null && !this.match.rematchEnded;
    if (!this.rematchOffered) return super.resultActions();
    return [
      { label: "Rematch", color: COLORS.ultimate, hoverColor: COLORS.ultimateHover, onClick: () => this.requestRematch() },
      { label: "Leave", color: COLORS.restart, hoverColor: COLORS.restartHover, onClick: () => void this.onLeave() },
    ];
  }

  private requestRematch(): void {
    if (this.rematchSent || this.exitAt !== null) return;
    this.rematchSent = true;
    this.match.rematch();
    this.onResultTick();
  }

  // The line under the result screen's buttons (and the status line).
  private rematchNote(): string {
    const view = this.match.latest;
    if (this.exitAt !== null) {
      if (this.match.rematchEnded === "opponentLeft") {
        return `Your opponent left. Returning to the lobby in ${this.secondsLeft(this.exitAt)}s…`;
      }
      return this.match.rematchEnded === "timeout" ? "Your opponent didn't accept the rematch. Returning to the lobby…" : "";
    }
    if (!this.rematchOffered) return "";
    if (view?.myRematch || this.rematchSent) return "Rematch requested. Waiting for your opponent…";
    if (view?.opponentRematch) return "Your opponent wants a rematch!";
    return "";
  }

  // Runs 4x a second once the battle is over: the Leave countdown, the
  // rematch note, and the trip back to the lobby.
  private onResultTick(): void {
    if (this.exitAt !== null && Date.now() >= this.exitAt) {
      this.exitAt = null;
      void this.onLeave();
      return;
    }
    if (this.rematchOffered && this.resultLayer) {
      const [rematchButton, leaveButton] = this.resultButtons;
      const waiting = this.rematchSent || this.match.latest?.myRematch === true;
      const open = this.exitAt === null && this.match.rematchDeadline !== null;
      rematchButton?.setEnabled(open && !waiting);
      setButtonLabel(rematchButton, waiting && open ? "Waiting…" : "Rematch");
      const left = open ? this.secondsLeft(this.match.rematchDeadline) : null;
      setButtonLabel(leaveButton, left === null ? "Leave" : `Leave (${left}s)`);
    }
    this.resultNote?.setText(this.rematchNote());
    this.setStatus(this.statusMessage());
  }

  override commitAction(action: Action): void {
    this.planned = { staged: this.staged, stagedUltimate: this.stagedUltimate, stagedTargets: this.stagedTargets, orders: this.orders };
    this.clearPlanning();
    this.pendingTurn = { cards: action.cards, ultimate: action.ultimate, round: this.battle.round };
    this.errorMessage = null;
    const n = action.cards.length + (action.ultimate ? 1 : 0) + (action.orders?.length ?? 0);
    this.pendingPick = n === 0 ? "a pass" : n === 1 ? "1 play" : `${n} plays`;
    this.match.pick(action);
    this.render();
  }

  override async onLeave(): Promise<void> {
    if (this.leaving) return;
    if (!isBattleOver(this.battle) && !this.match.closed) {
      const leave = await confirmDialog({
        title: "Leave this match?",
        message: "It counts as a loss.",
        confirmLabel: "Leave",
        danger: true,
      });
      if (!leave || !this.sys.isActive()) return;
    }
    if (this.onExit) {
      this.exitMatch(this.onExit);
      return;
    }
    this.leaving = true;
    this.match.leave();
    this.scene.start("ClassSelectScene");
  }

  // Leaving mid-match counts as a loss, same as Leave.
  override exitMatch(go: () => void): void {
    if (this.leaving) return;
    this.leaving = true;
    this.match.leave();
    go();
  }

  override statusMessage(): string {
    const b = this.battle;
    const after = this.rematchNote() || this.leaveHint;
    if (b.draw) return `Draw! ${after}`;
    if (b.winner) return `${b.winner === b.player ? "You win!" : "Your opponent wins."} ${after}`;
    if (this.match.reconnecting) return `Round ${b.round} — Connection lost. Reconnecting…`;
    const opponentLeft = this.secondsLeft(this.match.opponentDeadline);
    if (opponentLeft !== null) return `Round ${b.round} — Your opponent disconnected. They have ${opponentLeft}s to come back.`;
    if (this.errorMessage) return `Round ${b.round} — ${this.errorMessage}`;
    const turnLeft = this.secondsLeft(this.match.turnDeadline);
    const clock = turnLeft === null ? "" : ` (${turnLeft}s)`;
    if (this.pendingPick || b.myReady) {
      const what = this.pendingPick ?? "your move";
      return `Round ${b.round} — you locked in ${what}. ${b.opponentReady ? "Resolving…" : `Waiting for your opponent…${clock}`}`;
    }
    if (this.handHint) return `Round ${b.round} — ${this.handHint}${clock}`;
    return `Round ${b.round} — ${turnLeft === null ? "" : `${turnLeft}s · `}${this.plannedAp()}/${b.player.maxAp} AP left. Play cards, then End turn. ${
      b.opponentReady ? "Your opponent has already chosen." : "Your opponent is choosing at the same time."
    }`;
  }

  private applyView(view: RandomMatchView): void {
    if (!this.scene.isActive()) return;
    const previous = this.battle;
    const before = this.currentHp();
    this.battle = toBattleView(view);
    if (!this.battle.myReady) this.pendingPick = null;
    if (this.battle.round > previous.round) {
      this.planned = null;
      this.autoEnded = false;
    }

    // Replay the round if this update is the one that resolved it.
    const resolvedRound = this.battle.player.lastTurn?.round;
    const justResolved =
      resolvedRound === previous.round &&
      (this.battle.round > previous.round || (isBattleOver(this.battle) && !isBattleOver(previous)));
    if (justResolved) this.presentRound(before);
    else this.render();
    this.showReward(); // the Gold can arrive after the result screen is up
  }
}

// The line under the Gold earned: where it came from, or why there's none.
function rewardDetail(r: MatchReward): string {
  if (r.blocked.length) {
    const why = r.blocked.includes("early_surrender") ? "Early surrender detected." : `Only ${r.turns} turns played.`;
    return `No reward: at least ${REWARDS.minTurns} turns are required. ${why}`;
  }
  const parts = [`${r.base === REWARDS.win ? "Win" : "Match"} +${r.base}`];
  if (r.firstWinBonus) parts.push(`First win of the day +${r.firstWinBonus}`);
  if (r.capCut) parts.push(r.granted === 0 ? "Daily Gold cap reached" : `Daily cap −${r.capCut}`);
  return parts.join("  ·  ");
}

// createButton() puts the label text second in its container.
function setButtonLabel(button: Button | undefined, text: string): void {
  const label = button?.container.getAt(1) as Phaser.GameObjects.Text | undefined;
  if (label && label.text !== text) label.setText(text);
}
