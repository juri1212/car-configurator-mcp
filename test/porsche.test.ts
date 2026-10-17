import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseOverview } from "../src/backends/porsche/catalog.js";
import { type CatalogItem, diffStates, type PorscheState } from "../src/backends/porsche/configuration.js";
import { parseCode, parseConfiguratorUrl } from "../src/backends/porsche/codes.js";
import { decodeData } from "../src/backends/porsche/turbo.js";
import { enabledBrands } from "../src/brands.js";
import { connectTestServer, type RecordedCall } from "./helpers.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/porsche/${name}`, import.meta.url), "utf8");
const codes = (list: { code: string }[]) => list.map((o) => o.code);

describe("porsche: formats", () => {
  it("decodes turbo-stream route data and redirects", () => {
    const data = decodeData(fixture("992142-start.data"));
    expect("routes" in data && (data.routes["customer-configurator"].data as { catalog: { modelName: string } }).catalog.modelName).toBe(
      "911 Carrera GTS",
    );
    const redirect = decodeData(fixture("load-PVHWED55.data"));
    expect(redirect).toMatchObject({ status: 302, redirect: expect.stringMatching(/^\/de-DE\/mode\/model\/992142\?loadedFrom=PVHWED55/) });
    expect(decodeData("[{}]")).toEqual({ routes: {} });
  });

  it("reads model cards from the porsche.com overview page", () => {
    const models = parseOverview(fixture("models-overview.html"));
    expect(models.length).toBeGreaterThan(80);
    expect(models.find((m) => m.modelType === "992142")).toMatchObject({
      modelName: "911 Carrera GTS",
      modelRangeId: "911",
      price: { value: 177100, currencyCode: "EUR" },
    });
  });

  it("parses codes and porsche-code.com links", () => {
    expect(parseCode("pvhw ed55")).toBe("PVHWED55");
    expect(parseCode("https://porsche-code.com/PVHWED55")).toBe("PVHWED55");
    expect(parseCode("porsche-code.com/pvhwed55/")).toBe("PVHWED55");
    expect(parseCode("https://example.com/PVHWED55")).toBeNull();
    expect(parseConfiguratorUrl(new URL("https://x/de-DE/mode/model/2026/992142?options=A.B"))).toEqual({
      orderType: "992142",
      modelYear: "2026",
      options: "A.B",
    });
  });

  it("enables Porsche with the other brands unless BRANDS says otherwise", () => {
    expect(enabledBrands({})).toEqual(["vw", "vwn", "porsche"]);
    expect(enabledBrands({ BRANDS: "porsche, vw" })).toEqual(["vw", "porsche"]);
    expect(() => enabledBrands({ BRANDS: "audi" })).toThrow(/"porsche"/);
    expect(enabledBrands({ VW_BRAND: "porsche" })).toEqual(["porsche"]);
    expect(enabledBrands({ BRANDS: "vw", VW_BRAND: "porsche" })).toEqual(["vw"]);
  });
});

describe("porsche: diffs", () => {
  const item = (code: string, extra: Partial<CatalogItem> = {}): CatalogItem => ({
    code,
    name: code,
    price: 100,
    category: "options",
    categoryId: "IEX",
    group: "Exterieur",
    selected: false,
    standard: false,
    paintToSample: false,
    ...extra,
  });
  const state = (items: CatalogItem[], total: number): PorscheState => ({
    orderType: "X",
    modelYear: 2027,
    modelName: "X",
    options: "",
    currency: "EUR",
    prices: { base: 0, options: 0, total },
    items,
  });

  it("leaves out package contents and reports extra options", () => {
    const before = state([item("PK6", { contains: ["6FH"] }), item("6FH"), item("8LH")], 1000);
    const after = state(
      [item("PK6", { contains: ["6FH"], selected: true }), item("6FH", { selected: true }), item("8LH", { selected: true })],
      1300,
    );
    const diff = diffStates(before, after, ["PK6"], [], { choices: [], conflict: false });
    expect(diff.side_effects.added.map((o) => o.code)).toEqual(["8LH"]);
    expect(diff.price_change).toBe(300);
  });
});

describe("porsche: tools", () => {
  const connect = (calls: RecordedCall[] = []) => connectTestServer(calls, undefined, { porsche: true });

  it("lists Porsche model ranges and variants next to Volkswagen", async () => {
    const { client, call } = await connect();
    expect(client.getInstructions()).toContain("configurator.porsche.com");

    const models = await call("list_models", { brand: "porsche" });
    const nine = models.find((m: { carline: string }) => m.carline === "911");
    expect(nine).toMatchObject({ brand: "porsche", name: "911", currency: "EUR" });
    expect(nine.from_price).toBeGreaterThan(100000);
    expect((await call("list_models")).map((m: { brand: string }) => m.brand)).toEqual(
      expect.arrayContaining(["vw", "vwn", "porsche"]),
    );

    const variants = await call("list_variants", { carline: "Taycan" });
    expect(variants.brand).toBe("porsche");
    const gts = (await call("list_variants", { carline: "911" })).trims
      .flatMap((t: { engines: { variant_id: string }[] }) => t.engines)
      .find((e: { variant_id: string }) => e.variant_id === "992142");
    expect(gts).toMatchObject({ name: "911 Carrera GTS", price: 177100, power: "541 PS" });
  });

  it("starts from a variant and summarises price, performance and efficiency", async () => {
    const { call } = await connect();
    const cfg = await call("start_configuration", { variant_id: "992142" });
    expect(cfg).toMatchObject({
      brand: "porsche",
      label: "911 Carrera GTS",
      model: { name: "911 Carrera GTS", model_code: "992142", model_year: "2027", variant_id: "992142" },
      exterior: { code: "0Q" },
      interior: { code: "SX" },
      prices: { currency: "EUR", total: 177100, base: 177100 },
      performance: { top_speed: "312 km/h", acceleration_0_100: "3,0 s" },
      efficiency: { co2_class: "G", combined_consumption: ["10,2 l/100 km (Kraftstoffverbrauch)"] },
    });
    expect(cfg.performance.power).toMatch(/kW \(541 PS\)$/);
    expect(cfg.technical_data).toBeUndefined();
    const summary = await call("get_summary", { config_id: cfg.config_id });
    expect(summary.technical_data.Fahrleistungen["Höchstgeschwindigkeit"]).toBe("312 km/h");

    const paints = await call("list_options", { config_id: cfg.config_id, category: "paint" });
    expect(codes(paints.options)).toEqual(expect.arrayContaining(["0Q", "A1", "N4"]));
    expect(paints.options.every((o: { category: string }) => o.category === "paint")).toBe(true);
    // Paint to Sample needs input the API can't take.
    expect(codes(paints.options).some((c) => c.includes("."))).toBe(false);
    const option = await call("get_option", { config_id: cfg.config_id, code: "p0a" });
    expect(option).toMatchObject({ code: "P0A", category: "packages", contains: [{ code: "5MH" }] });
    expect(option.description).toContain("Carbon matt");
  });

  it("swaps paint and reports the replaced one", async () => {
    const { call } = await connect();
    const { config_id } = await call("start_configuration", { variant_id: "992142" });
    const res = await call("change_options", { config_id, add: ["A1"] });
    expect(res).toMatchObject({ applied: true, saved: true, price_change: 0, choices_required: [] });
    expect(res.side_effects.replaced.map((o: { code: string }) => o.code)).toEqual(["0Q"]);
    expect(res.side_effects.removed).toEqual([]);
    expect((await call("get_summary", { config_id, technical_data: false })).exterior.code).toBe("A1");
  });

  it("applies conflicts with the user's pick and reports the backend's default", async () => {
    const calls: RecordedCall[] = [];
    const { call } = await connect(calls);
    const { config_id } = await call("start_configuration", { variant_id: "992142" });

    const preview = await call("change_options", { config_id, add: ["4D3", "Q1J"], dry_run: true });
    expect(preview).toMatchObject({ saved: false, applied: true, conflict_resolved: true, price_after: 180972.26 });
    expect((await call("get_summary", { config_id, technical_data: false })).prices.total).toBe(177100);

    const res = await call("change_options", { config_id, add: ["4D3", "Q1J"] });
    expect(res).toMatchObject({ saved: true, applied: true, price_before: 177100, price_after: 180972.26 });
    // Seats were picked by the request, the interior by the configurator.
    expect(res.choices_required).toHaveLength(1);
    expect(res.choices_required[0]).toMatchObject({ name: "Innenfarben & Material", chosen: { code: "SV" } });
    expect(codes(res.choices_required[0].choices)).toEqual(expect.arrayContaining(["SV", "AX"]));
    expect(codes(res.side_effects.removed)).toEqual(["SX"]);
    expect(codes(res.side_effects.added)).toEqual(["SV"]);
    expect(res.side_effects.standard_replaced).toEqual(["Sportsitze Plus (4-Wege, elektrisch)"]);

    const feasibility = calls.filter((c) => c.path.endsWith("/feasibility-notification.data"));
    expect(feasibility.at(-1)!.query.get("optionAdded")).toBe("4D3");
    expect(feasibility.at(-1)!.path).toContain("/mode/model/2027/992142/");
  });

  it("rejects unknown codes and Paint to Sample", async () => {
    const { call } = await connect();
    const { config_id } = await call("start_configuration", { variant_id: "992142" });
    expect((await call("change_options", { config_id, add: ["NOPE"] })).error).toMatch(/Unknown option code/);
    expect((await call("change_options", { config_id, add: ["0UD.89.24931"] })).error).toMatch(/Paint to Sample/);
    expect((await call("start_configuration", { variant_id: "000000", brand: "porsche" })).error).toMatch(/Unknown variant_id/);
  });

  it("exports a Porsche Code and imports codes and links", async () => {
    const calls: RecordedCall[] = [];
    const { call } = await connect(calls);
    const { config_id } = await call("start_configuration", { variant_id: "992142" });
    const exported = await call("export_code", { config_id });
    expect(exported).toMatchObject({ brand: "porsche", code: "PTEST123", configurator_url: "https://porsche-code.com/PTEST123" });
    const share = calls.find((c) => c.path.includes("/share-porsche-code/"))!;
    expect(share.query.get("options")).toContain(".0Q");

    // Plain codes look like VW Codes; the VW backends don't know this one.
    const imported = await call("import_code", { code: "PVHWED55" });
    expect(imported).toMatchObject({ brand: "porsche", imported_code: "PVHWED55", exterior: { code: "A1" }, adjusted_by_backend: null });
    expect(calls.filter((c) => c.path.includes("/load-configuration/"))).toHaveLength(1);
    expect((await call("import_code", { code: "https://porsche-code.com/PVHWED55" })).brand).toBe("porsche");
    expect((await call("import_code", { code: "PNOTFND1", brand: "porsche" })).error).toMatch(/not found/);
  });
});
