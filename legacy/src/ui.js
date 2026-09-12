// Rendering and user input handling

let game = createGame();

// Frequently used DOM elements
const el = {
  playerHp: document.getElementById("player-hp"),
  playerShield: document.getElementById("player-shield"),
  cpuHp: document.getElementById("cpu-hp"),
  cpuShield: document.getElementById("cpu-shield"),
  hand: document.getElementById("hand"),
  log: document.getElementById("log"),
  turn: document.getElementById("turn"),
  restart: document.getElementById("restart"),
};

// Render the current game state to the screen
function render() {
  el.playerHp.textContent = game.player.hp;
  el.playerShield.textContent = game.player.shield;
  el.cpuHp.textContent = game.cpu.hp;
  el.cpuShield.textContent = game.cpu.shield;

  // Draw the hand as card buttons
  el.hand.innerHTML = "";
  for (const card of game.player.hand) {
    const button = document.createElement("button");
    button.className = `card card--${card.type}`;
    button.disabled = game.turn !== "player" || game.winner !== null;

    const type = document.createElement("span");
    type.className = "card__type";
    type.textContent = card.type === CARD_TYPE.ATTACK ? "Attack" : "Defense";

    const value = document.createElement("span");
    value.className = "card__value";
    value.textContent = card.value;

    button.append(type, value);
    button.addEventListener("click", () => onCardClick(card.id));
    el.hand.appendChild(button);
  }

  // Battle log (latest 12 lines)
  el.log.innerHTML = "";
  for (const line of game.log.slice(0, 12)) {
    const li = document.createElement("li");
    li.textContent = line;
    el.log.appendChild(li);
  }

  // Turn indicator
  if (game.winner) {
    el.turn.textContent = `${game.winner.name} wins! Press "Restart" to play again.`;
  } else {
    el.turn.textContent = game.turn === "player" ? "Your turn" : "CPU's turn...";
  }
}

// Called when the player clicks a card
function onCardClick(cardId) {
  if (game.turn !== "player" || game.winner) return;

  playerPlay(game, cardId);
  render();
  if (game.winner) return;

  // Let the CPU act after a short delay for pacing
  setTimeout(() => {
    cpuPlay(game);
    render();
  }, 700);
}

el.restart.addEventListener("click", () => {
  game = createGame();
  render();
});

render();
