// Downloads the photos of a TripAdvisor restaurant page into a folder.
// Needs Playwright (npm install playwright). Only download photos you may use.
//   node examples/photos.mjs <restaurant-link> ./photos
import { TablefactsError, downloadTripadvisor } from 'tablefacts'

const [link, out] = process.argv.slice(2)

try {
  const { saved, skipped, failed } = await downloadTripadvisor({ links: [link], out, log: console.log })
  console.log(`\nSaved ${saved}, already there ${skipped}, failed ${failed.length}`)
} catch (err) {
  if (err instanceof TablefactsError && err.code === 'EDEPENDENCY') console.error('Run: npm install playwright')
  else if (err instanceof TablefactsError && err.code === 'EUSAGE') console.error(err.message)
  else throw err
  process.exitCode = 1
}
