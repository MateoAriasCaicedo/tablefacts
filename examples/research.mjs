// Gathers a restaurant's public facts.
//   node examples/research.mjs "Gaucho" "Medellín, Colombia"
import { loadEnv, research } from 'tablefacts'

const [name, location] = process.argv.slice(2)

loadEnv() // GOOGLE_PLACES_API_KEY is optional; without it OpenStreetMap and the website still work

const { profile, outDir, files } = await research({ name, location, log: console.log })

console.log(`\n${Object.keys(profile.fields).length} fields, written to ${outDir}`)
console.log(`Read first: ${files.report}`)
