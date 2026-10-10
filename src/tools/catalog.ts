import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listModels, listVariants, resolveCarline } from "../catalog.js";
import { handle, type ToolContext } from "./context.js";

export function registerCatalogTools(server: McpServer, ctx: ToolContext) {
  server.registerTool(
    "list_models",
    {
      title: "List VW models",
      description:
        "List the model lines (carlines) available in the Volkswagen configurator, with starting price (EUR, incl. VAT), fuel types and trims. Use the carline key or name with list_variants.",
      inputSchema: {
        query: z.string().optional().describe('Filter by name, e.g. "golf" or "ID."'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handle(async ({ query }) => listModels(await ctx.client.modelsOverview(), query)),
  );

  server.registerTool(
    "list_variants",
    {
      title: "List trims and engines",
      description:
        "List the trims of a model line and the engine/gearbox variants of each trim, with prices, power and fuel type. Pass a trim name and optionally a model_code to start_configuration.",
      inputSchema: {
        carline: z.string().describe('Carline key (e.g. "30600") or name (e.g. "Golf")'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handle(async ({ carline }) => {
      const overview = await ctx.client.modelsOverview();
      const c = resolveCarline(overview, carline);
      return { carline: c.key, name: c.name, trims: listVariants(overview, c) };
    }),
  );
}
