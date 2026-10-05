# Changelog

## 0.1.0

First release as an npm library.

- Every tool is a function: `research`, `downloadInstagram`, `downloadTripadvisor`, `importMenu`,
  `importCluvi`, `importImageMenu`, `listMenuImages`. The `tablefacts` command is a thin wrapper over them.
- One logger contract (`log(message, level)`), an explicit `env` option, `loadEnv()` and `projectDir`.
- `TablefactsError` with codes `EUSAGE`, `ECONFIG`, `EDEPENDENCY` and `EFAILED`.
- Types generated from JSDoc (`npm run build:types`).
- Playwright is an optional peer dependency.
