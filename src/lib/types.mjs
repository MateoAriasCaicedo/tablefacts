// Shared type definitions of the public API. This module exports nothing at runtime; it exists so
// the generated declarations (types/lib/types.d.ts) hold the option and result shapes.

/**
 * Progress callback. `level` is 'info' by default; 'warn' for problems the run goes on from,
 * 'error' for failures. Every tool is silent unless given one.
 * @typedef {(message: string, level?: 'info' | 'warn' | 'error') => void} Log
 */

/**
 * An environment object such as process.env.
 * @typedef {Record<string, string | undefined>} Env
 */

/**
 * @typedef {object} ResearchOptions
 * @property {string} name Restaurant name. Required.
 * @property {string} [location] "City, Country".
 * @property {string} [country] ISO country code, narrows the search (CO, MX, US...).
 * @property {string} [website]
 * @property {string} [instagram] Handle or URL.
 * @property {string} [tripadvisor] TripAdvisor page URL.
 * @property {string} [linktree] Linktree or other link-in-bio page.
 * @property {number} [photos] Also download up to n Google and n website photos (reference only).
 * @property {boolean} [render] Render the website with Playwright (sites built in JavaScript).
 * @property {boolean} [google] Set false to skip Google even if a key is available. Default true.
 * @property {string} [googleKey] Default: env.GOOGLE_PLACES_API_KEY.
 * @property {Env} [env] Environment the keys are read from. Default process.env.
 * @property {string} [out] Output folder; relative paths resolve against projectDir. Default <project>/.tablefacts/research/<slug>.
 * @property {string} [projectDir] Project folder. Default: TABLEFACTS_PROJECT or the current folder.
 * @property {Log} [log]
 */

/**
 * @typedef {object} ResearchPhoto
 * @property {string} file File name inside <outDir>/photos.
 * @property {string} source Where it was downloaded from.
 * @property {string} [alt]
 */

/**
 * @typedef {object} ResearchProfile
 * @property {Record<string, any>} fields Each field carries value, source and confidence.
 * @property {string[]} [warnings]
 */

/**
 * @typedef {object} ResearchResult
 * @property {ResearchProfile} profile The merged profile.
 * @property {string[]} notes What each source found or failed to find.
 * @property {ResearchPhoto[]} photos
 * @property {string} outDir Absolute output folder.
 * @property {{ profile: string, report: string, setupAnswers: string }} files Absolute paths of the written files.
 */

/**
 * @typedef {object} PhotoFailure
 * @property {string} item The post, profile or page that failed.
 * @property {string} reason
 */

/**
 * @typedef {object} PhotoSummary
 * @property {number} saved
 * @property {number} skipped Files that were already there.
 * @property {PhotoFailure[]} failed
 * @property {{ name: string, url: string }[]} [found] Only present when dryRun is true.
 */

/**
 * At least one of `links`, `file` or `profile` is required.
 * @typedef {object} InstagramOptions
 * @property {string[]} [links] Post links.
 * @property {string} [file] Text file with one link per line (resolved against projectDir).
 * @property {string} out Folder the images are saved to (resolved against projectDir). Required.
 * @property {string} [profile] Profile link or handle (with or without the at sign): download a whole profile (videos skipped).
 * @property {number | 'all'} [pages] With `profile`, batches of posts to load. Default 1.
 * @property {string} [cdp] Edge debugging address, e.g. http://localhost:9222. Started if nothing listens.
 * @property {string} [edgeDir] Profile folder for the Edge that is started.
 * @property {boolean} [viaGoogle] Reach toolzu through a Google search (CLI: --google). Default false.
 * @property {string} [browser] Installed browser channel: 'msedge' or 'chrome'.
 * @property {string} [userDataDir] Persistent browser profile (resolved against projectDir).
 * @property {string} [projectDir] Project folder. Default: TABLEFACTS_PROJECT or the current folder.
 * @property {boolean} [headed] Show the browser window.
 * @property {boolean} [dryRun] List what would be saved without saving.
 * @property {boolean} [debug] Keep screenshots in <out>/_debug.
 * @property {Log} [log]
 */

/**
 * @typedef {object} TripadvisorOptions
 * @property {string[]} links Restaurant page links. At least one valid link is required.
 * @property {string} out Folder the images are saved to (resolved against projectDir). Required.
 * @property {string} [cdp] Edge debugging address. Default http://localhost:9222.
 * @property {string} [edgeDir] Profile folder for the Edge that is started.
 * @property {number} [max] Stop after n photos per restaurant.
 * @property {string} [projectDir] Project folder. Default: TABLEFACTS_PROJECT or the current folder.
 * @property {boolean} [dryRun]
 * @property {boolean} [debug]
 * @property {Log} [log]
 */

/**
 * @typedef {object} MenuProduct
 * @property {string} name
 * @property {string | null} [description]
 * @property {number} price Finite and not negative.
 * @property {string} currency ISO 4217 code, e.g. COP.
 * @property {string | null} [image_url] An https URL.
 * @property {boolean} [recommended]
 */

/**
 * @typedef {object} MenuSection
 * @property {string} name
 * @property {MenuProduct[]} products
 */

/**
 * @typedef {object} MenuCategory
 * @property {string} slug The key the site's dictionaries use.
 * @property {string} name
 * @property {MenuSection[]} sections
 */

/** @typedef {MenuCategory[]} Menu */

/**
 * @typedef {object} MenuTotals
 * @property {number} categories
 * @property {number} sections
 * @property {number} products
 * @property {number} withImage
 */

/**
 * @typedef {object} ImportOptions
 * @property {boolean} [dryRun] Check and report, write nothing.
 * @property {string} [json] Also save the extracted menu as JSON at this path (resolved against projectDir).
 * @property {string} [tablePrefix] This restaurant's table prefix (e.g. "makibar_"); empty for the unprefixed menu_* tables. Default "": importCluvi/importImageMenu fall back to the source config's.
 * @property {boolean} [allowUnprefixed] Write the unprefixed menu_* tables even when other restaurants' prefixed tables exist. Only for a single-restaurant database.
 * @property {boolean} [yes] Confirm a destructive `replaceAll`, which empties the target tables.
 * @property {boolean} [replaceAll] Replace the whole menu, not only the categories in this import. Needs `yes`.
 * @property {boolean} [force] Write even if the import has far fewer products than it replaces.
 * @property {string} [databaseUrl] Default: env.SUPABASE_DB_URL.
 * @property {Env} [env] Environment the database URL and keys are read from. Default process.env.
 * @property {string} [projectDir] Project folder. Default: TABLEFACTS_PROJECT or the current folder.
 * @property {Log} [log]
 */

/**
 * @typedef {object} ImportResult
 * @property {MenuTotals} totals
 * @property {string[]} notes
 * @property {boolean} written
 * @property {boolean} dryRun
 * @property {{ label: string, tables: string[], current: { categories: number, products: number, kept: string[] } } | null} database Null when the database was not reached.
 */

/**
 * @typedef {ImportOptions & { menu: Menu, notes?: string[], title?: string }} ImportMenuOptions
 */

/**
 * Restaurant-specific part of the Cluvi source (src/menu/cluvi/config.mjs).
 * @typedef {object} CluviConfig
 * @property {string} [tablePrefix] This restaurant's table prefix in a shared database (e.g. "cannario_"); empty for the unprefixed menu_* tables.
 * @property {string} [url] Any page of the restaurant's Cluvi menu.
 * @property {{ slug: string, name: string, from: string[] }[]} [categories] Cluvi main categories folded into each site category.
 * @property {Record<string, string>} [sections] Cluvi subcategory to section name.
 */

/**
 * Restaurant-specific part of the picture-menu source (src/menu/raw/config.mjs).
 * @typedef {object} RawConfig
 * @property {string} [tablePrefix] This restaurant's table prefix in a shared database (e.g. "mombasa_"); empty for the unprefixed menu_* tables.
 * @property {string} [url] Page with the menu pictures, or a direct image URL.
 * @property {string} currency ISO code of the prices.
 * @property {string} [thousands] Thousands separator the menu prints. Default ".".
 * @property {string} [decimal] Decimal separator the menu prints. Default ",".
 * @property {number} [scale] Multiplies every price. Default 1.
 * @property {number} [imageScale] Resolution a PDF page is rendered at before its product photos are screenshot. Default 2.
 * @property {{ slug: string, name: string, groups?: ('food' | 'drink')[] }[]} [categories] Category that lists each group.
 * @property {Record<string, string>} [placeIn] Section title to category slug.
 * @property {Record<string, string>} [sections] Section title to the name stored.
 * @property {string[]} [skipSections] Section titles to leave out.
 */

/** @typedef {CluviConfig | RawConfig} MenuSourceConfig */

/**
 * @typedef {object} CluviMenuOptions
 * @property {string} [url] Default: the config's.
 * @property {'on_table' | 'delivery' | 'take_away'} [service]
 * @property {string} [lang]
 * @property {CluviConfig} [config] Default: the cluvi config.mjs.
 */

/** @typedef {ImportOptions & CluviMenuOptions} ImportCluviOptions */

/**
 * @typedef {object} ImageMenuReadOptions
 * @property {string[]} [urls] Pages or image URLs, or PDF file paths/URLs. Default: the config's url.
 * @property {string | number[]} [only] Pages to read, e.g. '1,3-5' or [1, 3, 4, 5].
 * @property {string} [provider] Vision provider, see `providers`. Default MENU_VISION_PROVIDER or `defaultProvider`.
 * @property {string} [model]
 * @property {number} [minWidth] Ignore images declaring a smaller width. Default 500.
 * @property {string} [apiKey] Default: the provider's key in env.
 * @property {boolean} [refresh] Read the pages again instead of using the saved transcriptions.
 * @property {string} [imageDir] Also save the dish photos printed on a PDF page here (resolved against projectDir). Enables photo extraction.
 * @property {string} [imageBaseUrl] https folder the saved photos will be published at; fills each product's image_url with it plus the file name.
 * @property {'auto' | 'always'} [imageBoxes] How photos are found: 'auto' (default) reads a PDF page from its text and matches placed photos by position, using the model's boxes only when the page has none; 'always' reads every PDF page as a picture so the model boxes every dish's photo. Default 'auto'.
 * @property {RawConfig} [config] Default: the raw config.mjs.
 */

/** @typedef {ImportOptions & ImageMenuReadOptions} ImportImageMenuOptions */

/**
 * @typedef {object} ListMenuImagesOptions
 * @property {string[]} [urls]
 * @property {string | number[]} [only]
 * @property {number} [minWidth]
 * @property {string} [projectDir] Project folder. Default: TABLEFACTS_PROJECT or the current folder.
 * @property {RawConfig} [config]
 */

/**
 * @typedef {object} MenuImage
 * @property {number} number Position as the CLI's --list numbers it.
 * @property {string} url The image URL, or "<pdf path or URL>#<page number>" for a PDF page.
 * @property {string} alt
 * @property {'image' | 'pdf'} [kind] Where the page came from. Default: 'image'.
 * @property {number} [chars] Characters of text a PDF page has (0 means it is a scan).
 */

/**
 * @typedef {object} PriceFormat
 * @property {string} [thousands] Default ".".
 * @property {string} [decimal] Default ",".
 * @property {number} [scale] Default 1.
 */

/**
 * @typedef {object} VisionProvider
 * @property {string} label
 * @property {string} keyName Environment variable holding the API key.
 * @property {string} defaultModel
 */

/**
 * @typedef {object} LoadEnvOptions
 * @property {string} [projectDir] Project folder whose .env files are read.
 * @property {string[]} [files] Exactly these files instead of the project's.
 * @property {Env} [env] Object the variables are set on. Default process.env.
 */

/** @typedef {'EUSAGE' | 'ECONFIG' | 'EDEPENDENCY' | 'EFAILED'} TablefactsErrorCode */

export {}
