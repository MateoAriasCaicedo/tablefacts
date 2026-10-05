/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Anything = Record<string, any>;

// The runner talks to Postgres through lib/db.mjs. Every test replaces it, so
// nothing here can reach a real database whatever .env holds.
const db = vi.hoisted(() => ({
  end: vi.fn(async () => {}),
  connect: vi.fn(),
  inspect: vi.fn(),
  replaceMenu: vi.fn(),
}));
vi.mock("../src/menu/lib/db.mjs", () => ({
  connect: db.connect,
  inspect: db.inspect,
  replaceMenu: db.replaceMenu,
}));

import { runImport } from "../src/menu/lib/run.mjs";

const product = (name = "Pan") => ({ name, description: null, price: 10, currency: "USD", image_url: null, recommended: false });
const menu = [
  { slug: "cocina", name: "Comida", sections: [{ name: "ENTRADAS", products: [product("Pan"), product("Sopa")] }] },
  { slug: "bar", name: "Bebidas", sections: [{ name: "COCTELES DE AUTOR", products: [product("Mojito")] }] },
];

let out: string[];
let errors: string[];
const scratch: string[] = [];

/** Runs an import with the given flags and returns what it printed. */
async function run(args: string[], fetchMenu: Anything = async () => ({ menu, notes: ["a source note"], title: "Test source" }), options: Anything = {}) {
  process.argv = ["node", "tablefacts.mjs", ...args];
  await runImport({ usage: "Usage: test", fetchMenu, options });
  return { out: out.join("\n"), errors: errors.join("\n"), exitCode: process.exitCode };
}

beforeEach(() => {
  out = [];
  errors = [];
  vi.spyOn(console, "log").mockImplementation((...args) => void out.push(args.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...args) => void errors.push(args.join(" ")));
  vi.stubEnv("SUPABASE_DB_URL", "");
  db.end.mockClear();
  db.connect.mockReset().mockResolvedValue({ client: { end: db.end }, label: "db.example:5432/postgres" });
  db.inspect.mockReset().mockResolvedValue({ categories: 2, products: 3, kept: [] });
  db.replaceMenu.mockReset().mockResolvedValue({ categories: 2, sections: 2, products: 3 });
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  scratch.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

describe("runImport: help", () => {
  it("prints the usage and the shared options, and does nothing else", async () => {
    const result = await run(["--help"]);
    expect(result.out).toContain("Usage: test");
    expect(result.out).toContain("--dry-run");
    expect(result.out).toContain("--replace-all");
    expect(result.out).toContain("--force");
    expect(db.connect).not.toHaveBeenCalled();
    expect(result.exitCode).toBeUndefined();
  });
});

describe("runImport: reading and checking", () => {
  it("shows what the source returned, per category and in total", async () => {
    const { out: text } = await run(["--dry-run"]);
    expect(text).toContain("Test source");
    expect(text).toContain("Comida (cocina): 1 sections, 2 products");
    expect(text).toContain("Bebidas (bar): 1 sections, 1 products");
    expect(text).toContain("Total: 2 categories, 2 sections, 3 products (0 with a photo)");
  });

  it("prints the source's notes", async () => {
    const { out: text } = await run(["--dry-run"]);
    expect(text).toContain("- a source note");
  });

  it("adds the template's hints after them: here, a category the QR menu does not know", async () => {
    const unknown = [{ slug: "postres", name: "Postres", sections: [{ name: "FLANES", products: [product("Flan")] }] }];
    const { out: text } = await run(["--dry-run"], async () => ({ menu: unknown, notes: ["a source note"], title: "T" }));
    expect(text.indexOf("- a source note")).toBeLessThan(text.indexOf("Categories not in qrCategories"));
    expect(text).toContain("postres");
  });

  it("passes the flags and positional arguments to the source", async () => {
    const fetchMenu = vi.fn(async () => ({ menu, notes: [], title: "T" }));
    await run(["https://x.co/menu", "--dry-run", "--service", "take_away"], fetchMenu, { service: { type: "string" } });
    expect(fetchMenu).toHaveBeenCalledWith({
      values: expect.objectContaining({ "dry-run": true, service: "take_away" }),
      positionals: ["https://x.co/menu"],
    });
  });

  it("saves the menu as JSON when asked", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cannario-run-"));
    scratch.push(dir);
    const file = join(dir, "menu.json");
    const { out: text } = await run(["--dry-run", "--json", file]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(menu);
    expect(readFileSync(file, "utf8").endsWith("\n")).toBe(true);
    expect(text).toContain(`Saved ${file}`);
  });

  it("stops with a message, and a failing exit code, when the menu is invalid", async () => {
    const bad = [{ slug: "cocina", name: "Comida", sections: [{ name: "X", products: [{ ...product(), price: -5 }] }] }];
    const result = await run(["--dry-run"], async () => ({ menu: bad, notes: [], title: "T" }));
    expect(result.errors).toContain("The extracted menu is not valid");
    expect(result.exitCode).toBe(1);
    expect(db.connect).not.toHaveBeenCalled();
  });

  it("stops when the source returned no products", async () => {
    const result = await run([], async () => ({ menu: [], notes: [], title: "T" }));
    expect(result.errors).toContain("The source returned no products, so there is nothing to import.");
    expect(result.exitCode).toBe(1);
  });

  it("reports a source that fails, and an unknown flag, as errors rather than crashes", async () => {
    const failed = await run(["--dry-run"], async () => {
      throw new Error("Cluvi has no restaurant");
    });
    expect(failed.errors).toContain("Cluvi has no restaurant");
    expect(failed.exitCode).toBe(1);
    process.exitCode = undefined;
    const unknown = await run(["--nope"]);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.errors).toContain("--nope");
  });
});

describe("runImport: the database", () => {
  it("does a dry run without a database when none is configured, and writes nothing", async () => {
    const result = await run(["--dry-run"]);
    expect(result.out).toContain("SUPABASE_DB_URL is not set, so the database was not checked. Nothing was written.");
    expect(db.connect).not.toHaveBeenCalled();
    expect(db.replaceMenu).not.toHaveBeenCalled();
  });

  it("checks the database on a dry run when one is configured, and still writes nothing", async () => {
    vi.stubEnv("SUPABASE_DB_URL", "postgres://x");
    const result = await run(["--dry-run"]);
    expect(result.out).toContain("Database db.example:5432/postgres");
    expect(result.out).toContain("Replaces the categories this import writes: 2 categories and 3 products now, 2 and 3 after.");
    expect(result.out).toContain("Dry run: nothing was written.");
    expect(db.replaceMenu).not.toHaveBeenCalled();
    expect(db.end).toHaveBeenCalledTimes(1);
  });

  it("writes the menu, and says when the site will show it", async () => {
    vi.stubEnv("SUPABASE_DB_URL", "postgres://x");
    const result = await run([]);
    expect(db.replaceMenu).toHaveBeenCalledWith(expect.anything(), menu, { replaceAll: false });
    expect(result.out).toContain("Done: wrote 2 categories, 2 sections and 3 products.");
    expect(result.out).toContain("within the hour");
    expect(result.exitCode).toBeUndefined();
    expect(db.end).toHaveBeenCalledTimes(1);
  });

  it("replaces the whole menu with --replace-all, and says so", async () => {
    vi.stubEnv("SUPABASE_DB_URL", "postgres://x");
    const result = await run(["--replace-all", "--dry-run"]);
    expect(db.inspect).toHaveBeenCalledWith(expect.anything(), menu, { replaceAll: true });
    expect(result.out).toContain("Replaces the whole menu");
  });

  it("lists the categories the import leaves alone, and how to remove them", async () => {
    vi.stubEnv("SUPABASE_DB_URL", "postgres://x");
    db.inspect.mockResolvedValue({ categories: 2, products: 3, kept: ["brunch", "eventos"] });
    const result = await run(["--dry-run"]);
    expect(result.out).toContain("Left untouched (not part of this import): brunch, eventos. Use --replace-all to remove them.");
  });

  it("refuses an import with under half the products it would replace: that looks like a broken extraction", async () => {
    vi.stubEnv("SUPABASE_DB_URL", "postgres://x");
    db.inspect.mockResolvedValue({ categories: 2, products: 40, kept: [] });
    const result = await run([]);
    expect(result.errors).toContain("This import has 3 products and would replace 40.");
    expect(result.errors).toContain("--force");
    expect(result.exitCode).toBe(1);
    expect(db.replaceMenu).not.toHaveBeenCalled();
    expect(db.end).toHaveBeenCalledTimes(1);
  });

  it("writes it anyway with --force", async () => {
    vi.stubEnv("SUPABASE_DB_URL", "postgres://x");
    db.inspect.mockResolvedValue({ categories: 2, products: 40, kept: [] });
    await run(["--force"]);
    expect(db.replaceMenu).toHaveBeenCalledTimes(1);
  });

  it("does not call a first import into an empty database suspicious", async () => {
    vi.stubEnv("SUPABASE_DB_URL", "postgres://x");
    db.inspect.mockResolvedValue({ categories: 0, products: 0, kept: [] });
    await run([]);
    expect(db.replaceMenu).toHaveBeenCalledTimes(1);
  });

  it("reports a failed connection and a failed write as errors, closing the connection either way", async () => {
    vi.stubEnv("SUPABASE_DB_URL", "postgres://x");
    db.connect.mockRejectedValueOnce(new Error("password authentication failed"));
    const connection = await run([]);
    expect(connection.errors).toContain("password authentication failed");
    expect(connection.exitCode).toBe(1);

    process.exitCode = undefined;
    db.replaceMenu.mockRejectedValueOnce(new Error("The database did not insert every row"));
    const write = await run([]);
    expect(write.errors).toContain("did not insert every row");
    expect(write.exitCode).toBe(1);
    expect(db.end).toHaveBeenCalledTimes(1);
  });

  it("leaves no JSON file behind when nothing asked for one", async () => {
    await run(["--dry-run"]);
    expect(existsSync(join(tmpdir(), "menu.json"))).toBe(false);
  });
});
