// 게임 상태와 규칙 (화면과 분리된 순수 로직)

const STARTING_HP = 40; // 시작 HP
const HAND_SIZE = 5;    // 손패 장수

// 새 게임 상태를 만든다
function createGame() {
  const game = {
    deck: buildDeck(), // 뽑을 카드 더미
    discard: [],        // 사용한 카드 더미
    turn: "player",     // "player" 또는 "cpu"
    winner: null,        // 승자 (없으면 null)
    log: [],             // 진행 기록 (최신이 앞)
    player: { name: "플레이어", hp: STARTING_HP, shield: 0, hand: [] },
    cpu: { name: "CPU", hp: STARTING_HP, shield: 0, hand: [] },
  };

  // 시작 손패 배분
  drawUpTo(game, game.player);
  drawUpTo(game, game.cpu);

  addLog(game, "게임 시작. 카드를 골라 사용하세요.");
  return game;
}

// 덱에서 카드 한 장을 뽑는다. 덱이 비면 사용한 카드를 섞어 다시 쓴다.
function drawCard(game) {
  if (game.deck.length === 0) {
    if (game.discard.length === 0) return null; // 뽑을 카드가 아예 없음
    game.deck = shuffle(game.discard);
    game.discard = [];
  }
  return game.deck.pop();
}

// 손패를 HAND_SIZE 장까지 채운다
function drawUpTo(game, actor) {
  while (actor.hand.length < HAND_SIZE) {
    const card = drawCard(game);
    if (!card) break;
    actor.hand.push(card);
  }
}

// attacker 가 defender 에게 card 를 사용한다
function playCard(game, attacker, defender, card) {
  if (card.type === CARD_TYPE.ATTACK) {
    // 상대의 수비 수치가 먼저 피해를 막고, 남은 만큼 HP가 깎인다
    const blocked = Math.min(defender.shield, card.value);
    const damage = card.value - blocked;
    defender.shield -= blocked;
    defender.hp = Math.max(0, defender.hp - damage);

    addLog(
      game,
      `${attacker.name}의 공격 ${card.value} → ${defender.name} ${damage} 피해` +
        (blocked > 0 ? ` (수비로 ${blocked} 막음)` : "")
    );
  } else {
    // 수비 카드: 자신의 수비 수치를 올린다
    attacker.shield += card.value;
    addLog(game, `${attacker.name} 수비 ${card.value} 사용 (총 수비 ${attacker.shield})`);
  }

  // 사용한 카드는 손패에서 빼고 버린 더미로 옮긴다
  const index = attacker.hand.findIndex((c) => c.id === card.id);
  if (index !== -1) attacker.hand.splice(index, 1);
  game.discard.push(card);

  // 승패 확인
  if (defender.hp <= 0) {
    game.winner = attacker;
    addLog(game, `${attacker.name} 승리!`);
  }
}

// 플레이어가 손패에서 카드를 선택했을 때
function playerPlay(game, cardId) {
  if (game.winner || game.turn !== "player") return;

  const card = game.player.hand.find((c) => c.id === cardId);
  if (!card) return;

  playCard(game, game.player, game.cpu, card);
  if (game.winner) return;

  drawUpTo(game, game.player);
  game.turn = "cpu";
}

// CPU 턴 진행 (아주 단순한 AI)
function cpuPlay(game) {
  if (game.winner || game.turn !== "cpu") return;

  const hand = game.cpu.hand;
  const attacks = hand.filter((c) => c.type === CARD_TYPE.ATTACK);
  const defenses = hand.filter((c) => c.type === CARD_TYPE.DEFENSE);

  let card;
  if (game.cpu.hp <= 15 && defenses.length > 0 && Math.random() < 0.6) {
    // HP가 낮으면 가끔 수비 카드를 쓴다
    card = defenses.reduce((a, b) => (a.value >= b.value ? a : b));
  } else if (attacks.length > 0) {
    // 평소에는 가장 강한 공격 카드를 쓴다
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

// 로그를 추가한다 (최신 기록이 앞에 오도록)
function addLog(game, message) {
  game.log.unshift(message);
}
