import type { StoredConfigurationResponse } from "./types.js";
import type { VictorClient } from "./client.js";

/** "vc6n tlks" → "VC6NTLKS", or null if it isn't shaped like a VW Code. */
export function parseCode(code: string): string | null {
  const c = code.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9]{8}$/.test(c) ? c : null;
}

const CODE_TTL_MS = 5 * 60 * 1000;

/**
 * Recently loaded VW Codes, shared by the Victor brands: every tenant loads
 * every code, so deciding the brand and importing need only one request.
 */
export class LoadedCodes {
  private entries = new Map<string, { at: number; data: Promise<StoredConfigurationResponse> }>();

  load(client: VictorClient, code: string): Promise<StoredConfigurationResponse> {
    const now = Date.now();
    for (const [k, e] of this.entries) if (now - e.at > CODE_TTL_MS) this.entries.delete(k);
    let entry = this.entries.get(code);
    if (!entry) {
      entry = { at: now, data: client.loadConfiguration(code) };
      this.entries.set(code, entry);
      // Only keep successful loads.
      entry.data.catch(() => this.entries.delete(code));
    }
    return entry.data;
  }
}

/**
 * Deep link that opens a stored configuration in the official configurator,
 * built the same way the site's "Konfiguration laden" page does after
 * resolving a VW Code.
 */
export function configuratorLink(configuratorUrl: string, code: string, stored: StoredConfigurationResponse): string {
  const sc = stored.storedConfiguration;
  const trim = [stored.consolidatedConfiguration, sc]
    .flatMap((vc) => vc?.modelFilters ?? [])
    .find((f) => f.type === "EquipmentLine")?.text;
  if (!trim) throw new Error(`VW Code ${code} has no trim (EquipmentLine) to link to`);
  // The site decides this from the code too: V... codes are private customers.
  const tenant = code.startsWith("V") ? "private" : "commercial";
  const params: Record<string, string> = {
    buildabilityStatus: "buildable",
    tenant,
    carlineId: sc.carlineKey,
    salesGroupId: sc.salesgroupKey,
    trimName: trim,
    modelId: sc.modelKey,
    modelVersion: sc.modelVersion,
    modelYear: sc.modelYear,
    exteriorId: sc.exterior?.code ?? "",
    interiorId: sc.interior?.code ?? "",
    // List items are joined with "-", so dashes inside codes are pre-escaped.
    options: (sc.features ?? []).map((f) => f.code.replace(/-/g, "%2D")).join("-"),
    category: tenant,
  };
  const search = new URLSearchParams();
  // Feature Hub scopes each query parameter to the configurator app with "-app".
  for (const [key, value] of Object.entries(params)) if (value) search.set(`${key}-app`, value);
  return `${configuratorUrl}/__app/route:configure.app?${search}`;
}
