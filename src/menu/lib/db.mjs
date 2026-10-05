// Writes a menu (see lib/menu.mjs) into the Supabase tables of
// supabase/migrations/0001_menu.sql over a direct Postgres connection.
// The tables are the restaurant's own set (lib/tables.mjs): on a shared
// database each restaurant has a `<prefix>_menu_*` set, and assertTarget()
// refuses to guess before anything is written.
//
// The connection string (SUPABASE_DB_URL) is a privileged credential: it
// bypasses row level security, which only allows public reads. It lives in
// .env, which is git-ignored, and is never read by the site: do not copy
// it into frontend/.env or into a NEXT_PUBLIC_ variable.
import { randomUUID } from "node:crypto";
import { resolveEnv } from "../../lib/env.mjs";
import { TablefactsError } from "../../lib/errors.mjs";
import { menuTables, validateTablePrefix } from "./tables.mjs";

/** Opens the connection. `label` names the target without the credentials. */
export async function connect(url, { env } = {}) {
  url ??= resolveEnv(env).SUPABASE_DB_URL;
  if (!/^postgres(ql)?:\/\//i.test(url ?? "")) {
    throw new TablefactsError(
      "SUPABASE_DB_URL is not set to a postgres:// connection string.\n" +
        "Copy .env.example to .env and paste the pooler URL from the Supabase dashboard (Connect > Session pooler).",
      "ECONFIG",
    );
  }
  if (url.includes("[YOUR-PASSWORD]")) {
    throw new TablefactsError("SUPABASE_DB_URL still contains [YOUR-PASSWORD]: replace it with the database password.", "ECONFIG");
  }
  let target;
  try {
    target = new URL(url);
  } catch {
    throw new TablefactsError("SUPABASE_DB_URL is not a valid connection string (special characters in the password must be URL-encoded).", "ECONFIG");
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({
    connectionString: url,
    // Supabase's pooler certificate chains to Supabase's own root CA, which Node
    // does not trust, so verification fails by default. The connection is still
    // encrypted. Put `sslmode` in the URL to choose something else.
    ssl: target.searchParams.has("sslmode") ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();
  return { client, label: `${target.hostname}:${target.port || 5432}${target.pathname}` };
}

/** Says what is wrong when the migration has not been applied to this database. */
function explain(error, tables) {
  if (error.code === "42P01") {
    error.message = `The menu tables do not exist. Apply supabase/migrations/0001_menu.sql to this database first (expected ${Object.values(tables).join(", ")}).`;
  }
  return error;
}

/**
 * Refuses to touch another site's tables before anything is written.
 *
 * Checks the three target tables exist (pointing at the migration when they do not). Then, when
 * no prefix is set, lists the other restaurants' `<prefix>_menu_categories` tables: any of them
 * means this database is shared, so the import stops unless the caller confirmed it targets the
 * one unprefixed set with `allowUnprefixed`. A whole-menu `replaceAll` is refused in that case
 * whatever the flags say, because deleting every unprefixed row could destroy another site.
 * Only reads; returns `{ prefix, tables, others }`.
 * @param {any} client
 * @param {{ tablePrefix?: string, allowUnprefixed?: boolean, replaceAll?: boolean }} [options]
 */
export async function assertTarget(client, { tablePrefix = "", allowUnprefixed = false, replaceAll = false } = {}) {
  const prefix = validateTablePrefix(tablePrefix);
  const tables = menuTables(prefix);
  const short = Object.values(tables).map((name) => name.replace(/^public\./, ""));

  const { rows } = await client.query(
    "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[])",
    [short],
  );
  const present = new Set(rows.map((row) => row.table_name));
  const missing = short.filter((name) => !present.has(name));
  if (missing.length) {
    throw new TablefactsError(
      `The menu tables do not exist. Apply supabase/migrations/0001_menu.sql to this database first (expected ${Object.values(tables).join(", ")}; missing ${missing.map((name) => `public.${name}`).join(", ")}).`,
      "ECONFIG",
    );
  }

  if (prefix) return { prefix, tables, others: [] };

  // `_` is a LIKE wildcard, so the query is only a coarse filter: it can also return names such as
  // "xmenu_categories". The endsWith check keeps only real `<prefix>_menu_categories` tables (and
  // excludes the unprefixed "menu_categories" itself); without it a table like "xmenu_categories"
  // would be mistaken for another restaurant's set.
  const existing = await client.query(
    "select table_name from information_schema.tables where table_schema = 'public' and table_name like '%_menu_categories' order by table_name",
  );
  const others = existing.rows.map((row) => row.table_name).filter((name) => name.endsWith("_menu_categories"));
  if (!others.length) return { prefix, tables, others };

  if (replaceAll) {
    throw new TablefactsError(
      `Refusing to replace the whole menu: this database has other restaurants' menu tables (${others.join(", ")}). Set \`tablePrefix\` in your config so the delete targets only this restaurant's tables.`,
      "ECONFIG",
    );
  }
  if (!allowUnprefixed) {
    throw new TablefactsError(
      `This database has other restaurants' menu tables (${others.join(", ")}). Set tablePrefix in your config or pass --table-prefix so the import cannot touch the wrong tables.`,
      "ECONFIG",
    );
  }
  return { prefix, tables, others };
}

/** What an import would replace: the categories it writes, or the whole menu. */
export async function inspect(client, menu, { replaceAll = false, tablePrefix = "" } = {}) {
  const tables = menuTables(tablePrefix);
  const slugs = replaceAll ? null : menu.map((category) => category.slug);
  try {
    const { rows } = await client.query(
      `select count(distinct c.id)::int as categories, count(p.id)::int as products
         from ${tables.categories} c
         left join ${tables.sections} s on s.category_id = c.id
         left join ${tables.products} p on p.section_id = s.id
        where $1::text[] is null or c.slug = any($1)`,
      [slugs],
    );
    const kept = slugs
      ? (await client.query(`select slug from ${tables.categories} where slug <> all($1) order by sort_order`, [slugs])).rows.map((row) => row.slug)
      : [];
    return { ...rows[0], kept };
  } catch (error) {
    throw explain(error, tables);
  }
}

/**
 * Replaces the menu in one transaction, so readers see the old menu or the new
 * one and a failure changes nothing. By default only the categories in `menu`
 * are replaced (deleting a category cascades to its sections and products);
 * `replaceAll` empties the menu first. Ids are generated here so the rows can
 * be inserted in bulk, a column at a time. `tablePrefix` is the restaurant's
 * own table set; the delete is scoped to it, never to another site's tables.
 */
export async function replaceMenu(client, menu, { replaceAll = false, tablePrefix = "" } = {}) {
  const tables = menuTables(tablePrefix);
  const categories = menu.map((c, i) => ({ id: randomUUID(), slug: c.slug, name: c.name, sort_order: i + 1 }));
  const sections = menu.flatMap((c, ci) =>
    c.sections.map((s, si) => ({ id: randomUUID(), category_id: categories[ci].id, name: s.name, sort_order: si + 1, products: s.products })),
  );
  // `recommended` is NOT NULL DEFAULT false, but inserting through unnest sends an explicit null, which skips the default.
  const products = sections.flatMap((s) => s.products.map((p, i) => ({ ...p, recommended: p.recommended === true, section_id: s.id, sort_order: i + 1 })));
  const column = (rows, key) => rows.map((row) => row[key] ?? null);

  try {
    await client.query("begin");
    if (replaceAll) await client.query(`delete from ${tables.categories}`);
    else await client.query(`delete from ${tables.categories} where slug = any($1::text[])`, [column(categories, "slug")]);

    const inserted = [
      await client.query(
        `insert into ${tables.categories} (id, slug, name, sort_order) select * from unnest($1::uuid[], $2::text[], $3::text[], $4::int[])`,
        ["id", "slug", "name", "sort_order"].map((key) => column(categories, key)),
      ),
      await client.query(
        `insert into ${tables.sections} (id, category_id, name, sort_order) select * from unnest($1::uuid[], $2::uuid[], $3::text[], $4::int[])`,
        ["id", "category_id", "name", "sort_order"].map((key) => column(sections, key)),
      ),
      await client.query(
        `insert into ${tables.products} (section_id, name, description, price, currency, image_url, recommended, sort_order)
         select * from unnest($1::uuid[], $2::text[], $3::text[], $4::numeric[], $5::text[], $6::text[], $7::boolean[], $8::int[])`,
        ["section_id", "name", "description", "price", "currency", "image_url", "recommended", "sort_order"].map((key) => column(products, key)),
      ),
    ];
    const expected = [categories.length, sections.length, products.length];
    if (inserted.some((result, i) => result.rowCount !== expected[i])) {
      throw new Error("The database did not insert every row; nothing was changed.");
    }
    await client.query("commit");
    return { categories: categories.length, sections: sections.length, products: products.length };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw explain(error, tables);
  }
}
