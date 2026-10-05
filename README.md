# extract

Data extraction tools for restaurant sites, shared by every Cannario template.

| Command | What it does |
| --- | --- |
| `extract research "<name>" "<city>"` | Gathers a restaurant's public facts into a report ([docs](src/research/README.md)) |
| `extract photos instagram` | Downloads photos from Instagram posts or a profile ([docs](src/instagram/README.md)) |
| `extract photos tripadvisor` | Downloads the photos of a TripAdvisor restaurant page ([docs](src/tripadvisor/README.md)) |
| `extract menu cluvi` / `extract menu raw` | Imports a menu into the Supabase tables ([docs](src/menu/README.md)) |

Run any command with `--help` for its options.

## Use it from a template

```bash
npm install --save-dev github:<owner>/extract   # or: npm install --save-dev ../extract
npx extract research "Gaucho" "Medellín, Colombia"
```

The tools work on **the project in the current folder** (or the one in `EXTRACT_PROJECT`), never on the
folder extract is installed in:

- `.env` is read from the project root (then `data/.env`, for older templates). See [.env.example](.env.example).
- Output, caches and browser profiles go under `<project>/.extract/`. Git-ignore it.
- `extract menu` reads the template's `frontend/src/content` for hints, and skips them if it isn't there.

## Develop

```bash
npm install
npm test        # no network, database or browser is used
```

The photo tools drive your own Edge window and need your help with a bot check; read the tool's README first.
Only download photos the restaurant owns or has allowed you to use.
