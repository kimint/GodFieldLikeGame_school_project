// One card drawn as a Phaser container, in the card frame art: name on the
// top plate, AP cost in the medallion, the card's art (else its category
// icon) in the window, its category on the banner and its effect text in
// the box at the bottom. Used for the hand and for the big card in the
// round recap.

import type Phaser from "phaser";
import { COLORS, FONT_FAMILY, roundedRect } from "./theme.ts";
import { CARD_FRAME_KEY, CARD_ICON_KEY, ULTIMATE_ICON_KEY, damageAccentColor, elementAccentColor } from "../phaserIcons.ts";
import { loadedArtKey } from "../cardArt.ts";
import { cardCost, cardRarity, RARITY, type Card, type Rarity } from "../model/cardTypes.ts";
import { cardPriority, describeCard, ULTIMATE_PRIORITY, type PlayRecord } from "../model/engine.ts";
import type { DamageType, Element } from "../model/damageTypes.ts";

export const AP_GEM_COLOR = 0x2f7fd0;
export const AP_SHORT_COLOR = 0xc0392b; // a cost gem you can't pay right now

// card: { cardId, category, name, damageType, description } -- a hand card
// instance plus its describeCard() text, or one of a fighter's plays. The
// category "ultimate" draws the gold ultimate card.
export interface CardFaceData {
  cardId?: string | null;
  category: string;
  name?: string | null;
  damageType?: DamageType | null;
  element?: Element | null;
  cost?: number | null; // AP cost, drawn as a gem in the corner
  costShort?: boolean; // not enough AP left for it: the gem turns red
  description?: string | null;
  priority?: number | null; // strike priority, drawn as a badge atop the description
  rarity?: Rarity | null; // rare / legend: a colored edge and a gem on the art window
}

// Rarity colors (normal cards draw neither the edge nor the gem).
export const RARITY_COLOR: Record<Rarity, number> = {
  normal: 0xc9ccd2,
  rare: 0x4aa3ff,
  legend: 0xff9d1a,
};

// The priority badge's colors: amber, so it reads apart from the ivory text.
export const PRIORITY_BADGE_COLOR = 0xffb020;
const PRIORITY_TEXT_COLOR = "#2a1600";

// Face data for a card instance (hand, arena slot, commit flight).
export function cardFaceData(card: Card): CardFaceData {
  return {
    cardId: card.cardId,
    category: card.category,
    name: card.name,
    damageType: "damageType" in card ? card.damageType : null,
    element: card.element ?? null,
    cost: cardCost(card),
    description: describeCard(card, { priority: false }),
    priority: cardPriority(card),
    rarity: cardRarity(card),
  };
}

// Face data for one resolved play (from a fighter's lastTurn): the card, or
// the gold ultimate card.
export function actionFace(action: PlayRecord, ultimateName: string): CardFaceData {
  if (action.kind === "ultimate") {
    return { category: "ultimate", name: ultimateName, description: `${action.damage ?? 0} damage`, priority: action.priority ?? ULTIMATE_PRIORITY };
  }
  return {
    cardId: action.cardId,
    category: action.category ?? "",
    name: action.name,
    damageType: action.damageType,
    element: action.element ?? null,
    cost: action.cost ?? null,
    description: action.description,
    priority: action.priority ?? null,
    rarity: action.rarity ?? null,
  };
}

// The card frame (public/ui/card-frame.webp, 382x512) and where its slots
// are, in the image's pixels: the name plate, the cost medallion, the art
// window, the category banner and the description box. The frame is
// stretched to whatever size the card is drawn at.
const FRAME = { w: 382, h: 512 };
const SLOT = {
  title: { x: 24, y: 20, w: 260, h: 37 },
  gem: { x: 323, y: 46, r: 22 },
  art: { x: 30, y: 66, w: 314, h: 280 },
  banner: { x: 98, y: 355, w: 165, h: 21 },
  text: { x: 40, y: 387, w: 295, h: 95 },
};

// Card fonts (loaded from Google Fonts in index.html), each with fallbacks
// for while they load or if they can't.
export const CARD_FONT = {
  title: "Cinzel, 'Trajan Pro', Georgia, serif",
  cost: "'Exo 2', Impact, 'Arial Black', sans-serif",
  body: FONT_FAMILY,
};

// Shrink a text object (never grow it) until it fits in maxW x maxH.
function fit(text: Phaser.GameObjects.Text, maxW: number, maxH: number): Phaser.GameObjects.Text {
  const s = Math.min(1, maxW / Math.max(1, text.width), maxH / Math.max(1, text.height));
  return text.setScale(s);
}

export function drawCardFace(
  scene: Phaser.Scene,
  card: CardFaceData,
  w: number,
  h: number,
  { scale = 1 }: { scale?: number } = {}
): { container: Phaser.GameObjects.Container; bg: Phaser.GameObjects.Graphics } {
  const container = scene.add.container(0, 0);
  const isUltimate = card.category === "ultimate";
  const color = isUltimate
    ? COLORS.ultimate
    : ((COLORS.card as Record<string, number>)[card.category] ?? COLORS.panel);

  // The click target (callers wire it up), and the card itself if the frame
  // art hasn't loaded.
  const bg = roundedRect(scene, w, h, color, 10 * scale);
  container.add(bg);
  if (scene.textures.exists(CARD_FRAME_KEY)) {
    container.add(scene.add.image(0, 0, CARD_FRAME_KEY).setOrigin(0).setDisplaySize(w, h));
  }

  const sx = w / FRAME.w;
  const sy = h / FRAME.h;
  const slot = (r: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } => ({
    x: r.x * sx,
    y: r.y * sy,
    w: r.w * sx,
    h: r.h * sy,
  });
  const px = (n: number): string => `${Math.max(1, Math.round(n))}px`;

  // Artwork, filling the art window (cropped to its shape), else the
  // category icon on a tint of the category color.
  const art = slot(SLOT.art);
  const artKey = loadedArtKey(scene, card.cardId);
  const iconKey = isUltimate ? ULTIMATE_ICON_KEY : (CARD_ICON_KEY as Record<string, string>)[card.category];
  if (artKey) {
    const img = scene.add.image(art.x + art.w / 2, art.y + art.h / 2, artKey);
    const ratio = art.w / art.h;
    if (img.width / img.height > ratio) {
      const cropW = img.height * ratio;
      img.setCrop((img.width - cropW) / 2, 0, cropW, img.height).setScale(art.w / cropW, art.h / img.height);
    } else {
      const cropH = img.width / ratio;
      img.setCrop(0, (img.height - cropH) / 2, img.width, cropH).setScale(art.w / img.width, art.h / cropH);
    }
    container.add(img);
  } else {
    container.add(scene.add.rectangle(art.x, art.y, art.w, art.h, color, 0.35).setOrigin(0));
    if (iconKey && scene.textures.exists(iconKey)) {
      const size = Math.min(art.w, art.h) * 0.45;
      container.add(scene.add.image(art.x + art.w / 2, art.y + art.h / 2, iconKey).setDisplaySize(size, size));
    }
  }

  // Rare and legend cards: a glowing edge in the rarity's color, and a gem
  // in the art window's top-right corner (the element dot has the left).
  const rarity = card.rarity ?? RARITY.NORMAL;
  if (rarity !== RARITY.NORMAL) {
    const rc = RARITY_COLOR[rarity];
    const edge = scene.add.graphics();
    edge.lineStyle(6 * scale, rc, 0.3);
    edge.strokeRoundedRect(0, 0, w, h, 10 * scale);
    edge.lineStyle(2 * scale, rc, 1);
    edge.strokeRoundedRect(1 * scale, 1 * scale, w - 2 * scale, h - 2 * scale, 10 * scale);
    container.add(edge);

    const gx = art.x + art.w - 10 * scale;
    const gy = art.y + 10 * scale;
    const gr = (rarity === RARITY.LEGEND ? 7 : 6) * scale;
    const gem = scene.add.graphics();
    gem.fillStyle(rc, 1);
    gem.lineStyle(Math.max(1, 1.5 * scale), 0x1a1a1a, 1);
    gem.beginPath();
    gem.moveTo(gx, gy - gr);
    gem.lineTo(gx + gr * 0.8, gy);
    gem.lineTo(gx, gy + gr);
    gem.lineTo(gx - gr * 0.8, gy);
    gem.closePath();
    gem.fillPath();
    gem.strokePath();
    gem.fillStyle(0xffffff, 0.75);
    gem.fillTriangle(gx, gy - gr * 0.7, gx + gr * 0.35, gy - gr * 0.05, gx - gr * 0.35, gy - gr * 0.05);
    container.add(gem);
  }

  const accent = elementAccentColor(card.element) ?? damageAccentColor(card.damageType ?? undefined);
  if (accent !== null) {
    container.add(scene.add.circle(art.x + 9 * scale, art.y + 9 * scale, 5 * scale, accent).setStrokeStyle(1.5, COLORS.background));
  }

  // Name, on the plate: gold caps with a dark bronze edge and a drop shadow.
  const title = slot(SLOT.title);
  container.add(
    fit(
      scene.add
        .text(title.x + title.w / 2, title.y + title.h / 2, (card.name ?? "").toUpperCase(), {
          fontFamily: CARD_FONT.title,
          fontSize: px(Math.max(title.h * 0.62, 8 * scale)),
          fontStyle: "700",
          color: "#ffd700",
          stroke: "#5a3a12",
          strokeThickness: Math.max(1, 1.5 * scale),
        })
        .setShadow(0, Math.max(1, scale), "#000000", 2 * scale, true, true)
        .setOrigin(0.5),
      title.w - 6 * sx,
      title.h * 1.3
    )
  );

  // AP cost, in the medallion -- over a red glow when there isn't enough AP
  // left this turn to pay for it.
  if (card.cost !== null && card.cost !== undefined && !isUltimate) {
    const gx = SLOT.gem.x * sx;
    const gy = SLOT.gem.y * sy;
    const r = SLOT.gem.r * Math.min(sx, sy);
    if (card.costShort) container.add(scene.add.circle(gx, gy, r, AP_SHORT_COLOR, 0.75));
    container.add(
      scene.add
        .text(gx, gy, String(card.cost), {
          fontFamily: CARD_FONT.cost,
          fontSize: px(r * 1.45),
          fontStyle: "900",
          color: "#ffffff",
          stroke: "#000000",
          strokeThickness: Math.max(1.5, 2.5 * scale),
        })
        .setOrigin(0.5)
    );
  }

  // Category, on a ribbon of its color in the banner.
  const banner = slot(SLOT.banner);
  const ribbon = scene.add.graphics();
  ribbon.fillStyle(color, 0.9);
  ribbon.fillRoundedRect(banner.x, banner.y, banner.w, banner.h, Math.min(4 * scale, banner.h / 2));
  container.add(ribbon);
  container.add(
    fit(
      scene.add
        .text(banner.x + banner.w / 2, banner.y + banner.h / 2, isUltimate ? "ULTIMATE" : card.category.toUpperCase(), {
          fontFamily: CARD_FONT.title,
          fontSize: px(Math.max(banner.h * 0.68, 6 * scale)),
          fontStyle: "700",
          color: "#f5f5f5",
          letterSpacing: 1.5 * scale,
        })
        .setOrigin(0.5),
      banner.w - 4 * sx,
      banner.h * 1.4
    )
  );

  // Description, ivory on a dark box over the parchment -- with the strike
  // priority, if it has one, on an amber badge at the top center of the box.
  const priority = card.priority ?? null;
  if (card.description || priority !== null) {
    const box = slot(SLOT.text);
    const inset = 3 * scale;
    const panel = scene.add.graphics();
    panel.fillStyle(0x1a1a1a, 0.78);
    panel.fillRoundedRect(box.x, box.y, box.w, box.h, 4 * scale);
    container.add(panel);

    let textTop = box.y;
    if (priority !== null) {
      const badgeH = 28 * sy;
      const badgeY = box.y + inset;
      const label = scene.add
        .text(box.x + box.w / 2, badgeY + badgeH / 2, `PRIORITY ${priority}`, {
          fontFamily: CARD_FONT.cost,
          fontSize: px(badgeH * 0.78),
          fontStyle: "900",
          color: PRIORITY_TEXT_COLOR,
          letterSpacing: 0.5 * scale,
        })
        .setOrigin(0.5);
      fit(label, box.w * 0.7, badgeH);
      const badgeW = label.displayWidth + 14 * sx;
      const badge = scene.add.graphics();
      badge.fillStyle(PRIORITY_BADGE_COLOR, 1);
      badge.fillRoundedRect(box.x + (box.w - badgeW) / 2, badgeY, badgeW, badgeH, badgeH / 2);
      badge.lineStyle(Math.max(1, scale), 0xffe7a8, 1);
      badge.strokeRoundedRect(box.x + (box.w - badgeW) / 2, badgeY, badgeW, badgeH, badgeH / 2);
      container.add([badge, label]);
      textTop = badgeY + badgeH;
    }

    if (card.description) {
      const textH = box.y + box.h - textTop;
      container.add(
        fit(
          scene.add
            .text(box.x + box.w / 2, textTop + textH / 2, card.description, {
              fontFamily: CARD_FONT.body,
              fontSize: px(8.5 * scale),
              fontStyle: "600",
              color: "#fff8dc",
              align: "center",
              lineSpacing: -1 * scale,
              wordWrap: { width: box.w - inset * 2 },
            })
            .setOrigin(0.5),
          box.w - inset * 2,
          textH - inset * 2
        )
      );
    }
  }

  return { container, bg };
}
