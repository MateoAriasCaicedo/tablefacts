/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/menu/index.mjs";

const product = (name = "Pan") => ({ name, description: null, price: 10, currency: "USD", image_url: null, recommended: false });
const menu = [
  { slug: "cocina", name: "Comida", sections: [{ name: "ENTRADAS", products: [product("Pan"), product("Sopa")] }] },
  { slug: "bar", name: "Bebidas", sections: [{ name: "COCTELES DE AUTOR", products: [product("Mojito")] }] },
];

const scratch: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  scratch.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

describe("menu library surface", () => {
  it("exports the documented functions", () => {
    for (const name of ["importMenu", "importCluvi", "importImageMenu", "listMenuImages", "validateMenu", "countMenu", "cleanText", "slugify", "sectionName", "parsePrice", "normalizePages", "providers", "defaultProvider"]) {
      expect(api, name).toHaveProperty(name);
    }
  });

  it("importing it prints nothing and sets no exit code", async () => {
    const log = vi.spyOn(console, "log");
    const error = vi.spyOn(console, "error");
    process.exitCode = undefined;
    vi.resetModules();
    await import("../src/menu/index.mjs");
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });
});

describe("importMenu", () => {
  it("dry run without a database URL checks the menu, writes nothing and is silent", async () => {
    const log = vi.spyOn(console, "log");
    const result = await api.importMenu({ menu, notes: ["a note"], dryRun: true, databaseUrl: "" });
    expect(result.totals).toMatchObject({ categories: 2, sections: 2, products: 3 });
    expect(result.written).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.database).toBeNull();
    expect(result.notes).toContain("a note");
    expect(log).not.toHaveBeenCalled();
  });

  it("sends its messages to log", async () => {
    const lines: string[] = [];
    await api.importMenu({ menu, title: "Test source", dryRun: true, databaseUrl: "", log: (line: string) => lines.push(line) });
    const text = lines.join("\n");
    expect(text).toContain("Test source");
    expect(text).toContain("Comida (cocina): 1 sections, 2 products");
    expect(text).toContain("Dry run: SUPABASE_DB_URL is not set");
  });

  it("rejects an empty menu and an empty import with the CLI's messages", async () => {
    await expect(api.importMenu({ menu: [], dryRun: true, databaseUrl: "" })).rejects.toThrow(/./);
    const empty = [{ slug: "cocina", name: "Comida", sections: [{ name: "ENTRADAS", products: [] }] }];
    await expect(api.importMenu({ menu: empty, dryRun: true, databaseUrl: "" })).rejects.toThrow(/./);
    await expect(api.importMenu({ menu: undefined as any })).rejects.toThrow(/./);
  });

  it("refuses to write without a database URL", async () => {
    await expect(api.importMenu({ menu, databaseUrl: "" })).rejects.toThrow(/SUPABASE_DB_URL is not set/);
  });

  it("saves the menu as JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "menu-api-"));
    scratch.push(dir);
    const file = join(dir, "menu.json");
    await api.importMenu({ menu, json: file, dryRun: true, databaseUrl: "" });
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(menu);
  });
});

describe("custom source config", () => {
  afterEach(() => vi.unstubAllGlobals());

  const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

  it("importCluvi / fetchCluviMenu use the config you pass (url and categories)", async () => {
    const calls: string[] = [];
    const rawMenu = {
      categories: [{ id: 1, label: "Platos", order: 1, subcategories: [], product_ids: [10] }],
      products: [{ id: 10, label: "Arepa", price: 5, order: 1, description: null, image: null }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return json(url.includes("/suppliers/") ? { id: 9, label: "Mi sitio", currency: "usd" } : { menu: rawMenu });
      }),
    );
    const config = { url: "https://x.cluvi.co/misitio/maincategories", categories: [{ slug: "comida", name: "Comida", from: ["Platos"] }] };
    const fetched = await (await import("../src/menu/cluvi/import.mjs")).fetchCluviMenu({ config });
    expect(calls[0]).toBe("https://exp2.cluvi.com/api/suppliers/misitio.json");
    expect(calls[1]).toBe("https://services.cluvi.com/v1/menu/9/on_table.json?lang=es");
    expect(fetched.menu.map((c: any) => c.slug)).toEqual(["comida"]);
    expect(fetched.title).toContain("on_table menu in USD");

    const result = await api.importCluvi({ config, dryRun: true, databaseUrl: "" });
    expect(result.totals).toMatchObject({ categories: 1, products: 1 });
  });

  it("listMenuImages and findPages use the config url when no urls are passed", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/html" },
      text: async () => '<img src="/menu1.jpg" width="900"><img src="/menu2.jpg" width="900">',
    }));
    vi.stubGlobal("fetch", fetchMock);
    const pages = await api.listMenuImages({ config: { url: "https://mine.example/carta/" } });
    expect(fetchMock.mock.calls[0][0]).toBe("https://mine.example/carta/");
    expect(pages.map((p: any) => p.url)).toEqual(["https://mine.example/menu1.jpg", "https://mine.example/menu2.jpg"]);
    await expect(api.listMenuImages({ config: {} })).rejects.toThrow(/No menu page to read/);
  });
});
