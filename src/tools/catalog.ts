import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BrandKey } from "../brand.js";
import { listModels, listVariants, matchCarline } from "../catalog.js";
import type { ModelsOverview, OverviewCarline } from "../victor/types.js";
import { type Backend, backendsFor, brandArg, handle, hosts, type ToolContext } from "./context.js";

/** Model overviews of the brands to query. One brand failing doesn't hide the others. */
async function overviews(ctx: ToolContext, brand?: BrandKey) {
  const results = await Promise.allSettled(
    backendsFor(ctx, brand).map(async (backend) => ({ backend, overview: await backend.client.modelsOverview() })),
  );
  const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!ok.length) throw (results[0] as PromiseRejectedResult).reason;
  return ok;
}

/** Finds a carline across the enabled brands (or just `brand`). */
export async function findCarline(
  ctx: ToolContext,
  query: string,
  brand?: BrandKey,
): Promise<{ backend: Backend; overview: ModelsOverview; carline: OverviewCarline }> {
  const candidates = (await overviews(ctx, brand)).flatMap(({ backend, overview }) =>
    overview.carlines.map((carline) => ({ key: carline.key, name: carline.name, backend, overview, carline })),
  );
  const multi = ctx.backends.length > 1 && !brand;
  return matchCarline(candidates, query, (c) => `${c.name} (${c.key}${multi ? `, ${c.backend.brand.key}` : ""})`);
}

export function registerCatalogTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "list_models",
    {
      title: "List VW models",
      description:
        `List the model lines (carlines) available in the configurator (${hosts(ctx)}), with brand, starting price (EUR, incl. VAT), fuel types and trims. Use the carline key or name with list_variants.`,
      inputSchema: {
        query: z.string().optional().describe('Filter by name, e.g. "golf" or "ID."'),
        brand: brandArg(ctx),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handle(async ({ query, brand }) =>
      (await overviews(ctx, brand)).flatMap(({ backend, overview }) =>
        listModels(overview, query).map((m) => ({ brand: backend.brand.key, ...m })),
      ),
    ),
  );

  server.registerTool(
    "list_variants",
    {
      title: "List trims and engines",
      description:
        "List the trims of a model line and the engine/gearbox variants of each trim, with prices, power and fuel type. Pass a trim name and optionally a model_code to start_configuration.",
      inputSchema: {
        carline: z.string().describe('Carline key (e.g. "30600") or name (e.g. "Golf")'),
        brand: brandArg(ctx),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handle(async ({ carline, brand }) => {
      const { backend, overview, carline: c } = await findCarline(ctx, carline, brand);
      return { brand: backend.brand.key, carline: c.key, name: c.name, trims: listVariants(overview, c) };
    }),
  );
}
