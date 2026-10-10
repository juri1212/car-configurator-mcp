import type {
  CategoryKey,
  ConfigResponse,
  Feature,
  Price,
  SolutionCandidate,
  VehicleCatalogue,
  VehicleConfiguration,
} from "./victor/types.js";

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

export function firstPrice(prices: Price[] | null | undefined): number | null {
  return prices?.[0]?.price ?? null;
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
  return firstPrice(vc.configurationPrice?.total);
}

export interface OptionView {
  code: string;
  name: string;
  price: number | null;
  category?: CategoryKey;
  group?: string;
  selected: boolean;
  /** Only set when the option is standard equipment. */
  standard?: true;
  /** Packages this option is part of. */
  in_packages?: string[];
  /** Features contained, if this is a package. */
  contains?: { code: string; name: string }[];
  colours?: { element: string; color: string }[];
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
    price: firstPrice(feature.prices),
    category: placement?.category,
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

export interface OptionFilter {
  category?: CategoryKey;
  search?: string;
  onlySelectable?: boolean;
  maxTotalPrice?: number;
}

export function listOptions(
  catalogue: VehicleCatalogue,
  currentTotal: number | null,
  filter: OptionFilter = {},
): OptionView[] {
  const features = featureIndex(catalogue);
  const categories = filter.category ? [filter.category] : OPTION_CATEGORIES;
  const search = filter.search?.toLowerCase();
  const seen = new Set<string>();
  const result: OptionView[] = [];

  for (const category of categories) {
    for (const group of catalogue.categories[category] ?? []) {
      for (const code of group.featureCodes) {
        const f = features.get(code);
        if (!f || seen.has(code) || !f.isVisible) continue;
        seen.add(code);
        if (search && !`${f.name ?? ""} ${f.code} ${group.name}`.toLowerCase().includes(search)) continue;
        if (filter.onlySelectable && (f.isIncluded || f.isStandard)) continue;
        if (filter.maxTotalPrice !== undefined && currentTotal !== null && !f.isIncluded) {
          const price = firstPrice(f.prices) ?? 0;
          if (currentTotal + price > filter.maxTotalPrice) continue;
        }
        result.push(optionView(f, features, { category, group: group.name }));
      }
    }
  }
  return result;
}

export interface ChangedOption {
  code: string;
  name: string;
  price: number | null;
}

export interface ChangeDiff {
  applied: boolean;
  requested: { add: string[]; remove: string[] };
  /** Requested changes the backend did not carry out. */
  not_applied: { add: string[]; remove: string[] };
  /** Changes the backend made on top of the request, to keep the car buildable. */
  side_effects: {
    added: ChangedOption[];
    removed: ChangedOption[];
    /** Previous choice in a pick-one category (paint, interior, wheels) that the new choice replaced. */
    replaced: ChangedOption[];
    /** Standard parts swapped for the versions that come with the new selection (no action needed). */
    standard_replaced: string[];
    /** Standard parts that return because a selection was removed. */
    standard_restored: string[];
  };
  conflict_resolved: boolean;
  price_before: number | null;
  price_after: number | null;
  price_change: number | null;
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
  const changed = (f: Feature): ChangedOption => ({ code: f.code, name: f.name ?? f.code, price: firstPrice(f.prices) });

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
    conflict_resolved: !!after.validationData?.conflicted,
    price_before: priceBefore,
    price_after: priceAfter,
    price_change: priceBefore !== null && priceAfter !== null ? priceAfter - priceBefore : null,
  };
}

/** Describes a solution candidate in plain terms (used for error hints). */
export function describeCandidate(c: SolutionCandidate) {
  return {
    add: (c.addedFeatures ?? []).map((f) => `${f.code} ${f.name ?? ""}`.trim()),
    remove: (c.removedFeatures ?? []).map((f) => `${f.code} ${f.name ?? ""}`.trim()),
    total: firstPrice(c.prices),
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

function efficiency(vc: VehicleConfiguration) {
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

export function summarise(vc: VehicleConfiguration, catalogue: VehicleCatalogue, opts: { technical?: boolean } = {}) {
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
    f ? { code: f.code, name: f.name, price: firstPrice(features.get(f.code)?.prices ?? f.prices) } : null;

  return {
    model: {
      carline: vc.carlineName,
      salesgroup: vc.salesgroupName,
      trim: vc.equipmentLine,
      name: (vc.modelLongName ?? vc.modelName).trim(),
      model_code: vc.modelKey,
      model_year: vc.modelYear,
    },
    exterior: colour(vc.exterior),
    interior: colour(vc.interior),
    options,
    prices: {
      currency: "EUR",
      vat_included: true,
      base: firstPrice(p.model),
      colour: firstPrice(p.color),
      options: firstPrice(p.equipment),
      incentives: firstPrice(p.incentives),
      total: firstPrice(p.total),
    },
    efficiency: efficiency(vc),
    ...(opts.technical ? { technical_data: simplifyTechnicalData(vc) } : {}),
  };
}

export type Summary = ReturnType<typeof summarise>;
