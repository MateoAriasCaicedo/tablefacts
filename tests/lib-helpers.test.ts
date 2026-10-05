// @ts-nocheck
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consoleLog, noopLog, normalizeLog } from "../src/lib/log.mjs";
import { loadEnv, loadEnvFiles, resolveEnv } from "../src/lib/env.mjs";
import { resolveIn } from "../src/lib/project.mjs";
import { cliMessage, kebab, optionError, TablefactsError } from "../src/lib/errors.mjs";
import { assertImageResponse, writeImage } from "../src/lib/images.mjs";
import { DELAY_MS, newSummary, prepareOut, storeFile } from "../src/lib/photos.mjs";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tablefacts-lib-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("log", () => {
  it("normalizes any log to (message, level)", () => {
    const calls: unknown[][] = [];
    normalizeLog((...a: unknown[]) => calls.push(a))("hi");
    normalizeLog((m: string) => calls.push([m]))("one", "warn");
    expect(calls).toEqual([["hi", "info"], ["one"]]);
    expect(normalizeLog(undefined)).toBe(noopLog);
    expect(() => normalizeLog(undefined)("x", "error")).not.toThrow();
  });
  it("consoleLog sends info to stdout and the rest to stderr", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleLog("a");
    consoleLog("b", "warn");
    consoleLog("c", "error");
    expect(out.mock.calls).toEqual([["a"]]);
    expect(err.mock.calls).toEqual([["b"], ["c"]]);
  });
});

describe("env", () => {
  it("writes into the given env without overriding and returns the files read", () => {
    const a = join(dir, "a.env");
    const b = join(dir, "b.env");
    writeFileSync(a, "X=1\nY='two'\n# Z=3\n");
    writeFileSync(b, "X=9\nW=4\n");
    const env: Record<string, string> = { Y: "keep" };
    expect(loadEnvFiles([a, b, join(dir, "none")], env)).toEqual([a, b]);
    expect(env).toEqual({ Y: "keep", X: "1", W: "4" });
    expect(process.env.W).toBeUndefined();
  });
  it("loadEnv reads the project's .env into env", () => {
    writeFileSync(join(dir, ".env"), "K_TEST_ONE=v\n");
    const env: Record<string, string> = {};
    expect(loadEnv({ projectDir: dir, env })).toEqual([join(dir, ".env")]);
    expect(env.K_TEST_ONE).toBe("v");
    expect(loadEnv({ files: [], env })).toEqual([]);
  });
  it("resolveEnv", () => {
    const e = {};
    expect(resolveEnv(e)).toBe(e);
    expect(resolveEnv()).toBe(process.env);
  });
});

describe("resolveIn", () => {
  it("resolves against the project or the cwd, leaving absolute paths alone", () => {
    expect(resolveIn(dir, "out")).toBe(join(resolve(dir), "out"));
    expect(resolveIn(undefined, "out")).toBe(resolve("out"));
    expect(resolveIn(dir, resolve(dir, "x"))).toBe(resolve(dir, "x"));
  });
});

describe("option errors", () => {
  it("names the option and maps it to a flag for the CLI", () => {
    const err = optionError("out", "`out` is required");
    expect(err).toBeInstanceOf(TablefactsError);
    expect(err.code).toBe("EUSAGE");
    expect(err.option).toBe("out");
    expect(optionError("x", "m", "ECONFIG").code).toBe("ECONFIG");
    expect(cliMessage(err, { out: "--out <folder>" })).toBe("--out <folder> is required");
    expect(cliMessage(optionError("a", "`a` and `b`"), { a: "--a" })).toBe("--a and `b`");
  });
  it("kebab", () => {
    expect(kebab("dryRun")).toBe("dry-run");
    expect(kebab("out")).toBe("out");
  });
});

describe("images", () => {
  const good = { ok: true, status: 200, contentType: "image/jpeg", bytes: Buffer.alloc(10) };
  it("accepts a good image", () => {
    expect(() => assertImageResponse(good)).not.toThrow();
  });
  it("rejects bad responses with EFAILED", () => {
    const msg = (o: object) => {
      try {
        assertImageResponse({ ...good, ...o });
      } catch (e) {
        expect(e.code).toBe("EFAILED");
        return e.message;
      }
    };
    expect(msg({ ok: false, status: 404 })).toBe("HTTP 404");
    expect(msg({ contentType: "text/html" })).toBe("not an image (text/html)");
    expect(msg({ contentType: undefined })).toBe("not an image");
    expect(msg({ minBytes: 100 })).toBe("too small");
    expect(msg({ ok: false, status: 500, label: "x.jpg" })).toBe("x.jpg: HTTP 500");
  });
  it("writeImage creates the folder", async () => {
    const file = join(dir, "a", "b", "i.jpg");
    await writeImage(file, Buffer.from("abc"));
    expect(readFileSync(file, "utf8")).toBe("abc");
  });
});

describe("photos", () => {
  it("newSummary", () => {
    expect(newSummary({ dryRun: false })).toEqual({ saved: 0, skipped: 0, failed: [] });
    expect(newSummary({ dryRun: true }).found).toEqual([]);
    expect(DELAY_MS).toBe(2500);
  });
  it("prepareOut creates dirs as the tools do", async () => {
    const r = await prepareOut({ out: "o", debug: true, projectDir: dir });
    expect(r.outDir).toBe(join(resolve(dir), "o"));
    expect(existsSync(join(r.outDir, "_debug"))).toBe(true);
    const d = await prepareOut({ out: "dry", dryRun: true, projectDir: dir });
    expect(d.debugDir).toBeNull();
    expect(existsSync(d.outDir)).toBe(false);
  });
  it("storeFile handles dry run, existing and new files", async () => {
    const logs: string[] = [];
    const log = (m: string) => logs.push(m);
    const save = vi.fn(async ({ file }: { file: string }) => writeFileSync(file, "x"));
    const dry = newSummary({ dryRun: true });
    await storeFile({ outDir: dir, name: "a.jpg", url: "u", dryRun: true, summary: dry, log, save });
    expect(dry.found).toEqual([{ name: "a.jpg", url: "u" }]);
    const s = newSummary({});
    await storeFile({ outDir: dir, name: "a.jpg", url: "u", dryRun: false, summary: s, log, save });
    await storeFile({ outDir: dir, name: "a.jpg", url: "u", dryRun: false, summary: s, log, save });
    expect(s).toMatchObject({ saved: 1, skipped: 1 });
    expect(save).toHaveBeenCalledTimes(1);
    expect(logs).toEqual(["  a.jpg <- u", "  a.jpg saved", "  a.jpg already there"]);
  });
});
