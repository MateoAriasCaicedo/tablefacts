# Instagram photos

Downloads a restaurant's Instagram photos through <https://toolzu.com>, driven by Playwright in **the user's own Edge window**. Used in step 3 of `docs/WORKFLOW.md` to source real photos for `frontend/public/`.

| | |
| --- | --- |
| Photos of a whole profile | `--profile <link or @name>`, needs a toolzu account signed in to that browser |
| Photos of specific posts | links as arguments or `--file links.txt`, saves every image of each post |
| Videos, stories, highlights | not supported (videos on a profile are skipped) |

**Rights first.** Only download what the restaurant owns or has allowed you to use. The restaurant sending you the originals, or using Instagram's own "Download your information" export, is better than this tool: full size, no scraping. Mention in the hand-off where each photo came from.

## The browser: read this before running anything

Toolzu guards its forms with a Cloudflare Turnstile check. **Headless browsers, Playwright's bundled Chromium, a fresh automated Edge and Playwright's `codegen` window all failed it** in testing. An ordinary Edge window that the user started with remote debugging passes it by itself, usually in 8 to 45 seconds. So the script does not drive a browser of its own: it **attaches to that window** (`--cdp http://localhost:9222`) and opens its own tab in it. **If nothing is listening on that port, the script starts Edge itself** (detached, so it stays open and keeps the toolzu login for the next run).

Rules for agents:

- **Never try to bypass, solve or fake the Cloudflare check** (no stealth plugins, header tricks, solvers). The script only waits for it (up to 2 minutes). If a "verify you are human" box appears in the window, **the user ticks it**. Tell them when you are waiting.
- **Never kill Edge or its processes.** The window may be the user's, and the run holds a lock on its profile folder. If a run hangs, stop only the `node` process you started.
- Leave the window open between runs. Closing it ends the session (toolzu login included).

### Starting the window by hand (only if the script cannot)

The script does this for you using the profile folder `C:\ig-edge` (`--edge-dir` changes it). If it reports that Edge did not open its debugging port, start it yourself:

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222 --user-data-dir=C:\ig-edge
```

- The `&` is required in PowerShell (without it: `Unexpected token 'remote-debugging-port=9222'`).
- **Close every other Edge window first**, or Edge ignores the debugging flag and nothing listens on 9222.
- `--user-data-dir` must be a folder of its own (recent Edge refuses debugging on the default profile). `C:\ig-edge` keeps the toolzu login between sessions. Do not point it at `.extract/instagram-profile`, which the script uses for its own fallback browser.
- Check it is up: `curl http://localhost:9222/json/version` returns JSON. `ECONNREFUSED ::1:9222` means it is not running: ask the user to start it (it opens a window on their screen).
- First time: in that window open toolzu.com, **sign in or sign up**, then leave it. The profile tool needs the account; the single-post tool does not.

## Run

```bash
# one profile, first batch, listing only (writes nothing)
extract photos instagram --cdp http://localhost:9222 --google --profile https://www.instagram.com/<user>/ --out <folder> --dry-run

# same, for real; several batches
extract photos instagram --cdp http://localhost:9222 --google --profile @<user> --pages 3 --out <folder>

# specific posts
extract photos instagram --cdp http://localhost:9222 --out <folder> <post-link> <post-link>
extract photos instagram --cdp http://localhost:9222 --out <folder> --file links.txt
```

| Flag | Meaning |
| --- | --- |
| `--out <folder>` | required; created if missing. Use a scratch folder outside `frontend/public`, then copy what you pick |
| `--cdp <url>` | attach to the user's Edge, starting it if nothing answers (the supported way) |
| `--edge-dir <dir>` | profile folder for that Edge, where the toolzu login lives (default `C:\ig-edge`) |
| `--google` | reach toolzu through a Google search first, as the user does (first link only; falls back to the direct address) |
| `--profile <link\|@name>` | download a whole profile's photos |
| `--pages <n\|all>` | with `--profile`, batches of posts to load with NEXT (default 1) |
| `--dry-run` | print what it would save, write nothing. Do this first |
| `--debug` | post mode: save the results HTML in `<out>/_debug` to fix selectors |
| `--browser msedge`, `--headed`, `--user-data-dir` | launch a browser instead of attaching. Fails the Cloudflare check unless a person ticks it; keep as a fallback |

Links may carry tracking queries (`?utm_source=…`, `?img_index=1`); they are stripped and `img_index` is ignored: **every link saves all the images of its post**.

Output: profile photos are `<user>-<instagram file name>.jpg`; post photos are `<shortcode>-<n>.jpg`. A re-run skips files already there. The summary prints saved, already there and failed; the exit code is non-zero if anything failed.

## What the script does (so you can fix it when toolzu changes)

1. Optionally Google `toolzu instagram profile` (or `…photo downloader`) and click the result.
2. Paste the link into `#instagramdownloaderform-search` and **click Download straight away**, like a person. If toolzu flags the box invalid because the check was not finished, wait for the check and click again (up to 3 times).
3. Results land in `#ajax-results` as `.download-card` elements. A photo has `.fa-image`, a video `.fa-play-circle`; the card's button is `a[download]`. Only photo cards are used.
4. **Both modes click each card's own Download button** and save what the browser receives (a real download, or an image opened in a new tab, which the script fetches with the browser's cookies). The click is a click event sent straight to the button: a real Playwright click scrolls each card into view and waits for the lazy-loading images to stop shifting, which made later batches about 3x slower. A real click is only the fallback. The `NEXT` button (`#viewer-next`) adds another batch to the list; each batch is saved before NEXT is pressed.
5. It waits for the cards to appear, never for `networkidle` (toolzu's ads keep the network busy for tens of seconds). Waits 2.5 seconds between links.

Everything toolzu-specific is `findImages`, `downloadProfile`, `profileImages`, `submitForm` and `waitForCheck` in `download.mjs`. Link parsing, saving, retries and the summary do not depend on toolzu.

## Verified, and not

Verified on the Zelavi profile and one carousel post, signed in to toolzu:
- **Profile, `--pages 3`:** Google to toolzu, Download clicked right after pasting, then 27 + 32 + 48 = 107 photos saved with no failures in 1 minute 2 seconds (about 0.4 s per photo in every batch). All valid JPEGs at full resolution (about 1080 px wide). NEXT adds to the list and did not need another Cloudflare tick. The 4 videos on the first page were skipped.
- **Post mode:** a 3-image carousel saved as `<shortcode>-1.jpg` to `-3.jpg`, all valid JPEGs; a re-run skipped all 3; a non-Instagram link was reported and skipped.
- **Starting Edge:** the script started it when port 9222 was closed and reused it afterwards.

**Not verified, so check before relying on them:**
- A profile with hundreds of posts: `--pages all` has not been run, and toolzu may limit or slow later batches.
- Private accounts, reels in post mode, and a toolzu account that is not signed in.
- `record.mjs` (attach to the window and open Playwright's Inspector to record a flow): the user reported recording did not work. Ask them to describe or screenshot the steps instead.

## Troubleshooting

| Message | Cause and fix |
| --- | --- |
| `Edge did not open its debugging port` | another Edge is using the `C:\ig-edge` profile without debugging, or Edge is not in its usual folder; close that window or start Edge by hand (see above) |
| `connect ECONNREFUSED ::1:9222` | `--cdp` points at a non-local address, or Edge died mid-run; run again |
| `the Cloudflare check was not passed` | the user must tick the box in the window, or the window is not a normal Edge |
| `not signed in to toolzu` | sign in in the debugging window; the profile tool may refuse otherwise |
| `toolzu did not accept the link` | link is not a public profile or post, or toolzu is blocking the request |
| `the tool returned no photos` / `no images` | markup changed or the account is private; run with `--debug` (post mode) and compare with the selectors above |
| `clicking Download started nothing` / `Download navigated instead of saving` | the card button now behaves differently; check by hand what happens when a person clicks it |
| `launchPersistentContext … closed` | another run still holds `.extract/instagram-profile`; stop the `node` process you started |

## After the download

- Most of a restaurant's feed is event posters and guest photos with text. Look at every image before using it; posters with text rarely belong on the site.
- Copy the chosen files into `frontend/public/<folder>` and continue with step 3 of `docs/WORKFLOW.md`: `images.ts`, then `photos.ts` with real pixel `width`/`height` and es + en `alt`.
- In the hand-off list the profile, how many photos were taken, and whether the restaurant confirmed they may be used.

## Shell notes for agents on Windows

- Run the commands in PowerShell. In Git Bash, a long heredoc containing quotes can break and write nothing: put scripts in a file instead.
- `pkill` does not exist in Git Bash; use `Get-CimInstance Win32_Process` in PowerShell and match the command line narrowly (a loose pattern also matches your own shell).
- Playwright's ESM import needs `file:///C:/...` URLs for absolute paths on Windows.
