// Class-select screen: one card per playable class from src/model/data.js.
// Clicking a card selects that class; the buttons underneath start a vs-CPU
// BattleScene or an online match via LobbyScene, and the top-right button
// opens the CardGalleryScene.

import Phaser from "phaser";
import { allClasses } from "../model/catalog.js";
import { onlineAvailable } from "../online/matchApi.js";
import { preloadIcons, classIconKey, ULTIMATE_ICON_KEY } from "../phaserIcons.js";
import { COLORS, TEXT, FONT_FAMILY, roundedRect, createButton, useRenderScale } from "./theme.js";

const CARD_W = 260;
const CARD_H = 210;
const CARD_GAP = 24;

export class ClassSelectScene extends Phaser.Scene {
  constructor() {
    super("ClassSelectScene");
  }

  preload() {
    preloadIcons(this, allClasses());
  }

  create() {
    useRenderScale(this);
    this.add
      .text(480, 32, "Godfield-lite", { fontFamily: FONT_FAMILY, fontSize: "28px", fontStyle: "700", color: TEXT.white })
      .setOrigin(0.5, 0);

    createButton(this, 960 - 30 - 130, 24, 130, 34, "Card gallery", {
      color: COLORS.restart,
      hoverColor: COLORS.restartHover,
      onClick: () => this.scene.start("CardGalleryScene"),
    });

    this.add
      .text(
        480,
        72,
        "Class-based card battle: attack / defend / buff / debuff, synergies, and an ultimate meter.\n" +
          "Every round both sides pick a card at the same time, then both resolve together.",
        { fontFamily: FONT_FAMILY, fontSize: "13px", color: TEXT.muted, align: "center", wordWrap: { width: 640 } }
      )
      .setOrigin(0.5, 0);

    this.add
      .text(480, 134, "Choose your class", { fontFamily: FONT_FAMILY, fontSize: "16px", color: TEXT.muted })
      .setOrigin(0.5, 0);

    const classes = allClasses();
    const totalWidth = classes.length * CARD_W + (classes.length - 1) * CARD_GAP;
    let x = 480 - totalWidth / 2;
    const y = 176;

    this.selectionOutlines = new Map(); // classId -> outline graphics
    for (const classDef of classes) {
      this.createClassCard(x, y, classDef);
      x += CARD_W + CARD_GAP;
    }
    this.selectClass(classes[0]);

    const buttonY = y + CARD_H + 36;
    createButton(this, 480 - 300, buttonY, 180, 44, "Play vs CPU", {
      color: COLORS.restart,
      hoverColor: COLORS.restartHover,
      onClick: () => this.scene.start("BattleScene", { playerClass: this.selectedClass }),
    });
    const create = createButton(this, 480 - 90, buttonY, 180, 44, "Create online room", {
      color: COLORS.ultimate,
      hoverColor: COLORS.ultimateHover,
      onClick: () => this.scene.start("LobbyScene", { mode: "create", playerClass: this.selectedClass }),
    });
    const join = createButton(this, 480 + 120, buttonY, 180, 44, "Join with code", {
      color: COLORS.ultimate,
      hoverColor: COLORS.ultimateHover,
      onClick: () => this.onJoinClick(),
    });

    if (!onlineAvailable) {
      create.setEnabled(false);
      join.setEnabled(false);
      this.add
        .text(480, buttonY + 56, "Online play is off: VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY aren't set (see .env).", {
          fontFamily: FONT_FAMILY,
          fontSize: "12px",
          color: TEXT.muted,
        })
        .setOrigin(0.5, 0);
    }
  }

  selectClass(classDef) {
    this.selectedClass = classDef;
    for (const [id, outline] of this.selectionOutlines) outline.setVisible(id === classDef.id);
  }

  onJoinClick() {
    const code = window.prompt("Enter the room code your friend sent you:");
    if (!code || !code.trim()) return;
    this.scene.start("LobbyScene", { mode: "join", code: code.trim(), playerClass: this.selectedClass });
  }

  createClassCard(x, y, classDef) {
    const container = this.add.container(x, y);

    const bg = roundedRect(this, CARD_W, CARD_H, COLORS.panel, 12);
    container.add(bg);

    const outline = this.add.graphics();
    outline.lineStyle(3, COLORS.ultimate, 1);
    outline.strokeRoundedRect(0, 0, CARD_W, CARD_H, 12);
    container.add(outline);
    this.selectionOutlines.set(classDef.id, outline);

    let textX = 16;
    const iconKey = classIconKey(classDef.id);
    if (this.textures.exists(iconKey)) {
      container.add(this.add.image(30, 28, iconKey).setDisplaySize(26, 26));
      textX = 50;
    }
    container.add(
      this.add.text(textX, 16, classDef.name, { fontFamily: FONT_FAMILY, fontSize: "16px", fontStyle: "700", color: TEXT.white })
    );

    const stats = classDef.baseStats;
    container.add(
      this.add.text(16, 54, `HP ${stats.hp}  DEF ${stats.def}  MR ${stats.mr}  ER ${stats.er}  UR ${stats.ur}`, {
        fontFamily: FONT_FAMILY,
        fontSize: "12px",
        color: TEXT.muted,
      })
    );

    container.add(
      this.add.text(16, 78, `Synergy: ${classDef.synergyPool.map((s) => s.name).join(", ")}`, {
        fontFamily: FONT_FAMILY,
        fontSize: "12px",
        color: TEXT.muted,
        wordWrap: { width: CARD_W - 32 },
      })
    );

    let ultX = 16;
    if (this.textures.exists(ULTIMATE_ICON_KEY)) {
      container.add(this.add.image(24, 138, ULTIMATE_ICON_KEY).setDisplaySize(16, 16));
      ultX = 38;
    }
    container.add(
      this.add.text(
        ultX,
        130,
        `Ultimate: ${classDef.ultimate.name} (cost ${classDef.ultimate.cost}, ${classDef.ultimate.damage} dmg)`,
        { fontFamily: FONT_FAMILY, fontSize: "12px", color: TEXT.muted, wordWrap: { width: CARD_W - ultX - 16 } }
      )
    );

    bg.on("pointerover", () => this.tweens.add({ targets: container, y: y - 4, duration: 100 }));
    bg.on("pointerout", () => this.tweens.add({ targets: container, y, duration: 100 }));
    bg.on("pointerdown", () => this.selectClass(classDef));
  }
}
