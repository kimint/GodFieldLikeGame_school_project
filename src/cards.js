// 카드 정의와 덱 생성 로직 (일러스트 없이 종류와 수치만 가진다)

// 카드 종류
const CARD_TYPE = {
  ATTACK: "attack",   // 공격: 상대 HP를 깎는다
  DEFENSE: "defense", // 수비: 내 수비 수치를 올려 다음 공격을 막는다
};

// 카드마다 고유 번호를 붙이기 위한 카운터
let cardIdCounter = 0;

// 카드 한 장을 만든다
function createCard(type, value) {
  return {
    id: ++cardIdCounter,
    type,
    value,
  };
}

// 기본 덱 구성: 공격 카드와 수비 카드를 여러 장씩 넣는다
function buildDeck() {
  const deck = [];

  // 공격 카드: 수치 2~10, 각 3장
  for (let value = 2; value <= 10; value++) {
    for (let i = 0; i < 3; i++) {
      deck.push(createCard(CARD_TYPE.ATTACK, value));
    }
  }

  // 수비 카드: 수치 1~8, 각 3장
  for (let value = 1; value <= 8; value++) {
    for (let i = 0; i < 3; i++) {
      deck.push(createCard(CARD_TYPE.DEFENSE, value));
    }
  }

  return shuffle(deck);
}

// 배열을 섞어 새 배열로 돌려준다 (Fisher-Yates)
function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
