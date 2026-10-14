import type { ConfiguratorBackend } from "../../core/backend.js";
import { normalise } from "../../core/match.js";
import type {
  Adjustment,
  Brief,
  ChangeOutcome,
  ChangeRequest,
  ChoiceRequired,
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
import { listModels, listVariants, mergeModels } from "./catalog.js";
import { type ModelRef, PorscheClient } from "./client.js";
import { codeLink, parseCode, parseConfiguratorUrl } from "./codes.js";
import {
  type CatalogItem,
  changed,
  diffStates,
  itemIndex,
  listOptions,
  optionView,
  type PorscheState,
  resolveItem,
  selectedCodes,
  stateFrom,
  summarise,
} from "./configuration.js";
import { isRedirect, type Redirect } from "./turbo.js";
import type { ConfiguratorData, FeasibilityData, OverviewModel } from "./types.js";

const CODE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CURRENCY = "EUR";

const modelOf = (s: PorscheState): ModelRef => ({ orderType: s.orderType, modelYear: s.modelYear });
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Configurator responses are either data or a redirect to the feasibility dialog. */
function configuration(res: ConfiguratorData | Redirect, what: string): PorscheState {
  if (isRedirect(res)) throw new Error(`${what} needs a decision in the configurator first`);
  if (!res?.catalog || !res.views) throw new Error(`${what}: the configurator returned no configuration`);
  return stateFrom(res);
}

/** The Porsche configurator (configurator.porsche.com) behind the shared tool interface. */
export class PorscheBackend implements ConfiguratorBackend<PorscheState> {
  readonly key = "porsche";
  readonly name = "Porsche";
  readonly vehicles = "sports cars and SUVs (911, 718, Taycan, Panamera, Macan, Cayenne)";
  readonly host: string;
  readonly codeName = "Porsche Code";
  readonly codeFormat = "8 letters/digits or a porsche-code.com link, e.g. PVHWED55";
  readonly notes =
    "Porsche changes can need a pick (e.g. a new interior when an option rules out the current one): change_options applies the configurator's default and lists the alternatives under choices_required with the one chosen; ask the user, then add another choice's code, or pass the wanted choice in add together with the option.";

  private codes = new Map<string, { at: number; url: Promise<URL | null> }>();

  constructor(readonly client: PorscheClient) {
    this.host = new URL(client.origin).host;
  }

  private async models(): Promise<{ models: OverviewModel[]; currency: string }> {
    const [types, overview] = await Promise.all([this.client.modelTypes(), this.client.overview().catch(() => [])]);
    const currency = overview.find((m) => m.price?.currencyCode)?.price?.currencyCode ?? DEFAULT_CURRENCY;
    return { models: mergeModels(types, overview), currency };
  }

  async listModels(query?: string): Promise<ModelLine[]> {
    const { models, currency } = await this.models();
    return listModels(models, currency, query);
  }

  async listVariants(carline: string): Promise<VariantList> {
    const { models, currency } = await this.models();
    return listVariants(models, carline, currency);
  }

  async hasVariant(variantId: string): Promise<boolean> {
    const types = await this.client.modelTypes();
    return variantId.trim().toUpperCase() in normaliseKeys(types);
  }

  async start(req: StartRequest): Promise<Opened<PorscheState>> {
    const orderType = req.variant_id ? await this.orderTypeOf(req.variant_id) : await this.pickVariant(req);
    const state = configuration(await this.client.configurator({ orderType }, {}), `Model ${orderType}`);
    return { state, label: state.modelName };
  }

  private async orderTypeOf(variantId: string): Promise<string> {
    const types = normaliseKeys(await this.client.modelTypes());
    const orderType = types[variantId.trim().toUpperCase()];
    if (!orderType) throw new Error(`Unknown variant_id "${variantId}". Use list_variants to find one.`);
    return orderType;
  }

  /** carline + trim (model series) + optional model_code; the cheapest model by default. */
  private async pickVariant(req: StartRequest): Promise<string> {
    const { models, currency } = await this.models();
    const list = listVariants(models, req.carline ?? "", currency);
    const t = normalise(req.trim ?? "");
    const groups = list.trims.filter((g) => normalise(g.name).includes(t));
    const engines = groups.flatMap((g) => g.engines).filter((e) => !req.model_code || e.model_code === req.model_code);
    if (!engines.length) {
      throw new Error(
        `No model series "${req.trim}"${req.model_code ? ` with model ${req.model_code}` : ""} for ${list.name}. ` +
          `Available: ${list.trims.map((g) => g.name).join(", ")}`,
      );
    }
    return engines.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))[0].variant_id;
  }

  async listOptions(s: PorscheState, filter: OptionFilter = {}): Promise<OptionList> {
    return { currency: s.currency, current_total: s.prices.total, options: listOptions(s, filter) };
  }

  async getOption(s: PorscheState, code: string): Promise<OptionDetails> {
    const wanted = code.replace(/\s+/g, "").toUpperCase();
    const item = s.items.find((i) => i.code.toUpperCase() === wanted);
    if (!item) throw new Error(`Unknown option code "${code}" for this configuration. Use list_options to find codes.`);
    const index = itemIndex(s);
    const view = optionView(item, s, true);
    return {
      ...view,
      in_packages: view.in_packages?.map((p) => ({ code: p, name: index.get(p)?.name ?? p })),
      ...(item.description ? { description: item.description } : {}),
    };
  }

  /**
   * Applies changes one at a time. Each step asks the feasibility route what
   * the change does, then applies it with the URL parameters the route
   * returns, swapping in alternatives the request names. Nothing is stored
   * on Porsche's side, so dry runs need no special path.
   */
  async change(s: PorscheState, { add, remove }: ChangeRequest): Promise<ChangeOutcome<PorscheState>> {
    const addCodes = add.map((c) => resolveItem(s, c).code);
    const removeCodes = remove.map((c) => resolveItem(s, c).code);
    const selected = selectedCodes(s);
    const base = {
      already_selected: addCodes.filter((c) => selected.has(c)),
      not_selected: removeCodes.filter((c) => !selected.has(c)),
    };
    const steps = [
      ...removeCodes.filter((c) => selected.has(c)).map((code) => ({ code, op: "remove" as const })),
      ...addCodes.filter((c) => !selected.has(c)).map((code) => ({ code, op: "add" as const })),
    ];
    if (!steps.length) return { state: null, diff: null, ...base, total: s.prices.total };

    const wanted = new Set(addCodes);
    const choices: ChoiceRequired[] = [];
    let conflict = false;
    let cur = s;
    for (const step of steps) {
      // An earlier step may have picked this as an alternative already.
      if (selectedCodes(cur).has(step.code) === (step.op === "add")) continue;
      try {
        const model = modelOf(cur);
        const feas = await this.client.feasibility(model, {
          options: cur.options,
          [step.op === "add" ? "optionAdded" : "optionRemoved"]: step.code,
        });
        const missing = [
          ...(feas.changeSet.missingMandatoryCommentOptions ?? []),
          ...(feas.changeSet.missingMandatoryVariantOptions ?? []),
        ];
        if (missing.length) {
          throw new Error(`${missing.map((o) => o.title ?? o.id).join(", ")} needs input only the Porsche configurator can take`);
        }
        const accept = acceptParams(feas, wanted, (alt, pick) => choices.push(describeChoice(cur, alt, pick)));
        conflict ||=
          !!feas.futureConflictDetected?.isConflictDetected ||
          !!feas.sortedAlternatives?.length ||
          feas.changeSet.engineAddedOptions.length > 0;
        cur = configuration(await this.client.configurator(model, accept), "The change");
      } catch (err) {
        throw new Error(
          `Could not ${step.op} ${step.code}: ${message(err)}. Nothing was changed.` +
            (steps.length > 1 ? " Try the changes one at a time to find the conflict." : ""),
        );
      }
    }
    return {
      state: cur,
      diff: diffStates(s, cur, addCodes, removeCodes, { choices, conflict }),
      ...base,
      total: cur.prices.total,
    };
  }

  async summary(s: PorscheState, opts: { technical?: boolean } = {}): Promise<Summary> {
    const model = modelOf(s);
    // Performance and efficiency figures are nice to have; a summary shouldn't fail without them.
    const [spec, efficiency] = await Promise.all([
      this.client.specifications(model, s.options).catch(() => undefined),
      this.client.energyEfficiency(model, s.options).catch(() => undefined),
    ]);
    return summarise(s, { spec, efficiency }, opts);
  }

  brief(s: PorscheState): Brief {
    return { model: s.modelName, total: s.prices.total };
  }

  async exportCode(s: PorscheState): Promise<ExportResult> {
    const { code, url } = await this.client.share(modelOf(s), s.options);
    return { code, url: url ?? codeLink(code), expires: null };
  }

  parseCode(code: string): string | null {
    return parseCode(code);
  }

  async ownsCode(code: string): Promise<boolean> {
    return !!(await this.load(code).catch(() => null));
  }

  async importCode(code: string): Promise<ImportResult<PorscheState>> {
    const url = await this.load(code);
    const target = url && parseConfiguratorUrl(url);
    if (!target) throw new Error(`Porsche Code ${code} was not found`);
    const state = configuration(
      await this.client.configurator(
        { orderType: target.orderType, modelYear: target.modelYear },
        { options: target.options },
      ),
      `Porsche Code ${code}`,
    );
    return { state, label: state.modelName, code, expires: null, adjusted_by_backend: adjustment(target.options, state) };
  }

  /** Recently loaded codes: detecting the brand and importing need one request. */
  private load(code: string): Promise<URL | null> {
    const now = Date.now();
    for (const [k, e] of this.codes) if (now - e.at > CODE_TTL_MS) this.codes.delete(k);
    let entry = this.codes.get(code);
    if (!entry) {
      entry = { at: now, url: this.client.loadCode(code) };
      this.codes.set(code, entry);
      entry.url.catch(() => this.codes.delete(code));
    }
    return entry.url;
  }
}

/** Upper-cased order type → order type, so variant ids match case-insensitively. */
function normaliseKeys(types: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(types).map((t) => [t.toUpperCase(), t]));
}

/**
 * The query that applies a checked change. `optionAdded` already holds the
 * configurator's default for every alternative; requested codes replace it.
 */
function acceptParams(
  feas: FeasibilityData,
  wanted: Set<string>,
  onDefault: (alt: { id: string; values: string[] }, pick: string) => void,
): Record<string, string> {
  const params = new URLSearchParams(feas.acceptUrlSearchParams.replace(/^[.?]*\??/, ""));
  let added = (params.get("optionAdded") ?? "").split(".").filter(Boolean);
  for (const alt of feas.sortedAlternatives ?? []) {
    const values = alt.choices.map((c) => c.value);
    const fallback = values.find((v) => added.includes(v)) ?? values[0];
    const pick = values.find((v) => wanted.has(v)) ?? fallback;
    added = added.filter((v) => v !== fallback);
    added.push(pick);
    if (!wanted.has(pick)) onDefault({ id: alt.id, values }, pick);
  }
  if (added.length) params.set("optionAdded", added.join("."));
  return Object.fromEntries(params);
}

function describeChoice(s: PorscheState, alt: { id: string; values: string[] }, pick: string): ChoiceRequired {
  const index = itemIndex(s);
  const option = (code: string) => {
    const item = index.get(code);
    return item ? changed(item) : { code, name: code, price: null };
  };
  const first: CatalogItem | undefined = index.get(alt.values[0]);
  return {
    id: alt.id,
    name: first?.group.split(": ")[0],
    chosen: option(pick),
    choices: alt.values.map(option),
  };
}

/** What the configurator changed when loading a stored option list, if anything. */
function adjustment(requested: string, s: PorscheState): Adjustment | null {
  const asked = new Set(requested.split(".").filter(Boolean));
  const now = new Set(s.options.split(".").filter(Boolean));
  const index = itemIndex(s);
  const name = (c: string) => `${c} ${index.get(c)?.name ?? ""}`.trim();
  const add = [...now].filter((c) => !asked.has(c)).map(name);
  const remove = [...asked].filter((c) => !now.has(c)).map(name);
  return add.length || remove.length ? { add, remove, total: s.prices.total } : null;
}
