#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type Brand, resolveBrand } from "./brand.js";
import { SessionStore } from "./session.js";
import { registerCatalogTools } from "./tools/catalog.js";
import { registerCodeTools } from "./tools/codes.js";
import { registerCompareTools } from "./tools/compare.js";
import { registerConfigureTools } from "./tools/configure.js";
import type { ToolContext } from "./tools/context.js";
import { VictorClient } from "./victor/client.js";

const VERSION = "0.1.0";

export function createServer(client: VictorClient, sessions = new SessionStore(), brand: Brand = resolveBrand()) {
  const ctx: ToolContext = { client, sessions, brand };
  const prices =
    brand.key === "vwn"
      ? "Prices are EUR incl. VAT; summaries also give net_total excl. VAT, which business customers usually go by. "
      : "Prices are EUR incl. VAT for private customers. ";
  const server = new McpServer(
    { name: "vw-cc-mcp", version: VERSION },
    {
      instructions:
        `Spec ${brand.vehicles} through the ${brand.name} configurator (${brand.host}). Typical flow: list_models → list_variants → start_configuration → list_options / change_options (use dry_run to preview) → get_summary → export_code. ` +
        `Always tell the user about side_effects of change_options. ${prices}` +
        `The VW Code from export_code opens the same configuration on ${brand.host} ("Konfiguration laden").`,
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
  const brand = resolveBrand();
  const client = new VictorClient({
    apiKey: process.env.VW_API_KEY,
    tenant: brand.tenant,
    site: brand.site,
    log,
  });
  const server = createServer(client, new SessionStore(), brand);
  await server.connect(new StdioServerTransport());
  log(`ready (v${VERSION}, ${brand.name})`);
  // Discover API key/tenant in the background so the first tool call is faster.
  client.init().then(() => log(`tenant ${client.tenantKey}`));
}

const entry = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err) => {
    process.stderr.write(`[vw-cc-mcp] fatal: ${String(err)}\n`);
    process.exit(1);
  });
}
