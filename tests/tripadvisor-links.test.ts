/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import * as mod1 from "../src/tripadvisor/links.mjs";
const { fileName, findPhotos, normalizeRestaurant, parseArgs, sizeCandidates } = mod1 as Record<string, any>;

describe("parseArgs", () => {
  it("starts with nothing switched on and no photo limit", () => {
    expect(parseArgs([])).toEqual({ links: [], dryRun: false, debug: false, max: Infinity });
  });

  it("reads options that take a value", () => {
    expect(parseArgs(["--out", "photos", "--cdp", "http://localhost:9222", "--edge-dir", "C:\\ig", "--max", "20"])).toMatchObject({
      out: "photos",
      cdp: "http://localhost:9222",
      edgeDir: "C:\\ig",
      max: 20,
    });
  });

  it("reads switches and both spellings of help", () => {
    expect(parseArgs(["--dry-run", "--debug"])).toMatchObject({ dryRun: true, debug: true });
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("collects what is not an option as a link", () => {
    expect(parseArgs(["https://a", "--dry-run", "https://b"]).links).toEqual(["https://a", "https://b"]);
  });

  it("rejects an unknown option and a bad --max", () => {
    expect(() => parseArgs(["--fast"])).toThrow("Unknown option --fast");
    expect(() => parseArgs(["--max", "0"])).toThrow("--max");
    expect(() => parseArgs(["--max", "lots"])).toThrow("--max");
  });
});

describe("normalizeRestaurant", () => {
  const page = "/Restaurant_Review-g297478-d1234567-Reviews-Casa_Gaucho-Medellin_Antioquia_Department.html";

  it("keeps the restaurant id and drops query and hash", () => {
    expect(normalizeRestaurant(`https://www.tripadvisor.com${page}?m=1#photos`)).toEqual({
      id: "d1234567",
      url: `https://www.tripadvisor.com${page}`,
    });
  });

  it("accepts other country domains", () => {
    expect(normalizeRestaurant(`https://www.tripadvisor.co${page}`)?.id).toBe("d1234567");
    expect(normalizeRestaurant(`https://www.tripadvisor.co.uk${page}`)?.id).toBe("d1234567");
  });

  it("rejects other sites, other TripAdvisor pages and garbage", () => {
    expect(normalizeRestaurant(`https://example.com${page}`)).toBeNull();
    expect(normalizeRestaurant("https://www.tripadvisor.com/Hotel_Review-g1-d2-Reviews-X.html")).toBeNull();
    expect(normalizeRestaurant("not a link")).toBeNull();
  });
});

describe("findPhotos", () => {
  const cdn = "https://dynamic-media-cdn.tripadvisor.com/media";

  it("finds one entry per photo even when it appears in several sizes", () => {
    const html = `<img src="${cdn}/photo-s/1a/2b/3c/4d/plato.jpg"><img srcset="${cdn}/photo-l/1a/2b/3c/4d/plato.jpg?w=600 1x">`;
    expect(findPhotos(html)).toEqual([{ key: "1a/2b/3c/4d/plato.jpg", size: "s", url: `${cdn}/photo-s/1a/2b/3c/4d/plato.jpg` }]);
  });

  it("reads URLs inside escaped JSON and the media-cdn host", () => {
    const json = String.raw`{"u":"https:\/\/media-cdn.tripadvisor.com\/media\/photo-w\/0a\/0b\/0c\/0d\/bar.jpeg"}`;
    expect(findPhotos(json).map((p: any) => p.key)).toEqual(["0a/0b/0c/0d/bar.jpeg"]);
    expect(findPhotos(String.raw`https:\u002F\u002Fdynamic-media-cdn.tripadvisor.com\u002Fmedia\u002Fphoto-o\u002F0a\u002F0b\u002F0c\u002F0d\u002Fx.jpg`)).toHaveLength(1);
  });

  it("keeps the order in which photos first appear", () => {
    const html = `${cdn}/photo-s/aa/bb/cc/dd/one.jpg ${cdn}/photo-s/aa/bb/cc/dd/two.jpg ${cdn}/photo-l/aa/bb/cc/dd/one.jpg`;
    expect(findPhotos(html).map((p: any) => p.key)).toEqual(["aa/bb/cc/dd/one.jpg", "aa/bb/cc/dd/two.jpg"]);
  });

  it("treats a sized path (photo-m/1280/...) as the same photo as the plain one", () => {
    const html = `https://media-cdn.tripadvisor.com/media/photo-m/1280/32/cb/49/81/maguro.jpg https://dynamic-media-cdn.tripadvisor.com/media/photo-o/32/cb/49/81/maguro.jpg`;
    expect(findPhotos(html).map((p: any) => p.key)).toEqual(["32/cb/49/81/maguro.jpg"]);
  });

  it("leaves out avatars and finds nothing in unrelated text", () => {
    expect(findPhotos(`${cdn}/photo-l/aa/bb/cc/dd/avatar012.jpg`)).toEqual([]);
    expect(findPhotos("<p>hello</p> https://example.com/a.jpg")).toEqual([]);
  });
});

describe("sizeCandidates", () => {
  it("offers the original first, then smaller sizes, then the size the page showed", () => {
    const photo = { key: "1a/2b/3c/4d/plato.jpg", size: "s", url: "https://media-cdn.tripadvisor.com/media/photo-s/1a/2b/3c/4d/plato.jpg?w=100" };
    const urls = sizeCandidates(photo);
    expect(urls[0]).toBe("https://dynamic-media-cdn.tripadvisor.com/media/photo-o/1a/2b/3c/4d/plato.jpg");
    expect(urls.slice(1, 3)).toEqual([
      "https://dynamic-media-cdn.tripadvisor.com/media/photo-w/1a/2b/3c/4d/plato.jpg",
      "https://dynamic-media-cdn.tripadvisor.com/media/photo-l/1a/2b/3c/4d/plato.jpg",
    ]);
    expect(urls.at(-1)).toBe("https://media-cdn.tripadvisor.com/media/photo-s/1a/2b/3c/4d/plato.jpg");
  });

  it("does not repeat a URL", () => {
    const key = "1a/2b/3c/4d/plato.jpg";
    const url = `https://dynamic-media-cdn.tripadvisor.com/media/photo-o/${key}`;
    expect(new Set(sizeCandidates({ key, size: "o", url })).size).toBe(3);
  });
});

describe("fileName", () => {
  it("joins the path segments into a stable unique name", () => {
    expect(fileName({ key: "1a/2b/3c/4d/plato.jpg" })).toBe("1a2b3c4d-plato.jpg");
  });

  it("normalises the extension and unsafe characters", () => {
    expect(fileName({ key: "1a/2b/3c/4d/Mesa de%20noche.JPEG" })).toBe("1a2b3c4d-Mesa_de_20noche.jpg");
  });
});
