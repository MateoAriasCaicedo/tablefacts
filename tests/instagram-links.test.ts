/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import * as mod1 from "../src/instagram/links.mjs";
const { normalize, parseArgs, parseProfile } = mod1 as Record<string, any>;

describe("parseArgs", () => {
  it("starts with nothing switched on", () => {
    expect(parseArgs([])).toEqual({ links: [], headed: false, dryRun: false, debug: false });
  });

  it("reads options that take a value", () => {
    const opts = parseArgs(["--out", "photos", "--cdp", "http://localhost:9222", "--file", "links.txt", "--browser", "msedge", "--pages", "all", "--edge-dir", "C:\\ig"]);
    expect(opts).toMatchObject({ out: "photos", cdp: "http://localhost:9222", file: "links.txt", browser: "msedge", pages: "all", edgeDir: "C:\\ig" });
  });

  it("reads switches", () => {
    expect(parseArgs(["--headed", "--dry-run", "--debug", "--google"])).toMatchObject({ headed: true, dryRun: true, debug: true, google: true });
  });

  it("reads help in both spellings", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("collects what is not an option as a link", () => {
    expect(parseArgs(["https://www.instagram.com/p/ABC/", "--dry-run", "https://www.instagram.com/p/DEF/"]).links).toEqual([
      "https://www.instagram.com/p/ABC/",
      "https://www.instagram.com/p/DEF/",
    ]);
  });

  it("reads --profile and --user-data-dir", () => {
    expect(parseArgs(["--profile", "@casa_gaucho", "--user-data-dir", "x"])).toMatchObject({ profile: "@casa_gaucho", userDataDir: "x" });
  });

  it("rejects an unknown option by name", () => {
    expect(() => parseArgs(["--fast"])).toThrow("Unknown option --fast");
  });
});

describe("normalize", () => {
  it("reduces a post, a reel and a tv link to a canonical URL and its shortcode", () => {
    expect(normalize("https://www.instagram.com/p/Cx-Ab_1/?utm_source=ig_web&img_index=2")).toEqual({
      shortcode: "Cx-Ab_1",
      url: "https://www.instagram.com/p/Cx-Ab_1/",
    });
    expect(normalize("https://instagram.com/reel/XYZ123/")).toEqual({ shortcode: "XYZ123", url: "https://www.instagram.com/reel/XYZ123/" });
    expect(normalize("https://www.instagram.com/tv/TV1")?.url).toBe("https://www.instagram.com/tv/TV1/");
  });

  it("treats /reels/ as /reel/", () => {
    expect(normalize("https://www.instagram.com/reels/ABC/")?.url).toBe("https://www.instagram.com/reel/ABC/");
  });

  it("finds the post under a profile path and tolerates surrounding whitespace", () => {
    expect(normalize("  https://www.instagram.com/casa_gaucho/p/ABC/  ")?.shortcode).toBe("ABC");
  });

  it("gives the same shortcode for the same post however the link was copied", () => {
    expect(normalize("https://www.instagram.com/p/ABC/?igsh=1")?.shortcode).toBe(normalize("https://instagram.com/p/ABC")?.shortcode);
  });

  it("is null for something that is not an Instagram post", () => {
    expect(normalize("https://www.instagram.com/casa_gaucho/")).toBeNull(); // a profile
    expect(normalize("https://example.com/p/ABC/")).toBeNull();
    expect(normalize("https://notinstagram.com/p/ABC/")).toBeNull();
    expect(normalize("not a url")).toBeNull();
    expect(normalize("")).toBeNull();
  });
});

describe("parseProfile", () => {
  it("accepts a handle with or without the @", () => {
    expect(parseProfile("@casa_gaucho")).toEqual({ user: "casa_gaucho", url: "https://www.instagram.com/casa_gaucho/" });
    expect(parseProfile("casa.gaucho")).toEqual({ user: "casa.gaucho", url: "https://www.instagram.com/casa.gaucho/" });
  });

  it("takes the handle out of a profile link, ignoring the query", () => {
    expect(parseProfile("https://www.instagram.com/casa_gaucho/?hl=es")?.user).toBe("casa_gaucho");
    expect(parseProfile("https://instagram.com/casa_gaucho")?.user).toBe("casa_gaucho");
  });

  it("is null when there is no usable handle", () => {
    expect(parseProfile("")).toBeNull();
    expect(parseProfile("https://www.instagram.com/")).toBeNull();
    expect(parseProfile("two words")).toBeNull();
    expect(parseProfile("a/b")).toBeNull();
    expect(parseProfile("http://[bad")).toBeNull();
  });
});
