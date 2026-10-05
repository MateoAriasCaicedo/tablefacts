// Compiled by tests/types.test.ts against the generated declarations. `@ts-expect-error` lines
// must fail to compile: if one stops failing, the types became too loose.
import {
  TablefactsError,
  countMenu,
  defaultProvider,
  downloadInstagram,
  downloadTripadvisor,
  envFiles,
  importCluvi,
  importImageMenu,
  importMenu,
  listMenuImages,
  loadEnv,
  normalizePages,
  parsePrice,
  projectRoot,
  providers,
  research,
  validateMenu,
  workDir,
  workDirIn,
} from "../../types/index.mjs";
import type { Env, ImportResult, Log, Menu, PhotoSummary, ResearchResult } from "../../types/index.mjs";

const env: Env = { GOOGLE_PLACES_API_KEY: "k" };
const log: Log = (message, level) => void [message, level];
// @ts-expect-error a log level other than info, warn or error
const badLog: Log = (message: string, level?: "debug") => void [message, level];
void badLog;

export async function run() {
  const researched: ResearchResult = await research({ name: "Casa", location: "Bogota", country: "CO", photos: 2, render: false, env, projectDir: ".", out: "out", log });
  const fields: Record<string, unknown> = researched.profile.fields;
  const files: string[] = [researched.files.profile, researched.files.report, researched.files.setupAnswers, researched.outDir, ...researched.notes];
  void [fields, files, researched.photos[0]?.file];
  // @ts-expect-error `name` is required
  await research({ location: "x" });
  // @ts-expect-error unknown option
  await research({ name: "x", nmae: "y" });

  const ig: PhotoSummary = await downloadInstagram({ links: ["https://www.instagram.com/p/x/"], out: "photos", viaGoogle: true, projectDir: ".", pages: "all", log });
  const reason: string = ig.failed[0]?.reason ?? "";
  const item: string = ig.failed[0]?.item ?? "";
  void [reason, item, ig.found?.[0]?.url, ig.saved + ig.skipped];
  // @ts-expect-error failures are named `item`, not `post`
  void ig.failed[0]?.post;
  // @ts-expect-error `out` is required
  await downloadInstagram({ links: [] });
  // @ts-expect-error the option is `viaGoogle`
  await downloadInstagram({ out: "x", google: true });

  await downloadTripadvisor({ links: ["https://www.tripadvisor.com/Restaurant_Review-x.html"], out: "photos", max: 5, projectDir: ".", dryRun: true });
  // @ts-expect-error `links` is required
  await downloadTripadvisor({ out: "photos" });

  const menu: Menu = [{ slug: "bar", name: "Bebidas", sections: [{ name: "VINOS", products: [{ name: "Tinto", price: 10, currency: "COP", image_url: null }] }] }];
  validateMenu(menu);
  const totals = countMenu(menu);
  const products: number = totals.products;
  // @ts-expect-error a category needs sections
  const broken: Menu = [{ slug: "bar", name: "Bebidas" }];
  void [products, broken];

  const imported: ImportResult = await importMenu({ menu, notes: [], title: "t", dryRun: true, json: "menu.json", replaceAll: false, force: false, tablePrefix: "makibar_", allowUnprefixed: false, yes: false, databaseUrl: "postgres://x", env, projectDir: ".", log });
  const kept: string[] = imported.database?.current.kept ?? [];
  const tables: string[] = imported.database?.tables ?? [];
  void [kept, tables, imported.written, imported.totals.withImage];
  // @ts-expect-error `menu` is required
  await importMenu({ dryRun: true });

  await importCluvi({ url: "https://x.cluvi.co/x", service: "on_table", lang: "es", dryRun: true, config: { categories: [{ slug: "a", name: "A", from: ["B"] }] } });
  // @ts-expect-error not a Cluvi service
  await importCluvi({ service: "pickup" });

  await importImageMenu({ urls: ["https://x.test/menu.jpg"], only: "1,3-5", provider: "anthropic", minWidth: 400, refresh: true, config: { currency: "COP" }, env, dryRun: true });
  await importImageMenu({ only: [1, 3] });
  const images = await listMenuImages({ urls: ["https://x.test/"], only: [1], config: { currency: "COP" } });
  const first: string | undefined = images[0]?.url;
  void first;

  const priced: number | null = parsePrice("$95.000", { thousands: ".", decimal: ",", scale: 1 });
  const normalized = normalizePages([{ number: 1, sections: [] }], { currency: "COP" });
  void [priced, normalized.menu, normalized.currency];
  const label: string = providers[defaultProvider].label;
  void label;
}

const root: string = projectRoot();
const dir: string = workDir("a", "b") + workDirIn(undefined, "c");
const files: string[] = envFiles(root);
const read: string[] = loadEnv({ projectDir: root, files, env });
void [dir, read];
// @ts-expect-error unknown loadEnv option
loadEnv({ dir: "x" });

try {
  await run();
} catch (error) {
  if (error instanceof TablefactsError) {
    const code: "EUSAGE" | "ECONFIG" | "EDEPENDENCY" | "EFAILED" = error.code;
    const option: string | undefined = error.option;
    const cause: unknown = error.cause;
    void [code, option, cause];
    // @ts-expect-error not a TablefactsError code
    const wrong: "ENOENT" = error.code;
    void wrong;
  }
}
