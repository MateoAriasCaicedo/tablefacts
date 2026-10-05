# Changelog

## 0.2.0

- The menu importers no longer write hardcoded `public.menu_*` tables. A restaurant's config (or the
  new `--table-prefix` flag) selects the prefixed table set, so several restaurants can share one
  Supabase database without touching each other's tables. The shipped Cluvi and picture configs now
  set `cannario_`/`mombasa_`, so those two commands target their prefixed tables by default.
- New safety guards before any write: the importer checks all three target tables exist, and with no
  prefix stops when another restaurant's prefixed `_menu_categories` tables are present
  (`--allow-unprefixed` overrides it for a single-restaurant database).
- `replaceAll` names the exact tables it will empty and requires `--yes`; it never runs on the
  unprefixed tables while another restaurant's tables are present. `inspect()` reports the resolved
  tables and the row counts it would delete.
- `--dry-run` runs the same checks and sends only `select`s (no write transaction).
- New options `tablePrefix`, `allowUnprefixed` and `yes` on `importMenu`/`importCluvi`/
  `importImageMenu`; new `menuTables`/`validateTablePrefix` helpers in `src/menu/lib/tables.mjs`; the
  result's `database` now carries `tables`.
- Docs recommend the Supabase **Session pooler** URL and explain the prefix convention; the full model,
  checks, errors and a migration checklist are in [`docs/MENU_TABLE_PREFIX.md`](docs/MENU_TABLE_PREFIX.md).

### Research (`tablefacts research`)

- New key-free web-search source (DuckDuckGo Lite, with the HTML endpoint as fallback). It runs only when
  Google Places and OpenStreetMap find no place or no website, and its candidate links (website, Instagram,
  TripAdvisor, Maps, link-in-bio) feed the existing "sources find each other" chain, so a bare name and place
  no longer produces an empty report.
- Instagram is read from the public share card, the web profile API and oEmbed, and its bio/counts are filled
  from a search-engine snippet when a surface answers without them. Requests identify honestly: no login and
  no user-agent impersonation; a walled profile stays blocked.
- A blocked TripAdvisor link is kept and stated at the top of the report, and its URL slug gives a name and
  location hint without fetching the page.
- The CLI summary separates facts discovered from sources, values only echoed from your input, and
  low-confidence guesses. Guesses are marked "low (guess)" and left blank in `setup-answers.txt`, so setup
  keeps the template's placeholder.
- Similar-name runs (e.g. "Makibar" vs "Maki Bar") are noted, and `.tablefacts/research/latest.json` points at
  the newest report; the pointer is only written in the default output layout.
- The report leads "Ask the client" with one prioritized next question, flattens web-sourced text so it cannot
  forge report structure, and warns when Google returns several places with the same name.
- New shared `decodeHtml` and `instagramHandle` helpers in the research lib, reused by the website reader.

## 0.1.0

First release as an npm library.

- Every tool is a function: `research`, `downloadInstagram`, `downloadTripadvisor`, `importMenu`,
  `importCluvi`, `importImageMenu`, `listMenuImages`. The `tablefacts` command is a thin wrapper over them.
- One logger contract (`log(message, level)`), an explicit `env` option, `loadEnv()` and `projectDir`.
- `TablefactsError` with codes `EUSAGE`, `ECONFIG`, `EDEPENDENCY` and `EFAILED`.
- Types generated from JSDoc (`npm run build:types`).
- Playwright is an optional peer dependency.
