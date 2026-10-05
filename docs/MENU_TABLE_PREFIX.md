# Menu tables: prefixes and shared databases

How the menu importers (`tablefacts menu cluvi`, `tablefacts menu raw`) decide which Supabase tables to write,
and how that keeps one restaurant's import away from another's data. For the general setup and options see the
[main README](../README.md#supabase-tables) and [src/menu/README.md](../src/menu/README.md).

## Why

One Supabase database often serves several restaurant sites. Each restaurant keeps its own prefixed copies of
the three menu tables, while the unprefixed `menu_*` tables belong to a different, older site:

| Restaurant | Tables |
| --- | --- |
| Cannario | `public.cannario_menu_categories`, `public.cannario_menu_sections`, `public.cannario_menu_products` |
| Mombasa | `public.mombasa_menu_*` |
| Makibar | `public.makibar_menu_*` |
| the older site | `public.menu_categories`, `public.menu_sections`, `public.menu_products` |

`SUPABASE_DB_URL` is a privileged credential that bypasses row level security, so the importer itself is the
only thing that can tell the tables apart. Without a prefix it would write into the older site's tables, and
`--replace-all` would `delete from public.menu_categories` and cascade that site's whole menu away. That is why
the importer now refuses to guess.

## The prefix

A restaurant's prefix is a short lowercase name ending in `_` (`cannario_`, `mombasa_`, `makibar_`,
`cannario_rooftop_`). It is validated against `^[a-z][a-z0-9_]*_$|^$`; an empty prefix means the unprefixed
`menu_*` tables. The importer builds every statement from the resolved names:

```
<prefix> = "makibar_"
categories -> public.makibar_menu_categories
sections   -> public.makibar_menu_sections
products   -> public.makibar_menu_products
```

The validated prefix is the only value interpolated into SQL; the menu itself is always sent as query
parameters. `src/menu/lib/tables.mjs` owns this (`validateTablePrefix`, `menuTables`).

## Configure the prefix

Set it once for the restaurant in the source's `config.mjs`:

```js
export default {
  tablePrefix: "makibar_",
  // ...url, categories, sections, currency
};
```

Or override it for a single run (the flag wins over the config):

```bash
tablefacts menu cluvi --table-prefix makibar_
tablefacts menu raw --table-prefix makibar_
```

The importer default is `""`, so a caller that never sets a prefix keeps the old behaviour.

## What the importer checks before writing

`importMenu` calls `assertTarget()` after connecting and before `replaceMenu()`. Only reads are sent:

1. **The three target tables exist.** If any is missing it stops and names it, pointing at
   `supabase/migrations/0001_menu.sql`.
2. **The database is not shared, unless a prefix is set.** With an empty prefix it lists the `public` tables
   ending in `_menu_categories`. If another restaurant's prefixed set exists, it stops with `ECONFIG` and names
   those tables. `--allow-unprefixed` overrides this check for the legitimate single-restaurant case.
3. **A whole-menu replace is never allowed to guess.** With an empty prefix and another restaurant's tables
   present, `--replace-all` is refused even with `--yes` and `--allow-unprefixed`, because it would empty raw
   `menu_*` rows that may belong to the other site.

A prefix short-circuits step 2: after the three prefixed tables are confirmed, the other restaurants' tables
are irrelevant and are not listed.

## Confirm and replace

The run prints the resolved target tables and the row counts it would delete. `--replace-all` additionally
names the exact tables it will empty and is refused without `--yes` (a whole-table delete is destructive; a
scoped import only deletes the categories it is about to write):

```bash
tablefacts menu cluvi                       # replace the categories in this import
tablefacts menu cluvi --replace-all --yes    # empty the restaurant's tables first, then write
```

The write stays one transaction, so readers see the old menu or the new one.

## Dry runs

```bash
tablefacts menu cluvi --dry-run
```

`--dry-run` extracts, parses, runs the same existence and shared-database checks, and prints what would be
written — but opens no write transaction and sends only `select`s (never `begin`). `--replace-all` does not
need `--yes` under `--dry-run`.

## Errors

| Message | Code | Meaning |
| --- | --- | --- |
| `"MAKIBAR_" is not a valid table prefix: ...` | `ECONFIG` | The prefix fails the allow-list. Fixed before any query. |
| `The menu tables do not exist. Apply supabase/migrations/0001_menu.sql ...` | `ECONFIG` | A target table is missing; the message names which. |
| `This database has other restaurants' menu tables (...) ...` | `ECONFIG` | No prefix and a shared database. Set `tablePrefix` or `--table-prefix`, or `--allow-unprefixed` if this restaurant owns the unprefixed tables. |
| `Refusing to replace the whole menu: this database has other restaurants' menu tables (...) ...` | `ECONFIG` | `--replace-all` with no prefix on a shared database; not overridable. |
| `--replace-all ... needs confirmation: pass --yes.` | `EUSAGE` | `--replace-all` without `--yes` on a real write. |

`err.option` names the library option (`tablePrefix`, `yes`); the CLI prints the flag and exits `2` for
`EUSAGE`, `1` otherwise.

## Library use

```js
import { importCluvi, importMenu } from 'tablefacts'

await importCluvi({
  config: { tablePrefix: 'makibar_', categories: [/* ... */] },
  dryRun: true,   // same checks, no write
})

// an explicit tablePrefix overrides the config's
await importMenu({ menu, tablePrefix: 'makibar_', replaceAll: true, yes: true })
```

`importMenu` takes `tablePrefix`, `allowUnprefixed` and `yes`; `importCluvi`/`importImageMenu` take them too and
fall back to `config.tablePrefix`. The result's `database` is `{ label, tables, current }` once the database was
inspected, `null` when it was not reached. The connection string is never logged.

## Migrating a restaurant to its own prefix

Creating the prefixed tables and the `<prefix>-menu-images` bucket is the template's job
(`supabase/migrations/`, `supabase/storage`); the importers only read and write. To move a restaurant off the
unprefixed tables:

1. Apply the prefixed migration (or copy the three tables) so `public.<prefix>menu_*` exist.
2. Set `tablePrefix` in the restaurant's `config.mjs` (or pass `--table-prefix`).
3. Run `tablefacts menu cluvi --dry-run` and check the printed `Target tables:` and row counts.
4. Run the import for real. The unprefixed `menu_*` tables are left untouched.
