// The command every menu source is: extract, check, write to Supabase.
// A source script (data/menu/<source>/extract.mjs) only says how to get the
// menu; the flags, the checks and the write are the same for all of them.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "../../lib/project.mjs";
import { parseArgs } from "node:util";
import { connect, inspect, loadEnv, replaceMenu } from "./db.mjs";
import { countMenu, validateMenu } from "./menu.mjs";

const commonOptions = `
Options:
  --dry-run       extract and check, show what would change, write nothing
  --json <file>   also save the extracted menu as JSON
  --replace-all   replace the whole menu, not only the categories in this import
  --force         write even if the import has far fewer products than it replaces
  -h, --help      show this help

The database is SUPABASE_DB_URL in .env (see .env.example).
`;

/** Things the site needs that this menu does not give it, read from the template's own files. */
export function templateHints(menu) {
  const hints = [];
  const content = join(projectRoot(), "frontend/src/content");
  const read = (file) => {
    try {
      return readFileSync(join(content, file), "utf8");
    } catch {
      return null; // the template was reorganised: skip the hint rather than guess
    }
  };

  const siteTs = read("site.ts");
  const signatureBlock = siteTs?.match(/signatureMenu\s*=\s*\{([^}]*)\}/)?.[1] ?? "";
  const signatureCategory = signatureBlock.match(/category:\s*"([^"]+)"/)?.[1];
  const signature = signatureBlock.match(/section:\s*"([^"]+)"/)?.[1];
  if (signature && !menu.find((c) => c.slug === signatureCategory)?.sections.some((s) => s.name === signature)) {
    hints.push(`The home page cocktail list reads the "${signature}" section of the "${signatureCategory}" category (signatureMenu in content/site.ts). This menu has none, so that list will be empty.`);
  }

  if (siteTs) {
    const allowed = new Set([...(siteTs.match(/menuImageHosts[^=]*=\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]));
    const hosts = new Set();
    for (const c of menu) for (const s of c.sections) for (const p of s.products ?? []) {
      try { if (p.image_url) hosts.add(new URL(p.image_url).hostname); } catch { /* reported by the import checks */ }
    }
    const missing = [...hosts].filter((host) => !allowed.has(host) && !host.endsWith(".supabase.co"));
    if (missing.length) hints.push(`Photos load from ${missing.join(", ")}, which is not in menuImageHosts (content/site.ts): next/image will refuse them until it is.`);
  }

  const qrTs = read("qr.ts");
  if (qrTs) {
    const known = new Set([...qrTs.matchAll(/^\s*id:\s*"([^"]+)"/gm)].map((m) => m[1]));
    const missing = menu.map((c) => c.slug).filter((slug) => !known.has(slug));
    if (missing.length) hints.push(`Categories not in qrCategories (content/qr.ts): ${missing.join(", ")}. They render, but are not prerendered or in the sitemap and have no index photo; their names and blurbs also need keys in both dictionaries (menu.categories, qr.categoryBlurbs).`);
  }

  const dictionary = read("dictionary.ts");
  const blocks = [...(dictionary ?? "").matchAll(/^\s*sections:\s*\{([^}]*)\}/gm)].map((m) => m[1]);
  if (blocks.length) {
    const keysOf = (block) => new Set([...block.matchAll(/^\s*(?:"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/gm)].map((m) => m[1] ?? m[2]));
    const mapped = blocks.map(keysOf);
    const unmapped = [...new Set(menu.flatMap((c) => c.sections.map((s) => s.name)))].filter((name) => mapped.some((keys) => !keys.has(name)));
    if (unmapped.length) hints.push(`${unmapped.length} sections have no display name in both languages (menu.sections in dictionary.ts) and will show as stored, in capitals: ${unmapped.join(", ")}.`);
  }
  return hints;
}

/**
 * `fetchMenu({ values, positionals })` returns `{ menu, notes, title }`: the
 * menu in the shape of lib/menu.mjs, what the source wants the user to know,
 * and a heading. `options` are the source's own flags, in util.parseArgs form.
 */
export async function runImport({ usage, options = {}, fetchMenu }) {
  let client;
  try {
    const { values, positionals } = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        "dry-run": { type: "boolean" },
        json: { type: "string" },
        "replace-all": { type: "boolean" },
        force: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        ...options,
      },
    });
    if (values.help) {
      console.log(usage + commonOptions);
      return;
    }

    loadEnv();
    const { menu, notes = [], title } = await fetchMenu({ values, positionals });
    validateMenu(menu);
    const total = countMenu(menu);

    console.log(`${title}\n`);
    for (const category of menu) {
      const n = countMenu([category]);
      console.log(`  ${category.name} (${category.slug}): ${n.sections} sections, ${n.products} products`);
    }
    console.log(`  Total: ${total.categories} categories, ${total.sections} sections, ${total.products} products (${total.withImage} with a photo)`);
    if (values.json) {
      writeFileSync(values.json, JSON.stringify(menu, null, 2) + "\n");
      console.log(`\nSaved ${values.json}`);
    }
    for (const line of [...notes, ...templateHints(menu)]) console.log(`\n- ${line}`);

    if (!total.products) throw new Error("The source returned no products, so there is nothing to import.");
    if (values["dry-run"] && !process.env.SUPABASE_DB_URL) {
      console.log("\nDry run: SUPABASE_DB_URL is not set, so the database was not checked. Nothing was written.");
      return;
    }

    const scope = { replaceAll: !!values["replace-all"] };
    let label;
    ({ client, label } = await connect());
    const current = await inspect(client, menu, scope);
    console.log(`\nDatabase ${label}`);
    console.log(`  ${scope.replaceAll ? "Replaces the whole menu" : `Replaces the categories this import writes`}: ${current.categories} categories and ${current.products} products now, ${total.categories} and ${total.products} after.`);
    if (current.kept.length) console.log(`  Left untouched (not part of this import): ${current.kept.join(", ")}. Use --replace-all to remove them.`);

    if (current.products > 0 && total.products < current.products / 2 && !values.force) {
      throw new Error(`This import has ${total.products} products and would replace ${current.products}. That looks like a broken extraction, so nothing was written. Use --force if it is intended.`);
    }
    if (values["dry-run"]) {
      console.log("\nDry run: nothing was written.");
      return;
    }
    const done = await replaceMenu(client, menu, scope);
    console.log(`\nDone: wrote ${done.categories} categories, ${done.sections} sections and ${done.products} products.`);
    console.log("The site shows them within the hour (the menu pages revalidate hourly).");
  } catch (error) {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  } finally {
    await client?.end().catch(() => {});
  }
}
