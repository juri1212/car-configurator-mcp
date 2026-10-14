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

    expect(started.prices.currency).toBe("EUR");
    const id = started.config_id;
    const preview = await call("change_options", { config_id: id, add: ["GPF3PF3"], dry_run: true });
    expect(preview).toMatchObject({ dry_run: true, saved: false, price_change: 405, choices_required: [] });
    expect((await call("get_summary", { config_id: id })).prices.total).toBe(29525);

    const changed = await call("change_options", { config_id: id, add: ["gpf3pf3"] });
    expect(changed).toMatchObject({ saved: true, applied: true, price_after: 29930 });
    const stepCall = calls.filter((c) => c.path === "/vcso/configStep").at(-1)!;
    expect(stepCall.body.addedFeatures).toEqual([{ code: "GPF3PF3" }]);

    const summary = await call("get_summary", { config_id: id });
    expect(summary.options.map((o: { code: string }) => o.code)).toContain("GPF3PF3");
    expect(summary.technical_data).toBeDefined();

    const exported = await call("export_code", { config_id: id });
    expect(exported).toMatchObject({ code: "VTEST123" });
    expect(exported.configurator_url).toBe(
      "https://www.volkswagen.de/de/konfigurator.html/__app/route:configure.app?buildabilityStatus-app=buildable&tenant-app=private&carlineId-app=30204&salesGroupId-app=37057&trimName-app=EDITION+50&modelId-app=AE14AV%24MAAUE50%24GWS3WS3%24GYOSYOS&modelVersion-app=0&modelYear-app=2027&exteriorId-app=F14+6U6U&interiorId-app=F56+++++FJ&options-app=GPF3PF3&category-app=private",
    );
    expect(exported.expires).toBeTruthy();

    const list = await call("list_configurations");
    expect(list[0]).toMatchObject({ config_id: id, code: "VTEST123", configurator_url: exported.configurator_url, total_price: 29930 });
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

  it("serves cars and commercial vehicles side by side", async () => {
    const calls: RecordedCall[] = [];
    const { call } = await connectTestServer(calls);

    const models = await call("list_models");
    const brandOf = (name: string) => models.find((m: { name: string }) => m.name === name)?.brand;
    expect(brandOf("Der Polo")).toBe("vw");
    expect(brandOf("Der ID. Buzz")).toBe("vwn");
    expect((await call("list_models", { brand: "vwn" })).map((m: { brand: string }) => m.brand)).not.toContain("vw");

    const variants = await call("list_variants", { carline: "ID. Buzz" });
    expect(variants).toMatchObject({ brand: "vwn", carline: "72006" });

    const polo = await call("start_configuration", { carline: "Polo", trim: "EDITION 50" });
    const buzz = await call("start_configuration", { carline: "Der ID. Buzz", trim: "Pure" });
    expect(polo.brand).toBe("vw");
    expect(buzz.brand).toBe("vwn");
    expect(buzz.prices.net_total).toBeLessThan(buzz.prices.total);
    const starts = calls.filter((c) => c.path === "/vcso/configStart").map((c) => c.query.get("tenant"));
    expect(starts).toEqual(["ihdcc-vw-de-de", "ihdcc-vwn-de-de"]);

    calls.length = 0;
    const exported = await call("export_code", { config_id: buzz.config_id });
    expect(exported).toMatchObject({ brand: "vwn", configurator_url: expect.stringContaining("volkswagen-nutzfahrzeuge.de/de/konfigurator.html/__app/") });
    expect(calls.find((c) => c.path === "/vcso/storeConfiguration")!.query.get("tenant")).toBe("ihdcc-vwn-de-de");
    expect((await call("export_code", { config_id: polo.config_id })).configurator_url).toContain("www.volkswagen.de/de/konfigurator.html/__app/");

    const list = await call("list_configurations");
    expect(list.map((c: { brand: string }) => c.brand).sort()).toEqual(["vw", "vwn"]);
  });

  it("explains carline names that match in several brands", async () => {
    const { call } = await connectTestServer();
    expect((await call("list_variants", { carline: "ID." })).error).toMatch(/several models.*\(72006, vwn\)/);
    expect((await call("list_variants", { carline: "Buzz", brand: "vw" })).error).toMatch(/No model matches/);
  });

  it("imports a commercial vehicle code into its brand", async () => {
    const calls: RecordedCall[] = [];
    const { call } = await connectTestServer(calls);
    const imported = await call("import_code", { code: "VBUZZ001" });
    expect(imported.brand).toBe("vwn");
    expect(calls.find((c) => c.path === "/vcso/configStep")!.query.get("tenant")).toBe("ihdcc-vwn-de-de");
    expect((await call("import_code", { code: "VLCQNLFL" })).brand).toBe("vw");
  });

  it("imports into the brand given", async () => {
    const calls: RecordedCall[] = [];
    const { call } = await connectTestServer(calls);
    expect((await call("import_code", { code: "VBUZZ001", brand: "vwn" })).brand).toBe("vwn");
    // No carline detection needed: no overview request.
    expect(calls.some((c) => c.path === "/viso/catalogue/models/overview")).toBe(false);
  });

  it("compares configurations", async () => {
    const { call } = await connectTestServer();
    const a = await call("start_configuration", { carline: "Polo", trim: "EDITION 50", label: "A" });
    const b = await call("import_code", { code: "VLCQNLFL", label: "B" });
    const cmp = await call("compare_configurations", { config_ids: [a.config_id, b.config_id] });
    expect(cmp.configurations).toHaveLength(2);
    expect(cmp.configurations[1].options_only_here.map((o: { code: string }) => o.code)).toContain("GPF3PF3");
    expect(cmp.configurations[0].power).toBe("70 kW (95 PS)");
    expect(cmp.configurations[0]).toHaveProperty("top_speed");
    expect(cmp.configurations[0]).not.toHaveProperty("Höchstgeschwindigkeit");
  });

  it("starts from a variant_id", async () => {
    const calls: RecordedCall[] = [];
    const { call } = await connectTestServer(calls);
    const variants = await call("list_variants", { carline: "Polo" });
    const engine = variants.trims.find((t: { name: string }) => t.name === "EDITION 50").engines[0];
    const started = await call("start_configuration", { variant_id: engine.variant_id });
    expect(started.brand).toBe("vw");
    const q = calls.find((c) => c.path === "/vcso/configStart")!.query;
    expect([q.get("carlineKey"), q.get("trimName"), q.get("modelKey")]).toEqual(["30204", "EDITION 50", engine.model_code]);
    expect((await call("start_configuration", { variant_id: "nope" })).error).toMatch(/Unknown variant_id/);
    expect((await call("start_configuration", { carline: "Polo" })).error).toMatch(/variant_id, or carline and trim/);
  });

  it("filters options by shared category", async () => {
    const { call } = await connectTestServer();
    const { config_id } = await call("start_configuration", { carline: "Polo", trim: "EDITION 50" });
    const packages = await call("list_options", { config_id, category: "packages" });
    expect(packages.currency).toBe("EUR");
    expect(packages.options.map((o: { code: string }) => o.code)).toContain("GPF3PF3");
    expect((await call("list_options", { config_id, category: "exterior" })).error).toBeDefined();
  });
});
