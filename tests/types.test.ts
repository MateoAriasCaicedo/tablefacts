import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as api from "../src/index.mjs";

const root = resolve(__dirname, "..");

// The same compiler `npx tsc` runs, started directly so npm prints nothing of its own.
const tscBin = resolve(root, "node_modules/typescript/bin/tsc");
const tsc = (...args: string[]) => spawnSync(process.execPath, [tscBin, ...args], { cwd: root, encoding: "utf8", timeout: 90_000 });

describe("generated types", () => {
  beforeAll(() => {
    const build = tsc("-p", "tsconfig.build.json");
    expect(build.stdout + build.stderr).not.toMatch(/error TS/);
    expect(build.status).toBe(0);
  }, 120_000);

  const declarations = () => readFileSync(resolve(root, "types/index.d.mts"), "utf8");
  // Values declared by the generated entry: `export { a, b } from '...'` plus any direct `export declare`.
  const declared = () => {
    const text = declarations();
    const names = new Set<string>();
    for (const m of text.matchAll(/^export \{([^}]*)\} from/gm)) for (const name of m[1].split(",")) if (name.trim()) names.add(name.trim().split(/\s+as\s+/).pop()!);
    for (const m of text.matchAll(/^export declare (?:function|const|class) ([A-Za-z_]+)/gm)) names.add(m[1]);
    return [...names];
  };

  it("declares every runtime export of src/index.mjs", () => {
    expect(Object.keys(api).filter((name) => !declared().includes(name))).toEqual([]);
  });

  it("declares no value that src/index.mjs does not export", () => {
    expect(declared().filter((name) => !Object.keys(api).includes(name))).toEqual([]);
  });

  it("is usable by a TypeScript consumer, and rejects wrong options", () => {
    const check = tsc("--noEmit", "-p", "tests/fixtures/tsconfig.json");
    expect(check.stdout + check.stderr).toBe("");
    expect(check.status).toBe(0);
  }, 120_000);
});
