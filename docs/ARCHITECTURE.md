# Architecture

How tablefacts is put together, for someone who needs to change it. For using it, see the
[README](../README.md) and the README of each tool.

## One rule shapes everything

Every tool has two halves:

- a **library function** (`src/<tool>/index.mjs`, or `src/menu/*/import.mjs`) that does the work. It is silent
  unless given `log`, never reads `process.argv`, never loads `.env`, never calls `process.exit`, and signals
  failure by throwing a `TablefactsError`.
- a **command** (`src/<tool>/<script>.mjs`) that parses arguments, calls `loadEnv()`, calls the function with
  `log: console.log`, prints a summary and sets the exit code.

Keep new logic in the function. A command that does anything beyond arguments, output and exit codes is a
sign the logic belongs in the library, where tests and other programs can reach it.

## Layout

```text
bin/tablefacts.mjs        Dispatcher: picks the command script from the first one or two arguments
src/
  index.mjs               Public API: everything the package exports
  lib/
    types.mjs             @typedefs of every option and result (no runtime code); types/ is generated from the JSDoc
    errors.mjs            TablefactsError, usageError, exitCodeFor
    project.mjs           projectRoot, workDir, workDirIn, envFiles: where a run reads and writes
    env.mjs               loadEnv: .env files into process.env without overriding
    playwright.mjs        loadPlaywright: lazy import of the optional dependency
    edge.mjs              Attach to (or start) the user's Edge window over the DevTools protocol
    text.mjs              slugify / fold: accent-free keys
    files.mjs             exists(): a promise-based file existence check
  research/               Public facts about a restaurant
  instagram/              Photo download through toolzu.com
  tripadvisor/            Photo download from a TripAdvisor page
  menu/                   Menu import into Supabase
examples/                 Runnable library examples
tests/                    vitest; the stand-in project is tests/fixtures/project
.github/                  CI, release and Dependabot
```

## The dispatcher

`bin/tablefacts.mjs` holds a table of `"tool name" -> script`. It matches two words first (`photos
instagram`), then one (`research`), removes the matched words from `process.argv` and imports the script.
Each command script therefore reads `process.argv.slice(2)` as if it had been started directly. To add a
command, add a line there and a script.

## Project folder and files

`src/lib/project.mjs` is the only place that decides where a run happens: `projectDir` option, else
`TABLEFACTS_PROJECT`, else the current directory. Anything a tool writes goes under `<project>/.tablefacts/`
(`workDirIn`); `.env` is read from the project root. Tools must not use `process.cwd()` or the package's own
folder for data, or one install would stop serving many projects.

## Errors

`TablefactsError(message, code)` with `code` one of `EUSAGE`, `ECONFIG`, `EDEPENDENCY`, `EFAILED`.
The photo commands catch it, print `err.message` and exit with `exitCodeFor(err)` (2 for `EUSAGE`, 1 otherwise);
`research` and the menu commands print the message and exit 1. A thrown non-`TablefactsError` is a bug and is
allowed to crash. Wrap an expected failure of an outside service (HTTP error, blocked page, bad response) as
`EFAILED` with a message a person can act on.

## Research (`src/research`)

`research()` in `index.mjs` runs the sources in order and writes `profile.json`, `report.md`, `setup-answers.txt` (and, in the default folder, `latest.json`):

1. Google Places and OpenStreetMap, in parallel (they need only the name and place).
2. When neither found a website, a key-free web search (`lib/search.mjs`) turns the bare name and place into
   candidate links (website, Instagram, TripAdvisor, Maps) that the rest of the flow follows.
3. The restaurant's website (`lib/website.mjs`), from the option or from what step 1 or 2 found.
4. Instagram, then a link-in-bio page, then TripAdvisor (`lib/social.mjs`), each from the option or a link an
   earlier source found. Instagram tries several public surfaces; TripAdvisor's URL slug yields a name and city
   even when the page is blocked.
5. `lib/merge.mjs` combines everything into `profile.fields.<name> = { value, source, confidence, alternatives? }`.
   It holds the **trust order per field**; two sources agreeing makes confidence `high`, one `medium`, a guess `low`.
6. `lib/report.mjs` renders `report.md` and `setup-answers.txt`; `lib/hours.mjs` normalises opening hours. A
   low-confidence guess is marked "low (guess)" and left blank in `setup-answers.txt`.

A source that fails is a note in the report, never the end of the run (`source()` inside `research`). To add a
source: write a reader that returns plain data, call it in `research()` through `source()`, and add its
candidates to `merge.mjs`.

## Photos (`src/instagram`, `src/tripadvisor`)

Both drive the user's own Edge through `lib/edge.mjs` (`ensureEdge` starts it if nothing listens on the
debugging port; Playwright then connects over CDP). Neither tries to defeat a bot check: they wait for a
person to pass it. Site-specific selectors are isolated in a few functions named in each README
(`findImages`, `openGallery`, `collect`…), so a markup change is a local fix. Link parsing and file naming are
pure functions in `links.mjs`. `record.mjs` is a developer aid that opens Playwright's Inspector on the
attached window to record a flow.

## Menu (`src/menu`)

```text
source (cluvi | raw)  ->  menu in the shared shape  ->  lib/import.mjs: importMenu  ->  lib/db.mjs
```

- **The shared shape** is documented at the top of `lib/menu.mjs`:
  `[{ slug, name, sections: [{ name, products: [{ name, description, price, currency, image_url, recommended }] }] }]`.
  `validateMenu` enforces it.
- **`lib/import.mjs`** (`importMenu`) validates, logs totals, optionally saves JSON, reads the template's
  `frontend/src/content` for hints, compares with the database and refuses suspicious imports before writing.
- **`lib/tables.mjs`** resolves the restaurant's table names from its prefix (`validateTablePrefix`,
  `menuTables`); the validated prefix is the only thing interpolated into the `db.mjs` SQL.
- **`lib/db.mjs`** talks to Postgres with `pg` (loaded only when a database is reached). `assertTarget()`
  refuses a shared database before any write; `inspect()` counts what would be replaced; `replaceMenu()`
  does the delete and bulk inserts in one transaction, scoped to the restaurant's prefixed tables.
- **`lib/run.mjs`** (`runImport`) is the shared command wrapper: common flags, `--help`, `loadEnv`, exit code.
- **`cluvi/`**: `source.mjs` calls Cluvi's two JSON endpoints, `import.mjs` maps them through `config.mjs`.
- **`raw/`**: `source.mjs` finds and downloads page images, `vision.mjs` has a vision model transcribe each page
  (providers differ only in how a request is built and read), `normalize.mjs` turns the transcription into the
  shared shape (prices are parsed here from printed text, never by the model), `import.mjs` ties it together with
  a per-page cache.

### Adding a menu source

Create `src/menu/<source>/` with a function that returns `{ menu, notes, title }` in the shared shape, an
`importX` that passes it to `importMenu`, and a command script that calls `runImport` from `lib/run.mjs`.
Export the function from `src/menu/index.mjs` and `src/index.mjs`, document it with JSDoc (`@param`, `@returns`, typedefs in
`src/lib/types.mjs`, re-exported as typedefs in `src/index.mjs`) and add a line to the dispatcher. Restaurant-specific values belong in a `config.mjs` accepted as the `config` option.

### Adding a vision provider

Add an entry to `providers` in `raw/vision.mjs` with `label`, `keyName`, `defaultModel`, a `request` that builds
the call for one picture (`{ url, headers, body }`), and a `read` that extracts the transcription from the answer
or throws why there is none. The schema, prompt, retries (HTTP 408/429/5xx, honouring the wait the service asks
for up to a minute) and checks are shared.

## Tests

`npm test` runs vitest. No test should need the network, a database or a browser. `vitest.config.ts` sets
`TABLEFACTS_PROJECT` to `tests/fixtures/project`, a stand-in template, so the tests never read the real working
directory. `tests/types.test.ts` builds `types/` (`npm run build:types`, from the JSDoc), checks that it declares exactly the
runtime exports of `index.mjs`, and compiles `tests/fixtures/consumer.ts` against it (`@ts-expect-error` lines must
stay errors). Add a test with every behaviour change; the pure parts (link parsing,
price parsing, merging) are cheap to cover and where most regressions happen.

## Conventions

- ES modules (`.mjs`), no build step; Node 24.
- A comment says *why*, or what an outside service does that the code can't show. Selectors and endpoints
  belong next to a note saying how to find them again when the site changes.
- User-facing text (help, errors, report) names commands as `tablefacts <tool>` and folders as `.tablefacts/…`.
