import type { Bot, BotDefaults } from "@openbot/contracts";
import type { CoreContext } from "./context.js";

/** What a new bot gets when nobody chose: full permissions inside the virtual machine (D-028). */
export const BUILTIN_BOT_DEFAULTS: Required<BotDefaults> = {
  routing: { mode: "auto" },
  permissionPreset: "full",
  computer: "docker",
};

/** The owner's defaults for new bots (Settings), over OpenBot's own. */
export function botDefaults(ctx: CoreContext): Required<BotDefaults> {
  const saved = ctx.repos.settings.get()?.botDefaults ?? {};
  return {
    routing: saved.routing ?? BUILTIN_BOT_DEFAULTS.routing,
    permissionPreset: saved.permissionPreset ?? BUILTIN_BOT_DEFAULTS.permissionPreset,
    computer: saved.computer ?? BUILTIN_BOT_DEFAULTS.computer,
  };
}

/** M1: a new bot's routing, permissions and computer: what was asked, else the defaults. */
export function withBotDefaults(
  ctx: CoreContext,
  asked: Partial<Pick<Bot, "routing" | "permissionPreset" | "computer">>,
): Pick<Bot, "routing" | "permissionPreset" | "computer"> {
  const defaults = botDefaults(ctx);
  return {
    routing: asked.routing ?? defaults.routing,
    permissionPreset: asked.permissionPreset ?? defaults.permissionPreset,
    computer: asked.computer ?? defaults.computer,
  };
}
