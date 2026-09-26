// Phaser bootstrap for index.html. The game rules live entirely in
// src/model/* (DOM/Phaser-agnostic); everything here is just rendering and
// input, split into two scenes -- see src/scenes/.
//
// Before any scene starts, the game catalog (classes, synergies, cards) is
// loaded from Supabase -- see src/model/catalog.js. If that fails (offline,
// no .env, tables not migrated yet) the bundled local copy is used instead,
// so vs-CPU play still works.

import Phaser from "phaser";
import { ClassSelectScene } from "./scenes/ClassSelectScene.js";
import { BattleScene } from "./scenes/BattleScene.js";
import { LobbyScene } from "./scenes/LobbyScene.js";
import { OnlineBattleScene } from "./scenes/OnlineBattleScene.js";
import { COLORS, GAME_WIDTH, GAME_HEIGHT, RENDER_SCALE } from "./scenes/theme.js";
import { loadCatalog, useLocalCatalog } from "./model/catalog.js";
import { supabase, onlineAvailable } from "./online/supabaseClient.js";

const CATALOG_TIMEOUT_MS = 5000;

// Text objects are rasterized to their own small canvas at 1x by default, so
// the camera zoom (see useRenderScale in theme.js) would just stretch that
// bitmap and they'd stay blurry. Default every this.add.text(...) to render
// at RENDER_SCALE instead; a style that sets its own `resolution` still wins.
const addText = Phaser.GameObjects.GameObjectFactory.prototype.text;
Phaser.GameObjects.GameObjectFactory.prototype.text = function (x, y, text, style = {}) {
  return addText.call(this, x, y, text, { resolution: RENDER_SCALE, ...style });
};

async function loadGameCatalog() {
  if (!onlineAvailable) {
    useLocalCatalog();
    return;
  }
  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${CATALOG_TIMEOUT_MS} ms`)), CATALOG_TIMEOUT_MS)
    );
    await Promise.race([loadCatalog(supabase), timeout]);
  } catch (err) {
    console.warn(`[catalog] Couldn't load from Supabase (${err.message}); using the local copy.`);
    useLocalCatalog();
  }
}

loadGameCatalog().then(() => {
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    // The canvas is RENDER_SCALE times the 960x760 layout size so it has
    // enough real pixels for HiDPI screens; scenes zoom their camera to match.
    width: GAME_WIDTH * RENDER_SCALE,
    height: GAME_HEIGHT * RENDER_SCALE,
    backgroundColor: COLORS.background,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [ClassSelectScene, BattleScene, LobbyScene, OnlineBattleScene],
  });
});
