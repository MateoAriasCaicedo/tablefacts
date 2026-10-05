// Reads a restaurant's menu from Cluvi (cluvi.com), which serves digital menus
// as a single-page app at <restaurant>.cluvi.co. The page has no menu markup
// and Cluvi publishes no API, so this calls the two JSON endpoints the app
// itself calls. They are not a documented interface and may change: if the
// import breaks, check these URLs against the network tab of the menu page.
//
//   supplier  https://exp2.cluvi.com/api/suppliers/<slug>.json        id, currency
//   menu      https://services.cluvi.com/v1/menu/<id>/<service>.json  categories + products
import { cleanText, htmlToText, isCurrency, matchKey, sectionName, slugify } from "../lib/menu.mjs";

const SUPPLIER_URL = "https://exp2.cluvi.com/api/suppliers";
const MENU_URL = "https://services.cluvi.com/v1/menu";
const headers = { accept: "application/json", "user-agent": "cannario-menu-sync/1.0 (restaurant menu importer)" };

async function getJson(url) {
  let failure;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
      if (res.ok) return await res.json();
      failure = Object.assign(new Error(`HTTP ${res.status} from ${url}`), { status: res.status });
      if (res.status < 500) break; // a client error will not fix itself
    } catch (error) {
      failure = error; // network error, timeout or a body that is not JSON
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }
  throw failure;
}

/** https://<restaurant>.cluvi.co/<supplier>/maincategories gives "<supplier>". */
export function supplierSlug(menuUrl) {
  let slug;
  try {
    slug = new URL(menuUrl).pathname.split("/").filter(Boolean)[0];
  } catch {
    throw new Error(`"${menuUrl}" is not a URL.`);
  }
  if (!slug) {
    throw new Error(`"${menuUrl}" has no supplier in its path. Use a menu page such as https://<restaurant>.cluvi.co/<supplier>/maincategories.`);
  }
  return slug;
}

/**
 * `service` picks which of the restaurant's menus to read. `on_table` is the
 * digital menu guests open from the table QR code and is the complete one:
 * `delivery` and `take_away` only list what the restaurant sells that way.
 */
export async function fetchCluvi({ url, service = "on_table", lang = "es" }) {
  const slug = supplierSlug(url);
  const unknown = new Error(`Cluvi has no restaurant "${slug}". Check the first path segment of the menu URL.`);
  let supplier;
  try {
    supplier = await getJson(`${SUPPLIER_URL}/${slug}.json`);
  } catch (error) {
    throw error.status === 404 ? unknown : error;
  }
  if (!supplier?.id) throw unknown; // an unknown slug is answered with 200 and {}
  const raw = await getJson(`${MENU_URL}/${supplier.id}/${encodeURIComponent(service)}.json?lang=${encodeURIComponent(lang)}`);
  return { supplier, raw, service };
}

// Photos come as the same file at several widths. The largest is the best
// source for next/image, which resizes it again.
const imageWidths = ["w_1200", "w_992", "w_768", "w_576", "blog", "thumb"];

function imageUrl(image) {
  if (typeof image === "string") return image.startsWith("https://") ? image : null;
  return imageWidths.map((width) => image?.[width]).find((url) => typeof url === "string" && url.startsWith("https://")) ?? null;
}

const byOrder = (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0);
const leaves = (category) => (category.subcategories?.length ? category.subcategories.flatMap(leaves) : [category]);
const listNames = (names) => names.slice(0, 8).join(", ") + (names.length > 8 ? `, and ${names.length - 8} more` : "");

/**
 * Cluvi's response to the shape lib/menu.mjs describes. Main categories are
 * folded into the categories of `config.categories`, subcategories become
 * sections, and products keep the order Cluvi shows them in (their `order`
 * field, not their position in the subcategory's product_ids).
 */
export function normalizeCluvi({ supplier, raw }, config) {
  const { categories, products } = raw?.menu ?? {};
  if (!Array.isArray(categories) || !Array.isArray(products)) {
    throw new Error("Cluvi returned a menu in an unexpected shape (no menu.categories or menu.products). Its API may have changed: see data/menu/cluvi/source.mjs.");
  }
  const currency = [supplier.currency, raw.customer?.currency].map((code) => String(code ?? "").toUpperCase()).find(isCurrency);
  if (!currency) throw new Error("Cluvi did not say which currency this menu uses.");

  const notes = [];
  const byId = new Map(products.map((product) => [product.id, product]));
  const renames = new Map(Object.entries(config.sections ?? {}).map(([from, to]) => [matchKey(from), to]));
  const groups = (config.categories ?? []).map((c) => ({ slug: c.slug, name: c.name, from: new Set(c.from.map(matchKey)), sections: new Map() }));
  const own = new Map(); // main categories that config.categories does not list
  const placed = new Set();
  const unpriced = [];
  const withOptions = [];
  let soldOut = 0;

  const ownCategory = (main) => {
    const slug = slugify(main.label) || `category-${main.id}`;
    if (!own.has(slug)) {
      own.set(slug, { slug, name: cleanText(main.label), sections: new Map() });
      notes.push(`Cluvi category "${cleanText(main.label)}" is not in config.categories: imported as its own category "${slug}".`);
    }
    return own.get(slug);
  };

  function convert(product) {
    const name = cleanText(product.label);
    if (!name) return null;
    const price = Number(product.price);
    if (!(price > 0)) unpriced.push(name);
    if (product.configs?.length) withOptions.push(name);
    if (product.out_of_stock) soldOut++;
    return {
      name,
      description: htmlToText(product.description),
      price: price > 0 ? Math.round(price * 100) / 100 : 0,
      currency,
      image_url: imageUrl(product.image),
      recommended: product.important === true,
    };
  }

  for (const main of [...categories].sort(byOrder)) {
    const category = groups.find((group) => group.from.has(matchKey(main.label))) ?? ownCategory(main);
    for (const sub of leaves(main).sort(byOrder)) {
      const name = renames.get(matchKey(sub.label)) ?? sectionName(sub.label || main.label);
      if (!category.sections.has(name)) category.sections.set(name, []);
      const items = (sub.product_ids ?? []).map((id, index) => ({ product: byId.get(id), index }));
      for (const { product } of items.filter((item) => item.product).sort((a, b) => byOrder(a.product, b.product) || a.index - b.index)) {
        placed.add(product.id);
        const converted = convert(product);
        if (converted) category.sections.get(name).push(converted);
      }
    }
  }

  const unplaced = products.filter((product) => !placed.has(product.id));
  if (unplaced.length) notes.push(`${unplaced.length} products are in no category and were skipped: ${listNames(unplaced.map((p) => cleanText(p.label)))}.`);
  if (unpriced.length) notes.push(`${unpriced.length} products have no price in Cluvi, which hides a price of 0. They are imported with price 0 and the site will show 0: ${listNames(unpriced)}.`);
  if (withOptions.length) notes.push(`${withOptions.length} products have options in Cluvi (add-ons, sizes) that the menu tables cannot hold, so only their base price is imported.`);
  if (soldOut) notes.push(`${soldOut} products are marked sold out in Cluvi and were imported anyway.`);

  const menu = [...groups, ...own.values()]
    .map((c) => ({
      slug: c.slug,
      name: c.name,
      sections: [...c.sections].filter(([, list]) => list.length).map(([name, list]) => ({ name, products: list })),
    }))
    .filter((c) => c.sections.length);
  return { menu, notes, currency };
}
