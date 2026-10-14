import type {
  Brief,
  ChangeOutcome,
  ChangeRequest,
  ExportResult,
  ImportResult,
  ModelLine,
  Opened,
  OptionDetails,
  OptionFilter,
  OptionList,
  StartRequest,
  Summary,
  VariantList,
} from "./types.js";

/**
 * One configurator (brand) behind the tools. `S` is the backend's own
 * configuration state; sessions keep it opaque and hand it back unchanged.
 * Methods throw errors with messages meant for the agent.
 */
export interface ConfiguratorBackend<S = unknown> {
  /** Brand key used in tool arguments, e.g. "vw". */
  readonly key: string;
  readonly name: string;
  /** What it sells, for the server instructions. */
  readonly vehicles: string;
  /** Site host for user-facing text, e.g. www.volkswagen.de */
  readonly host: string;
  /** What the brand calls its codes, e.g. "VW Code". */
  readonly codeName: string;
  /** Format hint for error messages, e.g. "8 letters/digits, e.g. VC6NTLKS". */
  readonly codeFormat: string;
  /** Extra sentence for the server instructions, if any. */
  readonly notes?: string;

  listModels(query?: string): Promise<ModelLine[]>;
  /** `carline` is a key from listModels. */
  listVariants(carline: string): Promise<VariantList>;
  hasVariant(variantId: string): Promise<boolean>;
  start(req: StartRequest): Promise<Opened<S>>;

  listOptions(state: S, filter?: OptionFilter): Promise<OptionList>;
  getOption(state: S, code: string): Promise<OptionDetails>;
  /** Applies all changes or none. With dryRun the returned state is a preview. */
  change(state: S, req: ChangeRequest): Promise<ChangeOutcome<S>>;
  summary(state: S, opts?: { technical?: boolean }): Promise<Summary>;
  /** Model name and total without any requests. */
  brief(state: S): Brief;

  /** Stores the configuration with the brand and returns its code and link. */
  exportCode(state: S): Promise<ExportResult>;
  /** The code in canonical form if it has this backend's format, else null. */
  parseCode(code: string): string | null;
  /** Whether a parsed code belongs to this backend. May need requests. */
  ownsCode(code: string): Promise<boolean>;
  importCode(code: string): Promise<ImportResult<S>>;
}
