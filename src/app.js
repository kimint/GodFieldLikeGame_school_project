// UI controller for the class-based battle built on src/model/*. This is what
// index.html actually plays now; the original simple prototype lives under
// legacy/ (see README.md).

const ALL_CLASSES = [exampleClassGuardian, exampleClassPyromancer];

let battle = null;

const el = {
  classSelect: document.getElementById("class-select"),
  classOptions: document.getElementById("class-options"),
  battleSection: document.getElementById("battle"),
  cpuPanel: document.getElementById("cpu-panel"),
  playerPanel: document.getElementById("player-panel"),
  hand: document.getElementById("hand"),
  log: document.getElementById("log"),
  status: document.getElementById("status"),
  restart: document.getElementById("restart"),
  ultimateBtn: document.getElementById("ultimate-btn"),
};

// --- small icon helper ------------------------------------------------------

// Build a <span class="inline-icon"> (or a custom className) wrapping some
// icon markup from src/icons.js, so it can be dropped inline next to text.
function inlineIcon(markup, className = "inline-icon") {
  const span = document.createElement("span");
  span.className = className;
  span.innerHTML = markup;
  return span;
}

// --- class select ---------------------------------------------------------

function renderClassSelect() {
  el.classOptions.innerHTML = "";
  for (const classDef of ALL_CLASSES) {
    const card = document.createElement("button");
    card.className = "class-card";

    const header = document.createElement("div");
    header.className = "class-card__header";
    const icon = inlineIcon(classIconMarkup(classDef), "class-card__icon");
    const title = document.createElement("h3");
    title.textContent = classDef.name;
    header.append(icon, title);

    const stats = document.createElement("p");
    stats.textContent =
      `HP ${classDef.baseStats.hp}  DEF ${classDef.baseStats.def}  MR ${classDef.baseStats.mr}  ` +
      `ER ${classDef.baseStats.er}  UR ${classDef.baseStats.ur}`;

    const synergy = document.createElement("p");
    synergy.textContent = `Synergy: ${classDef.synergyPool.map((s) => s.name).join(", ")}`;

    const ultimate = document.createElement("p");
    ultimate.append(
      inlineIcon(ultimateIconMarkup()),
      document.createTextNode(
        `Ultimate: ${classDef.ultimate.name} (cost ${classDef.ultimate.cost}, ${classDef.ultimate.damage} dmg)`
      )
    );

    card.append(header, stats, synergy, ultimate);
    card.addEventListener("click", () => startBattle(classDef));
    el.classOptions.appendChild(card);
  }
}

function startBattle(playerClass) {
  const cpuClass = ALL_CLASSES.find((c) => c.id !== playerClass.id) ?? playerClass;
  battle = createBattle(playerClass, cpuClass);
  el.classSelect.hidden = true;
  el.battleSection.hidden = false;
  render();
}

// --- battle rendering -------------------------------------------------------

function renderFighterPanel(container, fighter, label) {
  const stats = computeCurrentStats(fighter);
  const meterPct = Math.min(100, Math.round((fighter.ultimateMeter / fighter.classDef.ultimate.cost) * 100));

  container.innerHTML = "";

  const heading = document.createElement("h2");
  heading.append(
    inlineIcon(classIconMarkup(fighter.classDef)),
    document.createTextNode(`${label} — ${fighter.classDef.name}`)
  );
  container.appendChild(heading);

  const hp = document.createElement("p");
  hp.textContent = `HP ${Math.ceil(fighter.hp)} / ${fighter.maxHp}`;
  container.appendChild(hp);

  const statLine = document.createElement("p");
  statLine.textContent = `DEF ${stats.def}  MR ${stats.mr}  ER ${stats.er}  UR ${stats.ur}`;
  container.appendChild(statLine);

  const defendTypes = Object.keys(fighter.activeDefends);
  const defendLine = document.createElement("p");
  defendLine.textContent =
    defendTypes.length > 0
      ? `Active defend: ${defendTypes.map((t) => `${t} (${fighter.activeDefends[t].remaining}t)`).join(", ")}`
      : "Active defend: none";
  container.appendChild(defendLine);

  const meterWrap = document.createElement("div");
  meterWrap.className = "meter";
  const meterFill = document.createElement("div");
  meterFill.className = "meter__fill";
  meterFill.style.width = `${meterPct}%`;
  meterWrap.appendChild(meterFill);
  container.appendChild(meterWrap);

  const meterLabel = document.createElement("p");
  meterLabel.className = "meter__label";
  meterLabel.append(
    inlineIcon(ultimateIconMarkup()),
    document.createTextNode(`Ultimate ${fighter.ultimateMeter}/${fighter.classDef.ultimate.cost}`)
  );
  container.appendChild(meterLabel);
}

function render() {
  const over = Boolean(battle.winner) || battle.draw;

  renderFighterPanel(el.cpuPanel, battle.cpu, "CPU");
  renderFighterPanel(el.playerPanel, battle.player, "Player");

  el.hand.innerHTML = "";
  for (const card of battle.player.hand) {
    const button = document.createElement("button");
    button.className = `card card--${card.category}`;
    button.disabled = over;

    const icon = document.createElement("span");
    icon.className = "card__icon";
    icon.innerHTML = cardIconMarkup(card);

    const category = document.createElement("span");
    category.className = "card__type";
    category.textContent = card.category;

    const name = document.createElement("span");
    name.className = "card__name";
    name.textContent = card.name;

    const detail = document.createElement("span");
    detail.className = "card__value";
    detail.textContent = describeCard(card);

    button.append(icon, category, name, detail);
    button.addEventListener("click", () => onCardClick(card.id));
    el.hand.appendChild(button);
  }

  el.log.innerHTML = "";
  for (const line of battle.log.slice(0, 16)) {
    const li = document.createElement("li");
    li.textContent = line;
    el.log.appendChild(li);
  }

  if (battle.winner) {
    el.status.textContent = `${battle.winner.classDef.name} wins! Press "Restart" to play again.`;
  } else if (battle.draw) {
    el.status.textContent = `Draw! Press "Restart" to play again.`;
  } else {
    el.status.textContent = `Round ${battle.round} — pick a card. The CPU is choosing at the same time.`;
  }

  el.ultimateBtn.disabled = over || !canUseUltimate(battle.player);
}

// --- input handling ---------------------------------------------------------
//
// Both of these commit the player's action and resolve the whole round in
// one call (playRound picks the CPU's action itself, without seeing this
// one) -- there's no separate "wait for the CPU" step because nothing is
// waiting on anything, the two choices resolve together.

function onCardClick(cardId) {
  if (Boolean(battle.winner) || battle.draw) return;
  const action = cardAction(battle.player, cardId);
  if (!action) return;

  playRound(battle, action);
  render();
}

// The button's label never changes (only its disabled state does, in
// render()), so build it once here instead of every render. Clears the
// static "Use Ultimate" text from index.html first so it isn't duplicated.
el.ultimateBtn.textContent = "";
el.ultimateBtn.append(inlineIcon(ultimateIconMarkup()), document.createTextNode("Use Ultimate"));

el.ultimateBtn.addEventListener("click", () => {
  if (!battle || battle.winner || battle.draw) return;
  const action = ultimateAction(battle.player);
  if (!action) return;

  playRound(battle, action);
  render();
});

el.restart.addEventListener("click", () => {
  battle = null;
  el.battleSection.hidden = true;
  el.classSelect.hidden = false;
});

renderClassSelect();
