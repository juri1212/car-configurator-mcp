import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { describeCandidate, effectiveConfiguration, summarise } from "../configuration.js";
import { handle, type ToolContext } from "./context.js";

export function normaliseCode(code: string): string {
  const c = code.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(c)) throw new Error(`"${code}" is not a VW Code (8 letters/digits, e.g. VC6NTLKS)`);
  return c;
}

export function registerCodeTools(server: McpServer, ctx: ToolContext) {
  const { client, sessions } = ctx;

  server.registerTool(
    "export_code",
    {
      title: "Export VW Code",
      description:
        "Save a configuration with Volkswagen and get a VW Code. The user can enter the code on volkswagen.de (\"Konfiguration laden\") to open exactly this car in the official configurator.",
      inputSchema: { config_id: z.string().describe("Configuration to export") },
      annotations: { openWorldHint: true },
    },
    handle(async ({ config_id }) => {
      const s = sessions.get(config_id);
      const code = await client.storeConfiguration(s.vehicleConfiguration);
      // Load it back: confirms the code works and tells us when it expires.
      const stored = await client.loadConfiguration(code);
      s.code = { value: code, exportedAt: new Date() };
      return {
        config_id: s.id,
        vw_code: code,
        expires: stored.expires,
        load_at: ctx.loadCodeUrl,
        model: (s.vehicleConfiguration.modelLongName ?? s.vehicleConfiguration.modelName)?.trim(),
        total_price: s.vehicleConfiguration.configurationPrice?.total?.[0]?.price ?? null,
      };
    }),
  );

  server.registerTool(
    "import_code",
    {
      title: "Import VW Code",
      description:
        "Load a VW Code (from volkswagen.de or export_code) into a new configuration that can be inspected and changed. If the stored car can no longer be built as-is, the backend adjusts it and the changes are reported.",
      inputSchema: {
        code: z.string().describe("VW Code, e.g. VC6NTLKS"),
        label: z.string().optional(),
      },
      annotations: { openWorldHint: true },
    },
    handle(async ({ code, label }) => {
      const c = normaliseCode(code);
      const stored = await client.loadConfiguration(c);
      // An empty step turns the stored configuration into a full, editable one.
      const res = await client.configStep(stored.storedConfiguration, [], []);
      const vc = effectiveConfiguration(res);
      const session = sessions.create(vc, res.vehicleCatalogue, label, c);
      const candidate = res.validationData?.conflicted ? res.validationData.solutionCandidates?.[0] : undefined;
      return {
        config_id: session.id,
        label: session.label,
        imported_code: c,
        code_expires: stored.expires,
        adjusted_by_backend: candidate ? describeCandidate(candidate) : null,
        ...summarise(vc, res.vehicleCatalogue),
      };
    }),
  );
}
