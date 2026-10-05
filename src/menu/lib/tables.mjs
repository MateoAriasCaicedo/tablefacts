// The table names a menu import writes. Several restaurants can share one
// Supabase database, so each restaurant's tables carry its own prefix
// (`cannario_menu_categories`, `makibar_menu_categories`, ...). The prefix is
// restaurant-specific and lives in the source's `config.mjs`; the CLI's
// `--table-prefix` overrides it for one run.
import { optionError } from "../../lib/errors.mjs";

// The only prefixes accepted: empty, or lowercase letters, digits and
// underscores ending in "_". A value that passed this allow-list is safe to
// build the table names from; nothing else is ever put into the SQL text.
const PREFIX = /^[a-z][a-z0-9_]*_$|^$/;

/**
 * `tablePrefix` when it is empty or a safe `<name>_` prefix (an ECONFIG error otherwise).
 * @param {string} [tablePrefix]
 * @returns {string}
 */
export function validateTablePrefix(tablePrefix) {
  const value = tablePrefix ?? "";
  if (!PREFIX.test(value)) {
    throw optionError(
      "tablePrefix",
      `${JSON.stringify(value)} is not a valid table prefix: \`tablePrefix\` must be empty or lowercase letters, digits and underscores ending in "_", such as "makibar_".`,
      "ECONFIG",
    );
  }
  return value;
}

/**
 * The three `public` menu tables for a prefix, e.g.
 * `{ categories: "public.makibar_menu_categories", sections: "public.makibar_menu_sections", products: "public.makibar_menu_products" }`.
 * The default (empty prefix) is the unprefixed `public.menu_*` set.
 * @param {string} [tablePrefix]
 * @returns {{ categories: string, sections: string, products: string }}
 */
export function menuTables(tablePrefix) {
  const prefix = validateTablePrefix(tablePrefix);
  return {
    categories: `public.${prefix}menu_categories`,
    sections: `public.${prefix}menu_sections`,
    products: `public.${prefix}menu_products`,
  };
}
