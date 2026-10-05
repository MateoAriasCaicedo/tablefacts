/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connect, inspect, loadEnv, replaceMenu } from "../src/menu/lib/db.mjs";

type Anything = Record<string, any>;

const scratch: string[] = [];
const envFile = (text: string) => {
  const dir = mkdtempSync(join(tmpdir(), "cannario-env-"));
  scratch.push(dir);
  const file = join(dir, ".env");
  writeFileSync(file, text);
  return file;
};

afterEach(() => {
  scratch.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  for (const key of ["CANNARIO_T_A", "CANNARIO_T_B", "CANNARIO_T_C", "CANNARIO_T_D", "CANNARIO_T_E"]) delete process.env[key];
});

describe("loadEnv", () => {
  it("reads KEY=value lines, quotes, `export` and comments", () => {
    loadEnv(envFile(["# a comment", "CANNARIO_T_A=plain", 'CANNARIO_T_B="quoted value"', "export CANNARIO_T_C='single'", "  CANNARIO_T_D = spaced  ", "not a line"].join("\n")));
    expect(process.env.CANNARIO_T_A).toBe("plain");
    expect(process.env.CANNARIO_T_B).toBe("quoted value");
    expect(process.env.CANNARIO_T_C).toBe("single");
    expect(process.env.CANNARIO_T_D).toBe("spaced");
  });

  it("does not override what the environment already sets, even to empty", () => {
    process.env.CANNARIO_T_A = "from-shell";
    process.env.CANNARIO_T_B = "";
    loadEnv(envFile("CANNARIO_T_A=from-file\nCANNARIO_T_B=from-file"));
    expect(process.env.CANNARIO_T_A).toBe("from-shell");
    expect(process.env.CANNARIO_T_B).toBe("");
  });

  it("copes with Windows line endings and a byte-order mark", () => {
    loadEnv(envFile("﻿CANNARIO_T_A=one\r\nCANNARIO_T_B=two\r\n"));
    expect(process.env.CANNARIO_T_A).toBe("one");
    expect(process.env.CANNARIO_T_B).toBe("two");
  });

  it("ignores a commented-out assignment", () => {
    loadEnv(envFile("#CANNARIO_T_A=hidden"));
    expect(process.env.CANNARIO_T_A).toBeUndefined();
  });

  it("does nothing when the file does not exist", () => {
    expect(() => loadEnv(join(tmpdir(), "cannario-no-such-dir", ".env"))).not.toThrow();
  });
});

describe("connect", () => {
  it("explains a missing connection string", async () => {
    await expect(connect(undefined)).rejects.toThrow(/SUPABASE_DB_URL is not set to a postgres:\/\/ connection string[\s\S]*.env.example/);
    await expect(connect("https://example.com")).rejects.toThrow(/not set to a postgres/);
  });

  it("notices a pasted placeholder password", async () => {
    await expect(connect("postgresql://postgres:[YOUR-PASSWORD]@db.x.supabase.co:5432/postgres")).rejects.toThrow(/still contains \[YOUR-PASSWORD\]/);
  });

  it("explains a string that cannot be parsed, without printing the credentials", async () => {
    const error = await connect("postgres://user:p@ss:word@host:notaport/db").catch((e: Error) => e);
    expect((error as Error).message).toMatch(/not a valid connection string \(special characters in the password must be URL-encoded\)/);
    expect((error as Error).message).not.toContain("p@ss");
  });
});

/** A client that records what it is asked and answers from a script. */
function fakeClient(answer: (sql: string, params?: unknown[]) => Anything | Error = () => ({ rowCount: 0, rows: [] })) {
  const queries: { sql: string; params?: unknown[] }[] = [];
  return {
    queries,
    client: {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        const result = answer(sql, params);
        if (result instanceof Error) throw result;
        return result;
      }),
    },
  };
}

const product = (name: string) => ({ name, description: null, price: 10, currency: "USD", image_url: null, recommended: false });
const menu = [
  { slug: "cocina", name: "Comida", sections: [{ name: "ENTRADAS", products: [product("Pan"), product("Sopa")] }, { name: "FUERTES", products: [product("Lomo")] }] },
  { slug: "bar", name: "Bebidas", sections: [{ name: "VINOS", products: [product("Malbec")] }] },
];

describe("replaceMenu", () => {
  const ok = (counts: Record<string, number>) => (sql: string) => {
    const table = Object.keys(counts).find((name) => sql.startsWith(`insert into public.${name}`));
    return table ? { rowCount: counts[table] } : { rowCount: 0 };
  };
  const good = ok({ menu_categories: 2, menu_sections: 3, menu_products: 4 });

  it("replaces only the categories it writes, in one transaction", async () => {
    const { client, queries } = fakeClient(good);
    expect(await replaceMenu(client, menu)).toEqual({ categories: 2, sections: 3, products: 4 });
    const verbs = queries.map((q) => q.sql.split(/\s+/).slice(0, 3).join(" "));
    expect(verbs).toEqual(["begin", "delete from public.menu_categories", "insert into public.menu_categories", "insert into public.menu_sections", "insert into public.menu_products", "commit"]);
    expect(queries[1].sql).toContain("where slug = any");
    expect(queries[1].params).toEqual([["cocina", "bar"]]);
  });

  it("empties the whole menu first when asked", async () => {
    const { client, queries } = fakeClient(good);
    await replaceMenu(client, menu, { replaceAll: true });
    expect(queries[1].sql).toBe("delete from public.menu_categories");
    expect(queries[1].params).toBeUndefined();
  });

  it("numbers categories, sections and products in display order, and links them by generated ids", async () => {
    const { client, queries } = fakeClient(good);
    await replaceMenu(client, menu);
    const [ids, slugs, , categoryOrder] = queries[2].params as unknown[][];
    expect(slugs).toEqual(["cocina", "bar"]);
    expect(categoryOrder).toEqual([1, 2]);
    const [sectionIds, sectionCategoryIds, sectionNames, sectionOrder] = queries[3].params as unknown[][];
    expect(sectionNames).toEqual(["ENTRADAS", "FUERTES", "VINOS"]);
    expect(sectionOrder).toEqual([1, 2, 1]);
    expect(sectionCategoryIds).toEqual([ids[0], ids[0], ids[1]]);
    const [productSectionIds, productNames, , , , , , productOrder] = queries[4].params as unknown[][];
    expect(productNames).toEqual(["Pan", "Sopa", "Lomo", "Malbec"]);
    expect(productOrder).toEqual([1, 2, 1, 1]);
    expect(productSectionIds).toEqual([sectionIds[0], sectionIds[0], sectionIds[1], sectionIds[2]]);
  });

  it("stores a missing description or photo as null, never as undefined", async () => {
    const { client, queries } = fakeClient(ok({ menu_categories: 1, menu_sections: 1, menu_products: 1 }));
    await replaceMenu(client, [{ slug: "c", name: "C", sections: [{ name: "S", products: [{ name: "P", price: 1, currency: "USD" }] }] }]);
    const params = queries[4].params as unknown[][];
    expect(params[2]).toEqual([null]); // description
    expect(params[5]).toEqual([null]); // image_url
  });

  it("sends `recommended` as false, not null, when a source leaves it out: the column is NOT NULL and an explicit null skips its default", async () => {
    const { client, queries } = fakeClient(ok({ menu_categories: 1, menu_sections: 1, menu_products: 2 }));
    await replaceMenu(client, [
      { slug: "c", name: "C", sections: [{ name: "S", products: [{ name: "P", price: 1, currency: "USD" }, { name: "Q", price: 1, currency: "USD", recommended: true }] }] },
    ]);
    expect((queries[4].params as unknown[][])[6]).toEqual([false, true]);
  });

  it("rolls back, and says nothing was changed, when the database inserts fewer rows than sent", async () => {
    const { client, queries } = fakeClient(ok({ menu_categories: 2, menu_sections: 3, menu_products: 3 }));
    await expect(replaceMenu(client, menu)).rejects.toThrow("did not insert every row; nothing was changed");
    expect(queries.at(-1)?.sql).toBe("rollback");
    expect(queries.some((q) => q.sql === "commit")).toBe(false);
  });

  it("rolls back on a database error, and still reports the original error if the rollback fails too", async () => {
    const failure = new Error("connection lost");
    const { client, queries } = fakeClient((sql) => (sql === "begin" ? { rowCount: 0 } : sql === "rollback" ? new Error("rollback failed") : failure));
    await expect(replaceMenu(client, menu)).rejects.toBe(failure);
    expect(queries.at(-1)?.sql).toBe("rollback");
  });

  it("says to apply the migration when the tables do not exist", async () => {
    const missing = Object.assign(new Error("relation does not exist"), { code: "42P01" });
    const { client } = fakeClient((sql) => (sql.startsWith("delete") ? missing : { rowCount: 0 }));
    await expect(replaceMenu(client, menu)).rejects.toThrow("The menu tables do not exist. Apply supabase/migrations/0001_menu.sql");
  });
});

describe("inspect", () => {
  it("counts what the import would replace, and lists the categories it would leave", async () => {
    const { client, queries } = fakeClient((sql) => (sql.includes("count(distinct") ? { rows: [{ categories: 2, products: 40 }] } : { rows: [{ slug: "brunch" }, { slug: "eventos" }] }));
    expect(await inspect(client, menu)).toEqual({ categories: 2, products: 40, kept: ["brunch", "eventos"] });
    expect(queries[0].params).toEqual([["cocina", "bar"]]);
    expect(queries[1].params).toEqual([["cocina", "bar"]]);
  });

  it("looks at the whole menu, and leaves nothing, when the import replaces all of it", async () => {
    const { client, queries } = fakeClient(() => ({ rows: [{ categories: 3, products: 90 }] }));
    expect(await inspect(client, menu, { replaceAll: true })).toEqual({ categories: 3, products: 90, kept: [] });
    expect(queries).toHaveLength(1);
    expect(queries[0].params).toEqual([null]);
  });

  it("says to apply the migration when the tables do not exist", async () => {
    const { client } = fakeClient(() => Object.assign(new Error("relation does not exist"), { code: "42P01" }));
    await expect(inspect(client, menu)).rejects.toThrow("The menu tables do not exist");
  });
});
