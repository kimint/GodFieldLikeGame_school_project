// Simple hand-authored SVG icons for cards -- there's still no illustrated
// artwork (see README's "no art" note), just a small pictographic layer so
// each card has *something* visual beyond text: one base shape per card
// category, plus a small colored corner dot on attack/defend cards showing
// their damage type.
//
// This is UI-only (produces markup strings for src/app.js to insert), so it
// lives alongside app.js rather than in src/model/, which stays DOM-free.

const DAMAGE_TYPE_ACCENT = {
  [DAMAGE_TYPE.PHYSICAL]: "#c9c9c9",
  [DAMAGE_TYPE.MAGIC]: "#b388ff",
  [DAMAGE_TYPE.ELEMENT]: "#ff9d4d",
  [DAMAGE_TYPE.TRUE]: "#ffe066",
};

// Inner SVG markup (no outer <svg> tag) for each card category's base icon:
// a sword for attack, a shield for defend, an upward spark for buff, and a
// downward drain for debuff.
const CATEGORY_ICON_BODY = {
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
};

// Build the <svg> markup for one card: its category's base shape, plus a
// damage-type accent dot for attack/defend cards (buff/debuff aren't typed by
// damage, so they don't get one).
function cardIconMarkup(card) {
  const body = CATEGORY_ICON_BODY[card.category] ?? "";
  const isTyped = card.category === CARD_CATEGORY.ATTACK || card.category === CARD_CATEGORY.DEFEND;
  const accent = isTyped ? DAMAGE_TYPE_ACCENT[card.damageType] : null;
  const dot = accent
    ? `<circle cx="19.5" cy="4.5" r="2.6" fill="${accent}" stroke="#1e2230" stroke-width="0.8"/>`
    : "";
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}${dot}</svg>`;
}
