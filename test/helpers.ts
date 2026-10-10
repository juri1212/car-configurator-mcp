import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { type Brand, resolveBrand } from "../src/brand.js";
import { createServer } from "../src/index.js";
import { SessionStore } from "../src/session.js";
import { VictorClient } from "../src/victor/client.js";
import type { ConfigResponse, ModelsOverview, StoredConfigurationResponse } from "../src/victor/types.js";

export function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")) as T;
}

export const overview = () => fixture<ModelsOverview>("overview");
export const poloStart = () => fixture<ConfigResponse>("polo-start");
export const poloStepIqDrive = () => fixture<ConfigResponse>("polo-step-iqdrive");
export const poloImportStep = () => fixture<ConfigResponse>("polo-import-step");
export const id4Start = () => fixture<ConfigResponse>("id4-start");
/** ID. Buzz Pure from the commercial vehicles tenant: net + gross prices. */
export const idBuzzStart = () => fixture<ConfigResponse>("idbuzz-start");
export const loadVLCQNLFL = () => fixture<StoredConfigurationResponse>("load-VLCQNLFL");

export interface RecordedCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body?: any;
}

/** A fetch stand-in that answers from recorded fixtures. */
export function fakeFetch(calls: RecordedCall[] = []) {
  const respond = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

  const fn = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? "GET", path: url.pathname, query: url.searchParams, body });

    switch (true) {
      case url.pathname.startsWith("/cks/cachekey/"):
        return respond(200, { key: "test-cache-key" });
      case url.pathname === "/viso/catalogue/models/overview":
        return respond(200, overview());
      case url.pathname === "/vcso/configStart":
        return respond(200, poloStart());
      case url.pathname === "/vcso/configStep": {
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
      case url.pathname === "/vcso/loadConfiguration":
        return respond(200, loadVLCQNLFL());
      default:
        return respond(404, { message: `no fixture for ${url.pathname}` });
    }
  };
  return fn as typeof fetch;
}

export async function connectTestServer(calls: RecordedCall[] = [], brand: Brand = resolveBrand({})) {
  const victor = new VictorClient({
    apiKey: "test-key",
    tenant: "ihdcc-vw-de-de",
    fetch: fakeFetch(calls),
    minRequestGapMs: 0,
  });
  const server = createServer(victor, new SessionStore(), brand);
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
