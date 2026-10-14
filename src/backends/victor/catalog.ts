import { matchCarline, normalise } from "../../core/match.js";
import type { ModelLine, Variant, VariantGroup } from "../../core/types.js";
import type { ModelFilter, ModelsOverview, OverviewCarline, OverviewModel } from "./types.js";
import { currencyOf, grossPrice } from "./configuration.js";

export interface Trim extends VariantGroup {
  salesgroup: string;
  salesgroup_name: string;
}

/** Splits `<carline>_<salesgroup>_<modelCode>_<modelYear>_<modelVersion>`. */
export function parseModelKey(key: string) {
  const [carlineKey, salesgroupKey, modelCode, modelYear, modelVersion] = key.split("_");
  return { carlineKey, salesgroupKey, modelCode, modelYear, modelVersion };
}

export function filterText(filters: ModelFilter[] | undefined, type: string): string | null {
  return filters?.find((f) => f.type === type)?.text.trim() ?? null;
}

const trimOf = (model: OverviewModel) => filterText(model.modelFilters, "EquipmentLine");

/** "70 kW (95 PS)" from the SystemPower filters, else the EnginePower text. */
export function powerOf(filters: ModelFilter[] | undefined): string | null {
  const kw = filterText(filters, "SystemPowerKW");
  const ps = filterText(filters, "SystemPowerPS");
  return kw ? `${Number(kw)} kW (${ps ? Number(ps) : "?"} PS)` : filterText(filters, "EnginePower");
}

export function resolveCarline(overview: ModelsOverview, query: string): OverviewCarline {
  return matchCarline(overview.carlines, query);
}

function minPrice(prices: (number | null)[]): number | null {
  const valid = prices.filter((p): p is number => p !== null);
  return valid.length ? Math.min(...valid) : null;
}

export function overviewCurrency(overview: ModelsOverview): string {
  return currencyOf(overview.models[0]?.prices);
}

export function listModels(overview: ModelsOverview, query?: string): ModelLine[] {
  const q = query ? normalise(query) : undefined;
  const currency = overviewCurrency(overview);
  return overview.carlines
    .filter((c) => !q || normalise(c.name).includes(q))
    .map((c) => {
      const models = overview.models.filter((m) => m.carlineKey === c.key);
      return {
        carline: c.key,
        name: c.name,
        currency,
        from_price: minPrice(models.map((m) => grossPrice(m.prices))),
        fuel_types: [...new Set(models.map((m) => filterText(m.modelFilters, "FuelType")).filter((f) => f !== null))],
        trims: [...new Set(models.map(trimOf).filter((t) => t !== null))],
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
    const engine: Variant = {
      variant_id: model.key,
      model_code: modelCode,
      model_year: modelYear,
      name: model.name.trim(),
      long_name: model.longName.trim(),
      price: grossPrice(model.prices),
      power: powerOf(model.modelFilters),
      fuel: filterText(model.modelFilters, "FuelType"),
      gearbox: filterText(model.modelFilters, "Gear"),
      drive: model.modelMetaData?.driveType ?? null,
    };
    trim.engines.push(engine);
  }
  for (const trim of trims.values()) {
    trim.engines.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    trim.from_price = minPrice(trim.engines.map((e) => e.price));
  }
  return [...trims.values()].sort((a, b) => (a.from_price ?? Infinity) - (b.from_price ?? Infinity));
}

/**
 * Finds the overview model for a variant id (the model key). The version
 * segment is ignored if no key matches exactly, so ids built from a
 * configuration still resolve after a catalogue update.
 */
export function findModel(overview: ModelsOverview, variantId: string): OverviewModel | undefined {
  const id = variantId.trim();
  const exact = overview.models.find((m) => m.key === id);
  if (exact) return exact;
  const prefix = id.split("_").slice(0, 4).join("_");
  return overview.models.find((m) => m.key.split("_").slice(0, 4).join("_") === prefix);
}

/** configStart parameters for a variant id. */
export function startParamsForVariant(overview: ModelsOverview, variantId: string) {
  const model = findModel(overview, variantId);
  const trimName = model && trimOf(model);
  if (!model || !trimName) throw new Error(`Unknown variant_id "${variantId}". Use list_variants to find one.`);
  const { carlineKey, salesgroupKey, modelCode, modelYear } = parseModelKey(model.key);
  return { carlineKey, salesgroupKey, trimName, modelCode, modelYear };
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
