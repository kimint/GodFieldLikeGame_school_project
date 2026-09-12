// Damage / resistance typing shared by attack and defend cards.
// See docs/DESIGN.md ("General card types").

const DAMAGE_TYPE = {
  PHYSICAL: "physical",
  MAGIC: "magic",
  ELEMENT: "element",
  TRUE: "true", // ignores all resistances
};

// Which stat resists each damage type. TRUE damage has no entry here -- it is
// never reduced by a stat, only by an explicit defend card that targets "true".
const RESIST_STAT = {
  [DAMAGE_TYPE.PHYSICAL]: "def",
  [DAMAGE_TYPE.MAGIC]: "mr",
  [DAMAGE_TYPE.ELEMENT]: "er",
};
