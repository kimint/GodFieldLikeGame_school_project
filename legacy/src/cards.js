// Card definitions and deck creation (no art -- just a type and a value)

// Card types
const CARD_TYPE = {
  ATTACK: "attack",   // attack: reduces the opponent's HP
  DEFENSE: "defense", // defense: raises your shield to absorb the next attack
};

// Counter used to give every card a unique id
let cardIdCounter = 0;

// Create a single card
function createCard(type, value) {
  return {
    id: ++cardIdCounter,
    type,
    value,
  };
}

// Build the starting deck: several copies of each attack and defense card
function buildDeck() {
  const deck = [];

  // Attack cards: values 2-10, 3 copies each
  for (let value = 2; value <= 10; value++) {
    for (let i = 0; i < 3; i++) {
      deck.push(createCard(CARD_TYPE.ATTACK, value));
    }
  }

  // Defense cards: values 1-8, 3 copies each
  for (let value = 1; value <= 8; value++) {
    for (let i = 0; i < 3; i++) {
      deck.push(createCard(CARD_TYPE.DEFENSE, value));
    }
  }

  return shuffle(deck);
}

// Return a shuffled copy of the array (Fisher-Yates)
function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
