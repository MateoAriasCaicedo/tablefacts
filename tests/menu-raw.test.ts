/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as mod1 from "../src/menu/raw/normalize.mjs";
const { normalizePages, parsePrice } = mod1 as Record<string, any>;
import * as mod2 from "../src/menu/raw/source.mjs";
const { discoverPages, downloadPage, findImages, pageId } = mod2 as Record<string, any>;
import { workDirIn } from "../src/lib/project.mjs";
import * as mod3 from "../src/menu/raw/vision.mjs";
const { defaultProvider, providers, readPage } = mod3 as Record<string, any>;

type Anything = Record<string, any>;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const reply = (init: { status?: number; body?: unknown; text?: string; headers?: Record<string, string>; bytes?: Uint8Array }) => ({
  ok: (init.status ?? 200) < 400,
  status: init.status ?? 200,
  headers: { get: (name: string) => init.headers?.[name.toLowerCase()] ?? null },
  json: async () => init.body,
  text: async () => init.text ?? (typeof init.body === "string" ? init.body : JSON.stringify(init.body ?? "")),
  arrayBuffer: async () => (init.bytes ?? new Uint8Array([1, 2, 3])).buffer,
});

describe("parsePrice", () => {
  it("reads Colombian pesos: '.' groups thousands, ',' marks decimals", () => {
    expect(parsePrice("$95.000")).toBe(95000);
    expect(parsePrice("$ 1.250.000,50")).toBe(1250000.5);
  });

  it("reads other conventions when told which separators the menu prints", () => {
    expect(parsePrice("$12.50", { thousands: ",", decimal: "." })).toBe(12.5);
    expect(parsePrice("$1,250", { thousands: ",", decimal: "." })).toBe(1250);
  });

  it("scales menus that print thousands short", () => {
    expect(parsePrice("95", { scale: 1000 })).toBe(95000);
  });

  it("is null for text with no number", () => {
    expect(parsePrice("market price")).toBeNull();
    expect(parsePrice("")).toBeNull();
    expect(parsePrice(null)).toBeNull();
  });
});

describe("normalizePages", () => {
  const config = {
    currency: "cop",
    categories: [
      { slug: "cocina", name: "Comida", groups: ["food"] },
      { slug: "bar", name: "Bebidas", groups: ["drink"] },
    ],
    sections: { "Cócteles de Autor": "COCTELES DE AUTOR" },
  };
  const item = (name: string, price: string | null, extra: Anything = {}) => ({
    name,
    description: "",
    prices: price === null ? [] : [{ text: price, label: "" }],
    ...extra,
  });
  const page = (sections: Anything[], extra: Anything = {}) => ({ sections, notes: [], ...extra });

  it("places each section in the category that lists its group, with the currency in capitals", () => {
    const { menu, currency } = normalizePages(
      [
        page([
          { title: "Entradas", group: "food", items: [item("Empanadas", "$18.000", { description: "  Con   ají " })] },
          { title: "Cócteles de Autor", group: "drink", items: [item("Así es la Vida", "$32.000")] },
        ]),
      ],
      config,
    );
    expect(currency).toBe("COP");
    expect(menu).toEqual([
      {
        slug: "cocina",
        name: "Comida",
        sections: [
          {
            name: "ENTRADAS",
            products: [{ name: "Empanadas", description: "Con ají", price: 18000, currency: "COP", image_url: null, recommended: false }],
          },
        ],
      },
      { slug: "bar", name: "Bebidas", sections: [{ name: "COCTELES DE AUTOR", products: [expect.objectContaining({ name: "Así es la Vida" })] }] },
    ]);
  });

  it("merges sections with the same title and continues an untitled one across pages", () => {
    const { menu } = normalizePages(
      [
        page([{ title: "Fuertes", group: "food", items: [item("Lomo", "$50.000")] }]),
        page([{ title: null, group: "food", items: [item("Salmón", "$48.000")] }]),
        page([{ title: "FUERTES", group: "food", items: [item("Pollo", "$40.000")] }]),
      ],
      config,
    );
    expect(menu[0].sections).toHaveLength(1);
    expect(menu[0].sections[0].products.map((p: Anything) => p.name)).toEqual(["Lomo", "Salmón", "Pollo"]);
  });

  it("makes one product per priced column, named after the column", () => {
    const { menu } = normalizePages(
      [
        page([
          {
            title: "Vinos",
            group: "drink",
            items: [{ name: "Malbec", description: "", prices: [{ text: "$20.000", label: "Copa" }, { text: "$90.000", label: "Botella" }] }],
          },
        ]),
      ],
      config,
    );
    expect(menu[0].sections[0].products.map((p: Anything) => [p.name, p.price])).toEqual([
      ["Malbec (Copa)", 20000],
      ["Malbec (Botella)", 90000],
    ]);
  });

  it("keeps only the first of several prices that say nothing about what each is for, and says so", () => {
    const { menu, notes } = normalizePages(
      [page([{ title: "Vinos", group: "drink", items: [{ name: "Malbec", description: "", prices: [{ text: "$20.000", label: "" }, { text: "$90.000", label: "" }] }] }])],
      config,
    );
    expect(menu[0].sections[0].products).toHaveLength(1);
    expect(notes.join()).toContain("several prices without saying what each is for");
  });

  it("leaves out an item with no readable price, and says which", () => {
    const { menu, notes } = normalizePages([page([{ title: "Entradas", group: "food", items: [item("Sopa", "ask us"), item("Pan", "$5.000")] }])], config);
    expect(menu[0].sections[0].products.map((p: Anything) => p.name)).toEqual(["Pan"]);
    expect(notes.join()).toContain("Sopa (page 1)");
  });

  it("skips untitled items that come before any section", () => {
    const { menu, notes } = normalizePages([page([{ title: "", group: "food", items: [item("Pan", "$5.000")] }])], config);
    expect(menu).toEqual([]);
    expect(notes.join()).toContain("before any section heading");
  });

  it("skips sections the config skips, and sections of a group no category lists", () => {
    const { menu, notes } = normalizePages(
      [
        page([
          { title: "Postres", group: "food", items: [item("Flan", "$9.000")] },
          { title: "Promos", group: "other", items: [item("2x1", "$1")] },
        ]),
      ],
      { ...config, skipSections: ["postres"] },
    );
    expect(menu).toEqual([]);
    expect(notes.join()).toContain("Postres");
    expect(notes.join()).toContain("Promos (other)");
  });

  it("honours placeIn for a section the model tagged wrongly", () => {
    const { menu } = normalizePages([page([{ title: "Té", group: "food", items: [item("Té verde", "$6.000")] }])], { ...config, placeIn: { té: "bar" } });
    expect(menu[0].slug).toBe("bar");
  });

  it("carries page notes into the report, labelled with the page", () => {
    const { notes } = normalizePages([page([], { number: 3, notes: ["  price   blurred "] })], config);
    expect(notes).toEqual(["page 3: price blurred"]);
  });

  it("drops categories that end up empty", () => {
    const { menu } = normalizePages([page([{ title: "Entradas", group: "food", items: [item("Pan", "$5.000")] }])], config);
    expect(menu.map((c: Anything) => c.slug)).toEqual(["cocina"]);
  });

  it("refuses a bad currency or a placeIn that points nowhere", () => {
    expect(() => normalizePages([], { ...config, currency: "pesos" })).toThrow(/not a currency code/);
    expect(() => normalizePages([], { ...config, placeIn: { x: "nope" } })).toThrow(/"nope", which is not in config.categories/);
  });
});

describe("findImages", () => {
  const html = `
    <img src="/wp/page-1-600x1199.jpg" data-orig-src="/wp/page-1.jpg" alt="Página 1" width="900">
    <img src="data:image/gif;base64,AAAA" data-src="https://cdn.example.com/page-2.png?x=1&amp;y=2">
    <img src="/wp/logo.svg" width="900">
    <img src="/wp/icon.png" width="64">
    <img src='/wp/page-3.webp'>
    <img src="/wp/page-1.jpg">
    <img alt="no source">`;

  it("finds the large JPG, PNG and WebP pictures in document order, once each", () => {
    const urls = findImages(html, "https://menu.example.com/carta/").map((i: Anything) => i.url);
    expect(urls).toEqual([
      "https://menu.example.com/wp/page-1.jpg",
      "https://cdn.example.com/page-2.png?x=1&y=2",
      "https://menu.example.com/wp/page-3.webp",
    ]);
  });

  it("prefers the lazy-loader's real address to the placeholder, and the original to a WordPress thumbnail", () => {
    const [first] = findImages(`<img src="/wp/a-300x400.jpg">`, "https://x.co/");
    expect(first.url).toBe("https://x.co/wp/a.jpg");
  });

  it("keeps the alt text", () => {
    expect(findImages(html, "https://menu.example.com/")[0].alt).toBe("Página 1");
  });

  it("applies the minimum width the caller sets", () => {
    expect(findImages(`<img src="/a.jpg" width="300">`, "https://x.co/", { minWidth: 200 })).toHaveLength(1);
    expect(findImages(`<img src="/a.jpg" width="300">`, "https://x.co/")).toHaveLength(0);
  });
});

describe("discoverPages", () => {
  it("takes a direct image URL as a page without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await discoverPages(["https://x.co/menu-1.jpg?v=2"])).toEqual([{ url: "https://x.co/menu-1.jpg?v=2", alt: "" }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("scans a web page for its pictures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ text: `<img src="/a.jpg" width="800"><img src="/b.jpg" width="800">` })));
    const pages = await discoverPages(["https://x.co/carta/"]);
    expect(pages.map((p: Anything) => p.url)).toEqual(["https://x.co/a.jpg", "https://x.co/b.jpg"]);
  });

  it("says what to do when a page has no pictures, as JavaScript-loaded galleries do", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ text: "<html></html>" })));
    await expect(discoverPages(["https://x.co/carta/"], { minWidth: 300 })).rejects.toThrow(/No menu images found in https:\/\/x.co\/carta\/[\s\S]*at least 300px[\s\S]*pass them instead/);
  });

  it("rejects something that is not a URL", async () => {
    await expect(discoverPages(["carta"])).rejects.toThrow('"carta" is not a URL.');
  });

  it("does not retry a client error", async () => {
    const fetchMock = vi.fn(async () => reply({ status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(discoverPages(["https://x.co/carta/"])).rejects.toThrow("HTTP 404 fetching page https://x.co/carta/");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a server error, waiting longer each time", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply({ status: 503 }))
      .mockResolvedValueOnce(reply({ status: 502 }))
      .mockResolvedValueOnce(reply({ text: `<img src="/a.jpg" width="800">` }));
    vi.stubGlobal("fetch", fetchMock);
    const result = discoverPages(["https://x.co/carta/"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("pageId", () => {
  it("is a short, stable id for a URL", () => {
    expect(pageId("https://x.co/a.jpg")).toBe(pageId("https://x.co/a.jpg"));
    expect(pageId("https://x.co/a.jpg")).not.toBe(pageId("https://x.co/b.jpg"));
    expect(pageId("https://x.co/a.jpg")).toMatch(/^[0-9a-f]{10}$/);
  });
});

describe("downloadPage", () => {
  const host = `unit-test-${process.pid}`;
  const projectDir = mkdtempSync(join(tmpdir(), "tablefacts-cache-"));
  const cacheRoot = workDirIn(projectDir, "cache");
  afterEach(() => rmSync(join(cacheRoot, host), { recursive: true, force: true }));

  it("downloads once and serves the next call from the cache", async () => {
    const fetchMock = vi.fn(async () => reply({ headers: { "content-type": "image/png; charset=binary" }, bytes: new Uint8Array([9, 9]) }));
    vi.stubGlobal("fetch", fetchMock);
    const first = await downloadPage({ url: "https://x.co/a.png" }, host, { projectDir });
    expect(first.mediaType).toBe("image/png");
    expect(first.file.endsWith(".png")).toBe(true);
    expect([...readFileSync(first.file)]).toEqual([9, 9]);
    const second = await downloadPage({ url: "https://x.co/a.png" }, host, { projectDir });
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses anything that is not a JPG, PNG or WebP", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ headers: { "content-type": "text/html" } })));
    await expect(downloadPage({ url: "https://x.co/a.jpg" }, host, { projectDir })).rejects.toThrow("is text/html, not a JPG, PNG or WebP image");
    expect(existsSync(join(cacheRoot, host, `${pageId("https://x.co/a.jpg")}.jpg`))).toBe(false);
  });

  it("refuses a picture over 5 MB, which some providers cannot read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ headers: { "content-type": "image/jpeg" }, bytes: new Uint8Array(5 * 1024 * 1024 + 1) })));
    await expect(downloadPage({ url: "https://x.co/big.jpg" }, host, { projectDir })).rejects.toThrow(/5\.0 MB; menu pages are limited to 5 MB/);
  });
});

describe("vision providers", () => {
  const input = { model: "m", apiKey: "KEY", data: "BASE64", mediaType: "image/jpeg" };
  const transcription = { sections: [{ title: "Entradas", group: "food", items: [] }], notes: ["blurred"] };

  it("names the three providers and a default", () => {
    expect(Object.keys(providers).sort()).toEqual(["anthropic", "gemini", "groq"]);
    expect(Object.keys(providers)).toContain(defaultProvider);
    for (const provider of Object.values<Anything>(providers)) {
      expect(provider.keyName).toMatch(/_API_KEY$/);
      expect(provider.defaultModel).toBeTruthy();
    }
  });

  it("sends the picture to each provider the way its API expects, with the key in a header", () => {
    const anthropic = providers.anthropic.request(input);
    expect(anthropic.headers["x-api-key"]).toBe("KEY");
    expect(anthropic.body.messages[0].content[0].source).toEqual({ type: "base64", media_type: "image/jpeg", data: "BASE64" });
    expect(anthropic.body.tool_choice.type).toBe("tool");

    const gemini = providers.gemini.request(input);
    expect(gemini.url).toContain("/models/m:generateContent");
    expect(gemini.url).not.toContain("KEY");
    expect(gemini.headers["x-goog-api-key"]).toBe("KEY");
    expect(gemini.body.contents[0].parts[1].inlineData).toEqual({ mimeType: "image/jpeg", data: "BASE64" });

    const groq = providers.groq.request(input);
    expect(groq.headers.authorization).toBe("Bearer KEY");
    expect(groq.body.messages[0].content[1].image_url.url).toBe("data:image/jpeg;base64,BASE64");
    expect(groq.body.response_format.json_schema.strict).toBe(true);
  });

  it("reads the transcription out of each provider's answer", () => {
    expect(providers.anthropic.read({ content: [{ type: "tool_use", name: "record_menu_page", input: transcription }] })).toEqual(transcription);
    expect(providers.gemini.read({ candidates: [{ content: { parts: [{ text: JSON.stringify(transcription) }] } }] })).toEqual(transcription);
    expect(providers.groq.read({ choices: [{ message: { content: JSON.stringify(transcription) } }] })).toEqual(transcription);
  });

  it("ignores Gemini's thinking parts", () => {
    const answer = { candidates: [{ content: { parts: [{ thought: true, text: "hmm" }, { text: JSON.stringify(transcription) }] } }] };
    expect(providers.gemini.read(answer)).toEqual(transcription);
  });

  it("says why there is no transcription", () => {
    expect(() => providers.anthropic.read({ content: [], stop_reason: "max_tokens" })).toThrow(/cut off \(max_tokens\)/);
    expect(() => providers.anthropic.read({ content: [] })).toThrow(/without calling record_menu_page/);
    expect(() => providers.gemini.read({ promptFeedback: { blockReason: "SAFETY" } })).toThrow(/Gemini blocked the page \(SAFETY\)/);
    expect(() => providers.gemini.read({ candidates: [{ content: { parts: [{ text: "{" }] }, finishReason: "MAX_TOKENS" }] })).toThrow(/cut off \(token limit\)/);
    expect(() => providers.gemini.read({ candidates: [{ content: { parts: [{ text: "nope" }] } }] })).toThrow(/not valid JSON/);
    expect(() => providers.groq.read({ choices: [{ message: {}, finish_reason: "length" }] })).toThrow(/no text \(length\)/);
  });
});

describe("readPage", () => {
  const dir = mkdtempSync(join(tmpdir(), "cannario-vision-"));
  const file = join(dir, "page.jpg");
  writeFileSync(file, "pretend jpeg");
  const transcription = { sections: [], notes: ["ok"] };
  const answer = { content: [{ type: "tool_use", name: "record_menu_page", input: transcription }] };

  afterEach(() => vi.unstubAllEnvs());

  it("refuses a provider it does not know, including inherited object names", async () => {
    await expect(readPage({ file, mediaType: "image/jpeg" }, { provider: "openai", apiKey: "k" })).rejects.toThrow(/"openai" is not a provider/);
    await expect(readPage({ file, mediaType: "image/jpeg" }, { provider: "toString", apiKey: "k" })).rejects.toThrow(/is not a provider/);
  });

  it("says which key is missing, and where it goes", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(readPage({ file, mediaType: "image/jpeg" }, { provider: "anthropic" })).rejects.toThrow(/ANTHROPIC_API_KEY is not set. Add it to .env/);
  });

  it("posts the picture and returns the sections and notes", async () => {
    const fetchMock = vi.fn(async () => reply({ body: answer }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await readPage({ file, mediaType: "image/jpeg" }, { provider: "anthropic", apiKey: "k" });
    expect(result).toEqual({ sections: [], notes: ["ok"] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, Anything];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).messages[0].content[0].source.data).toBe(Buffer.from("pretend jpeg").toString("base64"));
  });

  it("reads the key from the environment", async () => {
    vi.stubEnv("GROQ_API_KEY", "from-env");
    const fetchMock = vi.fn(async () => reply({ body: { choices: [{ message: { content: JSON.stringify(transcription) } }] } }));
    vi.stubGlobal("fetch", fetchMock);
    await readPage({ file, mediaType: "image/jpeg" }, { provider: "groq" });
    expect((fetchMock.mock.calls[0] as unknown as [string, Anything])[1].headers.authorization).toBe("Bearer from-env");
  });

  it("does not retry a bad key", async () => {
    const fetchMock = vi.fn(async () => reply({ status: 401, text: "invalid x-api-key" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(readPage({ file, mediaType: "image/jpeg" }, { apiKey: "bad" })).rejects.toThrow("Anthropic API 401: invalid x-api-key");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries an overloaded service, and waits as long as it asks", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply({ status: 429, headers: { "retry-after": "7" }, text: "slow down" }))
      .mockResolvedValueOnce(reply({ body: answer }));
    vi.stubGlobal("fetch", fetchMock);
    const result = readPage({ file, mediaType: "image/jpeg" }, { apiKey: "k" });
    await vi.advanceTimersByTimeAsync(6999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ sections: [], notes: ["ok"] });
  });

  it("gives up at once on a quota that refills in hours", async () => {
    const fetchMock = vi.fn(async () => reply({ status: 429, headers: { "retry-after": "3600" }, text: "quota" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(readPage({ file, mediaType: "image/jpeg" }, { apiKey: "k" })).rejects.toThrow("Anthropic API 429");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads Gemini's own retry hint from the error body", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply({ status: 429, text: '{"error":{"details":[{"retryDelay": "3s"}]}}' }))
      .mockResolvedValueOnce(reply({ body: { candidates: [{ content: { parts: [{ text: JSON.stringify(transcription) }] } }] } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = readPage({ file, mediaType: "image/jpeg" }, { provider: "gemini", apiKey: "k" });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toEqual({ sections: [], notes: ["ok"] });
  });

  it("gives up after four attempts", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => reply({ status: 503, text: "overloaded" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = readPage({ file, mediaType: "image/jpeg" }, { apiKey: "k" });
    const settled = result.catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(((await settled) as Error).message).toContain("Anthropic API 503");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("accepts a page with no dishes (a thank-you card) and defaults its notes to empty", async () => {
    const empty = { content: [{ type: "tool_use", name: "record_menu_page", input: { sections: [] } }] };
    vi.stubGlobal("fetch", vi.fn(async () => reply({ body: empty })));
    expect(await readPage({ file, mediaType: "image/jpeg" }, { apiKey: "k" })).toEqual({ sections: [], notes: [] });
  });

  it("cleans up", () => {
    rmSync(dir, { recursive: true, force: true });
  });
});
