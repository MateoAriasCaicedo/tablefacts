# Restaurant research

Give it a name and a place, it reads the public web and writes what the template needs.

```bash
tablefacts research "Casa Luna" "Medellín, Colombia" --country CO
tablefacts research "Casa Luna" "Medellín" --website https://casaluna.co --instagram casaluna --photos 6
```

Output goes to `.tablefacts/research/<slug>/` (git-ignored, it holds third-party data):

| File | What it is |
| --- | --- |
| `report.md` | Read first. Facts table in BRIEF.md's order (value, source, confidence, where it goes), disagreements, hours as `hoursRows` for both languages, links (menu, delivery, hub), material for the copy, what to ask the client |
| `profile.json` | The same with provenance, plus each source's raw result |
| `setup-answers.txt` | One line per prompt of `npm run setup`, in prompt order through the menu language; blank keeps the placeholder |
| `photos/` | Only with `--photos n`. Reference, not assets: ask the client for originals |

From code, `research()` returns the same data (`profile`, `notes`, `photos`, `outDir`, `files`, the paths absolute);
see the [main README](../../README.md#use-it-as-a-library). `out` (relative paths resolve against `projectDir`),
`projectDir`, `env` (where `GOOGLE_PLACES_API_KEY` is read from, `process.env` by default), `googleKey` and
`log(message, level)` are options; it is silent without `log`. A missing `name` throws a `TablefactsError`
(`EUSAGE`, `err.option === 'name'`; the CLI exits `2`). A source that fails never throws: it is a note in the report.

## Sources

| Source | Gives | Notes |
| --- | --- | --- |
| Google Maps (Places API) | address, map point, phone, hours, price, cuisine types, photos, status | Needs `GOOGLE_PLACES_API_KEY` in `.env` (Places API (New) enabled). Phone and hours fields are billed at the Enterprise rate; one search per run |
| OpenStreetMap (Nominatim) | address, map point, sometimes phone, hours, website, socials | No key. Often stale or sparse |
| Web search (DuckDuckGo) | candidate website, Instagram, TripAdvisor, Maps and hub links | No key. Runs only when Google and OpenStreetMap find no place or no website, so the reported "name-only finds nothing" case now has a fallback |
| Website | JSON-LD, contact page, WhatsApp, reserve platform, menu links, images, logo, theme colour, page text | Falls back to Playwright on 403 or client-rendered pages (`--render` forces it) |
| Instagram | handle, followers, bio, bio link | Tries the public share card, the web profile API, oEmbed and finally a search-engine snippet of the bio. Requests identify honestly and never log in; often all surfaces are walled |
| TripAdvisor | JSON-LD (address, phone, cuisine, price, rating) | Usually bot-blocked. Playwright is tried on a 403 or a thin page like any website, but DataDome still wins. The name and city are read from the URL slug without fetching, and the link is kept for a manual read (stated at the top of the report) |
| Linktree and similar | WhatsApp, reserve, menu, delivery links | Found from the website, Instagram bio or `--linktree` |

Sources find each other (web search or website → Instagram, TripAdvisor, hub). Order of trust per field is in `lib/merge.mjs`; two sources agreeing is "high", one is "medium", a guess is "low".

## How it runs

- **Concurrent lookups.** Google and OpenStreetMap run together; then the website is read. Instagram, TripAdvisor and
  the link-in-bio page start as soon as their address is known (given, or found on the website or web search), so a slow
  source does not hold up the others. Report notes keep a fixed order whatever finishes first. Photo downloads run four at a time.
- **Web-search fallback.** When Google and OpenStreetMap find no place or no website, a key-free DuckDuckGo query
  runs and its candidate links feed the rest of the pipeline. It is one extra request, only when it is needed.
- **One shared browser.** Playwright's Chromium is launched at most once per run, only when a page needs rendering
  (`--render`, a 403, a client-rendered page), is shared by the website, TripAdvisor and link-in-bio readers, and is
  closed at the end even on failure.
- **Fetch cap.** Pages are read up to 2 MB each; larger bodies are truncated, so a huge page cannot exhaust memory.

## Runs and re-runs

Output goes to `.tablefacts/research/<slug>/`; two spellings of the same name ("Makibar" and "Maki Bar") make two
folders. A similar-name run is noted in the report, and `.tablefacts/research/latest.json` always points at the newest
report, so reading every folder cannot resurface a stale one.

## Limits

- It does not log in anywhere or get past bot protection. A blocked source is reported, not worked around.
- It finds facts, not copy, logos or licensed photos.
- A wrong match (a sister branch, a closed place) is the main risk: read the Warnings and "Sources disagree" first. When Google returns several places with the same name, the report says so and asks which branch.
- Only public surfaces are tried for Instagram/TripAdvisor. When they are walled, the report keeps the link and says so at the top; it does not defeat the wall.

## For agents

Use it first, whenever you are given only a restaurant's name and place (or little else). If Google and OpenStreetMap find no place or no website, a key-free web search runs automatically, so a name-only call is no longer an empty report.

1. **Run it** from the repo root: `tablefacts research "<name>" "<city, country>" --country <ISO>`. Add `--website`, `--instagram`, `--tripadvisor` or `--linktree` for anything the user gave you; a user-supplied value is trusted over a search result. Uploading a Google Maps link as `--website` (or pasting it in the report as `mapsUrl`) unlocks coordinates; ask for it first when the report is thin. It takes under a minute, needs no prompts and prints the output folder.
2. **Read `out/<slug>/report.md`**, in this order: the kept-links notice and Warnings, "What each source did", Facts, "Sources disagree", "Ask the client". Confirm the match is the right restaurant (name, address, not closed) before using anything. If it matched the wrong place, rerun with a more specific location or `--website`.
3. **Treat every value as unconfirmed.** Fill `BRIEF.md` with the value and its source, never as client-confirmed. Anything under "not found" stays a placeholder and goes in your hand-off as an open question. Do not invent it.
4. **Apply the facts**: review `setup-answers.txt`, run `npm run setup < .tablefacts/research/<slug>/setup-answers.txt`, read `git diff`. A low-confidence guess (marked "low (guess)") is left blank so setup keeps the template's placeholder; it is never written in as a fact. The answers file covers the tagline's first language (from `descriptor`; translate it yourself for the second language), `phone` (left blank when it is the WhatsApp number, which the template hides), `email` and the menu language. Still take from the report by hand: the tagline's second language, `visit.hoursRows` (ready to paste) and the `jsonld.ts` fields. Add street, phone and hours to `jsonld.ts` only for values the client confirmed.
5. **Use the leads**: a Cluvi menu link means `tablefacts menu cluvi`, a PDF means `tablefacts menu raw` (`src/menu/README.md`). The theme colour and logo candidates are hints for `tokens.css` and `public/logo.svg`, not decisions.
6. **Blocked sources** (Instagram, TripAdvisor) are normal. The top of the report names any link that was kept unread; open it yourself, or ask the user for the bio and hours. Do not try to get around a login wall. `.tablefacts/research/latest.json` points at the newest run when the same place was researched under a different spelling.

`profile.json` has the same data as JSON for scripting: `fields.<name>` is `{ value, source, confidence, alternatives? }`, `hours.rows.{es,en}` are `hoursRows`, and `raw` holds each source's untouched result (including `search`). Field names: `name street locality region country coordinates phone whatsapp email instagram facebook tiktok tripadvisor website reserveUrl priceRange mapsUrl descriptor cuisines menuLocale`.

Do not commit `out/`, and never paste the Google key anywhere but `.env`. Photos it downloads belong to the restaurant or the photographer: use them as reference, not as site assets.

Code map: `research.mjs` runs the sources in order and writes the files; `lib/google.mjs`, `osm.mjs`, `search.mjs`, `website.mjs`, `social.mjs` read one source each; `merge.mjs` holds the per-field trust order; `hours.mjs` normalises hours; `report.mjs` writes the report and the setup answers. A new source is a reader returning plain data, a line in `research.mjs` and its candidates in `merge.mjs`.
