import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Brand, BrandKey } from "../brand.js";
import type { VictorClient } from "../victor/client.js";
import type { SessionStore } from "../session.js";

/** One configurator backend: a brand and the client for its tenant. */
export interface Backend {
  brand: Brand;
  client: VictorClient;
}

export interface ToolContext {
  backends: Backend[];
  sessions: SessionStore;
}

export function backendFor(ctx: ToolContext, key: BrandKey): Backend {
  const backend = ctx.backends.find((b) => b.brand.key === key);
  if (!backend) {
    throw new Error(`Brand "${key}" is not enabled. Enabled: ${ctx.backends.map((b) => b.brand.key).join(", ")}`);
  }
  return backend;
}

/** The backends to query: the given brand, or all of them. */
export function backendsFor(ctx: ToolContext, key?: BrandKey): Backend[] {
  return key ? [backendFor(ctx, key)] : ctx.backends;
}

/** Optional `brand` tool argument limited to the enabled brands. */
export function brandArg(ctx: ToolContext) {
  const keys = ctx.backends.map((b) => b.brand.key) as [BrandKey, ...BrandKey[]];
  const names = ctx.backends.map((b) => `${b.brand.key} = ${b.brand.name}`).join(", ");
  return z.enum(keys).optional().describe(`Only this brand (${names}). Default: all`);
}

/** "www.volkswagen.de or www.volkswagen-nutzfahrzeuge.de" */
export function hosts(ctx: ToolContext): string {
  return ctx.backends.map((b) => b.brand.host).join(" or ");
}

export function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** Turns thrown errors into tool errors the agent can read and react to. */
export function handle<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return json(await fn(args));
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
      };
    }
  };
}
