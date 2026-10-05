// What every menu source (src/menu/<source>/) produces, and the helpers they
// share. A source turns a restaurant's menu on some website into this shape;
// lib/run.mjs then checks it and writes it to Supabase.
//
//   [{ slug, name, sections: [{ name, products: [
//        { name, description, price, currency, image_url, recommended } ] }] }]
//
// Array order is display order (it becomes sort_order). The conventions are
// the ones in frontend/src/content/menu.ts: a category's `slug` is the key the
// dictionaries use, and section names are UPPERCASE strings that
// `menu.sections` in dictionary.ts maps to display names.
import { TablefactsError } from "../../lib/errors.mjs";
import { fold, slugify as slug } from "../../lib/text.mjs";

const squash = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

/** Collapses runs of whitespace (Cluvi labels carry stray spaces). */
export const cleanText = squash;

/** Lowercase, accent-free key, to compare labels typed by different people. */
export const matchKey = (text) => fold(squash(text));

export const slugify = (text) => slug(squash(text));

export const sectionName = (text) => squash(text).toLocaleUpperCase("es");

const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntity(match, body) {
  if (body[0] !== "#") return entities[body.toLowerCase()] ?? match;
  const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
}

/** Rich-text descriptions (<p>, <br>, <span style>) to plain text, one line per paragraph. */
export function htmlToText(html) {
  if (!html) return null;
  const text = String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, decodeEntity)
    .split("\n")
    .map(squash)
    .filter(Boolean)
    .join("\n");
  return text || null;
}

const currencies = new Set(Intl.supportedValuesOf("currency"));

/** An invalid code would make Intl.NumberFormat throw in the site's formatPrice. */
export const isCurrency = (code) => currencies.has(String(code ?? "").toUpperCase());

/**
 * Totals of a menu.
 * @param {import('../../lib/types.mjs').Menu} menu
 * @returns {import('../../lib/types.mjs').MenuTotals}
 */
export function countMenu(menu) {
  const sections = menu.flatMap((c) => c.sections);
  const products = sections.flatMap((s) => s.products);
  return {
    categories: menu.length,
    sections: sections.length,
    products: products.length,
    withImage: products.filter((p) => p.image_url).length,
  };
}

/**
 * Throws a TablefactsError (EFAILED) on anything the database or the site could not take, naming the culprit.
 * @param {import('../../lib/types.mjs').Menu} menu
 * @returns {void}
 */
export function validateMenu(menu) {
  const problems = [];
  const slugs = new Set();
  for (const category of menu) {
    if (!category.slug || !category.name) problems.push(`a category has no slug or name (${JSON.stringify(category.name)})`);
    if (slugs.has(category.slug)) problems.push(`category slug "${category.slug}" appears twice`);
    slugs.add(category.slug);
    for (const section of category.sections) {
      if (!section.name) problems.push(`a section of "${category.slug}" has no name`);
      for (const product of section.products) {
        const where = `"${product.name}" in ${category.slug} / ${section.name}`;
        if (!product.name) problems.push(`a product of ${category.slug} / ${section.name} has no name`);
        if (!Number.isFinite(product.price) || product.price < 0) problems.push(`${where}: invalid price ${product.price}`);
        if (!isCurrency(product.currency)) problems.push(`${where}: invalid currency "${product.currency}"`);
        if (product.image_url && !/^https:\/\//.test(product.image_url)) problems.push(`${where}: image_url is not an https URL`);
      }
    }
  }
  if (problems.length) throw new TablefactsError(`The extracted menu is not valid:\n  - ${problems.slice(0, 10).join("\n  - ")}`, "EFAILED");
}
