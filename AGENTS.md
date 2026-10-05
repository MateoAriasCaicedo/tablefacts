# AGENTS.md

Guidance for AI coding agents working on **tablefacts**: restaurant data extraction tools (public-facts
research, Instagram/TripAdvisor photos, menu import into Supabase), shipped as a CLI and a JavaScript library.

Read these instead of re-deriving them: [README.md](README.md) (usage, API, errors, where files go),
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (how the code is organised, how to add a source), and the README
in each `src/<tool>/` folder (sources, selectors, trust rules).

## Commands

```bash
npm install
npm test             # vitest run; also builds types/ and compiles tests/fixtures/consumer.ts against them
npm run build:types  # tsc -p tsconfig.build.json; writes types/ from the JSDoc (git-ignored)
node bin/tablefacts.mjs --help
```

There is no build step for the code itself: plain ES modules (`.mjs`), Node >= 24. No linter or formatter is
configured, so match the style of the file you are editing.

## The rule that shapes the code

Every tool is a **library function** plus a thin **command**.

- Library functions (`src/<tool>/index.mjs`, `src/menu/*/import.mjs`) are silent unless given `log`, never read
  `process.argv`, never load `.env`, never call `process.exit`, and fail by throwing `TablefactsError`
  (`EUSAGE`, `ECONFIG`, `EDEPENDENCY`, `EFAILED`).
- Commands parse arguments, call `loadEnv()`, call the function with `log: console.log`, print a summary and set
  the exit code (2 for `EUSAGE`, 1 otherwise).
- New logic goes in the function, not the command.
- Never use `process.cwd()` or the package folder for data. `src/lib/project.mjs` decides the project folder
  (`projectDir` option, then `TABLEFACTS_PROJECT`, then cwd); output goes under `<project>/.tablefacts/`.

## Making changes

- **Public API**: anything exported from `src/index.mjs` needs JSDoc, with typedefs in `src/lib/types.mjs`.
  `tests/types.test.ts` fails if `types/` and the runtime exports drift, or if the `@ts-expect-error` lines in
  `tests/fixtures/consumer.ts` stop being errors.
- **Tests**: add one with every behaviour change. They must not use the network, a database or a browser; the
  stand-in project is `tests/fixtures/project` (vitest sets `TABLEFACTS_PROJECT` to it). Pure parts (link and
  price parsing, merging) are where regressions happen.
- **New command**: add a script and a line in the dispatcher table in `bin/tablefacts.mjs`.
- **New menu source or vision provider**: follow the recipes in `docs/ARCHITECTURE.md`.
- **Comments** say why, or what an outside service does that the code can't show. Keep selectors and endpoints
  next to a note on how to find them again when the site changes.
- **User-facing text** names commands as `tablefacts <tool>` and folders as `.tablefacts/...`.
- Update the README (and the tool's README) when options, env variables or behaviour change.

## Do not

- **Never read, print, log or commit `.env` or any secret.** `SUPABASE_DB_URL` bypasses row level security.
  `.env.example` is the only env file that belongs in git.
- **Never write to a real database to test.** Use `--dry-run` or the `dryRun` option. A real menu import
  replaces data in the Supabase project that `SUPABASE_DB_URL` points at; do not run one unless the user asks.
- **Do not work around bot protection or log in to a site.** The tools read public pages only and report a
  blocked source. Photo tools wait for a person to pass a check in their own Edge window.
- **Do not make tests depend on live sites** (Cluvi, TripAdvisor, toolzu, Google, OpenStreetMap).
- Do not edit `types/`, `.tablefacts/`, `.extract/` or `node_modules/`; they are generated or git-ignored.
- Do not add dependencies lightly: `pg` is the only runtime dependency, and Playwright (browser tools) and
  `pdfjs-dist`/`@napi-rs/canvas` (PDF menus) are optional peer dependencies. Load optional or heavy modules
  lazily, as `src/lib/playwright.mjs` and `src/menu/raw/pdfjs.mjs` do.

## Gotchas

- The shipped `config.mjs` files under `src/menu/cluvi` and `src/menu/raw` hold **another restaurant's values**
  (URL, category mapping, currency). Library callers override them with the `config` option; do not "fix" them
  to match a test restaurant.
- The photo tools target Windows and Microsoft Edge (`C:\ig-edge` profile, DevTools port 9222). The tests must
  still pass on Linux and Windows, since CI runs both.
- Failures from outside services (HTTP errors, blocked pages, bad responses) should become `EFAILED` with a
  message a person can act on. A thrown non-`TablefactsError` is a bug and is allowed to crash.
- In `research`, a failing source is a note in the report, never the end of the run.
- Prices from vision models are parsed from printed text in `raw/normalize.mjs`, never taken from the model.

## Releasing

Publishing is manual and is not part of CI. Bump `version` in `package.json`, add the entry to `CHANGELOG.md`,
commit, then run `npm publish` (`prepublishOnly` builds `types/` and runs the tests). Only do this when the user
asks.
