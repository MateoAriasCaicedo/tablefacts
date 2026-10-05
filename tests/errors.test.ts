import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs modules without type declarations
import { TablefactsError, research, importMenu, downloadTripadvisor, downloadInstagram } from "../src/index.mjs";

const codeOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return error as TablefactsError & { code: string };
  }
  throw new Error("expected a rejection");
};

describe("TablefactsError", () => {
  it("is an Error with a code and an optional cause", () => {
    const cause = new Error("inner");
    const error = new TablefactsError("boom", "EFAILED", { cause });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("TablefactsError");
    expect(error.code).toBe("EFAILED");
    expect(error.cause).toBe(cause);
    expect(new TablefactsError("x", "EUSAGE").cause).toBeUndefined();
  });
});

describe("error codes", () => {
  it("research without a name is EUSAGE", async () => {
    const error = await codeOf(() => research({}));
    expect(error).toBeInstanceOf(TablefactsError);
    expect(error.code).toBe("EUSAGE");
    expect(error.message).toBe("research: `name` is required");
  });

  it("downloadTripadvisor without out is EUSAGE", async () => {
    const error = await codeOf(() => downloadTripadvisor({ links: [] }));
    expect(error.code).toBe("EUSAGE");
    expect(error.message).toBe("`out` is required");
  });

  it("downloadInstagram without links is EUSAGE", async () => {
    expect((await codeOf(() => downloadInstagram({ out: "x" }))).code).toBe("EUSAGE");
  });

  it("importMenu with an invalid menu is EFAILED", async () => {
    const error = await codeOf(() => importMenu({ menu: [{ name: "A", slug: "", sections: [] }], dryRun: true }));
    expect(error.code).toBe("EFAILED");
    expect(error.message).toMatch(/^The extracted menu is not valid:/);
  });

  it("importMenu with no products is EFAILED", async () => {
    const menu = [{ name: "Comida", slug: "cocina", sections: [{ name: "ENTRADAS", products: [] }] }];
    const error = await codeOf(() => importMenu({ menu, dryRun: true, projectDir: "." }));
    expect(error.code).toBe("EFAILED");
    expect(error.message).toBe("The source returned no products, so there is nothing to import.");
  });

  it("importMenu that writes without a database url is ECONFIG", async () => {
    const menu = [{ name: "Comida", slug: "cocina", sections: [{ name: "ENTRADAS", products: [{ name: "Arepa", description: "", price: 5000, currency: "COP", image_url: null, recommended: false }] }] }];
    const error = await codeOf(() => importMenu({ menu, databaseUrl: "" }));
    expect(error.code).toBe("ECONFIG");
    expect(error.message).toMatch(/^SUPABASE_DB_URL is not set to a postgres:\/\//);
  });
});

describe("loadPlaywright", () => {
  it("reports a missing playwright as EDEPENDENCY", async () => {
    // A copy of the loader in a folder with no node_modules above it, where playwright cannot resolve.
    const dir = mkdtempSync(join(tmpdir(), "tablefacts-noplaywright-"));
    try {
      for (const file of ["errors.mjs", "playwright.mjs"]) copyFileSync(join(__dirname, "..", "src", "lib", file), join(dir, file));
      const script = `import { loadPlaywright } from ${JSON.stringify(pathToFileURL(join(dir, "playwright.mjs")).href)}
        try { await loadPlaywright(); console.log("loaded") } catch (e) { console.log(JSON.stringify({ code: e.code, message: e.message, cause: !!e.cause })) }`;
      const out = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: dir, encoding: "utf8" }));
      expect(out.code).toBe("EDEPENDENCY");
      expect(out.message).toBe("playwright is not installed. The browser tools need it. Install it with: npm install playwright");
      expect(out.cause).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads playwright when it is installed (a dev dependency here)", async () => {
    // @ts-expect-error plain .mjs module without type declarations
    const { loadPlaywright } = await import("../src/lib/playwright.mjs");
    expect(typeof (await loadPlaywright()).chromium.launch).toBe("function");
  });
});
