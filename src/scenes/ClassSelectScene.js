// Class-select screen: one card per playable class from src/model/data.js.
// Picking one starts BattleScene with that class.

import Phaser from "phaser";
import { exampleClassGuardian, exampleClassPyromancer } from "../model/data.js";
import { preloadIcons, classIconKey, ULTIMATE_ICON_KEY } from "../phaserIcons.js";
import { COLORS, TEXT, FONT_FAMILY, roundedRect } from "./theme.js";

export const ALL_CLASSES = [exampleClassGuardian, exampleClassPyromancer];

const CARD_W = 260;
const CARD_H = 210;
const CARD_GAP = 24;

export class ClassSelectScene extends Phaser.Scene {
  constructor() {
    super("ClassSelectScene");
  }

  preload() {
    preloadIcons(this, ALL_CLASSES);
  }

  create() {
    this.add
      .text(480, 32, "Godfield-lite", { fontFamily: FONT_FAMILY, fontSize: "28px", fontStyle: "700", color: TEXT.white })
      .setOrigin(0.5, 0);

    this.add
      .text(
        480,
        72,
        "Class-based card battle: attack / defend / buff / debuff, synergies, and an ultimate meter.\n" +
          "Every round you and the CPU pick a card at the same time, then both resolve together.",
        { fontFamily: FONT_FAMILY, fontSize: "13px", color: TEXT.muted, align: "center", wordWrap: { width: 640 } }
      )
      .setOrigin(0.5, 0);

    this.add
      .text(480, 134, "Choose your class", { fontFamily: FONT_FAMILY, fontSize: "16px", color: TEXT.muted })
      .setOrigin(0.5, 0);

    const totalWidth = ALL_CLASSES.length * CARD_W + (ALL_CLASSES.length - 1) * CARD_GAP;
    let x = 480 - totalWidth / 2;
    const y = 176;

    for (const classDef of ALL_CLASSES) {
      this.createClassCard(x, y, classDef);
      x += CARD_W + CARD_GAP;
    }
  }

  createClassCard(x, y, classDef) {
    const container = this.add.container(x, y);

    const bg = roundedRect(this, CARD_W, CARD_H, COLORS.panel, 12);
    container.add(bg);

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
    bg.on("pointerdown", () => this.scene.start("BattleScene", { playerClass: classDef }));
  }
}
