#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SessionStore } from "./session.js";
import { registerCatalogTools } from "./tools/catalog.js";
import { registerCodeTools } from "./tools/codes.js";
import { registerCompareTools } from "./tools/compare.js";
import { registerConfigureTools } from "./tools/configure.js";
import type { ToolContext } from "./tools/context.js";
import { VictorClient } from "./victor/client.js";

const VERSION = "0.1.0";

export function createServer(client: VictorClient, sessions = new SessionStore()) {
  const site = (process.env.VW_SITE ?? "https://www.volkswagen.de/de").replace(/\/$/, "");
  const ctx: ToolContext = {
    client,
    sessions,
    loadCodeUrl: process.env.VW_LOAD_CODE_URL ?? `${site}/modelle/konfiguration-laden.html`,
  };
  const server = new McpServer(
    { name: "vw-cc-mcp", version: VERSION },
    {
      instructions:
        "Spec a Volkswagen through the volkswagen.de configurator. Typical flow: list_models → list_variants → start_configuration → list_options / change_options (use dry_run to preview) → get_summary → export_code. " +
        "Always tell the user about side_effects of change_options. Prices are EUR incl. VAT for private customers. " +
        "The VW Code from export_code opens the same car on volkswagen.de (\"Konfiguration laden\").",
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
  const client = new VictorClient({
    apiKey: process.env.VW_API_KEY,
    tenant: process.env.VW_TENANT,
    site: process.env.VW_SITE,
    log,
  });
  const server = createServer(client);
  await server.connect(new StdioServerTransport());
  log(`ready (v${VERSION})`);
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
