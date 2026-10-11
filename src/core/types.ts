// Brand-neutral shapes the tools return. Each backend maps its own data onto
// these. Prices are numbers in the backend's market currency, incl. VAT.

/** A model line (VW carline, Porsche model family). */
export interface ModelLine {
  carline: string;
  name: string;
  currency: string;
  from_price: number | null;
  fuel_types: string[];
  trims: string[];
  variant_count: number;
}

/** One buildable variant (VW: trim + engine/gearbox; Porsche: order type). */
export interface Variant {
  /** Pass to start_configuration. */
  variant_id: string;
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

/** Variants grouped by trim (or whatever grouping the backend has). */
export interface VariantGroup {
  name: string;
  salesgroup?: string;
  salesgroup_name?: string;
  from_price: number | null;
  engines: Variant[];
}

export interface VariantList {
  carline: string;
  name: string;
  currency: string;
  trims: VariantGroup[];
}

/** Either a variant_id, or (VW convenience) a carline key plus trim and optional model code. */
export interface StartRequest {
  variant_id?: string;
  carline?: string;
  trim?: string;
  model_code?: string;
}

/** A new configuration: backend state plus a default label. */
export interface Opened<S> {
  state: S;
  label: string;
}

export const OPTION_CATEGORIES = [
  "paint",
  "interior",
  "wheels",
  "packages",
  "options",
  "accessories",
  "standard",
] as const;

export type OptionCategory = (typeof OPTION_CATEGORIES)[number];

export interface OptionView {
  code: string;
  name: string;
  price: number | null;
  category?: OptionCategory;
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

export type OptionDetails = Omit<OptionView, "in_packages"> & {
  in_packages?: { code: string; name: string }[];
};

export interface OptionFilter {
  /** Default: everything except standard equipment. */
  category?: OptionCategory;
  search?: string;
  onlySelectable?: boolean;
  maxTotalPrice?: number;
}

export interface OptionList {
  currency: string;
  current_total: number | null;
  options: OptionView[];
}

export interface ChangedOption {
  code: string;
  name: string;
  price: number | null;
}

/** A pick the user has to make before a change can be applied. */
export interface ChoiceRequired {
  id: string;
  name?: string;
  choices: ChangedOption[];
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
  /** Choices the user has to make (pick one per entry). Empty if none. */
  choices_required: ChoiceRequired[];
  conflict_resolved: boolean;
  price_before: number | null;
  price_after: number | null;
  price_change: number | null;
}

/** How the backend adjusted a configuration on its own (e.g. to resolve a conflict). */
export interface Adjustment {
  add: string[];
  remove: string[];
  total: number | null;
}

export interface ChangeRequest {
  add: string[];
  remove: string[];
  dryRun?: boolean;
}

export interface ChangeOutcome<S> {
  /** New state, or null when nothing had to change. */
  state: S | null;
  diff: ChangeDiff | null;
  already_selected: string[];
  not_selected: string[];
  total: number | null;
  backend_resolution?: Adjustment;
}

export interface Colour {
  code: string;
  name: string | null;
  price: number | null;
}

export interface Prices {
  currency: string;
  vat_included: boolean;
  base: number | null;
  colour: number | null;
  options: number | null;
  incentives: number | null;
  total: number | null;
  /** Excl. VAT, where the backend has it. */
  net_total?: number | null;
}

/** Display strings, e.g. "70 kW (95 PS)", "187 km/h", "10,8 s". */
export interface Performance {
  power: string | null;
  top_speed: string | null;
  acceleration_0_100: string | null;
}

export interface Efficiency {
  engine_type?: string;
  co2_class?: string;
  combined_consumption?: string[];
  co2_emissions?: (string | undefined)[];
  electric_range_wltp?: string;
  energy_costs_15000km?: string;
  vehicle_tax_per_year?: string;
}

export interface Summary {
  model: {
    carline: string;
    salesgroup?: string;
    trim: string | null;
    name: string;
    model_code: string;
    model_year: string;
    variant_id: string;
  };
  exterior: Colour | null;
  interior: Colour | null;
  options: { code: string; name: string; price: number | null; category?: OptionCategory }[];
  prices: Prices;
  performance: Performance;
  efficiency?: Efficiency;
  /** Group → label → value, in the backend's language. */
  technical_data?: Record<string, Record<string, string>>;
}

export interface ExportResult {
  code: string;
  /** Opens the configuration in the official configurator. */
  url: string;
  expires: string | null;
}

export interface ImportResult<S> extends Opened<S> {
  code: string;
  expires: string | null;
  adjusted_by_backend: Adjustment | null;
}
