import type { ReactElement } from "react";
import { cardCost } from "../model/cardTypes.ts";
import type { CatalogCardEntry } from "../model/catalog.ts";

export interface FramedCardProps {
  card: CatalogCardEntry;
  description: string;
}

/**
 * A catalog card in the card frame art, laid out like the battle screen's
 * cards (src/scenes/cardFace.ts): name on the top plate, AP cost in the
 * medallion, art in the window, category on the banner, effect text at the
 * bottom. Sized by its container's width; see .framed-card in style.css.
 */
export function FramedCard({ card, description }: FramedCardProps): ReactElement {
  return (
    <div className={`framed-card ${card.category}`}>
      {card.imageUrl ? (
        <img className="framed-card-art" src={card.imageUrl} alt={`${card.name} artwork`} loading="lazy" draggable={false} />
      ) : (
        <div className="framed-card-art fallback" />
      )}
      <div className="framed-card-name">{card.name}</div>
      <div className="framed-card-cost">{cardCost(card.props)}</div>
      <div className="framed-card-category">{card.category}</div>
      <div className="framed-card-text">{description}</div>
    </div>
  );
}
