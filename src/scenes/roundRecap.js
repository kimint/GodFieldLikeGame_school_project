// End-of-round recap: replays what each fighter did in the round that just
// resolved -- their card flies out, then an effect per card type (a
// projectile + hit for attacks, a shield ring for defends, rising sparks for
// buffs, a curse for debuffs, a screen flash for ultimates) -- with
// synthesized sound effects (src/fx/sound.js).
//
// Driven entirely by each fighter's `lastAction` (see recordAction in
// engine.js), so it works the same for vs-CPU and online battles. Steps
// play in the engine's own resolution order: both sides' defend/buff/debuff
// cards first, then both sides' attacks/ultimates.
//
// Clicking anywhere during the recap fast-forwards it.

import Phaser from "phaser";
import { CARD_ICON_KEY } from "../phaserIcons.js";
import { playSfx } from "../fx/sound.js";
import { MODIFIER_MODE } from "../model/effects.js";
import { COLORS, TEXT, FONT_FAMILY } from "./theme.js";
import { drawCardFace } from "./cardFace.js";

const CARD_W = 124;
const CARD_H = 176;
const SKIP_SPEED = 6;

const EFFECT_COLOR = {
  hit: 0xff5a4f,
  block: 0x8fd3ff,
  defend: 0x6ec6ff,
  buff: 0x6be39a,
  debuff: 0xb98cff,
  ultimate: 0xffd23f,
};

const hex = (color) => `#${color.toString(16).padStart(6, "0")}`;
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * @param scene   the battle scene
 * @param recap   {
 *   round,
 *   stage: { y, h }                       -- screen band the recap covers
 *   sides: { player, cpu }, each {
 *     action,                             -- the fighter's lastAction
 *     who,                                -- "You" / "CPU" / "Opponent"
 *     ultimateName,
 *     hp,                                 -- HP shown before this round
 *     panel: () => ({ x, y, w, h, container, setHp }),
 *   },
 *   outcome: null | { text, color, sfx }  -- shown last, when the game ended
 * }
 */
export async function playRoundRecap(scene, recap) {
  const layer = scene.add.container(0, 0);
  const run = { scene, recap, layer, skipping: false };

  const { y: stageY, h: stageH } = recap.stage;
  const overlay = scene.add.rectangle(0, stageY, 960, stageH, COLORS.background, 0.86).setOrigin(0, 0);
  overlay.setInteractive();
  overlay.on("pointerdown", () => skip(run));
  const hint = scene.add
    .text(944, stageY + stageH - 8, "click to skip", { fontFamily: FONT_FAMILY, fontSize: "11px", color: TEXT.muted })
    .setOrigin(1, 1);
  layer.add([overlay, hint]);
  overlay.setAlpha(0);
  await tween(run, { targets: overlay, alpha: 1, duration: 150 });

  await roundBanner(run);

  const order = [];
  for (const key of ["player", "cpu"]) if (!dealsDamage(recap.sides[key].action)) order.push(key);
  for (const key of ["player", "cpu"]) if (dealsDamage(recap.sides[key].action)) order.push(key);
  for (const key of order) await playStep(run, key);

  if (recap.outcome) await outcomeBanner(run, recap.outcome);

  await tween(run, { targets: layer, alpha: 0, duration: 200 });
  layer.destroy(true);
  scene.tweens.timeScale = 1;
  scene.time.timeScale = 1;
}

function dealsDamage(action) {
  return action.kind === "ultimate" || (action.kind === "card" && action.category === "attack");
}

function skip(run) {
  if (run.skipping) return;
  run.skipping = true;
  run.scene.tweens.timeScale = SKIP_SPEED;
  run.scene.time.timeScale = SKIP_SPEED;
}

// --- promise helpers ---------------------------------------------------------

function tween(run, config) {
  return new Promise((resolve) => run.scene.tweens.add({ ...config, onComplete: () => resolve() }));
}

function wait(run, ms) {
  return new Promise((resolve) => run.scene.time.delayedCall(ms, resolve));
}

// --- banners -------------------------------------------------------------------

async function roundBanner(run) {
  const { scene, recap, layer } = run;
  const cy = recap.stage.y + recap.stage.h / 2;
  const text = scene.add
    .text(480, cy, `Round ${recap.round}`, {
      fontFamily: FONT_FAMILY,
      fontSize: "40px",
      fontStyle: "800",
      color: TEXT.white,
      stroke: "#000000",
      strokeThickness: 6,
    })
    .setOrigin(0.5)
    .setScale(0.6)
    .setAlpha(0);
  layer.add(text);
  await tween(run, { targets: text, scale: 1, alpha: 1, duration: 220, ease: "Back.easeOut" });
  await wait(run, 350);
  await tween(run, { targets: text, alpha: 0, y: cy - 20, duration: 180 });
  text.destroy();
}

async function outcomeBanner(run, outcome) {
  const { scene, recap, layer } = run;
  const cy = recap.stage.y + recap.stage.h / 2;
  const bar = scene.add.rectangle(480, cy, 960, 96, 0x000000, 0.6).setScale(1, 0);
  const text = scene.add
    .text(480, cy, outcome.text, {
      fontFamily: FONT_FAMILY,
      fontSize: "48px",
      fontStyle: "800",
      color: hex(outcome.color),
      stroke: "#000000",
      strokeThickness: 7,
    })
    .setOrigin(0.5)
    .setScale(1.6)
    .setAlpha(0);
  layer.add([bar, text]);
  playSfx(outcome.sfx);
  await tween(run, { targets: bar, scaleY: 1, duration: 180 });
  await tween(run, { targets: text, scale: 1, alpha: 1, duration: 300, ease: "Back.easeOut" });
  await wait(run, 1300);
}

// --- one fighter's action ----------------------------------------------------

async function playStep(run, key) {
  const { scene, recap, layer } = run;
  const side = recap.sides[key];
  const target = recap.sides[key === "player" ? "cpu" : "player"];
  const action = side.action;
  const panel = side.panel();
  const cy = recap.stage.y + recap.stage.h / 2 + 4;
  const cardX = panel.x + panel.w / 2;
  const leftSide = cardX < 480;

  // Caption beside the card, toward the middle of the screen.
  const captionX = leftSide ? cardX + CARD_W / 2 + 24 : cardX - CARD_W / 2 - 24;
  const caption = scene.add.container(captionX, cy - 44).setAlpha(0);
  const align = leftSide ? 0 : 1;
  const whoText = scene.add
    .text(0, 0, side.who, { fontFamily: FONT_FAMILY, fontSize: "14px", color: TEXT.muted })
    .setOrigin(align, 0);
  const title = action.kind === "ultimate" ? side.ultimateName : action.kind === "none" ? "No move" : action.name;
  const titleText = scene.add
    .text(0, 20, title, { fontFamily: FONT_FAMILY, fontSize: "26px", fontStyle: "800", color: TEXT.white })
    .setOrigin(align, 0);
  const resultText = scene.add
    .text(0, 56, "", { fontFamily: FONT_FAMILY, fontSize: "18px", fontStyle: "700", color: TEXT.white })
    .setOrigin(align, 0);
  caption.add([whoText, titleText, resultText]);
  layer.add(caption);

  // The card itself, growing out of the actor's panel.
  let holder = null;
  if (action.kind !== "none") {
    const face =
      action.kind === "ultimate"
        ? { category: "ultimate", name: side.ultimateName, description: `${fmt(action.damage ?? 0)} damage` }
        : action;
    const { container } = drawCardFace(scene, face, CARD_W, CARD_H);
    container.setPosition(-CARD_W / 2, -CARD_H / 2);
    holder = scene.add.container(cardX, panel.y + panel.h / 2, [container]).setScale(0.25).setAlpha(0);
    layer.add(holder);
    playSfx("card");
  }

  await Promise.all([
    holder && tween(run, { targets: holder, x: cardX, y: cy, scale: 1, alpha: 1, duration: 320, ease: "Back.easeOut" }),
    tween(run, { targets: caption, alpha: 1, duration: 250 }),
  ]);

  const result = await playEffect(run, side, target, action, holder ?? { x: cardX, y: cy });
  if (result) {
    resultText.setText(result.text).setColor(hex(result.color));
    resultText.setScale(1.3);
    scene.tweens.add({ targets: resultText, scale: 1, duration: 200, ease: "Back.easeOut" });
  }

  await wait(run, 700);
  await tween(run, { targets: [holder, caption].filter(Boolean), alpha: 0, duration: 200 });
  holder?.destroy(true);
  caption.destroy(true);
}

// Runs the effect for one action; returns the caption's result line.
async function playEffect(run, side, target, action, from) {
  if (action.kind === "none") return { text: "Nothing to play", color: 0xa9adc1 };

  if (action.kind === "ultimate") {
    run.scene.cameras.main.flash(250, 255, 210, 90);
    run.scene.cameras.main.shake(350, 0.008);
    playSfx("ultimate");
    await bigText(run, "ULTIMATE!", EFFECT_COLOR.ultimate);
    await projectile(run, from, target.panel(), EFFECT_COLOR.ultimate, 18);
    return hit(run, target, action);
  }

  switch (action.category) {
    case "attack":
      await projectile(run, from, target.panel(), accentFor(action), 12);
      return hit(run, target, action);
    case "defend":
      playSfx("shield");
      await shieldRing(run, side.panel(), action);
      return { text: `Guard ${guardText(action.guard)} ${action.damageType}`, color: EFFECT_COLOR.defend };
    case "buff":
      playSfx("buff");
      await sparkle(run, side.panel(), EFFECT_COLOR.buff, "up");
      return { text: "Powered up!", color: EFFECT_COLOR.buff };
    case "debuff":
      await projectile(run, from, target.panel(), EFFECT_COLOR.debuff, 10);
      playSfx("debuff");
      await sparkle(run, target.panel(), EFFECT_COLOR.debuff, "down");
      return { text: `${target.who} weakened`, color: EFFECT_COLOR.debuff };
    default:
      return null;
  }
}

// "+5" for a flat guard, "30%" for a percent one.
function guardText(guard) {
  if (!guard) return "";
  return guard.mode === MODIFIER_MODE.PERCENT ? `${Math.round(guard.amount * 100)}%` : `+${fmt(guard.amount)}`;
}

const RESIST_LABEL = { physical: "DEF", magic: "MR", element: "ER" };

function accentFor(action) {
  return { physical: 0xe6e9f0, magic: 0xb388ff, element: 0xff9d4d, true: 0xffe066 }[action.damageType] ?? EFFECT_COLOR.hit;
}

// --- effect pieces -----------------------------------------------------------

async function bigText(run, message, color) {
  const { scene, recap, layer } = run;
  const text = scene.add
    .text(480, recap.stage.y + 40, message, {
      fontFamily: FONT_FAMILY,
      fontSize: "44px",
      fontStyle: "800",
      color: hex(color),
      stroke: "#000000",
      strokeThickness: 7,
    })
    .setOrigin(0.5)
    .setScale(2)
    .setAlpha(0);
  layer.add(text);
  await tween(run, { targets: text, scale: 1, alpha: 1, duration: 260, ease: "Cubic.easeOut" });
  scene.tweens.add({ targets: text, alpha: 0, delay: 500, duration: 250, onComplete: () => text.destroy() });
}

async function projectile(run, from, panel, color, radius) {
  const { scene, layer } = run;
  const to = { x: panel.x + panel.w / 2, y: panel.y + panel.h / 2 };
  const orb = scene.add.circle(from.x, from.y, radius, color).setStrokeStyle(3, 0xffffff);
  layer.add(orb);

  // A fading trail behind the orb.
  const trail = scene.time.addEvent({
    delay: 25,
    loop: true,
    callback: () => {
      const dot = scene.add.circle(orb.x, orb.y, radius * 0.7, color, 0.6);
      layer.add(dot);
      scene.tweens.add({ targets: dot, alpha: 0, scale: 0.2, duration: 260, onComplete: () => dot.destroy() });
    },
  });
  await tween(run, { targets: orb, x: to.x, y: to.y, duration: 380, ease: "Quad.easeIn" });
  trail.remove();
  orb.destroy();
}

function hit(run, target, action) {
  const { scene, layer } = run;
  const damage = action.damage ?? 0;
  const guarded = action.guarded ?? 0;
  const resisted = action.resisted ?? 0;
  const panel = target.panel();
  const cx = panel.x + panel.w / 2;
  const cy = panel.y + panel.h / 2;
  const blocked = damage <= 0;
  const color = blocked ? EFFECT_COLOR.block : EFFECT_COLOR.hit;

  playSfx(blocked ? "block" : "hit");

  // Burst of particles from the impact point.
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const dist = Phaser.Math.Between(40, 80);
    const p = scene.add.circle(cx, cy, Phaser.Math.Between(3, 6), color);
    layer.add(p);
    scene.tweens.add({
      targets: p,
      x: cx + Math.cos(angle) * dist,
      y: cy + Math.sin(angle) * dist,
      alpha: 0,
      duration: 420,
      ease: "Cubic.easeOut",
      onComplete: () => p.destroy(),
    });
  }

  // Flash the panel and shake it.
  const flash = scene.add.rectangle(panel.x, panel.y, panel.w, panel.h, color, 0.45).setOrigin(0, 0);
  layer.add(flash);
  scene.tweens.add({ targets: flash, alpha: 0, duration: 400, onComplete: () => flash.destroy() });
  if (!blocked) {
    scene.tweens.add({ targets: panel.container, x: panel.x + 8, duration: 40, yoyo: true, repeat: 3, onComplete: () => panel.container.setX(panel.x) });
  }

  // Floating number.
  const label = scene.add
    .text(cx, cy - 10, blocked ? "BLOCKED" : `-${fmt(damage)}`, {
      fontFamily: FONT_FAMILY,
      fontSize: blocked ? "28px" : "40px",
      fontStyle: "800",
      color: hex(color),
      stroke: "#000000",
      strokeThickness: 6,
    })
    .setOrigin(0.5)
    .setScale(0.5);
  layer.add(label);
  scene.tweens.add({ targets: label, scale: 1, duration: 160, ease: "Back.easeOut" });
  scene.tweens.add({ targets: label, y: cy - 60, alpha: 0, delay: 600, duration: 500, onComplete: () => label.destroy() });

  // What the target's defenses soaked up: a shield bubble for a defend card,
  // and a line under the number, e.g. "Shield −5 · DEF −2".
  if (guarded > 0) shieldBubble(run, cx, cy);
  const absorbed = [];
  if (guarded > 0) absorbed.push(`Shield −${fmt(guarded)}`);
  if (resisted > 0) absorbed.push(`${RESIST_LABEL[action.damageType] ?? "Resist"} −${fmt(resisted)}`);
  if (absorbed.length > 0) {
    const note = scene.add
      .text(cx, cy + 26, absorbed.join(" · "), {
        fontFamily: FONT_FAMILY,
        fontSize: "18px",
        fontStyle: "800",
        color: hex(EFFECT_COLOR.defend),
        stroke: "#000000",
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setAlpha(0);
    layer.add(note);
    scene.tweens.add({ targets: note, alpha: 1, duration: 150, delay: 120 });
    scene.tweens.add({ targets: note, alpha: 0, delay: 1000, duration: 400, onComplete: () => note.destroy() });
  }

  if (!blocked) {
    target.hp = Math.max(0, target.hp - damage);
    panel.setHp(target.hp);
  }
  return blocked ? { text: "Blocked!", color } : { text: `${fmt(damage)} damage!`, color };
}

// A bubble that flashes over the impact point when a defend card absorbs
// part of a hit.
function shieldBubble(run, x, y) {
  const { scene, layer } = run;
  const bubble = scene.add.circle(x, y, 46, EFFECT_COLOR.defend, 0.25).setStrokeStyle(4, EFFECT_COLOR.defend);
  layer.add(bubble);
  bubble.setScale(0.4);
  scene.tweens.add({ targets: bubble, scale: 1.2, duration: 220, ease: "Back.easeOut" });
  scene.tweens.add({ targets: bubble, alpha: 0, delay: 350, duration: 350, onComplete: () => bubble.destroy() });
}

async function shieldRing(run, panel, action) {
  const { scene, layer } = run;
  const cx = panel.x + panel.w / 2;
  const cy = panel.y + panel.h / 2;

  const flash = scene.add.rectangle(panel.x, panel.y, panel.w, panel.h, EFFECT_COLOR.defend, 0.35).setOrigin(0, 0);
  layer.add(flash);
  scene.tweens.add({ targets: flash, alpha: 0, duration: 700, onComplete: () => flash.destroy() });

  // Big "GUARD +5" with the damage type and duration under it.
  const title = scene.add
    .text(cx, cy - 6, `GUARD ${guardText(action.guard)}`, {
      fontFamily: FONT_FAMILY,
      fontSize: "38px",
      fontStyle: "800",
      color: hex(EFFECT_COLOR.defend),
      stroke: "#000000",
      strokeThickness: 7,
    })
    .setOrigin(0.5)
    .setScale(0.4);
  const turns = action.guard?.duration ?? 1;
  const sub = scene.add
    .text(cx, cy + 30, `${action.damageType} · ${turns} turn${turns === 1 ? "" : "s"}`, {
      fontFamily: FONT_FAMILY,
      fontSize: "16px",
      fontStyle: "700",
      color: TEXT.white,
      stroke: "#000000",
      strokeThickness: 4,
    })
    .setOrigin(0.5)
    .setAlpha(0);
  layer.add([title, sub]);
  scene.tweens.add({ targets: title, scale: 1, duration: 260, ease: "Back.easeOut" });
  scene.tweens.add({ targets: sub, alpha: 1, delay: 150, duration: 200 });
  scene.tweens.add({ targets: [title, sub], alpha: 0, delay: 1100, duration: 350, onComplete: () => { title.destroy(); sub.destroy(); } });

  for (let i = 0; i < 3; i++) {
    const ring = scene.add.graphics();
    ring.lineStyle(5, EFFECT_COLOR.defend, 1);
    ring.strokeRoundedRect(-panel.w / 2, -panel.h / 2, panel.w, panel.h, 14);
    const holder = scene.add.container(cx, cy, [ring]).setAlpha(0.9);
    layer.add(holder);
    scene.tweens.add({
      targets: holder,
      scaleX: 1.06,
      scaleY: 1.12,
      alpha: 0,
      delay: i * 220,
      duration: 600,
      onComplete: () => holder.destroy(true),
    });
  }
  await iconPop(run, CARD_ICON_KEY.defend, panel.x + 48, cy, EFFECT_COLOR.defend);
  await wait(run, 350);
}

async function sparkle(run, panel, color, direction) {
  const { scene, layer } = run;
  const up = direction === "up";
  for (let i = 0; i < 16; i++) {
    const x = panel.x + Phaser.Math.Between(20, panel.w - 20);
    const y = up ? panel.y + panel.h - Phaser.Math.Between(0, 30) : panel.y + Phaser.Math.Between(0, 30);
    const p = scene.add.circle(x, y, Phaser.Math.Between(3, 6), color);
    layer.add(p);
    scene.tweens.add({
      targets: p,
      y: y + (up ? -1 : 1) * Phaser.Math.Between(60, 110),
      alpha: 0,
      delay: Phaser.Math.Between(0, 250),
      duration: 650,
      ease: "Sine.easeOut",
      onComplete: () => p.destroy(),
    });
  }
  const flash = scene.add.rectangle(panel.x, panel.y, panel.w, panel.h, color, 0.3).setOrigin(0, 0);
  layer.add(flash);
  scene.tweens.add({ targets: flash, alpha: 0, duration: 500, onComplete: () => flash.destroy() });
  await iconPop(run, CARD_ICON_KEY[up ? "buff" : "debuff"], panel.x + panel.w / 2, panel.y + panel.h / 2, color);
}

async function iconPop(run, key, x, y, color) {
  const { scene, layer } = run;
  if (!scene.textures.exists(key)) return wait(run, 400);
  const glow = scene.add.circle(x, y, 34, color, 0.35);
  const icon = scene.add.image(x, y, key).setDisplaySize(48, 48);
  const holder = scene.add.container(0, 0, [glow, icon]).setAlpha(0);
  layer.add(holder);
  await tween(run, { targets: holder, alpha: 1, duration: 150 });
  await tween(run, { targets: [glow], scale: 1.6, duration: 300, ease: "Sine.easeOut" });
  await tween(run, { targets: holder, alpha: 0, duration: 250 });
  holder.destroy(true);
}
