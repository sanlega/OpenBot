import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { friendlyError } from "../../api/errors.js";

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  /** The button that does it ("Delete", "Clear chat"). */
  confirmLabel: string;
  /** Red confirm button for what can't be undone. */
  danger?: boolean;
  /** Keeps the confirm button off until the person did what the dialog asks (typed a word). */
  confirmDisabled?: boolean;
  /**
   * Where the focus starts: Cancel (the safe default, so Enter never confirms by accident) or
   * the dialog's own field, for a typed confirmation.
   */
  initialFocus?: "cancel" | "field";
  /** Runs the action; a thrown error is shown in the dialog and it stays open. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

/** A small modal that asks once before something that can't be undone. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger = false,
  confirmDisabled = false,
  initialFocus = "cancel",
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const textId = useId();

  // Once, when the dialog opens: re-focusing on every render stole the focus from a field being
  // typed in. Closing gives the focus back to what opened it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const field =
      initialFocus === "field"
        ? textRef.current?.querySelector<HTMLElement>("input, textarea, select")
        : null;
    (field ?? cancelRef.current)?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const confirm = async () => {
    if (busy || confirmDisabled) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(friendlyError(err, "That didn't work. Try again."));
      setBusy(false);
    }
  };

  // Tab stays inside the dialog while it is open.
  const trapTab = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div
        ref={dialogRef}
        className="dialog dialog-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        onKeyDown={trapTab}
      >
        <header className="dialog-header">
          <div className="dialog-title">
            <h2 id={titleId}>{title}</h2>
          </div>
        </header>
        <form
          className="dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            void confirm();
          }}
        >
          <div className="dialog-text" id={textId} ref={textRef}>
            {children}
          </div>
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
                type="submit"
                className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
                disabled={busy || confirmDisabled}
              >
                {busy ? "Working…" : confirmLabel}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
