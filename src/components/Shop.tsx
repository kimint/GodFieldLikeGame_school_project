import { useMemo, useState, type ReactElement } from "react";
import { allCards, deckEntriesForCard, findCardById, type CatalogCardEntry } from "../model/catalog.ts";
import { cardRarity, RARITY_LABEL, type Card } from "../model/cardTypes.ts";
import type { ClassDef } from "../model/classes.ts";
import { describeCard } from "../model/engine.ts";
import { classIconMarkup } from "../icons.ts";
import {
  CARD_PACK,
  CLASS_PRICES,
  REWARDS,
  cardPrice,
  formatGold,
  ownsCard,
  ownsClass,
  type Economy,
} from "../model/shop.ts";
import { openCardPack, unlockCard, unlockClass } from "../online/shopApi.ts";
import { FramedCard } from "./FramedCard.tsx";
import { PurchaseDialog } from "./PurchaseDialog.tsx";

export interface ShopProps {
  classes: ClassDef[];
  economy: Economy;
  onEconomyChange: (economy: Economy) => void;
  onBack: () => void;
}

type Tab = "classes" | "cards";

// What the confirm dialog is about to buy.
type Pending =
  | { kind: "class"; classDef: ClassDef; price: number }
  | { kind: "card"; card: CatalogCardEntry; price: number }
  | { kind: "pack"; price: number };

const RARITY_ORDER = { legend: 0, rare: 1, normal: 2 } as const;

/**
 * Unlock Shop (React shell): classes and rare / legend cards for Gold, plus
 * card packs. Gold is only spent by the server (src/online/shopApi.ts); this
 * screen shows the new balance once it has answered.
 */
export function Shop({ classes, economy, onEconomyChange, onBack }: ShopProps): ReactElement {
  const [tab, setTab] = useState<Tab>("classes");
  const [pending, setPending] = useState<Pending | null>(null);
  const [packCard, setPackCard] = useState<CatalogCardEntry | null>(null);

  // Rare and legend cards, the only ones sold; legends first.
  const cards = useMemo(
    () =>
      allCards()
        .filter((c) => cardPrice(c) !== null)
        .sort(
          (a, b) =>
            RARITY_ORDER[cardRarity(a.props)] - RARITY_ORDER[cardRarity(b.props)] || a.name.localeCompare(b.name)
        ),
    []
  );
  const usableBy = (card: CatalogCardEntry): ClassDef[] => deckEntriesForCard(card.id).map((e) => e.classDef);
  // Cards you can buy right now first, then the ones you own, then the ones
  // whose class is still locked.
  const sortedCards = [...cards].sort((a, b) => cardGroup(a) - cardGroup(b));
  function cardGroup(card: CatalogCardEntry): number {
    if (ownsCard(economy, card)) return 1;
    return usableBy(card).some((cls) => ownsClass(economy, cls.id)) ? 0 : 2;
  }
  const packPool = cards.filter((c) => !ownsCard(economy, c) && usableBy(c).some((cls) => ownsClass(economy, cls.id)));
  const ownedCount = cards.filter((c) => ownsCard(economy, c)).length;

  const buy = async (): Promise<void> => {
    if (!pending) return;
    if (pending.kind === "class") onEconomyChange(await unlockClass(pending.classDef.id));
    else if (pending.kind === "card") onEconomyChange(await unlockCard(pending.card.id));
    else {
      const { economy: next, cardId } = await openCardPack();
      onEconomyChange(next);
      setPackCard(findCardById(cardId));
    }
    setPending(null);
  };

  const title = (p: Pending): string =>
    p.kind === "pack"
      ? `Open a card pack for ${formatGold(p.price)}?`
      : `Unlock ${p.kind === "class" ? p.classDef.name : p.card.name} for ${formatGold(p.price)}?`;

  return (
    <div className="shell-screen gallery-screen shop-screen">
      <div className="gallery-backdrop" aria-hidden="true" />
      <header className="gallery-header">
        <div className="gallery-heading">
          <h1 className="gallery-title">Unlock Shop</h1>
          <p className="gallery-subtitle">
            <span>Earn Gold in random matches: win +{REWARDS.win}, loss +{REWARDS.loss}, first win of the day +{REWARDS.firstWinBonus}</span>
          </p>
        </div>
        <div className="shop-header-right">
          <GoldChip economy={economy} />
          <button type="button" className="gallery-pill gallery-back" onClick={onBack}>
            ← Back
          </button>
        </div>
      </header>

      {economy.admin ? <p className="shop-note">Admin account: every class and card is already unlocked.</p> : null}

      <div className="gallery-filters" role="tablist" aria-label="Shop section">
        {(["classes", "cards"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`gallery-pill gallery-filter${tab === t ? " active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "classes" ? "Classes" : "Cards"}
            <span className="gallery-filter-count">
              {t === "classes"
                ? `${classes.filter((c) => ownsClass(economy, c.id)).length}/${classes.length}`
                : `${ownedCount}/${cards.length}`}
            </span>
          </button>
        ))}
      </div>

      {tab === "classes" ? (
        <div className="shop-class-grid">
          {classes.map((classDef) => {
            const owned = ownsClass(economy, classDef.id);
            const price = CLASS_PRICES[classDef.id];
            return (
              <article key={classDef.id} className={`shop-class${owned ? " owned" : ""}`}>
                <span
                  className="lobby-medallion lg shop-class-icon"
                  aria-hidden="true"
                  dangerouslySetInnerHTML={{ __html: classIconMarkup(classDef) }}
                />
                <h2 className="shop-class-name">{classDef.name}</h2>
                <p className="shop-class-sub">
                  {classDef.synergyPool.map((s) => s.name).join(" · ")} · Ultimate: {classDef.ultimate.name}
                </p>
                <p className="shop-class-sub">HP {classDef.baseStats.hp}</p>
                <div className="shop-class-action">
                  {owned ? (
                    <span className="shop-owned">✓ Owned</span>
                  ) : price === undefined ? (
                    <span className="shop-owned muted">Not for sale</span>
                  ) : (
                    <PriceButton
                      price={price}
                      gold={economy.gold}
                      onClick={() => setPending({ kind: "class", classDef, price })}
                    />
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <>
          <section className="shop-pack">
            <div className="shop-pack-text">
              <h2>Card pack</h2>
              <p>
                One random rare or legend card you don&apos;t own yet, for a class you own (rare {CARD_PACK.odds.rare} :
                legend {CARD_PACK.odds.legend}). Buying a single card: rare {formatGold(300)}, legend {formatGold(800)}.
              </p>
            </div>
            {packPool.length === 0 ? (
              <span className="shop-owned muted">Nothing left to find</span>
            ) : (
              <PriceButton
                label="Open pack"
                price={CARD_PACK.price}
                gold={economy.gold}
                onClick={() => setPending({ kind: "pack", price: CARD_PACK.price })}
              />
            )}
          </section>
          <p className="shop-note">Normal cards come free with their class. Custom decks can only use cards you own.</p>
          <div className="gallery-grid">
            {sortedCards.map((card) => {
              const owned = ownsCard(economy, card);
              const users = usableBy(card);
              const classOwned = users.some((cls) => ownsClass(economy, cls.id));
              const price = cardPrice(card) ?? 0;
              const description = describeCard({ ...card.props, category: card.category, name: card.name } as Card, {
                priority: false,
              });
              return (
                <div key={card.id} className={`gallery-card ${card.category} shop-card${owned ? "" : " locked"}`}>
                  <FramedCard card={card} description={description} />
                  <div className="gallery-decks">
                    {users.map((cls) => (
                      <span key={cls.id} className="gallery-deck">
                        {cls.name}
                      </span>
                    ))}
                  </div>
                  {owned ? (
                    <span className="shop-owned">✓ Owned</span>
                  ) : !classOwned ? (
                    <span className="shop-owned muted">Unlock {users[0]?.name ?? "its class"} first</span>
                  ) : (
                    <PriceButton
                      small
                      label={RARITY_LABEL[cardRarity(card.props)]}
                      price={price}
                      gold={economy.gold}
                      onClick={() => setPending({ kind: "card", card, price })}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {pending ? (
        <PurchaseDialog
          title={title(pending)}
          price={pending.price}
          gold={economy.gold}
          confirmLabel={pending.kind === "pack" ? "Open" : "Unlock"}
          onConfirm={buy}
          onClose={() => setPending(null)}
        />
      ) : null}

      {packCard ? (
        <div className="dialog-backdrop" onClick={() => setPackCard(null)}>
          <div className="dialog-box shop-dialog shop-pack-result" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2 className="dialog-title">You got {packCard.name}!</h2>
            <div className="gallery-card shop-pack-card">
              <FramedCard
                card={packCard}
                description={describeCard({ ...packCard.props, category: packCard.category, name: packCard.name } as Card, {
                  priority: false,
                })}
              />
            </div>
            <div className="dialog-buttons">
              <button type="button" className="dialog-button dialog-button-primary" onClick={() => setPackCard(null)}>
                Nice
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Gold balance and today's progress toward the daily cap. */
export function GoldChip({ economy }: { economy: Economy }): ReactElement {
  const capped = economy.dailyGold >= REWARDS.dailyCap;
  const pct = Math.min(100, (economy.dailyGold / REWARDS.dailyCap) * 100);
  return (
    <div
      className={`gold-chip${capped ? " capped" : ""}`}
      title={`Gold earned from matches today: ${economy.dailyGold} / ${REWARDS.dailyCap}`}
    >
      <span className="gold-chip-coin" aria-hidden="true" />
      <span className="gold-chip-body">
        <span className="gold-chip-value">{formatGold(economy.gold)}</span>
        <span className="gold-chip-cap">
          <span className="gold-chip-bar">
            <span style={{ width: `${pct}%` }} />
          </span>
          {economy.dailyGold.toLocaleString("en-US")} / {REWARDS.dailyCap.toLocaleString("en-US")} today
        </span>
      </span>
    </div>
  );
}

export function PriceButton({
  price,
  gold,
  onClick,
  label = "Unlock",
  small = false,
}: {
  price: number;
  gold: number;
  onClick: () => void;
  label?: string;
  small?: boolean;
}): ReactElement {
  const affordable = gold >= price;
  return (
    <div className={`shop-price${small ? " small" : ""}`}>
      <button type="button" className="lobby-btn primary shop-price-btn" disabled={!affordable} onClick={onClick}>
        {label} · {formatGold(price)}
      </button>
      {!affordable ? <span className="shop-price-need">Need {formatGold(price - gold)} more</span> : null}
    </div>
  );
}
