import { Throttle } from "../../core/throttle.js";
import { parseOverview } from "./catalog.js";
import { decodeData, isRedirect, type Redirect } from "./turbo.js";
import type {
  ConfiguratorData,
  EnergyEfficiencyData,
  FeasibilityData,
  OverviewModel,
  ShareData,
  SpecificationsData,
} from "./types.js";

const DEFAULT_ORIGIN = "https://configurator.porsche.com";
export const DEFAULT_LOCALE = "de-DE";

/** porsche.com model overview per configurator locale; others need PORSCHE_MODELS_URL. */
const MODEL_PAGES: Record<string, string> = {
  "de-DE": "https://www.porsche.com/germany/models/",
  "en-GB": "https://www.porsche.com/uk/models/",
  "en-US": "https://www.porsche.com/usa/models/",
  "de-CH": "https://www.porsche.com/swiss/de/models/",
  "fr-CH": "https://www.porsche.com/swiss/fr/models/",
};

// The site serves the same pages to everyone; a desktop browser UA is what was tested.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const CATALOG_TTL_MS = 60 * 60 * 1000;
const MIN_REQUEST_GAP_MS = 200;
const REQUEST_TIMEOUT_MS = 35_000;
const DETAIL_CACHE_SIZE = 32;

/** Route ids, sent as `_routes` so the server only runs that loader. */
const ROUTES = {
  configurator: "customer-configurator",
  feasibility: "customer-feasibility",
  efficiency: "customer-energy-efficiency",
  specifications: "customer-specifications",
  share: "customer-share-porsche-code",
} as const;

/**
 * The share route's path segment: `btoa(encodeURIComponent(JSON.stringify(…)))`,
 * as the site builds it. A fixed value lets CloudFront answer repeated exports
 * of the same configuration with the code it created the first time.
 */
const SHARE_ROUTE_DATA = Buffer.from(encodeURIComponent(JSON.stringify({ trackingId: "mcp" }))).toString("base64");

export class PorscheError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = "PorscheError";
  }
}

export interface PorscheClientOptions {
  /** Market and language, e.g. de-DE, en-GB. */
  locale?: string;
  origin?: string;
  /** porsche.com model overview page that names and prices the models. */
  modelsUrl?: string;
  fetch?: typeof fetch;
  minRequestGapMs?: number;
  log?: (message: string) => void;
}

/** A model in the configurator. Without a model year the server uses the current one. */
export interface ModelRef {
  orderType: string;
  modelYear?: number | string;
}

type Params = Record<string, string>;

class Lru<V> {
  private map = new Map<string, V>();
  constructor(private readonly size: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: V) {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.size) this.map.delete(this.map.keys().next().value!);
  }
  delete(key: string) {
    this.map.delete(key);
  }
}

export class PorscheClient {
  readonly locale: string;
  readonly origin: string;
  private readonly modelsUrl?: string;
  private readonly fetchFn: typeof fetch;
  private readonly throttle: Throttle;
  private readonly log: (message: string) => void;

  private modelTypesCache?: { at: number; data: Promise<Record<string, string>> };
  private overviewCache?: { at: number; data: Promise<OverviewModel[]> };
  private details = new Lru<Promise<unknown>>(DETAIL_CACHE_SIZE);

  constructor(options: PorscheClientOptions = {}) {
    this.locale = options.locale ?? DEFAULT_LOCALE;
    this.origin = (options.origin ?? DEFAULT_ORIGIN).replace(/\/$/, "");
    this.modelsUrl = options.modelsUrl ?? MODEL_PAGES[this.locale];
    this.fetchFn = options.fetch ?? fetch;
    this.throttle = new Throttle(options.minRequestGapMs ?? MIN_REQUEST_GAP_MS);
    this.log = options.log ?? (() => {});
  }

  modelPath({ orderType, modelYear }: ModelRef): string {
    return `/${this.locale}/mode/model/${modelYear ? `${modelYear}/` : ""}${encodeURIComponent(orderType)}`;
  }

  /** Link that opens a configuration in the configurator without a code. */
  configuratorUrl(model: ModelRef, options: string): string {
    return `${this.origin}${this.modelPath(model)}?${new URLSearchParams({ options })}`;
  }

  // --- catalogue -------------------------------------------------------------

  /** Order types the configurator offers in this market → URL slug. */
  modelTypes(): Promise<Record<string, string>> {
    if (!this.modelTypesCache || Date.now() - this.modelTypesCache.at > CATALOG_TTL_MS) {
      const data = this.getText(`/${this.locale}/mode/model.json`).then(
        (text) => JSON.parse(text) as Record<string, string>,
      );
      this.modelTypesCache = { at: Date.now(), data };
      data.catch(() => (this.modelTypesCache = undefined));
    }
    return this.modelTypesCache.data;
  }

  /** Model cards from the porsche.com overview page (names, ranges, prices). Empty if unavailable. */
  overview(): Promise<OverviewModel[]> {
    if (!this.modelsUrl) return Promise.resolve([]);
    if (!this.overviewCache || Date.now() - this.overviewCache.at > CATALOG_TTL_MS) {
      const url = this.modelsUrl;
      const data = this.getText(url).then(parseOverview);
      this.overviewCache = { at: Date.now(), data };
      data.catch((err) => {
        this.log(`Model overview failed: ${String(err)}`);
        this.overviewCache = undefined;
      });
    }
    return this.overviewCache.data;
  }

  // --- configurator routes ---------------------------------------------------

  /** The configuration for `params` (options, optionAdded, …), or a redirect to feasibility. */
  configurator(model: ModelRef, params: Params): Promise<ConfiguratorData | Redirect> {
    return this.data<ConfiguratorData>(this.modelPath(model), params, ROUTES.configurator);
  }

  /** What adding/removing options would change; also a dry run for any change. */
  async feasibility(model: ModelRef, params: Params): Promise<FeasibilityData> {
    const path = `${this.modelPath(model)}/feasibility-notification`;
    const res = await this.data<FeasibilityData>(path, { ...params, "feas-return": "" }, ROUTES.feasibility);
    if (isRedirect(res) || !res?.changeSet) throw new PorscheError("The configurator didn't check this change", 200, path);
    return res;
  }

  energyEfficiency(model: ModelRef, options: string): Promise<EnergyEfficiencyData | undefined> {
    return this.cachedDetail(`${this.modelPath(model)}/energy-efficiency`, options, ROUTES.efficiency);
  }

  specifications(model: ModelRef, options: string): Promise<SpecificationsData | undefined> {
    return this.cachedDetail(`${this.modelPath(model)}/specifications`, options, ROUTES.specifications);
  }

  /** Creates a Porsche Code (no login needed). Every uncached call stores a new one. */
  async share(model: ModelRef, options: string): Promise<{ code: string; url: string | null }> {
    const path = `${this.modelPath(model)}/share-porsche-code/${SHARE_ROUTE_DATA}`;
    const res = await this.data<ShareData>(path, { options }, ROUTES.share);
    if (isRedirect(res) || !res?.porscheCode || res.hasError) {
      throw new PorscheError("The configurator didn't create a Porsche Code", 200, path);
    }
    return { code: res.porscheCode, url: res.porscheCodeUrl ?? null };
  }

  /** Resolves a Porsche Code to its configurator URL (path + options), or null if unknown. */
  async loadCode(code: string): Promise<URL | null> {
    const path = `/${this.locale}/load-configuration/porsche-code/${encodeURIComponent(code)}`;
    let res: unknown;
    try {
      res = await this.data<unknown>(path, {});
    } catch (err) {
      // Unknown codes come back as an error page (HTTP 502).
      if (err instanceof PorscheError && err.status >= 400) return null;
      throw err;
    }
    return isRedirect(res) ? new URL(res.redirect, this.origin) : null;
  }

  // --- plumbing --------------------------------------------------------------

  private cachedDetail<T>(path: string, options: string, route: string): Promise<T | undefined> {
    const key = `${path}?${options}`;
    let entry = this.details.get(key) as Promise<T | undefined> | undefined;
    if (!entry) {
      entry = this.data<T>(path, { options }, route).then((res) => (isRedirect(res) ? undefined : res));
      this.details.set(key, entry);
      entry.catch(() => this.details.delete(key));
    }
    return entry;
  }

  /** GETs `<path>.data`; returns the route's loader data or the redirect. */
  private async data<T>(path: string, params: Params, route?: string): Promise<T | Redirect> {
    const search = new URLSearchParams(params);
    if (route) search.set("_routes", route);
    const body = await this.getText(`${path}.data?${search}`, [200, 202]);
    const decoded = decodeData(body);
    if (isRedirect(decoded)) return decoded;
    const routeData = route ? decoded.routes[route]?.data : Object.values(decoded.routes)[0]?.data;
    return routeData as T;
  }

  private getText(pathOrUrl: string, okStatus: number[] = [200]): Promise<string> {
    const url = /^https?:/.test(pathOrUrl) ? pathOrUrl : `${this.origin}${pathOrUrl}`;
    const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    return this.throttle.run(async () => {
      const res = await this.fetchFn(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await res.text();
      if (!okStatus.includes(res.status)) {
        throw new PorscheError(`HTTP ${res.status} from the Porsche configurator (${path})`, res.status, path);
      }
      return text;
    });
  }
}
