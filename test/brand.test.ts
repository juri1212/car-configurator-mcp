import { describe, expect, it } from "vitest";
import { resolveBrand, resolveBrands } from "../src/brand.js";
import { connectTestServer } from "./helpers.js";

describe("brand", () => {
  it("defaults to volkswagen.de with a discovered tenant", () => {
    expect(resolveBrand("vw", {})).toMatchObject({
      key: "vw",
      site: "https://www.volkswagen.de/de",
      host: "www.volkswagen.de",
      tenant: undefined,
      loadCodeUrl: "https://www.volkswagen.de/de/modelle/konfiguration-laden.html",
    });
  });

  it("uses the commercial site and tenant for vwn", () => {
    expect(resolveBrand("vwn", {})).toMatchObject({
      key: "vwn",
      name: "Volkswagen Nutzfahrzeuge",
      host: "www.volkswagen-nutzfahrzeuge.de",
      tenant: "ihdcc-vwn-de-de",
      loadCodeUrl: "https://www.volkswagen-nutzfahrzeuge.de/de/modelle/konfiguration-laden.html",
    });
  });

  it("lets per-brand settings override each brand", () => {
    const env = {
      VW_SITE: "https://example.test/at/",
      VW_TENANT: "t",
      VW_LOAD_CODE_URL: "u",
      VWN_TENANT: "tn",
    };
    expect(resolveBrand("vw", env)).toMatchObject({ site: "https://example.test/at", tenant: "t", loadCodeUrl: "u" });
    expect(resolveBrand("vwn", env)).toMatchObject({ host: "www.volkswagen-nutzfahrzeuge.de", tenant: "tn" });
  });

  it("serves both brands unless VW_BRAND picks one", () => {
    expect(resolveBrands({}).map((b) => b.key)).toEqual(["vw", "vwn"]);
    expect(resolveBrands({ VW_BRAND: "all" }).map((b) => b.key)).toEqual(["vw", "vwn"]);
    expect(resolveBrands({ VW_BRAND: "VWN" }).map((b) => b.key)).toEqual(["vwn"]);
    expect(resolveBrands({ VW_BRAND: "vw, vwn" }).map((b) => b.key)).toEqual(["vw", "vwn"]);
  });

  it("rejects unknown brands", () => {
    expect(() => resolveBrands({ VW_BRAND: "audi" })).toThrow(/VW_BRAND/);
  });

  it("names both sites in server instructions and tools", async () => {
    const { client } = await connectTestServer();
    expect(client.getInstructions()).toContain("www.volkswagen.de");
    expect(client.getInstructions()).toContain("www.volkswagen-nutzfahrzeuge.de");
    expect(client.getInstructions()).toContain("net_total");
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "export_code")!.description).toContain("www.volkswagen-nutzfahrzeuge.de");
  });

  it("only offers the enabled brands", async () => {
    const { client, call } = await connectTestServer([], resolveBrands({ VW_BRAND: "vwn" }));
    expect(client.getInstructions()).not.toContain("www.volkswagen.de");
    expect((await call("list_models")).every((m: { brand: string }) => m.brand === "vwn")).toBe(true);
    expect((await call("list_models", { brand: "vw" })).error).toBeDefined();
  });
});
