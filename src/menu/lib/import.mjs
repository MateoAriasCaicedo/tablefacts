// The import itself, with no command line in it: check a menu, optionally save
// it as JSON, compare it with the database and replace it. Silent unless given
// a `log`; failures are thrown, never turned into an exit code.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveEnv } from "../../lib/env.mjs";
import { optionError, TablefactsError } from "../../lib/errors.mjs";
import { normalizeLog } from "../../lib/log.mjs";
import { projectRoot, resolveIn } from "../../lib/project.mjs";
import { connect, inspect, replaceMenu } from "./db.mjs";
import { countMenu, validateMenu } from "./menu.mjs";

/** Things the site needs that this menu does not give it, read from the template's own files. */
export async function templateHints(menu, { projectDir } = {}) {
  const hints = [];
  const content = join(projectRoot(projectDir), "frontend/src/content");
  // A file that is missing means the template was reorganised: skip its hint rather than guess.
  const read = (file) => readFile(join(content, file), "utf8").catch(() => null);
  const [siteTs, qrTs, dictionary] = await Promise.all([read("site.ts"), read("qr.ts"), read("dictionary.ts")]);

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

  if (qrTs) {
    const known = new Set([...qrTs.matchAll(/^\s*id:\s*"([^"]+)"/gm)].map((m) => m[1]));
    const missing = menu.map((c) => c.slug).filter((slug) => !known.has(slug));
    if (missing.length) hints.push(`Categories not in qrCategories (content/qr.ts): ${missing.join(", ")}. They render, but are not prerendered or in the sitemap and have no index photo; their names and blurbs also need keys in both dictionaries (menu.categories, qr.categoryBlurbs).`);
  }

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
 * Checks `menu` (the shape of lib/menu.mjs) and writes it to the database.
 * `notes` are what the source wants the user to know; `title` heads the log.
 * Resolves to `{ totals, notes, written, dryRun, database }`, `database` being
 * `{ label, current }` once it was inspected and null when it was not reached.
 * @param {import('../../lib/types.mjs').ImportMenuOptions} options
 * @returns {Promise<import('../../lib/types.mjs').ImportResult>}
 */
export async function importMenu({
  menu,
  notes = [],
  title = "",
  dryRun = false,
  json,
  replaceAll = false,
  force = false,
  databaseUrl,
  env,
  projectDir,
  log: logOption,
} = {}) {
  const log = normalizeLog(logOption);
  databaseUrl ??= resolveEnv(env).SUPABASE_DB_URL;
  let client;
  try {
    validateMenu(menu);
    const totals = countMenu(menu);

    log(`${title}\n`);
    for (const category of menu) {
      const n = countMenu([category]);
      log(`  ${category.name} (${category.slug}): ${n.sections} sections, ${n.products} products`);
    }
    log(`  Total: ${totals.categories} categories, ${totals.sections} sections, ${totals.products} products (${totals.withImage} with a photo)`);
    if (json) {
      await writeFile(resolveIn(projectDir, json), JSON.stringify(menu, null, 2) + "\n");
      log(`\nSaved ${json}`);
    }
    const allNotes = [...notes, ...(await templateHints(menu, { projectDir }))];
    for (const line of allNotes) log(`\n- ${line}`, "warn");

    const result = { totals, notes: allNotes, written: false, dryRun: !!dryRun, database: null };
    if (!totals.products) throw new TablefactsError("The source returned no products, so there is nothing to import.", "EFAILED");
    if (dryRun && !databaseUrl) {
      log("\nDry run: SUPABASE_DB_URL is not set, so the database was not checked. Nothing was written.", "warn");
      return result;
    }

    const scope = { replaceAll: !!replaceAll };
    let label;
    ({ client, label } = await connect(databaseUrl, { env }));
    const current = await inspect(client, menu, scope);
    result.database = { label, current };
    log(`\nDatabase ${label}`);
    log(`  ${scope.replaceAll ? "Replaces the whole menu" : `Replaces the categories this import writes`}: ${current.categories} categories and ${current.products} products now, ${totals.categories} and ${totals.products} after.`);
    if (current.kept.length) log(`  Left untouched (not part of this import): ${current.kept.join(", ")}. Use \`replaceAll\` to remove them.`, "warn");

    if (current.products > 0 && totals.products < current.products / 2 && !force) {
      throw optionError("force", `This import has ${totals.products} products and would replace ${current.products}. That looks like a broken extraction, so nothing was written. Use \`force\` if it is intended.`, "EFAILED");
    }
    if (dryRun) {
      log("\nDry run: nothing was written.");
      return result;
    }
    const done = await replaceMenu(client, menu, scope);
    result.written = true;
    log(`\nDone: wrote ${done.categories} categories, ${done.sections} sections and ${done.products} products.`);
    log("The site shows them within the hour (the menu pages revalidate hourly).");
    return result;
  } finally {
    await client?.end().catch(() => {});
  }
}
