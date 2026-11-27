import { useRef, useState, type ReactElement } from "react";
import { formatGold } from "../model/shop.ts";

export interface PurchaseDialogProps {
  title: string; // e.g. "Unlock Pyromancer for 1,500 G?"
  price: number;
  gold: number; // current balance
  confirmLabel?: string;
  // Runs the purchase on the server. Resolves once it went through; throws
  // with the reason if it didn't. The dialog stays open (and locked) meanwhile.
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

/**
 * "Unlock X for N G?" with the balance before and after. Nothing changes on
 * screen until the server has answered: the Confirm button shows a spinner,
 * can't be pressed twice, and an error leaves the Gold untouched.
 */
export function PurchaseDialog({ title, price, gold, confirmLabel = "Unlock", onConfirm, onClose }: PurchaseDialogProps): ReactElement {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false); // double-click guard (state updates are async)

  const confirm = async (): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={() => !pending && onClose()}>
      <div className="dialog-box shop-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2 className="dialog-title">{title}</h2>
        <dl className="shop-dialog-sum">
          <dt>Your Gold</dt>
          <dd>{formatGold(gold)}</dd>
          <dt>Price</dt>
          <dd className="minus">−{formatGold(price)}</dd>
          <dt className="total">After</dt>
          <dd className="total">{formatGold(gold - price)}</dd>
        </dl>
        {error ? <p className="shop-dialog-error">{error}</p> : null}
        <div className="dialog-buttons">
          <button type="button" className="dialog-button" disabled={pending} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="dialog-button dialog-button-primary"
            disabled={pending}
            aria-busy={pending}
            onClick={() => void confirm()}
          >
            {pending ? (
              <>
                <span className="shop-spinner" aria-hidden="true" /> Processing…
              </>
            ) : error ? (
              "Try again"
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
