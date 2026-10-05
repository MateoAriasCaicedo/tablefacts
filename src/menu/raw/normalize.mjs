// Transcribed menu pages (vision.mjs) to the shape lib/menu.mjs describes.
import { cleanText, isCurrency, matchKey, sectionName } from "../lib/menu.mjs";
import { TablefactsError } from "../../lib/errors.mjs";

/**
 * "$95.000" to 95000. `thousands` and `decimal` are the separators the menu
 * prints (Colombia: "." and ","); `scale` multiplies the result for menus that
 * print "95" meaning 95.000. Returns null for text with no number.
 * @param {string} text
 * @param {import('../../lib/types.mjs').PriceFormat} [format]
 * @returns {number | null}
 */
export function parsePrice(text, { thousands = ".", decimal = ",", scale = 1 } = {}) {
  let digits = String(text ?? "").replace(/[^\d.,]/g, "");
  if (!/\d/.test(digits)) return null;
  digits = digits.split(thousands).join("").replace(decimal, ".");
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * scale * 100) / 100;
}

const listNames = (names) => names.slice(0, 6).join(", ") + (names.length > 6 ? `, and ${names.length - 6} more` : "");

/**
 * `pages` is the transcription of each page, in page order. A section with no
 * title continues the section before it (a list that runs onto the next page),
 * and sections with the same title are merged. Each section is placed in the
 * category of `config.categories` that lists its group (food, drink), unless
 * `config.placeIn` names it. An item with several priced columns becomes one
 * product per column, "Name (Botella)", because a product has one price.
 * @param {{ number?: number, notes?: string[], sections?: any[] }[]} pages transcriptions, one per page
 * @param {import('../../lib/types.mjs').RawConfig} config
 * @returns {{ menu: import('../../lib/types.mjs').Menu, notes: string[], currency: string }}
 */
export function normalizePages(pages, config) {
  const notes = [];
  const currency = String(config.currency ?? "").toUpperCase();
  if (!isCurrency(currency)) throw new TablefactsError(`config.currency "${config.currency}" is not a currency code (such as COP or USD).`, "ECONFIG");

  const categories = (config.categories ?? []).map((c) => ({ ...c, sections: new Map() }));
  const bySlug = new Map(categories.map((c) => [c.slug, c]));
  const byGroup = new Map(categories.flatMap((c) => (c.groups ?? []).map((group) => [group, c])));
  const renames = new Map(Object.entries(config.sections ?? {}).map(([from, to]) => [matchKey(from), to]));
  const placeIn = new Map(Object.entries(config.placeIn ?? {}).map(([from, slug]) => [matchKey(from), slug]));
  const skip = new Set((config.skipSections ?? []).map(matchKey));
  for (const slug of placeIn.values()) if (!bySlug.has(slug)) throw new TablefactsError(`config.placeIn points at "${slug}", which is not in config.categories.`, "ECONFIG");

  const unparsed = [];
  const unlabeled = [];
  const skipped = [];
  let previous = null; // the last section placed: { category, name }

  pages.forEach((page, index) => {
    const label = `page ${page.number ?? index + 1}`;
    for (const note of page.notes ?? []) notes.push(`${label}: ${cleanText(note)}`);
    for (const section of page.sections ?? []) {
      const title = cleanText(section.title);
      const items = (section.items ?? []).filter((item) => cleanText(item.name));
      if (!items.length) continue;

      let target;
      if (!title) {
        if (!previous) {
          notes.push(`${label}: ${items.length} items come before any section heading, so they were skipped: ${listNames(items.map((i) => i.name))}.`);
          continue;
        }
        target = previous;
      } else {
        if (skip.has(matchKey(title))) {
          skipped.push(title);
          continue;
        }
        const category = bySlug.get(placeIn.get(matchKey(title))) ?? byGroup.get(section.group);
        if (!category) {
          skipped.push(`${title} (${section.group})`);
          continue;
        }
        target = { category, name: renames.get(matchKey(title)) ?? sectionName(title) };
      }

      const { category, name } = target;
      if (!category.sections.has(name)) category.sections.set(name, []);
      const products = category.sections.get(name);
      for (const item of items) {
        const itemName = cleanText(item.name);
        const prices = (item.prices ?? []).map((p) => ({ value: parsePrice(p.text, config), label: cleanText(p.label) })).filter((p) => p.value !== null);
        if (!prices.length) {
          unparsed.push(`${itemName} (${label})`);
          continue;
        }
        const variants = prices.length > 1 && prices.every((p) => p.label) ? prices : prices.slice(0, 1);
        if (prices.length > 1 && variants.length === 1) unlabeled.push(itemName);
        for (const { value, label: variant } of variants) {
          products.push({
            name: variants.length > 1 ? `${itemName} (${variant})` : itemName,
            description: cleanText(item.description) || null,
            price: value,
            currency,
            image_url: null,
            recommended: false,
          });
        }
      }
      previous = target;
    }
  });

  if (skipped.length) notes.push(`Sections not placed in any category and left out: ${listNames([...new Set(skipped)])}. Add them to config.categories groups, config.placeIn or config.skipSections.`);
  if (unparsed.length) notes.push(`${unparsed.length} items have no readable price and were left out: ${listNames(unparsed)}.`);
  if (unlabeled.length) notes.push(`${unlabeled.length} items show several prices without saying what each is for, so only the first was imported: ${listNames(unlabeled)}.`);

  const menu = categories
    .map((c) => ({
      slug: c.slug,
      name: c.name,
      sections: [...c.sections].filter(([, list]) => list.length).map(([name, list]) => ({ name, products: list })),
    }))
    .filter((c) => c.sections.length);
  return { menu, notes, currency };
}
