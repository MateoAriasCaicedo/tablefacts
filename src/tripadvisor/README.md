# TripAdvisor photos

Downloads the photos on a restaurant's TripAdvisor page, driven by Playwright in **the user's own Edge window**. Used in step 3 of `docs/WORKFLOW.md` when the restaurant has no originals to send and the research report (`extract research`) found a TripAdvisor link.

**Rights first.** Most TripAdvisor photos were uploaded by guests, who keep the rights to them; TripAdvisor's terms also forbid scraping. Ask the restaurant for its originals first. Use these photos as reference, or only where the restaurant confirms it may use them, and say in the hand-off where each one came from.

## Status

The URL parsing, size upgrade and file naming are unit-tested (`frontend/tests/unit/tripadvisor-links.test.ts`).

**Verified once** on Maki Bar Medellín (tripadvisor.co, October 2026): Edge started by the script, no check shown, the slideshow opened and showed "1 de 16", and all 16 photos saved as valid JPEGs (originals, 100 KB to 3.7 MB); a re-run skipped all 16. **Not verified:** other country domains, restaurants with hundreds of photos, a run where the DataDome check does appear, and the English/other-language page (the selector is a `data-section-signature` attribute, not text, so it should hold). TripAdvisor changes its markup: do a `--dry-run --debug` first and fix `openGallery` and `collect` in `photos.mjs` from the saved HTML if it finds nothing or the wrong photos.

**Check the count.** The slideshow says "N de M"; the tool should report M photos. A page-wide scrape was tried first and returned 35 URLs, most from other places ("keep planning", nearby attractions, other hotels), so the tool reads only the restaurant's own carousel and slideshow.

## The browser

TripAdvisor guards its pages with DataDome. Like `extract photos instagram`, the script does not drive a browser of its own: it **attaches to an ordinary Edge window** started with remote debugging (`--cdp http://localhost:9222`, the default) and opens its own tab. If nothing is listening, it starts Edge with the profile `C:\ig-edge` (`--edge-dir` changes it), the same window `photos:instagram` uses. See [data/instagram/README.md](../instagram/README.md) for starting it by hand and its Windows notes.

Rules for agents:

- **Never try to bypass, solve or fake the check** (no stealth plugins, header tricks, solvers). The script only waits for the real page to appear (2 minutes). If a "verify you are human" box shows, **the user ticks it**. Tell them when you are waiting.
- **Never kill Edge or its processes.** Leave the window open between runs.

## Run

```bash
# list what it finds, write nothing, keep the page HTML to fix selectors
extract photos tripadvisor --dry-run --debug --out <folder> <restaurant link>

# for real
extract photos tripadvisor --out <folder> <restaurant link>
extract photos tripadvisor --out <folder> --max 30 <link> <another link>
```

| Flag | Meaning |
| --- | --- |
| `--out <folder>` | required; created if missing. Use a scratch folder outside `frontend/public`, then copy what you pick |
| `--cdp <url>` | the Edge debugging address (default `http://localhost:9222`) |
| `--edge-dir <dir>` | profile folder of the Edge it starts (default `C:\ig-edge`) |
| `--max <n>` | stop after n photos per restaurant |
| `--dry-run` | print the photo URLs found, save nothing. Do this first |
| `--debug` | save the page HTML in `<out>/_debug/<id>.html` |

The link is the restaurant's own page (`…/Restaurant_Review-g…-d…-Reviews-….html`, any country domain); the query string is dropped. Output files are `<d-id>-<photo path>-<name>.jpg`, so a re-run skips what is already there. The summary prints saved, already there and failed; the exit code is non-zero if anything failed.

## What the script does

1. Opens the restaurant page and waits for the DataDome challenge to go away (an iframe from `captcha-delivery.com`, or a page without an `h1`).
2. Clicks the first photo of the restaurant's carousel, `[data-section-signature="photo_viewer"]`, which opens the slideshow (`openGallery`).
3. Presses the right arrow key through the slideshow and, at each step, reads the big photo on screen (`visibleSlides`, then `findPhotos` for `dynamic-media-cdn.tripadvisor.com` / `media-cdn.tripadvisor.com` `/media/photo-<size>/…`). It stops after two steps with nothing new. Without a carousel it reads only that element, never the rest of the page.
4. Tries each photo's original (`photo-o`), then `photo-w`, `photo-l`, then the size the page showed (`sizeCandidates`), and saves the first that is an image over 5 KB. Reviewer avatars, maps and logos are skipped.

Only what the page loads is reachable: a restaurant with hundreds of photos may give a fraction of them.

## After the download

Look at every image. TripAdvisor mixes dishes with receipts, menus and people. Copy the chosen files into `frontend/public/<folder>` and continue with step 3 of `docs/WORKFLOW.md` (`images.ts`, then `photos.ts` with real pixel `width`/`height` and es + en `alt`).
