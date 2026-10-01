import { useEffect, useRef, useState, type ReactNode } from "react";

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  /** The button that does it ("Delete", "Clear chat"). */
  confirmLabel: string;
  /** Red confirm button for what can't be undone. */
  danger?: boolean;
  /** Keeps the confirm button off until the person did what the dialog asks (typed a word). */
  confirmDisabled?: boolean;
  /** Runs the action; a thrown error is shown in the dialog and it stays open. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

/** A small modal that asks once before something that can't be undone. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger = false,
  confirmDisabled = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Safe default: the focused button is Cancel, so Enter never deletes by accident. Once, when the
  // dialog opens: re-focusing on every render stole the focus from a field being typed in.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Try again.");
      setBusy(false);
    }
  };

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        className="dialog dialog-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="dialog-header">
          <div className="dialog-title">
            <h2>{title}</h2>
          </div>
        </header>
        <div className="dialog-body">
          <div className="dialog-text">{children}</div>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="dialog-footer">
            <span />
            <div className="dialog-actions">
              <button
                ref={cancelRef}
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
                disabled={busy || confirmDisabled}
                onClick={() => void confirm()}
              >
                {busy ? "Working…" : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
