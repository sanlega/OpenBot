import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Transport } from "../../transport/types.js";
import { DataSettings } from "./DataSettings.js";

let transport: Transport;
const refresh = vi.fn(async () => undefined);
vi.mock("../../state/context.js", () => ({ useOpenBot: () => ({ transport, refresh }) }));
afterEach(cleanup);

describe("Reset OpenBot (M2)", () => {
  it("only resets after RESET is typed", async () => {
    const post = vi.fn(async () => ({ ok: true, bots: 2, messages: 10, memories: 3 }));
    transport = { post } as unknown as Transport;
    render(<DataSettings />);
    await userEvent.click(screen.getByRole("button", { name: "Reset…" }));
    const confirm = screen.getByRole("button", { name: "Reset OpenBot" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("Type RESET to confirm"), "reset");
    expect((screen.getByLabelText("Type RESET to confirm") as HTMLInputElement).value).toBe(
      "reset",
    );
    expect(
      (screen.getByRole("button", { name: "Reset OpenBot" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    await userEvent.click(confirm);
    expect(post).toHaveBeenCalledWith("/api/reset", { confirm: "RESET" });
    expect(
      await screen.findByText(/OpenBot was reset: 2 bots, 10 messages and 3 memories/),
    ).toBeTruthy();
  });

  it("starts in the field, Enter confirms once RESET is typed, and Tab stays in the dialog", async () => {
    const post = vi.fn(async () => ({ ok: true, bots: 0, messages: 0, memories: 0 }));
    transport = { post } as unknown as Transport;
    render(<DataSettings />);
    await userEvent.click(screen.getByRole("button", { name: "Reset…" }));
    const field = screen.getByLabelText("Type RESET to confirm");
    expect(document.activeElement).toBe(field);
    const dialog = screen.getByRole("alertdialog", { name: "Reset OpenBot?" });
    expect(dialog).toHaveAccessibleDescription(/can.t be undone/);
    // Enter does nothing while the word is wrong.
    await userEvent.type(field, "nope{Enter}");
    expect(post).not.toHaveBeenCalled();
    // Tab cycles inside the dialog: field -> Cancel -> (confirm is disabled) -> field.
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.tab();
    expect(document.activeElement).toBe(field);
    await userEvent.clear(field);
    await userEvent.type(field, "RESET{Enter}");
    expect(post).toHaveBeenCalledWith("/api/reset", { confirm: "RESET" });
  });
});
