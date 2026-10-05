// Where a tool looks for the project it works on and where it keeps its own files.
// The project is the folder the command is run in (or TABLEFACTS_PROJECT), never the folder this
// library is installed in, so one copy of tablefacts serves every template. A library caller can
// pass a `projectDir` instead.
import { isAbsolute, join, resolve } from 'node:path'

/**
 * `dir` when given, else TABLEFACTS_PROJECT, else the current folder.
 * @param {string} [dir]
 * @returns {string}
 */
export const projectRoot = (dir) => resolve(dir ?? process.env.TABLEFACTS_PROJECT ?? process.cwd())

/**
 * A path under <root>/.tablefacts, where output, caches and browser profiles go (git-ignore it).
 * @param {string | undefined} root project folder (see projectRoot)
 * @param {...string} parts
 * @returns {string}
 */
export const workDirIn = (root, ...parts) => join(projectRoot(root), '.tablefacts', ...parts)

/**
 * A path under <project>/.tablefacts for the project in TABLEFACTS_PROJECT or the current folder.
 * @param {...string} parts
 * @returns {string}
 */
export const workDir = (...parts) => workDirIn(undefined, ...parts)

/**
 * The env files read, first one wins: <root>/.env, then <root>/data/.env (older templates).
 * @param {string} [root] project folder (see projectRoot)
 * @returns {string[]}
 */
export const envFiles = (root) => [join(projectRoot(root), '.env'), join(projectRoot(root), 'data', '.env')]

/**
 * An absolute path: relative paths resolve against the project (`projectDir`) when given, else the current folder.
 * @param {string | undefined} projectDir
 * @param {string} path
 * @returns {string}
 */
export const resolveIn = (projectDir, path) => (isAbsolute(path) ? path : resolve(projectDir ? projectRoot(projectDir) : process.cwd(), path))
