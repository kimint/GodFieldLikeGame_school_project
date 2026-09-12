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
  turn: document.getElementById("turn"),
  restart: document.getElementById("restart"),
  ultimateBtn: document.getElementById("ultimate-btn"),
};

// --- class select ---------------------------------------------------------

function renderClassSelect() {
  el.classOptions.innerHTML = "";
  for (const classDef of ALL_CLASSES) {
    const card = document.createElement("button");
    card.className = "class-card";

    const title = document.createElement("h3");
    title.textContent = classDef.name;

    const stats = document.createElement("p");
    stats.textContent =
      `HP ${classDef.baseStats.hp}  DEF ${classDef.baseStats.def}  MR ${classDef.baseStats.mr}  ` +
      `ER ${classDef.baseStats.er}  UR ${classDef.baseStats.ur}`;

    const synergy = document.createElement("p");
    synergy.textContent = `Synergy: ${classDef.synergyPool.map((s) => s.name).join(", ")}`;

    const ultimate = document.createElement("p");
    ultimate.textContent =
      `Ultimate: ${classDef.ultimate.name} (cost ${classDef.ultimate.cost}, ${classDef.ultimate.damage} dmg)`;

    card.append(title, stats, synergy, ultimate);
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
  heading.textContent = `${label} — ${fighter.classDef.name}`;
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
  meterLabel.textContent = `Ultimate ${fighter.ultimateMeter}/${fighter.classDef.ultimate.cost}`;
  container.appendChild(meterLabel);
}

function render() {
  renderFighterPanel(el.cpuPanel, battle.cpu, "CPU");
  renderFighterPanel(el.playerPanel, battle.player, "Player");

  el.hand.innerHTML = "";
  for (const card of battle.player.hand) {
    const button = document.createElement("button");
    button.className = `card card--${card.category}`;
    button.disabled = battle.turn !== "player" || battle.winner !== null;

    const category = document.createElement("span");
    category.className = "card__type";
    category.textContent = card.category;

    const name = document.createElement("span");
    name.className = "card__name";
    name.textContent = card.name;

    const detail = document.createElement("span");
    detail.className = "card__value";
    detail.textContent = describeCard(card);

    button.append(category, name, detail);
    button.addEventListener("click", () => onCardClick(card.id));
    el.hand.appendChild(button);
  }

  el.log.innerHTML = "";
  for (const line of battle.log.slice(0, 14)) {
    const li = document.createElement("li");
    li.textContent = line;
    el.log.appendChild(li);
  }

  if (battle.winner) {
    el.turn.textContent = `${battle.winner.classDef.name} wins! Press "Restart" to play again.`;
  } else {
    el.turn.textContent = battle.turn === "player" ? "Your turn" : "CPU's turn...";
  }

  el.ultimateBtn.disabled = battle.turn !== "player" || battle.winner !== null || !canUseUltimate(battle.player);
}

// --- input handling ---------------------------------------------------------

function onCardClick(cardId) {
  if (battle.turn !== "player" || battle.winner) return;

  playerPlayCard(battle, cardId);
  render();
  if (battle.winner) return;

  setTimeout(() => {
    cpuTakeTurn(battle);
    render();
  }, 700);
}

el.ultimateBtn.addEventListener("click", () => {
  if (!battle || battle.turn !== "player" || battle.winner) return;

  playerUseUltimate(battle);
  render();
  if (battle.winner) return;

  setTimeout(() => {
    cpuTakeTurn(battle);
    render();
  }, 700);
});

el.restart.addEventListener("click", () => {
  battle = null;
  el.battleSection.hidden = true;
  el.classSelect.hidden = false;
});

renderClassSelect();
