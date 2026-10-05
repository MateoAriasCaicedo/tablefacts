// Places the product photos found on a menu page onto the products read from it.
//
// Two page kinds feed this:
//   - a digital PDF page: pdf.mjs reports where each image sits on the page
//     (`placed` crops with a rectangle), and the product's name is found among
//     the page's text items to pick the nearest photo;
//   - a scanned page: the vision model was asked for each item's photo box
//     (`direct` crops already tied to an item name).
//
// Matching is pure, so it is tested with made-up pages; raw/import.mjs saves the
// crops and turns them into `image_url`s.
import { matchKey } from "../lib/menu.mjs";

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The gap between two rectangles, 0 when they touch or overlap. */
const gap = (a, b) => {
  const dx = Math.max(a.x0 - b.x1, b.x0 - a.x1, 0);
  const dy = Math.max(a.y0 - b.y1, b.y0 - a.y1, 0);
  return Math.hypot(dx, dy);
};

const listShort = (names) => names.slice(0, 6).join(", ") + (names.length > 6 ? `, and ${names.length - 6} more` : "");

const textRect = (item) => ({
  x0: item.x ?? 0,
  y0: item.y ?? 0,
  x1: (item.x ?? 0) + Math.abs(item.width ?? 0),
  y1: (item.y ?? 0) + Math.abs(item.height ?? 0),
});

/**
 * The page's text item that best matches `name`: an exact match first, then a
 * line that contains it (preferring the shortest such line). null when no line
 * holds the name, which happens when a heading was drawn as an outline.
 */
export function findNameItem(items, name) {
  const wanted = matchKey(name);
  if (!wanted) return null;
  // Whole words only, so "Ana" does not match inside "Banana".
  const bounded = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(wanted)}(?=$|[^\\p{L}\\p{N}])`, "u");
  let best = null;
  for (const item of items ?? []) {
    const key = matchKey(item.str);
    const exact = key === wanted;
    const contains = !exact && bounded.test(key);
    if (!exact && !contains) continue;
    const score = exact ? -1 : key.length;
    if (!best || score < best.score) best = { item, score };
  }
  return best?.item ?? null;
}

/**
 * One crop per product, in page order. `pages` maps a page number to
 * `{ width, items, placed, direct }` (see the file comment). A crop is used
 * once, so a single photo between two items goes to the closer one. Returns
 * `{ matches, notes }`; matches carry the placement and the crop it won.
 * @param {{ page: number, name: string, box: number[] | null, products: any[] }[]} placements
 * @param {Map<number, any>} pages
 * @returns {{ matches: { placement: any, crop: any }[], notes: string[] }}
 */
export function matchPlacements(placements, pages) {
  const notes = [];
  const matches = [];
  const used = new Set();
  const ambiguous = [];

  for (const placement of placements) {
    const page = pages.get(placement.page);
    if (!page) continue;
    let crop = null;

    // A scanned page already tied each crop to the model's item name.
    const direct = (page.direct ?? []).filter((c) => !used.has(c.id));
    if (direct.length) crop = direct.find((c) => matchKey(c.name) === matchKey(placement.name)) ?? null;

    if (!crop && (page.placed ?? []).length) {
      const item = findNameItem(page.items, placement.name);
      if (item) {
        const rect = textRect(item);
        const limit = (page.width ?? 0) * 0.2; // a photo farther than a fifth of the page is not this item's
        const ranked = (page.placed ?? [])
          .filter((c) => !used.has(c.id))
          .map((c) => ({ c, d: gap(rect, c.rect) }))
          .sort((a, b) => a.d - b.d);
        if (ranked.length && ranked[0].d <= limit) {
          crop = ranked[0].c;
          // A near tie means the same photo could belong to either item: say so.
          if (ranked[1] && ranked[0].d > 0 && Math.abs(ranked[1].d - ranked[0].d) < (page.width ?? 0) * 0.01) {
            ambiguous.push(`${placement.name} (page ${placement.page})`);
          }
        }
      }
    }

    if (crop) {
      used.add(crop.id);
      matches.push({ placement, crop });
    }
  }

  // A dish without a photo is normal; only a photo with no dish is worth saying.
  const allCrops = [...pages.values()].flatMap((page) => [...(page.placed ?? []), ...(page.direct ?? [])]);
  const unused = allCrops.filter((crop) => !used.has(crop.id));
  if (unused.length) notes.push(`${unused.length} printed photo(s) could not be matched to an item and were left out.`);
  if (ambiguous.length) notes.push(`A printed photo sat between items and may be attached to the wrong one: ${listShort(ambiguous)}.`);
  return { matches, notes };
}
