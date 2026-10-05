# Restaurant research

Give it a name and a place, it reads the public web and writes what the template needs.

```bash
extract research "Casa Luna" "Medellín, Colombia" --country CO
extract research "Casa Luna" "Medellín" --website https://casaluna.co --instagram casaluna --photos 6
```

Output goes to `.extract/research/<slug>/` (git-ignored, it holds third-party data):

| File | What it is |
| --- | --- |
| `report.md` | Read first. Facts table in BRIEF.md's order (value, source, confidence, where it goes), disagreements, hours as `hoursRows` for both languages, links (menu, delivery, hub), material for the copy, what to ask the client |
| `profile.json` | The same with provenance, plus each source's raw result |
| `setup-answers.txt` | One line per prompt of `npm run setup`; blank keeps the placeholder |
| `photos/` | Only with `--photos n`. Reference, not assets: ask the client for originals |

## Sources

| Source | Gives | Notes |
| --- | --- | --- |
| Google Maps (Places API) | address, map point, phone, hours, price, cuisine types, photos, status | Needs `GOOGLE_PLACES_API_KEY` in `.env` (Places API (New) enabled). Phone and hours fields are billed at the Enterprise rate; one search per run |
| OpenStreetMap (Nominatim) | address, map point, sometimes phone, hours, website, socials | No key. Often stale or sparse |
| Website | JSON-LD, contact page, WhatsApp, reserve platform, menu links, images, logo, theme colour, page text | Falls back to Playwright on 403 or client-rendered pages (`--render` forces it) |
| Instagram | handle, followers, bio, bio link | Public share card only. Usually login-walled |
| TripAdvisor | JSON-LD (address, phone, cuisine, price, rating) | Usually bot-blocked: the link is kept for a manual read |
| Linktree and similar | WhatsApp, reserve, menu, delivery links | Found from the website, Instagram bio or `--linktree` |

Sources find each other (website → Instagram, TripAdvisor, hub). Order of trust per field is in `lib/merge.mjs`; two sources agreeing is "high", one is "medium", a guess is "low".

## Limits

- It does not log in anywhere or get past bot protection. A blocked source is reported, not worked around.
- It finds facts, not copy, logos or licensed photos.
- A wrong match (a sister branch, a closed place) is the main risk: read the Warnings and "Sources disagree" first.

## For agents

Use it first, whenever you are given only a restaurant's name and place (or little else).

1. **Run it** from the repo root: `extract research "<name>" "<city, country>" --country <ISO>`. Add `--website`, `--instagram`, `--tripadvisor` or `--linktree` for anything the user gave you; a user-supplied value is trusted over a search result. It takes under a minute, needs no prompts and prints the output folder.
2. **Read `out/<slug>/report.md`**, in this order: Warnings, "What each source did", Facts, "Sources disagree". Confirm the match is the right restaurant (name, address, not closed) before using anything. If it matched the wrong place, rerun with a more specific location or `--website`.
3. **Treat every value as unconfirmed.** Fill `BRIEF.md` with the value and its source, never as client-confirmed. Anything under "not found" stays a placeholder and goes in your hand-off as an open question. Do not invent it.
4. **Apply the facts**: review `setup-answers.txt`, run `npm run setup < .extract/research/<slug>/setup-answers.txt`, read `git diff`. Setup does not cover `phone`, `email`, `MENU_LOCALE`, `brand.tagline`, `visit.hoursRows` or `jsonld.ts`: take those from the report by hand. Hours are ready to paste. Add street, phone and hours to `jsonld.ts` only for values the client confirmed.
5. **Use the leads**: a Cluvi menu link means `extract menu cluvi`, a PDF means `extract menu raw` (`src/menu/README.md`). The theme colour and logo candidates are hints for `tokens.css` and `public/logo.svg`, not decisions.
6. **Blocked sources** (Instagram, TripAdvisor) are normal. Open the link yourself, or ask the user for the bio and hours. Do not try to get around a login wall.

`profile.json` has the same data as JSON for scripting: `fields.<name>` is `{ value, source, confidence, alternatives? }`, `hours.rows.{es,en}` are `hoursRows`, and `raw` holds each source's untouched result. Field names: `name street locality region country coordinates phone whatsapp email instagram facebook tiktok tripadvisor website reserveUrl priceRange mapsUrl descriptor cuisines menuLocale`.

Do not commit `out/`, and never paste the Google key anywhere but `.env`. Photos it downloads belong to the restaurant or the photographer: use them as reference, not as site assets.

Code map: `research.mjs` runs the sources in order and writes the files; `lib/google.mjs`, `osm.mjs`, `website.mjs`, `social.mjs` read one source each; `merge.mjs` holds the per-field trust order; `hours.mjs` normalises hours; `report.mjs` writes the report and the setup answers. A new source is a reader returning plain data, a line in `research.mjs` and its candidates in `merge.mjs`.
