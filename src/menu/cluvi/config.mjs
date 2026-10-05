// Everything restaurant-specific about the Cluvi import. Edit this file, not
// source.mjs, when the menu is organised differently.
export default {
  // This restaurant's tables in a shared Supabase database: the import writes
  // public.cannario_menu_categories / _menu_sections / _menu_products. Change
  // it (or pass `--table-prefix`) when importing another restaurant; leave it
  // empty only when this restaurant owns the unprefixed menu_* tables.
  tablePrefix: "cannario_",

  // Any page of the restaurant's Cluvi menu. Only the first path segment is
  // used (the supplier, here "cannario"). `tablefacts menu cluvi <url>`
  // overrides it for one run.
  url: "https://cannario.cluvi.co/cannario/maincategories",

  // Cluvi groups products as main category > subcategory. The site groups them
  // as category > section, with three categories by default (cocina, brunch,
  // bar), so each main category is folded into one of these. `from` lists
  // Cluvi main categories, ignoring case and accents. One that is listed
  // nowhere becomes a category of its own (slug from its name); that works,
  // but the slug then needs its keys in the dictionaries and in content/qr.ts.
  // A category left with no products is not written.
  categories: [
    { slug: "cocina", name: "Comida", from: ["Entradas", "Fuertes", "Postres"] },
    {
      slug: "bar",
      name: "Bebidas",
      from: ["Cócteles Cannario", "Tardeo Cannario", "Vinos", "Licores", "Bebidas"],
    },
  ],

  // Cluvi subcategory > section name, for the ones that should not just be
  // the subcategory name in UPPERCASE. These two match keys of `menu.sections`
  // in dictionary.ts, and the home page cocktail list reads signatureMenu
  // ("COCTELES DE AUTOR") from content/site.ts.
  sections: {
    "Cócteles Autor Cannario": "COCTELES DE AUTOR",
    Mocktails: "MOCKTAIL",
  },
};
