# vw-cc-mcp — Spec

An MCP server that lets an AI agent spec a Volkswagen or a Porsche through the
backends of the official configurators: browse models and options, build a
configuration step by step, and export a **VW Code** or **Porsche Code** that
loads in the real configurator.

Status: v1 implemented 2026-10-10, Porsche added 2026-10-13. Backend behaviour
below was verified against the live APIs.

## Backend (undocumented, reverse-engineered)

The volkswagen.de configurator is a separate app (`configurator.feature-app.io`)
that calls VW's "victor" service on OneAPI.

| What | Value |
|---|---|
| Origin | `https://oneapi.volkswagen.com` |
| Auth | header `x-api-key: <public key>`, sent by the website itself |
| Tenant | `ihdcc-vw-de-de` (passenger cars DE), `ihdcc-vwn-de-de` (commercial) |
| Key/tenant source | `https://www.volkswagen.de/de.feature-apps.json` (app `Configure` → `oneApiKey`), `https://www.volkswagen.de/de.global-config.json` (`oneapi-victor`) |

The commercial tenant uses the same API and key. Its site's
`global-config.json` names the car tenant, so `ihdcc-vwn-de-de` is set by the
brand instead of discovered.

The server talks to both tenants at once, one client each. Carline keys don't
overlap (cars `3xxxx`, commercial `7xxxx`), so a carline name or key picks the
tenant. Every tenant loads every VW Code and the stored configuration's
`tenantKey` is empty, so `import_code` picks the tenant whose overview has the
code's `carlineKey`.

Price lists differ per tenant. Cars: one entry, `{ type: "price", vatIncluded: true }`.
Commercial: `price` (net, `vatIncluded: false`), then `Gross` and `Gross Delta`
(the VAT), all marked `vatIncluded: false`. The server always reports the gross
price and adds `net_total` to summaries when a net price exists.

Endpoints (all accept `tenant` and `cacheKey` query params):

| Endpoint | Purpose |
|---|---|
| `GET /cks/cachekey/{tenant}` | Current catalogue cache key → `{ key }` |
| `GET /viso/catalogue/models/overview` | `carlines`, `salesgroups`, `trims`, `models` (prices, efficiency data) |
| `GET /vcso/configStart` | Start config: `carlineKey`, `salesgroupKey`, `trimName`, optional `modelKey`+`modelYear`, `fetchPrices/fetchWltp/fetchInvisible/fetchFeatureCategoriesAndFamilies=true` → `vehicleConfiguration`, `vehicleCatalogue.features[]`, `validationData` |
| `POST /vcso/configStep` | Body `{ vehicleConfiguration, addedFeatures:[{code}], removedFeatures:[{code}] }` → new config. On conflict: `validationData.conflicted=true`, `solutionCandidates`, and `solvedVehicleConfiguration` instead of `vehicleConfiguration` (the website applies it) |
| `POST /vcso/storeConfiguration` | Body `{ vehicleConfiguration }` → `{ marketingcode: "VXXXXXXX" }` |
| `GET /vcso/loadConfiguration?marketingCode=` | Load a code → `storedConfiguration` (carline, salesgroup, modelKey, modelYear, exterior/interior, options), `expires` |

Verified round trip: configStart (Polo EDITION 50) → storeConfiguration →
`VC6NTLKS` → loadConfiguration returned the same carline/model, expires in about 180 days.

Feature object (from `vehicleCatalogue.features`): `code` (e.g.
`ACCESSORY:000051446AC`), `name`, `prices[]`, `isSelectable`, `isStandard`,
`isIncluded`, `isExterior`, `isInterior`, `isPackageFeature`, `packages`,
`packageFeatures`. Categories: `exterior`, `interior`, `wheel`, `wheelOption`,
`option`, `accessories`, `standardEquipment`.

Findings that shaped the implementation:
- **Models overview is complete.** It lists every model (253 in DE), keyed
  `<carline>_<salesgroup>_<modelCode>_<modelYear>_<version>`. Trim = the
  `EquipmentLine` model filter. `/viso/catalogue/models` isn't needed.
- **Colours are features.** Exterior `F14 xxxx`, interior `F56 xx`. Adding a
  new paint makes the backend drop the old one.
- **Selected options** live in `vehicleConfiguration.features`. VW Codes keep
  them (verified with `VLCQNLFL`, Polo + IQ.DRIVE).
- **One feature per configStep.** Requests with several features return
  400 "not distinct" or 200 with nothing applied. `change_options` applies
  changes one at a time on a working copy and saves only if all steps succeed.
- **Import** = `loadConfiguration`, then `configStep(storedConfiguration, [], [])`.
  This returns a full, editable configuration with prices.
- `isSelectable` is false for colours even though they can be chosen. Don't
  filter on it.
- Efficiency/range: `vehicleConfiguration.cleoResponse.labelData`
  (`generalVehicleData.electricalRange`, `combinedConsumptions`, `co2Classes`).
  Technical data: `technicalData[]` groups of `{description, value}`.

## Porsche backend

Research notes: `~/development/porsche-cc-mcp/docs` (2026-10-10). Re-verified
and extended on 2026-10-13 against `configurator.porsche.com`, `de-DE`.

The configurator is a React Router v7 app. Appending `.data` to a page path
returns its loader data in the turbo-stream format (first line: a flat JSON
table whose values refer to each other by index; `src/backends/porsche/turbo.ts`).
`_routes=<route id>` limits the response to one loader. Redirects come back as
HTTP 202 with a `SingleFetchRedirect` root. No login, cookies or keys.

| Request (under `/<locale>/`) | Route id | Purpose |
|---|---|---|
| `mode/model.json` | – | Configurable order types → URL slug (plain JSON) |
| `mode/model/[<year>/]<orderType>.data?options=…` | `customer-configurator` | Catalogue (`views.optionsList`), selection, prices, `handoverOptions` (~650 KB) |
| `…/feasibility-notification.data?options=…&optionAdded=…&feas-return=` (or `optionRemoved`) | `customer-feasibility` | What a change does: `changeSet`, `sortedAlternatives`, `acceptUrlSearchParams` |
| `…/energy-efficiency.data?options=…` | `customer-energy-efficiency` | German energy label (`eelDataDE`) |
| `…/specifications.data?options=…` | `customer-specifications` | `technicalDataAccordions` (power, 0–100, top speed, dimensions) |
| `…/share-porsche-code/<routeData>.data?options=…` | `customer-share-porsche-code` | Creates a Porsche Code anonymously |
| `load-configuration/porsche-code/<code>.data` | – | Redirect to `mode/model/<orderType>?options=…`; unknown codes: HTTP 502 |

Names, ranges, series and prices of the models aren't in the configurator's
model list. They come from the porsche.com model overview page
(`/germany/models/`): Astro island `props` hold every model card (`modelType`,
`modelName`, `modelRange(Id)`, `modelSeries`, `price`, `powerHp`, fuel, gearbox,
drive). If the page is unavailable, models are named from their URL slug.

Findings that shaped the implementation:
- **No server session.** The model plus `options` (dot-separated codes) is the
  whole configuration. State: order type, model year, `handoverOptions`, and
  the flattened catalogue and prices of the last response.
- **Every change goes through feasibility.** `change_options` asks the
  feasibility route about each code, then requests the configurator with
  `acceptUrlSearchParams`. Simple swaps and conflicts take the same path.
- **Alternatives.** When the change rules out something mandatory (e.g. seat
  ventilation `4D3` on a 911 Carrera GTS rules out interior `SX` and seats
  `Q4Q`), `sortedAlternatives` lists picks and `acceptUrlSearchParams`
  already adds the first choice of each (`optionAdded=4D3.SV.Q2J`). Replacing
  a default with another choice works (`4D3.SV.Q1J`, verified). Codes in the
  request that are choices are used as the pick; other defaults are reported
  in `choices_required` with `chosen`.
- **Removal** accept parameters drop the option from `options` and have no
  `optionRemoved`. Removing the paint makes the backend add a default one.
- `optionAdded` takes several codes joined with dots (`1LX.A1` works), but the
  server sends one per step so each step's change set is clear.
- **Categories.** Sections map onto shared categories: exterior colour →
  `paint`, wheels → `wheels`, interior colour → `interior`, packages section,
  `IEP` and items with `packageContents` → `packages`, category ids starting
  with `A` (accessories sold separately) → `accessories`, the rest → `options`.
  `family` groups mutually exclusive options and drives `replaced`.
- **Prices.** `configuration.prices.main.base/options` and `total` (`raw`
  numbers, incl. VAT). The configurator counts the paint among the options;
  summaries report it under `colour` instead.
- **Paint to Sample** ids contain dots (`0UD.89.24931`), the option separator,
  and need extra input. They are hidden and rejected.
- **Porsche Codes** are 8 letters/digits like VW Codes. Each uncached share
  request creates a new one. The share URL is fixed per configuration
  (`routeData` = `{"trackingId":"mcp"}`), so CloudFront may answer a repeat
  export with the code it created before. Expiry is unknown (`expires: null`).
- Efficiency comes from `eelDataDE`, which other markets probably don't send.
  Labels in technical data and efficiency are in the market's language;
  performance is matched with German and English labels.

## MCP tools

All configuration tools work on a server-side session identified by `config_id`.

| Tool | Input | Output |
|---|---|---|
| `list_models` | `query?`, `brand?` | Carlines with brand, currency, "from" price, fuel types, trims |
| `list_variants` | `carline`, `brand?` | Trims → variants (`variant_id`, model code, price, power, fuel, gearbox), currency |
| `start_configuration` | `variant_id` or `carline` + `trim` + `model_code?`; `brand?`, `label?` | `config_id` + summary |
| `list_options` | `config_id`, `category?` (`paint`, `interior`, `wheels`, `packages`, `options`, `accessories`, `standard`), `search?`, `only_selectable?`, `max_total_price?` | Currency, current total, options with code, name, price, category, selected/standard/package state |
| `get_option` | `config_id`, `code` | Details, which packages contain it, what it includes |
| `change_options` | `config_id`, `add[]`, `remove[]`, `dry_run?` | Diff: `applied`, `not_applied`, `side_effects` {`added`, `removed`, `replaced`, `standard_replaced`, `standard_restored`}, `choices_required` (always `[]` for VW; Porsche: alternatives with the `chosen` default), price before/after/change. With `dry_run` nothing is saved |
| `get_summary` | `config_id`, `technical_data?` | Model (incl. `variant_id`), colours, selected options, price breakdown with currency, `performance` (power, top speed, 0–100), WLTP/efficiency, tech data, `code` |
| `export_code` | `config_id` | `configurator_url` (VW: deep link `<site>/konfigurator.html/__app/route:configure.app?…`, the same one the site builds after loading a code; Porsche: `https://porsche-code.com/<code>`), `code`, `expires` (may be null) |
| `import_code` | `code` (Porsche: also a `porsche-code.com` link), `brand?`, `label?` | New `config_id` rebuilt from the stored configuration |
| `compare_configurations` | `config_ids[]` | Side-by-side: price, power, top speed, 0–100, consumption/range, option differences |
| `list_configurations` | – | Sessions in memory with `code` and link if exported |

VW mapping: `variant_id` is the overview model key
(`<carline>_<salesgroup>_<modelCode>_<modelYear>_<version>`). Every model has
exactly one `EquipmentLine` filter and model codes are unique per carline, so
the key fully identifies carline, sales group, trim and engine. The version
segment isn't sent to configStart; a key with another version still resolves.
Option categories: `exterior` → `paint`, `interior` → `interior`,
`wheel`/`wheelOption` → `wheels`, `option` → `packages` (features with
package contents) or `options`, `accessories` → `accessories`,
`standardEquipment` → `standard`.

Behaviour rules:
- **Never hide side effects.** If a step adds or removes options the agent
  didn't ask for, `change_options` reports them in the result.
- Budget: `max_total_price` filters options using current total + option price.
  Package side effects can change the real total; use `dry_run` to get the
  exact figure.
- Prices are gross (VAT incl.) in the market currency named by the backend
  (`currency`; EUR for VW DE). Commercial vehicles also get `net_total`.
- `import_code` uses `brand` if given. Otherwise each backend whose code format
  fits is asked whether it owns the code (VW: the code's carline is in the
  brand's overview; Porsche: the load route redirects to a configuration); if
  none claims it, the first matching backend loads it.

Porsche mapping: `carline` is the model range (`911`, `718`, `taycan`, …),
trims are model series, `variant_id` is the order type. `start_configuration`
with `carline` + `trim` takes the cheapest model of the matching series unless
`model_code` names one.

## Implementation

- TypeScript, `@modelcontextprotocol/sdk`, `zod` (tool inputs), stdio transport, native `fetch`.
- Brands: `VW_BRAND` enables some of `vw`, `vwn`, `porsche` (default all).
  Porsche: `PORSCHE_LOCALE` (default `de-DE`), `PORSCHE_MODELS_URL`.
- Startup: fetch API key and tenant from the VW config JSONs, per brand.
  `VW_API_KEY` and `VW_TENANT` / `VWN_TENANT` env vars override them. Fetch the cache key and refresh it
  on 4xx or every hour.
- Cache catalogue responses by cache key. Space requests out, no parallel fan-out.
- Sessions in memory, each tied to its brand. A session holds brand, label,
  timestamps, the last exported code and an opaque backend state. The code is
  how a configuration persists.
- Responses are typed with TS interfaces (not zod). The backend expects its own objects back unchanged.
- Tests: vitest against recorded fixtures (`test/fixtures`), plus an opt-in live test (`npm run test:live`).

### Backend adapters

Tools only talk to `ConfiguratorBackend` (`src/core/backend.ts`) and return
the brand-neutral types in `src/core/types.ts`. One adapter instance per
brand; the `brand` enum is derived from the enabled adapters. Catalogue calls
fan out with `Promise.allSettled`, so one brand failing doesn't hide the
others. Throttling and caching stay inside each backend's client.

```ts
interface ConfiguratorBackend<S = unknown> {
  key, name, vehicles, host, codeName, codeFormat, notes?
  listModels(query?): Promise<ModelLine[]>
  listVariants(carline): Promise<VariantList>
  hasVariant(variantId): Promise<boolean>
  start(req: StartRequest): Promise<Opened<S>>
  listOptions(state, filter?): Promise<OptionList>
  brief(state): Brief          // model name + total for session lists, no requests
  getOption(state, code): Promise<OptionDetails>
  change(state, { add, remove, dryRun? }): Promise<ChangeOutcome<S>>
  summary(state, { technical? }): Promise<Summary>
  exportCode(state): Promise<ExportResult>
  parseCode(code): string | null
  ownsCode(code): Promise<boolean>
  importCode(code): Promise<ImportResult<S>>
}
```

The Victor adapter serves `vw` and `vwn` (one `VictorClient` each). Its state
is `{ vehicleConfiguration, catalogue }`. The two instances share recently
loaded VW Codes, so detecting a code's brand and importing it load it once.

The Porsche adapter serves `porsche` (`PorscheClient`). Model list and
overview page are cached for an hour, specifications and efficiency per
option list, loaded codes for five minutes. Summaries need two extra small
requests (specifications, efficiency); a failure there leaves those fields
empty instead of failing the summary.

```
src/
  index.ts                     # MCP server + tool registration, builds the adapters
  session.ts                   # in-memory configurations (opaque backend state)
  core/backend.ts              # ConfiguratorBackend interface
  core/types.ts                # brand-neutral tool output types
  core/match.ts                # carline name matching
  core/throttle.ts             # one request at a time, with a gap
  brands.ts                    # VW_BRAND: which brands to serve
  tools/*.ts                   # catalog, configure, codes, compare (interface only)
  backends/victor/adapter.ts   # VictorBackend implements ConfiguratorBackend
  backends/victor/brand.ts     # enabled brands (VW_BRAND); site, tenant and wording per brand
  backends/victor/client.ts    # HTTP, key/tenant discovery, cacheKey, throttling
  backends/victor/types.ts     # backend response types
  backends/victor/catalog.ts   # carlines, trims, engines from the overview
  backends/victor/configuration.ts # options, diffs, summaries (pure functions)
  backends/victor/codes.ts     # VW Code format, loaded-code cache, configurator links
  backends/porsche/adapter.ts  # PorscheBackend implements ConfiguratorBackend
  backends/porsche/client.ts   # HTTP, `.data` routes, caches, throttling
  backends/porsche/turbo.ts    # turbo-stream decoder
  backends/porsche/catalog.ts  # porsche.com overview page, ranges, series
  backends/porsche/configuration.ts # catalogue, diffs, summaries (pure functions)
  backends/porsche/codes.ts    # Porsche Code format, links, load redirects
test/fixtures/                 # recorded responses (Porsche: test/fixtures/porsche)
```

## Risks / open items

1. Unofficial APIs. They can change or be locked down at any time, and using them is a
   grey area under VW's and Porsche's terms. Porsche's `.data` format is internal to
   its web app and can change with any deploy. Personal use, low request volume (requests are
   sent one at a time, 200 ms apart).
2. The API key can rotate. It's discovered from the website at startup, with a
   hard-coded fallback.
3. Only the DE market is tested. Other markets should work via `VW_SITE` and
   `PORSCHE_LOCALE`, but VW tenants and option names, and Porsche efficiency
   data and performance labels, are unverified there.
4. Ideas for later: persist sessions to disk, car images (`fetchMediaForConfiguration`),
   financing/leasing rates.
