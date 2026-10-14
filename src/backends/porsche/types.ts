// Loader data of configurator.porsche.com routes, decoded from `.data`.
// Only the fields this server reads.

export interface Item {
  id: string;
  optionType?: string;
  categoryId?: string;
  family?: string;
  title?: string;
  description?: string;
  price?: string;
  priceNumeric?: number;
  isSelected?: boolean;
  isStandardEquipment?: boolean;
  paintToSample?: boolean;
  restrictedAvailability?: boolean;
  packageContents?: string[];
  color?: string[];
  categoryTitle?: string;
  groupTitle?: string;
  sectionId?: string;
}

export interface Group {
  id: string;
  title?: string;
  items: Item[];
}

export interface Category {
  id: string;
  title?: string;
  sectionId?: string;
  groups: Group[];
}

export interface Section {
  id: string;
  categories: Category[];
}

export interface RawPrice {
  raw?: number;
  gross?: string;
}

export interface ConfiguratorData {
  catalog: {
    modelName: string;
    modelFamily?: string;
    modelYear: number;
    orderType: string;
    engineType?: string;
    isSoldOut?: boolean;
    isBlocked?: boolean;
  };
  configuration: {
    options: string[];
    prices: {
      main?: { base?: RawPrice; options?: RawPrice };
      total?: RawPrice;
    };
  };
  handoverOptions: string;
  market?: { currency?: string; locale?: string };
  views: { optionsList: Section[] };
  modelSwitchBaseUrl?: string;
}

export interface ChangeSetOption {
  id: string;
  title?: string;
  price?: { raw?: number; formatted?: string };
  isStandardEquipment?: boolean;
  categoryId?: string;
}

export interface FeasibilityData {
  changeSet: {
    userAddedOptions: ChangeSetOption[];
    engineAddedOptions: ChangeSetOption[];
    removedOptions: ChangeSetOption[];
    missingMandatoryCommentOptions?: ChangeSetOption[];
    missingMandatoryVariantOptions?: ChangeSetOption[];
  };
  sortedAlternatives?: { id: string; choices: { id: string; value: string }[] }[];
  feasibleOptions?: string[];
  futureConflictDetected?: { isConflictDetected?: boolean };
  acceptUrlSearchParams: string;
  diffs?: { totalPriceDiff?: string; totalPriceOptionsDiff?: number };
}

export interface Labelled {
  label: string;
  value: string;
  isMainValue?: boolean;
}

/** German energy label data (Pkw-EnVKV). Other markets weren't checked. */
export interface EnergyLabel {
  vehicleInfo?: { entries?: Labelled[] };
  energyConsumption?: { entries?: Labelled[] };
  consumption?: { title?: string; entries?: Labelled[] }[];
  co2c?: string;
  co2cEmptyBattery?: string;
  energyCostYearly?: { value?: string };
  estimatedCo2Costs?: { entries?: Labelled[] };
}

export interface EnergyEfficiencyData {
  engineType?: string;
  eelDataDE?: EnergyLabel;
  error?: boolean;
}

export interface SpecificationsData {
  technicalDataHighlights?: { label: string; value: string }[];
  technicalDataAccordions?: {
    id: string;
    text: string;
    items: { id: string; text: string; value: string }[];
  }[];
}

export interface ShareData {
  porscheCode?: string | null;
  porscheCodeUrl?: string | null;
  hasError?: boolean;
}

/** A model card on the porsche.com model overview page. */
export interface OverviewModel {
  modelType: string;
  modelName: string;
  modelYear?: string;
  bodyType?: string;
  modelRangeId?: string;
  modelRange?: string;
  modelSeriesId?: string;
  modelSeries?: string;
  wheelDrive?: string;
  fuelType?: string;
  fuelTypeText?: string;
  gearTypeText?: string;
  price?: { value?: number; currencyCode?: string };
  powerHp?: { formattedValue?: string; value?: number };
}
