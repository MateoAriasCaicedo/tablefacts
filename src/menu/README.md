# Menu import

Scripts that read a restaurant's menu from the website that hosts it and write it into the Supabase menu tables the site reads (`data/supabase/migrations/0001_menu.sql`). One folder per source:

| Source | Folder | Status |
| --- | --- | --- |
| Cluvi (`<restaurant>.cluvi.co`) | `cluvi/` | working |
| Menu that is only pictures (one image per page) | `raw/` | working, API calls untested |
| Eazzy | `eazzy/` | empty |

## Setup

1. `npm install` in the repo root (installs `pg`).
2. Apply the migration to your Supabase project.
3. `cp .env.example .env` and set `SUPABASE_DB_URL` to the pooler URL from the Supabase dashboard (Connect > Transaction pooler), with the real password.

`SUPABASE_DB_URL` bypasses row level security. It stays in `.env` (git-ignored). Never copy it into `frontend/.env` or a `NEXT_PUBLIC_` variable: the site only uses the publishable key.

## Run (Cluvi)

```bash
extract menu cluvi --dry-run        # extract and check, show what would change, write nothing
extract menu cluvi                     # replace the menu in Supabase
extract menu cluvi <menu-url>       # another restaurant
extract menu cluvi --help
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
extract menu raw --list                 # show the pictures found; no key needed, nothing read or written
extract menu raw --dry-run              # read the pages, show the menu and the checks, write nothing
extract menu raw --only 3,9 --dry-run   # try two pages first
extract menu raw --provider gemini --dry-run   # the same, read by Gemini
extract menu raw                           # replace the menu in Supabase
extract menu raw <page-or-image-url>... # another restaurant
```

Edit `raw/config.mjs` first: the URL, the currency, how the menu prints prices (`$95.000` is `thousands: "."`, `decimal: ","`) and which category each section goes to.

- `raw/source.mjs` takes the large JPG/PNG/WebP images of the page in document order (full size, not the thumbnails; logos and icons are skipped by width) and downloads them. A site that builds its gallery with JavaScript shows up as "no images": pass the image URLs instead.
- `raw/vision.mjs` has the model transcribe each page into sections and dishes with one request: a forced tool call for Anthropic, JSON held to the same schema for Gemini (`generateContent`) and Groq (strict structured output), so every provider hands back the same shape. Prices come back as printed text and `raw/normalize.mjs` parses them, so a thousands separator is never guessed by the model. Adding a provider is one more entry in `providers` there.
- Groq serves a single vision model, `qwen/qwen3.8-27b`, and it is a preview one: if Groq retires it, pass its successor with `--model`.
- Rate limits (HTTP 429) are retried after the wait the service asks for, up to a minute; for a longer wait the run stops with the service's message. Pages already read are saved (below), so run it again later.
- The model tags each section food, drink or other; `config.categories` maps those to the site's categories. A section with no heading continues the one before it, even across pages. A dish with several price columns (bottle and glass) becomes one product per column, "Name (Botella)".
- Each page's transcription is saved in `raw/.cache/<host>/<id>.json` (git-ignored) and reused on the next run, so re-running costs nothing. Edit a file there to fix a misread page; `--refresh` reads everything again. The saved pages are shared by all providers, so after switching provider or model, add `--refresh` or the pages already read are reused.
- **Read the dry run against the pictures before writing.** The model can misread small print, and a wrong price is worse than a missing dish. Pages it was unsure of are listed in the notes. There are no dish photos, so `image_url` is empty.

## What it does (Cluvi)

- Cluvi main category > site category, subcategory > section (name in UPPERCASE), product > product. Products keep the order Cluvi shows (its `order` field). Cluvi's "important" flag is `recommended`. Descriptions are converted from HTML to text.
- The write is one transaction. By default only the categories in the import are replaced (their sections and products with them), so re-running never duplicates. `--replace-all` replaces the whole menu, which also removes the template's sample categories.
- It refuses an import with no products, or with under half the products it replaces (`--force` overrides), so a broken extraction cannot empty the menu.
- Photos stay on Cluvi's CDN: `image_url` holds the Cluvi URL, and `menuImageHosts` in `frontend/src/content/site.ts` must list `images.cluvi.com` and `images-mini.cluvi.com` (the run warns when it does not). If the restaurant leaves Cluvi, the photos must be re-hosted (Supabase Storage needs a different credential than the DB URL).

## Known limits

- Cluvi has no public API. `cluvi/source.mjs` calls the two JSON endpoints its web app calls; if they change, that file is the one to fix.
- Products with options (add-ons, sizes) import their base price only. Products Cluvi hides the price of (price 0) import as 0 and the site shows 0.
- The Supabase pooler's certificate is not trusted by Node, so the connection is encrypted but the certificate is not verified unless `sslmode` is in the URL.
- Dish names and descriptions are not translated, as elsewhere in the site.

## Adding a source

Create `src/menu/<source>/` with a script that calls `runImport` from `lib/run.mjs` and returns the menu in the shape described in `lib/menu.mjs`. The flags, checks and the database write are shared. Add the source's image CDN to `menuImageHosts` in `frontend/src/content/site.ts`.
