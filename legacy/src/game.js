// Game state and rules (pure logic, no DOM)

const STARTING_HP = 40; // starting HP for each fighter
const HAND_SIZE = 5;    // number of cards held in hand

// Create a fresh game state
function createGame() {
  const game = {
    deck: buildDeck(), // draw pile
    discard: [],        // discard pile
    turn: "player",     // "player" or "cpu"
    winner: null,        // winner (null while the game is ongoing)
    log: [],             // battle log (newest first)
    player: { name: "Player", hp: STARTING_HP, shield: 0, hand: [] },
    cpu: { name: "CPU", hp: STARTING_HP, shield: 0, hand: [] },
  };

  // Deal starting hands
  drawUpTo(game, game.player);
  drawUpTo(game, game.cpu);

  addLog(game, "Game start. Pick a card to use.");
  return game;
}

// Draw one card. When the draw pile is empty, reshuffle the discard pile.
function drawCard(game) {
  if (game.deck.length === 0) {
    if (game.discard.length === 0) return null; // no cards left anywhere
    game.deck = shuffle(game.discard);
    game.discard = [];
  }
  return game.deck.pop();
}

// Refill a hand up to HAND_SIZE cards
function drawUpTo(game, actor) {
  while (actor.hand.length < HAND_SIZE) {
    const card = drawCard(game);
    if (!card) break;
    actor.hand.push(card);
  }
}

// attacker uses card against defender
function playCard(game, attacker, defender, card) {
  if (card.type === CARD_TYPE.ATTACK) {
    // The defender's shield absorbs damage first; the rest comes off HP.
    const blocked = Math.min(defender.shield, card.value);
    const damage = card.value - blocked;
    defender.shield -= blocked;
    defender.hp = Math.max(0, defender.hp - damage);

    addLog(
      game,
      `${attacker.name} attacks for ${card.value} -> ${defender.name} takes ${damage}` +
        (blocked > 0 ? ` (shield blocked ${blocked})` : "")
    );
  } else {
    // Defense card: raise your own shield
    attacker.shield += card.value;
    addLog(game, `${attacker.name} uses defense ${card.value} (shield now ${attacker.shield})`);
  }

  // Remove the used card from hand and move it to the discard pile
  const index = attacker.hand.findIndex((c) => c.id === card.id);
  if (index !== -1) attacker.hand.splice(index, 1);
  game.discard.push(card);

  // Check for a winner
  if (defender.hp <= 0) {
    game.winner = attacker;
    addLog(game, `${attacker.name} wins!`);
  }
}

// Called when the player picks a card from their hand
function playerPlay(game, cardId) {
  if (game.winner || game.turn !== "player") return;

  const card = game.player.hand.find((c) => c.id === cardId);
  if (!card) return;

  playCard(game, game.player, game.cpu, card);
  if (game.winner) return;

  drawUpTo(game, game.player);
  game.turn = "cpu";
}

// Run the CPU turn (very simple AI)
function cpuPlay(game) {
  if (game.winner || game.turn !== "cpu") return;

  const hand = game.cpu.hand;
  const attacks = hand.filter((c) => c.type === CARD_TYPE.ATTACK);
  const defenses = hand.filter((c) => c.type === CARD_TYPE.DEFENSE);

  let card;
  if (game.cpu.hp <= 15 && defenses.length > 0 && Math.random() < 0.6) {
    // When low on HP, sometimes play a defense card
    card = defenses.reduce((a, b) => (a.value >= b.value ? a : b));
  } else if (attacks.length > 0) {
    // Otherwise play the strongest attack card
    card = attacks.reduce((a, b) => (a.value >= b.value ? a : b));
  } else {
    card = hand[0];
  }

  if (!card) {
    game.turn = "player";
    return;
  }

  playCard(game, game.cpu, game.player, card);
  if (game.winner) return;

  drawUpTo(game, game.cpu);
  game.turn = "player";
}

// Add a log line (newest first)
function addLog(game, message) {
  game.log.unshift(message);
}
