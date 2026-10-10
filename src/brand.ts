export type BrandKey = "vw" | "vwn";

export const BRAND_KEYS: readonly BrandKey[] = ["vw", "vwn"];

interface BrandProfile {
  name: string;
  site: string;
  /**
   * Tenant to use when no tenant override is set. Undefined means discover it
   * from the site. The commercial site's global config names the car tenant,
   * so it can't be discovered.
   */
  tenant?: string;
  vehicles: string;
  /** Prefix of the env vars that override this brand's settings. */
  envPrefix: string;
}

const BRANDS: Record<BrandKey, BrandProfile> = {
  vw: {
    name: "Volkswagen",
    site: "https://www.volkswagen.de/de",
    vehicles: "passenger cars",
    envPrefix: "VW",
  },
  vwn: {
    name: "Volkswagen Nutzfahrzeuge",
    site: "https://www.volkswagen-nutzfahrzeuge.de/de",
    tenant: "ihdcc-vwn-de-de",
    vehicles: "vans, campers and pickups (ID. Buzz, Multivan, California, Transporter, Caddy, Crafter, Amarok)",
    envPrefix: "VWN",
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

type Env = Record<string, string | undefined>;

/**
 * Settings for one brand. `VW_SITE`, `VW_TENANT` and `VW_LOAD_CODE_URL`
 * override the car brand, `VWN_SITE`, `VWN_TENANT` and `VWN_LOAD_CODE_URL`
 * the commercial one.
 */
export function resolveBrand(key: BrandKey = "vw", env: Env = process.env): Brand {
  const profile = BRANDS[key];
  const setting = (name: string) => env[`${profile.envPrefix}_${name}`];
  const site = (setting("SITE") ?? profile.site).replace(/\/$/, "");
  return {
    key,
    name: profile.name,
    vehicles: profile.vehicles,
    site,
    host: new URL(site).host,
    tenant: setting("TENANT") ?? profile.tenant,
    loadCodeUrl: setting("LOAD_CODE_URL") ?? `${site}/modelle/konfiguration-laden.html`,
  };
}

/** The brands to serve: both unless VW_BRAND limits it to one ("vw" or "vwn"). */
export function resolveBrands(env: Env = process.env): Brand[] {
  const raw = env.VW_BRAND?.trim().toLowerCase();
  if (!raw || raw === "all") return BRAND_KEYS.map((k) => resolveBrand(k, env));
  const keys = [...new Set(raw.split(/[\s,]+/).filter(Boolean))];
  for (const k of keys) {
    if (!BRAND_KEYS.includes(k as BrandKey)) {
      throw new Error(`Unknown VW_BRAND "${env.VW_BRAND}" (use "vw", "vwn" or leave it unset for both)`);
    }
  }
  return keys.map((k) => resolveBrand(k as BrandKey, env));
}
