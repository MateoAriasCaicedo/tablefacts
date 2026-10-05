/* eslint-disable @typescript-eslint/no-explicit-any */
// The prefix and shared-database guards, exercised through importMenu with a fake `pg` client:
// every statement the importer sends is recorded, so we can assert it only ever touches the
// restaurant's own tables. No network, no database.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Query = { sql: string; params?: unknown[] };

const pg = vi.hoisted(() => {
  const state: { queries: Query[]; others: string[]; missing: string | null } = { queries: [], others: [], missing: null };
  const respond = (sql: string, params?: unknown[]) => {
    const text = sql.trim().toLowerCase();
    if (text.includes("information_schema.tables")) {
      if (text.includes("table_name = any")) {
        const wanted = (params?.[0] as string[]) ?? [];
        return { rowCount: wanted.length, rows: wanted.filter((name) => name !== state.missing).map((table_name) => ({ table_name })) };
      }
      return { rowCount: state.others.length, rows: state.others.map((table_name) => ({ table_name })) };
    }
    if (text.includes("count(distinct")) return { rows: [{ categories: 2, products: 3 }] };
    if (text.startsWith("select slug")) return { rows: [] };
    if (text.startsWith("insert into")) return { rowCount: (params?.[0] as unknown[])?.length ?? 0 };
    return { rowCount: 0 };
  };
  return {
    state,
    Client: class {
      async connect() {}
      async end() {}
      async query(sql: string, params?: unknown[]) {
        state.queries.push({ sql, params });
        return respond(sql, params);
      }
    },
  };
});

vi.mock("pg", () => ({ default: { Client: pg.Client } }));

import { importMenu } from "../src/menu/index.mjs";

const product = (name: string) => ({ name, description: null, price: 10, currency: "USD", image_url: null, recommended: false });
const menu = [{ slug: "cocina", name: "Comida", sections: [{ name: "ENTRADAS", products: [product("Pan"), product("Sopa")] }] }];
const url = "postgres://user:pass@db.example:5432/postgres";
const queries = () => pg.state.queries;
const isWrite = (sql: string) => /^(begin|commit|rollback|delete|insert)/i.test(sql.trim());

beforeEach(() => {
  pg.state.queries = [];
  pg.state.others = [];
  pg.state.missing = null;
});

describe("importMenu: table prefix", () => {
  it("targets makibar_menu_* for every statement and never the unprefixed names", async () => {
    await importMenu({ menu, dryRun: true, databaseUrl: url, tablePrefix: "makibar_" });
    expect(queries().length).toBeGreaterThan(0);
    for (const q of queries()) {
      expect(q.sql).not.toMatch(/public\.menu_/);
      expect(q.sql.trim().toLowerCase().startsWith("select")).toBe(true);
    }
    expect(queries().some((q) => q.sql.includes("public.makibar_menu_categories"))).toBe(true);
  });

  it("writes only the prefixed tables on a real import", async () => {
    await importMenu({ menu, databaseUrl: url, tablePrefix: "makibar_" });
    const writes = queries().filter((q) => isWrite(q.sql));
    expect(writes.map((q) => q.sql.split(/\s+/).slice(0, 3).join(" "))).toEqual([
      "begin",
      "delete from public.makibar_menu_categories",
      "insert into public.makibar_menu_categories",
      "insert into public.makibar_menu_sections",
      "insert into public.makibar_menu_products",
      "commit",
    ]);
    for (const q of queries()) expect(q.sql).not.toMatch(/public\.menu_/);
  });

  it("rejects an invalid prefix before opening a connection or running a query", async () => {
    await expect(importMenu({ menu, dryRun: true, databaseUrl: url, tablePrefix: "x; drop table y" })).rejects.toThrow(/not a valid table prefix/);
    expect(queries()).toEqual([]);
  });

  it("works with a prefix even when other restaurants' tables share the database", async () => {
    pg.state.others = ["cannario_menu_categories", "mombasa_menu_categories"];
    const result = await importMenu({ menu, dryRun: true, databaseUrl: url, tablePrefix: "makibar_" });
    expect(result.dryRun).toBe(true);
    expect(queries().some((q) => q.sql.includes("public.makibar_menu_categories"))).toBe(true);
    // It never needed to list the other restaurants' tables.
    expect(queries().some((q) => q.sql.includes("like '%_menu_categories'"))).toBe(false);
  });

  it("never logs the connection string", async () => {
    const lines: string[] = [];
    await importMenu({ menu, dryRun: true, databaseUrl: "postgres://user:s3cret@db.example:5432/postgres", tablePrefix: "makibar_", log: (message: string) => lines.push(message) });
    expect(lines.join("\n")).not.toContain("s3cret");
    expect(lines.join("\n")).not.toContain("postgres://");
  });

  it("reports the resolved table names and the counts it would delete", async () => {
    const lines: string[] = [];
    const result = await importMenu({ menu, dryRun: true, databaseUrl: url, tablePrefix: "makibar_", log: (message: string) => lines.push(message) });
    expect(result.database?.tables).toEqual(["public.makibar_menu_categories", "public.makibar_menu_sections", "public.makibar_menu_products"]);
    expect(lines.join("\n")).toContain("Target tables: public.makibar_menu_categories, public.makibar_menu_sections, public.makibar_menu_products");
    expect(lines.join("\n")).toContain("2 categories and 3 products now");
  });

  it("empties only the prefixed categories table when replaceAll is confirmed", async () => {
    await importMenu({ menu, databaseUrl: url, tablePrefix: "makibar_", replaceAll: true, yes: true });
    const writes = queries().filter((q) => isWrite(q.sql));
    expect(writes[0].sql).toBe("begin");
    expect(writes[1].sql).toBe("delete from public.makibar_menu_categories");
    expect(writes[1].params).toBeUndefined();
    expect(writes.at(-1)?.sql).toBe("commit");
    for (const q of queries()) expect(q.sql).not.toMatch(/public\.menu_/);
  });
});

describe("importMenu: dry run", () => {
  it("a dry run without a database URL does not check the tables", async () => {
    const result = await importMenu({ menu, dryRun: true, databaseUrl: "" });
    expect(result.database).toBeNull();
    expect(queries()).toEqual([]);
  });
});

describe("importMenu: a shared database", () => {
  it("stops an unprefixed import when another restaurant's tables are present, with zero writes", async () => {
    pg.state.others = ["cannario_menu_categories", "makibar_menu_categories"];
    const error: any = await importMenu({ menu, databaseUrl: url }).catch((e) => e);
    expect(error.code).toBe("ECONFIG");
    expect(error.message).toContain("This database has other restaurants' menu tables (cannario_menu_categories, makibar_menu_categories)");
    expect(queries().some((q) => isWrite(q.sql))).toBe(false);
  });

  it("--allow-unprefixed proceeds, but a whole-menu replace is still refused (even with --yes)", async () => {
    pg.state.others = ["makibar_menu_categories"];
    const allowed = await importMenu({ menu, dryRun: true, databaseUrl: url, allowUnprefixed: true });
    expect(allowed.dryRun).toBe(true);
    expect(queries().some((q) => q.sql.includes("public.menu_categories"))).toBe(true);
    expect(queries().some((q) => isWrite(q.sql))).toBe(false);

    queries().length = 0;
    const error: any = await importMenu({ menu, databaseUrl: url, allowUnprefixed: true, replaceAll: true, yes: true }).catch((e) => e);
    expect(error.code).toBe("ECONFIG");
    expect(error.message).toContain("Refusing to replace the whole menu");
    expect(queries().some((q) => isWrite(q.sql))).toBe(false);
  });

  it("--allow-unprefixed writes the unprefixed tables when the import is scoped", async () => {
    pg.state.others = ["makibar_menu_categories"];
    await importMenu({ menu, databaseUrl: url, allowUnprefixed: true });
    const writes = queries().filter((q) => isWrite(q.sql));
    expect(writes.map((q) => q.sql.split(/\s+/).slice(0, 3).join(" "))).toEqual([
      "begin",
      "delete from public.menu_categories",
      "insert into public.menu_categories",
      "insert into public.menu_sections",
      "insert into public.menu_products",
      "commit",
    ]);
  });

  it("refuses replaceAll without --yes, before any query", async () => {
    const error: any = await importMenu({ menu, databaseUrl: url, replaceAll: true }).catch((e) => e);
    expect(error.code).toBe("EUSAGE");
    expect(error.option).toBe("yes");
    expect(queries()).toEqual([]);
  });

  it("--dry-run issues only selects and never begin", async () => {
    await importMenu({ menu, dryRun: true, databaseUrl: url, tablePrefix: "makibar_", replaceAll: true, yes: true });
    expect(queries().length).toBeGreaterThan(0);
    expect(queries().every((q) => q.sql.trim().toLowerCase().startsWith("select"))).toBe(true);
  });
});
