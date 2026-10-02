import type { KeyboardEvent } from "react";

/**
 * Arrow keys move the choice in a radio group (segmented controls), as screen-reader users
 * expect; only the selected option is a tab stop.
 */
export function onRadioArrows<T>(
  event: KeyboardEvent<HTMLElement>,
  values: readonly T[],
  current: T,
  select: (value: T) => void,
): void {
  const step =
    event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
  if (!step) return;
  event.preventDefault();
  const next = values[(values.indexOf(current) + step + values.length) % values.length]!;
  select(next);
  const group = event.currentTarget.closest('[role="radiogroup"]');
  const index = values.indexOf(next);
  setTimeout(() => group?.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus(), 0);
}
