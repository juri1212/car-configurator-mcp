import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PorscheBackend } from "../src/backends/porsche/adapter.js";
import { PorscheClient } from "../src/backends/porsche/client.js";
import { createVictorBackends } from "../src/backends/victor/adapter.js";
import { type Brand, resolveBrands } from "../src/backends/victor/brand.js";
import { createServer } from "../src/index.js";
import { SessionStore } from "../src/session.js";
import { VictorClient } from "../src/backends/victor/client.js";
import type { ConfigResponse, ModelsOverview, StoredConfigurationResponse } from "../src/backends/victor/types.js";

export function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")) as T;
}

export const overview = () => fixture<ModelsOverview>("overview");
/** Commercial vehicles overview, trimmed to ID. Buzz and ID. Buzz Cargo. */
export const vwnOverview = () => fixture<ModelsOverview>("vwn-overview");
export const poloStart = () => fixture<ConfigResponse>("polo-start");
export const poloStepIqDrive = () => fixture<ConfigResponse>("polo-step-iqdrive");
export const poloImportStep = () => fixture<ConfigResponse>("polo-import-step");
export const id4Start = () => fixture<ConfigResponse>("id4-start");
/** ID. Buzz Pure from the commercial vehicles tenant: net + gross prices. */
export const idBuzzStart = () => fixture<ConfigResponse>("idbuzz-start");
export const loadVLCQNLFL = () => fixture<StoredConfigurationResponse>("load-VLCQNLFL");
/** A stored ID. Buzz, answered for the made-up code VBUZZ001. */
export const loadBuzz = (): StoredConfigurationResponse => ({
  ...loadVLCQNLFL(),
  storedConfiguration: idBuzzStart().vehicleConfiguration,
});

export interface RecordedCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body?: any;
}

/** A fetch stand-in that answers from recorded fixtures, per tenant. */
export function fakeFetch(calls: RecordedCall[] = []) {
  const respond = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

  const fn = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? "GET", path: url.pathname, query: url.searchParams, body });
    const vwn = url.searchParams.get("tenant") === "ihdcc-vwn-de-de";

    switch (true) {
      case url.pathname.startsWith("/cks/cachekey/"):
        return respond(200, { key: "test-cache-key" });
      case url.pathname === "/viso/catalogue/models/overview":
        return respond(200, vwn ? vwnOverview() : overview());
      case url.pathname === "/vcso/configStart":
        return respond(200, vwn ? idBuzzStart() : poloStart());
      case url.pathname === "/vcso/configStep": {
        if (vwn) return respond(200, idBuzzStart());
        const added: string[] = body.addedFeatures.map((f: { code: string }) => f.code);
        if (added.includes("GPF3PF3")) return respond(200, poloStepIqDrive());
        if (!added.length && !body.removedFeatures.length) return respond(200, poloImportStep());
        return respond(400, {
          name: "Bad Request",
          message: "failed to enhance the vehicle configuration",
          details: { internalError: "caused by error: ErrorCode:1 , ErrorMessage:the given configuration is not distinct" },
        });
      }
      case url.pathname === "/vcso/storeConfiguration":
        return respond(200, { marketingcode: "VTEST123" });
      case url.pathname === "/vcso/loadConfiguration" && url.searchParams.get("marketingCode")!.startsWith("P"):
        return respond(404, { message: "configuration not found" });
      case url.pathname === "/vcso/loadConfiguration":
        return respond(200, url.searchParams.get("marketingCode") === "VBUZZ001" ? loadBuzz() : loadVLCQNLFL());
      default:
        return respond(404, { message: `no fixture for ${url.pathname}` });
    }
  };
  return fn as typeof fetch;
}

const porscheFixture = (name: string) => readFileSync(new URL(`./fixtures/porsche/${name}`, import.meta.url), "utf8");

/** The share route's answer, hand-written in the turbo-stream format. */
const SHARE_RESPONSE = JSON.stringify([
  { _1: 2 },
  "customer-share-porsche-code",
  { _3: 4 },
  "data",
  { _5: 6, _7: 8, _9: 10 },
  "porscheCode",
  "PTEST123",
  "porscheCodeUrl",
  "https://porsche-code.com/PTEST123",
  "hasError",
  false,
]);

const sameSet = (a: string | null, b: string) => !!a && a.split(".").sort().join(".") === b.split(".").sort().join(".");

/**
 * Answers configurator.porsche.com and porsche.com requests from recorded
 * responses (911 Carrera GTS, de-DE, model year 2027). Requests the fixtures
 * don't cover get a 404, so wrong parameters fail loudly.
 */
export function fakePorscheFetch(calls: RecordedCall[] = []) {
  const respond = (status: number, body: string) => new Response(body, { status });
  const fn = async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push({ method: "GET", path: `${url.host}${url.pathname}`, query: url.searchParams });
    const q = url.searchParams;
    const path = url.pathname;
    const model = "/de-DE/mode/model/(2027/)?992142";

    if (url.host === "www.porsche.com" && path === "/germany/models/") return respond(200, porscheFixture("models-overview.html"));
    if (path === "/de-DE/mode/model.json") return respond(200, porscheFixture("models.json"));
    if (new RegExp(`^${model}\\.data$`).test(path)) {
      const added = q.get("optionAdded");
      if (!q.get("options") && !added) return respond(200, porscheFixture("992142-start.data"));
      if (sameSet(added, "4D3.SV.Q1J")) return respond(200, porscheFixture("accept-4D3-SV-Q1J.data"));
      if (added === "A1" || (!added && q.get("options")!.endsWith(".A1"))) return respond(200, porscheFixture("accept-A1.data"));
    }
    if (new RegExp(`^${model}/feasibility-notification\\.data$`).test(path)) {
      const added = q.get("optionAdded");
      if (added === "4D3") return respond(200, porscheFixture("feas-add-4D3.data"));
      if (added === "A1") return respond(200, porscheFixture("feas-add-A1.data"));
    }
    if (new RegExp(`^${model}/energy-efficiency\\.data$`).test(path)) return respond(200, porscheFixture("energy-efficiency.data"));
    if (new RegExp(`^${model}/specifications\\.data$`).test(path)) return respond(200, porscheFixture("specifications.data"));
    if (new RegExp(`^${model}/share-porsche-code/[^/]+\\.data$`).test(path)) return respond(200, SHARE_RESPONSE);
    if (path === "/de-DE/load-configuration/porsche-code/PVHWED55.data") return respond(202, porscheFixture("load-PVHWED55.data"));
    if (path.startsWith("/de-DE/load-configuration/porsche-code/")) return respond(502, "[{}]");
    return respond(404, `no fixture for ${url.href}`);
  };
  return fn as typeof fetch;
}

export const porscheBackend = (calls: RecordedCall[] = []) =>
  new PorscheBackend(new PorscheClient({ fetch: fakePorscheFetch(calls), minRequestGapMs: 0 }));

export async function connectTestServer(
  calls: RecordedCall[] = [],
  brands: Brand[] = resolveBrands({ BRANDS: "vw,vwn" }),
  opts: { porsche?: boolean } = {},
) {
  const fetch = fakeFetch(calls);
  const victor = createVictorBackends(
    brands,
    (brand) =>
      new VictorClient({
        apiKey: "test-key",
        tenant: brand.tenant ?? "ihdcc-vw-de-de",
        fetch,
        minRequestGapMs: 0,
      }),
  );
  const backends = opts.porsche ? [...victor, porscheBackend(calls)] : victor;
  const server = createServer(backends, new SessionStore());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { type: string; text: string }[];
    };
    const text = res.content[0]?.text ?? "";
    if (res.isError) return { error: text } as any;
    return JSON.parse(text);
  };
  return { client, call };
}
