// The command every menu source is: extract, check, write to Supabase.
// A source script (src/menu/<source>/extract.mjs) only says how to get the
// menu; the flags, the checks and the write are the same for all of them.
import { parseArgs } from "node:util";
import { loadEnv } from "../../lib/env.mjs";
import { cliMessage, exitCodeFor } from "../../lib/errors.mjs";
import { importMenu } from "./import.mjs";

/** The option names the menu library uses in its messages, as the flags the CLI shows. */
export const menuFlags = {
  only: "--only",
  provider: "--provider",
  model: "--model",
  minWidth: "--min-width",
  tablePrefix: "--table-prefix <prefix>",
  allowUnprefixed: "--allow-unprefixed",
  yes: "--yes",
  replaceAll: "--replace-all",
  force: "--force",
  dryRun: "--dry-run",
};

/** A library message with option names turned into flags. */
export const flagText = (message) => cliMessage({ message }, menuFlags);

/**
 * The CLI's logger: info and warn lines (progress, notes, "left untouched") go to stdout as
 * they always did, errors to stderr, and option names in the text become flags.
 */
export const cliLog = (message, level = "info") => {
  const text = flagText(message);
  if (level === "error") console.error(text);
  else console.log(text);
};

const commonOptions = `
Options:
  --dry-run       extract and check, show what would change, write nothing
  --json <file>   also save the extracted menu as JSON
  --table-prefix <prefix>  this restaurant's table prefix (e.g. makibar_); overrides the config
  --allow-unprefixed       write the unprefixed menu_* tables on a single-restaurant database
  --replace-all   replace the whole menu, not only the categories in this import
  --yes           confirm --replace-all (it empties the target tables)
  --force         write even if the import has far fewer products than it replaces
  -h, --help      show this help

The database is SUPABASE_DB_URL in .env (see .env.example).
`;

/**
 * `fetchMenu({ values, positionals })` returns `{ menu, notes, title }`: the
 * menu in the shape of lib/menu.mjs, what the source wants the user to know,
 * and a heading. `options` are the source's own flags, in util.parseArgs form.
 */
export async function runImport({ usage, options = {}, fetchMenu }) {
  try {
    const { values, positionals } = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        "dry-run": { type: "boolean" },
        json: { type: "string" },
        "table-prefix": { type: "string" },
        "allow-unprefixed": { type: "boolean" },
        "replace-all": { type: "boolean" },
        yes: { type: "boolean" },
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
    const fetched = await fetchMenu({ values, positionals });
    // `tablePrefix` is only passed when the flag is given, so it overrides the source's config
    // instead of replacing it with undefined.
    const overrides = values["table-prefix"] === undefined ? {} : { tablePrefix: values["table-prefix"] };
    await importMenu({
      ...fetched,
      dryRun: !!values["dry-run"],
      json: values.json,
      replaceAll: !!values["replace-all"],
      force: !!values.force,
      allowUnprefixed: !!values["allow-unprefixed"],
      yes: !!values.yes,
      ...overrides,
      log: cliLog,
    });
  } catch (error) {
    console.error(`
${cliMessage(error, menuFlags)}`);
    process.exitCode = exitCodeFor(error);
  }
}
