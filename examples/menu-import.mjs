// Imports a Cluvi menu, or checks it without writing anything.
//   node examples/menu-import.mjs <cluvi-menu-url>            (dry run)
//   node examples/menu-import.mjs <cluvi-menu-url> --write    (writes to Supabase)
import { TablefactsError, importCluvi, loadEnv } from 'tablefacts'

const [url, flag] = process.argv.slice(2)

loadEnv() // SUPABASE_DB_URL comes from the project's .env

try {
  const result = await importCluvi({ url, dryRun: flag !== '--write', log: console.log })
  const { categories, sections, products } = result.totals
  console.log(`\n${categories} categories, ${sections} sections, ${products} products. Written: ${result.written}`)
} catch (err) {
  if (!(err instanceof TablefactsError)) throw err
  // err.code tells what to fix: ECONFIG (missing URL or key), EFAILED (bad or refused import)
  console.error(`${err.code}: ${err.message}`)
  process.exitCode = 1
}
