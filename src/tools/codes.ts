import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  type Backend,
  backendsFor,
  brandArg,
  codeNames,
  handle,
  hosts,
  sessionBackend,
  snapshot,
  type ToolContext,
} from "./context.js";

/**
 * Picks the backend for a code: the given brand, else the first backend that
 * claims it, else the first whose code format fits.
 */
async function codeBackend(ctx: ToolContext, raw: string, brand?: string): Promise<{ backend: Backend; code: string }> {
  const candidates = backendsFor(ctx, brand).flatMap((backend) => {
    const code = backend.parseCode(raw);
    return code ? [{ backend, code }] : [];
  });
  if (!candidates.length) {
    const formats = [...new Set(backendsFor(ctx, brand).map((b) => `a ${b.codeName} (${b.codeFormat})`))];
    throw new Error(`"${raw}" is not ${formats.join(" or ")}`);
  }
  if (candidates.length > 1) {
    for (const c of candidates) if (await c.backend.ownsCode(c.code)) return c;
  }
  return candidates[0];
}

export function registerCodeTools(server: McpServer, ctx: ToolContext) {
  const { sessions } = ctx;
  const names = codeNames(ctx);

  server.registerTool(
    "export_code",
    {
      title: "Export code",
      description: `Save a configuration with the manufacturer and get a link that opens exactly this vehicle in the official configurator on the brand's site (${hosts(ctx)}). Give the user the link. The code (${names}) is the same configuration in short form (it can be re-imported with import_code).`,
      inputSchema: { config_id: z.string().describe("Configuration to export") },
      annotations: { openWorldHint: true },
    },
    handle(async ({ config_id }) => {
      const s = sessions.get(config_id);
      const exported = await sessionBackend(ctx, s).exportCode(s.state);
      s.code = { value: exported.code, url: exported.url, expires: exported.expires, exportedAt: new Date() };
      return {
        config_id: s.id,
        brand: s.brand,
        configurator_url: exported.url,
        code: exported.code,
        expires: exported.expires,
        model: s.snapshot.model,
        total_price: s.snapshot.total_price,
      };
    }),
  );

  server.registerTool(
    "import_code",
    {
      title: "Import code",
      description: `Load a ${names} (from ${hosts(ctx)} or export_code) into a new configuration that can be inspected and changed. The brand is detected from the code unless given. If the stored vehicle can no longer be built as-is, the backend adjusts it and the changes are reported.`,
      inputSchema: {
        code: z.string().describe("Code, e.g. VC6NTLKS, or a porsche-code.com link"),
        brand: brandArg(ctx, "Brand the code belongs to"),
        label: z.string().optional(),
      },
      annotations: { openWorldHint: true },
    },
    handle(async ({ code, brand, label }) => {
      const { backend, code: c } = await codeBackend(ctx, code, brand);
      const imported = await backend.importCode(c);
      const summary = await backend.summary(imported.state, { technical: false });
      const session = sessions.create(backend.key, imported.state, label?.trim() || imported.label, snapshot(backend, imported.state), c);
      return {
        config_id: session.id,
        brand: session.brand,
        label: session.label,
        imported_code: imported.code,
        code_expires: imported.expires,
        adjusted_by_backend: imported.adjusted_by_backend,
        ...summary,
      };
    }),
  );
}
