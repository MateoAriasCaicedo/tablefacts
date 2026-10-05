import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error plain .mjs modules without type declarations
import { envFiles, loadEnv, projectRoot, workDir, workDirIn } from "../src/index.mjs";
// @ts-expect-error plain .mjs modules without type declarations
import { templateHints } from "../src/menu/lib/import.mjs";
// @ts-expect-error plain .mjs modules without type declarations
import { downloadPage, pageId } from "../src/menu/raw/source.mjs";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tablefacts-project-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("project helpers", () => {
  it("projectRoot(dir) resolves dir; without it uses TABLEFACTS_PROJECT, then the cwd", () => {
    expect(projectRoot(dir)).toBe(resolve(dir));
    vi.stubEnv("TABLEFACTS_PROJECT", dir);
    expect(projectRoot()).toBe(resolve(dir));
    expect(projectRoot("elsewhere")).toBe(resolve("elsewhere"));
    vi.stubEnv("TABLEFACTS_PROJECT", "");
    delete process.env.TABLEFACTS_PROJECT;
    expect(projectRoot()).toBe(resolve(process.cwd()));
  });

  it("workDirIn builds a path under <root>/.tablefacts; workDir stays variadic", () => {
    expect(workDirIn(dir, "cache", "x")).toBe(join(resolve(dir), ".tablefacts", "cache", "x"));
    vi.stubEnv("TABLEFACTS_PROJECT", dir);
    expect(workDir("a", "b")).toBe(join(resolve(dir), ".tablefacts", "a", "b"));
  });

  it("envFiles(root) lists .env then data/.env", () => {
    expect(envFiles(dir)).toEqual([join(resolve(dir), ".env"), join(resolve(dir), "data", ".env")]);
  });
});

describe("loadEnv", () => {
  it("reads a project's .env without overriding set variables, and returns the files read", () => {
    writeFileSync(join(dir, ".env"), "TF_TEST_NEW=from-file\nTF_TEST_SET=from-file\n");
    vi.stubEnv("TF_TEST_SET", "already");
    delete process.env.TF_TEST_NEW;
    try {
      expect(loadEnv({ projectDir: dir })).toEqual([join(resolve(dir), ".env")]);
      expect(process.env.TF_TEST_NEW).toBe("from-file");
      expect(process.env.TF_TEST_SET).toBe("already");
    } finally {
      delete process.env.TF_TEST_NEW;
    }
  });

  it("reads exactly `files` when given and skips missing ones", () => {
    const file = join(dir, "custom.env");
    writeFileSync(file, "TF_TEST_CUSTOM=yes\n");
    try {
      expect(loadEnv({ files: [join(dir, "nope.env"), file] })).toEqual([file]);
      expect(process.env.TF_TEST_CUSTOM).toBe("yes");
    } finally {
      delete process.env.TF_TEST_CUSTOM;
    }
  });
});

describe("projectDir", () => {
  it("templateHints reads the template in projectDir", async () => {
    const content = join(dir, "frontend", "src", "content");
    mkdirSync(content, { recursive: true });
    writeFileSync(join(content, "qr.ts"), 'export const qrCategories = [\n  { id: "cocina" },\n]\n');
    const menu = [{ name: "Postres", slug: "postres", sections: [] }];
    const hints: string[] = await templateHints(menu, { projectDir: dir });
    expect(hints.some((h) => h.includes("Categories not in qrCategories") && h.includes("postres"))).toBe(true);
    const none: string[] = await templateHints(menu, { projectDir: join(dir, "empty") });
    expect(none).toEqual([]);
  });

  it("downloadPage caches under <projectDir>/.tablefacts/cache", async () => {
    const png = new Uint8Array([9, 9]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(png, { status: 200, headers: { "content-type": "image/png" } })));
    const page = await downloadPage({ url: "https://x.co/a.png" }, "host.test", { projectDir: dir });
    expect(page.dir).toBe(join(resolve(dir), ".tablefacts", "cache", "host.test"));
    expect(existsSync(join(page.dir, `${pageId("https://x.co/a.png")}.png`))).toBe(true);
  });
});
