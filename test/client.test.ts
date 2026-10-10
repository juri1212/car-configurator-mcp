import { describe, expect, it } from "vitest";
import { VictorClient, errorMessage } from "../src/victor/client.js";

const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });

describe("VictorClient", () => {
  it("discovers API key and tenant from the market site", async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: string) => {
      urls.push(url);
      if (url.endsWith(".feature-apps.json")) {
        return json(200, {
          featureApps: [
            { name: "Other", featureAppApiKey: "nope" },
            { name: "Configure", featureAppApiKey: null, instanceConfig: JSON.stringify({ oneApiKey: "discovered" }) },
          ],
        });
      }
      if (url.endsWith(".global-config.json")) {
        return json(200, { spaAsyncConfig: { serviceConfigs: { "oneapi-victor": { tenantPrivate: "ihdcc-vw-at-de" } } } });
      }
      if (url.includes("/cks/cachekey/ihdcc-vw-at-de")) return json(200, { key: "ck" });
      return json(200, { carlines: [], salesgroups: [], trims: [], models: [] });
    }) as unknown as typeof fetch;

    const client = new VictorClient({ site: "https://www.volkswagen.at/de", fetch: fetchFn, minRequestGapMs: 0 });
    await client.modelsOverview();
    expect(client.tenantKey).toBe("ihdcc-vw-at-de");
    expect(urls[0]).toBe("https://www.volkswagen.at/de.feature-apps.json");
    expect(urls.at(-1)).toContain("tenant=ihdcc-vw-at-de");
  });

  it("falls back to known key and tenant when discovery fails", async () => {
    const headers: Record<string, string>[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      if (url.includes("volkswagen.de")) throw new Error("offline");
      headers.push(init?.headers as Record<string, string>);
      return json(200, { key: "ck" });
    }) as unknown as typeof fetch;
    const client = new VictorClient({ fetch: fetchFn, minRequestGapMs: 0 });
    await client.init();
    expect(client.tenantKey).toBe("ihdcc-vw-de-de");
  });

  it("retries once with a fresh cache key when the old one is rejected", async () => {
    let keyVersion = 0;
    const seen: string[] = [];
    const fetchFn = (async (url: string) => {
      if (url.includes("/cks/cachekey/")) return json(200, { key: `ck${keyVersion++}` });
      const ck = new URL(url).searchParams.get("cacheKey")!;
      seen.push(ck);
      return ck === "ck0" ? json(400, { message: "stale" }) : json(200, { carlines: [], salesgroups: [], trims: [], models: [] });
    }) as unknown as typeof fetch;
    const client = new VictorClient({ apiKey: "k", tenant: "t", fetch: fetchFn, minRequestGapMs: 0 });
    await client.modelsOverview();
    expect(seen).toEqual(["ck0", "ck1"]);
  });

  it("extracts readable messages from backend errors", () => {
    const body = JSON.stringify({
      message: "failed to enhance the vehicle configuration",
      details: { internalError: "foo\n caused by error: ErrorCode:101400044 , ErrorDetails: , ErrorMessage:the given configuration is not distinct" },
    });
    expect(errorMessage(body, 400)).toBe(
      "HTTP 400: failed to enhance the vehicle configuration – the given configuration is not distinct",
    );
    expect(errorMessage("<html>", 502)).toBe("HTTP 502: <html>");
  });
});
