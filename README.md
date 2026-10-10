# vw-cc-mcp

An MCP server that lets an AI agent spec a Volkswagen using the
[volkswagen.de configurator](https://www.volkswagen.de/de/konfigurator.html):
browse models, trims and engines, add paint/wheels/packages, see prices, WLTP
and technical data, compare configurations, and export a **link** that opens
the car in the real configurator (along with its **VW Code**).

The same server also covers the
[Volkswagen Nutzfahrzeuge configurator](https://www.volkswagen-nutzfahrzeuge.de/de.html)
(ID. Buzz, Multivan, California, Transporter, Caddy, Crafter, Amarok); see
[Commercial vehicles](#commercial-vehicles).

> Unofficial. This server uses the same undocumented backend as the website. It
> can break when VW changes it. Intended for personal, low-volume use.

## Setup

Requires Node.js 20+.

```sh
npm install
npm run build
```

### Claude Code

```sh
claude mcp add vw-configurator -- node /absolute/path/to/vw-cc-mcp/dist/index.js
```

### Claude Desktop / other clients

```json
{
  "mcpServers": {
    "vw-configurator": {
      "command": "node",
      "args": ["/absolute/path/to/vw-cc-mcp/dist/index.js"]
    }
  }
}
```

## Tools

| Tool | What it does |
|---|---|
| `list_models` | Model lines of both brands with starting price, fuel types, trims |
| `list_variants` | Trims of a model and their engines/gearboxes with price and power |
| `start_configuration` | New configuration from a trim (optionally a specific engine) → `config_id` |
| `list_options` | Paints, interiors, wheels, packages, options, accessories; filter by category, text, budget |
| `get_option` | Details of one option, package contents |
| `change_options` | Add/remove options; reports what the backend changed on its own; `dry_run` previews |
| `get_summary` | Model, colours, options, price breakdown, efficiency/WLTP, technical data |
| `export_code` | Save with VW and get a link that opens the car in the official configurator (plus its VW Code) |
| `import_code` | Load a VW Code into an editable configuration |
| `compare_configurations` | Side-by-side comparison of two or more configurations |
| `list_configurations` | Configurations in the current session |

Example prompt: *"Configure a Golf GTI in a metallic paint with 19-inch wheels
and IQ.DRIVE, stay under 52,000 €, and give me a link to it."*

### How changes are reported

`change_options` returns the price change and `side_effects`:

- `added` / `removed`: additional options the backend changed to keep the
  car buildable. The agent should mention these to you.
- `replaced`: the previous paint, interior or wheel choice.
- `standard_replaced` / `standard_restored`: standard parts swapped for the
  versions included with a package or wheel option. Nothing is lost.

Configurations live in memory while the server runs. Export one to keep it.
VW Codes are valid for about six months; links carry the configuration itself
and work as long as VW still offers that model.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `VW_BRAND` | both | Limit the server to `vw` (cars, volkswagen.de) or `vwn` (commercial vehicles, volkswagen-nutzfahrzeuge.de) |
| `VW_API_KEY` | discovered | Override the OneAPI key (both brands) |
| `VW_SITE` / `VWN_SITE` | the brand's site | Market site, used to discover API key and tenant |
| `VW_TENANT` / `VWN_TENANT` | discovered (`ihdcc-vw-de-de`) / `ihdcc-vwn-de-de` | Override the tenant |
| `VW_CONFIGURATOR_URL` / `VWN_CONFIGURATOR_URL` | `<site>/konfigurator.html` | Configurator page that `export_code` links into |

`VW_*` settings apply to cars, `VWN_*` to commercial vehicles.

Only the German market has been tested.

### Commercial vehicles

Cars and commercial vehicles are served side by side. `list_models` returns
both ranges, each model tagged with its `brand` (`vw` or `vwn`); the catalogue
tools take an optional `brand` to narrow down. A configuration remembers its
brand, and `import_code` detects it from the code.

Prices are reported incl. VAT, like for cars. Summaries also include
`net_total` (excl. VAT), which is what business customers usually look at.
Links from `export_code` open the configurator on the Nutzfahrzeuge site.

## Development

```sh
npm test                           # unit + MCP tests against recorded fixtures
npm run build && npm run test:live # end-to-end against the real backend (creates two VW Codes)
```

Backend notes are in [SPEC.md](SPEC.md).
