// 화면 렌더링과 사용자 입력 처리

let game = createGame();

// 자주 쓰는 DOM 요소 모음
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

// 게임 상태를 화면에 반영한다
function render() {
  el.playerHp.textContent = game.player.hp;
  el.playerShield.textContent = game.player.shield;
  el.cpuHp.textContent = game.cpu.hp;
  el.cpuShield.textContent = game.cpu.shield;

  // 손패를 카드 버튼으로 그린다
  el.hand.innerHTML = "";
  for (const card of game.player.hand) {
    const button = document.createElement("button");
    button.className = `card card--${card.type}`;
    button.disabled = game.turn !== "player" || game.winner !== null;

    const type = document.createElement("span");
    type.className = "card__type";
    type.textContent = card.type === CARD_TYPE.ATTACK ? "공격" : "수비";

    const value = document.createElement("span");
    value.className = "card__value";
    value.textContent = card.value;

    button.append(type, value);
    button.addEventListener("click", () => onCardClick(card.id));
    el.hand.appendChild(button);
  }

  // 진행 기록 (최근 12줄)
  el.log.innerHTML = "";
  for (const line of game.log.slice(0, 12)) {
    const li = document.createElement("li");
    li.textContent = line;
    el.log.appendChild(li);
  }

  // 턴 안내
  if (game.winner) {
    el.turn.textContent = `${game.winner.name} 승리! "다시 시작"을 눌러 주세요.`;
  } else {
    el.turn.textContent = game.turn === "player" ? "당신의 턴" : "CPU 턴...";
  }
}

// 플레이어가 카드를 클릭했을 때
function onCardClick(cardId) {
  if (game.turn !== "player" || game.winner) return;

  playerPlay(game, cardId);
  render();
  if (game.winner) return;

  // 연출을 위해 잠시 뒤 CPU가 행동한다
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
