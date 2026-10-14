import type {
  Adjustment,
  ChangeDiff,
  ChangedOption,
  Efficiency,
  OptionCategory,
  OptionFilter,
  OptionView,
  Summary,
} from "../../core/types.js";
import { powerOf } from "./catalog.js";
import type {
  CategoryKey,
  ConfigResponse,
  Feature,
  Price,
  SolutionCandidate,
  VehicleCatalogue,
  VehicleConfiguration,
} from "./types.js";

export const OPTION_CATEGORIES: CategoryKey[] = [
  "exterior",
  "interior",
  "wheel",
  "wheelOption",
  "option",
  "accessories",
];

export const ALL_CATEGORIES = [
  "exterior",
  "interior",
  "wheel",
  "wheelOption",
  "option",
  "accessories",
  "standardEquipment",
] as const satisfies readonly CategoryKey[];

/**
 * Price incl. VAT. The car tenant sends a single gross price; the commercial
 * tenant sends the net price first, then a "Gross" and a "Gross Delta" entry.
 */
export function grossPrice(prices: Price[] | null | undefined): number | null {
  const p = prices?.find((p) => p.vatIncluded) ?? prices?.find((p) => p.type === "Gross") ?? prices?.[0];
  return p?.price ?? null;
}

/** Currency of a price list; the backends only sell in EUR so far. */
export function currencyOf(prices: Price[] | null | undefined): string {
  return prices?.[0]?.currency ?? "EUR";
}

/** Maps a Victor category onto the shared option categories. Packages sit among the options. */
export function optionCategory(category: CategoryKey, feature?: Feature): OptionCategory {
  switch (category) {
    case "exterior":
      return "paint";
    case "interior":
      return "interior";
    case "wheel":
    case "wheelOption":
      return "wheels";
    case "option":
      return feature?.packageFeatures?.length ? "packages" : "options";
    case "accessories":
      return "accessories";
    case "standardEquipment":
      return "standard";
  }
}

const SOURCE_CATEGORIES: Record<OptionCategory, CategoryKey[]> = {
  paint: ["exterior"],
  interior: ["interior"],
  wheels: ["wheel", "wheelOption"],
  packages: ["option"],
  options: ["option"],
  accessories: ["accessories"],
  standard: ["standardEquipment"],
};

/** Price excl. VAT, if the backend sends one (commercial vehicles only). */
export function netPrice(prices: Price[] | null | undefined): number | null {
  const p = prices?.find((p) => p.type === "price" && p.vatIncluded === false);
  return p?.price ?? null;
}

/** The configuration the backend settled on (after resolving conflicts, if any). */
export function effectiveConfiguration(res: ConfigResponse): VehicleConfiguration {
  const vc = res.validationData?.conflicted
    ? (res.solvedVehicleConfiguration ?? res.vehicleConfiguration)
    : (res.vehicleConfiguration ?? res.solvedVehicleConfiguration);
  if (!vc) throw new Error("Backend returned no vehicle configuration");
  return vc;
}

export function featureIndex(catalogue: VehicleCatalogue): Map<string, Feature> {
  return new Map(catalogue.features.map((f) => [f.code, f]));
}

/** Maps feature code → where it sits in the catalogue (category + group name). */
export function placementIndex(catalogue: VehicleCatalogue) {
  const index = new Map<string, { category: CategoryKey; group: string }>();
  for (const category of ALL_CATEGORIES) {
    for (const group of catalogue.categories[category] ?? []) {
      for (const code of group.featureCodes) {
        if (!index.has(code)) index.set(code, { category, group: group.name });
      }
    }
  }
  return index;
}

export function includedCodes(catalogue: VehicleCatalogue): Set<string> {
  return new Set(catalogue.features.filter((f) => f.isIncluded).map((f) => f.code));
}

export function totalPrice(vc: VehicleConfiguration): number | null {
  return grossPrice(vc.configurationPrice?.total);
}

export function optionView(
  feature: Feature,
  features: Map<string, Feature>,
  placement?: { category: CategoryKey; group: string },
  detailed = false,
): OptionView {
  const view: OptionView = {
    code: feature.code,
    name: feature.name ?? feature.code,
    price: grossPrice(feature.prices),
    category: placement && optionCategory(placement.category, feature),
    group: placement?.group,
    selected: feature.isIncluded,
  };
  if (feature.isStandard) view.standard = true;
  if (feature.packages?.length) view.in_packages = feature.packages;
  if (feature.packageFeatures?.length) {
    view.contains = feature.packageFeatures.map((code) => ({
      code,
      name: features.get(code)?.name ?? code,
    }));
    if (!detailed) view.contains = view.contains.slice(0, 8);
  }
  if (detailed && feature.designElements?.length) view.colours = feature.designElements;
  return view;
}

export function listOptions(
  catalogue: VehicleCatalogue,
  currentTotal: number | null,
  filter: OptionFilter = {},
): OptionView[] {
  const features = featureIndex(catalogue);
  const categories = filter.category ? SOURCE_CATEGORIES[filter.category] : OPTION_CATEGORIES;
  const search = filter.search?.toLowerCase();
  const seen = new Set<string>();
  const result: OptionView[] = [];

  for (const category of categories) {
    for (const group of catalogue.categories[category] ?? []) {
      for (const code of group.featureCodes) {
        const f = features.get(code);
        if (!f || seen.has(code) || !f.isVisible) continue;
        if (filter.category && optionCategory(category, f) !== filter.category) continue;
        seen.add(code);
        if (search && !`${f.name ?? ""} ${f.code} ${group.name}`.toLowerCase().includes(search)) continue;
        if (filter.onlySelectable && (f.isIncluded || f.isStandard)) continue;
        if (filter.maxTotalPrice !== undefined && currentTotal !== null && !f.isIncluded) {
          const price = grossPrice(f.prices) ?? 0;
          if (currentTotal + price > filter.maxTotalPrice) continue;
        }
        result.push(optionView(f, features, { category, group: group.name }));
      }
    }
  }
  return result;
}

export function diffConfigurations(
  before: VehicleCatalogue,
  beforeVc: VehicleConfiguration,
  after: ConfigResponse,
  add: string[],
  remove: string[],
): ChangeDiff {
  const afterVc = effectiveConfiguration(after);
  const was = includedCodes(before);
  const now = includedCodes(after.vehicleCatalogue);
  const afterFeatures = featureIndex(after.vehicleCatalogue);
  const beforeFeatures = featureIndex(before);

  const added = [...now].filter((c) => !was.has(c));
  const removed = [...was].filter((c) => !now.has(c));
  const requestedAdd = new Set(add);
  const requestedRemove = new Set(remove);

  // Package contents follow their package; listing them separately is noise.
  const isContentOf = (code: string, codes: string[], index: Map<string, Feature>) =>
    codes.some((p) => index.get(p)?.packageFeatures?.includes(code));

  const visible = (code: string, index: Map<string, Feature>) => {
    const f = index.get(code);
    return !!f && f.isVisible && !!f.name;
  };

  const sideAdded = added.filter(
    (c) => !requestedAdd.has(c) && visible(c, afterFeatures) && !isContentOf(c, added, afterFeatures),
  );
  const sideRemoved = removed.filter(
    (c) => !requestedRemove.has(c) && visible(c, beforeFeatures) && !isContentOf(c, removed, beforeFeatures),
  );
  const isStandard = (c: string) => beforeFeatures.get(c)!.isStandard;
  // Paint, interior and wheels are pick-one: adding one replaces the previous choice.
  const beforePlacement = placementIndex(before);
  const afterPlacement = placementIndex(after.vehicleCatalogue);
  const pickOne = new Set(["exterior", "interior", "wheel"]);
  const swappedCategories = new Set(
    add.map((c) => afterPlacement.get(c)?.category).filter((c) => c && pickOne.has(c)),
  );
  const isReplaced = (c: string) => swappedCategories.has(beforePlacement.get(c)?.category);
  const changed = (f: Feature): ChangedOption => ({ code: f.code, name: f.name ?? f.code, price: grossPrice(f.prices) });

  const priceBefore = totalPrice(beforeVc);
  const priceAfter = totalPrice(afterVc);
  const notAdded = add.filter((c) => !now.has(c));
  const notRemoved = remove.filter((c) => now.has(c));

  return {
    applied: notAdded.length === 0 && notRemoved.length === 0,
    requested: { add, remove },
    not_applied: { add: notAdded, remove: notRemoved },
    side_effects: {
      added: sideAdded.filter((c) => !afterFeatures.get(c)!.isStandard).map((c) => changed(afterFeatures.get(c)!)),
      removed: sideRemoved
        .filter((c) => !isStandard(c) && !isReplaced(c))
        .map((c) => changed(beforeFeatures.get(c)!)),
      replaced: sideRemoved.filter((c) => !isStandard(c) && isReplaced(c)).map((c) => changed(beforeFeatures.get(c)!)),
      standard_replaced: sideRemoved.filter(isStandard).map((c) => beforeFeatures.get(c)!.name ?? c),
      standard_restored: sideAdded
        .filter((c) => afterFeatures.get(c)!.isStandard)
        .map((c) => afterFeatures.get(c)!.name ?? c),
    },
    choices_required: [],
    conflict_resolved: !!after.validationData?.conflicted,
    price_before: priceBefore,
    price_after: priceAfter,
    price_change: priceBefore !== null && priceAfter !== null ? Math.round((priceAfter - priceBefore) * 100) / 100 : null,
  };
}

/** Describes a solution candidate in plain terms (used for error hints). */
export function describeCandidate(c: SolutionCandidate): Adjustment {
  return {
    add: (c.addedFeatures ?? []).map((f) => `${f.code} ${f.name ?? ""}`.trim()),
    remove: (c.removedFeatures ?? []).map((f) => `${f.code} ${f.name ?? ""}`.trim()),
    total: grossPrice(c.prices),
  };
}

function simplifyTechnicalData(vc: VehicleConfiguration) {
  const out: Record<string, Record<string, string>> = {};
  for (const group of vc.technicalData ?? []) {
    const values: Record<string, string> = {};
    for (const v of group.values) if (v.value) values[v.description] = v.value.trim();
    if (Object.keys(values).length) out[group.name] = values;
  }
  return out;
}

type Valued = { unit?: string; value?: number | string };
const fmt = (v?: Valued) => (v?.value !== undefined ? `${v.value} ${v.unit ?? ""}`.trim() : undefined);

function efficiency(vc: VehicleConfiguration): Efficiency | undefined {
  const label = vc.cleoResponse?.labelData as
    | {
        generalVehicleData?: {
          engineType?: string;
          co2Classes?: { type: string; value: string }[];
          co2Emissions?: ({ fuelType: string } & Valued)[];
          combinedConsumptions?: ({ fuelType: string } & Valued)[];
          electricalRange?: Valued;
          mass?: number;
        };
        energyCosts?: { energyCosts15000kmMileage?: Valued; taxPerYear?: Valued };
      }
    | undefined;
  const g = label?.generalVehicleData;
  if (!g) return undefined;
  return {
    engine_type: g.engineType,
    co2_class: g.co2Classes?.map((c) => c.value).join(" / "),
    combined_consumption: g.combinedConsumptions?.map((c) => `${fmt(c)} (${c.fuelType})`),
    co2_emissions: g.co2Emissions?.map((c) => fmt(c)),
    electric_range_wltp: fmt(g.electricalRange),
    energy_costs_15000km: fmt(label?.energyCosts?.energyCosts15000kmMileage),
    vehicle_tax_per_year: fmt(label?.energyCosts?.taxPerYear),
  };
}

/** Overview model key of a configuration; this is its variant_id. */
export function variantId(vc: VehicleConfiguration): string {
  return [vc.carlineKey, vc.salesgroupKey, vc.modelKey, vc.modelYear, vc.modelVersion].join("_");
}

const TOP_SPEED = "Höchstgeschwindigkeit";
const ACCELERATION = "Beschleunigung 0-100 km/h";

export function summarise(
  vc: VehicleConfiguration,
  catalogue: VehicleCatalogue,
  opts: { technical?: boolean } = {},
): Summary {
  const features = featureIndex(catalogue);
  const placement = placementIndex(catalogue);
  const p = vc.configurationPrice ?? {};
  const options = [...includedCodes(catalogue)]
    .map((c) => features.get(c)!)
    .filter((f) => {
      const where = placement.get(f.code);
      return (
        where &&
        where.category !== "standardEquipment" &&
        where.category !== "exterior" &&
        where.category !== "interior" &&
        !f.isStandard &&
        f.isVisible
      );
    })
    .map((f) => {
      const v = optionView(f, features, placement.get(f.code));
      return { code: v.code, name: v.name, price: v.price, category: v.category };
    });

  const colour = (f?: Feature) =>
    f ? { code: f.code, name: f.name, price: grossPrice(features.get(f.code)?.prices ?? f.prices) } : null;
  const technical = simplifyTechnicalData(vc);
  const tech = (key: string) => Object.values(technical).find((g) => g[key])?.[key] ?? null;

  return {
    model: {
      carline: vc.carlineName,
      salesgroup: vc.salesgroupName,
      trim: vc.equipmentLine,
      name: (vc.modelLongName ?? vc.modelName).trim(),
      model_code: vc.modelKey,
      model_year: vc.modelYear,
      variant_id: variantId(vc),
    },
    exterior: colour(vc.exterior),
    interior: colour(vc.interior),
    options,
    prices: {
      currency: currencyOf(p.total),
      vat_included: true,
      base: grossPrice(p.model),
      colour: grossPrice(p.color),
      options: grossPrice(p.equipment),
      incentives: grossPrice(p.incentives),
      total: grossPrice(p.total),
      ...(netPrice(p.total) !== null ? { net_total: netPrice(p.total) } : {}),
    },
    performance: {
      power: powerOf(vc.modelFilters),
      top_speed: tech(TOP_SPEED),
      acceleration_0_100: tech(ACCELERATION),
    },
    efficiency: efficiency(vc),
    ...(opts.technical ? { technical_data: technical } : {}),
  };
}
