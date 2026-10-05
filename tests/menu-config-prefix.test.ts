/* eslint-disable @typescript-eslint/no-explicit-any */
// The restaurant config's `tablePrefix` and an explicit option: the source wrapper must resolve
// `option ?? config` and hand it to importMenu. Postgres is replaced, so nothing reaches a database.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  end: vi.fn(async () => {}),
  connect: vi.fn(),
  assertTarget: vi.fn(),
  inspect: vi.fn(),
  replaceMenu: vi.fn(),
}));
vi.mock("../src/menu/lib/db.mjs", () => ({
  connect: db.connect,
  assertTarget: db.assertTarget,
  inspect: db.inspect,
  replaceMenu: db.replaceMenu,
}));

import { fetchCluviMenu, importCluvi } from "../src/menu/cluvi/import.mjs";

const supplier = { id: 9, label: "Mi sitio", currency: "usd" };
const rawMenu = {
  categories: [{ id: 1, label: "Platos", order: 1, subcategories: [], product_ids: [10] }],
  products: [{ id: 10, label: "Arepa", price: 5, order: 1, description: null, image: null }],
};
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

const url = "https://x.cluvi.co/misitio/maincategories";
const config = { url, categories: [{ slug: "comida", name: "Comida", from: ["Platos"] }] };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (request: string) => json(request.includes("/suppliers/") ? supplier : { menu: rawMenu })));
  db.connect.mockReset().mockResolvedValue({ client: { end: db.end }, label: "db.example:5432/postgres" });
  db.assertTarget.mockReset().mockResolvedValue({
    prefix: "",
    tables: { categories: "public.menu_categories", sections: "public.menu_sections", products: "public.menu_products" },
    others: [],
  });
  db.inspect.mockReset().mockResolvedValue({ categories: 0, products: 0, kept: [] });
  db.replaceMenu.mockReset().mockResolvedValue({ categories: 1, sections: 1, products: 1 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the source config's tablePrefix", () => {
  it("fetchCluviMenu carries the config's prefix", async () => {
    expect((await fetchCluviMenu({ config: { ...config, tablePrefix: "cannario_" } })).tablePrefix).toBe("cannario_");
    expect((await fetchCluviMenu({ config })).tablePrefix).toBeUndefined();
  });

  it("importCluvi uses the config's prefix by default", async () => {
    await importCluvi({ config: { ...config, tablePrefix: "cannario_" }, databaseUrl: "postgres://x" });
    expect(db.assertTarget).toHaveBeenCalledWith(expect.anything(), { tablePrefix: "cannario_", allowUnprefixed: false, replaceAll: false });
    expect(db.replaceMenu).toHaveBeenCalledWith(expect.anything(), expect.anything(), { replaceAll: false, tablePrefix: "cannario_" });
  });

  it("an explicit tablePrefix overrides the config's", async () => {
    await importCluvi({ config: { ...config, tablePrefix: "cannario_" }, tablePrefix: "makibar_", databaseUrl: "postgres://x" });
    expect(db.assertTarget).toHaveBeenCalledWith(expect.anything(), { tablePrefix: "makibar_", allowUnprefixed: false, replaceAll: false });
    expect(db.replaceMenu).toHaveBeenCalledWith(expect.anything(), expect.anything(), { replaceAll: false, tablePrefix: "makibar_" });
  });

  it("a config without a prefix means the unprefixed tables", async () => {
    await importCluvi({ config, databaseUrl: "postgres://x" });
    expect(db.assertTarget).toHaveBeenCalledWith(expect.anything(), { tablePrefix: "", allowUnprefixed: false, replaceAll: false });
    expect(db.replaceMenu).toHaveBeenCalledWith(expect.anything(), expect.anything(), { replaceAll: false });
  });
});
