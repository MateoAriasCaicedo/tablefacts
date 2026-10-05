/**
 * Everything about the business that is not copy: name, links, address and
 * map point, plus the locale list and the helpers that build links from them.
 *
 * Importable from Client Components (no `server-only`), which is why the
 * locale type lives here rather than next to the dictionaries.
 */

export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "es";

/**
 * Each language's own name, the same on every page: a visitor who cannot read
 * the current language still recognises their own in the switch, and a screen
 * reader says "Español" and "English" instead of spelling "E S".
 */
export const localeNames: Record<Locale, string> = {
  es: "Español",
  en: "English",
};

/**
 * The language the menu data (dish names and descriptions) is written in. It
 * lives in the database, one language only, so on a page in any other language
 * those fragments are marked with this `lang` and a screen reader switches
 * voice instead of reading Spanish with an English accent.
 */
export const MENU_LOCALE: Locale = "es";

/**
 * Where the home page's cocktail list comes from: the Supabase category `slug`
 * and the exact DB name of the section in it (see `signatureCocktails`). A
 * menu with no such section leaves the list empty, so set both to match it.
 */
export const signatureMenu = {
  category: "bar",
  section: "COCTELES DE AUTOR",
} as const;

/**
 * Hostnames, besides this project's Supabase Storage, that dish photos may be
 * loaded from: the CDN of a menu imported with `data/menu/<source>` keeps its
 * pictures there (`image_url`). `next.config.ts` turns these into
 * `images.remotePatterns`. `data/menu/cluvi` needs
 * `["images.cluvi.com", "images-mini.cluvi.com"]`.
 */
export const menuImageHosts: readonly string[] = [];

/**
 * Replace every value below for a new restaurant. The values are placeholders.
 * Leave a link as "" to hide it where the UI allows (reserve, waze).
 */
export const site = {
  name: "Cannario",
  url: "https://example.com",
  /** Public path of the logo (an SVG with a 876x412 box, see public/logo.svg). */
  logo: "/logo.svg",
  /** Where the Reserve buttons go (OpenTable, Resy, a booking page). */
  reserveUrl: "https://www.opentable.com/r/your-restaurant",
  /** Digits only, with country code. */
  whatsapp: "15555550123",
  whatsappDisplay: "+1 555 555 0123",
  /** Landline or reservations number, shown as a `tel:` link in the visit
      section. "" hides it (a restaurant that only uses WhatsApp). */
  phone: "" as string,
  /** Where privacy requests go, shown on the privacy page. "" leaves WhatsApp
      (and the phone, if set) as the only contact. */
  email: "" as string,
  /** ISO date the privacy policy was last reviewed; shown on that page. Change
      it whenever the policy text or the services the site uses change. */
  privacyUpdated: "2026-10-04",
  instagram: "https://www.instagram.com/your_restaurant/",
  instagramHandle: "@your_restaurant",
  waze: "https://waze.com/ul?ll=40.7128,-74.0060&navigate=yes",
  maps: "https://www.google.com/maps/search/?api=1&query=40.7128,-74.0060",
  coordinates: { lat: 40.7128, lng: -74.006 },
  street: "123 Main Street",
  locality: "Your City",
  region: "Your Region",
  /** ISO 3166-1 alpha-2. */
  country: "US",
  /** schema.org servesCuisine. */
  cuisines: ["International"],
} as const;

/** Type guard for the `[lang]` route segment. */
export const hasLocale = (value: string): value is Locale =>
  (LOCALES as readonly string[]).includes(value);

/**
 * The restaurant's country spelled out in the page's language ("US" becomes
 * "United States" or "Estados Unidos"), from `site.country`. Falls back to the
 * code itself when the runtime has no name for it.
 */
export function countryName(locale: Locale): string {
  try {
    return (
      new Intl.DisplayNames([locale], { type: "region" }).of(
        site.country.toUpperCase(),
      ) ??
      site.country
    );
  } catch {
    return site.country;
  }
}

/**
 * Open Graph locale, `language_TERRITORY`. English stays `en_US`, the
 * territory social platforms support best; any other language takes the
 * restaurant's own country (`es_CO`, `es_MX`, `es_ES`).
 */
export const ogLocale = (locale: Locale): string =>
  `${locale}_${locale === "en" ? "US" : site.country.toUpperCase()}`;

/** WhatsApp thread with an optional prefilled message. */
export function whatsappLink(text?: string) {
  const base = `https://wa.me/${site.whatsapp}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/**
 * The path without its leading locale segment, so the language switch can
 * keep the visitor on the same page: `/es/menu` becomes `/menu`, `/es` ''.
 */
export function stripLocalePath(pathname: string): string {
  const [, first, ...rest] = pathname.split("/");
  if (!hasLocale(first ?? "")) return pathname === "/" ? "" : pathname;
  return rest.length ? `/${rest.join("/")}` : "";
}
