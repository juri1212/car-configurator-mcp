import type { ModelsOverview, OverviewCarline, OverviewModel } from "./victor/types.js";
import { grossPrice } from "./configuration.js";

export interface Engine {
  model_code: string;
  model_year: string;
  name: string;
  long_name: string;
  price: number | null;
  power: string | null;
  fuel: string | null;
  gearbox: string | null;
  drive: string | null;
}

export interface Trim {
  name: string;
  salesgroup: string;
  salesgroup_name: string;
  from_price: number | null;
  engines: Engine[];
}

/** Splits `<carline>_<salesgroup>_<modelCode>_<modelYear>_<modelVersion>`. */
export function parseModelKey(key: string) {
  const [carlineKey, salesgroupKey, modelCode, modelYear, modelVersion] = key.split("_");
  return { carlineKey, salesgroupKey, modelCode, modelYear, modelVersion };
}

function filterText(model: OverviewModel, type: string): string | null {
  return model.modelFilters.find((f) => f.type === type)?.text.trim() ?? null;
}

function trimOf(model: OverviewModel): string | null {
  return filterText(model, "EquipmentLine");
}

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/^(der|die|das)\s+/, "")
    .replace(/^neue\s+/, "")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim();

/** Finds a carline by key or (partial) name. Throws with candidates if ambiguous. */
export function resolveCarline(overview: ModelsOverview, query: string): OverviewCarline {
  const byKey = overview.carlines.find((c) => c.key === query.trim());
  if (byKey) return byKey;
  const q = normalise(query);
  const exact = overview.carlines.filter((c) => normalise(c.name) === q);
  if (exact.length === 1) return exact[0];
  const partial = overview.carlines.filter((c) => normalise(c.name).includes(q));
  if (partial.length === 1) return partial[0];
  const names = (partial.length ? partial : overview.carlines).map((c) => `${c.name} (${c.key})`);
  throw new Error(
    partial.length
      ? `"${query}" matches several models: ${names.join(", ")}`
      : `No model matches "${query}". Available: ${names.join(", ")}`,
  );
}

function minPrice(prices: (number | null)[]): number | null {
  const valid = prices.filter((p): p is number => p !== null);
  return valid.length ? Math.min(...valid) : null;
}

export function listModels(overview: ModelsOverview, query?: string) {
  const q = query ? normalise(query) : undefined;
  return overview.carlines
    .filter((c) => !q || normalise(c.name).includes(q))
    .map((c) => {
      const models = overview.models.filter((m) => m.carlineKey === c.key);
      return {
        carline: c.key,
        name: c.name,
        from_price: minPrice(models.map((m) => grossPrice(m.prices))),
        fuel_types: [...new Set(models.map((m) => filterText(m, "FuelType")).filter(Boolean))],
        trims: [...new Set(models.map(trimOf).filter(Boolean))],
        variant_count: models.length,
      };
    });
}

export function listVariants(overview: ModelsOverview, carline: OverviewCarline): Trim[] {
  const trims = new Map<string, Trim>();
  for (const model of overview.models.filter((m) => m.carlineKey === carline.key)) {
    const trimName = trimOf(model);
    if (!trimName) continue;
    const { salesgroupKey, modelCode, modelYear } = parseModelKey(model.key);
    const id = `${salesgroupKey}|${trimName}`;
    let trim = trims.get(id);
    if (!trim) {
      const sg = overview.salesgroups.find((s) => s.key === salesgroupKey);
      trim = {
        name: trimName,
        salesgroup: salesgroupKey,
        salesgroup_name: sg?.name ?? carline.name,
        from_price: null,
        engines: [],
      };
      trims.set(id, trim);
    }
    const kw = filterText(model, "SystemPowerKW");
    const ps = filterText(model, "SystemPowerPS");
    trim.engines.push({
      model_code: modelCode,
      model_year: modelYear,
      name: model.name.trim(),
      long_name: model.longName.trim(),
      price: grossPrice(model.prices),
      power: kw ? `${Number(kw)} kW (${ps ? Number(ps) : "?"} PS)` : filterText(model, "EnginePower"),
      fuel: filterText(model, "FuelType"),
      gearbox: filterText(model, "Gear"),
      drive: model.modelMetaData?.driveType ?? null,
    });
  }
  for (const trim of trims.values()) {
    trim.engines.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    trim.from_price = minPrice(trim.engines.map((e) => e.price));
  }
  return [...trims.values()].sort((a, b) => (a.from_price ?? Infinity) - (b.from_price ?? Infinity));
}

/**
 * Picks the trim (and optionally engine) to start a configuration with.
 * Trim and engine are matched case-insensitively by name or model code.
 */
export function resolveStart(
  overview: ModelsOverview,
  carline: OverviewCarline,
  trimQuery: string,
  modelCode?: string,
) {
  const trims = listVariants(overview, carline);
  const t = trimQuery.trim().toLowerCase();
  let candidates = trims.filter((x) => x.name.toLowerCase() === t);
  if (!candidates.length) candidates = trims.filter((x) => x.name.toLowerCase().includes(t));
  if (modelCode) {
    candidates = candidates.filter((x) => x.engines.some((e) => e.model_code === modelCode));
  }
  if (!candidates.length) {
    throw new Error(
      `No trim "${trimQuery}"${modelCode ? ` with model code ${modelCode}` : ""} for ${carline.name}. ` +
        `Available: ${[...new Set(trims.map((x) => x.name))].join(", ")}`,
    );
  }
  if (candidates.length > 1 && !modelCode) {
    const names = new Set(candidates.map((c) => c.name));
    if (names.size > 1) {
      throw new Error(`"${trimQuery}" matches several trims: ${[...names].join(", ")}`);
    }
  }
  const trim = candidates[0];
  const engine = modelCode ? trim.engines.find((e) => e.model_code === modelCode) : undefined;
  return { trim, engine };
}
