// Simple hand-authored SVG icons for cards, classes, and the ultimate --
// there's still no illustrated artwork (see README's "Card art" note), just a
// small pictographic layer so each of these has *something* visual beyond
// text.
//
// This is UI-only (produces markup strings), so it lives alongside the UI
// rather than in src/model/, which stays DOM-free.

import { DAMAGE_TYPE, ELEMENT, type DamageType, type Element } from "./model/damageTypes.ts";
import { CARD_CATEGORY, type CardCategory } from "./model/cardTypes.ts";

export const DAMAGE_TYPE_ACCENT: Record<DamageType, string> = {
  [DAMAGE_TYPE.PHYSICAL]: "#c9c9c9",
  [DAMAGE_TYPE.MAGIC]: "#b388ff",
  [DAMAGE_TYPE.ELEMENT]: "#ff9d4d",
  [DAMAGE_TYPE.TRUE]: "#ffe066",
};

// Elements (damageTypes.ts ELEMENT) get their own accent, drawn instead of
// the damage-type one when a card has an element.
export const ELEMENT_ACCENT: Record<Element, string> = {
  [ELEMENT.FIRE]: "#ff7a1a",
  [ELEMENT.WATER]: "#4fa3ff",
  [ELEMENT.ELECTRIC]: "#ffe94d",
};

// Inner SVG markup (no outer <svg> tag) for each card category's base icon:
// a sword for attack, a shield for defend, an upward spark for buff, and a
// downward drain for debuff.
const CATEGORY_ICON_BODY: Record<CardCategory, string> = {
  [CARD_CATEGORY.ATTACK]: `
    <path d="M12 2 L14 4 L13 14 L11 14 L10 4 Z" fill="#fff"/>
    <rect x="8" y="14" width="8" height="2" rx="1" fill="#fff"/>
    <rect x="11" y="16" width="2" height="5" rx="1" fill="#fff"/>
    <circle cx="12" cy="21.5" r="1.3" fill="#fff"/>
  `,
  [CARD_CATEGORY.DEFEND]: `
    <path d="M12 2 L20 5 V11 C20 16 16.5 20 12 22 C7.5 20 4 16 4 11 V5 Z" fill="#fff" opacity="0.92"/>
  `,
  [CARD_CATEGORY.BUFF]: `
    <path d="M12 3 L19 12 H15 V21 H9 V12 H5 Z" fill="#fff"/>
    <circle cx="18" cy="5" r="1.4" fill="#fff"/>
    <circle cx="6" cy="7" r="1" fill="#fff"/>
  `,
  [CARD_CATEGORY.DEBUFF]: `
    <path d="M12 21 L5 12 H9 V3 H15 V12 H19 Z" fill="#fff"/>
    <ellipse cx="12" cy="22.6" rx="3" ry="1" fill="#fff" opacity="0.6"/>
  `,
  // A clawed paw print.
  [CARD_CATEGORY.MONSTER]: `
    <ellipse cx="12" cy="15.5" rx="5.2" ry="4.6" fill="#fff"/>
    <ellipse cx="5.4" cy="9.6" rx="2" ry="2.6" fill="#fff"/>
    <ellipse cx="9.4" cy="5.6" rx="2" ry="2.7" fill="#fff"/>
    <ellipse cx="14.6" cy="5.6" rx="2" ry="2.7" fill="#fff"/>
    <ellipse cx="18.6" cy="9.6" rx="2" ry="2.6" fill="#fff"/>
  `,
};

// Build the <svg> markup for one card: its category's base shape, plus a
// damage-type accent dot for attack/defend cards (buff/debuff aren't typed by
// damage, so they don't get one).
export function cardIconMarkup(card: { category: CardCategory; damageType?: DamageType }): string {
  const body = CATEGORY_ICON_BODY[card.category] ?? "";
  const isTyped = card.category === CARD_CATEGORY.ATTACK || card.category === CARD_CATEGORY.DEFEND;
  const accent = isTyped && card.damageType ? DAMAGE_TYPE_ACCENT[card.damageType] : null;
  const dot = accent
    ? `<circle cx="19.5" cy="4.5" r="2.6" fill="${accent}" stroke="#1f2023" stroke-width="0.8"/>`
    : "";
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}${dot}</svg>`;
}

// --- class icons -----------------------------------------------------------
//
// One emblem per class id, shown on the class-select card and the fighter
// panel heading. Keyed by classDef.id rather than name so it survives a
// rename; a class with no entry here just renders no icon.

const CLASS_ICON_BODY: Record<string, string> = {
  // A shield with a small crest, in the same blue as defend cards -- fits
  // Guardian's tanky/defend-leaning theme.
  guardian: `
    <path d="M12 2 L20 5 V11 C20 16 16.5 20 12 22 C7.5 20 4 16 4 11 V5 Z" fill="#fff" opacity="0.92"/>
    <path d="M12 6.5 L12 16.5" stroke="#2f6f8f" stroke-width="1.6"/>
    <circle cx="12" cy="9.5" r="1.7" fill="#2f6f8f"/>
  `,
  // A two-tone flame, warm orange over a pale gold core -- fits Pyromancer's
  // elemental/aggressive theme.
  pyromancer: `
    <path d="M12 2 C8 7 6 10 6 13.5 C6 17.6 8.7 21 12 21 C15.3 21 18 17.6 18 13.5
             C18 11.8 17.3 10.2 16 9 C16.2 11 15.2 12.3 14 12.8
             C14.6 10.5 13.6 8 12 2 Z" fill="#ff9d4d"/>
    <path d="M12 9 C10.3 12 9.7 13.6 9.7 15.2 C9.7 17.1 10.7 18.5 12 18.5
             C13.3 18.5 14.3 17.1 14.3 15.2 C14.3 14.3 14 13.5 13.4 12.8
             C13.2 13.6 12.7 14.1 12.2 14.2 C12.6 12.9 12.3 11.5 12 9 Z" fill="#ffe066"/>
  `,
  // A violet crescent moon with a small star -- Black Mage's dark magic.
  black_mage: `
    <path d="M15.5 3 A9 9 0 1 0 21 17.5 A7.2 7.2 0 1 1 15.5 3 Z" fill="#b388ff"/>
    <path d="M18 5 L18.7 6.8 L20.5 7.5 L18.7 8.2 L18 10 L17.3 8.2 L15.5 7.5 L17.3 6.8 Z" fill="#fff"/>
  `,
  // A hammer over an anvil -- Master Craftsman.
  craftsman: `
    <path d="M4 17 H20 L18 20 H6 Z" fill="#c9c9c9"/>
    <rect x="7" y="14.5" width="10" height="2.5" rx="0.8" fill="#9aa0ad"/>
    <g transform="rotate(-35 12 8)">
      <rect x="11" y="6" width="2" height="10" rx="1" fill="#c9a27a"/>
      <rect x="7.5" y="3" width="9" height="4" rx="1" fill="#fff"/>
    </g>
  `,
  // A pale skull -- Necromancer.
  necromancer: `
    <path d="M12 3 C7 3 4.5 6.5 4.5 10.5 C4.5 13 5.7 14.6 7.5 15.5 V19 H16.5 V15.5 C18.3 14.6 19.5 13 19.5 10.5 C19.5 6.5 17 3 12 3 Z" fill="#e9eaec"/>
    <circle cx="9" cy="10.8" r="2" fill="#1f2023"/>
    <circle cx="15" cy="10.8" r="2" fill="#1f2023"/>
    <path d="M12 13 L11 15 H13 Z" fill="#1f2023"/>
    <path d="M10 19 V17.2 M12 19 V17.2 M14 19 V17.2" stroke="#1f2023" stroke-width="0.9"/>
  `,
};

// Returns "" (no icon) for a class id that isn't in CLASS_ICON_BODY, rather
// than throwing -- a new class just quietly renders without one until an
// icon is added for it.
export function classIconMarkup(classDef: { id: string }): string {
  const body = CLASS_ICON_BODY[classDef.id];
  if (!body) return "";
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;
}

// --- ultimate icon -----------------------------------------------------------
//
// A single generic "burst" icon shared by every class's ultimate. Each class
// doesn't get its own ultimate icon (the way it gets its own class icon)
// because the ultimate's actual design/theme is still an open question --
// see docs/DESIGN.md ("name it something related to all in aspect maybe").

const ULTIMATE_ICON_BODY = `
  <path d="M12 1 L14 8 L21 6 L16 11.5 L22 15 L14.5 15 L15.5 22 L12 16.5
           L8.5 22 L9.5 15 L2 15 L8 11.5 L3 6 L10 8 Z" fill="#ffce54"/>
  <circle cx="12" cy="12" r="2.6" fill="#fff8e1"/>
`;

export function ultimateIconMarkup(): string {
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${ULTIMATE_ICON_BODY}</svg>`;
}

// --- settings icon -------------------------------------------------------------
//
// One big clip-art gear for the battle screen's settings button: ten chunky
// teeth, a dark outline, a raised hub ring and a hole through the middle.

const SETTINGS_ICON_BODY = `
  <path fill-rule="evenodd" fill="#dcdde0" stroke="#1a1b1e" stroke-width="0.8" stroke-linejoin="round"
        d="M9.47 3.78 L10.71 3.50 L10.95 0.85 L13.05 0.85 L13.29 3.50 L14.53 3.78 L14.79 3.86 L15.95 4.36 L17.70 2.36 L19.41 3.60 L18.04 5.88 L18.88 6.84 L19.04 7.05 L19.69 8.14 L22.28 7.55 L22.93 9.56 L20.49 10.60 L20.60 11.86 L20.60 12.14 L20.49 13.40 L22.93 14.44 L22.28 16.45 L19.69 15.86 L19.04 16.95 L18.88 17.16 L18.04 18.12 L19.41 20.40 L17.70 21.64 L15.95 19.64 L14.79 20.14 L14.53 20.22 L13.29 20.50 L13.05 23.15 L10.95 23.15 L10.71 20.50 L9.47 20.22 L9.21 20.14 L8.05 19.64 L6.30 21.64 L4.59 20.40 L5.96 18.12 L5.12 17.16 L4.96 16.95 L4.31 15.86 L1.72 16.45 L1.07 14.44 L3.51 13.40 L3.40 12.14 L3.40 11.86 L3.51 10.60 L1.07 9.56 L1.72 7.55 L4.31 8.14 L4.96 7.05 L5.12 6.84 L5.96 5.88 L4.59 3.60 L6.30 2.36 L8.05 4.36 L9.21 3.86 Z
           M12 8.6 a3.4 3.4 0 1 0 0.001 0 Z"/>
  <circle cx="12" cy="12" r="5.6" fill="none" stroke="#a0a2a8" stroke-width="1.1"/>
`;

export function settingsIconMarkup(): string {
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${SETTINGS_ICON_BODY}</svg>`;
}
