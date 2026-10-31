// One card drawn as a Phaser container, in the card frame art: name on the
// top plate, AP cost in the medallion, the card's art (else its category
// icon) in the window, its category on the banner and its effect text in
// the box at the bottom. Used for the hand and for the big card in the
// round recap.

import type Phaser from "phaser";
import { COLORS, FONT_FAMILY, roundedRect } from "./theme.ts";
import { CARD_FRAME_KEY, CARD_ICON_KEY, ULTIMATE_ICON_KEY, damageAccentColor, elementAccentColor } from "../phaserIcons.ts";
import { loadedArtKey } from "../cardArt.ts";
import { cardCost, type Card } from "../model/cardTypes.ts";
import { describeCard, type PlayRecord } from "../model/engine.ts";
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
}

// Face data for a card instance (hand, arena slot, commit flight).
export function cardFaceData(card: Card): CardFaceData {
  return {
    cardId: card.cardId,
    category: card.category,
    name: card.name,
    damageType: "damageType" in card ? card.damageType : null,
    element: card.element ?? null,
    cost: cardCost(card),
    description: describeCard(card),
  };
}

// Face data for one resolved play (from a fighter's lastTurn): the card, or
// the gold ultimate card.
export function actionFace(action: PlayRecord, ultimateName: string): CardFaceData {
  if (action.kind === "ultimate") {
    return { category: "ultimate", name: ultimateName, description: `${action.damage ?? 0} damage` };
  }
  return {
    cardId: action.cardId,
    category: action.category ?? "",
    name: action.name,
    damageType: action.damageType,
    element: action.element ?? null,
    cost: action.cost ?? null,
    description: action.description,
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
  body: `Inter, ${FONT_FAMILY}`,
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

  // Description, ivory on a dark box over the parchment.
  if (card.description) {
    const box = slot(SLOT.text);
    const inset = 3 * scale;
    const panel = scene.add.graphics();
    panel.fillStyle(0x1a1a1a, 0.78);
    panel.fillRoundedRect(box.x, box.y, box.w, box.h, 4 * scale);
    container.add(panel);
    container.add(
      fit(
        scene.add
          .text(box.x + box.w / 2, box.y + box.h / 2, card.description, {
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
        box.h - inset * 2
      )
    );
  }

  return { container, bg };
}
