// pdfjs-dist is an optional peer dependency: only PDF menus need it, so it loads
// on use (the way lib/playwright.mjs loads Playwright). Reading text needs only
// pdfjs-dist; rendering a page for a scan or a product-photo screenshot also
// needs the canvas pdfjs-dist loads itself (@napi-rs/canvas).
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { TablefactsError } from "../../lib/errors.mjs";

const require = createRequire(import.meta.url);

const INSTALL = "npm install pdfjs-dist @napi-rs/canvas";

/** True when the throw is the module being absent (rather than a real load failure). */
const missing = (error, name) => error?.code === "ERR_MODULE_NOT_FOUND" && String(error?.message ?? "").includes(name);

const notInstalled = (error) =>
  new TablefactsError(`pdfjs-dist is not installed. Reading a PDF menu needs it. Install it with: ${INSTALL}`, "EDEPENDENCY", { cause: error });

// The were-loaded flag keeps the successful load out of every call's try/catch.
let pdfjsModule;

/**
 * The pdfjs module plus the asset URLs it needs (standard fonts and CMaps) so
 * text is extracted and pages render without the warnings Node otherwise logs.
 * @returns {Promise<{ pdfjs: any, standardFontDataUrl: string, cMapUrl: string }>}
 */
export async function loadPdfjs() {
  if (pdfjsModule) return pdfjsModule;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // Resolved from this file, so it finds the copy the project installed.
    const root = dirname(require.resolve("pdfjs-dist/package.json"));
    pdfjsModule = {
      pdfjs,
      standardFontDataUrl: pathToFileURL(join(root, "standard_fonts") + "/").href,
      cMapUrl: pathToFileURL(join(root, "cmaps") + "/").href,
    };
    return pdfjsModule;
  } catch (error) {
    if (missing(error, "pdfjs-dist")) throw notInstalled(error);
    throw error;
  }
}

/** A rendering failure caused by the canvas package being absent becomes EDEPENDENCY with the install hint. */
export function renderError(error) {
  const message = String(error?.message ?? "");
  if (missing(error, "@napi-rs/canvas") || (/canvas/i.test(message) && /cannot find module|not installed|err_module|napi/i.test(message))) {
    return new TablefactsError(
      `Rendering a PDF page needs the canvas package. Install it with: ${INSTALL}`,
      "EDEPENDENCY",
      { cause: error },
    );
  }
  return error;
}
