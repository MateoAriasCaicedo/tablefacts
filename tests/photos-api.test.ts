import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs modules without type declarations
import { downloadInstagram } from "../src/instagram/index.mjs";
// @ts-expect-error plain .mjs modules without type declarations
import { downloadTripadvisor } from "../src/tripadvisor/index.mjs";

// Only the paths that need no browser or network: validation runs before playwright is loaded.

describe("downloadInstagram", () => {
  it("is a function and importing it has no side effects", () => {
    expect(typeof downloadInstagram).toBe("function");
  });

  it("rejects without out", async () => {
    await expect(downloadInstagram({ links: ["https://www.instagram.com/p/ABC/"] })).rejects.toThrow("`out` is required");
  });

  it("rejects when no link is valid", async () => {
    await expect(downloadInstagram({ out: "x", links: ["https://example.com/"] })).rejects.toThrow("no valid Instagram post links in `links`/`file`/`profile`");
  });

  it("rejects a bad profile", async () => {
    await expect(downloadInstagram({ out: "x", profile: "not a profile!" })).rejects.toThrow("`profile` is not an Instagram profile: not a profile!");
  });

  it("reports skipped links through log", async () => {
    const lines: unknown[] = [];
    await expect(downloadInstagram({ out: "x", links: ["nope"], log: (m: string, l: string) => lines.push([m, l]) })).rejects.toThrow();
    expect(lines).toEqual([["Skipping, not an Instagram post link: nope", "warn"]]);
  });
});

describe("downloadTripadvisor", () => {
  it("is a function and importing it has no side effects", () => {
    expect(typeof downloadTripadvisor).toBe("function");
  });

  it("rejects without out", async () => {
    await expect(downloadTripadvisor({ links: ["https://www.tripadvisor.com/Restaurant_Review-g1-d2-Reviews-X.html"] })).rejects.toThrow(
      "`out` is required",
    );
  });

  it("rejects when no link is a restaurant page", async () => {
    await expect(downloadTripadvisor({ out: "x", links: ["https://example.com/"] })).rejects.toThrow("no valid TripAdvisor restaurant links in `links`");
  });
});

describe("validation errors", () => {
  it("name the option and carry a usage code", async () => {
    const err = await downloadTripadvisor({ links: [] }).catch((e: unknown) => e as { code: string; option: string });
    expect(err).toMatchObject({ code: "EUSAGE", option: "out" });
    const ig = await downloadInstagram({ out: "x", profile: "bad profile!" }).catch((e: unknown) => e as { option: string });
    expect(ig).toMatchObject({ option: "profile" });
  });
});
