// Cluvi as a library: read the menu of a restaurant and import it.
import { TablefactsError } from "../../lib/errors.mjs";
import { importMenu } from "../lib/import.mjs";
import defaultConfig from "./config.mjs";
import { fetchCluvi, normalizeCluvi } from "./source.mjs";

/**
 * Reads and normalizes the menu: `{ menu, notes, title }`, ready for importMenu.
 * `config` is the restaurant-specific part (see config.mjs); the default is that file's.
 */
export async function fetchCluviMenu({ url, service, lang, config = defaultConfig } = {}) {
  if (!(url ?? config.url)) throw new TablefactsError("No Cluvi menu URL: pass url, or set url in the cluvi config.", "ECONFIG");
  const fetched = await fetchCluvi({ url: url ?? config.url, service, lang });
  const { menu, notes, currency } = normalizeCluvi(fetched, config);
  const { supplier } = fetched;
  return {
    menu,
    notes,
    title: `Cluvi: ${supplier.label} (id ${supplier.id}), ${fetched.service} menu in ${currency}`,
  };
}

/**
 * Reads the menu from Cluvi and imports it. Takes importMenu's options too.
 * @param {import('../../lib/types.mjs').ImportCluviOptions} [options]
 * @returns {Promise<import('../../lib/types.mjs').ImportResult>}
 */
export async function importCluvi({ url, service, lang, config, ...importOptions } = {}) {
  return importMenu({ ...(await fetchCluviMenu({ url, service, lang, config })), ...importOptions });
}
