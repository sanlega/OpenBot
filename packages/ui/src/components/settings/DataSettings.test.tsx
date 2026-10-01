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
});
