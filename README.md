# car-configurator-mcp

An MCP server that lets an AI agent spec a car using the manufacturers'
official online configurators: browse models, trims and engines, add
paint/wheels/packages, see prices, WLTP and technical data, compare
configurations, and export a **link** that opens the car in the real
configurator (along with its code, e.g. a **VW Code** or **Porsche Code**).

Supported configurators:

| Brand | Configurator | Models |
|---|---|---|
| `vw` | [Volkswagen](https://www.volkswagen.de/de/konfigurator.html) | Polo, Golf, T-Roc, Tiguan, ID. family, … |
| `vwn` | [Volkswagen Nutzfahrzeuge](https://www.volkswagen-nutzfahrzeuge.de/de.html) | ID. Buzz, Multivan, California, Transporter, Caddy, Crafter, Amarok; see [Commercial vehicles](#commercial-vehicles) |
| `porsche` | [Porsche](https://configurator.porsche.com/de-DE/) | 911, 718, Taycan, Panamera, Macan, Cayenne; see [Porsche](#porsche) |

> Unofficial. This server uses the same undocumented backends as the websites.
> It can break when the manufacturers change them. Intended for personal, low-volume use.

## Setup

Requires Node.js 20+.

```sh
npm install
npm run build
```

### Claude Code

```sh
claude mcp add car-configurator -- node /absolute/path/to/car-configurator-mcp/dist/index.js
```

### Claude Desktop / other clients

```json
{
  "mcpServers": {
    "car-configurator": {
      "command": "node",
      "args": ["/absolute/path/to/car-configurator-mcp/dist/index.js"]
    }
  }
}
```

## Tools

| Tool | What it does |
|---|---|
| `list_models` | Model lines of all enabled brands with starting price, fuel types, trims |
| `list_variants` | Variants of a model (grouped by trim) with `variant_id`, price, power, gearbox |
| `start_configuration` | New configuration from a `variant_id` (or carline + trim + optional `model_code`) → `config_id` |
| `list_options` | Options by category (`paint`, `interior`, `wheels`, `packages`, `options`, `accessories`, `standard`); filter by text, budget |
| `get_option` | Details of one option, package contents |
| `change_options` | Add/remove options; reports what the backend changed on its own and any `choices_required`; `dry_run` previews |
| `get_summary` | Model, colours, options, price breakdown, performance, efficiency/WLTP, technical data |
| `export_code` | Save with the manufacturer and get a link that opens the car in the official configurator (plus its `code`, e.g. a VW Code) |
| `import_code` | Load a code into an editable configuration; `brand` is optional and otherwise detected |
| `compare_configurations` | Side-by-side comparison of two or more configurations |
| `list_configurations` | Configurations in the current session |

Prices are numbers in the market currency (each response names it in
`currency`), incl. VAT.

Example prompts: *"Configure a Golf GTI in a metallic paint with 19-inch wheels
and IQ.DRIVE, stay under 52,000 €, and give me a link to it."* or *"Spec a
Cayenne Electric with ventilated seats and compare it with a Taycan."*

### How changes are reported

`change_options` returns the price change and `side_effects`:

- `added` / `removed`: additional options the backend changed to keep the
  car buildable. The agent should mention these to you.
- `replaced`: the previous paint, interior or wheel choice.
- `standard_replaced` / `standard_restored`: standard parts swapped for the
  versions included with a package or wheel option. Nothing is lost.

`choices_required` lists picks the user has to make. It is always empty for
Volkswagen, whose backend decides on its own. Porsche sometimes asks, e.g. for
a new interior or seats when an option rules out the current one. The server
then applies the configurator's default, names it in `chosen` and lists the
alternatives. The agent can switch by adding another choice's code, or pass
the wanted choice up front (`add: ["4D3", "Q1J"]`).

Configurations live in memory while the server runs. Export one to keep it.
VW Codes are valid for about six months; VW links carry the configuration
itself and work as long as VW still offers that model. Porsche links are
`porsche-code.com` short links to the Porsche Code.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `BRANDS` | all | Limit the server to some brands, comma-separated: `vw` (cars, volkswagen.de), `vwn` (commercial vehicles, volkswagen-nutzfahrzeuge.de), `porsche` (configurator.porsche.com) |
| `VW_API_KEY` | discovered | Override the OneAPI key (both brands) |
| `VW_SITE` / `VWN_SITE` | the brand's site | Market site, used to discover API key and tenant |
| `VW_TENANT` / `VWN_TENANT` | discovered (`ihdcc-vw-de-de`) / `ihdcc-vwn-de-de` | Override the tenant |
| `VW_CONFIGURATOR_URL` / `VWN_CONFIGURATOR_URL` | `<site>/konfigurator.html` | Configurator page that `export_code` links into |
| `PORSCHE_LOCALE` | `de-DE` | Porsche market and language, e.g. `en-GB`, `en-US`, `fr-CH` |
| `PORSCHE_MODELS_URL` | per locale | porsche.com model overview page that names and prices the models (known for `de-DE`, `en-GB`, `en-US`, `de-CH`, `fr-CH`) |

`VW_*` settings apply to Volkswagen cars, `VWN_*` to commercial vehicles.
`VW_BRAND`, the old name of `BRANDS`, still works.

Only the German market has been tested.

### Commercial vehicles

Cars and commercial vehicles are served side by side. `list_models` returns
both ranges, each model tagged with its `brand` (`vw` or `vwn`); the catalogue
tools take an optional `brand` to narrow down. A configuration remembers its
brand, and `import_code` detects it from the code.

Prices are reported incl. VAT, like for cars. Summaries also include
`net_total` (excl. VAT), which is what business customers usually look at.
Links from `export_code` open the configurator on the Nutzfahrzeuge site.

### Porsche

`list_models` returns the Porsche model ranges (911, 718, Taycan, …) with
brand `porsche`; `list_variants` groups their models by series (e.g. 911
Carrera, 911 Carrera Cabriolet). Each model is one `variant_id`, its order
type (e.g. `992142` for the 911 Carrera GTS). Option names, technical data and
efficiency labels come in the market's language.

Porsche Codes look like VW Codes (8 letters/digits). `import_code` also takes
`porsche-code.com` links and asks the backends which one knows a plain code.
Every export creates a new Porsche Code on Porsche's side, so export only
when you want to keep or share a configuration. Paint to Sample needs input
the server can't give; choose it in the Porsche configurator.

## Development

```sh
npm test                           # unit + MCP tests against recorded fixtures
npm run build && npm run test:live # end-to-end against the real backends (creates two VW Codes and a Porsche Code)
```

Backend notes are in [SPEC.md](SPEC.md).
