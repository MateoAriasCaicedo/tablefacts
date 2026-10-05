# Photo quality: what the Instagram and TripAdvisor tools save

A review of whether `tablefacts photos instagram` and `tablefacts photos tripadvisor` extract the highest
quality images available. **No code was changed by this review** — it records what was checked, the live
evidence, and the gaps that remain. Commands: see [main README](../README.md#command-line); per-tool detail:
[src/instagram/README.md](../src/instagram/README.md) and [src/tripadvisor/README.md](../src/tripadvisor/README.md).

## Summary

| Source | What it saves | Quality | Verified live? |
| --- | --- | --- | --- |
| TripAdvisor | The **original** (`photo-o`) when available, otherwise the next size down | Maximal | Yes — see below |
| Instagram | Exactly what toolzu's Download button returns, unmodified | Instagram's public maximum (~1080 px) | No — blocked by Cloudflare; needs a person to tick the check |

## TripAdvisor

### How a size is chosen

- `findPhotos` ([`src/tripadvisor/links.mjs:51`](../src/tripadvisor/links.mjs)) records one entry per photo and
  discards whichever size the page happened to show.
- `sizeCandidates` ([`:63`](../src/tripadvisor/links.mjs)) rebuilds candidate URLs **biggest first**:
  `photo-o` (original) → `photo-w` → `photo-l` → the page's own size.
- `save` ([`src/tripadvisor/index.mjs:81`](../src/tripadvisor/index.mjs)) tries them in order and keeps the first
  that is an image over `MIN_BYTES` (5 KB, [`:13`](../src/tripadvisor/index.mjs)).

TripAdvisor's own content API confirms the ladder: Small = 150 px, Medium = 250 px, **Large = 550 px max**,
and **Original = the image at its original resolution as uploaded**. So original-first is the right order.

### Live verification

Target: **Mombasa Restaurante Medellín** (`d26866710`), ~290 food photos, in a real Edge window.

```bash
tablefacts photos tripadvisor --out <scratch> --max 40 "<restaurant link>"
```

| Metric | Result |
| --- | --- |
| Downloads | 40/40 saved, 0 failed |
| Largest | 5472×3648 (~20 MP) |
| Other common sizes | 3024×4032 ×13, 4284×5712 ×5, 1536×2048 ×5, 1080×1350 ×6 |
| Files under 1000 px wide | 0 |
| Largest file | ~2.4 MB |

**Verdict: maximal.** The originals are being fetched (far beyond the 550 px Large cap) and nothing silently
fell back to a smaller size on this run.

### Caveats found

- **Silent fallback.** If `photo-o` is unavailable, `save` drops to `w`/`l` and still counts the photo as saved;
  nothing tells the caller a smaller size was used.
- **Cold-start flake.** The first run against a freshly started Edge returned only **1** photo: the slideshow had
  not settled, so `collect` ([`src/tripadvisor/index.mjs:60`](../src/tripadvisor/index.mjs)) saw no new slide
  twice in a row and stopped early. A re-run returned the rest. The tool's own "Check the count" warning covers
  this, but run twice (or with `--debug`) if the count looks low.
- **Only what the page loads is reachable**, so a huge gallery may yield a fraction.

## Instagram

### How it works

- It does not rewrite URLs: it saves exactly what toolzu's card Download button returns, via `saveByClick`
  ([`src/instagram/index.mjs:183`](../src/instagram/index.mjs)) or the no-button fallback `saveUrl` ([`:212`](../src/instagram/index.mjs)).
- Instagram keeps and serves photos at a maximum width of **1080 px** (up to 1080×1440 at 4:5) from a public
  page. toolzu advertises original quality; the [tool README](../src/instagram/README.md) previously verified
  ~1080 px. True originals larger than that are only reachable from the owner's own data export, which the README
  already recommends.

### Live verification — blocked

Three attempts (direct, `--google`, retry) all ended with:

```
the Cloudflare check was not passed (use `cdp` with your own browser, or solve it by hand)
```

This is deliberate: the tool only **waits** for toolzu's Turnstile check and never fakes or solves it. Live
verification therefore requires a person to tick the box in the Edge window. Not completed.

### Code-level gaps (not fixed)

- **No minimum-size floor.** Instagram calls `assertImageResponse` without `minBytes`
  ([`:208`](../src/instagram/index.mjs)), unlike TripAdvisor's 5 KB. A silent downgrade to a thumbnail would be
  saved without complaint.
- **Extension always `.jpg`.** Files are named `.jpg` ([`:314`](../src/instagram/index.mjs),
  [`:343`](../src/instagram/index.mjs)) even when the bytes are PNG or WebP. TripAdvisor preserves the real
  extension via `fileName` ([`src/tripadvisor/links.mjs:72`](../src/tripadvisor/links.mjs)).
- **Fallback fetch has no cookies.** `saveUrl` uses plain `fetch`; a signed CDN URL that needs the browser
  session fails (reported as a failure, not silently degraded).

## Re-running the check

1. Run each tool into a scratch folder outside the repo, e.g. `<scratch>`:

   ```bash
   tablefacts photos tripadvisor --out <scratch>/ta --max 40 "<restaurant link>"
   tablefacts photos instagram   --out <scratch>/ig "<post link>"
   ```

2. Read the pixel dimensions and byte sizes of the saved files (any image metadata reader works — ImageMagick's
   `identify`, `exiftool`, or a small script). For TripAdvisor, confirm **no file is 550 px wide** (the Large
   fallback); for Instagram, confirm ~1080 px wide.

## Recommendation

TripAdvisor already extracts originals; the only worthwhile hardening is making a fallback off `photo-o` visible
and logging the size used. Instagram is at the platform ceiling but has no size floor and mislabels non-JPEG
bytes. These are small, separate changes — not applied here.
