// Battle screen: renders src/model/engine.js's battle state and turns clicks
// into playRound() calls. Every render() call wipes and rebuilds the dynamic
// containers (fighter panels, hand, log) rather than diffing them -- this is
// a low-frequency turn-based UI, so that's simpler and it's what the DOM
// version (src/app.js) did too via innerHTML = "".
//
// After each round resolves, the round recap (roundRecap.js) replays both
// fighters' actions with animation and narration before the new state is
// shown; HP bars count down as the hits land.

import Phaser from "phaser";
import {
  computeCurrentStats,
  canUseUltimate,
  createBattle,
  cardAction,
  ultimateAction,
  playRound,
  describeCard,
  describeEffect,
  isBattleOver,
  fighterName,
} from "../model/engine.js";
import { EFFECT_KIND, MODIFIER_MODE } from "../model/effects.js";
import { RESIST_STAT } from "../model/damageTypes.js";
import { allCards, allClasses } from "../model/catalog.js";
import { preloadIcons, classIconKey, ULTIMATE_ICON_KEY, CARD_ICON_KEY } from "../phaserIcons.js";
import { loadCardArt } from "../cardArt.js";
import { isMuted, setMuted } from "../fx/sound.js";
import { COLORS, TEXT, FONT_FAMILY, roundedRect, createButton, useRenderScale } from "./theme.js";
import { drawCardFace } from "./cardFace.js";
import { playRoundRecap } from "./roundRecap.js";

const PANEL_Y = 44;
const PANEL_W = 420;
const PANEL_H = 200;
const CPU_X = 40;
const PLAYER_X = 500;
const PANEL_PAD = 16;
const BAR_W = PANEL_W - PANEL_PAD * 2;

const HAND_Y = 296;
const CARD_W = 112;
const CARD_H = 160;
const CARD_GAP = 14;

const BUTTON_ROW_Y = 466;
const LOG_X = 30;
const LOG_Y = 548;
const LOG_W = 900;
const LOG_H = 192;
const LOG_LINE_HEIGHT = 20;
const LOG_VISIBLE_LINES = Math.floor(LOG_H / LOG_LINE_HEIGHT);

// The band the round recap covers: status line, hand and buttons.
const RECAP_STAGE = { y: PANEL_Y + PANEL_H + 4, h: BUTTON_ROW_Y + 48 - (PANEL_Y + PANEL_H + 4) };

const STAT_CHIPS = [
  { key: "def", label: "DEF", color: 0xc9c9c9 },
  { key: "mr", label: "MR", color: 0xb388ff },
  { key: "er", label: "ER", color: 0xff9d4d },
  { key: "ur", label: "UR", color: 0xffe066 },
];

const CHIP_COLOR = {
  guard: 0x2f6f8f,
  up: 0x3a8f5a,
  down: 0x8a3a52,
  synergy: 0x4a5573,
  synergyActive: 0xa8842f,
};

const GUARD_COLOR = 0x6ec6ff;

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const shortName = (name) => name.replace(/\s*\(.*\)\s*$/, "");

function hpColor(pct) {
  if (pct > 0.5) return 0x4caf6a;
  if (pct > 0.25) return 0xe0a030;
  return 0xd9483b;
}

// "+5" for a flat guard, "30%" for a percent one.
function guardAmount(card) {
  return card.mode === MODIFIER_MODE.PERCENT ? `${Math.round(card.amount * 100)}%` : `+${fmt(card.amount)}`;
}

function ultimateName(classDef) {
  const name = classDef.ultimate.name;
  return name && name !== "TBD" ? name : "Ultimate";
}

// vs-CPU battle. OnlineBattleScene (src/scenes/OnlineBattleScene.js) reuses
// all of the drawing below and only overrides the hooks in the "battle
// source" section: where the battle comes from, what a click does, and the
// status line.
export class BattleScene extends Phaser.Scene {
  constructor(key = "BattleScene") {
    super(key);
  }

  preload() {
    preloadIcons(this, allClasses());
  }

  // --- battle source (overridden by OnlineBattleScene) ---------------------

  setupBattle(data) {
    const playerClass = data.playerClass;
    const cpuClass = allClasses().find((c) => c.id !== playerClass.id) ?? playerClass;
    return createBattle(playerClass, cpuClass);
  }

  get playerLabel() {
    return "Player";
  }

  get opponentLabel() {
    return "CPU";
  }

  get leaveLabel() {
    return "Restart";
  }

  // Whether the hand/ultimate should take clicks right now.
  canAct() {
    return !isBattleOver(this.battle) && !this.recapPlaying;
  }

  commitAction(action) {
    const before = this.currentHp();
    playRound(this.battle, action);
    this.presentRound(before);
  }

  onLeave() {
    this.scene.start("ClassSelectScene");
  }

  statusMessage() {
    if (this.battle.winner) return `${fighterName(this.battle.winner)} wins! Press "Restart" to play again.`;
    if (this.battle.draw) return `Draw! Press "Restart" to play again.`;
    return `Round ${this.battle.round} — pick a card. The CPU is choosing at the same time.`;
  }

  // --- scene ---------------------------------------------------------------

  create(data) {
    useRenderScale(this);
    this.recapPlaying = false;
    this.shownHp = null; // { player, cpu } while a recap is counting HP down
    this.panelViews = {};
    this.battle = this.setupBattle(data);

    this.events.once("shutdown", () => {
      this.tweens.timeScale = 1;
      this.time.timeScale = 1;
    });

    this.add
      .text(480, 14, "Godfield-lite", { fontFamily: FONT_FAMILY, fontSize: "20px", fontStyle: "700", color: TEXT.white })
      .setOrigin(0.5, 0);

    const soundLabel = () => (isMuted() ? "Sound: off" : "Sound: on");
    const soundButton = createButton(this, 960 - 40 - 110, 12, 110, 26, soundLabel(), {
      color: COLORS.restart,
      hoverColor: COLORS.restartHover,
      onClick: () => {
        setMuted(!isMuted());
        soundButton.container.getAt(1).setText(soundLabel());
      },
    });

    this.cpuPanel = this.add.container(0, 0);
    this.playerPanel = this.add.container(0, 0);

    this.statusText = this.add
      .text(480, PANEL_Y + PANEL_H + 8, "", { fontFamily: FONT_FAMILY, fontSize: "14px", fontStyle: "700", color: TEXT.body, align: "center" })
      .setOrigin(0.5, 0);

    this.add
      .text(480, HAND_Y - 20, "Your hand", { fontFamily: FONT_FAMILY, fontSize: "13px", color: TEXT.muted })
      .setOrigin(0.5, 0);

    this.handContainer = this.add.container(0, HAND_Y);

    const ultimate = createButton(this, 322, BUTTON_ROW_Y, 190, 40, "Use Ultimate", {
      color: COLORS.ultimate,
      hoverColor: COLORS.ultimateHover,
      onClick: () => this.onUltimateClick(),
    });
    this.ultimateButton = ultimate;

    createButton(this, 528, BUTTON_ROW_Y, 110, 40, this.leaveLabel, {
      color: COLORS.restart,
      hoverColor: COLORS.restartHover,
      onClick: () => this.onLeave(),
    });

    this.add
      .text(LOG_X, LOG_Y - 24, "Battle log", { fontFamily: FONT_FAMILY, fontSize: "14px", color: TEXT.muted })
      .setOrigin(0, 0);

    // Scrolling is done by picking which slice of battle.log to render
    // (index 0 = newest) rather than by pixel-clipping a moving container --
    // Phaser 4's WebGL renderer dropped support for GeometryMask (it wants a
    // texture-based Filter instead), and every log line is a short one-liner
    // anyway, so paging by line is simpler and renderer-agnostic.
    this.logScrollIndex = 0;
    this.logMaxScrollIndex = 0;
    this.logContainer = this.add.container(LOG_X, LOG_Y);

    this.logScrollTrack = this.add
      .rectangle(LOG_X + LOG_W - 6, LOG_Y, 4, LOG_H, COLORS.meterTrack)
      .setOrigin(0, 0)
      .setVisible(false);
    this.logScrollThumb = this.add
      .rectangle(LOG_X + LOG_W - 6, LOG_Y, 4, LOG_H, COLORS.restartHover)
      .setOrigin(0, 0)
      .setVisible(false);

    // Only scroll the log when the pointer is over it, so it doesn't hijack
    // wheel input over the rest of the page.
    // pointer.x/y are canvas pixels, so convert them into the camera's
    // (zoomed) 960x760 layout coordinates before comparing to the log's box.
    this.input.on("wheel", (pointer, _objects, _dx, dy) => {
      const { x, y } = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      if (x < LOG_X || x > LOG_X + LOG_W || y < LOG_Y || y > LOG_Y + LOG_H) {
        return;
      }
      this.scrollLog(Math.sign(dy));
    });

    this.render();
    loadCardArt(this, allCards(), () => this.render());
  }

  scrollLog(deltaLines) {
    const next = Phaser.Math.Clamp(this.logScrollIndex + deltaLines, 0, this.logMaxScrollIndex);
    if (next === this.logScrollIndex) return;
    this.logScrollIndex = next;
    this.renderLog();
  }

  updateLogScrollbar() {
    const needsScroll = this.logMaxScrollIndex > 0;
    this.logScrollTrack.setVisible(needsScroll);
    this.logScrollThumb.setVisible(needsScroll);
    if (!needsScroll) return;

    const totalLines = this.battle.log.length;
    const thumbH = Math.max(24, (LOG_VISIBLE_LINES / totalLines) * LOG_H);
    const thumbY = LOG_Y + (this.logScrollIndex / this.logMaxScrollIndex) * (LOG_H - thumbH);
    this.logScrollThumb.setSize(4, thumbH);
    this.logScrollThumb.setPosition(LOG_X + LOG_W - 6, thumbY);
  }

  onCardClick(cardId) {
    if (!this.canAct()) return;
    const action = cardAction(this.battle.player, cardId);
    if (!action) return;
    this.commitAction(action);
  }

  onUltimateClick() {
    if (!this.canAct()) return;
    const action = ultimateAction(this.battle.player);
    if (!action) return;
    this.commitAction(action);
  }

  // --- round recap -----------------------------------------------------------

  currentHp() {
    return { player: this.battle.player.hp, cpu: this.battle.cpu.hp };
  }

  // Show the round that just resolved: draw the new state with the HP from
  // `before`, play the recap (which counts HP down as hits land), then draw
  // the final state. Without both sides' lastAction (e.g. an online match on
  // a server that doesn't send it yet) it just redraws.
  presentRound(before) {
    const b = this.battle;
    if (!b.player.lastAction || !b.cpu.lastAction) {
      this.render();
      return;
    }

    this.recapPlaying = true;
    this.shownHp = { ...before };
    this.render();

    const side = (key, fighter, who) => ({
      action: fighter.lastAction,
      who,
      ultimateName: ultimateName(fighter.classDef),
      hp: before[key],
      panel: () => this.panelViews[key],
    });

    playRoundRecap(this, {
      round: b.player.lastAction.round,
      stage: RECAP_STAGE,
      sides: {
        player: side("player", b.player, "You"),
        cpu: side("cpu", b.cpu, this.opponentLabel),
      },
      outcome: this.outcome(),
    }).finally(() => {
      this.recapPlaying = false;
      this.shownHp = null;
      if (this.sys.isActive()) this.render();
    });
  }

  outcome() {
    const b = this.battle;
    if (b.draw) return { text: "DRAW", color: 0xe8eaf0, sfx: "defeat" };
    if (b.winner === b.player) return { text: "VICTORY!", color: 0xffd23f, sfx: "victory" };
    if (b.winner) return { text: "DEFEAT", color: 0xff5a4f, sfx: "defeat" };
    return null;
  }

  // --- drawing ---------------------------------------------------------------

  render() {
    const locked = !this.canAct();

    this.renderFighterPanel("cpu", this.cpuPanel, CPU_X, this.battle.cpu, this.opponentLabel);
    this.renderFighterPanel("player", this.playerPanel, PLAYER_X, this.battle.player, this.playerLabel);
    this.renderHand(locked);
    this.renderLog();

    this.statusText.setText(this.statusMessage());
    this.ultimateButton.setEnabled(!locked && canUseUltimate(this.battle.player));
  }

  renderFighterPanel(key, container, x, fighter, label) {
    container.removeAll(true);
    container.setPosition(x, PANEL_Y);
    container.add(roundedRect(this, PANEL_W, PANEL_H, COLORS.panel, 12));

    this.drawPanelHeader(container, fighter, label);
    this.drawGuardFrame(container, fighter);
    const setHp = this.drawHpBar(container, key, fighter);
    this.drawStatChips(container, fighter);
    this.drawEffectChips(container, fighter);
    this.drawUltimateMeter(container, fighter);

    this.panelViews[key] = { x, y: PANEL_Y, w: PANEL_W, h: PANEL_H, container, setHp };
  }

  drawPanelHeader(container, fighter, label) {
    container.add(this.add.circle(34, 32, 20, COLORS.meterTrack));
    const iconKey = classIconKey(fighter.classDef.id);
    if (this.textures.exists(iconKey)) {
      container.add(this.add.image(34, 32, iconKey).setDisplaySize(26, 26));
    }
    container.add(
      this.add.text(64, 13, label.toUpperCase(), { fontFamily: FONT_FAMILY, fontSize: "11px", fontStyle: "700", color: TEXT.muted })
    );
    container.add(
      this.add.text(64, 28, shortName(fighter.classDef.name), {
        fontFamily: FONT_FAMILY,
        fontSize: "17px",
        fontStyle: "700",
        color: TEXT.white,
      })
    );
    const handCount = fighter.handCount ?? fighter.hand.length;
    container.add(
      this.add
        .text(PANEL_W - PANEL_PAD, 16, `Hand ${handCount}`, { fontFamily: FONT_FAMILY, fontSize: "11px", color: TEXT.muted })
        .setOrigin(1, 0)
    );
  }

  // While a defend card is up: a pulsing blue frame around the panel and a
  // "GUARD +5" badge in the header, so it's obvious at a glance.
  drawGuardFrame(container, fighter) {
    const guards = Object.values(fighter.activeDefends);
    if (guards.length === 0) return;

    const frame = this.add.graphics();
    frame.lineStyle(3, GUARD_COLOR, 1);
    frame.strokeRoundedRect(1.5, 1.5, PANEL_W - 3, PANEL_H - 3, 12);
    container.add(frame);
    this.tweens.add({ targets: frame, alpha: 0.35, duration: 800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    frame.once("destroy", () => this.tweens.killTweensOf(frame));

    const text = this.add
      .text(0, 0, `GUARD ${guards.map(({ card }) => guardAmount(card)).join(" / ")}`, {
        fontFamily: FONT_FAMILY,
        fontSize: "12px",
        fontStyle: "800",
        color: "#0b1b26",
      })
      .setOrigin(0, 0.5);
    const iconSize = 14;
    const w = text.width + iconSize + 22;
    const h = 22;
    const x = PANEL_W - PANEL_PAD - 58 - w; // left of "Hand N"
    const y = 11;
    const pill = this.add.graphics();
    pill.fillStyle(GUARD_COLOR, 1);
    pill.fillRoundedRect(x, y, w, h, h / 2);
    container.add(pill);
    if (this.textures.exists(CARD_ICON_KEY.defend)) {
      container.add(this.add.image(x + 8 + iconSize / 2, y + h / 2, CARD_ICON_KEY.defend).setDisplaySize(iconSize, iconSize).setTint(0x0b1b26));
    }
    text.setPosition(x + 12 + iconSize, y + h / 2);
    container.add(text);
  }

  // Big HP bar. Returns setHp(value), which animates the bar to a new value
  // (with a pale "ghost" of the lost HP that drains a moment later) -- the
  // round recap calls it as each hit lands.
  drawHpBar(container, key, fighter) {
    const y = 60;
    const h = 24;
    const track = this.add.graphics();
    track.fillStyle(COLORS.meterTrack, 1);
    track.fillRoundedRect(PANEL_PAD, y, BAR_W, h, 7);
    const ghost = this.add.graphics();
    const fill = this.add.graphics();
    const hpLabel = this.add
      .text(PANEL_PAD + 10, y + h / 2, "HP", { fontFamily: FONT_FAMILY, fontSize: "11px", fontStyle: "800", color: TEXT.white })
      .setOrigin(0, 0.5);
    const value = this.add
      .text(PANEL_PAD + BAR_W / 2, y + h / 2, "", {
        fontFamily: FONT_FAMILY,
        fontSize: "14px",
        fontStyle: "800",
        color: TEXT.white,
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5);
    container.add([track, ghost, fill, hpLabel, value]);

    const bar = (g, hp, color, alpha) => {
      g.clear();
      const w = BAR_W * Phaser.Math.Clamp(hp / fighter.maxHp, 0, 1);
      if (w <= 0) return;
      g.fillStyle(color, alpha);
      g.fillRoundedRect(PANEL_PAD, y, w, h, Math.min(7, w / 2));
    };
    const draw = (hp, ghostHp) => {
      bar(ghost, ghostHp, 0xffffff, 0.35);
      bar(fill, hp, hpColor(hp / fighter.maxHp), 1);
      value.setText(`${Math.ceil(hp)} / ${fighter.maxHp}`);
    };

    let shown = this.shownHp?.[key] ?? fighter.hp;
    draw(shown, shown);

    return (next) => {
      if (this.shownHp) this.shownHp[key] = next;
      const state = { hp: shown, ghost: shown };
      shown = next;
      const update = () => fill.active && draw(state.hp, state.ghost);
      this.tweens.add({ targets: state, hp: next, duration: 350, ease: "Cubic.easeOut", onUpdate: update });
      this.tweens.add({ targets: state, ghost: next, delay: 400, duration: 450, onUpdate: update });
    };
  }

  // DEF / MR / ER / UR, each with its change from the class's base value
  // (synergies, buffs and debuffs) as a green/red arrow.
  drawStatChips(container, fighter) {
    const y = 96;
    const h = 44;
    const gap = 8;
    const w = (BAR_W - gap * (STAT_CHIPS.length - 1)) / STAT_CHIPS.length;
    const stats = computeCurrentStats(fighter);
    const base = fighter.classDef.baseStats;

    // Active guards by the stat they back up (a physical guard sits on DEF).
    const guardByStat = {};
    for (const [type, { card }] of Object.entries(fighter.activeDefends)) {
      const statKey = RESIST_STAT[type];
      if (statKey) guardByStat[statKey] = card;
    }

    STAT_CHIPS.forEach((chip, i) => {
      const x = PANEL_PAD + i * (w + gap);
      const delta = stats[chip.key] - (base[chip.key] ?? 0);
      const guard = guardByStat[chip.key];
      const g = this.add.graphics();
      g.fillStyle(guard ? 0x16384d : COLORS.meterTrack, 1);
      g.fillRoundedRect(x, y, w, h, 7);
      g.fillStyle(chip.color, 1);
      g.fillRoundedRect(x, y, 4, h, { tl: 7, bl: 7, tr: 0, br: 0 });
      const outline = guard ? GUARD_COLOR : delta > 0 ? 0x6be39a : delta < 0 ? 0xff6b5f : null;
      if (outline !== null) {
        g.lineStyle(2, outline, 1);
        g.strokeRoundedRect(x + 1, y + 1, w - 2, h - 2, 7);
      }
      container.add(g);

      if (guard) {
        container.add(
          this.add
            .text(x + w - 7, y + 5, `🛡${guardAmount(guard)}`, {
              fontFamily: FONT_FAMILY,
              fontSize: "11px",
              fontStyle: "800",
              color: "#8fd3ff",
            })
            .setOrigin(1, 0)
        );
      }

      container.add(
        this.add.text(x + 12, y + 5, chip.label, { fontFamily: FONT_FAMILY, fontSize: "10px", fontStyle: "700", color: TEXT.muted })
      );
      container.add(
        this.add.text(x + 12, y + 18, fmt(stats[chip.key]), {
          fontFamily: FONT_FAMILY,
          fontSize: "19px",
          fontStyle: "800",
          color: delta > 0 ? "#6be39a" : delta < 0 ? "#ff6b5f" : TEXT.white,
        })
      );

      if (delta !== 0) {
        container.add(
          this.add
            .text(x + w - 8, y + h - 8, `${delta > 0 ? "▲" : "▼"}${fmt(Math.abs(delta))}`, {
              fontFamily: FONT_FAMILY,
              fontSize: "12px",
              fontStyle: "700",
              color: delta > 0 ? "#6be39a" : "#ff6b5f",
            })
            .setOrigin(1, 1)
        );
      }
    });
  }

  // One row of chips: synergy progress, active defends, temporary
  // buffs/debuffs and disabled synergies, each with turns remaining.
  drawEffectChips(container, fighter) {
    const chips = [];

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
      const amount = card.mode === MODIFIER_MODE.PERCENT ? `${card.amount * 100}%` : card.amount;
      chips.push({ text: `Guard ${type} −${amount} · ${remaining}t`, color: CHIP_COLOR.guard });
    }

    for (const { effect, remaining } of fighter.tempModifiers) {
      const positive = effect.kind === EFFECT_KIND.ENERGY_REGEN || effect.amount >= 0;
      chips.push({ text: `${describeEffect(effect)} · ${remaining}t`, color: positive ? CHIP_COLOR.up : CHIP_COLOR.down });
    }

    const y = 148;
    const h = 20;
    let x = PANEL_PAD;
    const maxX = PANEL_W - PANEL_PAD;
    for (let i = 0; i < chips.length; i++) {
      const text = this.add
        .text(0, y + h / 2, chips[i].text, { fontFamily: FONT_FAMILY, fontSize: "11px", fontStyle: "600", color: TEXT.white })
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
      bg.fillStyle(chips[i].color, 1);
      bg.fillRoundedRect(x, y, w, h, h / 2);
      text.setX(x + 7);
      container.add([bg, text]);
      x += w + 6;
    }
  }

  drawUltimateMeter(container, fighter) {
    const y = 180;
    const cost = fighter.classDef.ultimate.cost;
    const ready = canUseUltimate(fighter);
    let barX = PANEL_PAD;
    if (this.textures.exists(ULTIMATE_ICON_KEY)) {
      container.add(this.add.image(PANEL_PAD + 7, y, ULTIMATE_ICON_KEY).setDisplaySize(16, 16));
      barX = PANEL_PAD + 22;
    }
    const barW = PANEL_W - PANEL_PAD - barX - 64;
    const g = this.add.graphics();
    g.fillStyle(COLORS.meterTrack, 1);
    g.fillRoundedRect(barX, y - 5, barW, 10, 5);
    const w = barW * Math.min(1, fighter.ultimateMeter / cost);
    if (w > 0) {
      g.fillStyle(ready ? COLORS.ultimateHover : COLORS.meterFill, 1);
      g.fillRoundedRect(barX, y - 5, w, 10, Math.min(5, w / 2));
    }
    container.add(g);

    const label = this.add
      .text(PANEL_W - PANEL_PAD, y, ready ? "READY!" : `${fmt(fighter.ultimateMeter)}/${cost}`, {
        fontFamily: FONT_FAMILY,
        fontSize: ready ? "13px" : "12px",
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

  renderHand(locked) {
    this.handContainer.removeAll(true);
    const cards = this.battle.player.hand;
    const totalW = cards.length * CARD_W + Math.max(0, cards.length - 1) * CARD_GAP;
    let x = 480 - totalW / 2;

    for (const card of cards) {
      const { container: cardContainer, bg } = drawCardFace(
        this,
        { cardId: card.cardId, category: card.category, name: card.name, damageType: card.damageType, description: describeCard(card) },
        CARD_W,
        CARD_H
      );
      cardContainer.setPosition(x, 0);

      if (!locked) {
        bg.on("pointerover", () => this.tweens.add({ targets: cardContainer, y: -8, duration: 100 }));
        bg.on("pointerout", () => this.tweens.add({ targets: cardContainer, y: 0, duration: 100 }));
        bg.on("pointerdown", () => this.onCardClick(card.id));
      } else {
        cardContainer.setAlpha(0.5);
        bg.disableInteractive();
      }

      this.handContainer.add(cardContainer);
      x += CARD_W + CARD_GAP;
    }
  }

  renderLog() {
    this.logContainer.removeAll(true);

    this.logMaxScrollIndex = Math.max(0, this.battle.log.length - LOG_VISIBLE_LINES);
    this.logScrollIndex = Phaser.Math.Clamp(this.logScrollIndex, 0, this.logMaxScrollIndex);

    const visible = this.battle.log.slice(this.logScrollIndex, this.logScrollIndex + LOG_VISIBLE_LINES);
    let y = 0;
    for (const line of visible) {
      this.logContainer.add(
        this.add.text(0, y, line, {
          fontFamily: FONT_FAMILY,
          fontSize: "12px",
          color: TEXT.body,
          wordWrap: { width: LOG_W - 20 },
        })
      );
      y += LOG_LINE_HEIGHT;
    }

    this.updateLogScrollbar();
  }
}
