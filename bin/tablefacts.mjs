#!/usr/bin/env node
// One entry point for every extraction tool: `tablefacts <tool> [args]`.
// Each tool stays a plain script that reads process.argv, so the dispatcher only picks the
// script and hands over the rest of the arguments.

const tools = {
  research: ['research/research.mjs', "Gather a restaurant's public facts into a report"],
  'photos instagram': ['instagram/download.mjs', 'Download photos from Instagram posts or a profile'],
  'photos tripadvisor': ['tripadvisor/photos.mjs', 'Download the photos of a TripAdvisor restaurant page'],
  'menu cluvi': ['menu/cluvi/extract.mjs', 'Import a menu from Cluvi'],
  'menu raw': ['menu/raw/extract.mjs', 'Import a menu from photos or PDFs'],
}

const args = process.argv.slice(2)
const two = `${args[0]} ${args[1]}`
const name = tools[two] ? two : tools[args[0]] ? args[0] : null

if (!name) {
  const list = Object.entries(tools).map(([n, [, text]]) => `  ${n.padEnd(20)} ${text}`)
  const wanted = args[0] && args[0] !== '--help' && args[0] !== '-h'
  const text = `Usage: tablefacts <tool> [options]\n\nTools:\n${list.join('\n')}\n\nRun a tool with --help for its options.`
  if (wanted) console.error(`Unknown tool: ${args.slice(0, 2).join(' ')}\n\n${text}`)
  else console.log(text)
  process.exit(wanted ? 2 : 0)
}

process.argv.splice(2, name.split(' ').length)
await import(new URL(`../src/${tools[name][0]}`, import.meta.url).href)
