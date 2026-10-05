/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCluvi, normalizeCluvi, supplierSlug } from "../src/menu/cluvi/source.mjs";
import config from "../src/menu/cluvi/config.mjs";

type Anything = Record<string, any>;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const json = (status: number, body: unknown) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

describe("supplierSlug", () => {
  it("is the first path segment of any page of the menu", () => {
    expect(supplierSlug("https://cannario.cluvi.co/cannario/maincategories")).toBe("cannario");
    expect(supplierSlug("https://x.cluvi.co/zelavi/")).toBe("zelavi");
  });
  it("explains a URL with no supplier", () => {
    expect(() => supplierSlug("https://cannario.cluvi.co/")).toThrow(/has no supplier in its path/);
  });
  it("rejects what is not a URL", () => {
    expect(() => supplierSlug("cannario")).toThrow('"cannario" is not a URL.');
  });
});

describe("fetchCluvi", () => {
  const supplier = { id: 77, label: "Cannario", currency: "cop" };

  it("reads the supplier, then its menu for the service and language asked", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return url.includes("/suppliers/") ? json(200, supplier) : json(200, { menu: { categories: [], products: [] } });
      }),
    );
    const result = (await fetchCluvi({ url: "https://x.cluvi.co/cannario/maincategories", service: "take_away", lang: "en" })) as Anything;
    expect(calls).toEqual([
      "https://exp2.cluvi.com/api/suppliers/cannario.json",
      "https://services.cluvi.com/v1/menu/77/take_away.json?lang=en",
    ]);
    expect(result.supplier).toEqual(supplier);
    expect(result.service).toBe("take_away");
  });

  it("defaults to the table menu in Spanish", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return json(200, url.includes("/suppliers/") ? supplier : {});
      }),
    );
    await fetchCluvi({ url: "https://x.cluvi.co/cannario/" });
    expect(calls[1]).toBe("https://services.cluvi.com/v1/menu/77/on_table.json?lang=es");
  });

  it("names the restaurant when Cluvi answers 404 for it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(404, {})));
    await expect(fetchCluvi({ url: "https://x.cluvi.co/nope/" })).rejects.toThrow('Cluvi has no restaurant "nope"');
  });

  it("names the restaurant when Cluvi answers 200 with an empty object, which is how it says unknown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, {})));
    await expect(fetchCluvi({ url: "https://x.cluvi.co/nope/" })).rejects.toThrow('Cluvi has no restaurant "nope"');
  });

  it("retries a server error and then succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(500, {}))
      .mockResolvedValueOnce(json(200, supplier))
      .mockResolvedValueOnce(json(200, { menu: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const result = fetchCluvi({ url: "https://x.cluvi.co/cannario/" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(((await result) as Anything).supplier.id).toBe(77);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after three tries on a network error", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    vi.stubGlobal("fetch", fetchMock);
    const settled = fetchCluvi({ url: "https://x.cluvi.co/cannario/" }).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(((await settled) as Error).message).toBe("ECONNRESET");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a client error", async () => {
    const fetchMock = vi.fn(async () => json(403, {}));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchCluvi({ url: "https://x.cluvi.co/cannario/" })).rejects.toThrow(/HTTP 403/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("normalizeCluvi", () => {
  const cfg = {
    categories: [
      { slug: "cocina", name: "Comida", from: ["Entradas", "Fuertes"] },
      { slug: "bar", name: "Bebidas", from: ["Cócteles", "Vinos"] },
    ],
    sections: { "Cócteles Autor": "COCTELES DE AUTOR" },
  };
  const product = (id: number, label: string, over: Anything = {}) => ({ id, label, price: 10, order: id, description: null, image: null, ...over });
  const raw = (categories: Anything[], products: Anything[], extra: Anything = {}) => ({ supplier: { currency: "cop" }, raw: { menu: { categories, products }, ...extra } });
  const normalize = (input: ReturnType<typeof raw>, c: Anything = cfg) => normalizeCluvi(input as never, c) as Anything;

  it("folds main categories into the configured ones, with subcategories as uppercase sections", () => {
    const { menu, currency } = normalize(
      raw(
        [
          { id: 1, label: "Entradas", order: 1, subcategories: [{ id: 11, label: "Para compartir", order: 1, product_ids: [1] }] },
          { id: 2, label: "Cócteles", order: 2, subcategories: [{ id: 21, label: "Cócteles Autor", order: 1, product_ids: [2] }] },
        ],
        [product(1, "Nachos"), product(2, "Así es la Vida")],
      ),
    );
    expect(currency).toBe("COP");
    expect(menu).toEqual([
      { slug: "cocina", name: "Comida", sections: [{ name: "PARA COMPARTIR", products: [expect.objectContaining({ name: "Nachos", price: 10, currency: "COP" })] }] },
      { slug: "bar", name: "Bebidas", sections: [{ name: "COCTELES DE AUTOR", products: [expect.objectContaining({ name: "Así es la Vida" })] }] },
    ]);
  });

  it("matches main categories ignoring case and accents", () => {
    const { menu } = normalize(raw([{ id: 1, label: "COCTELES", order: 1, product_ids: [1] }], [product(1, "X")]), {
      categories: [{ slug: "bar", name: "Bebidas", from: ["Cócteles"] }],
    });
    expect(menu[0].slug).toBe("bar");
  });

  it("makes a category of its own for a main category the config does not list, and says so", () => {
    const { menu, notes } = normalize(raw([{ id: 3, label: "Postres Caseros", order: 1, product_ids: [1] }], [product(1, "Flan")]));
    expect(menu).toEqual([{ slug: "postres-caseros", name: "Postres Caseros", sections: [expect.objectContaining({ name: "POSTRES CASEROS" })] }]);
    expect(notes.join()).toContain('not in config.categories: imported as its own category "postres-caseros"');
  });

  it("orders products by Cluvi's `order`, not by their place in product_ids", () => {
    const { menu } = normalize(
      raw([{ id: 1, label: "Entradas", order: 1, product_ids: [1, 2, 3] }], [product(1, "C", { order: 3 }), product(2, "A", { order: 1 }), product(3, "B", { order: 2 })]),
    );
    expect(menu[0].sections[0].products.map((p: Anything) => p.name)).toEqual(["A", "B", "C"]);
  });

  it("orders categories and subcategories by `order`, and goes down nested subcategories", () => {
    const { menu } = normalize(
      raw(
        [
          {
            id: 1,
            label: "Entradas",
            order: 1,
            subcategories: [
              { id: 12, label: "Segunda", order: 2, product_ids: [2] },
              { id: 11, label: "Primera", order: 1, subcategories: [{ id: 111, label: "Anidada", order: 1, product_ids: [1] }] },
            ],
          },
        ],
        [product(1, "A"), product(2, "B")],
      ),
    );
    expect(menu[0].sections.map((s: Anything) => s.name)).toEqual(["ANIDADA", "SEGUNDA"]);
  });

  it("cleans names, turns rich-text descriptions into text and rounds prices to cents", () => {
    const { menu } = normalize(
      raw([{ id: 1, label: "Entradas", order: 1, product_ids: [1] }], [product(1, "  Pan   de   ajo ", { price: "12.345", description: "<p>Con <b>ajo</b> &amp; perejil</p>", important: true })]),
    );
    expect(menu[0].sections[0].products[0]).toEqual({ name: "Pan de ajo", description: "Con ajo & perejil", price: 12.35, currency: "COP", image_url: null, recommended: true });
  });

  it("takes the largest picture Cluvi has, and only over https", () => {
    const image = (value: unknown) => normalize(raw([{ id: 1, label: "Entradas", order: 1, product_ids: [1] }], [product(1, "X", { image: value })])).menu[0].sections[0].products[0].image_url;
    expect(image({ thumb: "https://c/t.jpg", w_768: "https://c/768.jpg", w_1200: "https://c/1200.jpg" })).toBe("https://c/1200.jpg");
    expect(image({ thumb: "https://c/t.jpg" })).toBe("https://c/t.jpg");
    expect(image({ w_1200: "http://c/insecure.jpg" })).toBeNull();
    expect(image("https://c/plain.jpg")).toBe("https://c/plain.jpg");
    expect(image("http://c/plain.jpg")).toBeNull();
    expect(image(null)).toBeNull();
  });

  it("reports what the menu tables cannot hold: products with no category, no price, options or sold out", () => {
    const { menu, notes } = normalize(
      raw(
        [{ id: 1, label: "Entradas", order: 1, product_ids: [1, 2, 3] }],
        [
          product(1, "Gratis", { price: 0 }),
          product(2, "Con tamaños", { configs: [{}] }),
          product(3, "Agotado", { out_of_stock: true }),
          product(4, "Huérfano"),
        ],
      ),
    );
    expect(menu[0].sections[0].products).toHaveLength(3);
    const text = notes.join("\n");
    expect(text).toContain("1 products are in no category and were skipped: Huérfano");
    expect(text).toContain("1 products have no price in Cluvi");
    expect(text).toContain("1 products have options in Cluvi");
    expect(text).toContain("1 products are marked sold out");
  });

  it("shortens a long list of names in a note", () => {
    const products = Array.from({ length: 10 }, (_, i) => product(i + 1, `P${i + 1}`));
    const { notes } = normalize(raw([{ id: 1, label: "Entradas", order: 1, product_ids: [] }], products));
    expect(notes.join()).toContain("P1, P2, P3, P4, P5, P6, P7, P8, and 2 more");
  });

  it("drops products with no name and categories left with no products", () => {
    const { menu } = normalize(
      raw(
        [
          { id: 1, label: "Entradas", order: 1, product_ids: [1] },
          { id: 2, label: "Vinos", order: 2, product_ids: [] },
        ],
        [product(1, "   ")],
      ),
    );
    expect(menu).toEqual([]);
  });

  it("takes the currency from the supplier, else from the customer, and refuses to guess", () => {
    const input = raw([{ id: 1, label: "Entradas", order: 1, product_ids: [1] }], [product(1, "X")]);
    expect(normalize({ ...input, supplier: {}, raw: { ...input.raw, customer: { currency: "usd" } } } as never).currency).toBe("USD");
    expect(() => normalize({ ...input, supplier: {} } as never)).toThrow(/did not say which currency/);
    expect(() => normalize({ ...input, supplier: { currency: "pesos" } } as never)).toThrow(/did not say which currency/);
  });

  it("explains a response that is not shaped like a menu, which means Cluvi changed its API", () => {
    expect(() => normalizeCluvi({ supplier: { currency: "COP" }, raw: {} } as never, cfg)).toThrow(/unexpected shape[\s\S]*source\.mjs/);
    expect(() => normalizeCluvi({ supplier: { currency: "COP" }, raw: { menu: { categories: [], products: {} } } } as never, cfg)).toThrow(/unexpected shape/);
  });
});

describe("the Cluvi config", () => {
  it("lists categories with a slug, a name and the Cluvi categories they take", () => {
    for (const category of config.categories) {
      expect(category.slug).toBeTruthy();
      expect(category.name).toBeTruthy();
      expect(category.from.length).toBeGreaterThan(0);
    }
  });
  it("names the signature section the home page reads", () => {
    expect(Object.values(config.sections)).toContain("COCTELES DE AUTOR");
  });
});
