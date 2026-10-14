import type { ConfiguratorBackend } from "../../core/backend.js";
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
} from "../../core/types.js";
import type { Brand } from "./brand.js";
import { findModel, listModels, listVariants, overviewCurrency, resolveStart, startParamsForVariant } from "./catalog.js";
import { type StartParams, type VictorClient, VictorError } from "./client.js";
import { configuratorLink, LoadedCodes, parseCode } from "./codes.js";
import {
  currencyOf,
  describeCandidate,
  diffConfigurations,
  effectiveConfiguration,
  featureIndex,
  includedCodes,
  listOptions,
  optionView,
  placementIndex,
  summarise,
  totalPrice,
} from "./configuration.js";
import type { ConfigResponse, Feature, VehicleCatalogue, VehicleConfiguration } from "./types.js";

export interface VictorState {
  vc: VehicleConfiguration;
  catalogue: VehicleCatalogue;
}

const squash = (s: string) => s.replace(/\s+/g, "").toUpperCase();

/** Finds a feature by exact code, or by code ignoring whitespace/case. */
export function resolveCode(catalogue: VehicleCatalogue, code: string): Feature {
  const exact = featureIndex(catalogue).get(code);
  if (exact) return exact;
  const wanted = squash(code);
  const match = catalogue.features.find((f) => squash(f.code) === wanted);
  if (match) return match;
  throw new Error(`Unknown option code "${code}" for this configuration. Use list_options to find codes.`);
}

/** "Der Golf Style", but "Der Golf GTI" rather than "Der Golf GTI GTI". */
export function defaultLabel(vc: VehicleConfiguration): string {
  const base = (vc.salesgroupName ?? vc.carlineName ?? "").trim();
  const trim = vc.equipmentLine?.trim();
  return trim && !base.toLowerCase().endsWith(trim.toLowerCase()) ? `${base} ${trim}` : base;
}

const stateOf = (res: ConfigResponse): VictorState => ({
  vc: effectiveConfiguration(res),
  catalogue: res.vehicleCatalogue,
});

/** One Victor tenant (VW cars or VW Nutzfahrzeuge) behind the shared tool interface. */
export class VictorBackend implements ConfiguratorBackend<VictorState> {
  readonly codeName = "VW Code";
  readonly codeFormat = "8 letters/digits, e.g. VC6NTLKS";
  readonly notes?: string;

  constructor(
    readonly brand: Brand,
    readonly client: VictorClient,
    private readonly codes = new LoadedCodes(),
  ) {
    if (brand.key === "vwn") {
      this.notes = "Commercial vehicle summaries also give net_total excl. VAT, which business customers usually go by.";
    }
  }

  get key() {
    return this.brand.key;
  }
  get name() {
    return this.brand.name;
  }
  get vehicles() {
    return this.brand.vehicles;
  }
  get host() {
    return this.brand.host;
  }

  async listModels(query?: string): Promise<ModelLine[]> {
    return listModels(await this.client.modelsOverview(), query);
  }

  async listVariants(carline: string): Promise<VariantList> {
    const overview = await this.client.modelsOverview();
    const c = overview.carlines.find((x) => x.key === carline);
    if (!c) throw new Error(`Unknown carline "${carline}"`);
    return { carline: c.key, name: c.name, currency: overviewCurrency(overview), trims: listVariants(overview, c) };
  }

  async hasVariant(variantId: string): Promise<boolean> {
    return !!findModel(await this.client.modelsOverview(), variantId);
  }

  async start(req: StartRequest): Promise<Opened<VictorState>> {
    const overview = await this.client.modelsOverview();
    let params: StartParams;
    if (req.variant_id) {
      params = startParamsForVariant(overview, req.variant_id);
    } else {
      const c = overview.carlines.find((x) => x.key === req.carline);
      if (!c) throw new Error(`Unknown carline "${req.carline}"`);
      if (!req.trim) throw new Error("Pass variant_id, or carline and trim");
      const { trim, engine } = resolveStart(overview, c, req.trim, req.model_code);
      params = {
        carlineKey: c.key,
        salesgroupKey: trim.salesgroup,
        trimName: trim.name,
        modelCode: engine?.model_code,
        modelYear: engine?.model_year,
      };
    }
    const state = stateOf(await this.client.configStart(params));
    return { state, label: defaultLabel(state.vc) };
  }

  async listOptions(s: VictorState, filter: OptionFilter = {}): Promise<OptionList> {
    const total = totalPrice(s.vc);
    return {
      currency: currencyOf(s.vc.configurationPrice?.total),
      current_total: total,
      options: listOptions(s.catalogue, total, filter),
    };
  }

  async getOption(s: VictorState, code: string): Promise<OptionDetails> {
    const f = resolveCode(s.catalogue, code);
    const features = featureIndex(s.catalogue);
    const view = optionView(f, features, placementIndex(s.catalogue).get(f.code), true);
    return { ...view, in_packages: f.packages?.map((p) => ({ code: p, name: features.get(p)?.name ?? p })) };
  }

  async change(s: VictorState, { add, remove }: ChangeRequest): Promise<ChangeOutcome<VictorState>> {
    const selected = includedCodes(s.catalogue);
    const addCodes = add.map((c) => resolveCode(s.catalogue, c).code);
    const removeCodes = remove.map((c) => resolveCode(s.catalogue, c).code);
    const alreadySelected = addCodes.filter((c) => selected.has(c));
    const notSelected = removeCodes.filter((c) => !selected.has(c));

    const steps = [
      ...removeCodes.filter((c) => selected.has(c)).map((code) => ({ code, op: "remove" as const })),
      ...addCodes.filter((c) => !selected.has(c)).map((code) => ({ code, op: "add" as const })),
    ];

    // The backend handles one feature per step reliably, so apply them one by one.
    // Steps work on copies; nothing is saved here, so dry runs need no special path.
    let vc = s.vc;
    let last: ConfigResponse | undefined;
    for (const step of steps) {
      try {
        last = await this.client.configStep(
          vc,
          step.op === "add" ? [step.code] : [],
          step.op === "remove" ? [step.code] : [],
        );
      } catch (err) {
        const reason = err instanceof VictorError ? err.message : String(err);
        throw new Error(
          `Could not ${step.op} ${step.code}: ${reason}. Nothing was changed.` +
            (steps.length > 1 ? " Try the changes one at a time to find the conflict." : ""),
        );
      }
      vc = effectiveConfiguration(last);
    }

    const base = { already_selected: alreadySelected, not_selected: notSelected, total: totalPrice(vc) };
    if (!last) return { state: null, diff: null, ...base };
    const candidate = last.validationData?.solutionCandidates?.[0];
    return {
      state: { vc, catalogue: last.vehicleCatalogue },
      diff: diffConfigurations(s.catalogue, s.vc, last, addCodes, removeCodes),
      ...base,
      ...(candidate ? { backend_resolution: describeCandidate(candidate) } : {}),
    };
  }

  async summary(s: VictorState, opts: { technical?: boolean } = {}): Promise<Summary> {
    return summarise(s.vc, s.catalogue, opts);
  }

  brief(s: VictorState): Brief {
    return { model: (s.vc.modelLongName ?? s.vc.modelName).trim(), total: totalPrice(s.vc) };
  }

  async exportCode(s: VictorState): Promise<ExportResult> {
    const code = await this.client.storeConfiguration(s.vc);
    // Load it back: confirms the code works and tells us when it expires.
    const stored = await this.client.loadConfiguration(code);
    return { code, url: configuratorLink(this.brand.configuratorUrl, code, stored), expires: stored.expires ?? null };
  }

  parseCode(code: string): string | null {
    return parseCode(code);
  }

  /**
   * Every tenant loads every VW Code and the response doesn't name its
   * tenant, so a code belongs to the brand whose catalogue has its carline.
   */
  async ownsCode(code: string): Promise<boolean> {
    const stored = await this.codes.load(this.client, code).catch(() => undefined);
    const carline = stored?.storedConfiguration.carlineKey;
    if (!carline) return false;
    const overview = await this.client.modelsOverview().catch(() => undefined);
    return !!overview?.carlines.some((c) => c.key === carline);
  }

  async importCode(code: string): Promise<ImportResult<VictorState>> {
    const stored = await this.codes.load(this.client, code);
    // An empty step turns the stored configuration into a full, editable one.
    const res = await this.client.configStep(stored.storedConfiguration, [], []);
    const state = stateOf(res);
    const candidate = res.validationData?.conflicted ? res.validationData.solutionCandidates?.[0] : undefined;
    return {
      state,
      label: defaultLabel(state.vc),
      code,
      expires: stored.expires ?? null,
      adjusted_by_backend: candidate ? describeCandidate(candidate) : null,
    };
  }
}

/** One adapter per brand; they share loaded VW Codes. */
export function createVictorBackends(brands: Brand[], clientFor: (brand: Brand) => VictorClient): VictorBackend[] {
  const codes = new LoadedCodes();
  return brands.map((brand) => new VictorBackend(brand, clientFor(brand), codes));
}
