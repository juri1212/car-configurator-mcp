import type {
  ChangeDiff,
  ChangedOption,
  ChoiceRequired,
  Efficiency,
  OptionCategory,
  OptionFilter,
  OptionView,
  Performance,
  Summary,
} from "../../core/types.js";
import type { ConfiguratorData, EnergyEfficiencyData, Item, Labelled, SpecificationsData } from "./types.js";

/** One option from the configurator's catalogue, flattened. */
export interface CatalogItem {
  code: string;
  name: string;
  price: number | null;
  category: OptionCategory;
  /** Catalogue category id, e.g. IAF (paints), IIR (seats). */
  categoryId: string;
  group: string;
  /** Mutually exclusive options share a family, e.g. AUSSEN_FARBE. */
  family?: string;
  selected: boolean;
  standard: boolean;
  contains?: string[];
  colours?: string[];
  description?: string;
  paintToSample: boolean;
}

/**
 * A Porsche configuration. The configurator has no server-side session: the
 * model plus the option list (`options`, dot-separated) is the whole state.
 * The rest is what the last response said about it.
 */
export interface PorscheState {
  orderType: string;
  modelYear: number;
  modelName: string;
  modelFamily?: string;
  options: string;
  currency: string;
  prices: { base: number | null; options: number | null; total: number | null };
  items: CatalogItem[];
}

const PAINT_CATEGORY = "IAF";
const INTERIOR_CATEGORY = "IIF";

function categoryOf(sectionId: string, categoryId: string, item: Item): OptionCategory {
  // Category ids starting with A are accessories sold separately (e.g. winter wheel sets).
  if (categoryId.startsWith("A") || sectionId === "section-vehicle-accessories") return "accessories";
  if (sectionId === "section-exterior-color") return "paint";
  if (sectionId === "section-wheels") return "wheels";
  if (sectionId === "section-interior-color") return "interior";
  if (item.packageContents?.length || sectionId === "section-individualization-packages" || categoryId === "IEP") {
    return "packages";
  }
  return "options";
}

export const stripHtml = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n")
    .replace(/<sup>.*?<\/sup>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .trim();

/** Turns a configurator response into the state the session keeps. */
export function stateFrom(data: ConfiguratorData): PorscheState {
  const items: CatalogItem[] = [];
  const seen = new Set<string>();
  for (const section of data.views.optionsList) {
    for (const category of section.categories) {
      for (const group of category.groups) {
        for (const item of group.items) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          const categoryTitle = item.categoryTitle ?? category.title ?? category.id;
          const groupTitle = item.groupTitle ?? group.title;
          items.push({
            code: item.id,
            name: item.title?.trim() || item.id,
            price: typeof item.priceNumeric === "number" ? item.priceNumeric : null,
            category: categoryOf(section.id, category.id, item),
            categoryId: category.id,
            group: groupTitle && groupTitle !== categoryTitle ? `${categoryTitle}: ${groupTitle}` : categoryTitle,
            family: item.family || undefined,
            selected: !!item.isSelected,
            standard: !!item.isStandardEquipment,
            contains: item.packageContents?.length ? item.packageContents : undefined,
            colours: item.color?.length ? item.color : undefined,
            description: item.description ? stripHtml(item.description) : undefined,
            // Paint to Sample ids contain dots, the separator of the option list.
            paintToSample: !!item.paintToSample || item.id.includes("."),
          });
        }
      }
    }
  }
  const p = data.configuration.prices;
  return {
    orderType: data.catalog.orderType,
    modelYear: data.catalog.modelYear,
    modelName: data.catalog.modelName,
    modelFamily: data.catalog.modelFamily,
    options: data.handoverOptions,
    currency: data.market?.currency ?? "EUR",
    prices: { base: p.main?.base?.raw ?? null, options: p.main?.options?.raw ?? null, total: p.total?.raw ?? null },
    items,
  };
}

export const itemIndex = (s: PorscheState) => new Map(s.items.map((i) => [i.code, i]));
export const selectedCodes = (s: PorscheState) => new Set(s.items.filter((i) => i.selected).map((i) => i.code));

/** Finds an option by code, ignoring case and whitespace. */
export function resolveItem(s: PorscheState, code: string): CatalogItem {
  const wanted = code.replace(/\s+/g, "").toUpperCase();
  const item = s.items.find((i) => i.code.toUpperCase() === wanted);
  if (!item) throw new Error(`Unknown option code "${code}" for this configuration. Use list_options to find codes.`);
  if (item.paintToSample) {
    throw new Error(`${item.code} (${item.name}) is Paint to Sample, which needs extra input; choose it in the Porsche configurator.`);
  }
  return item;
}

export function optionView(item: CatalogItem, s: PorscheState, detailed = false): OptionView {
  const index = itemIndex(s);
  const view: OptionView = {
    code: item.code,
    name: item.name,
    price: item.price,
    category: item.category,
    group: item.group,
    selected: item.selected,
  };
  if (item.standard) view.standard = true;
  const packages = s.items.filter((p) => p.contains?.includes(item.code)).map((p) => p.code);
  if (packages.length) view.in_packages = packages;
  if (item.contains) view.contains = item.contains.map((code) => ({ code, name: index.get(code)?.name ?? code }));
  if (detailed && item.colours) view.colours = item.colours.map((color) => ({ element: item.category, color }));
  return view;
}

export function listOptions(s: PorscheState, filter: OptionFilter = {}): OptionView[] {
  const search = filter.search?.toLowerCase();
  const total = s.prices.total;
  return s.items
    .filter((i) => {
      if (i.paintToSample) return false;
      if (filter.category === "standard" ? !i.standard : filter.category && i.category !== filter.category) return false;
      if (search && !`${i.name} ${i.code} ${i.group}`.toLowerCase().includes(search)) return false;
      if (filter.onlySelectable && (i.selected || i.standard)) return false;
      if (filter.maxTotalPrice !== undefined && total !== null && !i.selected) {
        if (total + (i.price ?? 0) > filter.maxTotalPrice) return false;
      }
      return true;
    })
    .map((i) => optionView(i, s));
}

export const changed = (i: CatalogItem): ChangedOption => ({ code: i.code, name: i.name, price: i.price });

/** Pick-one categories without a family: picking one replaces the other. */
const PICK_ONE = new Set([PAINT_CATEGORY, INTERIOR_CATEGORY, "IRA"]);

/** Compares two states: what the backend did on top of the requested changes. */
export function diffStates(
  before: PorscheState,
  after: PorscheState,
  add: string[],
  remove: string[],
  extra: { choices: ChoiceRequired[]; conflict: boolean },
): ChangeDiff {
  const was = selectedCodes(before);
  const now = selectedCodes(after);
  const beforeItems = itemIndex(before);
  const afterItems = itemIndex(after);
  const requestedAdd = new Set(add);
  const requestedRemove = new Set(remove);

  const gained = [...now].filter((c) => !was.has(c));
  const lost = [...was].filter((c) => !now.has(c));
  // Package contents follow their package; listing them separately is noise.
  const isContentOf = (code: string, codes: string[], index: Map<string, CatalogItem>) =>
    codes.some((p) => index.get(p)?.contains?.includes(code));
  const added = gained
    .filter((c) => !requestedAdd.has(c) && !isContentOf(c, gained, afterItems))
    .map((c) => afterItems.get(c)!);
  const removed = lost
    .filter((c) => !requestedRemove.has(c) && !isContentOf(c, lost, beforeItems))
    .map((c) => beforeItems.get(c)!);

  // A new paint, wheel or seat replaces the previous choice of the same family.
  const addedItems = add.flatMap((c) => afterItems.get(c) ?? []);
  const families = new Set(addedItems.flatMap((i) => (i.family ? [i.family] : [])));
  const pickOne = new Set(addedItems.flatMap((i) => (PICK_ONE.has(i.categoryId) ? [i.categoryId] : [])));
  const isReplaced = (i: CatalogItem) => (!!i.family && families.has(i.family)) || pickOne.has(i.categoryId);

  const notAdded = add.filter((c) => !now.has(c));
  const notRemoved = remove.filter((c) => now.has(c));
  const priceBefore = before.prices.total;
  const priceAfter = after.prices.total;

  return {
    applied: notAdded.length === 0 && notRemoved.length === 0,
    requested: { add, remove },
    not_applied: { add: notAdded, remove: notRemoved },
    side_effects: {
      added: added.filter((i) => !i.standard).map(changed),
      removed: removed.filter((i) => !i.standard && !isReplaced(i)).map(changed),
      replaced: removed.filter((i) => !i.standard && isReplaced(i)).map(changed),
      standard_replaced: removed.filter((i) => i.standard).map((i) => i.name),
      standard_restored: added.filter((i) => i.standard).map((i) => i.name),
    },
    choices_required: extra.choices,
    conflict_resolved: extra.conflict,
    price_before: priceBefore,
    price_after: priceAfter,
    price_change: priceBefore !== null && priceAfter !== null ? Math.round((priceAfter - priceBefore) * 100) / 100 : null,
  };
}

// --- summary -------------------------------------------------------------------

const clean = (v: string | undefined) => (v ? stripHtml(v) : undefined);
const find = (entries: Labelled[] | undefined, re: RegExp) => entries?.find((e) => re.test(e.label));

/** WLTP figures from the German energy label. Other markets don't send it. */
export function efficiency(data: EnergyEfficiencyData | undefined): Efficiency | undefined {
  const label = data?.eelDataDE;
  if (!label) return undefined;
  const consumption = (label.consumption ?? []).flatMap((group) => {
    const main = group.entries?.find((e) => e.isMainValue) ?? group.entries?.[0];
    return main ? [`${clean(main.value)} (${group.title ?? main.label})`] : [];
  });
  const co2 = label.energyConsumption?.entries?.filter((e) => /CO₂|CO2/.test(e.label)).map((e) => clean(e.value));
  return {
    engine_type: clean(find(label.vehicleInfo?.entries, /Antriebsart|drive/i)?.value) ?? data?.engineType,
    co2_class: [label.co2c, label.co2cEmptyBattery].filter((c) => c && c !== "n/a").join(" / ") || undefined,
    combined_consumption: consumption.length ? consumption : undefined,
    co2_emissions: co2?.length ? co2 : undefined,
    electric_range_wltp: clean(find(label.energyConsumption?.entries, /Reichweite|range/i)?.value),
    energy_costs_15000km: clean(label.energyCostYearly?.value),
    vehicle_tax_per_year: clean(find(label.estimatedCo2Costs?.entries, /steuer|tax/i)?.value),
  };
}

/** Technical data as group → label → value. */
export function technicalData(spec: SpecificationsData | undefined): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const group of spec?.technicalDataAccordions ?? []) {
    const values: Record<string, string> = {};
    for (const item of group.items) if (item.value) values[item.text] = clean(item.value)!;
    if (Object.keys(values).length) out[group.text] = values;
  }
  return out;
}

export function performance(spec: SpecificationsData | undefined): Performance {
  const groups = spec?.technicalDataAccordions ?? [];
  const items = groups.flatMap((g) => g.items);
  const value = (re: RegExp) => clean(items.find((i) => re.test(i.text) && i.value)?.value) ?? null;
  // Prefer the system figures of hybrids over the combustion engine's.
  const kw = value(/^Systemleistung \(kW\)|^System power \(kW\)/i) ?? value(/\(kW\)$/);
  const ps = value(/^Systemleistung \(PS\)|^System power \((PS|hp)\)/i) ?? value(/\((PS|hp|ch)\)$/i);
  const highlight = (re: RegExp) => clean(spec?.technicalDataHighlights?.find((h) => re.test(h.label))?.value) ?? null;
  return {
    power: kw && ps ? `${kw} (${ps})` : (kw ?? ps ?? highlight(/\((PS|hp|kW)\)/i)),
    top_speed: value(/Höchstgeschwindigkeit|Top speed|Vitesse max/i),
    acceleration_0_100: value(/0\s*-\s*100\s*km\/h/i),
  };
}

export function summarise(
  s: PorscheState,
  details: { spec?: SpecificationsData; efficiency?: EnergyEfficiencyData },
  opts: { technical?: boolean } = {},
): Summary {
  const selected = s.items.filter((i) => i.selected);
  const colour = (categoryId: string) => {
    const item = selected.find((i) => i.categoryId === categoryId);
    return item ? { code: item.code, name: item.name, price: item.price } : null;
  };
  const exterior = colour(PAINT_CATEGORY);
  // The configurator counts the paint among the options; report it under colour only.
  const options =
    s.prices.options !== null ? Math.round((s.prices.options - (exterior?.price ?? 0)) * 100) / 100 : null;
  return {
    model: {
      carline: s.modelFamily ?? s.modelName,
      trim: null,
      name: s.modelName,
      model_code: s.orderType,
      model_year: String(s.modelYear),
      variant_id: s.orderType,
    },
    exterior,
    interior: colour(INTERIOR_CATEGORY),
    options: selected
      .filter((i) => !i.standard && i.categoryId !== PAINT_CATEGORY && i.categoryId !== INTERIOR_CATEGORY)
      .map((i) => ({ code: i.code, name: i.name, price: i.price, category: i.category })),
    prices: {
      currency: s.currency,
      vat_included: true,
      base: s.prices.base,
      colour: exterior?.price ?? null,
      options,
      incentives: null,
      total: s.prices.total,
    },
    performance: performance(details.spec),
    efficiency: efficiency(details.efficiency),
    ...(opts.technical ? { technical_data: technicalData(details.spec) } : {}),
  };
}
