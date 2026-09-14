// Stat schema shared by every class. A stats object always has exactly these
// keys; a class or effect that doesn't care about a given stat just uses 0.
// See docs/DESIGN.md ("Basic stats").

export const STAT_KEYS = ["hp", "def", "mr", "er", "ur", "crit"];
// hp   - health points
// def  - physical defense
// mr   - magic resist
// er   - element resist
// ur   - ultimate regen rate
// crit - crit chance (open question in docs/DESIGN.md -- still deciding if this ships)

// Create a stats object with every key defaulting to 0, overridden by `values`.
export function createStats(values = {}) {
  const stats = {};
  for (const key of STAT_KEYS) {
    stats[key] = values[key] ?? 0;
  }
  return stats;
}
