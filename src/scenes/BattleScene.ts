// Battle screen: renders src/model/engine.ts's battle state and turns clicks
// into playRound() calls. Every render() call wipes and rebuilds the dynamic
// containers (fighter panels, hand, log) rather than diffing them -- this is
// a low-frequency turn-based UI, so that's simpler.
//
// After each round resolves, the round recap (roundRecap.ts) replays both
// fighters' actions with animation and narration before the new state is
// shown; HP bars count down as the hits land.

import Phaser from "phaser";
import {
  computeCurrentStats,
  canUseUltimate,
  createBattle,
  checkPlan,
  planAction,
  canPlayCard,
  unplayableReason,
  cardNeedsTarget,
  orderNeedsTarget,
  orderCost,
  targetProblem,
  describeAbility,
  passAction,
  playRound,
  describeEffect,
  isBattleOver,
  fighterName,
  FIELD_SIZE,
  STATUS_LABEL,
  type Action,
  type Battle,
  type Fighter,
  type TurnRecord,
  type Monster,
  type MonsterOrder,
  type Target,
} from "../model/engine.ts";
import { EFFECT_KIND, MODIFIER_MODE, STATUS, type StatusId } from "../model/effects.ts";
import { RESIST_STAT } from "../model/damageTypes.ts";
import type { StatKey } from "../model/stats.ts";
import { cardCost, type Card, type DefendCard } from "../model/cardTypes.ts";
import type { ClassDef } from "../model/classes.ts";
import { allCards, allClasses } from "../model/catalog.ts";
import { preloadIcons, classIconKey, ULTIMATE_ICON_KEY, CARD_ICON_KEY, SETTINGS_ICON_KEY } from "../phaserIcons.ts";
import { loadCardArt, loadedArtKey } from "../cardArt.ts";
import { getVolume, playSfx, setVolume } from "../fx/sound.ts";
import {
  COLORS,
  TEXT,
  UI_COLORS,
  FONT_FAMILY,
  FONT_DISPLAY,
  BACKGROUNDS,
  GAME_WIDTH,
  GAME_HEIGHT,
  addBackground,
  preloadBackground,
  createButton,
  createCircleButton,
  textShadow,
  useRenderScale,
  type Button,
} from "./theme.ts";
import { AP_GEM_COLOR, cardFaceData, drawCardFace, type CardFaceData } from "./cardFace.ts";
import { playRoundRecap, setRecapSpeed, type RecapPanel, type RecapSide, type RoundRecapRun } from "./roundRecap.ts";

// 1280x720 board layout: mirrored full-width bands at the top and above the
// hand, monster fields flanking a central play zone, battle log in the right
// column, hand along the bottom. Each band is 94px: header + HP, one stat
// rail, then the synergy/status chips and ultimate meter. The play zone holds
// the two arena slots and is where the round recap plays.
const STRIP_X = 16;
const STRIP_W = 980;
const STRIP_H = 94;
const STRIP_PAD = 14;
// Stat rail: one recessed channel under the header, 30px tall. The chips row
// below it keeps the synergy/status chips + ultimate meter.
const RAIL_Y = 28;
const RAIL_H = 30;
const CHIP_ROW_Y = 64;
const CPU_STRIP_Y = 52;
const PLAYER_STRIP_Y = 424;
const STATUS_Y = 160;
const PLAYER_STRIP_X = STRIP_X;
const PLAYER_STRIP_W = STRIP_W;

const HAND_Y = 539;
const CARD_W = 123;
const CARD_H = 165;

// The hand (docs "Card Position"): cards fanned out from the bottom center;
// hover expands a card; a click moves it to the middle of the screen in full
// view (at most a third of the screen tall, with space above and below);
// clicking it again plays it onto your side of the arena, clicking anywhere
// else puts it back.
const FAN_OVERLAP = 13;

// Your class badge, under the player strip and left of the hand: icon + name,
// ringed by a yellow gauge for the ultimate meter. Once it's full the badge
// glows and pulses, and clicking it toggles the ultimate for this turn.
const CLASS_BADGE = { x: 16, y: 528, w: 208, h: 176 };
const BADGE_RADIUS = 10;
const ULT_RING_W = 5;
const ULT_RING_LIVE = 0xffd23f;

// The End turn bar sits under the log, in the right column. One pip per AP:
// lit = AP left, pulsing = about to be spent, dark = spent on this turn.
const END_TURN = { x: 1008, y: 640, w: 256, h: 64 };
const AP_RING_LIVE = 0xffd23f;
const AP_RING_SPENT = 0x3a3220;
const HOVER_LIFT = 14;
const HOVER_SCALE = 1.12;
const PREVIEW_SCALE = 1.45; // 165px card -> 239px, under a third of 720
const PREVIEW_RING = 0xc49b3a;
const STAGE_SCALE = 0.9; // picked cards, on the player's slot

// Middle play zone: slots centered between the two monster fields.
const SLOT_W = 132;
const SLOT_H = 176;
const SLOT_Y = 200;
const SLOT_GAP = 18;
const SLOT_TOTAL_W = SLOT_W * 2 + SLOT_GAP;

// Monster fields flank the central play zone: the CPU's left, the player's
// right. Sized to the preview's 3-socket plates.
const FIELD_W = 234;
const FIELD_Y = 152;
const FIELD_H = 264;
const CPU_FIELD_X = 16;
const PLAYER_FIELD_X = 762;
const PLAY_ZONE_X = CPU_FIELD_X + FIELD_W;
const PLAY_ZONE_W = PLAYER_FIELD_X - PLAY_ZONE_X;
const PLAY_ZONE_CX = PLAY_ZONE_X + PLAY_ZONE_W / 2;
const MONSTER_W = 72;
const MONSTER_H = 136;
const MONSTER_GAP = (FIELD_W - MONSTER_W * FIELD_SIZE) / (FIELD_SIZE - 1);
const MONSTER_GUARD = 0x6ec6ff;

const STATUS_COLOR: Record<StatusId, number> = {
  [STATUS.BURNING]: 0xc4511d,
  [STATUS.POISON]: 0x4f8a2e,
  [STATUS.WET]: 0x2f6fb0,
  [STATUS.ACID]: 0x8a9a1e,
  [STATUS.SLOWED]: 0x56658a,
  [STATUS.BLIND]: 0x4a4f60,
};

// A turn that's been sent: the slots keep showing it (and a face-down card
// for the opponent) until the round's recap has played.
export interface PendingTurn {
  cards: Card[];
  ultimate: boolean;
  round: number; // battle.round at commit
}

const LOG_BOX = { x: 1008, y: 52, w: 256, h: 576 };
const LOG_HEAD_H = 32;
const LOG_FOOT_H = 22;
const LOG_X = LOG_BOX.x;
const LOG_Y = LOG_BOX.y + LOG_HEAD_H;
const LOG_W = LOG_BOX.w;
const LOG_H = LOG_BOX.h - LOG_HEAD_H - LOG_FOOT_H;
// Wheel scroll step, px. Entries have variable (word-wrapped) heights, so
// scrolling is a pixel offset, not a line index -- see renderLog.
const LOG_SCROLL_STEP = 60;
// The whole panel slides right by its width (plus a margin) to hide, leaving
// just the toggle button in its top-right corner.
const LOG_HIDE_DX = LOG_BOX.w + 16;
const LOG_TOGGLE = { w: 28, h: 22 };
const LOG_ENTRY_GAP = 6;

// The band the round recap covers: the central play zone.
const RECAP_STAGE = { y: FIELD_Y, h: FIELD_H };

const STAT_CHIPS: Array<{ key: StatKey; label: string; color: number }> = [
  { key: "def", label: "DEF", color: 0xc9c9c9 },
  { key: "mr", label: "MR", color: 0xb388ff },
  { key: "er", label: "ER", color: 0xff9d4d },
  { key: "ur", label: "UR", color: 0xffe066 },
  { key: "atk", label: "ATK", color: 0xff6b5f },
];

// Full names and explanations for the stat chips (hover / click).
const STAT_INFO: Record<StatKey, { label: string; name: string; description: string }> = {
  hp: { label: "HP", name: "Health", description: "How much damage you can take. Drop to 0 and you lose the battle." },
  def: {
    label: "DEF",
    name: "Defense",
    description: "Reduces incoming physical damage. Each hit loses DEF points of damage (after any guard), down to 0.",
  },
  mr: {
    label: "MR",
    name: "Magic Resistance",
    description: "Reduces incoming magic damage. Each hit loses MR points of damage (after any guard), down to 0.",
  },
  er: {
    label: "ER",
    name: "Elemental Resistance",
    description: "Reduces incoming element damage. Each hit loses ER points of damage (after any guard), down to 0.",
  },
  ur: {
    label: "UR",
    name: "Ultimate Recharge",
    description: "How much your ultimate meter fills each round. Higher UR means you can use your ultimate sooner.",
  },
  atk: {
    label: "ATK",
    name: "Attack",
    description: "Bonus damage added to every attack card you play (cards that deal 0 damage don't get it).",
  },
  crit: { label: "CRIT", name: "Critical Chance", description: "The chance for an attack to land a critical hit." },
};

const CHIP_COLOR = {
  guard: 0x2f6f8f,
  up: 0x3a8f5a,
  down: 0x8a3a52,
  synergy: 0x484b51,
  synergyActive: 0xa8842f,
};

const GUARD_COLOR = 0x6ec6ff;

// Where the background's wall torches are painted -- keep in sync with
// TORCHES in scripts/backgrounds.ts.
const TORCHES = [
  { x: 278, y: 322 },
  { x: 1002, y: 322 },
];
const TORCH_GLOW_KEY = "torch-glow";

// Top-left settings gear, and the menu that drops down from it: a tab behind
// the gear that widens into a panel with volume, account and replay speed.
// The tab and the panel's left edge line up with the gear's left edge.
const SETTINGS = { x: 40, y: 25, r: 15 };
const SETTINGS_MENU = { x: SETTINGS.x - SETTINGS.r, y: 46, w: 260, tab: SETTINGS.r, pad: 16 };
const SLIDER_ACCENT = 0xffd23f;

// Round-recap playback speeds the Speed button cycles through (and the
// settings menu's speed slider steps through); the choice is remembered per
// browser.
const RECAP_SPEEDS = [1, 1.5, 2, 3];
const RECAP_SPEED_KEY = "godfield.recapSpeed";

function readRecapSpeed(): number {
  try {
    const value = Number(window.localStorage.getItem(RECAP_SPEED_KEY));
    return RECAP_SPEEDS.includes(value) ? value : 1;
  } catch {
    return 1;
  }
}

function saveRecapSpeed(value: number): void {
  try {
    window.localStorage.setItem(RECAP_SPEED_KEY, String(value));
  } catch {
    // storage unavailable (private window etc.) -- just don't remember it
  }
}

// Whether the battle log is slid away; also remembered per browser.
const LOG_HIDDEN_KEY = "godfield.logHidden";

function readLogHidden(): boolean {
  try {
    return window.localStorage.getItem(LOG_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

function saveLogHidden(hidden: boolean): void {
  try {
    window.localStorage.setItem(LOG_HIDDEN_KEY, hidden ? "1" : "0");
  } catch {
    // storage unavailable -- just don't remember it
  }
}

const RESULT: Record<"win" | "lose" | "draw", { title: string; color: number; sfx: string }> = {
  win: { title: "VICTORY", color: 0xffd23f, sfx: "victory" },
  lose: { title: "DEFEAT", color: 0xff5a4f, sfx: "defeat" },
  draw: { title: "DRAW", color: 0xc9cfe0, sfx: "draw" },
};

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const shortName = (name: string): string => name.replace(/\s*\(.*\)\s*$/, "");

// Points along a w x h rounded rectangle's edge, clockwise from top center,
// covering `fraction` (0..1) of the way round -- for gauges drawn on a box.
function roundedRectPath(w: number, h: number, r: number, fraction: number): Phaser.Math.Vector2[] {
  // Every point after the start, in order; the last one is the start again.
  const all: Phaser.Math.Vector2[] = [];
  const corner = (cx: number, cy: number, from: number): void => {
    for (let i = 0; i <= 8; i++) {
      const a = from + (i / 8) * (Math.PI / 2);
      all.push(new Phaser.Math.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
  };
  corner(w - r, r, -Math.PI / 2);
  corner(w - r, h - r, 0);
  corner(r, h - r, Math.PI / 2);
  corner(r, r, Math.PI);
  all.push(new Phaser.Math.Vector2(w / 2, 0));

  const start = new Phaser.Math.Vector2(w / 2, 0);
  let total = 0;
  let prev = start;
  for (const p of all) {
    total += p.distance(prev);
    prev = p;
  }
  let left = total * Math.max(0, Math.min(1, fraction));
  const out = [start];
  prev = start;
  for (const p of all) {
    if (left <= 0) break;
    const seg = p.distance(prev);
    out.push(seg <= left ? p : prev.clone().lerp(p, left / seg));
    left -= seg;
    prev = p;
  }
  return out;
}

function hpColor(pct: number): number {
  if (pct > 0.5) return 0x5aa862;
  if (pct > 0.25) return 0xd9a441;
  return 0xc85448;
}

// "+5" for a flat guard, "30%" for a percent one.
function guardAmount(card: Pick<DefendCard, "mode" | "amount">): string {
  return card.mode === MODIFIER_MODE.PERCENT ? `${Math.round(card.amount * 100)}%` : `+${fmt(card.amount)}`;
}

function ultimateName(classDef: ClassDef): string {
  const name = classDef.ultimate.name;
  return name && name !== "TBD" ? name : "Ultimate";
}

// Board geometry for subclasses that point at parts of the board (the
// tutorial's coach highlights).
export const LAYOUT = {
  cpuStrip: { x: STRIP_X, y: CPU_STRIP_Y, w: STRIP_W, h: STRIP_H },
  playerStrip: { x: PLAYER_STRIP_X, y: PLAYER_STRIP_Y, w: PLAYER_STRIP_W, h: STRIP_H },
  playerSlot: { x: PLAY_ZONE_CX + SLOT_TOTAL_W / 2 - SLOT_W, y: SLOT_Y, w: SLOT_W, h: SLOT_H },
  classBadge: CLASS_BADGE,
  endTurn: { x: END_TURN.x, y: END_TURN.y, w: END_TURN.w, h: END_TURN.h },
  handY: HAND_Y,
  card: { w: CARD_W, h: CARD_H },
  monster: { w: MONSTER_W, h: MONSTER_H },
  logBox: LOG_BOX,
  logHideDx: LOG_HIDE_DX,
} as const;

export interface BattleSceneData {
  playerClass: ClassDef;
  playerDeck?: Card[] | null; // a custom deck (decks.ts); null/absent = starter deck
  onExit?: (() => void) | null;
}

// One button on the end-of-game screen.
export interface ResultAction {
  label: string;
  color: number;
  hoverColor: number;
  onClick: () => void;
}

export interface HpPair {
  player: number;
  cpu: number;
}

// Seconds per turn: the same as online play (server/BattleRoom.ts TURN_SECONDS).
export const TURN_SECONDS = 30;

// vs-CPU battle. RandomBattleScene (src/scenes/RandomBattleScene.ts) reuses
// all of the drawing below and only overrides the hooks in the "battle
// source" section: where the battle comes from, what a click does, and the
// status line.
export class BattleScene extends Phaser.Scene {
  battle!: Battle;
  onExit: (() => void) | null = null;
  recapPlaying = false;
  recapRun: RoundRecapRun | null = null; // active recap (speed/skip control) -- see roundRecap.ts
  shownHp: HpPair | null = null; // { player, cpu } while a recap is counting HP down
  panelViews: Record<string, RecapPanel> = {};
  recapSpeed = 1;
  resultLayer: Phaser.GameObjects.Container | null = null; // the end-of-game screen, once shown
  statInfo: { key: StatKey; chip: Phaser.GameObjects.Container; layer: Phaser.GameObjects.Container } | null = null; // open stat explainer
  settingsMenu: Phaser.GameObjects.Container | null = null; // the settings dropdown, while open
  speedButton!: Button; // replay speed; its label follows the settings menu's speed slider
  resultDismissed = false; // closed with "View board"
  resultButtons: Button[] = []; // the end-of-game screen's buttons, in resultActions() order
  resultNote: Phaser.GameObjects.Text | null = null; // a line under them, for subclasses (rematch)
  cpuPanel!: Phaser.GameObjects.Container;
  playerPanel!: Phaser.GameObjects.Container;
  statusText!: Phaser.GameObjects.Text;
  statusRoundPill!: Phaser.GameObjects.Container;
  statusRoundBg!: Phaser.GameObjects.Graphics;
  statusRoundText!: Phaser.GameObjects.Text;
  handContainer!: Phaser.GameObjects.Container;
  logFollow = true;
  endTurnBar!: Phaser.GameObjects.Container;
  endTurnTitle!: Phaser.GameObjects.Text;
  endTurnSub!: Phaser.GameObjects.Text;
  endTurnPips!: Phaser.GameObjects.Container;
  endTurnHit!: Phaser.GameObjects.Zone;
  endTurnHover!: Phaser.GameObjects.Graphics;
  endTurnEnabled = true;
  slotsContainer!: Phaser.GameObjects.Container;
  fieldContainer!: Phaser.GameObjects.Container;
  classBadge!: Phaser.GameObjects.Container; // also the ultimate toggle
  handHint: string | null = null; // why the card just clicked can't be played
  // This turn's plan, built up card by card: confirmed cards move from the
  // hand onto the player's arena slot (only this client sees them) until
  // "End turn" sends the whole turn.
  staged: Card[] = [];
  stagedUltimate = false;
  stagedTargets: Record<number, Target> = {}; // attack card id -> who it's aimed at
  orders: MonsterOrder[] = []; // this turn's orders for your monsters
  // Picking a target: for an attack card being played, or a monster order.
  targeting: { kind: "card"; card: Card } | { kind: "order"; uid: number; use: MonsterOrder["use"] } | null = null;
  monsterMenuUid: number | null = null; // your monster whose command menu is open
  previewedCardId: number | null = null; // hand card shown big in the middle, waiting for a confirm click
  previewLayer!: Phaser.GameObjects.Container; // the center preview, above everything else
  pendingTurn: PendingTurn | null = null; // committed turn being resolved/replayed
  logScrollIndex = 0; // pixel offset into the measured log content
  logMaxScrollIndex = 0; // max pixel offset (content height - box height)
  logTotalHeight = 0; // measured content height, set by renderLog
  logContainer!: Phaser.GameObjects.Container;
  logPanel!: Phaser.GameObjects.Container; // everything in the log column, slid as one
  logHidden = false;
  logScrollTrack!: Phaser.GameObjects.Rectangle;
  logScrollThumb!: Phaser.GameObjects.Rectangle;
  // Turn timer. vs-CPU runs its own clock; online scenes copy the server's.
  turnDeadline: number | null = null; // local-clock ms when this turn's time runs out
  turnTimerRound = 0; // the round the vs-CPU clock was started for
  autoEnded = false; // already ended this round's turn because time ran out

  constructor(key = "BattleScene") {
    super(key);
  }

  preload(): void {
    preloadIcons(this, allClasses());
    preloadBackground(this, BACKGROUNDS.battle);
  }

  // A flickering warm glow over each wall torch painted in the background.
  addTorchLight(): void {
    if (!this.textures.exists(BACKGROUNDS.battle.key)) return;
    if (!this.textures.exists(TORCH_GLOW_KEY)) {
      // A soft radial glow, drawn once into a canvas texture.
      const texture = this.textures.createCanvas(TORCH_GLOW_KEY, 128, 128);
      if (!texture) return;
      const ctx = texture.getContext();
      const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, "rgba(255, 214, 150, 1)");
      gradient.addColorStop(0.3, "rgba(255, 157, 77, 0.55)");
      gradient.addColorStop(1, "rgba(255, 122, 42, 0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
      texture.refresh();
    }
    for (const { x, y } of TORCHES) {
      const glow = this.add.image(x, y - 16, TORCH_GLOW_KEY).setDisplaySize(190, 190).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.5);
      // Alpha and size flicker on unrelated periods, so it never looks regular.
      this.tweens.add({ targets: glow, alpha: 0.28, duration: 150 + Math.random() * 90, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      this.tweens.add({
        targets: glow,
        scale: glow.scale * 0.9,
        duration: 230 + Math.random() * 120,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
        delay: Math.random() * 100,
      });
    }
  }

  // --- battle source (overridden by RandomBattleScene) ---------------------

  setupBattle(data: BattleSceneData): Battle {
    const playerClass = data.playerClass;
    const cpuClass = allClasses().find((c) => c.id !== playerClass.id) ?? playerClass;
    return createBattle(playerClass, cpuClass, { playerDeck: data.playerDeck ?? null });
  }

  // The big name on a fighter's band: the class for vs-CPU,
  // the player's name online (RandomBattleScene).
  displayName(fighter: Fighter): string {
    return shortName(fighter.classDef.name);
  }

  get playerLabel(): string {
    return "Player";
  }

  get opponentLabel(): string {
    return "CPU";
  }

  get leaveLabel(): string {
    return "Leave Match";
  }

  // Where to go once the battle is over (the status line's last words).
  get leaveHint(): string {
    return `Choose "${this.leaveLabel}" in the settings menu to go back.`;
  }

  // The line under VICTORY / DEFEAT / DRAW.
  resultSubtitle(): string {
    const b = this.battle;
    const opponent = shortName(b.cpu.classDef.name);
    if (b.draw) return "Both fighters went down at the same time.";
    if (b.winner === b.player) return `You defeated ${this.opponentLabel} (${opponent}) in round ${b.round}.`;
    return `${this.opponentLabel} (${opponent}) wins in round ${b.round}.`;
  }

  // The end-of-game screen's buttons. Online scenes swap in Rematch / Leave.
  resultActions(): ResultAction[] {
    return [
      { label: "Back to menu", color: COLORS.ultimate, hoverColor: COLORS.ultimateHover, onClick: () => void this.onLeave() },
      { label: "View board", color: COLORS.restart, hoverColor: COLORS.restartHover, onClick: () => this.hideResult() },
    ];
  }

  // Whether the hand/ultimate should take clicks right now.
  canAct(): boolean {
    return !isBattleOver(this.battle) && !this.recapPlaying;
  }

  // Send this turn. vs-CPU resolves it right away; RandomBattleScene
  // overrides this to send it to the server.
  commitAction(action: Action): void {
    this.clearPlanning();
    this.pendingTurn = { cards: action.cards, ultimate: action.ultimate, round: this.battle.round };
    const before = this.currentHp();
    playRound(this.battle, action);
    this.presentRound(before);
  }

  // Forget the turn being planned (the cards are all still in hand).
  clearPlanning(): void {
    this.handHint = null;
    this.previewedCardId = null;
    this.staged = [];
    this.stagedUltimate = false;
    this.stagedTargets = {};
    this.orders = [];
    this.targeting = null;
    this.monsterMenuUid = null;
  }

  // Cancel the center preview (the card goes back to the hand), a target
  // pick, or a monster's command menu.
  dismissPreview(): void {
    if (this.previewedCardId === null && !this.targeting && this.monsterMenuUid === null) return;
    this.previewedCardId = null;
    this.targeting = null;
    this.monsterMenuUid = null;
    this.render();
  }

  onLeave(): void {
    // React shell supplies onExit so Back returns to the menu; fall back to
    // the in-Phaser menu when launched standalone (legacy/dev path).
    if (this.onExit) {
      this.onExit();
      return;
    }
    this.scene.start("ClassSelectScene");
  }

  // AP left after the cards picked so far.
  plannedAp(): number {
    return checkPlan(this.battle.player, this.staged, false, this.orders).ap;
  }

  statusMessage(): string {
    if (this.battle.winner) return `${fighterName(this.battle.winner)} wins! ${this.leaveHint}`;
    if (this.battle.draw) return `Draw! ${this.leaveHint}`;
    const turnLeft = this.canAct() ? this.secondsLeft(this.turnDeadline) : null;
    if (this.handHint) return `Round ${this.battle.round} — ${this.handHint}${turnLeft === null ? "" : ` (${turnLeft}s)`}`;
    return `Round ${this.battle.round} — ${turnLeft === null ? "" : `${turnLeft}s · `}${this.plannedAp()}/${this.battle.player.maxAp} AP left. Play cards or click your monsters to give orders, then End turn.`;
  }

  // Split "Round N — hint" into the preview's gold round pill + hint line.
  // Messages without a round (win/draw/connection) stay as one centered line.
  setStatus(message: string): void {
    const match = message.match(/^\s*Round\s+(\d+)\s*[-–—]\s*([\s\S]*)$/i);
    if (!match) {
      this.statusRoundPill.setVisible(false);
      this.statusText
        .setText(message)
        .setOrigin(0.5, 0)
        .setPosition(PLAY_ZONE_CX, STATUS_Y + 3);
      this.statusText.setWordWrapWidth(PLAY_ZONE_W - 20, true);
      return;
    }

    const label = `ROUND ${match[1]}`;
    const hint = (match[2] ?? "").trim();
    this.statusRoundText.setText(label);
    const pillW = this.statusRoundText.width + 20;

    this.statusRoundBg.clear();
    this.statusRoundBg.fillStyle(0x1a160b, 0.92);
    this.statusRoundBg.fillRoundedRect(0, -10, pillW, 20, 10);
    this.statusRoundBg.lineStyle(1, UI_COLORS.bronze, 0.4);
    this.statusRoundBg.strokeRoundedRect(0.5, -9.5, pillW - 1, 19, 10);
    this.statusRoundPill.setVisible(true);

    const maxHint = PLAY_ZONE_W - pillW - 18;
    this.statusText.setWordWrapWidth(maxHint, true);
    this.statusText.setText(hint).setOrigin(0, 0);
    const hintW = Math.min(this.statusText.width, maxHint);
    const total = pillW + 8 + hintW;
    const startX = Phaser.Math.Clamp(PLAY_ZONE_CX - total / 2, PLAY_ZONE_X + 4, PLAYER_FIELD_X - total - 4);
    this.statusRoundPill.setPosition(startX, STATUS_Y + 10);
    this.statusText.setPosition(startX + pillW + 8, STATUS_Y + 3);
  }

  // --- turn timer ----------------------------------------------------------

  // Whole seconds left until a local-clock deadline, or null.
  secondsLeft(deadline: number | null): number | null {
    return deadline === null ? null : Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  }

  // Runs 4x a second. vs-CPU: start the clock once the player can act (after
  // the recap), end the turn when it runs out, refresh the countdown.
  // Online scenes override this to follow the server's clock instead.
  onTurnTick(): void {
    if (!this.statusText?.active || isBattleOver(this.battle)) return;
    if (this.canAct() && this.turnTimerRound !== this.battle.round) {
      this.turnTimerRound = this.battle.round;
      this.turnDeadline = Date.now() + TURN_SECONDS * 1000;
      this.autoEnded = false;
    }
    if (this.autoEndTurnIfTimeUp()) return;
    this.setStatus(this.statusMessage());
  }

  // Time's up: end the turn with whatever was planned, if it can still be
  // paid for; otherwise pass. Returns whether it did.
  autoEndTurnIfTimeUp(): boolean {
    if (this.turnDeadline === null || Date.now() < this.turnDeadline || this.autoEnded || !this.canAct()) return false;
    this.autoEnded = true;
    this.handHint = null;
    this.previewedCardId = null;
    this.targeting = null;
    this.monsterMenuUid = null;
    this.onEndTurnClick();
    if (this.canAct()) this.commitAction(passAction()); // plan couldn't be paid for
    return true;
  }

  // --- scene ---------------------------------------------------------------

  create(data: BattleSceneData): void {
    useRenderScale(this);
    this.onExit = data.onExit ?? null;
    this.recapPlaying = false;
    this.clearPlanning();
    this.pendingTurn = null;
    this.shownHp = null; // { player, cpu } while a recap is counting HP down
    this.panelViews = {};
    this.recapSpeed = readRecapSpeed();
    this.resultLayer = null; // the end-of-game screen, once shown
    this.resultDismissed = false; // closed with "View board"
    this.resultButtons = [];
    this.resultNote = null;
    this.turnDeadline = null;
    this.turnTimerRound = 0;
    this.autoEnded = false;
    this.battle = this.setupBattle(data);

    // Turn-timer tick. A plain interval, not this.time: the recap speed
    // setting scales Phaser's clock.
    const tick = window.setInterval(() => this.onTurnTick(), 250);
    this.events.once("shutdown", () => {
      window.clearInterval(tick);
      this.tweens.timeScale = 1;
      this.time.timeScale = 1;
    });

    // Bottom-most click catcher: any pointerdown that hits no interactive
    // object (arena, strips, log, background) dismisses a held preview.
    // Cards, buttons, and overlays all sit above it and win their own clicks
    // (input.topOnly), so normal play is a single null-check no-op.
    const dismissZone = this.add.zone(0, 0, GAME_WIDTH, GAME_HEIGHT).setOrigin(0, 0).setInteractive();
    dismissZone.on("pointerdown", () => {
      this.dismissPreview();
    });

    addBackground(this, BACKGROUNDS.battle);
    this.addTorchLight();

    // Top bar: unifies the settings gear, replay speed, title and log column.
    const topbar = this.add.graphics();
    topbar.fillGradientStyle(0x08090b, 0x08090b, 0x08090b, 0x08090b, 0.94, 0.94, 0.55, 0.55);
    topbar.fillRect(0, 0, GAME_WIDTH, 44);
    topbar.lineStyle(1, UI_COLORS.bronze, 0.18);
    topbar.lineBetween(0, 43.5, GAME_WIDTH, 43.5);

    // Dark backing so the battle log reads cleanly over the hall's floor.
    // The log's pieces keep their screen coordinates inside logPanel, which
    // only ever moves sideways to hide / show the whole column.
    this.logHidden = readLogHidden();
    this.logPanel = this.add.container(this.logHidden ? LOG_HIDE_DX : 0, 0);
    const logBacking = this.add.graphics();
    logBacking.fillStyle(0x0a0b0c, 0.88);
    logBacking.fillRoundedRect(LOG_BOX.x, LOG_BOX.y, LOG_BOX.w, LOG_BOX.h, 10);
    logBacking.lineStyle(1, UI_COLORS.edge, 0.95);
    logBacking.strokeRoundedRect(LOG_BOX.x + 0.5, LOG_BOX.y + 0.5, LOG_BOX.w - 1, LOG_BOX.h - 1, 10);
    this.logPanel.add(logBacking);

    textShadow(
      this.add
        .text(GAME_WIDTH / 2, 9, "GODFIELD-LITE", {
          fontFamily: FONT_DISPLAY,
          fontSize: "14px",
          fontStyle: "700",
          color: UI_COLORS.ivory,
        })
        .setOrigin(0.5, 0)
        .setLetterSpacing(2)
    );

    // Top-left, clear of the centered title and the right-side log column:
    // the settings gear (volume, account, replay speed), above the menu it
    // opens so it stays clickable to close it.
    const settingsButton = createCircleButton(this, SETTINGS.x, SETTINGS.y, SETTINGS.r, "", {
      color: COLORS.restart,
      hoverColor: COLORS.restartHover,
      onClick: () => this.toggleSettings(),
    });
    settingsButton.container.setDepth(951);
    // Esc does the same. Not over the end-of-game screen, which sits above
    // the menu; the confirm dialogs catch Esc themselves before Phaser sees it.
    this.input.keyboard?.on("keydown-ESC", () => {
      if (!this.resultLayer) this.toggleSettings();
    });
    // The gear nearly fills the button; hovering also turns it a notch.
    if (this.textures.exists(SETTINGS_ICON_KEY)) {
      const gear = this.add.image(0, 0, SETTINGS_ICON_KEY).setDisplaySize(SETTINGS.r * 2 - 4, SETTINGS.r * 2 - 4);
      settingsButton.container.add(gear);
      const turn = (angle: number): void => {
        this.tweens.killTweensOf(gear);
        this.tweens.add({ targets: gear, angle, duration: 300, ease: "Cubic.easeOut" });
      };
      const bg = settingsButton.container.getAt(0) as Phaser.GameObjects.Graphics;
      bg.on("pointerover", () => turn(45));
      bg.on("pointerout", () => turn(0));
    }

    // Speed of the end-of-round replay; takes effect immediately, even
    // mid-replay.
    this.speedButton = createButton(this, SETTINGS.x + SETTINGS.r + 10, 12, 100, 26, "", {
      color: COLORS.restart,
      hoverColor: COLORS.restartHover,
      onClick: () => {
        const i = RECAP_SPEEDS.indexOf(this.recapSpeed);
        this.setReplaySpeed(RECAP_SPEEDS[(i + 1) % RECAP_SPEEDS.length] as number);
      },
    });
    this.setReplaySpeed(this.recapSpeed);

    this.cpuPanel = this.add.container(0, 0);
    this.playerPanel = this.add.container(0, 0);

    this.statusRoundBg = this.add.graphics();
    this.statusRoundText = this.add
      .text(10, 0, "", {
        fontFamily: FONT_DISPLAY,
        fontSize: "9.5px",
        fontStyle: "700",
        color: UI_COLORS.goldHi,
      })
      .setLetterSpacing(1.4)
      .setOrigin(0, 0.5);
    this.statusRoundPill = this.add
      .container(0, 0, [this.statusRoundBg, this.statusRoundText])
      .setVisible(false);

    this.statusText = textShadow(
      this.add
        .text(PLAY_ZONE_CX, STATUS_Y + 3, "", {
          fontFamily: FONT_FAMILY,
          fontSize: "10.5px",
          fontStyle: "500",
          color: UI_COLORS.body,
          align: "left",
          wordWrap: { width: PLAY_ZONE_W - 20 },
          lineSpacing: 1,
        })
        .setOrigin(0.5, 0)
    );

    this.classBadge = this.add.container(CLASS_BADGE.x, CLASS_BADGE.y);
    this.handContainer = this.add.container(0, HAND_Y);
    this.fieldContainer = this.add.container(0, 0);
    this.slotsContainer = this.add.container(0, 0);
    this.createEndTurnBar();

    this.logPanel.add(
      this.add
        .text(LOG_BOX.x + 10, LOG_BOX.y + 10, "BATTLE LOG", {
          fontFamily: FONT_DISPLAY,
          fontSize: "10px",
          fontStyle: "700",
          color: UI_COLORS.gold,
        })
        .setLetterSpacing(1.6)
        .setOrigin(0, 0)
    );

    const footY = LOG_BOX.y + LOG_BOX.h - LOG_FOOT_H;
    const footLine = this.add.graphics();
    footLine.lineStyle(1, UI_COLORS.edge, 0.6);
    footLine.lineBetween(LOG_BOX.x + 10, footY + 0.5, LOG_BOX.x + LOG_BOX.w - 10, footY + 0.5);
    this.logPanel.add(footLine);
    this.logPanel.add(
      this.add
        .text(LOG_BOX.x + 10, footY + 6, "Oldest first", {
          fontFamily: FONT_FAMILY,
          fontSize: "8px",
          fontStyle: "500",
          color: UI_COLORS.faint,
        })
        .setLetterSpacing(0.8)
    );
    this.logPanel.add(
      this.add
        .text(LOG_BOX.x + LOG_BOX.w - 10, footY + 6, "Scroll ↕", {
          fontFamily: FONT_FAMILY,
          fontSize: "8px",
          fontStyle: "500",
          color: UI_COLORS.faint,
        })
        .setLetterSpacing(0.8)
        .setOrigin(1, 0)
    );

    // Scrolling is done by picking which slice of battle.log to render
    // (index 0 = oldest) rather than by pixel-clipping a moving container --
    // Phaser 4's WebGL renderer dropped support for GeometryMask (it wants a
    // texture-based Filter instead), and every log line is a short one-liner
    // anyway, so paging by line is simpler and renderer-agnostic.
    this.logScrollIndex = 0;
    this.logMaxScrollIndex = 0;
    // Keep the body on the same 10px inset as the header and footer.
    this.logContainer = this.add.container(LOG_X + 10, LOG_Y);

    this.logScrollTrack = this.add
      .rectangle(LOG_X + LOG_W - 6, LOG_Y, 4, LOG_H, COLORS.meterTrack)
      .setOrigin(0, 0)
      .setVisible(false);
    this.logScrollThumb = this.add
      .rectangle(LOG_X + LOG_W - 6, LOG_Y, 4, LOG_H, COLORS.restartHover)
      .setOrigin(0, 0)
      .setVisible(false);
    this.logPanel.add([this.logContainer, this.logScrollTrack, this.logScrollThumb]);

    // Hide / show toggle, fixed in the log's top-right corner whether the
    // log is there or not: ▶ slides it off to the right, ◀ brings it back.
    const toggleLabel = (): string => (this.logHidden ? "◀" : "▶");
    const logToggle = createButton(
      this,
      LOG_BOX.x + LOG_BOX.w - LOG_TOGGLE.w - 6,
      LOG_BOX.y + 6,
      LOG_TOGGLE.w,
      LOG_TOGGLE.h,
      toggleLabel(),
      {
        color: COLORS.restart,
        hoverColor: COLORS.restartHover,
        onClick: () => {
          this.logHidden = !this.logHidden;
          saveLogHidden(this.logHidden);
          (logToggle.container.getAt(1) as Phaser.GameObjects.Text).setText(toggleLabel());
          this.tweens.killTweensOf(this.logPanel);
          this.tweens.add({ targets: this.logPanel, x: this.logHidden ? LOG_HIDE_DX : 0, duration: 280, ease: "Cubic.easeInOut" });
        },
      }
    );

    // Only scroll the log when the pointer is over it, so it doesn't hijack
    // wheel input over the rest of the page.
    // pointer.x/y are canvas pixels, so convert them into the camera's
    // (zoomed) layout coordinates before comparing to the log's box.
    this.input.on("wheel", (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
      void _objects;
      void _dx;
      const { x, y } = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      if (this.logHidden || x < LOG_X || x > LOG_X + LOG_W || y < LOG_Y || y > LOG_Y + LOG_H) {
        return;
      }
      this.scrollLog(Math.sign(dy) * LOG_SCROLL_STEP);
    });

    // The center card preview sits above everything else.
    this.previewLayer = this.add.container(0, 0).setDepth(900);

    this.render();
    loadCardArt(this, allCards(), () => this.render());
    // Text is drawn once, so redraw when the card fonts (index.html) arrive.
    Promise.all(["700 16px Cinzel", '900 16px "Exo 2"', "400 16px Inter", "500 16px Inter", "600 16px Inter", "700 16px Inter", "800 16px Inter"].map((font) => document.fonts.load(font)))
      .then(() => this.sys.isActive() && this.render())
      .catch(() => {});
  }

  scrollLog(deltaPixels: number): void {
    const next = Phaser.Math.Clamp(this.logScrollIndex + deltaPixels, 0, this.logMaxScrollIndex);
    if (next === this.logScrollIndex) return;
    this.logScrollIndex = next;
    this.logFollow = next >= this.logMaxScrollIndex - 1;
    this.renderLog();
  }

  updateLogScrollbar(): void {
    const totalH = this.logTotalHeight;
    const maxScroll = this.logMaxScrollIndex;
    const needsScroll = maxScroll > 0;
    this.logScrollTrack.setVisible(needsScroll);
    this.logScrollThumb.setVisible(needsScroll);
    if (!needsScroll) return;

    const thumbH = Math.max(24, (LOG_H / totalH) * LOG_H);
    const thumbY = LOG_Y + (this.logScrollIndex / maxScroll) * (LOG_H - thumbH);
    this.logScrollThumb.setSize(4, thumbH);
    this.logScrollThumb.setPosition(LOG_X + LOG_W - 6, thumbY);
  }

  // A hand card was clicked: show it big in the middle of the screen.
  onCardClick(cardId: number): void {
    if (!this.canAct()) return;
    this.previewedCardId = cardId;
    this.handHint = null;
    this.render();
  }

  // The previewed card was clicked again: play it onto the arena slot (it
  // only leaves the hand for real when the turn resolves).
  confirmPreview(): void {
    const card = this.battle.player.hand.find((c) => c.id === this.previewedCardId);
    this.previewedCardId = null;
    if (!card || !this.canAct()) return this.render();
    const reason = unplayableReason(this.battle.player, card, this.staged, this.orders);
    if (reason) {
      this.handHint = `can't play ${card.name}: ${reason}.`;
      return this.render();
    }
    // A single-target attack: pick who it hits first (automatic when the
    // only possible target is the enemy fighter).
    if (cardNeedsTarget(card)) return this.startTargeting({ kind: "card", card });
    this.stageCard(card, null);
  }

  stageCard(card: Card, target: Target | null): void {
    this.staged = [...this.staged, card];
    if (target) this.stagedTargets = { ...this.stagedTargets, [card.id]: target };
    playSfx("card");
    this.render();
  }

  // Enter target picking, or skip it when the enemy has no monsters.
  startTargeting(targeting: NonNullable<BattleScene["targeting"]>): void {
    this.monsterMenuUid = null;
    if (this.battle.cpu.field.length === 0) return this.chooseTarget({ kind: "fighter" }, targeting);
    this.targeting = targeting;
    this.handHint = null;
    this.render();
  }

  chooseTarget(target: Target, targeting = this.targeting): void {
    this.targeting = null;
    if (!targeting) return this.render();
    if (targeting.kind === "card") return this.stageCard(targeting.card, target);
    this.orders = [...this.orders.filter((o) => o.uid !== targeting.uid), { uid: targeting.uid, use: targeting.use, target }];
    playSfx("card");
    this.render();
  }

  // Keep only the picks that are still payable, in order (after a card or
  // order was taken back).
  prunePlan(): void {
    const player = this.battle.player;
    const kept: Card[] = [];
    for (const card of this.staged) if (canPlayCard(player, card, kept)) kept.push(card);
    this.staged = kept;
    const keptIds = new Set(kept.map((c) => c.id));
    this.stagedTargets = Object.fromEntries(Object.entries(this.stagedTargets).filter(([id]) => keptIds.has(Number(id))));
    const orders: MonsterOrder[] = [];
    for (const order of this.orders) if (!checkPlan(player, kept, false, [...orders, order]).problem) orders.push(order);
    this.orders = orders;
    if (this.stagedUltimate && checkPlan(player, kept, true, orders).problem) this.stagedUltimate = false;
  }

  // A picked card was clicked on the arena slot: take it back. Cards picked
  // after it stay only if the turn is still payable without it.
  unstage(cardId: number): void {
    if (!this.canAct()) return;
    this.staged = this.staged.filter((c) => c.id !== cardId);
    this.prunePlan();
    this.handHint = null;
    this.render();
  }

  // One of your monsters was clicked: cancel its order if it has one,
  // otherwise open its command menu.
  onMonsterClick(monster: Monster): void {
    if (!this.canAct()) return;
    if (!monster.ready) {
      this.handHint = `${monster.name} was just summoned -- it can act next round.`;
      return this.render();
    }
    if (this.orders.some((o) => o.uid === monster.uid)) {
      this.orders = this.orders.filter((o) => o.uid !== monster.uid);
      this.prunePlan();
      return this.render();
    }
    this.previewedCardId = null;
    this.monsterMenuUid = monster.uid;
    this.handHint = null;
    this.render();
  }

  giveOrder(monster: Monster, use: MonsterOrder["use"]): void {
    this.monsterMenuUid = null;
    const problem = checkPlan(this.battle.player, this.staged, false, [...this.orders, { uid: monster.uid, use, target: null }]).problem;
    if (problem) {
      this.handHint = `${problem}.`;
      return this.render();
    }
    if (orderNeedsTarget(monster, use)) return this.startTargeting({ kind: "order", uid: monster.uid, use });
    this.orders = [...this.orders, { uid: monster.uid, use, target: null }];
    playSfx("card");
    this.render();
  }

  // Ultimate is a toggle: it joins this turn when it's ended.
  onUltimateClick(): void {
    if (!this.canAct()) return;
    if (!this.stagedUltimate && checkPlan(this.battle.player, this.staged, true, this.orders).problem) return;
    this.stagedUltimate = !this.stagedUltimate;
    this.render();
  }

  onEndTurnClick(): void {
    if (!this.canAct()) return;
    const action = planAction(this.battle.player, this.staged.map((c) => c.id), this.stagedUltimate, {
      targets: this.stagedTargets,
      orders: this.orders,
      opponent: this.battle.cpu,
    });
    if (!action) {
      this.handHint = "that turn can't be paid for any more -- take a card back.";
      this.render();
      return;
    }
    this.commitAction(action);
  }

  // --- round recap -----------------------------------------------------------

  currentHp(): HpPair {
    return { player: this.battle.player.hp, cpu: this.battle.cpu.hp };
  }

  // Show the round that just resolved: draw the new state with the HP from
  // `before`, play the recap (which counts HP down as hits land), then draw
  // the final state. Without both sides' lastTurn (e.g. an online match on
  // a server that doesn't send it yet) it just redraws.
  async presentRound(before: HpPair): Promise<void> {
    const b = this.battle;
    const playerTurn: TurnRecord | null = b.player.lastTurn;
    const cpuTurn: TurnRecord | null = b.cpu.lastTurn;
    if (!playerTurn || !cpuTurn) {
      this.pendingTurn = null;
      this.render();
      return;
    }

    this.recapPlaying = true;
    this.shownHp = { ...before };
    this.render();
    this.slotsContainer.setVisible(false); // the recap draws each play itself

    const slotX = (key: "player" | "cpu"): number =>
      key === "cpu" ? PLAY_ZONE_CX - SLOT_TOTAL_W / 2 : PLAY_ZONE_CX + SLOT_TOTAL_W / 2 - SLOT_W;
    const side = (key: "player" | "cpu", fighter: Fighter, who: string): RecapSide => ({
      turn: key === "player" ? playerTurn : cpuTurn,
      who,
      classId: fighter.classDef.id,
      className: shortName(fighter.classDef.name),
      ultimateName: ultimateName(fighter.classDef),
      hp: before[key],
      panel: () => this.panelViews[key] as RecapPanel,
      fieldCenter: () => ({ x: (key === "cpu" ? CPU_FIELD_X : PLAYER_FIELD_X) + FIELD_W / 2, y: FIELD_Y + FIELD_H / 2 }),
      slot: { x: slotX(key), y: SLOT_Y, w: SLOT_W, h: SLOT_H, faceW: CARD_W, faceH: CARD_H },
    });

    playRoundRecap(this, {
      round: playerTurn.round,
      stage: RECAP_STAGE,
      centerX: PLAY_ZONE_CX,
      sides: {
        player: side("player", b.player, "You"),
        cpu: side("cpu", b.cpu, this.opponentLabel),
      },
      speed: this.recapSpeed,
    }).finally(() => {
      this.recapPlaying = false;
      this.shownHp = null;
      this.pendingTurn = null; // slots empty again until the next turn
      this.slotsContainer.setVisible(true);
      if (this.sys.isActive()) this.render();
    });
  }

  // --- end-of-game screen ------------------------------------------------------

  // VICTORY / DEFEAT / DRAW in the middle of the screen, over everything,
  // once the game is over and the last round's recap has finished. "View
  // board" closes it to look at the final state; Leave Match in the
  // settings menu still works after that.
  showResult(): void {
    if (this.resultLayer || this.resultDismissed) return;
    const b = this.battle;
    const result = b.draw ? RESULT.draw : b.winner === b.player ? RESULT.win : RESULT.lose;
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2 - 50;

    const layer = this.add.container(0, 0).setDepth(1000);
    this.resultLayer = layer;
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x060607, 0.75).setOrigin(0, 0).setInteractive();
    layer.add(dim);

    if (result === RESULT.win) {
      // Slowly turning rays behind the title, and falling confetti.
      const rays = this.add.graphics();
      rays.fillStyle(result.color, 0.13);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const spread = Math.PI / 24;
        rays.fillTriangle(
          0,
          0,
          Math.cos(a - spread) * 520,
          Math.sin(a - spread) * 520,
          Math.cos(a + spread) * 520,
          Math.sin(a + spread) * 520
        );
      }
      const rayHolder = this.add.container(cx, cy, [rays]).setAlpha(0);
      layer.add(rayHolder);
      this.tweens.add({ targets: rayHolder, alpha: 1, duration: 500 });
      this.tweens.add({ targets: rayHolder, angle: 360, duration: 24000, repeat: -1 });

      const confettiColors = [0xffd23f, 0xffffff, 0x6be39a, 0x6ec6ff, 0xff9d4d];
      for (let i = 0; i < 60; i++) {
        const piece = this.add
          .rectangle(Phaser.Math.Between(0, GAME_WIDTH), Phaser.Math.Between(-300, -10), 6, 10, (confettiColors[i % confettiColors.length] as number))
          .setAngle(Phaser.Math.Between(0, 360));
        layer.add(piece);
        this.tweens.add({
          targets: piece,
          y: 800,
          angle: piece.angle + Phaser.Math.Between(180, 720),
          x: piece.x + Phaser.Math.Between(-80, 80),
          delay: Phaser.Math.Between(0, 1500),
          duration: Phaser.Math.Between(2200, 3600),
          ease: "Sine.easeIn",
          onComplete: () => piece.destroy(),
        });
      }
    } else if (result === RESULT.lose) {
      const shade = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x5a0f0f, 0).setOrigin(0, 0);
      layer.add(shade);
      this.tweens.add({ targets: shade, fillAlpha: 0.25, duration: 600 });
    }

    const title = this.add
      .text(cx, cy, result.title, {
        fontFamily: FONT_FAMILY,
        fontSize: "88px",
        fontStyle: "800",
        color: `#${result.color.toString(16).padStart(6, "0")}`,
        stroke: "#000000",
        strokeThickness: 10,
      })
      .setOrigin(0.5);
    const subtitle = this.add
      .text(cx, cy + 70, this.resultSubtitle(), {
        fontFamily: FONT_FAMILY,
        fontSize: "18px",
        fontStyle: "700",
        color: TEXT.white,
        align: "center",
        wordWrap: { width: 700 },
      })
      .setOrigin(0.5, 0);
    const hp = (f: Fighter): string => `${Math.ceil(f.hp)}/${f.maxHp} HP`;
    const summary = this.add
      .text(cx, cy + 102, `You ${hp(b.player)}   ·   ${this.opponentLabel} ${hp(b.cpu)}`, {
        fontFamily: FONT_FAMILY,
        fontSize: "14px",
        color: TEXT.muted,
      })
      .setOrigin(0.5, 0);
    layer.add([title, subtitle, summary]);

    // The buttons, centered side by side.
    const actions = this.resultActions();
    const buttonW = 160;
    const gap = 20;
    const left = cx - (actions.length * buttonW + (actions.length - 1) * gap) / 2;
    this.resultButtons = actions.map((a, i) =>
      createButton(this, left + i * (buttonW + gap), cy + 150, buttonW, 44, a.label, {
        color: a.color,
        hoverColor: a.hoverColor,
        onClick: a.onClick,
      })
    );
    const note = this.add
      .text(cx, cy + 210, "", { fontFamily: FONT_FAMILY, fontSize: "16px", fontStyle: "700", color: TEXT.white, align: "center" })
      .setOrigin(0.5, 0);
    this.resultNote = note;
    layer.add([...this.resultButtons.map((b) => b.container), note]);

    // Entrance: a stamp for VICTORY, a heavy drop for DEFEAT, a fade for DRAW.
    const details: Array<Phaser.GameObjects.Container | Phaser.GameObjects.Text> = [
      subtitle,
      summary,
      ...this.resultButtons.map((b) => b.container),
      note,
    ];
    details.forEach((o) => o.setAlpha(0));
    dim.setAlpha(0);
    this.tweens.add({ targets: dim, alpha: 1, duration: 250 });
    if (result === RESULT.win) {
      title.setScale(2.4).setAlpha(0);
      this.tweens.add({ targets: title, scale: 1, alpha: 1, duration: 420, ease: "Back.easeOut" });
      this.cameras.main.flash(250, 255, 230, 150);
    } else if (result === RESULT.lose) {
      title.setY(cy - 160).setAlpha(0);
      this.tweens.add({ targets: title, y: cy, alpha: 1, duration: 520, ease: "Bounce.easeOut" });
    } else {
      title.setAlpha(0);
      this.tweens.add({ targets: title, alpha: 1, duration: 500 });
    }
    this.tweens.add({ targets: details, alpha: 1, delay: 450, duration: 300 });
    playSfx(result.sfx);
  }

  hideResult(): void {
    this.resultDismissed = true;
    if (!this.resultLayer) return;
    const layer = this.resultLayer;
    this.resultLayer = null;
    this.tweens.add({
      targets: layer,
      alpha: 0,
      duration: 200,
      onComplete: () => {
        this.tweens.killTweensOf(layer.getAll());
        layer.destroy(true);
      },
    });
  }

  // --- drawing ---------------------------------------------------------------

  render(): void {
    const locked = !this.canAct();

    this.renderFighterPanel("cpu", this.cpuPanel, STRIP_X, CPU_STRIP_Y, STRIP_W, this.battle.cpu);
    this.renderFighterPanel("player", this.playerPanel, PLAYER_STRIP_X, PLAYER_STRIP_Y, PLAYER_STRIP_W, this.battle.player);
    this.drawFields();
    this.drawSlots();
    this.renderHand(locked);
    this.renderLog();
    this.updateEndTurnBar(locked);
    this.drawClassBadge(locked);
    this.drawPreview(locked);
    if (!locked) {
      this.drawTargeting();
      this.drawMonsterMenu();
    }

    this.setStatus(this.statusMessage());

    if (isBattleOver(this.battle) && !this.recapPlaying) this.showResult();
  }

  // Battle panels: 82% ink over the hall with a 1px bronze edge, matching
  // the preview's cleaner plates.
  drawPanelBackground(container: Phaser.GameObjects.Container, w: number, h: number, radius = 10): Phaser.GameObjects.Graphics {
    const g = this.add.graphics();
    g.fillStyle(UI_COLORS.panel, UI_COLORS.panelAlpha);
    g.fillRoundedRect(0, 0, w, h, radius);
    g.lineStyle(1, UI_COLORS.edge, 0.95);
    g.strokeRoundedRect(0.5, 0.5, w - 1, h - 1, radius);
    g.lineStyle(1, 0xffffff, 0.035);
    g.lineBetween(radius, 1.5, w - radius, 1.5);
    container.add(g);
    return g;
  }

  renderFighterPanel(
    key: "player" | "cpu",
    container: Phaser.GameObjects.Container,
    x: number,
    y: number,
    w: number,
    fighter: Fighter
  ): void {
    container.removeAll(true);
    container.setPosition(x, y);
    this.drawPanelBackground(container, w, STRIP_H);

    // Header row: name, AP pill, HP bar, GUARD badge (while one's up), Hand N.
    const header = this.drawPanelHeader(container, fighter, w, key);
    const hpRight = this.drawGuardFrame(container, fighter, w, header.right);
    const setHp = this.drawHpBar(container, key, fighter, header.left, hpRight);
    this.drawStatRail(container, fighter, w);
    // Bottom row is shared: effect chips on the left, ultimate meter right.
    // Your meter is the ring around your class badge instead.
    if (key === "player") {
      this.drawEffectChips(container, fighter, w, CHIP_ROW_Y, w - STRIP_PAD);
    } else {
      this.drawEffectChips(container, fighter, w, CHIP_ROW_Y, w * 0.55);
      this.drawUltimateMeter(container, fighter, w * 0.58, CHIP_ROW_Y + 6, w - w * 0.58 - STRIP_PAD);
    }

    this.panelViews[key] = { x, y, w, h: STRIP_H, container, setHp };
  }

  // Returns the gap left between the AP pill and "Hand N" (for the HP bar).
  drawPanelHeader(
    container: Phaser.GameObjects.Container,
    fighter: Fighter,
    w: number,
    key: "player" | "cpu"
  ): { left: number; right: number } {
    const side = this.add
      .text(STRIP_PAD, 9, key === "cpu" ? "CPU" : "PLAYER", {
        fontFamily: FONT_FAMILY,
        fontSize: "8px",
        fontStyle: "600",
        color: UI_COLORS.faint,
      })
      .setLetterSpacing(1.6);
    container.add(side);

    const name = this.add.text(STRIP_PAD + side.width + 9, 4, this.displayName(fighter), {
      fontFamily: FONT_DISPLAY,
      fontSize: "15px",
      fontStyle: "700",
      color: UI_COLORS.ivory,
    });
    container.add(name);

    // AP pill beside the name: left this turn / this turn's max (for you,
    // after the cards picked so far).
    const apText = this.add
      .text(0, 0, `AP ${fmt(fighter === this.battle.player && !this.pendingTurn ? this.plannedAp() : fighter.ap)}/${fighter.maxAp ?? fighter.ap}`, { fontFamily: FONT_FAMILY, fontSize: "10px", fontStyle: "700", color: TEXT.white })
      .setOrigin(0, 0.5);
    const pillX = STRIP_PAD + side.width + name.width + 18;
    const pillW = apText.width + 16;
    const pill = this.add.graphics();
    pill.fillStyle(AP_GEM_COLOR, 1);
    pill.fillRoundedRect(pillX, 5, pillW, 18, 9);
    apText.setPosition(pillX + 8, 14);
    container.add([pill, apText]);

    const handCount = fighter.handCount ?? fighter.hand.length;
    const hand = this.add
      .text(w - STRIP_PAD, 9, `HAND ${handCount}`, {
        fontFamily: FONT_FAMILY,
        fontSize: "8px",
        fontStyle: "600",
        color: UI_COLORS.faint,
      })
      .setLetterSpacing(1.2)
      .setOrigin(1, 0);
    container.add(hand);
    return { left: pillX + pillW + 10, right: w - STRIP_PAD - hand.width - 12 };
  }

  // While a defend card is up: a pulsing blue frame around the strip and a
  // "GUARD +5" badge in the header ending at `right`, so it's obvious at a
  // glance. Returns where the header's free space now ends.
  drawGuardFrame(container: Phaser.GameObjects.Container, fighter: Fighter, w: number, right: number): number {
    const guards = Object.values(fighter.activeDefends);
    if (guards.length === 0) return right;

    const frame = this.add.graphics();
    frame.lineStyle(2, GUARD_COLOR, 1);
    frame.strokeRoundedRect(1, 1, w - 2, STRIP_H - 2, 10);
    container.add(frame);
    this.tweens.add({ targets: frame, alpha: 0.35, duration: 800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    frame.once("destroy", () => this.tweens.killTweensOf(frame));

    const text = this.add
      .text(0, 0, `GUARD ${guards.map(({ card }) => guardAmount(card as DefendCard)).join(" / ")}`, {
        fontFamily: FONT_FAMILY,
        fontSize: "10.5px",
        fontStyle: "700",
        color: "#0b1b26",
      })
      .setOrigin(0, 0.5);
    const iconSize = 13;
    const wBadge = text.width + iconSize + 20;
    const h = 20;
    const x = right - wBadge;
    const y = 3;
    const pill = this.add.graphics();
    pill.fillStyle(GUARD_COLOR, 1);
    pill.fillRoundedRect(x, y, wBadge, h, h / 2);
    container.add(pill);
    if (this.textures.exists(CARD_ICON_KEY.defend)) {
      container.add(this.add.image(x + 8 + iconSize / 2, y + h / 2, CARD_ICON_KEY.defend).setDisplaySize(iconSize, iconSize).setTint(0x0b1b26));
    }
    text.setPosition(x + 12 + iconSize, y + h / 2);
    container.add(text);
    return x - 10;
  }

  // HP bar in the header, from `left` to `right`. Returns setHp(value), which
  // animates the bar to a new value (with a pale "ghost" of the lost HP that
  // drains a moment later) -- the round recap calls it as each hit lands.
  drawHpBar(
    container: Phaser.GameObjects.Container,
    key: "player" | "cpu",
    fighter: Fighter,
    left: number,
    right: number
  ): (next: number) => void {
    const pad = left;
    const barW = right - left;
    const y = 7;
    const h = 16;
    const track = this.add.graphics();
    track.fillStyle(UI_COLORS.railInk, 1);
    track.fillRoundedRect(pad, y, barW, h, 8);
    track.lineStyle(1, 0x000000, 0.55);
    track.strokeRoundedRect(pad + 0.5, y + 0.5, barW - 1, h - 1, 8);
    const ghost = this.add.graphics();
    const fill = this.add.graphics();
    const hpLabel = this.add
      .text(pad + 9, y + h / 2, "HP", {
        fontFamily: FONT_FAMILY,
        fontSize: "9.5px",
        fontStyle: "700",
        color: "rgba(255,255,255,0.85)",
      })
      .setLetterSpacing(1.1)
      .setOrigin(0, 0.5);
    const value = this.add
      .text(pad + barW / 2, y + h / 2, "", {
        fontFamily: FONT_FAMILY,
        fontSize: "12px",
        fontStyle: "700",
        color: TEXT.white,
        stroke: "#000000",
        strokeThickness: 2,
      })
      .setOrigin(0.5);
    container.add([track, ghost, fill, hpLabel, value]);

    const bar = (g: Phaser.GameObjects.Graphics, hp: number, color: number, alpha: number): void => {
      g.clear();
      const bw = barW * Phaser.Math.Clamp(hp / fighter.maxHp, 0, 1);
      if (bw <= 0) return;
      g.fillStyle(color, alpha);
      g.fillRoundedRect(pad, y, bw, h, Math.min(8, bw / 2));
    };
    const draw = (hp: number, ghostHp: number): void => {
      bar(ghost, ghostHp, 0xffffff, 0.35);
      bar(fill, hp, hpColor(hp / fighter.maxHp), 1);
      value.setText(`${Math.ceil(hp)} / ${fighter.maxHp}`);
    };

    let shown = this.shownHp?.[key] ?? fighter.hp;
    draw(shown, shown);

    return (next: number): void => {
      if (this.shownHp) this.shownHp[key] = next;
      const state = { hp: shown, ghost: shown };
      shown = next;
      const update = (): void => {
        if (fill.active) draw(state.hp, state.ghost);
      };
      this.tweens.add({ targets: state, hp: next, duration: 350, ease: "Cubic.easeOut", onUpdate: update });
      this.tweens.add({ targets: state, ghost: next, delay: 400, duration: 450, onUpdate: update });
    };
  }

  // A single engraved stat rail: DEF / MR / ER / UR / ATK. Each cell keeps
  // the old hover/click explainer, guard tint and change marker, so the data
  // and interactions are unchanged -- only the five boxes are gone.
  drawStatRail(container: Phaser.GameObjects.Container, fighter: Fighter, w: number): void {
    const pad = STRIP_PAD;
    const x = pad;
    const y = RAIL_Y;
    const h = RAIL_H;
    const railW = w - pad * 2;
    const cw = railW / STAT_CHIPS.length;
    const stats = computeCurrentStats(fighter);
    const base = fighter.classDef.baseStats;

    // Active guards by the stat they back up (a physical guard sits on DEF).
    const guardByStat: Partial<Record<StatKey, DefendCard>> = {};
    for (const [type, { card }] of Object.entries(fighter.activeDefends)) {
      const statKey = (RESIST_STAT as Partial<Record<string, StatKey>>)[type];
      if (statKey) guardByStat[statKey] = card as DefendCard;
    }

    // Recessed bronze channel. End-caps and fading separators are drawn once,
    // behind the cells.
    const rail = this.add.graphics();
    rail.fillGradientStyle(0x000000, 0x000000, 0x1a1b1e, 0x1a1b1e, 0.24, 0.24, 0.05, 0.05);
    rail.fillRect(x, y, railW, h);
    rail.lineStyle(1, UI_COLORS.bronze, 0.32);
    rail.lineBetween(x, y + 0.5, x + railW, y + 0.5);
    rail.lineStyle(1, 0x000000, 0.62);
    rail.lineBetween(x, y + h - 0.5, x + railW, y + h - 0.5);
    rail.fillStyle(UI_COLORS.bronze, 1);
    rail.fillRect(x - 1, y - 1, 3, h + 2);
    rail.fillRect(x + railW - 2, y - 1, 3, h + 2);

    for (let i = 1; i < STAT_CHIPS.length; i++) {
      const sx = x + cw * i;
      rail.fillStyle(UI_COLORS.bronze, 0.1);
      rail.fillRect(sx, y + 4, 1, 4);
      rail.fillStyle(UI_COLORS.bronze, 0.36);
      rail.fillRect(sx, y + 8, 1, h - 16);
      rail.fillStyle(UI_COLORS.bronze, 0.1);
      rail.fillRect(sx, y + h - 8, 1, 4);

      const cy = y + h / 2;
      const stud = [
        new Phaser.Math.Vector2(sx, cy - 2.5),
        new Phaser.Math.Vector2(sx + 2.5, cy),
        new Phaser.Math.Vector2(sx, cy + 2.5),
        new Phaser.Math.Vector2(sx - 2.5, cy),
      ];
      rail.fillStyle(UI_COLORS.bronzeHi, 1);
      rail.fillPoints(stud, true);
      rail.lineStyle(1, 0x000000, 0.5);
      rail.strokePoints(stud, true);
    }
    container.add(rail);

    STAT_CHIPS.forEach((chip, i) => {
      const box = this.add.container(x + cw * i + cw / 2, y + h / 2);
      container.add(box);
      const left = -cw / 2;
      const top = -h / 2;
      const delta = stats[chip.key] - (base[chip.key] ?? 0);
      const guard = guardByStat[chip.key];
      const statColor = Phaser.Display.Color.IntegerToColor(chip.color).rgba;

      if (guard) {
        box.add(this.add.rectangle(left + 1, top + 1, cw - 2, h - 2, UI_COLORS.guard, 0.1).setOrigin(0));
      }
      const hover = this.add.rectangle(left + 1, top + 1, cw - 2, h - 2, chip.color, 1).setOrigin(0).setAlpha(0);
      box.add(hover);

      // Faceted gem: 6px diamond, dark rim, small light facet.
      const gx = left + 8;
      const gemPts = [
        new Phaser.Math.Vector2(gx, -3.2),
        new Phaser.Math.Vector2(gx + 3.2, 0),
        new Phaser.Math.Vector2(gx, 3.2),
        new Phaser.Math.Vector2(gx - 3.2, 0),
      ];
      const gem = this.add.graphics();
      gem.fillStyle(chip.color, 1);
      gem.fillPoints(gemPts, true);
      gem.lineStyle(1, 0x000000, 0.55);
      gem.strokePoints(gemPts, true);
      gem.fillStyle(0xffffff, 0.5);
      gem.fillTriangle(gx - 1.4, -1.4, gx + 0.6, -1.4, gx - 1.4, 0.6);
      box.add(gem);

      const label = this.add
        .text(left + 17, top + 2, chip.label, {
          fontFamily: FONT_FAMILY,
          fontSize: "8px",
          fontStyle: "600",
          color: UI_COLORS.muted,
        })
        .setLetterSpacing(1.4);
      box.add(label);

      const full = this.add
        .text(left + 17, top + 2, STAT_INFO[chip.key].name, {
          fontFamily: FONT_FAMILY,
          fontSize: "8px",
          fontStyle: "600",
          color: statColor,
        })
        .setLetterSpacing(1.2)
        .setAlpha(0);
      box.add(full);

      const valueColor = guard ? UI_COLORS.ivory : delta > 0 ? UI_COLORS.up : delta < 0 ? UI_COLORS.down : UI_COLORS.ivory;
      box.add(
        this.add.text(left + 17, top + 12, fmt(stats[chip.key]), {
          fontFamily: FONT_FAMILY,
          fontSize: "14px",
          fontStyle: "700",
          color: valueColor,
        })
      );

      if (guard) {
        box.add(
          this.add
            .text(left + cw - 6, top + 4, `+${guardAmount(guard)}`, {
              fontFamily: FONT_FAMILY,
              fontSize: "8px",
              fontStyle: "700",
              color: "#8fd3ff",
            })
            .setOrigin(1, 0)
        );
        box.add(this.add.rectangle(left + 1, top + h - 1, cw - 2, 1, UI_COLORS.guard, 0.55).setOrigin(0));
      } else if (delta !== 0) {
        box.add(
          this.add
            .text(left + cw - 6, top + 4, `${delta > 0 ? "▲" : "▼"}${fmt(Math.abs(delta))}`, {
              fontFamily: FONT_FAMILY,
              fontSize: "8px",
              fontStyle: "700",
              color: valueColor,
            })
            .setOrigin(1, 0)
        );
      }

      // Hover outline stays on the cell edge; no scaling, so text doesn't move.
      const ring = this.add.graphics().setVisible(false);
      ring.lineStyle(1, chip.color, 0.9);
      ring.strokeRect(left + 1, top + 1, cw - 2, h - 2);
      box.add(ring);

      const hit = this.add.zone(left, top, cw, h).setOrigin(0).setInteractive({ useHandCursor: true });
      box.add(hit);
      hit.on("pointerover", () => {
        hover.setAlpha(guard ? 0.14 : 0.12);
        label.setAlpha(0);
        full.setAlpha(1);
        ring.setVisible(true);
      });
      hit.on("pointerout", () => {
        hover.setAlpha(0);
        label.setAlpha(1);
        full.setAlpha(0);
        ring.setVisible(false);
      });
      hit.on("pointerdown", () => this.toggleStatInfo(container, box, chip.key, chip.color, cw, h));
    });
  }

  setReplaySpeed(speed: number): void {
    this.recapSpeed = speed;
    saveRecapSpeed(speed);
    setRecapSpeed(this, speed);
    (this.speedButton.container.getAt(1) as Phaser.GameObjects.Text).setText(`Speed ${speed}x`);
  }

  // The settings dropdown: a tab hugging the gear that widens into a panel
  // below it, with a volume slider, a stepped replay speed slider and, at the
  // bottom, an account settings button (placeholder for now) and Leave
  // Match. Esc opens it too; a click anywhere outside it (or on the gear, or
  // Esc again) closes it.
  openSettings(): void {
    this.closeSettings();
    const { x, y, w, tab, pad } = SETTINGS_MENU;
    const menu = this.add.container(0, 0).setDepth(950);
    this.settingsMenu = menu;

    // Full-screen catcher behind the menu: closes it and keeps the click from
    // reaching the board underneath.
    const catcher = this.add.zone(0, 0, GAME_WIDTH, GAME_HEIGHT).setOrigin(0).setInteractive();
    catcher.on("pointerdown", () => this.closeSettings());
    menu.add(catcher);

    const body = this.add.container(x, y);
    menu.add(body);
    const label = (ly: number, text: string): Phaser.GameObjects.Text =>
      this.add.text(pad, ly, text, { fontFamily: FONT_FAMILY, fontSize: "13px", fontStyle: "700", color: TEXT.white });
    const value = (ly: number): Phaser.GameObjects.Text =>
      this.add.text(w - pad, ly, "", { fontFamily: FONT_FAMILY, fontSize: "13px", fontStyle: "700", color: TEXT.muted }).setOrigin(1, 0);

    // Volume, 0-100%; a short blip on release previews the new level.
    const volumeValue = value(14);
    const showVolume = (v: number): void => {
      volumeValue.setText(`${Math.round(v * 100)}%`);
    };
    showVolume(getVolume());
    body.add([label(14, "Volume"), volumeValue]);
    this.addSlider(body, pad, 46, w - pad * 2, {
      value: getVolume(),
      onChange: (v) => {
        setVolume(v);
        showVolume(v);
      },
      onRelease: () => playSfx("card"),
    });

    // Replay speed, one stop per RECAP_SPEEDS entry, labelled underneath.
    const speedValue = value(72);
    speedValue.setText(`${this.recapSpeed}x`);
    body.add([label(72, "Animation speed"), speedValue]);
    const trackW = w - pad * 2;
    const steps = RECAP_SPEEDS.length;
    this.addSlider(body, pad, 104, trackW, {
      value: RECAP_SPEEDS.indexOf(this.recapSpeed) / (steps - 1),
      steps,
      onChange: (v) => {
        const speed = RECAP_SPEEDS[Math.round(v * (steps - 1))] as number;
        if (speed === this.recapSpeed) return;
        this.setReplaySpeed(speed);
        speedValue.setText(`${speed}x`);
      },
    });
    RECAP_SPEEDS.forEach((speed, i) => {
      body.add(
        this.add
          .text(pad + (trackW * i) / (steps - 1), 118, `${speed}x`, { fontFamily: FONT_FAMILY, fontSize: "10px", color: TEXT.muted })
          .setOrigin(0.5, 0)
      );
    });

    // Account settings, at the bottom: not designed yet, so the button just
    // says so.
    const account = createButton(this, pad, 146, w - pad * 2, 32, "Account settings", {
      color: COLORS.restart,
      hoverColor: COLORS.restartHover,
      onClick: () => {
        const text = account.container.getAt(1) as Phaser.GameObjects.Text;
        text.setText("Coming soon");
        this.time.delayedCall(1200, () => text.active && text.setText("Account settings"));
      },
    });
    body.add(account.container);

    // Leave Match, under it: back to the menu (online matches ask first,
    // since leaving counts as a loss).
    const leave = createButton(this, pad, 188, w - pad * 2, 32, this.leaveLabel, {
      color: COLORS.ultimate,
      hoverColor: COLORS.ultimateHover,
      onClick: () => {
        this.closeSettings();
        void this.onLeave();
      },
    });
    body.add(leave.container);
    const h = 236;

    // Background, added under everything once the height is known: one
    // outlined shape, a tab behind the gear (round on top, sharing the gear's
    // centre and left edge) running straight down into the panel.
    const r = 12;
    const gearY = SETTINGS.y - y; // the gear's centre, in panel coordinates
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.35);
    bg.fillRoundedRect(4, 6, w, h, r);
    bg.beginPath();
    bg.moveTo(0, gearY);
    bg.arc(tab, gearY, tab, Math.PI, 0);
    bg.lineTo(tab * 2, 0);
    bg.lineTo(w - r, 0);
    bg.arc(w - r, r, r, -Math.PI / 2, 0);
    bg.lineTo(w, h - r);
    bg.arc(w - r, h - r, r, 0, Math.PI / 2);
    bg.lineTo(r, h);
    bg.arc(r, h - r, r, Math.PI / 2, Math.PI);
    bg.closePath();
    bg.fillStyle(COLORS.panel, 1);
    bg.fillPath();
    bg.lineStyle(1.5, COLORS.restartHover, 1);
    bg.strokePath();
    bg.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains); // clicks on the panel stay in it
    body.addAt(bg, 0);

    // Drop down from the gear.
    body.setAlpha(0).setY(y - 10);
    this.tweens.add({ targets: body, alpha: 1, y, duration: 160, ease: "Cubic.easeOut" });
  }

  toggleSettings(): void {
    if (this.settingsMenu) this.closeSettings();
    else this.openSettings();
  }

  closeSettings(): void {
    if (!this.settingsMenu) return;
    const menu = this.settingsMenu;
    this.settingsMenu = null;
    this.tweens.killTweensOf(menu.getAll());
    menu.destroy(true);
  }

  // A horizontal slider in `parent` (track from (x, y), `w` long) whose value
  // runs 0..1; with `steps`, it snaps to that many evenly spaced stops (with
  // tick marks). Click or drag anywhere along it.
  addSlider(
    parent: Phaser.GameObjects.Container,
    x: number,
    y: number,
    w: number,
    { value, steps, onChange, onRelease }: { value: number; steps?: number; onChange: (v: number) => void; onRelease?: () => void }
  ): void {
    const g = this.add.graphics();
    const knob = this.add.circle(0, y, 8, 0xffffff).setStrokeStyle(2, SLIDER_ACCENT);
    parent.add([g, knob]);
    const snap = (v: number): number => (steps ? Math.round(v * (steps - 1)) / (steps - 1) : v);
    const draw = (v: number): void => {
      g.clear();
      g.fillStyle(COLORS.meterTrack, 1);
      g.fillRoundedRect(x, y - 3, w, 6, 3);
      if (v > 0) {
        g.fillStyle(SLIDER_ACCENT, 1);
        g.fillRoundedRect(x, y - 3, w * v, 6, 3);
      }
      for (let i = 0; steps && i < steps; i++) {
        const tx = x + (w * i) / (steps - 1);
        g.fillStyle(i / (steps - 1) <= v ? 0x121315 : 0x6c6e74, 1);
        g.fillCircle(tx, y, 2);
      }
      knob.setX(x + w * v);
    };
    let current = snap(value);
    draw(current);

    // Pointer -> slider value, via the camera's (zoomed) layout coordinates.
    const fromPointer = (pointer: Phaser.Input.Pointer): void => {
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const next = snap(Phaser.Math.Clamp((world.x - parent.x - x) / w, 0, 1));
      if (next === current) return;
      current = next;
      draw(current);
      onChange(current);
    };
    let dragging = false;
    const hit = this.add.zone(x - 10, y - 12, w + 20, 24).setOrigin(0).setInteractive({ useHandCursor: true });
    parent.add(hit);
    hit.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      dragging = true;
      fromPointer(pointer);
    });
    const move = (pointer: Phaser.Input.Pointer): void => {
      if (dragging && pointer.isDown) fromPointer(pointer);
    };
    const up = (): void => {
      if (!dragging) return;
      dragging = false;
      onRelease?.();
    };
    this.input.on("pointermove", move);
    this.input.on("pointerup", up);
    this.input.on("pointerupoutside", up);
    hit.once("destroy", () => {
      this.input.off("pointermove", move);
      this.input.off("pointerup", up);
      this.input.off("pointerupoutside", up);
    });
  }

  // The info box a clicked stat chip opens directly above itself (below, on
  // the CPU strip where there's no room above), joined to it by a short stem.
  // Clicking the same chip (or the box) closes it; one is open at a time, and
  // it goes away whenever the strip is rebuilt.
  toggleStatInfo(
    container: Phaser.GameObjects.Container,
    chip: Phaser.GameObjects.Container,
    key: StatKey,
    color: number,
    cw: number,
    ch: number
  ): void {
    const wasOpen = this.statInfo?.key === key && this.statInfo.chip === chip;
    this.closeStatInfo();
    if (wasOpen) return;

    const info = STAT_INFO[key];
    const boxW = Math.max(cw, 240);
    const textPad = 12;
    const stem = 10;
    const title = this.add.text(0, 0, `${info.label} — ${info.name}`, {
      fontFamily: FONT_FAMILY,
      fontSize: "13px",
      fontStyle: "800",
      color: Phaser.Display.Color.IntegerToColor(color).rgba,
    });
    const body = this.add.text(0, 0, info.description, {
      fontFamily: FONT_FAMILY,
      fontSize: "12px",
      color: TEXT.white,
      lineSpacing: 2,
      wordWrap: { width: boxW - textPad * 2 },
    });
    const boxH = textPad * 2 + title.height + 6 + body.height;

    // World position of the chip's top-centre; keep the box on screen.
    const chipX = container.x + chip.x;
    const chipTop = container.y + chip.y - ch / 2;
    const left = Phaser.Math.Clamp(chipX - boxW / 2, 8, GAME_WIDTH - boxW - 8);
    const above = chipTop - stem - boxH >= 8;
    const top = above ? chipTop - stem - boxH : chipTop + ch + stem;

    const layer = this.add.container(left, top).setDepth(900);
    const g = this.add.graphics();
    g.fillStyle(COLORS.panel, 0.97);
    g.fillRoundedRect(0, 0, boxW, boxH, 10);
    g.lineStyle(2, color, 1);
    g.strokeRoundedRect(0, 0, boxW, boxH, 10);
    // Stem connecting the box to the chip.
    const sx = chipX - left;
    g.fillStyle(color, 1);
    if (above) {
      g.fillRect(sx - 2, boxH, 4, stem);
      g.fillTriangle(sx - 8, boxH - 1, sx + 8, boxH - 1, sx, boxH + 7);
    } else {
      g.fillRect(sx - 2, -stem, 4, stem);
      g.fillTriangle(sx - 8, 1, sx + 8, 1, sx, -7);
    }
    title.setPosition(textPad, textPad);
    body.setPosition(textPad, textPad + title.height + 6);
    layer.add([g, title, body]);
    g.setInteractive(new Phaser.Geom.Rectangle(0, 0, boxW, boxH), Phaser.Geom.Rectangle.Contains);
    g.on("pointerdown", () => this.closeStatInfo());

    // Grow out of the chip.
    layer.setAlpha(0).setY(top + (above ? 12 : -12));
    this.tweens.add({ targets: layer, alpha: 1, y: top, duration: 180, ease: "Cubic.easeOut" });

    this.statInfo = { key, chip, layer };
    chip.once("destroy", () => {
      if (this.statInfo?.layer === layer) this.closeStatInfo();
    });
  }

  closeStatInfo(): void {
    if (!this.statInfo) return;
    const { layer } = this.statInfo;
    this.statInfo = null;
    this.tweens.killTweensOf(layer);
    layer.destroy(true);
  }

  // One row of chips: synergy progress, active defends, temporary
  // buffs/debuffs and disabled synergies, each with turns remaining.
  // Shares the strip's bottom row with the ultimate meter (see maxX).
  drawEffectChips(container: Phaser.GameObjects.Container, fighter: Fighter, w: number, y: number, maxX: number): void {
    const chips: Array<{ text: string; color: number }> = [];

    // Statuses first: they're what most needs noticing.
    for (const [id, state] of Object.entries(fighter.statuses ?? {}) as Array<[StatusId, { potency: number; remaining: number }]>) {
      const potency = id === STATUS.WET || id === STATUS.BLIND ? "" : ` ${state.potency}`;
      chips.push({ text: `${STATUS_LABEL[id] ?? id}${potency} · ${state.remaining}t`, color: STATUS_COLOR[id] ?? CHIP_COLOR.down });
    }

    for (const synergy of fighter.classDef.synergyPool) {
      const count = fighter.cardsPlayedByCategory[synergy.countsCategory] ?? 0;
      const disabledFor = fighter.disabledSynergyTimers[synergy.id];
      if (disabledFor) {
        chips.push({ text: `${shortName(synergy.name)} off · ${disabledFor}t`, color: CHIP_COLOR.down });
        continue;
      }
      const reached = synergy.tiers.filter((t) => count >= t.count).length;
      const next = synergy.tiers.find((t) => count < t.count);
      const progress = next ? `${count}/${next.count}` : "max";
      chips.push({
        text: `${shortName(synergy.name)} ${reached > 0 ? `T${reached} ` : ""}${progress}`,
        color: reached > 0 ? CHIP_COLOR.synergyActive : CHIP_COLOR.synergy,
      });
    }

    for (const [type, { card, remaining }] of Object.entries(fighter.activeDefends)) {
      const defend = card as DefendCard;
      const amount = defend.mode === MODIFIER_MODE.PERCENT ? `${defend.amount * 100}%` : defend.amount;
      chips.push({ text: `Guard ${type} −${amount} · ${remaining}t`, color: CHIP_COLOR.guard });
    }

    for (const { effect, remaining } of fighter.tempModifiers) {
      // Only stat modifiers and regen end up here (see applyEffects).
      const positive =
        effect.kind === EFFECT_KIND.ENERGY_REGEN || (effect.kind === EFFECT_KIND.STAT_MODIFIER && effect.amount >= 0);
      chips.push({ text: `${describeEffect(effect)} · ${remaining}t`, color: positive ? CHIP_COLOR.up : CHIP_COLOR.down });
    }

    const h = 18;
    let x = STRIP_PAD;
    for (let i = 0; i < chips.length; i++) {
      const chip = chips[i];
      if (!chip) break;
      const text = this.add
        .text(0, y + h / 2, chip.text, { fontFamily: FONT_FAMILY, fontSize: "10px", fontStyle: "600", color: TEXT.white })
        .setOrigin(0, 0.5);
      const w = text.width + 14;
      const moreW = 34;
      if (x + w > maxX - (i < chips.length - 1 ? moreW : 0)) {
        text.destroy();
        container.add(
          this.add
            .text(x, y + h / 2, `+${chips.length - i}`, { fontFamily: FONT_FAMILY, fontSize: "11px", color: TEXT.muted })
            .setOrigin(0, 0.5)
        );
        break;
      }
      const bg = this.add.graphics();
      bg.fillStyle(chip.color, 1);
      bg.fillRoundedRect(x, y, w, h, h / 2);
      text.setX(x + 7);
      container.add([bg, text]);
      x += w + 6;
    }
  }

  drawUltimateMeter(container: Phaser.GameObjects.Container, fighter: Fighter, x0: number, y: number, w: number): void {
    const cost = fighter.classDef.ultimate.cost;
    const ready = canUseUltimate(fighter);
    let barX = x0;
    if (this.textures.exists(ULTIMATE_ICON_KEY)) {
      container.add(this.add.image(x0 + 7, y, ULTIMATE_ICON_KEY).setDisplaySize(16, 16));
      barX = x0 + 22;
    }
    const barW = w - (barX - x0) - 64;
    const g = this.add.graphics();
    g.fillStyle(COLORS.meterTrack, 1);
    g.fillRoundedRect(barX, y - 5, barW, 10, 5);
    const bw = barW * Math.min(1, fighter.ultimateMeter / cost);
    if (bw > 0) {
      g.fillStyle(ready ? COLORS.ultimateHover : COLORS.meterFill, 1);
      g.fillRoundedRect(barX, y - 5, bw, 10, Math.min(5, bw / 2));
    }
    container.add(g);

    const label = this.add
      .text(x0 + w - 8, y, ready ? "READY!" : `${fmt(fighter.ultimateMeter)}/${cost}`, {
        fontFamily: FONT_FAMILY,
        fontSize: ready ? "12px" : "11px",
        fontStyle: "800",
        color: ready ? "#ffd23f" : TEXT.muted,
      })
      .setOrigin(1, 0.5);
    container.add(label);
    if (ready) {
      this.tweens.add({ targets: label, alpha: 0.4, duration: 600, yoyo: true, repeat: -1 });
      label.once("destroy", () => this.tweens.killTweensOf(label));
    }
  }

  // AP this turn would spend on what's being looked at right now: the
  // previewed card, or the card / monster order whose target is being picked.
  pendingSpend(): number {
    const player = this.battle.player;
    const previewed = player.hand.find((c) => c.id === this.previewedCardId);
    if (previewed) return cardCost(previewed);
    const t = this.targeting;
    if (t?.kind === "card") return cardCost(t.card);
    if (t?.kind === "order") {
      const monster = player.field.find((m) => m.uid === t.uid);
      return monster ? orderCost(monster, t.use) : 0;
    }
    return 0;
  }

  // Your class badge under the player band: class icon, side label, name and
  // ultimate status, with the meter as a yellow ring around the edge.
  // Clicking it toggles the ultimate when it's usable.
  drawClassBadge(locked: boolean): void {
    const { w, h } = CLASS_BADGE;
    const c = this.classBadge;
    c.removeAll(true);
    const player = this.battle.player;
    const cost = player.classDef.ultimate.cost;
    const ready = canUseUltimate(player);
    const usable = !locked && (this.stagedUltimate || !checkPlan(player, this.staged, true, this.orders).problem);

    const bg = this.add.graphics();
    bg.fillStyle(UI_COLORS.panel, UI_COLORS.panelAlpha);
    bg.fillRoundedRect(0, 0, w, h, BADGE_RADIUS);
    if (ready) {
      bg.fillStyle(ULT_RING_LIVE, this.stagedUltimate ? 0.22 : 0.12);
      bg.fillRoundedRect(0, 0, w, h, BADGE_RADIUS);
    }
    bg.lineStyle(1, UI_COLORS.bronze, 0.28);
    bg.strokeRoundedRect(0.5, 0.5, w - 1, h - 1, BADGE_RADIUS);
    c.add(bg);

    // The meter: clockwise from top center, full = the whole edge.
    const ring = this.add.graphics();
    ring.lineStyle(ULT_RING_W, COLORS.meterTrack, 1);
    ring.strokeRoundedRect(0, 0, w, h, BADGE_RADIUS);
    const fill = Math.min(1, player.ultimateMeter / cost);
    if (fill > 0) {
      const points = roundedRectPath(w, h, BADGE_RADIUS, fill);
      ring.lineStyle(ULT_RING_W, ULT_RING_LIVE, 1);
      ring.strokePoints(points, fill >= 1, fill >= 1);
    }
    c.add(ring);

    if (ready) {
      // A copy of the full ring that grows out from the badge and fades, on
      // repeat, centered so it scales from the middle.
      const pulse = this.add.graphics({ x: w / 2, y: h / 2 });
      pulse.lineStyle(ULT_RING_W, ULT_RING_LIVE, 1);
      pulse.strokeRoundedRect(-w / 2, -h / 2, w, h, BADGE_RADIUS);
      this.tweens.add({ targets: pulse, scaleX: 1.08, scaleY: 1.12, alpha: { from: 0.9, to: 0 }, duration: 1100, repeat: -1 });
      pulse.once("destroy", () => this.tweens.killTweensOf(pulse));
      c.add(pulse);
    }

    const cx = w / 2;
    c.add(this.add.circle(cx, 52, 32, COLORS.meterTrack));
    c.add(this.add.circle(cx, 52, 33, 0x000000, 0).setStrokeStyle(1, UI_COLORS.bronze, 0.5));
    const iconKey = classIconKey(player.classDef.id);
    if (this.textures.exists(iconKey)) {
      c.add(this.add.image(cx, 52, iconKey).setDisplaySize(44, 44));
    }
    c.add(
      this.add
        .text(cx, 94, "CLASS", {
          fontFamily: FONT_FAMILY,
          fontSize: "8.5px",
          fontStyle: "600",
          color: UI_COLORS.faint,
        })
        .setLetterSpacing(1.6)
        .setOrigin(0.5, 0)
    );
    c.add(
      this.add.text(cx, 108, this.displayName(player), {
        fontFamily: FONT_DISPLAY,
        fontSize: "15px",
        fontStyle: "700",
        color: UI_COLORS.ivory,
        align: "center",
        wordWrap: { width: w - 24 },
      }).setOrigin(0.5, 0)
    );
    let ult: string;
    if (this.stagedUltimate) ult = "ULTIMATE ✓ · click to undo";
    else if (ready && usable) ult = "ULTIMATE READY · click";
    else if (ready) ult = "ULTIMATE READY";
    else ult = `ULT ${fmt(player.ultimateMeter)}/${cost}`;
    const ultText = this.add.text(0, 0, ult, {
      fontFamily: FONT_FAMILY,
      fontSize: "10.5px",
      fontStyle: "700",
      color: ready ? "#ffd23f" : UI_COLORS.muted,
    });
    const ultIcon = this.textures.exists(ULTIMATE_ICON_KEY)
      ? this.add.image(5, 5, ULTIMATE_ICON_KEY).setDisplaySize(10, 10).setTint(0xd8b95c)
      : null;
    const iconW = ultIcon ? 14 : 0;
    const ultGroup = this.add.container(cx - (iconW + ultText.width) / 2, 144);
    if (ultIcon) ultGroup.add(ultIcon);
    ultText.setPosition(iconW, 0);
    ultGroup.add(ultText);
    c.add(ultGroup);

    if (usable) {
      bg.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);
      bg.input!.cursor = "pointer";
      bg.on("pointerdown", () => this.onUltimateClick());
    }
  }

  // The preview's wide End turn bar: title, AP line, and one pip per AP.
  // Pips keep the ring's meaning -- lit = left, dark = spent, pulsing = the
  // cost of whatever the player is looking at.
  createEndTurnBar(): void {
    const { x, y, w, h } = END_TURN;
    const bar = this.add.container(x, y);
    this.endTurnBar = bar;

    const bg = this.add.graphics();
    bg.fillGradientStyle(0x1b1c20, 0x1b1c20, 0x0e0f11, 0x0e0f11, 1, 1, 1, 1);
    bg.fillRoundedRect(0, 0, w, h, 8);
    bg.lineStyle(1, UI_COLORS.bronze, 0.55);
    bg.strokeRoundedRect(0.5, 0.5, w - 1, h - 1, 8);
    bg.lineStyle(1, 0xffffff, 0.045);
    bg.lineBetween(10, 1.5, w - 10, 1.5);
    bar.add(bg);

    this.endTurnHover = this.add.graphics();
    this.endTurnHover.fillStyle(UI_COLORS.bronzeHi, 0.07);
    this.endTurnHover.fillRoundedRect(0, 0, w, h, 8);
    this.endTurnHover.setVisible(false);
    bar.add(this.endTurnHover);

    this.endTurnPips = this.add.container(w / 2, 15);
    bar.add(this.endTurnPips);

    this.endTurnTitle = this.add
      .text(w / 2, 25, "END TURN", {
        fontFamily: FONT_DISPLAY,
        fontSize: "12px",
        fontStyle: "700",
        color: UI_COLORS.ivory,
      })
      .setLetterSpacing(1.4)
      .setOrigin(0.5, 0);
    bar.add(this.endTurnTitle);

    this.endTurnSub = this.add
      .text(w / 2, 44, "", {
        fontFamily: FONT_FAMILY,
        fontSize: "9.5px",
        fontStyle: "500",
        color: UI_COLORS.muted,
      })
      .setOrigin(0.5, 0);
    bar.add(this.endTurnSub);

    const hit = this.add.zone(0, 0, w, h).setOrigin(0).setInteractive({ useHandCursor: true });
    this.endTurnHit = hit;
    bar.add(hit);
    hit.on("pointerover", () => this.endTurnEnabled && this.endTurnHover.setVisible(true));
    hit.on("pointerout", () => this.endTurnHover.setVisible(false));
    hit.on("pointerdown", () => {
      if (this.endTurnEnabled) this.onEndTurnClick();
    });
  }

  updateEndTurnBar(locked: boolean): void {
    const player = this.battle.player;
    const max = player.maxAp ?? player.ap;
    const planning = !this.pendingTurn && this.canAct();
    const left = planning ? this.plannedAp() : player.ap;
    const preview = planning ? Math.min(left, this.pendingSpend()) : 0;
    const plays = this.staged.length + (this.stagedUltimate ? 1 : 0) + this.orders.length;

    this.endTurnEnabled = !locked;
    this.endTurnBar.setAlpha(locked ? 0.5 : 1);
    this.endTurnSub.setText(plays > 0 ? `${left} AP this turn · ${plays} staged` : `${left} AP this turn`);
    this.endTurnPips.removeAll(true);

    const gap = 9;
    const startX = -((max - 1) * gap) / 2;
    for (let i = 0; i < max; i++) {
      const pip = this.add.graphics({ x: startX + i * gap, y: 0 });
      const lit = i < left;
      const spending = lit && i >= left - preview;
      pip.fillStyle(lit ? AP_RING_LIVE : AP_RING_SPENT, 1);
      pip.fillPoints(
        [
          new Phaser.Math.Vector2(0, -3),
          new Phaser.Math.Vector2(3, 0),
          new Phaser.Math.Vector2(0, 3),
          new Phaser.Math.Vector2(-3, 0),
        ],
        true
      );
      if (spending) {
        this.tweens.add({ targets: pip, alpha: 0.35, duration: 380, yoyo: true, repeat: -1 });
        pip.once("destroy", () => this.tweens.killTweensOf(pip));
      }
      this.endTurnPips.add(pip);
    }

    if (locked) this.endTurnHit.disableInteractive();
    else this.endTurnHit.setInteractive({ useHandCursor: true });
  }

  renderHand(locked: boolean): void {
    this.handContainer.removeAll(true);
    // Picked cards have moved onto the arena slot.
    const stagedIds = new Set(this.staged.map((c) => c.id));
    const cards = this.battle.player.hand.filter((c) => !stagedIds.has(c.id) && c.id !== this.previewedCardId);
    // Between the class badge on the left and the right edge of the board;
    // a hand too big for that squeezes its overlap instead of covering them.
    const minX = CLASS_BADGE.x + CLASS_BADGE.w + 8;
    const maxX = STRIP_X + STRIP_W - 8;
    let step = CARD_W - FAN_OVERLAP;
    if (cards.length > 1 && (cards.length - 1) * step + CARD_W > maxX - minX) {
      step = (maxX - minX - CARD_W) / (cards.length - 1);
    }
    const totalW = cards.length > 0 ? (cards.length - 1) * step + CARD_W : 0;
    // Centered on the board, shifted aside if it would reach the badge or ring.
    const x0 = Math.max(minX, Math.min((minX + maxX) / 2 - totalW / 2, maxX - totalW));
    cards.forEach((card, i) => this.drawHandCard(card, x0 + i * step, locked));
  }

  // Face data for a hand card, with its cost gem red when this turn's AP
  // left can't pay for it.
  handFace(card: Card): CardFaceData {
    return { ...cardFaceData(card), costShort: !this.pendingTurn && cardCost(card) > this.plannedAp() };
  }

  drawHandCard(card: Card, x: number, locked: boolean): void {
    const { container: cardContainer, bg } = drawCardFace(this, this.handFace(card), CARD_W, CARD_H);
    cardContainer.setPosition(x, 0);
    if (locked) {
      cardContainer.setAlpha(0.5);
      bg.disableInteractive();
    } else {
      // Can't be paid for after what's already picked: dimmed, but it can
      // still be opened to read (the preview says why it can't be played).
      if (unplayableReason(this.battle.player, card, this.staged, this.orders)) cardContainer.setAlpha(0.55);
      // Hover expands the card, growing up from its bottom edge.
      bg.on("pointerover", (pointer: Phaser.Input.Pointer) => {
        if (pointer.wasTouch) return;
        this.handContainer.bringToTop(cardContainer);
        this.tweens.killTweensOf(cardContainer);
        this.tweens.add({
          targets: cardContainer,
          x: x - (CARD_W * (HOVER_SCALE - 1)) / 2,
          y: -HOVER_LIFT - CARD_H * (HOVER_SCALE - 1),
          scale: HOVER_SCALE,
          duration: 100,
        });
      });
      bg.on("pointerout", () => {
        this.tweens.killTweensOf(cardContainer);
        this.tweens.add({ targets: cardContainer, x, y: 0, scale: 1, duration: 100 });
      });
      bg.on("pointerdown", () => this.onCardClick(card.id));
    }
    this.handContainer.add(cardContainer);
  }

  // The previewed card, full size in the middle of the screen over a dimmed
  // board: click it to play it, click anywhere else to put it back.
  drawPreview(locked: boolean): void {
    this.previewLayer.removeAll(true);
    const card = this.battle.player.hand.find((c) => c.id === this.previewedCardId);
    if (!card || locked) return;

    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x060607, 0.6).setOrigin(0, 0).setInteractive();
    dim.on("pointerdown", () => this.dismissPreview());
    this.previewLayer.add(dim);

    const w = CARD_W * PREVIEW_SCALE;
    const h = CARD_H * PREVIEW_SCALE;
    const x = GAME_WIDTH / 2 - w / 2;
    const y = GAME_HEIGHT / 2 - h / 2 - 20;
    const { container, bg } = drawCardFace(this, this.handFace(card), w, h, { scale: PREVIEW_SCALE });
    const ring = this.add.graphics();
    ring.lineStyle(4, PREVIEW_RING, 1);
    ring.strokeRoundedRect(-7, -7, w + 14, h + 14, 16);
    container.add(ring);
    bg.on("pointerdown", () => this.confirmPreview());
    this.previewLayer.add(container);

    const reason = unplayableReason(this.battle.player, card, this.staged, this.orders);
    const after = checkPlan(this.battle.player, [...this.staged, card], false, this.orders).ap;
    const aim = cardNeedsTarget(card) && this.battle.cpu.field.length > 0 ? " -- then pick its target" : "";
    const hint = reason
      ? `Can't play this now: ${reason}.\nClick anywhere to put it back.`
      : `Click the card to play it (AP ${this.plannedAp()} → ${after})${aim}.\nClick anywhere else to put it back.`;
    this.previewLayer.add(
      textShadow(
        this.add
          .text(GAME_WIDTH / 2, y + h + 22, hint, {
            fontFamily: FONT_FAMILY,
            fontSize: "15px",
            fontStyle: "700",
            color: reason ? "#ff8a80" : TEXT.white,
            align: "center",
          })
          .setOrigin(0.5, 0)
      )
    );

    // Pop in from slightly smaller, centered.
    container.setAlpha(0).setScale(0.85).setPosition(x + (w * 0.15) / 2, y + (h * 0.15) / 2);
    this.tweens.add({ targets: container, alpha: 1, scale: 1, x, y, duration: 140, ease: "Back.easeOut" });
  }

  // Picking a target: the board dims, and every legal target on the enemy
  // side (their fighter band and their monsters) lights up
  // to be clicked. A guard monster has to be picked first. Clicking anywhere
  // else cancels.
  drawTargeting(): void {
    const targeting = this.targeting;
    if (!targeting) return;
    const opponent = this.battle.cpu;
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x060607, 0.55).setOrigin(0, 0).setInteractive();
    dim.on("pointerdown", () => this.dismissPreview());
    this.previewLayer.add(dim);

    const box = (x: number, y: number, w: number, h: number, target: Target): void => {
      const legal = !targetProblem(opponent, target);
      const g = this.add.graphics();
      if (legal) {
        g.fillStyle(0xff5a4f, 0.16);
        g.fillRoundedRect(x, y, w, h, 10);
        g.lineStyle(3, 0xff5a4f, 1);
        g.strokeRoundedRect(x, y, w, h, 10);
        g.setInteractive(new Phaser.Geom.Rectangle(x, y, w, h), Phaser.Geom.Rectangle.Contains);
        g.on("pointerdown", () => this.chooseTarget(target));
        this.tweens.add({ targets: g, alpha: 0.55, duration: 500, yoyo: true, repeat: -1 });
        g.once("destroy", () => this.tweens.killTweensOf(g));
      } else {
        g.fillStyle(0x060607, 0.45);
        g.fillRoundedRect(x, y, w, h, 10);
      }
      this.previewLayer.add(g);
    };
    box(STRIP_X, CPU_STRIP_Y, STRIP_W, STRIP_H, { kind: "fighter" });
    opponent.field.forEach((monster, i) => {
      const pos = this.monsterPos("cpu", i);
      box(pos.x - 3, pos.y - 3, MONSTER_W + 6, MONSTER_H + 6, { kind: "monster", uid: monster.uid });
    });

    let what: string;
    if (targeting.kind === "card") {
      what = targeting.card.name;
    } else {
      const monster = this.battle.player.field.find((m) => m.uid === targeting.uid);
      what = `${monster?.name ?? "your monster"}'s ${targeting.use === "attack" ? "attack" : (monster?.ability?.name ?? "ability")}`;
    }
    const guard = opponent.field.some((m) => m.guard) ? "\nA guard monster is in the way: it has to be hit first." : "";
    this.previewLayer.add(
      textShadow(
        this.add
          .text(GAME_WIDTH / 2, 470, `Choose a target for ${what}.${guard}\nClick anywhere else to cancel.`, {
            fontFamily: FONT_FAMILY,
            fontSize: "16px",
            fontStyle: "800",
            color: TEXT.white,
            align: "center",
          })
          .setOrigin(0.5, 0)
      )
    );
  }

  // Your monster's command menu: attack, its ability, or cancel -- each
  // with its AP cost, greyed out when this turn can't pay for it.
  drawMonsterMenu(): void {
    const player = this.battle.player;
    const index = player.field.findIndex((m) => m.uid === this.monsterMenuUid);
    const monster = player.field[index];
    if (!monster) return;
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x060607, 0.45).setOrigin(0, 0).setInteractive();
    dim.on("pointerdown", () => this.dismissPreview());
    this.previewLayer.add(dim);

    const w = 236;
    const ability = monster.ability;
    const h = ability ? 214 : 150;
    const pos = this.monsterPos("player", index);
    const x = Math.max(STRIP_X, pos.x + MONSTER_W / 2 - w / 2 - 120);
    const y = FIELD_Y - 10;
    const panel = this.add.graphics();
    panel.fillStyle(COLORS.panel, 0.98);
    panel.fillRoundedRect(x, y, w, h, 12);
    panel.lineStyle(2, PREVIEW_RING, 1);
    panel.strokeRoundedRect(x, y, w, h, 12);
    panel.setInteractive(new Phaser.Geom.Rectangle(x, y, w, h), Phaser.Geom.Rectangle.Contains); // clicks on the panel don't cancel
    this.previewLayer.add(panel);
    this.previewLayer.add(
      this.add.text(x + 14, y + 10, monster.name, { fontFamily: FONT_FAMILY, fontSize: "15px", fontStyle: "800", color: TEXT.white })
    );
    this.previewLayer.add(
      this.add.text(x + 14, y + 31, `${Math.ceil(monster.hp)}/${monster.maxHp} HP · ATK ${monster.atk} · SPD ${monster.speed}`, {
        fontFamily: FONT_FAMILY,
        fontSize: "11px",
        color: TEXT.muted,
      })
    );

    const affordable = (use: MonsterOrder["use"]): boolean =>
      !checkPlan(player, this.staged, false, [...this.orders, { uid: monster.uid, use, target: null }]).problem;
    let by = y + 52;
    const option = (label: string, enabled: boolean, onClick: () => void, color: number, hover: number): void => {
      const button = createButton(this, x + 14, by, w - 28, 34, label, { color, hoverColor: hover, onClick });
      button.setEnabled(enabled);
      this.previewLayer.add(button.container);
      by += 42;
    };
    option(`Attack (${monster.atk} dmg) — ${orderCost(monster, "attack")} AP`, affordable("attack"), () => this.giveOrder(monster, "attack"), 0xb5423a, 0xcc5a50);
    if (ability) {
      option(`${ability.name} — ${ability.cost} AP`, affordable("ability"), () => this.giveOrder(monster, "ability"), 0x6a4a94, 0x8060aa);
      this.previewLayer.add(
        this.add.text(x + 14, by - 6, describeAbility(ability) + (ability.target === "self" ? " (on you)" : ""), {
          fontFamily: FONT_FAMILY,
          fontSize: "11px",
          color: TEXT.muted,
          wordWrap: { width: w - 28 },
        })
      );
      by += 22;
    }
    option("Cancel", true, () => this.dismissPreview(), COLORS.restart, COLORS.restartHover);
  }

  // Face-down card for the opponent's slot while a sent turn resolves.
  drawCardBack(): Phaser.GameObjects.Container {
    const container = this.add.container(0, 0);
    const g = this.add.graphics();
    g.fillStyle(0x1a1b1e, 1);
    g.fillRoundedRect(0, 0, CARD_W, CARD_H, 10);
    g.lineStyle(3, 0xc49b3a, 1);
    g.strokeRoundedRect(0, 0, CARD_W, CARD_H, 10);
    const q = this.add
      .text(CARD_W / 2, CARD_H / 2, "?", {
        fontFamily: FONT_FAMILY,
        fontSize: "40px",
        fontStyle: "800",
        color: "#c49b3a",
      })
      .setOrigin(0.5);
    container.add([g, q]);
    return container;
  }

  // Arena slots. Yours holds the cards picked this turn (shrunk and fanned;
  // click one to take it back) -- only this client sees them. Once the turn
  // is sent, the opponent's slot shows a face-down card until the recap.
  drawSlots(): void {
    this.slotsContainer.removeAll(true);
    const pending = this.pendingTurn;
    const stagedCount = pending ? 0 : this.staged.length + (this.stagedUltimate ? 1 : 0);
    const muted = (x: number, text: string): Phaser.GameObjects.Text =>
      this.add
        .text(x + SLOT_W / 2, SLOT_Y + SLOT_H / 2, text, { fontFamily: FONT_FAMILY, fontSize: "11px", color: TEXT.muted, align: "center" })
        .setOrigin(0.5);
    const sides: Array<{ key: "player" | "cpu"; x: number }> = [
      { key: "cpu", x: PLAY_ZONE_CX - SLOT_TOTAL_W / 2 },
      { key: "player", x: PLAY_ZONE_CX + SLOT_TOTAL_W / 2 - SLOT_W },
    ];
    for (const { key, x } of sides) {
      const frame = this.add.graphics();
      frame.fillStyle(0x0a0b0c, 0.2);
      frame.fillRoundedRect(x, SLOT_Y, SLOT_W, SLOT_H, 8);
      frame.lineStyle(1, UI_COLORS.bronze, 0.3);
      frame.strokeRoundedRect(x + 0.5, SLOT_Y + 0.5, SLOT_W - 1, SLOT_H - 1, 8);
      this.slotsContainer.add(frame);

      if (key === "cpu") {
        if (pending) {
          const back = this.drawCardBack();
          back.setPosition(x + (SLOT_W - CARD_W) / 2, SLOT_Y + (SLOT_H - CARD_H) / 2);
          this.slotsContainer.add(back);
        } else {
          this.slotsContainer.add(muted(x, "—"));
        }
        continue;
      }

      const cards = pending ? pending.cards : this.staged;
      const ultimate = pending ? pending.ultimate : this.stagedUltimate;
      const faces: Array<{ data: CardFaceData; cardId: number | null }> = cards.map((c) => ({ data: cardFaceData(c), cardId: c.id }));
      if (ultimate) {
        faces.push({ data: { category: "ultimate", name: ultimateName(this.battle.player.classDef), description: "" }, cardId: null });
      }
      if (faces.length === 0) {
        if (pending) {
          this.slotsContainer.add(muted(x, "Pass"));
        } else {
          const cx = x + SLOT_W / 2;
          const cy = SLOT_Y + SLOT_H / 2;
          this.slotsContainer.add(
            this.add
              .text(cx, cy - 8, "+", {
                fontFamily: FONT_FAMILY,
                fontSize: "22px",
                fontStyle: "400",
                color: UI_COLORS.gold,
              })
              .setAlpha(0.45)
              .setOrigin(0.5)
          );
          this.slotsContainer.add(
            this.add
              .text(cx, cy + 14, "STAGE", {
                fontFamily: FONT_FAMILY,
                fontSize: "7.5px",
                fontStyle: "600",
                color: UI_COLORS.faint,
              })
              .setLetterSpacing(1.4)
              .setOrigin(0.5, 0)
          );
        }
        continue;
      }
      const w = CARD_W * STAGE_SCALE;
      const h = CARD_H * STAGE_SCALE;
      const step = faces.length > 1 ? Math.min(w + 4, (SLOT_W - 10 - w) / (faces.length - 1)) : 0;
      const x0 = x + (SLOT_W - (w + step * (faces.length - 1))) / 2;
      faces.forEach(({ data, cardId }, i) => {
        const { container, bg } = drawCardFace(this, data, w, h, { scale: STAGE_SCALE });
        container.setPosition(x0 + i * step, SLOT_Y + (SLOT_H - h) / 2 + 8);
        if (!pending && this.canAct()) {
          bg.on("pointerdown", () => (cardId === null ? this.onUltimateClick() : this.unstage(cardId)));
        } else {
          bg.disableInteractive();
        }
        this.slotsContainer.add(container);
        const target = cardId !== null && !pending ? this.stagedTargets[cardId] : undefined;
        if (target) {
          this.slotsContainer.add(
            this.add
              .text(x0 + i * step + w / 2, SLOT_Y + (SLOT_H - h) / 2 + 8 + h + 3, `→ ${this.targetName(target)}`, {
                fontFamily: FONT_FAMILY,
                fontSize: "9px",
                fontStyle: "800",
                color: "#ffd23f",
                stroke: "#000000",
                strokeThickness: 2,
              })
              .setOrigin(0.5, 0)
          );
        }
      });
    }

    const caption = pending
      ? "SENT"
      : stagedCount > 0
        ? `${stagedCount} STAGED · CLICK THE CARD TO TAKE IT BACK`
        : "STAGE · CLICK A CARD TO STAGE IT";
    this.slotsContainer.add(
      this.add
        .text(PLAY_ZONE_CX, SLOT_Y + SLOT_H + 8, caption, {
          fontFamily: FONT_FAMILY,
          fontSize: "8px",
          fontStyle: "600",
          color: UI_COLORS.faint,
        })
        .setLetterSpacing(1.2)
        .setOrigin(0.5, 0)
    );
  }

  // Both monster fields, flanking the central play zone.
  drawFields(): void {
    this.fieldContainer.removeAll(true);
    const sides: Array<{ fighter: Fighter; x: number; label: string }> = [
      { fighter: this.battle.cpu, x: CPU_FIELD_X, label: `${this.opponentLabel} field` },
      { fighter: this.battle.player, x: PLAYER_FIELD_X, label: "Your field" },
    ];
    for (const { fighter, x, label } of sides) {
      const field = fighter.field ?? [];
      const backing = this.add.graphics();
      backing.fillStyle(0x0c0d0e, 0.55);
      backing.fillRoundedRect(x, FIELD_Y, FIELD_W, FIELD_H, 10);
      backing.lineStyle(1, UI_COLORS.edge, 0.95);
      backing.strokeRoundedRect(x + 0.5, FIELD_Y + 0.5, FIELD_W - 1, FIELD_H - 1, 10);
      this.fieldContainer.add(backing);
      this.fieldContainer.add(
        this.add
          .text(x + 10, FIELD_Y + 7, label.toUpperCase(), {
            fontFamily: FONT_FAMILY,
            fontSize: "8.5px",
            fontStyle: "600",
            color: UI_COLORS.faint,
          })
          .setLetterSpacing(1.3)
      );
      this.fieldContainer.add(
        this.add
          .text(x + FIELD_W - 10, FIELD_Y + 7, `${field.length} / ${FIELD_SIZE}`, {
            fontFamily: FONT_FAMILY,
            fontSize: "8.5px",
            fontStyle: "600",
            color: UI_COLORS.faint,
          })
          .setLetterSpacing(1.1)
          .setOrigin(1, 0)
      );

      // Three sockets, like the preview: dashed bronze edges and a faint paw
      // mark so the field reads as a place for monsters before one arrives.
      const socketW = 66;
      const socketGap = 9;
      const socketY = FIELD_Y + 36;
      const socketH = 132;
      for (let i = 0; i < FIELD_SIZE; i++) {
        const sx = x + 9 + i * (socketW + socketGap);
        const socket = this.add.graphics();
        socket.fillStyle(0x0a0b0c, 0.2);
        socket.fillRoundedRect(sx, socketY, socketW, socketH, 7);
        socket.lineStyle(1, UI_COLORS.bronze, 0.3);
        const dash = 5;
        const step = 9;
        for (let px = sx; px < sx + socketW; px += step) {
          const ex = Math.min(px + dash, sx + socketW);
          socket.lineBetween(px, socketY, ex, socketY);
          socket.lineBetween(px, socketY + socketH, ex, socketY + socketH);
        }
        for (let py = socketY; py < socketY + socketH; py += step) {
          const ey = Math.min(py + dash, socketY + socketH);
          socket.lineBetween(sx, py, sx, ey);
          socket.lineBetween(sx + socketW, py, sx + socketW, ey);
        }
        this.fieldContainer.add(socket);

        if (!field[i]) {
          const cx = sx + socketW / 2;
          const cy = socketY + socketH / 2;
          const paw = this.add.graphics();
          paw.fillStyle(0x9a9da3, 0.5);
          paw.fillEllipse(cx, cy + 4, 11, 8);
          paw.fillCircle(cx - 6, cy - 3, 2.2);
          paw.fillCircle(cx - 2, cy - 7, 2.2);
          paw.fillCircle(cx + 2, cy - 7, 2.2);
          paw.fillCircle(cx + 6, cy - 3, 2.2);
          this.fieldContainer.add(paw);
          this.fieldContainer.add(
            this.add
              .text(cx, cy + 16, "EMPTY", {
                fontFamily: FONT_FAMILY,
                fontSize: "7.5px",
                fontStyle: "600",
                color: UI_COLORS.faint,
              })
              .setLetterSpacing(1.2)
              .setAlpha(0.85)
              .setOrigin(0.5, 0)
          );
        }
      }

      if (field.length === 0) {
        this.fieldContainer.add(
          this.add
            .text(x + FIELD_W / 2, FIELD_Y + FIELD_H - 18, "No monsters yet", {
              fontFamily: FONT_FAMILY,
              fontSize: "8px",
              fontStyle: "500",
              color: UI_COLORS.faint,
            })
            .setOrigin(0.5)
            .setAlpha(0.8)
        );
      }
      field.forEach((monster, i) => {
        const pos = this.monsterPos(fighter === this.battle.player ? "player" : "cpu", i);
        this.drawMonster(monster, pos.x, pos.y, !monster.ready, fighter === this.battle.player);
      });
    }
  }

  // Top-left of the i-th monster token on a side's field.
  monsterPos(key: "player" | "cpu", index: number): { x: number; y: number } {
    const x = key === "cpu" ? CPU_FIELD_X : PLAYER_FIELD_X;
    return { x: x + index * (MONSTER_W + MONSTER_GAP), y: FIELD_Y + 26 };
  }

  targetName(target: Target): string {
    if (target.kind === "fighter") return this.opponentLabel;
    return this.battle.cpu.field.find((m) => m.uid === target.uid)?.name ?? "monster";
  }

  // One monster token: art, name, HP bar, ATK/SPD, and a blue frame for a
  // guard. `fresh`: summoned this round, so it can only act from the next
  // one. Your own ready monsters are clickable (command menu); one with an
  // order this turn gets a gold frame and says what it'll do.
  drawMonster(monster: Monster, x: number, y: number, fresh: boolean, own: boolean): void {
    const c = this.add.container(x, y);
    const order = own && !this.pendingTurn ? this.orders.find((o) => o.uid === monster.uid) : undefined;
    const g = this.add.graphics();
    g.fillStyle(COLORS.card.monster, 1);
    g.fillRoundedRect(0, 0, MONSTER_W, MONSTER_H, 8);
    if (monster.guard) {
      g.lineStyle(3, MONSTER_GUARD, 1);
      g.strokeRoundedRect(1.5, 1.5, MONSTER_W - 3, MONSTER_H - 3, 8);
    }
    if (order || this.monsterMenuUid === monster.uid) {
      g.lineStyle(3, PREVIEW_RING, 1);
      g.strokeRoundedRect(-2, -2, MONSTER_W + 4, MONSTER_H + 4, 10);
    }
    if (own && this.canAct() && !this.pendingTurn) {
      g.setInteractive(new Phaser.Geom.Rectangle(0, 0, MONSTER_W, MONSTER_H), Phaser.Geom.Rectangle.Contains);
      g.on("pointerdown", () => this.onMonsterClick(monster));
    }
    c.add(g);
    if (order) {
      // One short line under the token: "ATK → Skeleton", "Fortify".
      const what = order.use === "attack" ? "ATK" : (monster.ability?.name ?? "Ability");
      const name = order.target ? this.targetName(order.target) : "";
      const aim = order.target ? ` → ${name.length > 9 ? `${name.slice(0, 8)}…` : name}` : "";
      c.add(
        this.add
          .text(MONSTER_W / 2, MONSTER_H + 2, `${what}${aim}`, {
            fontFamily: FONT_FAMILY,
            fontSize: "9px",
            fontStyle: "800",
            color: "#ffd23f",
            stroke: "#000000",
            strokeThickness: 3,
          })
          .setOrigin(0.5, 0)
      );
    }

    const artW = MONSTER_W - 8;
    const artH = Math.round(artW * 0.75);
    const box = this.add.graphics();
    box.fillStyle(COLORS.background, 0.45);
    box.fillRoundedRect(4, 4, artW, artH, 6);
    c.add(box);
    const artKey = loadedArtKey(this, monster.cardId);
    if (artKey) {
      c.add(this.add.image(4 + artW / 2, 4 + artH / 2, artKey).setDisplaySize(artW - 2, artH - 2));
    } else if (this.textures.exists(CARD_ICON_KEY.monster)) {
      c.add(this.add.image(4 + artW / 2, 4 + artH / 2, CARD_ICON_KEY.monster).setDisplaySize(30, 30));
    }

    c.add(
      this.add
        .text(MONSTER_W / 2, artH + 7, monster.name, {
          fontFamily: FONT_FAMILY,
          fontSize: "10px",
          fontStyle: "700",
          color: TEXT.white,
          align: "center",
          wordWrap: { width: MONSTER_W - 6 },
        })
        .setOrigin(0.5, 0)
    );

    const tags = [monster.guard ? "GUARD" : "", fresh ? "NEW" : ""].filter(Boolean).join(" · ");
    if (tags) {
      c.add(
        this.add
          .text(MONSTER_W / 2, MONSTER_H - 48, tags, { fontFamily: FONT_FAMILY, fontSize: "9px", fontStyle: "800", color: monster.guard ? "#8fd3ff" : "#ffe9a8" })
          .setOrigin(0.5, 0)
      );
    }

    const barX = 5;
    const barW = MONSTER_W - 10;
    const barY = MONSTER_H - 34;
    const bar = this.add.graphics();
    bar.fillStyle(COLORS.meterTrack, 1);
    bar.fillRoundedRect(barX, barY, barW, 12, 5);
    const pct = Phaser.Math.Clamp(monster.hp / monster.maxHp, 0, 1);
    if (pct > 0) {
      bar.fillStyle(hpColor(pct), 1);
      bar.fillRoundedRect(barX, barY, barW * pct, 12, Math.min(5, (barW * pct) / 2));
    }
    c.add(bar);
    c.add(
      this.add
        .text(MONSTER_W / 2, barY + 6, `${Math.ceil(monster.hp)}/${monster.maxHp}`, {
          fontFamily: FONT_FAMILY,
          fontSize: "9px",
          fontStyle: "800",
          color: TEXT.white,
          stroke: "#000000",
          strokeThickness: 2,
        })
        .setOrigin(0.5)
    );
    c.add(
      this.add
        .text(MONSTER_W / 2, MONSTER_H - 17, `ATK ${monster.atk} · SPD ${monster.speed}`, {
          fontFamily: FONT_FAMILY,
          fontSize: "9px",
          fontStyle: "700",
          color: TEXT.white,
        })
        .setOrigin(0.5, 0)
    );
    if (fresh) c.setAlpha(0.8);
    this.fieldContainer.add(c);
  }

  renderLog(): void {
    this.logContainer.removeAll(true);

    const bodyStyle = {
      fontFamily: FONT_FAMILY,
      fontSize: "11px",
      color: UI_COLORS.body,
      wordWrap: { width: LOG_W - 20 },
      lineSpacing: 1,
    };
    const roundStyle = {
      fontFamily: FONT_DISPLAY,
      fontSize: "9px",
      fontStyle: "700",
      color: UI_COLORS.goldHi,
    };
    const roundLine = /^-- Round (\d+) --$/;
    const items = this.battle.log
      .slice()
      .reverse()
      .map((line) => {
        const match = line.match(roundLine);
        if (match) {
          const probe = this.add.text(0, 0, `ROUND ${match[1]}`, roundStyle);
          const h = probe.height + 12;
          probe.destroy();
          return { line, round: match[1], height: h };
        }
        const probe = this.add.text(0, 0, line, bodyStyle);
        const h = probe.height;
        probe.destroy();
        return { line, round: null, height: h };
      });

    // Measure every entry offscreen first: at 256px wide each line wraps to
    // a different height, so entries advance by measured height, never a
    // fixed step (which piled wrapped lines onto each other).
    const heights = items.map((item) => item.height);
    let totalH = heights.reduce((sum, h) => sum + h + LOG_ENTRY_GAP, 0);
    if (heights.length > 0) totalH -= LOG_ENTRY_GAP;
    this.logTotalHeight = totalH;

    this.logMaxScrollIndex = Math.max(0, totalH - LOG_H);
    if (this.logFollow) this.logScrollIndex = this.logMaxScrollIndex;
    else this.logScrollIndex = Phaser.Math.Clamp(this.logScrollIndex, 0, this.logMaxScrollIndex);

    let y = -this.logScrollIndex;
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const h = heights[i] as number;
      if (y + h >= 0 && y <= LOG_H) {
        if (item.round) {
          const headerY = y + 4;
          const header = this.add
            .text(0, headerY, `ROUND ${item.round}`, roundStyle)
            .setLetterSpacing(1.4);
          this.logContainer.add(header);
          const divider = this.add.graphics();
          divider.lineStyle(1, UI_COLORS.bronze, 0.42);
          divider.lineBetween(0, headerY + header.height + 4, LOG_W - 20, headerY + header.height + 4);
          this.logContainer.add(divider);
        } else {
          this.logContainer.add(this.add.text(0, y, item.line, bodyStyle));
        }
      }
      y += h + LOG_ENTRY_GAP;
    }

    this.updateLogScrollbar();
  }
}
