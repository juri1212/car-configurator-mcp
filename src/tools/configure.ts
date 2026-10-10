import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveCarline, resolveStart } from "../catalog.js";
import {
  ALL_CATEGORIES,
  describeCandidate,
  diffConfigurations,
  effectiveConfiguration,
  featureIndex,
  includedCodes,
  listOptions,
  optionView,
  placementIndex,
  summarise,
  totalPrice,
} from "../configuration.js";
import type { Session } from "../session.js";
import type { ConfigResponse, Feature, VehicleCatalogue } from "../victor/types.js";
import { VictorError } from "../victor/client.js";
import { handle, type ToolContext } from "./context.js";

const configId = z.string().describe("Configuration id from start_configuration or import_code");
const category = z.enum(ALL_CATEGORIES);

const squash = (s: string) => s.replace(/\s+/g, "").toUpperCase();

/** Finds a feature by exact code, or by code ignoring whitespace/case. */
export function resolveCode(catalogue: VehicleCatalogue, code: string): Feature {
  const features = featureIndex(catalogue);
  const exact = features.get(code);
  if (exact) return exact;
  const wanted = squash(code);
  const match = catalogue.features.find((f) => squash(f.code) === wanted);
  if (match) return match;
  throw new Error(`Unknown option code "${code}" for this configuration. Use list_options to find codes.`);
}

export function registerConfigureTools(server: McpServer, ctx: ToolContext) {
  const { client, sessions } = ctx;

  server.registerTool(
    "start_configuration",
    {
      title: "Start a configuration",
      description:
        "Start a new configuration from a trim's base configuration (optionally a specific engine via model_code from list_variants). Returns a config_id and a summary.",
      inputSchema: {
        carline: z.string().describe('Carline key or name, e.g. "Golf"'),
        trim: z.string().describe('Trim name, e.g. "Style" or "GTI"'),
        model_code: z.string().optional().describe("Engine/gearbox variant from list_variants; default is the cheapest"),
        label: z.string().optional().describe("Your own name for this configuration"),
      },
      annotations: { openWorldHint: true },
    },
    handle(async ({ carline, trim, model_code, label }) => {
      const overview = await client.modelsOverview();
      const c = resolveCarline(overview, carline);
      const { trim: t, engine } = resolveStart(overview, c, trim, model_code);
      const res = await client.configStart({
        carlineKey: c.key,
        salesgroupKey: t.salesgroup,
        trimName: t.name,
        modelCode: engine?.model_code,
        modelYear: engine?.model_year,
      });
      const vc = effectiveConfiguration(res);
      const session = sessions.create(vc, res.vehicleCatalogue, label);
      return { config_id: session.id, label: session.label, ...summarise(vc, res.vehicleCatalogue) };
    }),
  );

  server.registerTool(
    "list_options",
    {
      title: "List options",
      description:
        "List options of a configuration: paints (exterior), interiors, wheels, packages and options, accessories. Shows code, price (EUR incl. VAT), and whether it is selected. Use max_total_price to only show options that keep the car under a budget (package side effects can change the real total; check with change_options dry_run).",
      inputSchema: {
        config_id: configId,
        category: category.optional().describe("Only this category. standardEquipment lists what's included as standard"),
        search: z.string().optional().describe('Text search in name, code and group, e.g. "Matrix" or "Pano"'),
        only_selectable: z.boolean().optional().describe("Hide options that are already selected or standard"),
        max_total_price: z.number().optional().describe("Only options whose price keeps the total at or below this (EUR)"),
      },
      annotations: { readOnlyHint: true },
    },
    handle(async (args) => {
      const s = sessions.get(args.config_id);
      const total = totalPrice(s.vehicleConfiguration);
      const options = listOptions(s.catalogue, total, {
        category: args.category,
        search: args.search,
        onlySelectable: args.only_selectable,
        maxTotalPrice: args.max_total_price,
      });
      return { config_id: s.id, current_total: total, count: options.length, options };
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
      const f = resolveCode(s.catalogue, code);
      const features = featureIndex(s.catalogue);
      const view = optionView(f, features, placementIndex(s.catalogue).get(f.code), true);
      return {
        ...view,
        in_packages: f.packages?.map((p) => ({ code: p, name: features.get(p)?.name ?? p })),
      };
    }),
  );

  server.registerTool(
    "change_options",
    {
      title: "Add or remove options",
      description:
        "Add and/or remove options (paint, interior, wheels, packages, options). To change paint or interior, just add the new one. The configurator backend keeps the car buildable and may add or remove other options; those are reported under side_effects: added/removed are real extra changes to tell the user about; replaced is the previous paint/interior/wheel choice; standard_replaced/standard_restored are standard parts swapped for package versions (not losses). With dry_run=true nothing is saved, so you can preview the effect and price.",
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
      if (!add.length && !remove.length) throw new Error("Nothing to change: pass add and/or remove");

      const selected = includedCodes(s.catalogue);
      const addCodes = add.map((c) => resolveCode(s.catalogue, c).code);
      const removeCodes = remove.map((c) => resolveCode(s.catalogue, c).code);
      const alreadySelected = addCodes.filter((c) => selected.has(c));
      const notSelected = removeCodes.filter((c) => !selected.has(c));

      const steps = [
        ...removeCodes.filter((c) => selected.has(c)).map((code) => ({ code, op: "remove" as const })),
        ...addCodes.filter((c) => !selected.has(c)).map((code) => ({ code, op: "add" as const })),
      ];

      // The backend handles one feature per step reliably, so apply them one by one.
      let vc = s.vehicleConfiguration;
      let last: ConfigResponse | undefined;
      for (const step of steps) {
        try {
          last = await client.configStep(vc, step.op === "add" ? [step.code] : [], step.op === "remove" ? [step.code] : []);
        } catch (err) {
          const reason = err instanceof VictorError ? err.message : String(err);
          throw new Error(
            `Could not ${step.op} ${step.code}: ${reason}. Nothing was changed.` +
              (steps.length > 1 ? " Try the changes one at a time to find the conflict." : ""),
          );
        }
        vc = effectiveConfiguration(last);
      }

      if (!last) {
        return {
          config_id: s.id,
          applied: true,
          note: "No change needed",
          already_selected: alreadySelected,
          not_selected: notSelected,
          total: totalPrice(vc),
        };
      }

      const diff = diffConfigurations(s.catalogue, s.vehicleConfiguration, last, addCodes, removeCodes);
      if (!dry_run) sessions.update(s, vc, last.vehicleCatalogue);
      return {
        config_id: s.id,
        dry_run,
        saved: !dry_run,
        ...diff,
        ...(alreadySelected.length ? { already_selected: alreadySelected } : {}),
        ...(notSelected.length ? { not_selected: notSelected } : {}),
        ...(last.validationData?.solutionCandidates?.length
          ? { backend_resolution: describeCandidate(last.validationData.solutionCandidates[0]) }
          : {}),
      };
    }),
  );

  server.registerTool(
    "get_summary",
    {
      title: "Configuration summary",
      description:
        "Full summary of a configuration: model, paint, interior, selected options, price breakdown (EUR incl. VAT; net_total excl. VAT where the backend has it), WLTP/efficiency figures, and optionally technical data (dimensions, performance, battery/charging).",
      inputSchema: {
        config_id: configId,
        technical_data: z.boolean().optional().describe("Include technical data (default true)"),
      },
      annotations: { readOnlyHint: true },
    },
    handle(async ({ config_id, technical_data = true }) => {
      const s: Session = sessions.get(config_id);
      return {
        config_id: s.id,
        label: s.label,
        vw_code: s.code?.value ?? null,
        ...summarise(s.vehicleConfiguration, s.catalogue, { technical: technical_data }),
      };
    }),
  );

  server.registerTool(
    "list_configurations",
    {
      title: "List configurations",
      description: "List all configurations in this session with model, total price and VW Code (if exported).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    handle(async () => sessions.list()),
  );
}
