import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { VictorClient } from "../victor/client.js";
import type { SessionStore } from "../session.js";

export interface ToolContext {
  client: VictorClient;
  sessions: SessionStore;
  /** Page where users paste a VW Code into the real configurator. */
  loadCodeUrl: string;
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
