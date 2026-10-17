#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PorscheBackend } from "./backends/porsche/adapter.js";
import { PorscheClient } from "./backends/porsche/client.js";
import { createVictorBackends } from "./backends/victor/adapter.js";
import { resolveBrands } from "./backends/victor/brand.js";
import { VictorClient } from "./backends/victor/client.js";
import { enabledBrands } from "./brands.js";
import { SessionStore } from "./session.js";
import { registerCatalogTools } from "./tools/catalog.js";
import { registerCodeTools } from "./tools/codes.js";
import { registerCompareTools } from "./tools/compare.js";
import { registerConfigureTools } from "./tools/configure.js";
import type { Backend, ToolContext } from "./tools/context.js";

const VERSION = "0.1.0";

export function createServer(backends: Backend[], sessions = new SessionStore()) {
  if (!backends.length) throw new Error("No brand enabled");
  const ctx: ToolContext = { backends, sessions };
  const brands = backends.map((b) => `${b.name} (${b.vehicles}, ${b.host}, brand "${b.key}")`);
  const multi = backends.length > 1;
  const notes = [...new Set(backends.flatMap((b) => (b.notes ? [b.notes] : [])))];
  const server = new McpServer(
    { name: "car-configurator-mcp", version: VERSION },
    {
      instructions:
        `Spec vehicles through the official configurators: ${brands.join("; ")}. ` +
        (multi
          ? "Models of all brands are listed together; pass brand to narrow down. Configurations remember their brand. "
          : "") +
        "Typical flow: list_models → list_variants → start_configuration → list_options / change_options (use dry_run to preview) → get_summary → export_code. " +
        "Always tell the user about side_effects of change_options. Prices are in the market currency (see currency), incl. VAT. " +
        notes.map((n) => `${n} `).join("") +
        "export_code returns a link (configurator_url) that opens the same configuration in the brand's configurator; give the user that link.",
    },
  );
  registerCatalogTools(server, ctx);
  registerConfigureTools(server, ctx);
  registerCodeTools(server, ctx);
  registerCompareTools(server, ctx);
  return server;
}

async function main() {
  const log = (m: string) => process.stderr.write(`[car-configurator-mcp] ${m}\n`);
  const victor = createVictorBackends(
    resolveBrands(),
    (brand) =>
      new VictorClient({
        apiKey: process.env.VW_API_KEY,
        tenant: brand.tenant,
        site: brand.site,
        log: (m) => log(`${brand.key}: ${m}`),
      }),
  );
  const backends: Backend[] = [...victor];
  if (enabledBrands().includes("porsche")) {
    backends.push(
      new PorscheBackend(
        new PorscheClient({
          locale: process.env.PORSCHE_LOCALE,
          modelsUrl: process.env.PORSCHE_MODELS_URL,
          log: (m) => log(`porsche: ${m}`),
        }),
      ),
    );
  }
  const server = createServer(backends);
  await server.connect(new StdioServerTransport());
  log(`ready (v${VERSION}, ${backends.map((b) => b.name).join(", ")})`);
  // Discover API keys/tenants in the background so the first tool call is faster.
  for (const { key, client } of victor) client.init().then(() => log(`${key}: tenant ${client.tenantKey}`));
}

const entry = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err) => {
    process.stderr.write(`[car-configurator-mcp] fatal: ${String(err)}\n`);
    process.exit(1);
  });
}
