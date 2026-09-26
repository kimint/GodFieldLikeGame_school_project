// Card gallery: every card in the game catalog (the Supabase `cards` table,
// or the local copy when offline), filterable by category and paged 10 at a
// time. Reached from the class-select screen.
//
// Each card shows its artwork when the row has an `image_url` (see
// supabase/migrations/*_card_images.sql), otherwise the category's built-in
// SVG icon. Artwork is loaded after the scene is already on screen, so the
// gallery never waits on (or breaks because of) a slow or missing image --
// cards just switch from icon to artwork once their image arrives.

import Phaser from "phaser";
import { allCards, allClasses, deckEntriesForCard, getCatalog } from "../model/catalog.js";
import { CARD_CATEGORY } from "../model/cardTypes.js";
import { describeCard } from "../model/engine.js";
import { preloadIcons, classIconKey, CARD_ICON_KEY, damageAccentColor } from "../phaserIcons.js";
import { COLORS, TEXT, FONT_FAMILY, roundedRect, createButton, useRenderScale } from "./theme.js";

const CATEGORY_ORDER = [CARD_CATEGORY.ATTACK, CARD_CATEGORY.DEFEND, CARD_CATEGORY.BUFF, CARD_CATEGORY.DEBUFF];
const ALL = "all";

const TAB_Y = 104;
const TAB_W = 128;
const TAB_H = 34;
const TAB_GAP = 10;

const GRID_Y = 162;
const COLS = 5;
const ROWS = 2;
const PAGE_SIZE = COLS * ROWS;
const CARD_W = 150;
const CARD_H = 236;
const CARD_GAP = 20;

// The artwork box at the top of each card.
const ART_X = 10;
const ART_Y = 10;
const ART_W = CARD_W - 20;
const ART_H = 100;

const FOOTER_Y = 696;

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const artKey = (card) => `card-art-${card.id}`;

export class CardGalleryScene extends Phaser.Scene {
  constructor() {
    super("CardGalleryScene");
  }

  preload() {
    preloadIcons(this, allClasses());
  }

  create() {
    useRenderScale(this);

    // Stable order regardless of how the database returned the rows:
    // by category (attack, defend, buff, debuff), then by name.
    this.cards = allCards().sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.name.localeCompare(b.name)
    );
    this.filter = ALL;
    this.page = 0;

    this.add
      .text(480, 24, "Card Gallery", { fontFamily: FONT_FAMILY, fontSize: "28px", fontStyle: "700", color: TEXT.white })
      .setOrigin(0.5, 0);

    const source = getCatalog().source === "supabase" ? "loaded from the database" : "local copy (database not reachable)";
    this.add
      .text(480, 64, `${this.cards.length} cards · ${source}`, { fontFamily: FONT_FAMILY, fontSize: "13px", color: TEXT.muted })
      .setOrigin(0.5, 0);

    createButton(this, 30, FOOTER_Y, 110, 40, "← Back", {
      color: COLORS.restart,
      hoverColor: COLORS.restartHover,
      onClick: () => this.scene.start("ClassSelectScene"),
    });

    // Everything that changes with the filter/page is rebuilt into this.
    this.dynamic = this.add.container(0, 0);

    this.input.keyboard?.on("keydown-LEFT", () => this.turnPage(-1));
    this.input.keyboard?.on("keydown-RIGHT", () => this.turnPage(1));

    this.render();
    this.loadArtwork();
  }

  // --- state ---------------------------------------------------------------

  visibleCards() {
    return this.filter === ALL ? this.cards : this.cards.filter((c) => c.category === this.filter);
  }

  pageCount() {
    return Math.max(1, Math.ceil(this.visibleCards().length / PAGE_SIZE));
  }

  setFilter(filter) {
    this.filter = filter;
    this.page = 0;
    this.render();
  }

  turnPage(delta) {
    const next = Phaser.Math.Clamp(this.page + delta, 0, this.pageCount() - 1);
    if (next === this.page) return;
    this.page = next;
    this.render();
  }

  // Queue every card's artwork that isn't loaded yet; re-render once they're
  // in. A failed image is just skipped -- that card keeps its icon.
  loadArtwork() {
    const pending = this.cards.filter((card) => card.imageUrl && !this.textures.exists(artKey(card)));
    if (pending.length === 0) return;

    this.load.setCORS("anonymous"); // Storage URLs are on another origin
    for (const card of pending) this.load.image(artKey(card), card.imageUrl);
    this.load.on("loaderror", (file) => console.warn(`[gallery] Couldn't load artwork for "${file.key}" (${file.url})`));
    this.load.once("complete", () => {
      if (this.sys.isActive()) this.render();
    });
    this.load.start();
  }

  // --- drawing -------------------------------------------------------------

  render() {
    this.dynamic.removeAll(true);
    this.renderTabs();
    this.renderGrid();
    this.renderPager();
  }

  renderTabs() {
    const tabs = [ALL, ...CATEGORY_ORDER];
    const totalW = tabs.length * TAB_W + (tabs.length - 1) * TAB_GAP;
    let x = 480 - totalW / 2;

    for (const tab of tabs) {
      const count = tab === ALL ? this.cards.length : this.cards.filter((c) => c.category === tab).length;
      const active = tab === this.filter;
      const color = tab === ALL ? COLORS.restart : COLORS.card[tab];

      const container = this.add.container(x, TAB_Y);
      const bg = roundedRect(this, TAB_W, TAB_H, active ? color : COLORS.panel, 8);
      const label = this.add
        .text(TAB_W / 2, TAB_H / 2, `${capitalize(tab)} (${count})`, {
          fontFamily: FONT_FAMILY,
          fontSize: "13px",
          fontStyle: active ? "700" : "400",
          color: active ? TEXT.white : TEXT.muted,
        })
        .setOrigin(0.5);
      container.add([bg, label]);

      if (!active) {
        bg.on("pointerover", () => label.setColor(TEXT.white));
        bg.on("pointerout", () => label.setColor(TEXT.muted));
        bg.on("pointerdown", () => this.setFilter(tab));
      }

      this.dynamic.add(container);
      x += TAB_W + TAB_GAP;
    }
  }

  renderGrid() {
    const cards = this.visibleCards().slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE);
    if (cards.length === 0) {
      this.dynamic.add(
        this.add
          .text(480, GRID_Y + 120, "No cards in this category yet.", { fontFamily: FONT_FAMILY, fontSize: "14px", color: TEXT.muted })
          .setOrigin(0.5, 0)
      );
      return;
    }

    // Each row is centered on its own, so a short last row (or a filter with
    // only a few cards) sits in the middle instead of hugging the left edge.
    cards.forEach((card, i) => {
      const row = Math.floor(i / COLS);
      const inRow = Math.min(COLS, cards.length - row * COLS);
      const rowW = inRow * CARD_W + (inRow - 1) * CARD_GAP;
      const x = 480 - rowW / 2 + (i % COLS) * (CARD_W + CARD_GAP);
      const y = GRID_Y + row * (CARD_H + CARD_GAP);
      this.dynamic.add(this.createCardTile(x, y, card));
    });
  }

  createCardTile(x, y, card) {
    const container = this.add.container(x, y);
    const bg = roundedRect(this, CARD_W, CARD_H, COLORS.card[card.category] ?? COLORS.panel, 10);
    container.add(bg);

    // Artwork box: the card's own image if it has loaded, else its icon.
    const artBox = this.add.graphics();
    artBox.fillStyle(COLORS.background, 0.35);
    artBox.fillRoundedRect(ART_X, ART_Y, ART_W, ART_H, 8);
    container.add(artBox);

    const artCenterX = ART_X + ART_W / 2;
    const artCenterY = ART_Y + ART_H / 2;
    if (card.imageUrl && this.textures.exists(artKey(card))) {
      // Fit the whole image inside the box, keeping its aspect ratio.
      const image = this.add.image(artCenterX, artCenterY, artKey(card));
      image.setScale(Math.min((ART_W - 8) / image.width, (ART_H - 8) / image.height));
      container.add(image);
    } else if (this.textures.exists(CARD_ICON_KEY[card.category])) {
      container.add(this.add.image(artCenterX, artCenterY, CARD_ICON_KEY[card.category]).setDisplaySize(56, 56));
    }

    const accent = damageAccentColor(card.props.damageType);
    if (accent !== null) {
      container.add(this.add.circle(ART_X + ART_W - 12, ART_Y + 12, 6, accent).setStrokeStyle(1, COLORS.background));
    }

    container.add(
      this.add
        .text(CARD_W / 2, ART_Y + ART_H + 8, card.category.toUpperCase(), {
          fontFamily: FONT_FAMILY,
          fontSize: "10px",
          color: TEXT.white,
        })
        .setOrigin(0.5, 0)
        .setAlpha(0.8)
    );

    container.add(
      this.add
        .text(CARD_W / 2, ART_Y + ART_H + 24, card.name, {
          fontFamily: FONT_FAMILY,
          fontSize: "14px",
          fontStyle: "700",
          color: TEXT.white,
          align: "center",
          wordWrap: { width: CARD_W - 16 },
        })
        .setOrigin(0.5, 0)
    );

    container.add(
      this.add
        .text(CARD_W / 2, ART_Y + ART_H + 60, describeCard({ ...card.props, category: card.category, name: card.name }), {
          fontFamily: FONT_FAMILY,
          fontSize: "11px",
          color: TEXT.white,
          align: "center",
          wordWrap: { width: CARD_W - 16 },
        })
        .setOrigin(0.5, 0)
        .setAlpha(0.9)
    );

    this.addDeckRow(container, card);

    bg.on("pointerover", () => this.tweens.add({ targets: container, y: y - 4, duration: 100 }));
    bg.on("pointerout", () => this.tweens.add({ targets: container, y, duration: 100 }));
    return container;
  }

  // Bottom row of a tile: which classes start with this card, as
  // "[class icon] ×copies" pairs (or a note if no deck uses it).
  addDeckRow(container, card) {
    const rowY = CARD_H - 22;
    const entries = deckEntriesForCard(card.id);
    if (entries.length === 0) {
      container.add(
        this.add
          .text(CARD_W / 2, rowY, "not in any deck", { fontFamily: FONT_FAMILY, fontSize: "10px", color: TEXT.white })
          .setOrigin(0.5)
          .setAlpha(0.7)
      );
      return;
    }

    const items = entries.map(({ classDef, copies }) => {
      const parts = [];
      if (this.textures.exists(classIconKey(classDef.id))) {
        parts.push(this.add.image(0, rowY, classIconKey(classDef.id)).setDisplaySize(16, 16).setOrigin(0, 0.5));
      }
      parts.push(
        this.add
          .text(0, rowY, `×${copies}`, { fontFamily: FONT_FAMILY, fontSize: "11px", color: TEXT.white })
          .setOrigin(0, 0.5)
      );
      return parts;
    });

    // Lay the pairs out centered: icon, 3px, text, 10px gap, next pair...
    const widthOf = (parts) => parts.reduce((w, p) => w + p.displayWidth, 0) + (parts.length - 1) * 3;
    const totalW = items.reduce((w, parts) => w + widthOf(parts), 0) + (items.length - 1) * 10;
    let x = CARD_W / 2 - totalW / 2;
    for (const parts of items) {
      for (const part of parts) {
        part.x = x;
        x += part.displayWidth + 3;
        container.add(part);
      }
      x += 7;
    }
  }

  renderPager() {
    const pages = this.pageCount();
    if (pages <= 1) return;

    const prev = createButton(this, 480 - 150, FOOTER_Y, 90, 40, "‹ Prev", {
      color: COLORS.restart,
      hoverColor: COLORS.restartHover,
      onClick: () => this.turnPage(-1),
    });
    const next = createButton(this, 480 + 60, FOOTER_Y, 90, 40, "Next ›", {
      color: COLORS.restart,
      hoverColor: COLORS.restartHover,
      onClick: () => this.turnPage(1),
    });
    prev.setEnabled(this.page > 0);
    next.setEnabled(this.page < pages - 1);

    const label = this.add
      .text(480, FOOTER_Y + 20, `${this.page + 1} / ${pages}`, { fontFamily: FONT_FAMILY, fontSize: "14px", color: TEXT.body })
      .setOrigin(0.5);

    this.dynamic.add([prev.container, next.container, label]);
  }
}
