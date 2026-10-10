#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveBrands } from "./brand.js";
import { SessionStore } from "./session.js";
import { registerCatalogTools } from "./tools/catalog.js";
import { registerCodeTools } from "./tools/codes.js";
import { registerCompareTools } from "./tools/compare.js";
import { registerConfigureTools } from "./tools/configure.js";
import type { Backend, ToolContext } from "./tools/context.js";
import { VictorClient } from "./victor/client.js";

const VERSION = "0.1.0";

export function createServer(backends: Backend[], sessions = new SessionStore()) {
  if (!backends.length) throw new Error("No brand enabled");
  const ctx: ToolContext = { backends, sessions };
  const brands = backends.map((b) => `${b.brand.name} (${b.brand.vehicles}, ${b.brand.host}, brand "${b.brand.key}")`);
  const multi = backends.length > 1;
  const commercial = backends.some((b) => b.brand.key === "vwn");
  const server = new McpServer(
    { name: "vw-cc-mcp", version: VERSION },
    {
      instructions:
        `Spec Volkswagen vehicles through the official configurator: ${brands.join("; ")}. ` +
        (multi
          ? "Models of all brands are listed together; pass brand to narrow down. Configurations remember their brand. "
          : "") +
        "Typical flow: list_models → list_variants → start_configuration → list_options / change_options (use dry_run to preview) → get_summary → export_code. " +
        "Always tell the user about side_effects of change_options. Prices are EUR incl. VAT. " +
        (commercial
          ? "Commercial vehicle summaries also give net_total excl. VAT, which business customers usually go by. "
          : "") +
        `The VW Code from export_code opens the same configuration on the brand's site ("Konfiguration laden", see load_at).`,
    },
  );
  registerCatalogTools(server, ctx);
  registerConfigureTools(server, ctx);
  registerCodeTools(server, ctx);
  registerCompareTools(server, ctx);
  return server;
}

async function main() {
  const log = (m: string) => process.stderr.write(`[vw-cc-mcp] ${m}\n`);
  const backends: Backend[] = resolveBrands().map((brand) => ({
    brand,
    client: new VictorClient({
      apiKey: process.env.VW_API_KEY,
      tenant: brand.tenant,
      site: brand.site,
      log: (m) => log(`${brand.key}: ${m}`),
    }),
  }));
  const server = createServer(backends);
  await server.connect(new StdioServerTransport());
  log(`ready (v${VERSION}, ${backends.map((b) => b.brand.name).join(", ")})`);
  // Discover API keys/tenants in the background so the first tool call is faster.
  for (const { brand, client } of backends) client.init().then(() => log(`${brand.key}: tenant ${client.tenantKey}`));
}

const entry = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err) => {
    process.stderr.write(`[vw-cc-mcp] fatal: ${String(err)}\n`);
    process.exit(1);
  });
}
