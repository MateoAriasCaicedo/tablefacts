// Records what you do on a page, in your own browser, as Playwright code.
// Start Edge with --remote-debugging-port=9222 first, then:
//   node src/instagram/record.mjs [url]
// In the Inspector window press Record, do the steps in the browser tab, copy the code.
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'https://www.google.com/'
const browser = await chromium.connectOverCDP('http://localhost:9222')
const page = await browser.contexts()[0].newPage()
await page.goto(url)
await page.pause()
await browser.close()
