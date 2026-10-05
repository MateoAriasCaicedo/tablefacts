# Menu import

Scripts that read a restaurant's menu from the website that hosts it and write it into the Supabase menu tables the site reads (`menu_categories`, `menu_sections`, `menu_products`; the Cannario templates ship them as `supabase/migrations/0001_menu.sql`, and the columns written are listed in the [main README](../../README.md#supabase-tables)). One folder per source:

| Source | Folder | Status |
| --- | --- | --- |
| Cluvi (`<restaurant>.cluvi.co`) | `cluvi/` | working |
| Menu that is only pictures (one image per page) | `raw/` | working, API calls untested |

The same code is available as functions: `importCluvi`, `importImageMenu`, `listMenuImages` and `importMenu` (see the [main README](../../README.md#use-it-as-a-library)). Each source's `config.mjs` can be replaced with the `config` option, so a script can import a menu without editing the package:

```js
import { importCluvi, listMenuImages } from 'tablefacts'

await importCluvi({
  url: 'https://gaucho.cluvi.co/gaucho/maincategories',
  config: { categories: [{ slug: 'cocina', name: 'Comida', from: ['Entradas', 'Fuertes'] }], sections: {} },
  env: { SUPABASE_DB_URL: process.env.MY_DB_URL },   // keys are read from `env` (default process.env)
  dryRun: true,
  log: (message, level) => console.log(level ?? 'info', message),
})
const pictures = await listMenuImages({ urls: ['https://example.com/carta'], config: { currency: 'COP' } })
```

- **Cluvi `config`**: `{ tablePrefix?, url?, categories: [{ slug, name, from[] }], sections: { 'Cluvi subcategory': 'SECTION NAME' } }`.
- **Picture `config`**: `{ tablePrefix?, url?, currency, thousands, decimal, scale, categories: [{ slug, name, groups: ['food' | 'drink'] }], placeIn, sections, skipSections }`. `currency` is required.
- **Options every import takes**: `dryRun`, `json` (relative paths resolve against `projectDir`), `tablePrefix` (overrides the config's; the restaurant's table set on a shared database), `allowUnprefixed` (override the shared-database check and write the unprefixed `menu_*` tables, only when this restaurant owns them), `replaceAll`, `yes` (confirms a whole-menu `replaceAll`), `force`, `databaseUrl` (default `env.SUPABASE_DB_URL`), `env`, `projectDir` and `log(message, level)` (`'info'`, `'warn'` for notes, `'error'`).
- **Result**: `{ totals, notes, written, dryRun, database }`; `database` is `{ label, tables, current: { categories, products, kept } }` once the database was inspected, and `null` when it was not reached (a dry run without a URL).
- **Errors** are `TablefactsError`: `ECONFIG` (no URL, unknown provider, no key, bad currency, a bad `tablePrefix`, another restaurant's tables on an unprefixed import), `EFAILED` (invalid menu, no products, import refused without `force`), `EUSAGE` (bad `only`, `replaceAll` without `yes`). `err.option` names the option; the CLI shows the flag (`--force`, `--only`) and exits `2` for `EUSAGE`, `1` otherwise.

## Setup

1. Install the package in the project (`npm install --save-dev tablefacts`); it brings `pg`. Run the commands from the project's folder.
2. Apply the migration to your Supabase project.
3. `cp .env.example .env` and set `SUPABASE_DB_URL` to the pooler URL from the Supabase dashboard (Connect > **Session pooler**), with the real password. Use the Session pooler, not the Transaction pooler: the importer holds one connection and reads `information_schema`. On a shared database, also set `tablePrefix` in the source's `config.mjs` (below).

`SUPABASE_DB_URL` bypasses row level security. It stays in `.env` (git-ignored). Never copy it into a browser-exposed variable (such as `NEXT_PUBLIC_*`): the site only uses the publishable key.

## Shared database

Several restaurants can live in one Supabase project. Each then owns prefixed tables — `cannario_menu_*`,
`mombasa_menu_*`, `makibar_menu_*` — and the unprefixed `menu_*` tables belong to a different, older site.
Set the restaurant's `tablePrefix` in its `config.mjs`, or pass `--table-prefix <prefix>` for one run (the
flag wins). The prefix may be empty, or lowercase letters, digits and underscores ending in `_`.

Before any write the importer:

- checks all three prefixed tables exist, or stops naming the missing ones and the migration to apply;
- with **no prefix**, lists the `public` tables ending in `_menu_categories` and, if another restaurant's set
  is there, stops with an `ECONFIG` error that names them — rather than guessing which tables are yours.
  `--allow-unprefixed` overrides that check only when this restaurant owns the unprefixed tables;
- prints the resolved table names and the row counts it would delete, and refuses `--replace-all` without
  `--yes`. A whole-menu replace never runs on the unprefixed tables while another restaurant's tables exist.

`--dry-run` runs all of these checks and prints what would be written, but only sends `select`s (no `begin`).

The full model — prefix rules, every check, the error codes and a migration checklist — is in
[docs/MENU_TABLE_PREFIX.md](../../docs/MENU_TABLE_PREFIX.md).

## Run (Cluvi)

```bash
tablefacts menu cluvi --dry-run                     # extract and check, show what would change, write nothing
tablefacts menu cluvi                               # replace this restaurant's menu in Supabase
tablefacts menu cluvi <menu-url>                    # another restaurant
tablefacts menu cluvi --table-prefix makibar_       # override the config's table prefix for one run
tablefacts menu cluvi --replace-all --yes           # empty this restaurant's tables first, then write
tablefacts menu cluvi --allow-unprefixed            # the unprefixed menu_* tables (single-restaurant database only)
tablefacts menu cluvi --help
```

Edit `cluvi/config.mjs` first: the menu URL, how Cluvi's main categories fold into the site's categories, and section renames. The run prints what the site still needs (dictionary keys, `content/qr.ts`).

## Run (menu that is only pictures)

For a restaurant whose site shows the menu as a gallery of page images, such as <https://www.mombasa.co/carta-restaurante-espanol/>. Each page is transcribed by a vision model from one of three providers, so it needs that provider's key in `.env`:

| `--provider` | Key in `.env` | Default `--model` |
| --- | --- | --- |
| `anthropic` (default) | `ANTHROPIC_API_KEY` | `claude-sonnet-5-5` |
| `gemini` | `GEMINI_API_KEY` | `gemini-3.8-flash` |
| `groq` | `GROQ_API_KEY` | `qwen/qwen3.8-27b` |

Choose the provider per run with `--provider`, or once for every run with `MENU_VISION_PROVIDER` in `.env`.

```bash
tablefacts menu raw --list                 # show the pictures found; no key needed, nothing read or written
tablefacts menu raw --dry-run              # read the pages, show the menu and the checks, write nothing
tablefacts menu raw --only 3,9 --dry-run   # try two pages first
tablefacts menu raw --provider gemini --dry-run   # the same, read by Gemini
tablefacts menu raw                           # replace this restaurant's menu in Supabase
tablefacts menu raw <page-or-image-url>... # another restaurant
tablefacts menu raw --table-prefix makibar_ # override the config's table prefix for one run
tablefacts menu raw --replace-all --yes     # empty this restaurant's tables first, then write
```

Edit `raw/config.mjs` first: the URL, the currency, how the menu prints prices (`$95.000` is `thousands: "."`, `decimal: ","`) and which category each section goes to.

- `raw/source.mjs` takes the large JPG/PNG/WebP images of the page in document order (full size, not the thumbnails; logos and icons are skipped by width) and downloads them. A site that builds its gallery with JavaScript shows up as "no images": pass the image URLs instead.
- `raw/vision.mjs` has the model transcribe each page into sections and dishes with one request: a forced tool call for Anthropic, JSON held to the same schema for Gemini (`generateContent`) and Groq (strict structured output), so every provider hands back the same shape. Prices come back as printed text and `raw/normalize.mjs` parses them, so a thousands separator is never guessed by the model. Adding a provider is one more entry in `providers` there.
- Groq serves a single vision model, `qwen/qwen3.8-27b`, and it is a preview one: if Groq retires it, pass its successor with `--model`.
- Rate limits (HTTP 429) are retried after the wait the service asks for, up to a minute; for a longer wait the run stops with the service's message. Pages already read are saved (below), so run it again later.
- The model tags each section food, drink or other; `config.categories` maps those to the site's categories. A section with no heading continues the one before it, even across pages. A dish with several price columns (bottle and glass) becomes one product per column, "Name (Botella)".
- Each page's transcription is saved in `<project>/.tablefacts/cache/<host>/<id>.json` (git-ignored) and reused on the next run, so re-running costs nothing. Edit a file there to fix a misread page; `--refresh` reads everything again. The saved pages are shared by all providers, so after switching provider or model, add `--refresh` or the pages already read are reused.
- **Read the dry run against the pictures before writing.** The model can misread small print, and a wrong price is worse than a missing dish. Pages it was unsure of are listed in the notes. There are no dish photos, so `image_url` is empty.

## What it does (Cluvi)

- Cluvi main category > site category, subcategory > section (name in UPPERCASE), product > product. Products keep the order Cluvi shows (its `order` field). Cluvi's "important" flag is `recommended`. Descriptions are converted from HTML to text.
- The write is one transaction. By default only the categories in the import are replaced (their sections and products with them), so re-running never duplicates. `--replace-all` empties the whole menu first, which also removes the template's sample categories; it needs `--yes` and is refused when it would empty the unprefixed tables on a shared database.
- It refuses an import with no products, or with under half the products it replaces (`--force` overrides), so a broken extraction cannot empty the menu.
- Photos stay on Cluvi's CDN: `image_url` holds the Cluvi URL, and your site must allow `images.cluvi.com` and `images-mini.cluvi.com` as image hosts (a template with `menuImageHosts` in `frontend/src/content/site.ts` gets a warning from the run when they are missing). If the restaurant leaves Cluvi, the photos must be re-hosted (Supabase Storage needs a different credential than the DB URL).

## Known limits

- Cluvi has no public API. `cluvi/source.mjs` calls the two JSON endpoints its web app calls; if they change, that file is the one to fix.
- Products with options (add-ons, sizes) import their base price only. Products Cluvi hides the price of (price 0) import as 0 and the site shows 0.
- The Supabase pooler's certificate is not trusted by Node, so the connection is encrypted but the certificate is not verified unless `sslmode` is in the URL.
- Dish names and descriptions are not translated, as elsewhere in the site.

## Adding a source

Create `src/menu/<source>/` with a script that calls `runImport` from `lib/run.mjs` and returns the menu in the shape described in `lib/menu.mjs`. The flags, checks and the database write are shared. If the source's photos stay on its own CDN, allow that host in your site's image settings.
