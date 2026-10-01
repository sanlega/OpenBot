import { useEffect, useState } from "react";
import { useOpenBot } from "../../state/context.js";
import { BotAvatar } from "../common/BotAvatar.js";
import { SettingRow, SettingsGroup } from "./SettingsPrimitives.js";

/** `/api/usage`'s latency summary (C10/C6). */
export interface LatencySummary {
  turns: number;
  medianSetupMs?: number;
  medianFirstTextMs?: number;
  medianFirstToolMs?: number;
  medianTotalMs?: number;
  cacheReuse?: number;
}

export function seconds(ms: number | undefined): string {
  if (ms === undefined) return "–";
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`;
}

/**
 * M3: how fast each bot answers (medians over its latest turns): start-up before the engine
 * runs, the first words, the whole turn, and how much of its input came from the prompt cache.
 */
export function SpeedCard() {
  const { transport, bots } = useOpenBot();
  const [rows, setRows] = useState<Record<string, LatencySummary> | null>(null);
  const active = bots.filter((b) => !b.archivedAt);
  const ids = active.map((b) => b.id).join(",");

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      active.map(async (bot) => {
        const res = await transport
          .get<{ latency?: LatencySummary }>(`/api/usage?botId=${encodeURIComponent(bot.id)}`)
          .catch(() => ({ latency: undefined }));
        return [bot.id, res.latency ?? { turns: 0 }] as const;
      }),
    ).then((pairs) => {
      if (!cancelled) setRows(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
    // `ids` stands in for the bot list, which is rebuilt every render.
  }, [transport, ids]);

  if (active.length === 0) return null;
  return (
    <SettingsGroup title="Speed (latest turns)">
      {active.map((bot) => {
        const s = rows?.[bot.id];
        return (
          <SettingRow
            key={bot.id}
            leading={<BotAvatar bot={bot} size={28} motion="none" />}
            label={bot.name}
            help={
              !s
                ? "…"
                : s.turns === 0
                  ? "No measured turns yet."
                  : `Getting ready ${seconds(s.medianSetupMs)} · whole turn ${seconds(s.medianTotalMs)}${
                      s.cacheReuse !== undefined
                        ? ` · ${Math.round(s.cacheReuse * 100)}% of input reused from cache`
                        : ""
                    } · ${s.turns} ${s.turns === 1 ? "turn" : "turns"}`
            }
          >
            <span className="speed-first" title="Median time to its first words">
              {s && s.turns > 0 ? seconds(s.medianFirstTextMs) : "–"}
            </span>
          </SettingRow>
        );
      })}
    </SettingsGroup>
  );
}
