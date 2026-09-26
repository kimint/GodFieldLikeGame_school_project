// Phaser bootstrap for index.html. The game rules live entirely in
// src/model/* (DOM/Phaser-agnostic); everything here is just rendering and
// input, split into two scenes -- see src/scenes/.

import Phaser from "phaser";
import { ClassSelectScene } from "./scenes/ClassSelectScene.js";
import { BattleScene } from "./scenes/BattleScene.js";
import { COLORS } from "./scenes/theme.js";

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: 960,
  height: 760,
  backgroundColor: COLORS.background,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [ClassSelectScene, BattleScene],
});
