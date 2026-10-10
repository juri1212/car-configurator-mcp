import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { describeCandidate, effectiveConfiguration, summarise, totalPrice } from "../configuration.js";
import type { StoredConfigurationResponse } from "../victor/types.js";
import { type Backend, backendFor, handle, hosts, type ToolContext } from "./context.js";

export function normaliseCode(code: string): string {
  const c = code.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(c)) throw new Error(`"${code}" is not a VW Code (8 letters/digits, e.g. VC6NTLKS)`);
  return c;
}

/**
 * Loads a VW Code and picks the brand it belongs to. Every tenant can load
 * every code and the response doesn't name its tenant, so the brand is the one
 * whose catalogue has the code's carline.
 */
async function loadCode(ctx: ToolContext, code: string): Promise<{ backend: Backend; stored: StoredConfigurationResponse }> {
  const stored = await ctx.backends[0].client.loadConfiguration(code);
  const carline = stored.storedConfiguration.carlineKey;
  if (ctx.backends.length > 1 && carline) {
    for (const backend of ctx.backends) {
      const overview = await backend.client.modelsOverview().catch(() => undefined);
      if (overview?.carlines.some((c) => c.key === carline)) return { backend, stored };
    }
  }
  return { backend: ctx.backends[0], stored };
}

/**
 * Deep link that opens a stored configuration in the official configurator,
 * built the same way the site's "Konfiguration laden" page does after
 * resolving a VW Code.
 */
export function configuratorLink(configuratorUrl: string, code: string, stored: StoredConfigurationResponse): string {
  const sc = stored.storedConfiguration;
  const trim = [stored.consolidatedConfiguration, sc]
    .flatMap((vc) => vc?.modelFilters ?? [])
    .find((f) => f.type === "EquipmentLine")?.text;
  if (!trim) throw new Error(`VW Code ${code} has no trim (EquipmentLine) to link to`);
  // The site decides this from the code too: V... codes are private customers.
  const tenant = code.startsWith("V") ? "private" : "commercial";
  const params: Record<string, string> = {
    buildabilityStatus: "buildable",
    tenant,
    carlineId: sc.carlineKey,
    salesGroupId: sc.salesgroupKey,
    trimName: trim,
    modelId: sc.modelKey,
    modelVersion: sc.modelVersion,
    modelYear: sc.modelYear,
    exteriorId: sc.exterior?.code ?? "",
    interiorId: sc.interior?.code ?? "",
    // List items are joined with "-", so dashes inside codes are pre-escaped.
    options: (sc.features ?? []).map((f) => f.code.replace(/-/g, "%2D")).join("-"),
    category: tenant,
  };
  const search = new URLSearchParams();
  // Feature Hub scopes each query parameter to the configurator app with "-app".
  for (const [key, value] of Object.entries(params)) if (value) search.set(`${key}-app`, value);
  return `${configuratorUrl}/__app/route:configure.app?${search}`;
}

export function registerCodeTools(server: McpServer, ctx: ToolContext) {
  const { sessions } = ctx;

  server.registerTool(
    "export_code",
    {
      title: "Export VW Code",
      description:
        `Save a configuration with Volkswagen and get a link that opens exactly this vehicle in the official configurator on the brand's site (${hosts(ctx)}). Give the user the link. The VW Code is the same configuration in short form (it can be re-imported with import_code).`,
      inputSchema: { config_id: z.string().describe("Configuration to export") },
      annotations: { openWorldHint: true },
    },
    handle(async ({ config_id }) => {
      const s = sessions.get(config_id);
      const { brand, client } = backendFor(ctx, s.brand);
      const code = await client.storeConfiguration(s.vehicleConfiguration);
      // Load it back: confirms the code works and tells us when it expires.
      const stored = await client.loadConfiguration(code);
      const url = configuratorLink(brand.configuratorUrl, code, stored);
      s.code = { value: code, url, exportedAt: new Date() };
      return {
        config_id: s.id,
        brand: brand.key,
        configurator_url: url,
        vw_code: code,
        expires: stored.expires,
        model: (s.vehicleConfiguration.modelLongName ?? s.vehicleConfiguration.modelName)?.trim(),
        total_price: totalPrice(s.vehicleConfiguration),
      };
    }),
  );

  server.registerTool(
    "import_code",
    {
      title: "Import VW Code",
      description:
        `Load a VW Code (from ${hosts(ctx)} or export_code) into a new configuration that can be inspected and changed. The brand is detected from the code. If the stored vehicle can no longer be built as-is, the backend adjusts it and the changes are reported.`,
      inputSchema: {
        code: z.string().describe("VW Code, e.g. VC6NTLKS"),
        label: z.string().optional(),
      },
      annotations: { openWorldHint: true },
    },
    handle(async ({ code, label }) => {
      const c = normaliseCode(code);
      const { backend, stored } = await loadCode(ctx, c);
      // An empty step turns the stored configuration into a full, editable one.
      const res = await backend.client.configStep(stored.storedConfiguration, [], []);
      const vc = effectiveConfiguration(res);
      const session = sessions.create(backend.brand.key, vc, res.vehicleCatalogue, label, c);
      const candidate = res.validationData?.conflicted ? res.validationData.solutionCandidates?.[0] : undefined;
      return {
        config_id: session.id,
        brand: session.brand,
        label: session.label,
        imported_code: c,
        code_expires: stored.expires,
        adjusted_by_backend: candidate ? describeCandidate(candidate) : null,
        ...summarise(vc, res.vehicleCatalogue),
      };
    }),
  );
}
