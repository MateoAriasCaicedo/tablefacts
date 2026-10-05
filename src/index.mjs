// Public API of the library. Every function is silent unless you pass `log`, never calls
// process.exit and never reads .env for you (the CLI does that; call loadEnv() or set the variables).
// Failures it raises on purpose are TablefactsError, with a `code` to tell them apart.
// Types of the options and results, defined in lib/types.mjs.
/** @typedef {import('./lib/types.mjs').Log} Log */
/** @typedef {import('./lib/types.mjs').Env} Env */
/** @typedef {import('./lib/types.mjs').ResearchOptions} ResearchOptions */
/** @typedef {import('./lib/types.mjs').ResearchResult} ResearchResult */
/** @typedef {import('./lib/types.mjs').ResearchPhoto} ResearchPhoto */
/** @typedef {import('./lib/types.mjs').ResearchProfile} ResearchProfile */
/** @typedef {import('./lib/types.mjs').InstagramOptions} InstagramOptions */
/** @typedef {import('./lib/types.mjs').TripadvisorOptions} TripadvisorOptions */
/** @typedef {import('./lib/types.mjs').PhotoSummary} PhotoSummary */
/** @typedef {import('./lib/types.mjs').PhotoFailure} PhotoFailure */
/** @typedef {import('./lib/types.mjs').Menu} Menu */
/** @typedef {import('./lib/types.mjs').MenuCategory} MenuCategory */
/** @typedef {import('./lib/types.mjs').MenuSection} MenuSection */
/** @typedef {import('./lib/types.mjs').MenuProduct} MenuProduct */
/** @typedef {import('./lib/types.mjs').MenuTotals} MenuTotals */
/** @typedef {import('./lib/types.mjs').MenuImage} MenuImage */
/** @typedef {import('./lib/types.mjs').MenuSourceConfig} MenuSourceConfig */
/** @typedef {import('./lib/types.mjs').CluviConfig} CluviConfig */
/** @typedef {import('./lib/types.mjs').RawConfig} RawConfig */
/** @typedef {import('./lib/types.mjs').ImportOptions} ImportOptions */
/** @typedef {import('./lib/types.mjs').ImportMenuOptions} ImportMenuOptions */
/** @typedef {import('./lib/types.mjs').ImportCluviOptions} ImportCluviOptions */
/** @typedef {import('./lib/types.mjs').ImportImageMenuOptions} ImportImageMenuOptions */
/** @typedef {import('./lib/types.mjs').ListMenuImagesOptions} ListMenuImagesOptions */
/** @typedef {import('./lib/types.mjs').ImportResult} ImportResult */
/** @typedef {import('./lib/types.mjs').PriceFormat} PriceFormat */
/** @typedef {import('./lib/types.mjs').VisionProvider} VisionProvider */
/** @typedef {import('./lib/types.mjs').LoadEnvOptions} LoadEnvOptions */
/** @typedef {import('./lib/types.mjs').TablefactsErrorCode} TablefactsErrorCode */

export { research } from './research/index.mjs'
export { downloadInstagram } from './instagram/index.mjs'
export { downloadTripadvisor } from './tripadvisor/index.mjs'
export {
  importMenu,
  importCluvi,
  importImageMenu,
  listMenuImages,
  validateMenu,
  countMenu,
  normalizePages,
  parsePrice,
  providers,
  defaultProvider,
} from './menu/index.mjs'
export { projectRoot, workDir, workDirIn, envFiles } from './lib/project.mjs'
export { TablefactsError } from './lib/errors.mjs'
export { loadEnv } from './lib/env.mjs'
