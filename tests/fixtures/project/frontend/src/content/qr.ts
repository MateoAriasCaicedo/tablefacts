import { images } from "./images";
import type { Locale } from "./site";

/**
 * Routes of the QR menu, in the order a guest moves through them:
 *
 *   landing   /es/qr                a photograph and one button
 *   index     /es/qr/carta          one row per category
 *   category  /es/qr/comida         the products, grouped by section
 *
 * The slugs are translated, so `/es/qr/comida` and `/en/qr/food` are the same
 * page. Every link, the language switch and the sitemap build their URLs from
 * the helpers here and never concatenate a slug by hand.
 *
 * Importable from anywhere (no `server-only`): the sitemap uses it too.
 */

export const qrIndexSlug: Record<Locale, string> = { es: "carta", en: "menu" };

export type QrCategoryDef = {
  /** The `slug` column of `menu_categories` in Supabase. */
  id: string;
  /** Path segment per language. */
  slug: Record<Locale, string>;
  /** Photograph on the category's row in the index. */
  cover: string | null;
};

/**
 * Known categories. The route params, the sitemap and the index covers come
 * from this list, not from the database, so the pages can be prerendered
 * without a network call. A category added in Supabase still gets a working
 * page and an index row (its own `slug` serves as the path, and it has no
 * cover), but it needs an entry here to be prerendered and listed in the
 * sitemap, and its name and blurb keys in both dictionaries.

 * A category with no product photographs can use a photograph of the place as
 * its cover (see `content/images.ts`).
 */
export const qrCategories: QrCategoryDef[] = [
  {
    id: "cocina",
    slug: { es: "comida", en: "food" },
    cover: images.qr.covers.cocina,
  },
  {
    id: "brunch",
    slug: { es: "brunch", en: "brunch" },
    cover: images.qr.covers.brunch,
  },
  {
    id: "bar",
    slug: { es: "bebidas", en: "drinks" },
    cover: images.qr.covers.bar,
  },
];

/** The photograph behind the landing: portrait, like the phone it is shown on. */
export const qrLandingPhoto = images.qr.landing;

/** The definition for a database category, with a fallback for unknown ones. */
export function qrCategoryFor(id: string): QrCategoryDef {
  return (
    qrCategories.find((category) => category.id === id) ?? {
      id,
      slug: { es: id, en: id },
      cover: null,
    }
  );
}

export type QrPage =
  | { kind: "landing" }
  | { kind: "index" }
  | { kind: "category"; id: string };

/** The path of a page in one language. */
export function qrPath(locale: Locale, page: QrPage): string {
  switch (page.kind) {
    case "landing":
      return `/${locale}/qr`;
    case "index":
      return `/${locale}/qr/${qrIndexSlug[locale]}`;
    case "category":
      return `/${locale}/qr/${qrCategoryFor(page.id).slug[locale]}`;
  }
}

/** The same page in every language, for the switch and the alternates. */
export function qrPaths(page: QrPage): Record<Locale, string> {
  return { es: qrPath("es", page), en: qrPath("en", page) };
}

/**
 * What a `[slug]` segment names: the index, a category, or nothing. Takes the
 * database ids so a category that is not in `qrCategories` still resolves.
 */
export function resolveQrSlug(
  slug: string,
  locale: Locale,
  databaseIds: string[],
): QrPage | null {
  if (slug === qrIndexSlug[locale]) return { kind: "index" };
  const id = [...qrCategories.map((c) => c.id), ...databaseIds].find(
    (candidate) => qrCategoryFor(candidate).slug[locale] === slug,
  );
  return id ? { kind: "category", id } : null;
}
