import { describe, expect, it } from "vitest";
import { connectTestServer, type RecordedCall } from "./helpers.js";

describe("MCP server", () => {
  it("registers all tools", async () => {
    const { client } = await connectTestServer();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "change_options",
      "compare_configurations",
      "export_code",
      "get_option",
      "get_summary",
      "import_code",
      "list_configurations",
      "list_models",
      "list_options",
      "list_variants",
      "start_configuration",
    ]);
  });

  it("runs the full flow: browse, configure, export", async () => {
    const calls: RecordedCall[] = [];
    const { call } = await connectTestServer(calls);

    const models = await call("list_models", { query: "polo" });
    expect(models.map((m: { name: string }) => m.name)).toContain("Der Polo");

    const variants = await call("list_variants", { carline: "Polo" });
    expect(variants.trims.some((t: { name: string }) => t.name === "EDITION 50")).toBe(true);

    const started = await call("start_configuration", { carline: "Polo", trim: "EDITION 50", label: "Mein Polo" });
    expect(started.config_id).toMatch(/^cfg_/);
    expect(started.label).toBe("Mein Polo");
    expect(started.prices.total).toBe(29525);
    const startCall = calls.find((c) => c.path === "/vcso/configStart")!;
    expect(startCall.query.get("tenant")).toBe("ihdcc-vw-de-de");
    expect(startCall.query.get("trimName")).toBe("EDITION 50");
    expect(startCall.query.get("cacheKey")).toBe("test-cache-key");

    const id = started.config_id;
    const preview = await call("change_options", { config_id: id, add: ["GPF3PF3"], dry_run: true });
    expect(preview).toMatchObject({ dry_run: true, saved: false, price_change: 405 });
    expect((await call("get_summary", { config_id: id })).prices.total).toBe(29525);

    const changed = await call("change_options", { config_id: id, add: ["gpf3pf3"] });
    expect(changed).toMatchObject({ saved: true, applied: true, price_after: 29930 });
    const stepCall = calls.filter((c) => c.path === "/vcso/configStep").at(-1)!;
    expect(stepCall.body.addedFeatures).toEqual([{ code: "GPF3PF3" }]);

    const summary = await call("get_summary", { config_id: id });
    expect(summary.options.map((o: { code: string }) => o.code)).toContain("GPF3PF3");
    expect(summary.technical_data).toBeDefined();

    const exported = await call("export_code", { config_id: id });
    expect(exported).toMatchObject({ vw_code: "VTEST123", load_at: expect.stringContaining("konfiguration-laden") });
    expect(exported.expires).toBeTruthy();

    const list = await call("list_configurations");
    expect(list[0]).toMatchObject({ config_id: id, vw_code: "VTEST123", total_price: 29930 });
  });

  it("does not save anything when a step fails", async () => {
    const { call } = await connectTestServer();
    const { config_id } = await call("start_configuration", { carline: "Polo", trim: "EDITION 50" });
    const res = await call("change_options", { config_id, add: ["GPJ9PJ9"] });
    expect(res.error).toMatch(/Could not add GPJ9PJ9: HTTP 400.*not distinct.*Nothing was changed/);
    expect((await call("get_summary", { config_id })).prices.total).toBe(29525);
  });

  it("rejects unknown option codes and config ids", async () => {
    const { call } = await connectTestServer();
    const { config_id } = await call("start_configuration", { carline: "Polo", trim: "EDITION 50" });
    expect((await call("change_options", { config_id, add: ["NOPE"] })).error).toMatch(/Unknown option code/);
    expect((await call("get_summary", { config_id: "cfg_missing" })).error).toMatch(/Unknown config_id/);
  });

  it("imports a VW Code into an editable configuration", async () => {
    const { call } = await connectTestServer();
    const imported = await call("import_code", { code: "vlcq nlfl" });
    expect(imported.imported_code).toBe("VLCQNLFL");
    expect(imported.prices.total).toBe(29930);
    expect(imported.options.map((o: { code: string }) => o.code)).toContain("GPF3PF3");
    expect((await call("import_code", { code: "short" })).error).toMatch(/not a VW Code/);
  });

  it("compares configurations", async () => {
    const { call } = await connectTestServer();
    const a = await call("start_configuration", { carline: "Polo", trim: "EDITION 50", label: "A" });
    const b = await call("import_code", { code: "VLCQNLFL", label: "B" });
    const cmp = await call("compare_configurations", { config_ids: [a.config_id, b.config_id] });
    expect(cmp.configurations).toHaveLength(2);
    expect(cmp.configurations[1].options_only_here.map((o: { code: string }) => o.code)).toContain("GPF3PF3");
    expect(cmp.configurations[0].power).toBe("70 kW (95 PS)");
  });
});
