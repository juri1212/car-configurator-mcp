# car-configurator-mcp

**Let Claude (or another AI assistant) build your next car for you.**

Tell the assistant what you want in plain words, for example *"a Golf GTI in a
metallic colour with 19-inch wheels, under 52,000 €"*, and it uses the
manufacturer's own online configurator to put the car together. You get the
price, the equipment, consumption/WLTP figures and technical data, and at the
end a **link that opens your car in the official configurator** on the
manufacturer's website, ready to show your dealer.

It works with:

| Brand | Models |
|---|---|
| [Volkswagen](https://www.volkswagen.de/de/konfigurator.html) | Polo, Golf, T-Roc, Tiguan, ID. family, … |
| [Volkswagen Nutzfahrzeuge](https://www.volkswagen-nutzfahrzeuge.de/de.html) (vans & pickups) | ID. Buzz, Multivan, California, Transporter, Caddy, Crafter, Amarok |
| [Porsche](https://configurator.porsche.com/de-DE/) | 911, 718, Taycan, Panamera, Macan, Cayenne |

Prices are for **Germany** (in EUR, incl. VAT). Porsche can also be switched to
other countries, see [Other countries](#other-countries).

> **Unofficial.** This project is not affiliated with, endorsed by or connected
> to Volkswagen AG, Porsche AG or any of their subsidiaries. All brand and
> model names are trademarks of their respective owners. It talks to the same
> behind-the-scenes services as the public websites, so it can stop working
> whenever the manufacturers change them. It is meant for personal use; no
> login or personal data is involved. Prices and data are for information
> only: the manufacturer's configurator and your dealer have the final word.

## Installation

This is an "MCP server", a small add-on that gives your AI assistant new
abilities. Setting it up takes about five minutes and two steps.

### Step 1: Install Node.js

The add-on needs **Node.js** (free) to run. Download the **LTS** version from
[nodejs.org](https://nodejs.org/en/download) and install it like any other
program. You only have to do this once.

Already have it? Fine, version 20 or newer is needed.

### Step 2: Add it to your AI app

#### Claude Desktop app

1. Open Claude Desktop and go to **Settings → Developer → Edit Config**.
   This opens a file called `claude_desktop_config.json` in a text editor.
2. Replace its content with the following (if the file already contains other
   entries under `"mcpServers"`, just add the `"car-configurator"` part next to
   them):

   ```json
   {
     "mcpServers": {
       "car-configurator": {
         "command": "npx",
         "args": ["-y", "github:juri1212/car-configurator-mcp"]
       }
     }
   }
   ```

3. Save the file and **quit Claude Desktop completely** (on a Mac:
   <kbd>Cmd</kbd>+<kbd>Q</kbd>; on Windows: right-click the Claude icon in the
   taskbar tray → Quit), then open it again.
4. Start a new chat. Under the **"+" / tools** button you should now see
   **car-configurator**. The very first start can take a minute while it
   downloads.

#### Claude Code (terminal)

```sh
claude mcp add car-configurator -- npx -y github:juri1212/car-configurator-mcp
```

#### Other apps (Cursor, VS Code, …)

Most apps that support MCP accept the same JSON block as Claude Desktop above.
Look for "MCP servers" in the app's settings.

### Try it

Just ask, for example:

- *"Configure a Golf GTI in a metallic paint with 19-inch wheels and IQ.DRIVE,
  stay under 52,000 €, and give me a link to it."*
- *"Spec a Cayenne Electric with ventilated seats and compare it with a Taycan."*
- *"What does an ID. Buzz with 7 seats and the long wheelbase cost?"*
- *"Open this VW Code and add a towbar: ABC12345"*

The assistant will tell you when the manufacturer automatically adds or removes
something (e.g. because a package requires it). Ask for the **link** at the
end; it opens your exact car on the manufacturer's website.

### Something not working?

- **The tool doesn't show up:** make sure you quit Claude Desktop fully (not
  just closed the window) and that Node.js is installed. On Windows, a restart
  of the computer after installing Node.js sometimes helps.
- **"npx not found" / "spawn npx ENOENT":** Node.js isn't installed or the app
  can't find it. Reinstall Node.js from [nodejs.org](https://nodejs.org) and
  restart your computer.
- **Errors about a model or option:** the manufacturer may have changed their
  website. Please [open an issue](https://github.com/juri1212/car-configurator-mcp/issues).

### Other countries

By default everything is for Germany. For Porsche you can pick another market
by adding an `env` line to the config, e.g. for the UK:

```json
"car-configurator": {
  "command": "npx",
  "args": ["-y", "github:juri1212/car-configurator-mcp"],
  "env": { "PORSCHE_LOCALE": "en-GB" }
}
```

To show only some brands, add `"BRANDS": "porsche"` (or `"vw"`, `"vwn"`,
comma-separated) to the same `env` block. All settings are listed under
[Configuration](#configuration).

---

*Everything below is technical reference for developers and the curious.*

## Running from a local checkout

```sh
git clone https://github.com/juri1212/car-configurator-mcp.git
cd car-configurator-mcp
npm install   # also builds dist/
```

```sh
claude mcp add car-configurator -- node /absolute/path/to/car-configurator-mcp/dist/index.js
```

or, for other clients, use `"command": "node"` with
`"args": ["/absolute/path/to/car-configurator-mcp/dist/index.js"]`.

To pass settings, add them as environment variables, e.g.
`claude mcp add car-configurator -e BRANDS=porsche -e PORSCHE_LOCALE=en-GB -- …`
or an `"env": { … }` block in the JSON config.

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

Only the German market has been tested. Reports from other markets are welcome.

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

## Contributing

Issues and pull requests are welcome, especially reports when a backend
changed and something broke, and testing in other markets. Please run
`npm run typecheck && npm test` before opening a PR. New backend behaviour
should come with a recorded fixture in `test/fixtures/` so the tests stay
offline.

## License

[MIT](LICENSE)
