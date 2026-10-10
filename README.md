# vw-cc-mcp

An MCP server that lets an AI agent spec a Volkswagen using the
[volkswagen.de configurator](https://www.volkswagen.de/de/konfigurator.html):
browse models, trims and engines, add paint/wheels/packages, see prices, WLTP
and technical data, compare configurations, and export a **VW Code** you can
open in the real configurator under
[Konfiguration laden](https://www.volkswagen.de/de/modelle/konfiguration-laden.html).

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
| `list_models` | Model lines with starting price, fuel types, trims |
| `list_variants` | Trims of a model and their engines/gearboxes with price and power |
| `start_configuration` | New configuration from a trim (optionally a specific engine) → `config_id` |
| `list_options` | Paints, interiors, wheels, packages, options, accessories; filter by category, text, budget |
| `get_option` | Details of one option, package contents |
| `change_options` | Add/remove options; reports what the backend changed on its own; `dry_run` previews |
| `get_summary` | Model, colours, options, price breakdown, efficiency/WLTP, technical data |
| `export_code` | Save with VW and get a VW Code |
| `import_code` | Load a VW Code into an editable configuration |
| `compare_configurations` | Side-by-side comparison of two or more configurations |
| `list_configurations` | Configurations in the current session |

Example prompt: *"Configure a Golf GTI in a metallic paint with 19-inch wheels
and IQ.DRIVE, stay under 52,000 €, and give me the VW Code."*

### How changes are reported

`change_options` returns the price change and `side_effects`:

- `added` / `removed`: additional options the backend changed to keep the
  car buildable. The agent should mention these to you.
- `replaced`: the previous paint, interior or wheel choice.
- `standard_replaced` / `standard_restored`: standard parts swapped for the
  versions included with a package or wheel option. Nothing is lost.

Configurations live in memory while the server runs. Export a VW Code to keep one.
VW Codes are valid for about six months.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `VW_SITE` | `https://www.volkswagen.de/de` | Market site, used to discover API key and tenant |
| `VW_API_KEY` | discovered | Override the OneAPI key |
| `VW_TENANT` | discovered (`ihdcc-vw-de-de`) | Override the tenant |
| `VW_LOAD_CODE_URL` | `<VW_SITE>/modelle/konfiguration-laden.html` | Link returned by `export_code` |

Only the German market has been tested.

## Development

```sh
npm test                           # unit + MCP tests against recorded fixtures
npm run build && npm run test:live # end-to-end against the real backend (creates one VW Code)
```

Backend notes are in [SPEC.md](SPEC.md).
