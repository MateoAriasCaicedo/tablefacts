import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The scripts are run by people, from the repository root, through `npm run`.
// These start each one as a real process, so a broken import, a syntax error or
// a changed flag fails here and not at a client's first run. Only paths that
// need no network, key or browser are exercised.

const repo = resolve(__dirname, "..");
const run = (script: string, args: string[] = [], cwd = repo) =>
  spawnSync(process.execPath, [resolve(repo, script), ...args], {
    cwd,
    encoding: "utf8",
    // No credentials leak in, and none can be used by accident.
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, SUPABASE_DB_URL: "" } as unknown as NodeJS.ProcessEnv,
    timeout: 30_000,
  });

describe("tablefacts research", () => {
  it("prints its help and exits 0", () => {
    const result = run("src/research/research.mjs", ["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('tablefacts research "<name>" "<city, country>"');
    expect(result.stdout).toContain("--country");
    expect(result.stdout).toContain("GOOGLE_PLACES_API_KEY");
  });

  it("prints the help and exits 1 when no restaurant is named", () => {
    const result = run("src/research/research.mjs");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Research a restaurant from public sources");
  });

  it("rejects an unknown flag", () => {
    const result = run("src/research/research.mjs", ["Gaucho", "--nope"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--nope");
  });
});

describe("tablefacts menu cluvi", () => {
  it("prints its usage and the shared options", () => {
    const result = run("src/menu/cluvi/extract.mjs", ["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: tablefacts menu cluvi");
    expect(result.stdout).toContain("--service <name>");
    expect(result.stdout).toContain("--dry-run");
    expect(result.stdout).toContain("--replace-all");
  });
});

describe("tablefacts menu raw", () => {
  it("prints its usage, with a row per vision provider", () => {
    const result = run("src/menu/raw/extract.mjs", ["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: tablefacts menu raw");
    for (const provider of ["anthropic", "gemini", "groq"]) expect(result.stdout).toContain(provider);
    expect(result.stdout).toContain("--only <pages>");
  });
});

describe("tablefacts photos instagram", () => {
  it("prints its help and exits 0, without starting a browser", () => {
    const result = run("src/instagram/download.mjs", ["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Download Instagram post photos");
    expect(result.stdout).toContain("Only download photos the restaurant owns");
  });

  it("explains a missing --out folder", () => {
    const result = run("src/instagram/download.mjs", ["https://www.instagram.com/p/ABC/"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/--out/);
  });
});

describe("photo CLIs translate library errors into flags", () => {
  it("instagram: no valid links", () => {
    const result = run("src/instagram/download.mjs", ["--out", "x", "nope"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no valid Instagram post links in the links/--file/--profile");
    expect(result.stderr).not.toContain("`");
  });

  it("instagram: a bad profile names --profile", () => {
    const result = run("src/instagram/download.mjs", ["--out", "x", "--profile", "bad profile!"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--profile is not an Instagram profile: bad profile!");
  });

  it("instagram: an unknown flag is a usage error without a stack trace", () => {
    const result = run("src/instagram/download.mjs", ["--nope"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Unknown option --nope");
    expect(result.stderr).not.toContain("at ");
  });

  it("tripadvisor: no valid links", () => {
    const result = run("src/tripadvisor/photos.mjs", ["--out", "x", "https://example.com/"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no valid TripAdvisor restaurant links in the arguments");
  });
});

describe("tablefacts photos tripadvisor", () => {
  it("prints its help and exits 0, without starting a browser", () => {
    const result = run("src/tripadvisor/photos.mjs", ["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Download the photos of a restaurant's TripAdvisor page");
    expect(result.stdout).toContain("Only download photos the restaurant owns");
  });

  it("explains a missing --out folder", () => {
    const result = run("src/tripadvisor/photos.mjs", ["https://www.tripadvisor.com/Restaurant_Review-g1-d2-Reviews-X.html"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/--out/);
  });

  it("refuses a link that is not a TripAdvisor restaurant, before any browser starts", () => {
    const result = run("src/tripadvisor/photos.mjs", ["--out", "x", "https://example.com/"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("not a TripAdvisor restaurant link");
  });
});

describe("tablefacts", () => {
  it("lists its tools and exits 0 without arguments", () => {
    const result = run("bin/tablefacts.mjs");
    expect(result.status).toBe(0);
    for (const tool of ["research", "photos instagram", "photos tripadvisor", "menu cluvi", "menu raw"]) {
      expect(result.stdout).toContain(tool);
    }
  });

  it("rejects an unknown tool", () => {
    const result = run("bin/tablefacts.mjs", ["nope"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Unknown tool: nope");
  });

  it("hands the rest of the arguments to the tool", () => {
    const result = run("bin/tablefacts.mjs", ["photos", "tripadvisor", "--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("TripAdvisor");
    const research = run("bin/tablefacts.mjs", ["research", "Gaucho", "--nope"]);
    expect(research.status).not.toBe(0);
    expect(research.stderr).toContain("--nope");
  });
});
