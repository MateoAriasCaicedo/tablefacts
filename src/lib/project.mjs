// Where a tool looks for the project it works on and where it keeps its own files.
// The project is the folder the command is run in (or EXTRACT_PROJECT), never the folder this
// library is installed in, so one copy of extract serves every template.
import { join, resolve } from 'node:path'

export const projectRoot = () => resolve(process.env.EXTRACT_PROJECT ?? process.cwd())

/** A path under <project>/.extract, where output, caches and browser profiles go (git-ignore it). */
export const workDir = (...parts) => join(projectRoot(), '.extract', ...parts)

/** The env files read, first one wins: <project>/.env, then <project>/data/.env (older templates). */
export const envFiles = () => [join(projectRoot(), '.env'), join(projectRoot(), 'data', '.env')]
