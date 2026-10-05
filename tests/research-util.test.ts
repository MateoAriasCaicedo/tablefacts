/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as mod1 from "../src/research/lib/util.mjs";
const { BROWSER_UA, decodeHtml, digits, fetchText, fold, instagramHandle, km, samePhone, sameText, sleep, slugify, tokens } = mod1 as Record<string, any>;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fold", () => {
  it("lowercases and drops accents", () => {
    expect(fold("Café ÑANDÚ")).toBe("cafe nandu");
  });
  it("copes with null and numbers", () => {
    expect(fold(null)).toBe("");
    expect(fold(undefined)).toBe("");
    expect(fold(42)).toBe("42");
  });
});

describe("tokens", () => {
  it("drops filler words so two spellings of one name compare equal", () => {
    expect(tokens("Restaurante El Gaucho")).toEqual(["gaucho"]);
    expect(tokens("Calle 10 # 5-20, Av. Poblado")).toEqual(["10", "5", "20", "poblado"]);
  });
});

describe("sameText", () => {
  it("matches names that share most of their words", () => {
    expect(sameText("Restaurante El Gaucho", "Gaucho")).toBe(true);
    expect(sameText("Zelavi Gastro Bar", "ZELAVI")).toBe(true);
    expect(sameText("Cra 35 # 8-30", "Carrera 35 8-30 Medellín")).toBe(true);
  });
  it("tells different names apart", () => {
    expect(sameText("Gaucho", "La Parrilla")).toBe(false);
    expect(sameText("Casa Blanca Norte", "Casa Azul Sur")).toBe(false);
  });
  it("falls back to a plain comparison when a side is all filler", () => {
    expect(sameText("El", "el")).toBe(true);
    expect(sameText("El", "La")).toBe(false);
    expect(sameText("", "x")).toBe(false);
  });
});

describe("slugify", () => {
  it("makes a folder-safe slug", () => {
    expect(slugify("Café Ñandú & Co.!")).toBe("cafe-nandu-co");
  });
  it("never returns an empty slug", () => {
    expect(slugify("!!!")).toBe("restaurant");
    expect(slugify("")).toBe("restaurant");
  });
});

describe("digits and samePhone", () => {
  it("keeps only digits", () => {
    expect(digits("+57 (300) 123-4567")).toBe("573001234567");
    expect(digits(null)).toBe("");
  });
  it("recognises one number written two ways", () => {
    expect(samePhone("+57 300 123 4567", "300-123-4567")).toBe(true);
    expect(samePhone("(604) 555 0199", "+1 604 555 0199")).toBe(true);
  });
  it("tells different numbers apart", () => {
    expect(samePhone("+57 300 123 4567", "+57 300 123 4568")).toBe(false);
  });
  it("refuses numbers too short to compare", () => {
    expect(samePhone("123", "123")).toBe(false);
    expect(samePhone("", "")).toBe(false);
  });
});

describe("km", () => {
  it("is zero for the same point", () => {
    expect(km({ lat: 6.2, lng: -75.5 }, { lat: 6.2, lng: -75.5 })).toBe(0);
  });
  it("measures great-circle distance", () => {
    // Bogotá to Medellín is about 240 km in a straight line.
    const d = km({ lat: 4.711, lng: -74.0721 }, { lat: 6.2442, lng: -75.5812 });
    expect(d).toBeGreaterThan(235);
    expect(d).toBeLessThan(245);
  });
  it("is symmetric", () => {
    const a = { lat: 40.7128, lng: -74.006 };
    const b = { lat: 51.5072, lng: -0.1276 };
    expect(km(a, b)).toBeCloseTo(km(b, a), 9);
  });
  it("resolves a 150 m difference, the tolerance merge.mjs uses", () => {
    const d = km({ lat: 6.2, lng: -75.5 }, { lat: 6.2, lng: -75.4986 });
    expect(d).toBeGreaterThan(0.1);
    expect(d).toBeLessThan(0.2);
  });
});

describe("sleep", () => {
  it("resolves after the delay", async () => {
    vi.useFakeTimers();
    let done = false;
    sleep(500).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });
});

describe("fetchText", () => {
  const respond = (init: { status?: number; body?: string; type?: string; url?: string }) =>
    vi.fn(async () => ({
      ok: (init.status ?? 200) < 400,
      status: init.status ?? 200,
      url: init.url ?? "https://example.com/final",
      headers: { get: (name: string) => (name === "content-type" ? init.type ?? "text/html" : null) },
      text: async () => init.body ?? "",
    }));

  it("returns the status, the final URL, the type and the text", async () => {
    vi.stubGlobal("fetch", respond({ body: "hola", type: "text/plain" }));
    expect(await fetchText("https://example.com")).toEqual({
      ok: true,
      status: 200,
      url: "https://example.com/final",
      type: "text/plain",
      text: "hola",
    });
  });

  it("does not throw on an error status", async () => {
    vi.stubGlobal("fetch", respond({ status: 403 }));
    expect(await fetchText("https://example.com")).toMatchObject({ ok: false, status: 403 });
  });

  it("identifies itself and lets a caller override a header", async () => {
    const fetchMock = respond({});
    vi.stubGlobal("fetch", fetchMock);
    await fetchText("https://example.com", { headers: { accept: "application/json" } });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string>; redirect: string }];
    expect(init.headers["user-agent"]).toBe(BROWSER_UA);
    expect(init.headers.accept).toBe("application/json");
    expect(init.headers["accept-language"]).toContain("es");
    expect(init.redirect).toBe("follow");
  });
});

describe("decodeHtml", () => {
  it("decodes named and numeric entities, including a surrogate pair", () => {
    expect(decodeHtml("Caf&#233; &amp; Co &#x1F600; &quot;x&quot;")).toBe('Café & Co 😀 "x"');
  });

  it("leaves an unknown or malformed entity alone", () => {
    expect(decodeHtml("a &bogus; b &#; c &")).toBe("a &bogus; b &#; c &");
  });
});

describe("instagramHandle", () => {
  it("reads a profile handle, accent-free or with a query string", () => {
    expect(instagramHandle("https://www.instagram.com/casa_gaucho/")).toBe("casa_gaucho");
    expect(instagramHandle("https://instagram.com/Casa.Gaucho?hl=es")).toBe("casa.gaucho");
  });

  it("rejects a post, a reel and reserved paths", () => {
    for (const path of ["p/ABC", "reel/ABC", "reels/ABC", "explore/tags/food", "stories/x", "share/x"]) {
      expect(instagramHandle(`https://www.instagram.com/${path}/`)).toBe("");
    }
  });

  it("is empty for something that is not a URL", () => {
    expect(instagramHandle("not a url")).toBe("");
    expect(instagramHandle("")).toBe("");
  });
});
