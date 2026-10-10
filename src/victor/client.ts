import type {
  ConfigResponse,
  ModelsOverview,
  StoredConfigurationResponse,
  VehicleConfiguration,
} from "./types.js";

/** Last known values, used when they can't be discovered from the website. */
const FALLBACK_API_KEY = "Ox5AegtsLDecFmKHxYdf599VKBCpHsX4";
const FALLBACK_TENANT = "ihdcc-vw-de-de";
const DEFAULT_ORIGIN = "https://oneapi.volkswagen.com";
const DEFAULT_SITE = "https://www.volkswagen.de/de";

const CACHE_KEY_TTL_MS = 60 * 60 * 1000;
const MIN_REQUEST_GAP_MS = 200;
const REQUEST_TIMEOUT_MS = 35_000;

/** Query flags the website sends with configStart/configStep. */
const CONFIG_FLAGS = {
  fetchPrices: "true",
  fetchInvisible: "true",
  fetchWltp: "true",
  fetchFeatureCategoriesAndFamilies: "true",
  fetchMediaForConfiguration: "false",
  fetchMediaForFeatures: "false",
  addErrorMps: "false",
};

export class VictorError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = "VictorError";
  }
}

export interface VictorClientOptions {
  apiKey?: string;
  tenant?: string;
  origin?: string;
  /** Market site the API key is discovered from, e.g. https://www.volkswagen.de/de */
  site?: string;
  fetch?: typeof fetch;
  minRequestGapMs?: number;
  log?: (message: string) => void;
}

export interface StartParams {
  carlineKey: string;
  salesgroupKey: string;
  trimName: string;
  modelCode?: string;
  modelYear?: string;
}

export class VictorClient {
  private apiKey?: string;
  private tenant?: string;
  private readonly origin: string;
  private readonly site: string;
  private readonly fetchFn: typeof fetch;
  private readonly minGap: number;
  private readonly log: (message: string) => void;

  private initPromise?: Promise<void>;
  private cacheKey?: { value: string; fetchedAt: number };
  private overviewCache?: { cacheKey: string; data: ModelsOverview };
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(options: VictorClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.tenant = options.tenant;
    this.origin = options.origin ?? DEFAULT_ORIGIN;
    this.site = (options.site ?? DEFAULT_SITE).replace(/\/$/, "");
    this.fetchFn = options.fetch ?? fetch;
    this.minGap = options.minRequestGapMs ?? MIN_REQUEST_GAP_MS;
    this.log = options.log ?? (() => {});
  }

  get tenantKey(): string | undefined {
    return this.tenant;
  }

  /** Discovers API key and tenant from the market website unless they were given. */
  init(): Promise<void> {
    this.initPromise ??= this.discover();
    return this.initPromise;
  }

  private async discover(): Promise<void> {
    if (!this.apiKey) {
      try {
        const res = await this.fetchFn(`${this.site}.feature-apps.json`);
        const json = (await res.json()) as {
          featureApps?: { name?: string; featureAppApiKey?: string | null; instanceConfig?: string | null }[];
        };
        const app = json.featureApps?.find((a) => a.name === "Configure");
        let key = app?.featureAppApiKey ?? undefined;
        if (!key && app?.instanceConfig) {
          key = (JSON.parse(app.instanceConfig) as { oneApiKey?: string }).oneApiKey;
        }
        if (key) this.apiKey = key;
      } catch (err) {
        this.log(`API key discovery failed: ${String(err)}`);
      }
    }
    if (!this.tenant) {
      try {
        const res = await this.fetchFn(`${this.site}.global-config.json`);
        const json = (await res.json()) as {
          spaAsyncConfig?: { serviceConfigs?: Record<string, { tenantPrivate?: string | null }> };
        };
        const tenant = json.spaAsyncConfig?.serviceConfigs?.["oneapi-victor"]?.tenantPrivate;
        if (tenant) this.tenant = tenant;
      } catch (err) {
        this.log(`Tenant discovery failed: ${String(err)}`);
      }
    }
    if (!this.apiKey) {
      this.log("Using fallback API key");
      this.apiKey = FALLBACK_API_KEY;
    }
    if (!this.tenant) {
      this.log("Using fallback tenant");
      this.tenant = FALLBACK_TENANT;
    }
  }

  // --- endpoints -----------------------------------------------------------

  async modelsOverview(): Promise<ModelsOverview> {
    const cacheKey = await this.getCacheKey();
    if (this.overviewCache?.cacheKey === cacheKey) return this.overviewCache.data;
    const data = await this.request<ModelsOverview>("GET", "/viso/catalogue/models/overview", {
      withCacheKey: true,
    });
    this.overviewCache = { cacheKey: this.cacheKey!.value, data };
    return data;
  }

  configStart(params: StartParams): Promise<ConfigResponse> {
    const query: Record<string, string> = {
      carlineKey: params.carlineKey,
      salesgroupKey: params.salesgroupKey,
      trimName: params.trimName,
      ...CONFIG_FLAGS,
    };
    if (params.modelCode && params.modelYear) {
      query.modelKey = params.modelCode;
      query.modelYear = params.modelYear;
    }
    return this.request<ConfigResponse>("GET", "/vcso/configStart", { query, withCacheKey: true });
  }

  configStep(
    vehicleConfiguration: VehicleConfiguration,
    added: string[],
    removed: string[],
  ): Promise<ConfigResponse> {
    return this.request<ConfigResponse>("POST", "/vcso/configStep", {
      query: CONFIG_FLAGS,
      withCacheKey: true,
      body: {
        vehicleConfiguration,
        addedFeatures: [...added].sort().map((code) => ({ code })),
        removedFeatures: [...removed].sort().map((code) => ({ code })),
      },
    });
  }

  async storeConfiguration(vehicleConfiguration: VehicleConfiguration): Promise<string> {
    const res = await this.request<{ marketingcode?: string }>("POST", "/vcso/storeConfiguration", {
      withCacheKey: true,
      body: { vehicleConfiguration },
    });
    if (!res.marketingcode) throw new VictorError("No VW Code in response", 200, "/vcso/storeConfiguration");
    return res.marketingcode;
  }

  loadConfiguration(marketingCode: string): Promise<StoredConfigurationResponse> {
    return this.request<StoredConfigurationResponse>("GET", "/vcso/loadConfiguration", {
      query: { marketingCode },
    });
  }

  // --- plumbing ------------------------------------------------------------

  private async getCacheKey(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.cacheKey && Date.now() - this.cacheKey.fetchedAt < CACHE_KEY_TTL_MS) {
      return this.cacheKey.value;
    }
    await this.init();
    const res = await this.request<{ key: string }>("GET", `/cks/cachekey/${this.tenant}`, {
      withTenant: false,
    });
    this.cacheKey = { value: res.key, fetchedAt: Date.now() };
    return res.key;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    opts: {
      query?: Record<string, string>;
      body?: unknown;
      withCacheKey?: boolean;
      withTenant?: boolean;
    } = {},
  ): Promise<T> {
    await this.init();
    const send = async (): Promise<T> => {
      const params = new URLSearchParams();
      if (opts.withTenant !== false) params.set("tenant", this.tenant!);
      for (const [k, v] of Object.entries(opts.query ?? {})) params.set(k, v);
      if (opts.withCacheKey) params.set("cacheKey", await this.getCacheKey());
      return this.throttled(() => this.send<T>(method, path, params, opts.body));
    };

    try {
      return await send();
    } catch (err) {
      // A stale cache key makes the backend reject requests. Retry once if it changed.
      if (opts.withCacheKey && err instanceof VictorError && err.status >= 400 && err.status < 500) {
        const old = this.cacheKey?.value;
        const fresh = await this.getCacheKey(true);
        if (fresh !== old) {
          this.log(`Cache key changed, retrying ${path}`);
          return send();
        }
      }
      throw err;
    }
  }

  private async send<T>(method: string, path: string, params: URLSearchParams, body: unknown): Promise<T> {
    const url = `${this.origin}${path}?${params.toString()}`;
    const res = await this.fetchFn(url, {
      method,
      headers: {
        Accept: "application/json",
        "x-api-key": this.apiKey!,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) throw new VictorError(errorMessage(text, res.status), res.status, path);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new VictorError(`Invalid JSON from ${path}`, res.status, path);
    }
  }

  /** Runs requests one after another with a small gap, to stay polite. */
  private throttled<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.lastRequestAt + this.minGap - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        return await fn();
      } finally {
        this.lastRequestAt = Date.now();
      }
    });
    this.queue = run.catch(() => {});
    return run;
  }
}

/** Pulls the most useful line out of the backend's error envelope. */
export function errorMessage(body: string, status: number): string {
  try {
    const json = JSON.parse(body) as { message?: string; details?: { internalError?: string } };
    const internal = json.details?.internalError?.match(/ErrorMessage:(.+)$/m)?.[1]?.trim();
    const parts = [json.message, internal].filter(Boolean);
    if (parts.length) return `HTTP ${status}: ${parts.join(" – ")}`;
  } catch {
    // not JSON
  }
  return `HTTP ${status}: ${body.slice(0, 200)}`;
}
