/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as mod from "../src/research/lib/search.mjs";
const { classifyResults, parseSearchResults, resultUrl, searchWeb } = mod as Record<string, any>;

afterEach(() => vi.unstubAllGlobals());

const ddg = (href: string) => `//duckduckgo.com/l/?uddg=${encodeURIComponent(href)}&rut=x`;
const result = (href: string, title: string, snippet = "") =>
  `<div class="result"><a rel="nofollow" class="result__a" href="${ddg(href)}">${title}</a><a class="result__snippet" href="#">${snippet}</a></div>`;

const HTML = `<html><body>
  ${result("https://makibar.co/", "Makibar — cocina japonesa", "Sushi en Medellín. Reservas y domicilios.")}
  ${result("https://www.instagram.com/makibar.col/", "Makibar (@makibar.col)", "1,234 Followers")}
  ${result("https://www.tripadvisor.co/Restaurant_Review-g297478-d34088296-Reviews-Maki_Bar_Medellin-Medellin_Antioquia_Department.html", "Maki Bar", "Reviews")}
  ${result("https://www.google.com/maps/place/Makibar", "Makibar en Google Maps", "")}
</body></html>`;

const LITE = `<html><body><table>
  <tr><td>1.&nbsp;</td><td><a rel="nofollow" href="${ddg("https://makibarrestaurante.com/")}" class='result-link'>Maki Bar</a></td></tr>
  <tr><td>&nbsp;&nbsp;&nbsp;</td><td class='result-snippet'>NUESTRO MENÚ Recetas inspiradas en la <b>gastronomía</b> japonesa.</td></tr>
  <tr><td>&nbsp;&nbsp;&nbsp;</td><td><span class='link-text'>makibarrestaurante.com</span></td></tr>
</table></body></html>`;

const response = (body: string, url = "https://duckduckgo.com/", status = 200) => ({
  ok: status < 400, status, url, headers: { get: () => "text/html" }, text: async () => body, body: null,
});

describe("resultUrl", () => {
  it("unwraps a DuckDuckGo redirect", () => {
    expect(resultUrl(ddg("https://makibar.co/"))).toBe("https://makibar.co/");
  });

  it("keeps a direct http(s) URL and drops anything else", () => {
    expect(resultUrl("https://makibar.co/")).toBe("https://makibar.co/");
    expect(resultUrl("javascript:alert(1)")).toBeNull();
    expect(resultUrl("")).toBeNull();
  });

  it("returns null for a redirect with no target", () => {
    expect(resultUrl("//duckduckgo.com/l/?rut=x")).toBeNull();
  });
});

describe("parseSearchResults", () => {
  it("reads the title, the unwrapped URL and the snippet of each result", () => {
    const results = parseSearchResults(HTML);
    expect(results.map((r: any) => r.url)).toEqual([
      "https://makibar.co/",
      "https://www.instagram.com/makibar.col/",
      "https://www.tripadvisor.co/Restaurant_Review-g297478-d34088296-Reviews-Maki_Bar_Medellin-Medellin_Antioquia_Department.html",
      "https://www.google.com/maps/place/Makibar",
    ]);
    expect(results[0]).toMatchObject({ title: "Makibar — cocina japonesa", snippet: "Sushi en Medellín. Reservas y domicilios." });
  });

  it("returns nothing for a page with no results (a bot wall or a JSON error)", () => {
    expect(parseSearchResults("<html><body>nothing</body></html>")).toEqual([]);
    expect(parseSearchResults("[]")).toEqual([]);
  });

  it("reads the Lite markup too (result-link and a result-snippet cell)", () => {
    expect(parseSearchResults(LITE)).toEqual([
      { url: "https://makibarrestaurante.com/", title: "Maki Bar", snippet: "NUESTRO MENÚ Recetas inspiradas en la gastronomía japonesa." },
    ]);
  });

  it("does not let a result borrow the next result's snippet", () => {
    const html = `<a class="result__a" href="${ddg("https://a.com/")}">A</a><a class="result__a" href="${ddg("https://b.com/")}">B</a><a class="result__snippet">snippet for B</a>`;
    expect(parseSearchResults(html)).toEqual([
      { url: "https://a.com/", title: "A", snippet: "" },
      { url: "https://b.com/", title: "B", snippet: "snippet for B" },
    ]);
  });

  it("decodes entities in a title", () => {
    const html = `<a class="result__a" href="${ddg("https://makibar.co/")}">Maki Bar &amp; Co</a>`;
    expect(parseSearchResults(html)[0].title).toBe("Maki Bar & Co");
  });
});

describe("classifyResults", () => {
  const results = parseSearchResults(HTML);
  const links = classifyResults(results, { name: "Maki Bar" });

  it("picks the restaurant's own site, not a directory", () => {
    expect(links.website).toBe("https://makibar.co/");
  });

  it("sorts Instagram, TripAdvisor, Maps and hubs", () => {
    expect(links.instagram).toBe("makibar.col");
    expect(links.tripadvisor).toContain("tripadvisor.co");
    expect(links.mapsUrl).toContain("google.com/maps");
  });

  it("keeps a directory out of the website candidates", () => {
    const onlyDirectories = classifyResults(parseSearchResults(result("https://www.yelp.com/biz/makibar", "Makibar", "")), { name: "Maki Bar" });
    expect(onlyDirectories.website).toBe("");
  });

  it("does not turn a post or a reel URL into a handle", () => {
    const post = classifyResults(parseSearchResults(result("https://www.instagram.com/p/ABC/", "post", "")), { name: "x" });
    const reel = classifyResults(parseSearchResults(result("https://www.instagram.com/reel/ABC/", "reel", "")), { name: "x" });
    expect(post.instagram).toBe("");
    expect(reel.instagram).toBe("");
  });

  it("does not mistake box.com for x.com", () => {
    const links = classifyResults(parseSearchResults(result("https://box.com/", "Box", "")), { name: "Box" });
    expect(links.website).toBe("https://box.com/");
  });

  it("sorts Facebook, TikTok and a link-in-bio hub", () => {
    const links = classifyResults([
      { url: "https://www.facebook.com/Makibar/", title: "FB", snippet: "" },
      { url: "https://www.tiktok.com/@makibar", title: "TT", snippet: "" },
      { url: "https://linktr.ee/makibar", title: "links", snippet: "" },
    ], { name: "Maki Bar" });
    expect(links.facebook).toBe("https://www.facebook.com/Makibar/");
    expect(links.tiktok).toBe("https://www.tiktok.com/@makibar");
    expect(links.hubs).toEqual(["https://linktr.ee/makibar"]);
  });

  it("prefers the result whose title matches the name", () => {
    const links = classifyResults([
      { url: "https://foodblog.example/makibar", title: "Best sushi in town", snippet: "" },
      { url: "https://makibarrestaurante.com/", title: "Maki Bar restaurant", snippet: "" },
    ], { name: "Maki Bar" });
    expect(links.website).toBe("https://makibarrestaurante.com/");
    expect(links.candidates[0].url).toBe("https://makibarrestaurante.com/");
  });
});

describe("searchWeb", () => {
  it("asks DuckDuckGo with the name and place and returns the links it found", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: any) => {
      calls.push(String(input));
      return response(HTML, String(input));
    });
    const found = (await searchWeb({ name: "Maki Bar", location: "Medellín, Colombia" })) as any;
    expect(calls[0]).toContain("duckduckgo.com");
    const asked = new URL(calls[0]);
    expect(asked.searchParams.get("q")).toBe("Maki Bar Medellín, Colombia restaurant");
    expect(found.website).toBe("https://makibar.co/");
    expect(found.instagram).toBe("makibar.col");
  });

  it("tries the second endpoint when the first answers with no results", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: any) => {
      const url = String(input);
      calls.push(url);
      return response(url.includes("lite.") ? "<html><body>Please verify you are human.</body></html>" : HTML, url);
    });
    const found = (await searchWeb({ name: "Maki Bar", location: "Medellín" })) as any;
    expect(calls).toHaveLength(2);
    expect(found.website).toBe("https://makibar.co/");
  });

  it("returns an empty result (not an error) when every endpoint has no results", async () => {
    vi.stubGlobal("fetch", async (input: any) => response("<html></html>", String(input)));
    const found = (await searchWeb({ name: "Nowhere" })) as any;
    expect(found.results).toEqual([]);
    expect(found.website).toBe("");
  });

  it("asks with just the name when no place is given", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: any) => { calls.push(String(input)); return response(HTML, String(input)); });
    await searchWeb({ name: "Maki Bar" });
    expect(new URL(calls[0]).searchParams.get("q")).toBe("Maki Bar restaurant");
  });

  it("throws with the status when the search engine refuses", async () => {
    vi.stubGlobal("fetch", async (input: any) => ({ ok: false, status: 429, url: String(input), headers: { get: () => "text/html" }, text: async () => "", body: null }));
    await expect(searchWeb({ name: "Maki Bar" })).rejects.toThrow("DuckDuckGo 429");
  });
});
