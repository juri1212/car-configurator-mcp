import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { matchCarline } from "../core/match.js";
import { type Backend, backendsFor, brandArg, eachBackend, handle, hosts, type ToolContext } from "./context.js";

/** Finds a carline across the enabled brands (or just `brand`). */
export async function findCarline(ctx: ToolContext, query: string, brand?: string): Promise<{ backend: Backend; key: string }> {
  const candidates = (await eachBackend(backendsFor(ctx, brand), (b) => b.listModels())).flatMap(({ backend, value }) =>
    value.map((m) => ({ key: m.carline, name: m.name, backend })),
  );
  const multi = ctx.backends.length > 1 && !brand;
  return matchCarline(candidates, query, (c) => `${c.name} (${c.key}${multi ? `, ${c.backend.key}` : ""})`);
}

export function registerCatalogTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "list_models",
    {
      title: "List models",
      description: `List the model lines (carlines) available in the configurator (${hosts(ctx)}), with brand, starting price (market currency, incl. VAT), fuel types and trims. Use the carline key or name with list_variants.`,
      inputSchema: {
        query: z.string().optional().describe('Filter by name, e.g. "golf", "ID." or "911"'),
        brand: brandArg(ctx),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handle(async ({ query, brand }) =>
      (await eachBackend(backendsFor(ctx, brand), (b) => b.listModels(query))).flatMap(({ backend, value }) =>
        value.map((m) => ({ brand: backend.key, ...m })),
      ),
    ),
  );

  server.registerTool(
    "list_variants",
    {
      title: "List variants",
      description:
        "List the variants of a model line, grouped by trim where the brand has trims, with prices, power and fuel type. Pass a variant's variant_id to start_configuration.",
      inputSchema: {
        carline: z.string().describe('Carline key (e.g. "30600", "911") or name (e.g. "Golf", "Taycan")'),
        brand: brandArg(ctx),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handle(async ({ carline, brand }) => {
      const { backend, key } = await findCarline(ctx, carline, brand);
      return { brand: backend.key, ...(await backend.listVariants(key)) };
    }),
  );
}
