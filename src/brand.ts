export type BrandKey = "vw" | "vwn";

interface BrandProfile {
  name: string;
  site: string;
  /**
   * Tenant to use when VW_TENANT isn't set. Undefined means discover it from
   * the site. The commercial site's global config names the car tenant, so it
   * can't be discovered.
   */
  tenant?: string;
  vehicles: string;
}

const BRANDS: Record<BrandKey, BrandProfile> = {
  vw: {
    name: "Volkswagen",
    site: "https://www.volkswagen.de/de",
    vehicles: "passenger cars",
  },
  vwn: {
    name: "Volkswagen Nutzfahrzeuge",
    site: "https://www.volkswagen-nutzfahrzeuge.de/de",
    tenant: "ihdcc-vwn-de-de",
    vehicles: "vans, campers and pickups (ID. Buzz, Multivan, California, Transporter, Caddy, Crafter, Amarok)",
  },
};

export interface Brand {
  key: BrandKey;
  name: string;
  vehicles: string;
  /** Market site, e.g. https://www.volkswagen.de/de */
  site: string;
  /** Site host for user-facing text, e.g. www.volkswagen.de */
  host: string;
  tenant?: string;
  /** Page where users paste a VW Code into the real configurator. */
  loadCodeUrl: string;
}

export function resolveBrand(env: Record<string, string | undefined> = process.env): Brand {
  const key = (env.VW_BRAND ?? "vw").trim().toLowerCase();
  if (key !== "vw" && key !== "vwn") throw new Error(`Unknown VW_BRAND "${env.VW_BRAND}" (use "vw" or "vwn")`);
  const profile = BRANDS[key];
  const site = (env.VW_SITE ?? profile.site).replace(/\/$/, "");
  return {
    key,
    name: profile.name,
    vehicles: profile.vehicles,
    site,
    host: new URL(site).host,
    tenant: env.VW_TENANT ?? profile.tenant,
    loadCodeUrl: env.VW_LOAD_CODE_URL ?? `${site}/modelle/konfiguration-laden.html`,
  };
}
