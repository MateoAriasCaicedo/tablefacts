import { describe, expect, it } from "vitest";
// The importers are plain ES modules; TypeScript infers their types from the JS.
import { cleanText, countMenu, htmlToText, isCurrency, matchKey, sectionName, slugify, validateMenu } from "../src/menu/lib/menu.mjs";
import { templateHints } from "../src/menu/lib/import.mjs";

type Product = { name: string; price: number; currency: string; image_url: string | null };
const product = (over: Partial<Product> = {}): Product => ({
  name: "Plato",
  price: 10,
  currency: "USD",
  image_url: null,
  ...over,
});
const menu = (sections: { name: string; products: Product[] }[], slug = "cocina") => [
  { slug, name: "Comida", sections },
];

describe("menu text helpers", () => {
  it("collapses whitespace", () => {
    expect(cleanText("  a \n  b\t")).toBe("a b");
  });
  it("makes accent-free match keys and slugs", () => {
    expect(matchKey(" Cócteles  Autor ")).toBe("cocteles autor");
    expect(slugify("Cócteles de Autor!")).toBe("cocteles-de-autor");
  });
  it("uppercases section names with Spanish rules", () => {
    expect(sectionName("postres")).toBe("POSTRES");
  });
  it("turns rich text into one line per paragraph", () => {
    expect(htmlToText("<p>Uno &amp; dos</p><p>tres<br>cuatro</p>")).toBe("Uno & dos\ntres\ncuatro");
    expect(htmlToText("<p> </p>")).toBeNull();
    expect(htmlToText(null)).toBeNull();
  });
  it("recognises currency codes", () => {
    expect(isCurrency("usd")).toBe(true);
    expect(isCurrency("XXQ")).toBe(false);
  });
});

describe("validateMenu", () => {
  const ok = menu([{ name: "ENTRADAS", products: [product()] }]);
  it("accepts a good menu and counts it", () => {
    expect(() => validateMenu(ok)).not.toThrow();
    expect(countMenu(ok)).toEqual({ categories: 1, sections: 1, products: 1, withImage: 0 });
  });
  it("names a bad price, currency and image", () => {
    const bad = menu([
      {
        name: "ENTRADAS",
        products: [
          product({ price: -1 }),
          product({ currency: "NOPE" }),
          product({ image_url: "http://insecure.example/a.jpg" }),
        ],
      },
    ]);
    expect(() => validateMenu(bad)).toThrow(/invalid price -1[\s\S]*invalid currency "NOPE"[\s\S]*not an https URL/);
  });
  it("rejects a duplicated category slug", () => {
    expect(() => validateMenu([...ok, ...ok])).toThrow(/appears twice/);
  });
});

describe("templateHints", async () => {
  const withSignature = [
    {
      slug: "bar",
      name: "Bebidas",
      sections: [{ name: "COCTELES DE AUTOR", products: [product()] }],
    },
  ];

  it("is quiet for a menu the template already fits", async () => {
    const hints: string[] = await templateHints(withSignature);
    expect(hints.filter((h) => h.includes("cocktail list"))).toEqual([]);
    expect(hints.filter((h) => h.includes("menuImageHosts"))).toEqual([]);
  });
  it("warns when there is no signature section", async () => {
    const hints: string[] = await templateHints(menu([{ name: "ENTRADAS", products: [product()] }], "bar"));
    expect(hints.some((h) => h.includes("signatureMenu") && h.includes("COCTELES DE AUTOR"))).toBe(true);
  });
  it("warns about a photo host the site does not allow", async () => {
    const hints: string[] = await templateHints(
      menu([{ name: "ENTRADAS", products: [product({ image_url: "https://cdn.unlisted.example/a.jpg" })] }]),
    );
    expect(hints.some((h) => h.includes("cdn.unlisted.example"))).toBe(true);
  });
  it("warns about a category the QR menu does not know", async () => {
    const hints: string[] = await templateHints(menu([{ name: "X", products: [product()] }], "postres"));
    expect(hints.some((h) => h.includes("qrCategories") && h.includes("postres"))).toBe(true);
  });
});
