/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ end: vi.fn(async () => {}), connect: vi.fn(), assertTarget: vi.fn(), inspect: vi.fn(), replaceMenu: vi.fn() }));
vi.mock("../src/menu/lib/db.mjs", () => ({ connect: db.connect, assertTarget: db.assertTarget, inspect: db.inspect, replaceMenu: db.replaceMenu }));

import { importImageMenu, importMenu, listMenuImages } from "../src/menu/index.mjs";
import { cliLog, flagText } from "../src/menu/lib/run.mjs";
import { readPage } from "../src/menu/raw/vision.mjs";

const product = (name = "Pan") => ({ name, description: null, price: 10, currency: "USD", image_url: null, recommended: false });
const menu = [{ slug: "cocina", name: "Comida", sections: [{ name: "ENTRADAS", products: [product("Pan"), product("Sopa")] }] }];

const scratch: string[] = [];
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-menu-opt-"));
  scratch.push(dir);
  return dir;
};

beforeEach(() => {
  vi.stubEnv("SUPABASE_DB_URL", "");
  vi.stubEnv("MENU_VISION_PROVIDER", "");
  db.connect.mockReset().mockResolvedValue({ client: { end: db.end }, label: "db.example:5432/postgres" });
  db.assertTarget.mockReset().mockResolvedValue({
    prefix: "",
    tables: { categories: "public.menu_categories", sections: "public.menu_sections", products: "public.menu_products" },
    others: [],
  });
  db.inspect.mockReset().mockResolvedValue({ categories: 1, products: 2, kept: [] });
  db.replaceMenu.mockReset().mockResolvedValue({ categories: 1, sections: 1, products: 2 });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  scratch.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

describe("env option", () => {
  it("takes the database URL from `env`, not from process.env", async () => {
    const env = { SUPABASE_DB_URL: "postgres://from-env" };
    await importMenu({ menu, dryRun: true, env });
    expect(db.connect).toHaveBeenCalledWith("postgres://from-env", { env });
  });

  it("without a URL in `env` it stays a dry run, even if process.env has one", async () => {
    vi.stubEnv("SUPABASE_DB_URL", "postgres://from-process");
    const result = await importMenu({ menu, dryRun: true, env: {} });
    expect(db.connect).not.toHaveBeenCalled();
    expect(result.database).toBeNull();
  });

  it("`databaseUrl` wins over `env`", async () => {
    await importMenu({ menu, dryRun: true, databaseUrl: "postgres://explicit", env: { SUPABASE_DB_URL: "postgres://from-env" } });
    expect(db.connect.mock.calls[0][0]).toBe("postgres://explicit");
  });

  it("reads the vision provider and its key from `env`", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "from-process");
    const dir = tmp();
    const file = join(dir, "p.jpg");
    await expect(readPage({ file, mediaType: "image/jpeg" }, { provider: "anthropic", env: {} })).rejects.toThrow(/ANTHROPIC_API_KEY is not set/);
    await expect(
      importImageMenu({ urls: ["https://x.co/a.jpg"], projectDir: dir, env: { MENU_VISION_PROVIDER: "nope" } }),
    ).rejects.toThrow(/Unknown provider "nope" \(from `provider` or MENU_VISION_PROVIDER\)/);
  });
});

describe("json option", () => {
  it("resolves against projectDir", async () => {
    const dir = tmp();
    await importMenu({ menu, dryRun: true, databaseUrl: "", json: "out/menu.json", projectDir: dir }).catch(() => {});
    expect(existsSync(join(dir, "out", "menu.json"))).toBe(false); // the folder is not created for you
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(dir, "out"));
    await importMenu({ menu, dryRun: true, databaseUrl: "", json: "out/menu.json", projectDir: dir });
    expect(existsSync(join(dir, "out", "menu.json"))).toBe(true);
    expect(existsSync(join(process.cwd(), "out", "menu.json"))).toBe(false);
  });
});

describe("messages name options, not flags", () => {
  it("force", async () => {
    db.inspect.mockResolvedValue({ categories: 1, products: 40, kept: [] });
    const error: any = await importMenu({ menu, databaseUrl: "postgres://x" }).catch((e) => e);
    expect(error.message).toContain("Use `force` if it is intended.");
    expect(error.message).not.toContain("--force");
    expect(error.option).toBe("force");
    expect(error.code).toBe("EFAILED");
  });

  it("replaceAll goes to the log as a warning", async () => {
    db.inspect.mockResolvedValue({ categories: 1, products: 2, kept: ["brunch"] });
    const lines: [string, string][] = [];
    await importMenu({ menu, notes: ["a note"], dryRun: true, databaseUrl: "postgres://x", log: (m: string, level: string) => lines.push([m, level]) });
    expect(lines.find(([m]) => m.includes("Left untouched"))).toEqual([expect.stringContaining("Use `replaceAll` to remove them."), "warn"]);
    expect(lines.find(([m]) => m.includes("a note"))?.[1]).toBe("warn");
    expect(lines.find(([m]) => m.includes("Total:"))?.[1]).toBe("info");
  });

  it("only", async () => {
    const urls = ["https://x.co/a.jpg", "https://x.co/b.jpg"];
    const bad: any = await listMenuImages({ urls, only: "x" }).catch((e) => e);
    expect(bad.message).toBe('`only` "x" is not a list of pages such as 1,3-5.');
    expect(bad.option).toBe("only");
    expect(bad.code).toBe("EUSAGE");
    await expect(listMenuImages({ urls, only: "9" })).rejects.toThrow("`only` 9 matches none of the 2 pages found.");
  });
});

describe("the CLI turns option names into flags", () => {
  it("flagText", () => {
    expect(flagText("Use `force` or `replaceAll`; `minWidth`, `other`")).toBe("Use --force or --replace-all; --min-width, `other`");
  });

  it("cliLog sends errors to stderr and everything else to stdout, with flags", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    cliLog("Use `replaceAll` to remove them.", "warn");
    cliLog("progress");
    cliLog("Use `force`", "error");
    expect(out.mock.calls).toEqual([["Use --replace-all to remove them."], ["progress"]]);
    expect(err.mock.calls).toEqual([["Use --force"]]);
  });
});
