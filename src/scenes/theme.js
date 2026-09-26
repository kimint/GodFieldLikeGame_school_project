// Shared colors/fonts + a couple of small draw helpers used by every scene,
// mirroring the palette that used to live in src/style.css.

import Phaser from "phaser";

export const COLORS = {
  background: 0x1e2230,
  panel: 0x2a2f42,
  card: {
    attack: 0xb5423a,
    defend: 0x2f6f8f,
    buff: 0x3a8f5a,
    debuff: 0x6a4a94,
  },
  ultimate: 0xa8842f,
  ultimateHover: 0xc49b3a,
  restart: 0x4a5573,
  restartHover: 0x586694,
  meterTrack: 0x1b1f2c,
  meterFill: 0xa8842f,
};

export const TEXT = {
  body: "#e8eaf0",
  muted: "#a9adc1",
  white: "#ffffff",
};

export const FONT_FAMILY = "system-ui, -apple-system, 'Segoe UI', sans-serif";

// A filled rounded rectangle, its origin at (0,0) like every other Phaser
// shape, with an interactive hit area covering the same rect -- the click
// target for anything drawn with this (class cards, hand cards, buttons).
export function roundedRect(scene, w, h, color, radius = 12) {
  const g = scene.add.graphics();
  g.fillStyle(color, 1);
  g.fillRoundedRect(0, 0, w, h, radius);
  g.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);
  return g;
}

// A rounded-rect button with a centered label and hover/disabled handling.
// Returns { container, setEnabled } -- setEnabled(false) dims it and drops
// its interactivity, matching the CSS `:disabled` cards/buttons this
// replaces.
export function createButton(scene, x, y, w, h, text, { color, hoverColor, onClick }) {
  const container = scene.add.container(x, y);

  const bg = scene.add.graphics();
  const draw = (fill) => {
    bg.clear();
    bg.fillStyle(fill, 1);
    bg.fillRoundedRect(0, 0, w, h, 8);
  };
  draw(color);
  bg.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);

  const label = scene.add
    .text(w / 2, h / 2, text, { fontFamily: FONT_FAMILY, fontSize: "14px", color: TEXT.white })
    .setOrigin(0.5);

  container.add([bg, label]);
  container.setData("enabled", true);

  bg.on("pointerover", () => container.getData("enabled") && draw(hoverColor));
  bg.on("pointerout", () => container.getData("enabled") && draw(color));
  bg.on("pointerdown", () => container.getData("enabled") && onClick());

  function setEnabled(enabled) {
    container.setData("enabled", enabled);
    container.setAlpha(enabled ? 1 : 0.45);
    draw(color);
    if (enabled) bg.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);
    else bg.disableInteractive();
  }

  return { container, setEnabled };
}
