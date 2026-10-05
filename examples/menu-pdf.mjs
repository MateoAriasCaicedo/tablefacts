// Reads a PDF menu (a local file or URL) and checks the import without writing anything.
// Pass an images folder to also save the dish photos printed on the pages.
//   node examples/menu-pdf.mjs carta.pdf
//   node examples/menu-pdf.mjs carta.pdf ./carta-fotos
// Needs pdfjs-dist (npm install pdfjs-dist @napi-rs/canvas) and a vision key in .env.
import { TablefactsError, importImageMenu, loadEnv } from 'tablefacts'

const [source, images] = process.argv.slice(2)

loadEnv() // the vision provider's key comes from the project's .env

try {
  const result = await importImageMenu({ urls: [source], imageDir: images, dryRun: true, log: console.log })
  const { categories, sections, products } = result.totals
  console.log(`\n${categories} categories, ${sections} sections, ${products} products (${result.totals.withImage} with a photo).`)
} catch (err) {
  if (!(err instanceof TablefactsError)) throw err
  // err.code tells what to fix: ECONFIG (no key), EDEPENDENCY (install pdfjs-dist), EFAILED (bad PDF or refused import)
  console.error(`${err.code}: ${err.message}`)
  process.exitCode = 1
}
