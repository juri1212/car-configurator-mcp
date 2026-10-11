import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ConfiguratorBackend } from "../core/backend.js";
import type { Summary } from "../core/types.js";
import type { Session, SessionStore, Snapshot } from "../session.js";

export type Backend = ConfiguratorBackend;

export interface ToolContext {
  backends: Backend[];
  sessions: SessionStore;
}

export function backendFor(ctx: ToolContext, key: string): Backend {
  const backend = ctx.backends.find((b) => b.key === key);
  if (!backend) {
    throw new Error(`Brand "${key}" is not enabled. Enabled: ${ctx.backends.map((b) => b.key).join(", ")}`);
  }
  return backend;
}

/** The backends to query: the given brand, or all of them. */
export function backendsFor(ctx: ToolContext, key?: string): Backend[] {
  return key ? [backendFor(ctx, key)] : ctx.backends;
}

export const sessionBackend = (ctx: ToolContext, s: Session) => backendFor(ctx, s.brand);

/**
 * Runs `fn` on each backend; one brand failing doesn't hide the others.
 * Throws the first error only if all fail.
 */
export async function eachBackend<T>(backends: Backend[], fn: (b: Backend) => Promise<T>) {
  const results = await Promise.allSettled(backends.map(async (backend) => ({ backend, value: await fn(backend) })));
  const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!ok.length) throw (results[0] as PromiseRejectedResult).reason;
  return ok;
}

/** Optional `brand` tool argument limited to the enabled brands. */
export function brandArg(ctx: ToolContext, what = "Only this brand") {
  const keys = ctx.backends.map((b) => b.key) as [string, ...string[]];
  const names = ctx.backends.map((b) => `${b.key} = ${b.name}`).join(", ");
  return z.enum(keys).optional().describe(`${what} (${names}). Default: all`);
}

/** "www.volkswagen.de or www.volkswagen-nutzfahrzeuge.de" */
export function hosts(ctx: ToolContext): string {
  return ctx.backends.map((b) => b.host).join(" or ");
}

/** "VW Code", or "VW Code / Porsche Code" with several backends. */
export function codeNames(ctx: ToolContext): string {
  return [...new Set(ctx.backends.map((b) => b.codeName))].join(" / ");
}

export function snapshot(summary: Summary): Snapshot {
  return { model: summary.model.name, total_price: summary.prices.total };
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
