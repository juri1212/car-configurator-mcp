import { describe, expect, it } from "vitest";
import { resolveBrand } from "../src/brand.js";
import { connectTestServer } from "./helpers.js";

describe("brand", () => {
  it("defaults to volkswagen.de with a discovered tenant", () => {
    expect(resolveBrand({})).toMatchObject({
      key: "vw",
      site: "https://www.volkswagen.de/de",
      host: "www.volkswagen.de",
      tenant: undefined,
      loadCodeUrl: "https://www.volkswagen.de/de/modelle/konfiguration-laden.html",
    });
  });

  it("uses the commercial site and tenant for vwn", () => {
    expect(resolveBrand({ VW_BRAND: "VWN" })).toMatchObject({
      key: "vwn",
      name: "Volkswagen Nutzfahrzeuge",
      host: "www.volkswagen-nutzfahrzeuge.de",
      tenant: "ihdcc-vwn-de-de",
      loadCodeUrl: "https://www.volkswagen-nutzfahrzeuge.de/de/modelle/konfiguration-laden.html",
    });
  });

  it("lets explicit settings override the brand", () => {
    const brand = resolveBrand({ VW_BRAND: "vwn", VW_SITE: "https://example.test/at/", VW_TENANT: "t", VW_LOAD_CODE_URL: "u" });
    expect(brand).toMatchObject({ site: "https://example.test/at", tenant: "t", loadCodeUrl: "u" });
  });

  it("rejects unknown brands", () => {
    expect(() => resolveBrand({ VW_BRAND: "audi" })).toThrow(/VW_BRAND/);
  });

  it("names the brand's site in server instructions and tools", async () => {
    const { client } = await connectTestServer([], resolveBrand({ VW_BRAND: "vwn" }));
    expect(client.getInstructions()).toContain("www.volkswagen-nutzfahrzeuge.de");
    expect(client.getInstructions()).toContain("net_total");
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "export_code")!.description).toContain("www.volkswagen-nutzfahrzeuge.de");
  });
});
