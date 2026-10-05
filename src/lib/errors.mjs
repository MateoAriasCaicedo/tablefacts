// The one error type the library throws on purpose, so callers can tell what went wrong from `code`:
//   EUSAGE      bad or missing arguments (the CLI exits with 2)
//   ECONFIG     missing key, database URL, unknown provider, no config url
//   EDEPENDENCY an optional dependency (such as playwright) is not installed
//   EFAILED     a source failed or was blocked, fetched data did not validate, an unsafe import was refused

export class TablefactsError extends Error {
  /**
   * @param {string} message
   * @param {import('./types.mjs').TablefactsErrorCode} code
   * @param {{ cause?: unknown, option?: string }} [options] `option` names the library option the message is about.
   */
  constructor(message, code, options) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'TablefactsError'
    /** @type {import('./types.mjs').TablefactsErrorCode} */
    this.code = code
    if (options?.option !== undefined) {
      /** The library option the error is about, when it is about one. @type {string=} */
      this.option = options.option
    }
  }
}

/** Bad or missing arguments: the CLIs exit with 2. */
export const usageError = (message) => new TablefactsError(message, 'EUSAGE')

/** The exit code a CLI uses for an error it reports: 2 for bad arguments (EUSAGE), 1 for anything else. */
export const exitCodeFor = (err) => (err?.code === 'EUSAGE' ? 2 : 1)

/** "fooBar" -> "foo-bar". */
export const kebab = (name) => String(name).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

/** An error about a library option. Write the option in backticks in the message, e.g. "`out` is required". */
export const optionError = (option, message, code = 'EUSAGE') => new TablefactsError(message, code, { option })

/** The message with `option` tokens replaced by CLI flag text from `flags` ({ out: '--out <folder>' }). */
export const cliMessage = (err, flags = {}) =>
  String(err?.message ?? err).replace(/`([^`]+)`/g, (token, name) => (Object.hasOwn(flags, name) ? flags[name] : token))
