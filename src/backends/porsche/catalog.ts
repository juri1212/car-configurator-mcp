import { normalise } from "../../core/match.js";
import type { ModelLine, Variant, VariantGroup, VariantList } from "../../core/types.js";
import type { OverviewModel } from "./types.js";

const HTML_ENTITIES: Record<string, string> = { quot: '"', "#39": "'", lt: "<", gt: ">", amp: "&" };
const unescapeAttr = (s: string) => s.replace(/&(quot|#39|lt|gt|amp);/g, (_, e: string) => HTML_ENTITIES[e]);

/** Astro island props: `[0, value]` for plain values, `[1, [...]]` for arrays. */
function astroValue(v: unknown): unknown {
  if (!Array.isArray(v)) return v;
  const [type, value] = v as [number, unknown];
  if (type === 1 && Array.isArray(value)) return value.map(astroValue);
  if (type !== 0) return undefined;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, x]) => [k, astroValue(x)]));
  }
  return value;
}

/**
 * Model cards from the porsche.com model overview page. The page renders them
 * in Astro islands whose `props` attribute holds every model (type, name,
 * range, series, price, power).
 */
export function parseOverview(html: string): OverviewModel[] {
  const models = new Map<string, OverviewModel>();
  const walk = (o: unknown) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") {
      const m = o as Partial<OverviewModel>;
      if (typeof m.modelType === "string" && typeof m.modelName === "string") {
        if (!models.has(m.modelType)) models.set(m.modelType, m as OverviewModel);
      } else Object.values(o).forEach(walk);
    }
  };
  for (const [, props] of html.matchAll(/<astro-island\b[^>]*\sprops="([^"]*)"/g)) {
    if (!props.includes("modelType")) continue;
    try {
      walk(astroValue([0, JSON.parse(unescapeAttr(props))]));
    } catch {
      // Not the island we're looking for.
    }
  }
  return [...models.values()];
}

/** "911-carrera-gts" → "911 Carrera Gts": a fallback when the overview page is unavailable. */
const nameFromSlug = (slug: string) => slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/** Range of a model without overview data, from its order type (see SPEC.md). */
function rangeOf(orderType: string, slug: string): { id: string; name: string } {
  const first = slug.split("-")[0];
  const name = first === "911" || first === "718" ? first : first.charAt(0).toUpperCase() + first.slice(1);
  return { id: first || orderType.slice(0, 3), name };
}

/** The configurable models, with overview details where porsche.com has them. */
export function mergeModels(types: Record<string, string>, overview: OverviewModel[]): OverviewModel[] {
  const byType = new Map(overview.map((m) => [m.modelType, m]));
  return Object.entries(types).map(([orderType, slug]) => {
    const known = byType.get(orderType);
    if (known) return known;
    const range = rangeOf(orderType, slug);
    return { modelType: orderType, modelName: nameFromSlug(slug), modelRangeId: range.id, modelRange: range.name };
  });
}

const rangeKey = (m: OverviewModel) => m.modelRangeId ?? m.modelRange ?? "other";
/** "911 Carrera Modellvarianten" → "911 Carrera" */
const seriesName = (m: OverviewModel) =>
  (m.modelSeries ?? m.modelRange ?? "").replace(/\s+(Modellvarianten|model variants|models|modèles)$/i, "");

function minPrice(prices: (number | null)[]): number | null {
  const valid = prices.filter((p): p is number => p !== null);
  return valid.length ? Math.min(...valid) : null;
}

const priceOf = (m: OverviewModel) => m.price?.value ?? null;

export function listModels(models: OverviewModel[], currency: string, query?: string): ModelLine[] {
  const q = query ? normalise(query) : undefined;
  const ranges = new Map<string, OverviewModel[]>();
  for (const m of models) {
    const key = rangeKey(m);
    ranges.set(key, [...(ranges.get(key) ?? []), m]);
  }
  return [...ranges.entries()]
    .map(([key, ms]) => ({
      carline: key,
      name: ms[0].modelRange ?? key,
      currency: ms.find((m) => m.price?.currencyCode)?.price?.currencyCode ?? currency,
      from_price: minPrice(ms.map(priceOf)),
      fuel_types: [...new Set(ms.flatMap((m) => (m.fuelTypeText ? [m.fuelTypeText] : [])))],
      trims: [...new Set(ms.map(seriesName).filter(Boolean))],
      variant_count: ms.length,
    }))
    .filter((line) => !q || normalise(line.name).includes(q) || normalise(line.carline).includes(q) || line.trims.some((t) => normalise(t).includes(q)));
}

export function variantOf(m: OverviewModel): Variant {
  return {
    variant_id: m.modelType,
    model_code: m.modelType,
    model_year: m.modelYear ?? "",
    name: m.modelName,
    long_name: m.bodyType && !m.modelName.includes(m.bodyType) ? `${m.modelName} ${m.bodyType}` : m.modelName,
    price: priceOf(m),
    power: m.powerHp?.formattedValue ?? null,
    fuel: m.fuelTypeText ?? null,
    gearbox: m.gearTypeText ?? null,
    drive: m.wheelDrive ?? null,
  };
}

/** Variants of a range, grouped by model series (e.g. "911 Carrera Modellvarianten"). */
export function listVariants(models: OverviewModel[], range: string, currency: string): VariantList {
  const inRange = models.filter((m) => rangeKey(m) === range);
  if (!inRange.length) throw new Error(`Unknown model line "${range}"`);
  const groups = new Map<string, VariantGroup>();
  for (const m of inRange) {
    const name = seriesName(m);
    let group = groups.get(name);
    if (!group) {
      group = { name, from_price: null, engines: [] };
      groups.set(name, group);
    }
    group.engines.push(variantOf(m));
  }
  for (const g of groups.values()) {
    g.engines.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    g.from_price = minPrice(g.engines.map((e) => e.price));
  }
  return {
    carline: range,
    name: inRange[0].modelRange ?? range,
    currency: inRange.find((m) => m.price?.currencyCode)?.price?.currencyCode ?? currency,
    trims: [...groups.values()].sort((a, b) => (a.from_price ?? Infinity) - (b.from_price ?? Infinity)),
  };
}
