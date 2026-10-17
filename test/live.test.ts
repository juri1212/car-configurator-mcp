// Live smoke test against the real configurator backends, through the built
// server over stdio. Run with `npm run build && npm run test:live`.
// Creates two VW Codes (one car, one commercial vehicle) and a Porsche Code per run.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const live = !!process.env.LIVE;

describe.skipIf(!live)("live", () => {
  let client: Client;

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    if (res.isError) throw new Error(`${name}: ${res.content[0].text}`);
    return JSON.parse(res.content[0].text);
  };

  beforeAll(async () => {
    client = new Client({ name: "live-test", version: "0" });
    await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"], stderr: "inherit" }));
  });
  afterAll(() => client?.close());

  it("configures a Golf, exports a code and imports it again", { timeout: 120_000 }, async () => {
    const models = await call("list_models");
    expect(models.length).toBeGreaterThan(5);

    const variants = await call("list_variants", { carline: "Golf" });
    const trim = variants.trims.find((t: { name: string }) => t.name === "Style") ?? variants.trims[0];
    const engine = trim.engines.at(-1);

    const cfg = await call("start_configuration", { carline: "Golf", trim: trim.name, model_code: engine.model_code });
    expect(cfg.model.trim).toBe(trim.name);
    const id = cfg.config_id;

    const paints = await call("list_options", { config_id: id, category: "paint", only_selectable: true });
    const paint = paints.options.find((o: { price: number | null }) => (o.price ?? 0) > 0) ?? paints.options[0];
    const paintChange = await call("change_options", { config_id: id, add: [paint.code] });
    expect(paintChange.applied).toBe(true);
    expect(paintChange.side_effects.replaced.map((o: { code: string }) => o.code)).toEqual([cfg.exterior.code]);

    const options = await call("list_options", { config_id: id, category: "options", only_selectable: true });
    const option = options.options.find((o: { price: number | null }) => (o.price ?? 0) > 0);
    const preview = await call("change_options", { config_id: id, add: [option.code], dry_run: true });
    expect(preview.saved).toBe(false);
    const applied = await call("change_options", { config_id: id, add: [option.code] });
    expect(applied.price_after).toBe(preview.price_after);

    const summary = await call("get_summary", { config_id: id });
    expect(summary.exterior.code).toBe(paint.code);

    const exported = await call("export_code", { config_id: id });
    expect(exported.code).toMatch(/^[A-Z0-9]{8}$/);
    console.log(`VW Code: ${exported.code} (${summary.model.name}, ${summary.prices.total} €)`);

    const imported = await call("import_code", { code: exported.code });
    expect(imported.exterior.code).toBe(paint.code);
    expect(imported.prices.total).toBe(summary.prices.total);
    expect(imported.options.map((o: { code: string }) => o.code)).toContain(option.code);
  });
});

describe.skipIf(!live)("live (Volkswagen Nutzfahrzeuge)", () => {
  let client: Client;

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    if (res.isError) throw new Error(`${name}: ${res.content[0].text}`);
    return JSON.parse(res.content[0].text);
  };

  beforeAll(async () => {
    client = new Client({ name: "live-test", version: "0" });
    await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"], stderr: "inherit" }));
  });
  afterAll(() => client?.close());

  it("configures an ID. Buzz with gross and net prices and exports a code", { timeout: 120_000 }, async () => {
    const models = await call("list_models", { query: "buzz" });
    expect(models).toContainEqual(expect.objectContaining({ name: "Der ID. Buzz", brand: "vwn" }));

    const variants = await call("list_variants", { carline: "ID. Buzz" });
    const cfg = await call("start_configuration", { carline: "ID. Buzz", trim: variants.trims[0].name });
    expect(cfg.prices.net_total).toBeLessThan(cfg.prices.total);

    const paints = await call("list_options", { config_id: cfg.config_id, category: "paint", only_selectable: true });
    const paint = paints.options.find((o: { price: number | null }) => (o.price ?? 0) > 0);
    const change = await call("change_options", { config_id: cfg.config_id, add: [paint.code] });
    expect(change.price_change).toBeCloseTo(paint.price, 2);

    const exported = await call("export_code", { config_id: cfg.config_id });
    expect(exported.configurator_url).toMatch(/^https:\/\/www\.volkswagen-nutzfahrzeuge\.de\/de\/konfigurator\.html\/__app\//);
    console.log(`VW Code: ${exported.code} (${exported.model}, ${exported.total_price} €)\n${exported.configurator_url}`);

    const imported = await call("import_code", { code: exported.code });
    expect(imported.brand).toBe("vwn");
    expect(imported.prices.total).toBe(change.price_after);
  });
});

describe.skipIf(!live)("live (Porsche)", () => {
  let client: Client;

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    if (res.isError) throw new Error(`${name}: ${res.content[0].text}`);
    return JSON.parse(res.content[0].text);
  };

  beforeAll(async () => {
    client = new Client({ name: "live-test", version: "0" });
    await client.connect(
      new StdioClientTransport({
        command: "node",
        args: ["dist/index.js"],
        env: { ...(process.env as Record<string, string>), BRANDS: "porsche" },
        stderr: "inherit",
      }),
    );
  });
  afterAll(() => client?.close());

  it("configures a 911, exports a Porsche Code and imports it again", { timeout: 120_000 }, async () => {
    const models = await call("list_models");
    expect(models.map((m: { carline: string }) => m.carline)).toContain("911");

    const variants = await call("list_variants", { carline: "911" });
    const variant = variants.trims[0].engines[0];
    const cfg = await call("start_configuration", { variant_id: variant.variant_id });
    expect(cfg.prices.total).toBeGreaterThan(0);
    expect(cfg.performance.power).toBeTruthy();
    const id = cfg.config_id;

    const paints = await call("list_options", { config_id: id, category: "paint", only_selectable: true });
    const paint = paints.options.find((o: { price: number | null }) => (o.price ?? 0) > 0);
    const paintChange = await call("change_options", { config_id: id, add: [paint.code] });
    expect(paintChange.side_effects.replaced.map((o: { code: string }) => o.code)).toEqual([cfg.exterior.code]);
    expect(paintChange.price_change).toBeCloseTo(paint.price - (cfg.exterior.price ?? 0), 2);

    const options = await call("list_options", { config_id: id, category: "options", only_selectable: true });
    const option = options.options.find((o: { price: number | null }) => (o.price ?? 0) > 0);
    const preview = await call("change_options", { config_id: id, add: [option.code], dry_run: true });
    const applied = await call("change_options", { config_id: id, add: [option.code] });
    expect(applied.price_after).toBe(preview.price_after);

    const exported = await call("export_code", { config_id: id });
    expect(exported.configurator_url).toBe(`https://porsche-code.com/${exported.code}`);
    console.log(`Porsche Code: ${exported.code} (${exported.model}, ${exported.total_price} €)`);

    const imported = await call("import_code", { code: exported.configurator_url });
    expect(imported.brand).toBe("porsche");
    expect(imported.exterior.code).toBe(paint.code);
    expect(imported.prices.total).toBe(applied.price_after);
  });
});
