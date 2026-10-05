import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // The tools work on "the project in the current folder"; tests use a fixture project so they
    // never read or write the repo they run in.
    env: { EXTRACT_PROJECT: fileURLToPath(new URL("./tests/fixtures/project", import.meta.url)) },
  },
});
