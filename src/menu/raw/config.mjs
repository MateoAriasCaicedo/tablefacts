// Everything restaurant-specific about the image-menu import. Edit this file,
// not the other scripts, when the menu is organised differently.
export default {
  // The page that shows the menu pictures, or direct image URLs.
  // `extract menu raw <url> [<url>...]` overrides it for one run.
  url: "https://www.mombasa.co/carta-restaurante-espanol/",

  // Currency of the prices, an ISO code. Colombian menus print pesos as
  // "$95.000": "." groups thousands and "," marks decimals.
  currency: "COP",
  thousands: ".",
  decimal: ",",
  // Multiply every price by this when the menu prints thousands short ("95"
  // for 95.000).
  scale: 1,

  // Each section the model reads is tagged food or drink (or other, which is
  // left out), and goes into the category that lists its group. The site's
  // default categories are cocina and bar.
  categories: [
    { slug: "cocina", name: "Comida", groups: ["food"] },
    { slug: "bar", name: "Bebidas", groups: ["drink"] },
  ],

  // Section title (ignoring case and accents) > category slug, for a section
  // the model tagged wrongly.
  placeIn: {},

  // Section title > the name stored, for ones that should not just be the
  // title in UPPERCASE. "COCTELES DE AUTOR" is what the home page cocktail
  // list reads (signatureMenu in content/site.ts).
  sections: {
    "Cócteles de Autor": "COCTELES DE AUTOR",
  },

  // Section titles to leave out entirely.
  skipSections: [],
};
