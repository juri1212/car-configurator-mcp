// Shapes of the volkswagen.de configurator backend ("victor" on OneAPI).
// Only the fields this server reads are typed; everything else is passed
// through untouched, because the backend expects to get its own objects back.

export interface Price {
  currency: string;
  price: number;
  type?: string;
  vatIncluded?: boolean;
}

export interface Feature {
  code: string;
  name: string | null;
  isExterior: boolean;
  isInterior: boolean;
  isIncluded: boolean;
  isSelectable: boolean;
  isStandard: boolean;
  isVisible: boolean;
  isPackageFeature: boolean;
  /** Codes of the packages that contain this feature. */
  packages: string[] | null;
  /** Codes of the features contained in this package. */
  packageFeatures: string[] | null;
  prices: Price[] | null;
  designElements?: { element: string; color: string }[];
  mandatoryInformation?: unknown;
}

export interface FeatureGroup {
  featureCodes: string[];
  id: string;
  name: string;
  salesFamily?: string;
}

export type CategoryKey =
  | "exterior"
  | "interior"
  | "wheel"
  | "wheelOption"
  | "option"
  | "accessories"
  | "standardEquipment";

export interface VehicleCatalogue {
  categories: Partial<Record<CategoryKey, FeatureGroup[]>>;
  features: Feature[];
}

export interface ModelFilter {
  id: string;
  localizedName: string;
  text: string;
  type: string;
}

export interface TechnicalDataGroup {
  name: string;
  values: { description: string; value?: string }[];
}

export interface ConfigurationPrice {
  model?: Price[];
  color?: Price[];
  equipment?: Price[];
  incentives?: Price[];
  total?: Price[];
}

export interface VehicleConfiguration {
  carlineKey: string;
  carlineName: string;
  salesgroupKey: string;
  salesgroupName: string;
  equipmentLine: string | null;
  modelKey: string;
  modelName: string;
  modelLongName?: string;
  modelYear: string;
  modelVersion: string;
  modelFilters?: ModelFilter[];
  exterior?: Feature;
  interior?: Feature;
  features?: Feature[];
  configurationPrice?: ConfigurationPrice;
  technicalData?: TechnicalDataGroup[];
  wltpData?: unknown;
  efficiencyData?: unknown;
  cleoResponse?: { labelData?: Record<string, unknown> };
  [key: string]: unknown;
}

export interface SolutionCandidate {
  addedFeatures?: Feature[];
  removedFeatures?: Feature[];
  prices?: Price[];
  tags?: string[];
}

export interface ValidationData {
  conflicted: boolean;
  cleoResponseComplete?: boolean;
  cleoResponseMissing?: boolean;
  solutionCandidates?: SolutionCandidate[];
}

/** Response of configStart and configStep. */
export interface ConfigResponse {
  vehicleConfiguration?: VehicleConfiguration;
  /** Set instead of vehicleConfiguration when the backend had to resolve a conflict. */
  solvedVehicleConfiguration?: VehicleConfiguration;
  vehicleCatalogue: VehicleCatalogue;
  validationData: ValidationData;
}

export interface MediaAsset {
  asset?: string;
  [key: string]: unknown;
}

export interface OverviewCarline {
  key: string;
  name: string;
  modelKey: string;
  mediaAssets?: MediaAsset[];
}

export interface OverviewSalesgroup {
  key: string;
  carlineKey: string;
  name: string;
  modelKey: string;
}

export interface OverviewTrim {
  key: string;
  name: string;
  carlineKey: string;
  salesgroupKey: string;
  modelKey: string;
}

export interface OverviewModel {
  /** `<carline>_<salesgroup>_<modelCode>_<modelYear>_<modelVersion>` */
  key: string;
  code: string;
  carlineKey: string;
  name: string;
  longName: string;
  modelFilters: ModelFilter[];
  prices: Price[];
  modelMetaData?: { driveType?: string; gearType?: string; brandInfo?: string };
}

export interface ModelsOverview {
  carlines: OverviewCarline[];
  salesgroups: OverviewSalesgroup[];
  trims: OverviewTrim[];
  models: OverviewModel[];
}

export interface StoredConfigurationResponse {
  storedConfiguration: VehicleConfiguration;
  expires: string;
  creationTime: string;
}
