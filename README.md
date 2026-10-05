# tablefacts

Data extraction tools for restaurant sites, shared by every Cannario template. Give it a restaurant's name and
place and it gathers the public facts; point it at an Instagram or TripAdvisor page and it downloads the photos;
point it at a Cluvi menu (or pictures of a paper menu) and it loads the menu into Supabase.

Everything works two ways: as a **command line** (`tablefacts <tool>`) and as a **JavaScript library**
(`import { research } from 'tablefacts'`). Both do the same work; the CLI is a thin layer over the functions.

| Tool | Command | Library function | Docs |
| --- | --- | --- | --- |
| Research | `tablefacts research "<name>" "<city>"` | `research()` | [src/research](src/research/README.md) |
| Instagram photos | `tablefacts photos instagram` | `downloadInstagram()` | [src/instagram](src/instagram/README.md) |
| TripAdvisor photos | `tablefacts photos tripadvisor` | `downloadTripadvisor()` | [src/tripadvisor](src/tripadvisor/README.md) |
| Menu from Cluvi | `tablefacts menu cluvi` | `importCluvi()` | [src/menu](src/menu/README.md) |
| Menu from pictures | `tablefacts menu raw` | `importImageMenu()` | [src/menu](src/menu/README.md) |

Contents: [Requirements](#requirements) · [Install](#install) · [Quick start](#quick-start) ·
[Command line](#command-line) · [Configuration](#configuration) · [Library](#use-it-as-a-library) ·
[Errors](#errors) · [Where things go](#where-things-go) · [Limits](#limits) · [Develop](#develop) ·
[Architecture](docs/ARCHITECTURE.md)

## Requirements

- **Node.js 24 or newer** (`engines` in `package.json`). The tools use the built-in `fetch` and `util.parseArgs`.
- **Playwright** (optional) for the photo tools and `research --render`: `npm install --save-dev playwright`.
- **Microsoft Edge on Windows** for the photo tools. They attach to a normal Edge window because the sites
  guard their pages with bot checks that automated browsers fail (see the photo tool READMEs). Starting Edge
  for you only works with Edge installed in its usual `Program Files` folder; elsewhere, start it yourself with
  `--remote-debugging-port=9222`.
- **A Supabase project** with the menu tables, only for the menu import (see [Supabase tables](#supabase-tables)).

## Install

```bash
npm install --save-dev tablefacts
npx tablefacts --help
```

Playwright is an **optional** peer dependency. Without it the photo tools and `research --render` stop with an
`EDEPENDENCY` error that tells you to install it; everything else works.

## Quick start

Run these from the folder of the project you are working on (see [Where things go](#where-things-go)).

```bash
# 1. Find a restaurant's public facts. No key needed; GOOGLE_PLACES_API_KEY adds more.
npx tablefacts research "Gaucho" "Medellín, Colombia" --country CO
#    -> .tablefacts/research/gaucho/report.md  (read this first)

# 2. Try a menu import without writing anything.
npx tablefacts menu cluvi https://gaucho.cluvi.co/gaucho/maincategories --dry-run

# 3. List the photos of a TripAdvisor page without saving them (needs Playwright and Edge).
npx tablefacts photos tripadvisor --out ./photos --dry-run <restaurant-link>
```

## Command line

`tablefacts <tool> [options]`. Run any tool with `--help` for its own text. An unknown tool exits with code 2.

### `research`

`tablefacts research "<name>" ["<city, country>"] [options]`

| Option | Meaning |
| --- | --- |
| `--country <ISO>` | Country code that narrows the search (`CO`, `MX`, `US`…) |
| `--website <url>` | The restaurant's site, if the search does not find it |
| `--instagram <handle\|url>` | Its Instagram |
| `--tripadvisor <url>` | Its TripAdvisor page |
| `--linktree <url>` | A Linktree or other link-in-bio page |
| `--photos <n>` | Also download up to *n* Google and *n* website photos (reference only) |
| `--render` | Render the website with Playwright (sites built in JavaScript) |
| `--no-google` | Skip Google even if `GOOGLE_PLACES_API_KEY` is set |
| `--out <dir>` | Output folder (default `.tablefacts/research/<slug>`; relative paths are relative to the project) |

Writes `report.md`, `profile.json` and `setup-answers.txt`. Details, sources and trust rules:
[src/research/README.md](src/research/README.md).

### `photos instagram`

`tablefacts photos instagram --out <folder> [options] [post-link...]`

| Option | Meaning |
| --- | --- |
| `--out <folder>` | **Required.** Created if missing |
| `--file <path>` | Text file with one link per line (`#` comments allowed) |
| `--profile <link\|@name>` | Download a whole profile's photos (needs a toolzu account signed in) |
| `--pages <n\|all>` | With `--profile`, batches of posts to load (default 1) |
| `--cdp <url>` | Attach to Edge on this debugging address; started if nothing listens |
| `--edge-dir <dir>` | Profile folder of that Edge (default `C:\ig-edge`) |
| `--google` | Reach toolzu through a Google search first (library option: `viaGoogle`) |
| `--browser <msedge\|chrome>`, `--headed`, `--user-data-dir <dir>` | Launch a browser instead of attaching (fallback) |
| `--dry-run` | Print what would be saved, write nothing |
| `--debug` | Save the page HTML into `<out>/_debug` |

### `photos tripadvisor`

`tablefacts photos tripadvisor --out <folder> [options] <restaurant-link>...`

| Option | Meaning |
| --- | --- |
| `--out <folder>` | **Required.** Created if missing |
| `--cdp <url>` | Edge debugging address (default `http://localhost:9222`) |
| `--edge-dir <dir>` | Profile folder of the Edge it starts (default `C:\ig-edge`) |
| `--max <n>` | Stop after *n* photos per restaurant |
| `--dry-run` / `--debug` | List without saving / keep the page HTML in `<out>/_debug` |

### `menu cluvi` and `menu raw`

Both share these options (and replace the menu in Supabase unless `--dry-run`):

| Option | Meaning |
| --- | --- |
| `--dry-run` | Extract and check, show what would change, write nothing |
| `--json <file>` | Also save the extracted menu as JSON |
| `--replace-all` | Replace the whole menu, not only the categories in this import |
| `--force` | Write even if the import has fewer than half the products it replaces |

`tablefacts menu cluvi [menu-url] [--service on_table|delivery|take_away] [--lang es]`

`tablefacts menu raw [page-or-image-url...] [--list] [--only 1,3-5] [--provider anthropic|gemini|groq] [--model <id>] [--min-width 500] [--refresh]`

Both read the restaurant-specific part (URL, category mapping, currency) from a `config.mjs` next to the tool.
**The shipped configs hold another restaurant's values: edit them first.** See [src/menu/README.md](src/menu/README.md).

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | A failure: a source failed, an import was refused, or (photo tools) any download failed |
| `2` | Bad arguments (`EUSAGE`) from any tool, or an unknown tool |

The CLI prints a library error's message with option names turned into flags (`` `out` `` becomes `--out <folder>`).

## Configuration

The CLI reads `<project>/.env` (then `<project>/data/.env`) before running; variables already in the
environment win. [.env.example](.env.example) is the template.

| Variable | Used by | Meaning |
| --- | --- | --- |
| `SUPABASE_DB_URL` | `menu cluvi`, `menu raw` | Postgres connection string (Supabase *Transaction pooler* URL, with the real password). **Bypasses row level security:** keep it in `.env`, never in a browser-exposed variable |
| `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY` | `menu raw` | Key of the vision provider that reads the pictures |
| `MENU_VISION_PROVIDER` | `menu raw` | Provider when `--provider` is not given: `anthropic` (default), `gemini` or `groq` |
| `GOOGLE_PLACES_API_KEY` | `research` | Optional. Enables Google Maps (Places API (New)); without it OpenStreetMap and the web pages still work |
| `TABLEFACTS_PROJECT` | all | Project folder to work on instead of the current one |

## Use it as a library

Every tool is also a function. Functions are silent unless you pass `log`, never call `process.exit`, never
read `.env` for you (call `loadEnv()` or set the variables), and throw a [`TablefactsError`](#errors) on failure.
Types ship with the package (generated from the JSDoc into `types/`, `npm run build:types`); runnable examples are in [examples/](examples).

```js
import { loadEnv, research } from 'tablefacts'

loadEnv()   // reads <project>/.env into process.env, like the CLI does; never overrides variables already set
const { profile, files } = await research({ name: 'Gaucho', location: 'Medellín, Colombia', log: (message, level) => console.log(message) })
console.log(files.report)
```

### Project folder

Functions never assume where they run. Pass `projectDir` to say which project they work on; without it
they use `TABLEFACTS_PROJECT`, then the current folder. It decides where `.env` is read from (`loadEnv`), the
default output folder, browser profiles, the menu transcription cache, and where menu hints are read. Relative
`out`, `file`, `json` and `userDataDir` paths resolve against it too (absolute paths are used as they are).

### Logging and environment

- **`log(message, level)`**: every function takes an optional `log`; `level` is `'info'` (the default),
  `'warn'` (a problem the run goes on from) or `'error'` (a failure). Without `log` a function prints nothing.
  A callback that takes only `message` works too.
- **`env`**: `research`, `importMenu`, `importCluvi` and `importImageMenu` read keys (`GOOGLE_PLACES_API_KEY`,
  `SUPABASE_DB_URL`, the vision key, `MENU_VISION_PROVIDER`) from the `env` option, `process.env` by default. Pass
  your own object to keep secrets out of the process environment. `loadEnv({ projectDir, files, env })` reads the
  project's `.env` files (or exactly `files`) into `env` (default `process.env`) without overriding what is set,
  and returns the files it read.

### API

| Function | Does | Needs |
| --- | --- | --- |
| `research({ name, location, country, website, instagram, tripadvisor, linktree, photos, render, google, googleKey, env, out, projectDir, log })` | Gathers public facts; writes `profile.json`, `report.md`, `setup-answers.txt`. Returns `{ profile, notes, photos, outDir, files }` | `GOOGLE_PLACES_API_KEY` is optional; `render` needs Playwright |
| `downloadInstagram({ links, file, out, profile, pages, cdp, edgeDir, viaGoogle, browser, userDataDir, headed, dryRun, debug, projectDir, log })` | Downloads post or profile photos (give `links`, `file` or `profile`). Returns `{ saved, skipped, failed: [{ item, reason }], found? }` | Playwright |
| `downloadTripadvisor({ links, out, cdp, edgeDir, max, dryRun, debug, projectDir, log })` | Downloads a restaurant page's photos. Same result | Playwright |
| `importMenu({ menu, notes, title, dryRun, json, replaceAll, force, databaseUrl, env, projectDir, log })` | Validates a menu and writes it to Supabase. Returns `{ totals, notes, written, dryRun, database }`, `database` being `{ label, current: { categories, products, kept } }` or `null` when it was not reached | `SUPABASE_DB_URL` unless `dryRun` |
| `importCluvi({ url, service, lang, config, ...importMenu options })` | Reads a Cluvi menu, then `importMenu` | `SUPABASE_DB_URL` unless `dryRun` |
| `importImageMenu({ urls, only, provider, model, minWidth, refresh, apiKey, config, ...importMenu options })` | Transcribes menu pictures with a vision model, then `importMenu` | A vision key (see [Configuration](#configuration)) |
| `listMenuImages({ urls, only, minWidth, config })` | Lists the menu pictures found on pages (numbered as `--list` shows) | none |
| `loadEnv({ projectDir, files, env })` | Loads `.env` files into `env` (default `process.env`); returns the files it read | none |

Also exported: `validateMenu`, `countMenu`, `parsePrice`, `normalizePages`, `providers`, `defaultProvider`,
`projectRoot`, `workDir`, `workDirIn`, `envFiles`, `TablefactsError`, and the TypeScript types of every option and
result (`ResearchOptions`, `PhotoSummary`, `ImportResult`, `Menu`, `Log`, `Env`...).

`config` (`importCluvi`, `importImageMenu`, `listMenuImages`) replaces the restaurant-specific `config.mjs` of that
source for one call, so a script can import a menu without editing the package. See [src/menu/README.md](src/menu/README.md).

`importMenu` takes a menu you built yourself, so you can feed it any source:

```js
import { importMenu } from 'tablefacts'

const menu = [{
  slug: 'cocina', name: 'Comida',
  sections: [{ name: 'ENTRADAS', products: [
    { name: 'Empanadas', description: null, price: 12000, currency: 'COP', image_url: null, recommended: false },
  ] }],
}]
const result = await importMenu({ menu, dryRun: true, log: console.log })
console.log(result.totals)   // { categories: 1, sections: 1, products: 1, withImage: 0 }
```

Array order is display order. `price` is a number, `currency` an ISO 4217 code, `image_url` an `https://` URL
or empty. `validateMenu` throws an `EFAILED` error naming the problems it finds.

### Errors

Failures the library raises on purpose throw `TablefactsError`, which has a `code`:

| Code | Meaning |
| --- | --- |
| `EUSAGE` | A missing or invalid argument (no `out`, no valid links, no `name`). CLIs exit with `2` |
| `ECONFIG` | Missing configuration: database URL, API key, unknown provider, no menu URL |
| `EDEPENDENCY` | An optional dependency is not installed (Playwright) |
| `EFAILED` | A source failed or was blocked, data did not validate, or an import was refused (invalid menu, no products, far fewer products than it replaces) |

When the error is about one option, `err.option` names it (`'out'`, `'links'`, `'force'`...) and the message writes
it in backticks (`` `out` is required ``). The CLI swaps those for its flags (`--out <folder>`); library callers see
the option names. `err.cause` holds the underlying error when there is one.

```js
import { TablefactsError, importCluvi } from 'tablefacts'

try {
  await importCluvi({ url, dryRun: true })
} catch (err) {
  if (err instanceof TablefactsError && err.code === 'ECONFIG') console.error('Set SUPABASE_DB_URL')
  else throw err
}
```

Anything else that is thrown (a bug, an unwrapped network error) is not a `TablefactsError`: rethrow it.

## Where things go

The tools work on **the project in the current folder** (or the one in `TABLEFACTS_PROJECT`), never on the
folder tablefacts is installed in, so one install serves every template.

| What | Where |
| --- | --- |
| `.env` | `<project>/.env`, then `<project>/data/.env` (older templates) |
| Research output | `<project>/.tablefacts/research/<slug>/` |
| Menu transcription cache and downloaded page images | `<project>/.tablefacts/cache/<host>/` |
| Fallback browser profile | `<project>/.tablefacts/instagram-profile` |
| Photos | The `--out` folder you give |
| Edge profile for the photo tools | `C:\ig-edge` (`--edge-dir` changes it) |

Git-ignore `.tablefacts/`: it holds third-party data and caches. Menu hints (missing dictionary keys, image
hosts) are read from the template's `frontend/src/content` and skipped silently when it is not there.

### Supabase tables

`menu cluvi` and `menu raw` write to these tables, which your project must already have (the Cannario
templates ship the migration `supabase/migrations/0001_menu.sql`):

| Table | Columns written |
| --- | --- |
| `public.menu_categories` | `id` (uuid), `slug`, `name`, `sort_order` |
| `public.menu_sections` | `id` (uuid), `category_id`, `name`, `sort_order` |
| `public.menu_products` | `section_id`, `name`, `description`, `price` (numeric), `currency`, `image_url`, `recommended`, `sort_order` |

The write is **one transaction** and replaces only the categories in the import (their sections and products go
with them), so re-running never duplicates. `--replace-all` empties the whole menu first. An import with no
products, or with under half the products it replaces, is refused unless `--force`. Always run `--dry-run` first.

## Limits

- It reads **public** pages only. It does not log in to Instagram, TripAdvisor or Google, and it does not get
  past bot protection: a blocked source is reported, not worked around.
- Cluvi has no public API; the importer calls the two JSON endpoints its web app uses, which can change.
- Prices read from pictures can be wrong. Read the dry run against the original before writing.
- Only download photos the restaurant owns or has allowed you to use. Guest photos on TripAdvisor and
  Instagram belong to their authors.

## Develop

```bash
npm install
npm test            # vitest; no network, database or browser is used
npm run build:types # writes types/ from the JSDoc (git-ignored, shipped in the package)
```

`npm test` builds the types and compiles `tests/fixtures/consumer.ts` against them, so a drift between the code
and its declarations fails the tests. Document options with JSDoc in `src/lib/types.mjs` and on the functions.

CI (`.github/workflows/ci.yml`) runs the tests on Ubuntu and Windows with Node 24 and checks `npm pack --dry-run`
on every push to `main` and every pull request. Dependabot (`.github/dependabot.yml`) keeps dependencies current.

**Release:** bump `version` in `package.json`, commit, then push a matching tag, e.g. `git tag v0.1.1 && git push origin v0.1.1`.
`.github/workflows/release.yml` checks the tag equals the version, runs the tests, publishes to npm with provenance
(needs an `NPM_TOKEN` repository secret) and creates a GitHub release with generated notes.

For how the code is organised and how to add a source or a tool, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

[MIT](LICENSE)
