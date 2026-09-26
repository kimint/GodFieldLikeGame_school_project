// Battle screen: renders src/model/engine.js's battle state and turns clicks
// into playRound() calls. Every render() call wipes and rebuilds the dynamic
// containers (fighter panels, hand, log) rather than diffing them -- this is
// a low-frequency turn-based UI, so that's simpler and it's what the DOM
// version (src/app.js) did too via innerHTML = "".

import Phaser from "phaser";
import {
  computeCurrentStats,
  canUseUltimate,
  createBattle,
  cardAction,
  ultimateAction,
  playRound,
  describeCard,
  isBattleOver,
  fighterName,
} from "../model/engine.js";
import { allClasses } from "../model/catalog.js";
import { preloadIcons, classIconKey, ULTIMATE_ICON_KEY, CARD_ICON_KEY, damageAccentColor } from "../phaserIcons.js";
import { COLORS, TEXT, FONT_FAMILY, roundedRect, createButton, useRenderScale } from "./theme.js";

const PANEL_Y = 50;
const PANEL_W = 420;
const PANEL_H = 170;
const CPU_X = 40;
const PLAYER_X = 500;

const HAND_Y = 284;
const CARD_W = 108;
const CARD_H = 150;
const CARD_GAP = 16;

const BUTTON_ROW_Y = 446;
const LOG_X = 30;
const LOG_Y = 538;
const LOG_W = 900;
const LOG_H = 200;
const LOG_LINE_HEIGHT = 20;
const LOG_VISIBLE_LINES = Math.floor(LOG_H / LOG_LINE_HEIGHT);

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
    return !isBattleOver(this.battle);
  }

  commitAction(action) {
    playRound(this.battle, action);
    this.render();
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
    this.battle = this.setupBattle(data);

    this.add
      .text(480, 14, "Godfield-lite", { fontFamily: FONT_FAMILY, fontSize: "20px", fontStyle: "700", color: TEXT.white })
      .setOrigin(0.5, 0);

    this.cpuPanel = this.add.container(0, 0);
    this.playerPanel = this.add.container(0, 0);

    this.statusText = this.add
      .text(480, PANEL_Y + PANEL_H + 12, "", { fontFamily: FONT_FAMILY, fontSize: "14px", fontStyle: "700", color: TEXT.body, align: "center" })
      .setOrigin(0.5, 0);

    this.add
      .text(480, HAND_Y - 22, "Your hand", { fontFamily: FONT_FAMILY, fontSize: "15px", color: TEXT.muted })
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
      .text(LOG_X, LOG_Y - 28, "Battle log", { fontFamily: FONT_FAMILY, fontSize: "15px", color: TEXT.muted })
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

  render() {
    const locked = !this.canAct();

    this.renderFighterPanel(this.cpuPanel, CPU_X, this.battle.cpu, this.opponentLabel);
    this.renderFighterPanel(this.playerPanel, PLAYER_X, this.battle.player, this.playerLabel);
    this.renderHand(locked);
    this.renderLog();

    this.statusText.setText(this.statusMessage());
    this.ultimateButton.setEnabled(!locked && canUseUltimate(this.battle.player));
  }

  renderFighterPanel(container, x, fighter, label) {
    container.removeAll(true);
    container.setPosition(x, PANEL_Y);

    container.add(roundedRect(this, PANEL_W, PANEL_H, COLORS.panel, 12));

    let textX = 16;
    const iconKey = classIconKey(fighter.classDef.id);
    if (this.textures.exists(iconKey)) {
      container.add(this.add.image(28, 26, iconKey).setDisplaySize(22, 22));
      textX = 46;
    }
    container.add(
      this.add.text(textX, 14, `${label} — ${fighter.classDef.name}`, {
        fontFamily: FONT_FAMILY,
        fontSize: "15px",
        fontStyle: "700",
        color: TEXT.white,
      })
    );

    container.add(
      this.add.text(16, 46, `HP ${Math.ceil(fighter.hp)} / ${fighter.maxHp}`, {
        fontFamily: FONT_FAMILY,
        fontSize: "13px",
        color: TEXT.body,
      })
    );

    const stats = computeCurrentStats(fighter);
    container.add(
      this.add.text(16, 68, `DEF ${stats.def}  MR ${stats.mr}  ER ${stats.er}  UR ${stats.ur}`, {
        fontFamily: FONT_FAMILY,
        fontSize: "12px",
        color: TEXT.muted,
      })
    );

    const defendTypes = Object.keys(fighter.activeDefends);
    const defendText =
      defendTypes.length > 0
        ? `Active defend: ${defendTypes.map((t) => `${t} (${fighter.activeDefends[t].remaining}t)`).join(", ")}`
        : "Active defend: none";
    container.add(
      this.add.text(16, 88, defendText, {
        fontFamily: FONT_FAMILY,
        fontSize: "12px",
        color: TEXT.muted,
        wordWrap: { width: PANEL_W - 32 },
      })
    );

    const meterY = PANEL_H - 34;
    const meterW = PANEL_W - 32;
    container.add(this.add.rectangle(16, meterY, meterW, 8, COLORS.meterTrack).setOrigin(0, 0));
    const pct = Math.min(1, fighter.ultimateMeter / fighter.classDef.ultimate.cost);
    if (pct > 0) {
      container.add(this.add.rectangle(16, meterY, meterW * pct, 8, COLORS.meterFill).setOrigin(0, 0));
    }

    const ultY = meterY + 14;
    let ultX = 16;
    if (this.textures.exists(ULTIMATE_ICON_KEY)) {
      container.add(this.add.image(24, ultY + 6, ULTIMATE_ICON_KEY).setDisplaySize(14, 14));
      ultX = 36;
    }
    container.add(
      this.add.text(ultX, ultY, `Ultimate ${fighter.ultimateMeter}/${fighter.classDef.ultimate.cost}`, {
        fontFamily: FONT_FAMILY,
        fontSize: "11px",
        color: TEXT.muted,
      })
    );
  }

  renderHand(locked) {
    this.handContainer.removeAll(true);
    const cards = this.battle.player.hand;
    const totalW = cards.length * CARD_W + Math.max(0, cards.length - 1) * CARD_GAP;
    let x = 480 - totalW / 2;

    for (const card of cards) {
      const cardContainer = this.add.container(x, 0);

      const bg = roundedRect(this, CARD_W, CARD_H, COLORS.card[card.category] ?? COLORS.panel, 10);
      cardContainer.add(bg);

      const iconKey = CARD_ICON_KEY[card.category];
      if (this.textures.exists(iconKey)) {
        cardContainer.add(this.add.image(CARD_W / 2, 34, iconKey).setDisplaySize(30, 30));
        const accent = damageAccentColor(card.damageType);
        if (accent !== null) {
          cardContainer.add(this.add.circle(CARD_W / 2 + 16, 20, 5, accent).setStrokeStyle(1, COLORS.background));
        }
      }

      cardContainer.add(
        this.add
          .text(CARD_W / 2, 60, card.category, { fontFamily: FONT_FAMILY, fontSize: "10px", color: TEXT.white })
          .setOrigin(0.5, 0)
          .setAlpha(0.85)
      );

      cardContainer.add(
        this.add
          .text(CARD_W / 2, 76, card.name, {
            fontFamily: FONT_FAMILY,
            fontSize: "13px",
            fontStyle: "700",
            color: TEXT.white,
            align: "center",
            wordWrap: { width: CARD_W - 12 },
          })
          .setOrigin(0.5, 0)
      );

      cardContainer.add(
        this.add
          .text(CARD_W / 2, CARD_H - 26, describeCard(card), {
            fontFamily: FONT_FAMILY,
            fontSize: "11px",
            color: TEXT.white,
            align: "center",
            wordWrap: { width: CARD_W - 12 },
          })
          .setOrigin(0.5, 0)
          .setAlpha(0.9)
      );

      if (!locked) {
        bg.on("pointerover", () => this.tweens.add({ targets: cardContainer, y: -6, duration: 100 }));
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
