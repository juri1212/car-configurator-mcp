import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { summarise } from "../configuration.js";
import type { Session } from "../session.js";
import { handle, type ToolContext } from "./context.js";

function power(s: Session): string | null {
  const f = s.vehicleConfiguration.modelFilters ?? [];
  const kw = f.find((x) => x.type === "SystemPowerKW")?.text;
  const ps = f.find((x) => x.type === "SystemPowerPS")?.text;
  return kw ? `${Number(kw)} kW (${ps ? Number(ps) : "?"} PS)` : null;
}

const PERFORMANCE_KEYS = ["Höchstgeschwindigkeit", "Beschleunigung 0-100 km/h"];

export function compare(list: Session[]) {
  const summaries = list.map((s) => ({ s, sum: summarise(s.vehicleConfiguration, s.catalogue, { technical: true }) }));
  const optionSets = summaries.map(({ sum }) => new Set(sum.options.map((o) => o.code)));
  const common = summaries[0].sum.options.filter((o) => optionSets.every((set) => set.has(o.code)));
  const commonCodes = new Set(common.map((o) => o.code));

  return {
    configurations: summaries.map(({ s, sum }) => {
      const perf: Record<string, string> = {};
      for (const group of Object.values(sum.technical_data ?? {})) {
        for (const key of PERFORMANCE_KEYS) if (group[key]) perf[key] = group[key];
      }
      return {
        config_id: s.id,
        brand: s.brand,
        label: s.label,
        model: sum.model.name,
        trim: sum.model.trim,
        power: power(s),
        ...perf,
        exterior: sum.exterior?.name ?? null,
        interior: sum.interior?.name ?? null,
        prices: sum.prices,
        efficiency: sum.efficiency,
        options_only_here: sum.options.filter((o) => !commonCodes.has(o.code)),
        configurator_url: s.code?.url ?? null,
        vw_code: s.code?.value ?? null,
      };
    }),
    options_in_all: common.map((o) => ({ code: o.code, name: o.name })),
  };
}

export function registerCompareTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "compare_configurations",
    {
      title: "Compare configurations",
      description:
        "Compare two or more configurations side by side: price breakdown, power, performance, consumption/range, colours, and which options differ.",
      inputSchema: {
        config_ids: z.array(z.string()).min(2).describe("Configurations to compare"),
      },
      annotations: { readOnlyHint: true },
    },
    handle(async ({ config_ids }) => compare(config_ids.map((id) => ctx.sessions.get(id)))),
  );
}
