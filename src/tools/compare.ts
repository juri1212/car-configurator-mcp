import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Summary } from "../core/types.js";
import type { Session } from "../session.js";
import { handle, sessionBackend, type ToolContext } from "./context.js";

export function compare(list: { s: Session; sum: Summary }[]) {
  const optionSets = list.map(({ sum }) => new Set(sum.options.map((o) => o.code)));
  const common = list[0].sum.options.filter((o) => optionSets.every((set) => set.has(o.code)));
  const commonCodes = new Set(common.map((o) => o.code));

  return {
    configurations: list.map(({ s, sum }) => ({
      config_id: s.id,
      brand: s.brand,
      label: s.label,
      model: sum.model.name,
      trim: sum.model.trim,
      ...sum.performance,
      exterior: sum.exterior?.name ?? null,
      interior: sum.interior?.name ?? null,
      prices: sum.prices,
      efficiency: sum.efficiency,
      options_only_here: sum.options.filter((o) => !commonCodes.has(o.code)),
      configurator_url: s.code?.url ?? null,
      code: s.code?.value ?? null,
    })),
    options_in_all: common.map((o) => ({ code: o.code, name: o.name })),
  };
}

export function registerCompareTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "compare_configurations",
    {
      title: "Compare configurations",
      description:
        "Compare two or more configurations side by side: price breakdown, power, top speed, 0-100, consumption/range, colours, and which options differ.",
      inputSchema: {
        config_ids: z.array(z.string()).min(2).describe("Configurations to compare"),
      },
      annotations: { readOnlyHint: true },
    },
    handle(async ({ config_ids }) => {
      const sessions = config_ids.map((id) => ctx.sessions.get(id));
      const list = await Promise.all(
        sessions.map(async (s) => ({ s, sum: await sessionBackend(ctx, s).summary(s.state, { technical: false }) })),
      );
      return compare(list);
    }),
  );
}
