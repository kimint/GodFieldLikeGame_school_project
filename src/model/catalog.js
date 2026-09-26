// The game catalog -- every class, synergy, and card the engine can use --
// loaded from the Supabase catalog tables (supabase/migrations/*_game_catalog.sql)
// or, offline, from the local copy in catalogData.js.
//
// Rows are turned into the same objects the rest of src/model/ has always
// used (createClass / createSynergy shapes), and kept in one module-level
// catalog. Everything that looks things up (findClassById, allClasses,
// buildDeckForClass) is synchronous, so callers only have to make sure a
// catalog was loaded once before starting -- main.js does that before Phaser
// starts, the Edge Function before handling a request.
//
// Deliberately forgiving about data it doesn't understand, so rows added for
// a newer version of the game don't break an older build: cards with an
// unknown category are left out of decks, deck/synergy links to missing rows
// are dropped, and unknown stats are ignored by createStats. Each is warned
// about once in the console.

import { createClass } from "./classes.js";
import { createSynergy } from "./synergies.js";
import { CARD_CATEGORY, createCardInstance } from "./cardTypes.js";
import { shuffle } from "./util.js";
import { LOCAL_CATALOG_ROWS } from "./catalogData.js";

const KNOWN_CATEGORIES = new Set(Object.values(CARD_CATEGORY));
const TABLES = ["synergies", "classes", "class_synergies", "cards", "class_deck_cards"];

let current = null;

// rows: { synergies, classes, class_synergies, cards, class_deck_cards },
// each an array of table rows.
export function buildCatalog(rows, source = "unknown") {
  const warn = (message) => console.warn(`[catalog] ${message}`);

  const synergies = new Map();
  for (const row of rows.synergies) {
    synergies.set(
      row.id,
      createSynergy({
        id: row.id,
        name: row.name,
        description: row.description ?? "",
        countsCategory: row.counts_category,
        tiers: [...(row.tiers ?? [])].sort((a, b) => a.count - b.count),
      })
    );
  }

  const cards = new Map();
  for (const row of rows.cards) {
    if (!KNOWN_CATEGORIES.has(row.category)) {
      warn(`skipping card "${row.id}": unknown category "${row.category}"`);
      continue;
    }
    cards.set(row.id, { id: row.id, name: row.name, category: row.category, props: row.props ?? {} });
  }

  const poolByClass = new Map();
  for (const link of rows.class_synergies) {
    const synergy = synergies.get(link.synergy_id);
    if (!synergy) {
      warn(`class "${link.class_id}" links missing synergy "${link.synergy_id}"`);
      continue;
    }
    if (!poolByClass.has(link.class_id)) poolByClass.set(link.class_id, []);
    poolByClass.get(link.class_id).push(synergy);
  }

  const deckByClass = new Map();
  for (const entry of rows.class_deck_cards) {
    const card = cards.get(entry.card_id);
    if (!card) continue; // already warned above if it was an unknown category
    if (!deckByClass.has(entry.class_id)) deckByClass.set(entry.class_id, []);
    deckByClass.get(entry.class_id).push({ copies: entry.copies, card });
  }

  const classes = [...rows.classes]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id.localeCompare(b.id))
    .map((row) =>
      createClass({
        id: row.id,
        name: row.name,
        baseStats: row.base_stats ?? {},
        synergyPool: poolByClass.get(row.id) ?? [],
        ultimate: row.ultimate,
        passives: row.passives ?? [],
      })
    );

  return {
    source, // "supabase" | "local" -- where these rows came from
    classes,
    classById: new Map(classes.map((c) => [c.id, c])),
    cards,
    deckByClass,
  };
}

export function setCatalog(catalog) {
  current = catalog;
}

export function getCatalog() {
  if (!current) throw new Error("Game catalog not loaded yet -- call loadCatalog() / useLocalCatalog() first");
  return current;
}

export function useLocalCatalog() {
  setCatalog(buildCatalog(LOCAL_CATALOG_ROWS, "local"));
  return current;
}

// `client` is a supabase-js client -- the browser's (publishable key) or the
// Edge Function's (service role); both can read the catalog.
export async function fetchCatalogRows(client) {
  const results = await Promise.all(TABLES.map((table) => client.from(table).select("*")));
  const rows = {};
  TABLES.forEach((table, i) => {
    const { data, error } = results[i];
    if (error) throw new Error(`Couldn't load ${table}: ${error.message}`);
    rows[table] = data;
  });
  if (rows.classes.length === 0) throw new Error("The classes table is empty");
  return rows;
}

export async function loadCatalog(client) {
  setCatalog(buildCatalog(await fetchCatalogRows(client), "supabase"));
  return current;
}

// --- lookups used by the engine, serializer, UI, and server -------------

export function allClasses() {
  return getCatalog().classes;
}

export function findClassById(id) {
  const classDef = getCatalog().classById.get(id);
  if (!classDef) throw new Error(`Unknown class "${id}"`);
  return classDef;
}

// A fresh shuffled deck of card instances for a class.
export function buildDeckForClass(classDef) {
  const entries = getCatalog().deckByClass.get(classDef.id);
  if (!entries || entries.length === 0) throw new Error(`No deck for class "${classDef.id}"`);
  const deck = [];
  for (const { copies, card } of entries) {
    for (let i = 0; i < copies; i++) deck.push(createCardInstance(card));
  }
  return shuffle(deck);
}
