import { enabledBrands } from "../../brands.js";

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
  /** The official configurator page; export_code links into it. */
  configuratorUrl: string;
}

type Env = Record<string, string | undefined>;

/**
 * Settings for one brand. `VW_SITE`, `VW_TENANT` and `VW_CONFIGURATOR_URL`
 * override the car brand, `VWN_SITE`, `VWN_TENANT` and `VWN_CONFIGURATOR_URL`
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
    configuratorUrl: setting("CONFIGURATOR_URL") ?? `${site}/konfigurator.html`,
  };
}

/** The Victor brands to serve, out of those BRANDS enables (all by default). */
export function resolveBrands(env: Env = process.env): Brand[] {
  const enabled = enabledBrands(env);
  return BRAND_KEYS.filter((k) => enabled.includes(k)).map((k) => resolveBrand(k, env));
}
