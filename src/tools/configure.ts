import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { OPTION_CATEGORIES } from "../core/types.js";
import { findCarline } from "./catalog.js";
import {
  type Backend,
  backendsFor,
  brandArg,
  handle,
  sessionBackend,
  snapshot,
  type ToolContext,
} from "./context.js";

const configId = z.string().describe("Configuration id from start_configuration or import_code");

/** The backend that has this variant: the given brand, or the first that knows it. */
async function variantBackend(ctx: ToolContext, variantId: string, brand?: string): Promise<Backend> {
  for (const backend of backendsFor(ctx, brand)) {
    if (await backend.hasVariant(variantId).catch(() => false)) return backend;
  }
  throw new Error(`Unknown variant_id "${variantId}". Use list_variants to find one.`);
}

export function registerConfigureTools(server: McpServer, ctx: ToolContext) {
  const { sessions } = ctx;

  server.registerTool(
    "start_configuration",
    {
      title: "Start a configuration",
      description:
        "Start a new configuration from a variant's base configuration. Pass variant_id from list_variants, or (Volkswagen) carline + trim with an optional model_code. Returns a config_id and a summary.",
      inputSchema: {
        variant_id: z.string().optional().describe("Variant from list_variants"),
        carline: z.string().optional().describe('Instead of variant_id: carline key or name, e.g. "Golf"'),
        trim: z.string().optional().describe('With carline: trim name, e.g. "Style" or "GTI"'),
        model_code: z.string().optional().describe("With carline + trim: engine/gearbox from list_variants; default is the cheapest"),
        brand: brandArg(ctx),
        label: z.string().optional().describe("Your own name for this configuration"),
      },
      annotations: { openWorldHint: true },
    },
    handle(async ({ variant_id, carline, trim, model_code, brand, label }) => {
      let backend: Backend;
      let opened;
      if (variant_id) {
        backend = await variantBackend(ctx, variant_id, brand);
        opened = await backend.start({ variant_id });
      } else if (carline && trim) {
        const found = await findCarline(ctx, carline, brand);
        backend = found.backend;
        opened = await backend.start({ carline: found.key, trim, model_code });
      } else {
        throw new Error("Pass variant_id, or carline and trim");
      }
      const summary = await backend.summary(opened.state);
      const session = sessions.create(backend.key, opened.state, label?.trim() || opened.label, snapshot(summary));
      return { config_id: session.id, brand: session.brand, label: session.label, ...summary };
    }),
  );

  server.registerTool(
    "list_options",
    {
      title: "List options",
      description:
        "List options of a configuration: paints, interiors, wheels, packages, options, accessories. Shows code, price (market currency incl. VAT), and whether it is selected. Use max_total_price to only show options that keep the car under a budget (package side effects can change the real total; check with change_options dry_run).",
      inputSchema: {
        config_id: configId,
        category: z
          .enum(OPTION_CATEGORIES)
          .optional()
          .describe("Only this category. standard lists what's included as standard"),
        search: z.string().optional().describe('Text search in name, code and group, e.g. "Matrix" or "Pano"'),
        only_selectable: z.boolean().optional().describe("Hide options that are already selected or standard"),
        max_total_price: z.number().optional().describe("Only options whose price keeps the total at or below this"),
      },
      annotations: { readOnlyHint: true },
    },
    handle(async (args) => {
      const s = sessions.get(args.config_id);
      const list = await sessionBackend(ctx, s).listOptions(s.state, {
        category: args.category,
        search: args.search,
        onlySelectable: args.only_selectable,
        maxTotalPrice: args.max_total_price,
      });
      return {
        config_id: s.id,
        currency: list.currency,
        current_total: list.current_total,
        count: list.options.length,
        options: list.options,
      };
    }),
  );

  server.registerTool(
    "get_option",
    {
      title: "Option details",
      description: "Details of one option: price, selection state, which packages contain it, and what a package contains.",
      inputSchema: { config_id: configId, code: z.string().describe('Option code, e.g. "GPF3PF3" or "F14 3Y3Y"') },
      annotations: { readOnlyHint: true },
    },
    handle(async ({ config_id, code }) => {
      const s = sessions.get(config_id);
      return sessionBackend(ctx, s).getOption(s.state, code);
    }),
  );

  server.registerTool(
    "change_options",
    {
      title: "Add or remove options",
      description:
        "Add and/or remove options (paint, interior, wheels, packages, options). To change paint or interior, just add the new one. The configurator backend keeps the car buildable and may add or remove other options; those are reported under side_effects: added/removed are real extra changes to tell the user about; replaced is the previous paint/interior/wheel choice; standard_replaced/standard_restored are standard parts swapped for package versions (not losses). choices_required lists picks the user has to make (ask them, then add the chosen code). With dry_run=true nothing is saved, so you can preview the effect and price.",
      inputSchema: {
        config_id: configId,
        add: z.array(z.string()).optional().describe("Option codes to add"),
        remove: z.array(z.string()).optional().describe("Option codes to remove"),
        dry_run: z.boolean().optional().describe("Preview only; don't change the configuration"),
      },
      annotations: { openWorldHint: true },
    },
    handle(async ({ config_id, add = [], remove = [], dry_run = false }) => {
      const s = sessions.get(config_id);
      const backend = sessionBackend(ctx, s);
      if (!add.length && !remove.length) throw new Error("Nothing to change: pass add and/or remove");

      const outcome = await backend.change(s.state, { add, remove, dryRun: dry_run });
      if (!outcome.state || !outcome.diff) {
        return {
          config_id: s.id,
          applied: true,
          note: "No change needed",
          already_selected: outcome.already_selected,
          not_selected: outcome.not_selected,
          total: outcome.total,
        };
      }

      if (!dry_run) sessions.update(s, outcome.state, snapshot(await backend.summary(outcome.state)));
      return {
        config_id: s.id,
        dry_run,
        saved: !dry_run,
        ...outcome.diff,
        ...(outcome.already_selected.length ? { already_selected: outcome.already_selected } : {}),
        ...(outcome.not_selected.length ? { not_selected: outcome.not_selected } : {}),
        ...(outcome.backend_resolution ? { backend_resolution: outcome.backend_resolution } : {}),
      };
    }),
  );

  server.registerTool(
    "get_summary",
    {
      title: "Configuration summary",
      description:
        "Full summary of a configuration: model, paint, interior, selected options, price breakdown (market currency incl. VAT; net_total excl. VAT where the backend has it), performance, WLTP/efficiency figures, and optionally technical data (dimensions, performance, battery/charging).",
      inputSchema: {
        config_id: configId,
        technical_data: z.boolean().optional().describe("Include technical data (default true)"),
      },
      annotations: { readOnlyHint: true },
    },
    handle(async ({ config_id, technical_data = true }) => {
      const s = sessions.get(config_id);
      return {
        config_id: s.id,
        brand: s.brand,
        label: s.label,
        code: s.code?.value ?? null,
        ...(await sessionBackend(ctx, s).summary(s.state, { technical: technical_data })),
      };
    }),
  );

  server.registerTool(
    "list_configurations",
    {
      title: "List configurations",
      description: "List all configurations in this session with model, total price and configurator link / code (if exported).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    handle(async () => sessions.list()),
  );
}
