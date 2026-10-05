/* eslint-disable @typescript-eslint/no-explicit-any */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as pdfMod from "../src/menu/raw/pdf.mjs";
import * as importMod from "../src/menu/raw/import.mjs";
import * as imagesMod from "../src/menu/raw/images.mjs";
import * as visionMod from "../src/menu/raw/vision.mjs";

const { isPdfInput, textFromItems, readPdfSource, imageRects } = pdfMod as Record<string, any>;
const { fetchImageMenu, listMenuImages, findPages } = importMod as Record<string, any>;
const { matchPlacements, findNameItem } = imagesMod as Record<string, any>;
const { providers } = visionMod as Record<string, any>;

type Anything = Record<string, any>;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

const dirs: string[] = [];
const project = () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-pdf-"));
  dirs.push(dir);
  return dir;
};

/**
 * A minimal, valid PDF built by hand: objects with an xref whose byte offsets
 * are computed as the file is assembled. One content stream per page; `images`
 * are raw RGB XObjects a page draws with `cm ... /ImN Do`.
 */
function buildPdf(pages: { content: string; images?: { width: number; height: number; rgb: number[] }[] }[]) {
  let id = 0;
  const catalog = ++id;
  const pagesId = ++id;
  const font = ++id;
  const pageIds = pages.map(() => ++id);
  const contentIds = pages.map(() => ++id);
  const imageIds = pages.map((p) => (p.images ?? []).map(() => ++id));
  const objects: { id: number; head: string; stream?: Buffer }[] = [
    { id: catalog, head: `<< /Type /Catalog /Pages ${pagesId} 0 R >>` },
    { id: pagesId, head: `<< /Type /Pages /Kids [${pageIds.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>` },
    { id: font, head: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>` },
  ];
  pages.forEach((page, i) => {
    const xobject = (page.images ?? []).map((_, j) => `/Im${j} ${imageIds[i][j]} 0 R`).join(" ");
    objects.push({
      id: pageIds[i],
      head: `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${contentIds[i]} 0 R /Resources << /Font << /F1 ${font} 0 R >>${xobject ? ` /XObject << ${xobject} >>` : ""} >> >>`,
    });
    objects.push({ id: contentIds[i], head: `<< /Length ${Buffer.byteLength(page.content, "latin1")} >>`, stream: Buffer.from(page.content, "latin1") });
    (page.images ?? []).forEach((image, j) => {
      const data = Buffer.from(image.rgb);
      objects.push({
        id: imageIds[i][j],
        head: `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${data.length} >>`,
        stream: data,
      });
    });
  });
  objects.sort((a, b) => a.id - b.id);

  const chunks: Buffer[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: Buffer) => {
    chunks.push(data);
    length += data.length;
  };
  push(Buffer.from("%PDF-1.4\n", "latin1"));
  const size = id + 1;
  for (const object of objects) {
    offsets[object.id] = length;
    if (object.stream) {
      push(Buffer.from(`${object.id} 0 obj\n${object.head}\nstream\n`, "latin1"));
      push(object.stream);
      push(Buffer.from("\nendstream\nendobj\n", "latin1"));
    } else {
      push(Buffer.from(`${object.id} 0 obj\n${object.head}\nendobj\n`, "latin1"));
    }
  }
  const xref = length;
  push(Buffer.from(`xref\n0 ${size}\n0000000000 65535 f \n`, "latin1"));
  for (let i = 1; i < size; i++) push(Buffer.from(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`, "latin1"));
  push(Buffer.from(`trailer\n<< /Size ${size} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`, "latin1"));
  return Buffer.concat(chunks);
}

const writePdf = (projectDir: string, pages: Parameters<typeof buildPdf>[0], name = "carta.pdf") => {
  const file = join(projectDir, name);
  writeFileSync(file, buildPdf(pages));
  return file;
};

// Three dishes so a page has over 40 characters of text and is read as text.
const textPage = (items: [string, string][] = [["Empanadas", "$18.000"], ["Sopa de tomate", "$12.000"], ["Lomo al grill", "$50.000"]]) => ({
  content: items.map(([name, price], i) => `BT /F1 24 Tf 72 ${700 - i * 40} Td (${name} ${price}) Tj ET`).join("\n"),
});

const anthropicReply = (sections: unknown[], status = 200) =>
  new Response(status === 200 ? JSON.stringify({ content: [{ type: "tool_use", name: "record_menu_page", input: { sections, notes: [] } }] }) : "nope", { status });

const stubApi = (handler?: (body: Anything) => Response) => {
  const calls: Anything[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: Anything) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    return handler ? handler(body) : anthropicReply(defaultSections);
  });
  return calls;
};

// The default stub answers with one product so every test has something to normalize.
const defaultSections = [{ title: "Entradas", group: "food", items: [{ name: "Empanadas", description: null, prices: [{ text: "$18.000", label: null }] }] }];

describe("isPdfInput", () => {
  it("is true for a .pdf path or URL, false otherwise", () => {
    expect(isPdfInput("carta.pdf")).toBe(true);
    expect(isPdfInput("C:\\menus\\CARTA.PDF")).toBe(true);
    expect(isPdfInput("https://x.co/storage/menu/carta.pdf?token=1")).toBe(true);
    expect(isPdfInput("https://x.co/carta/")).toBe(false);
    expect(isPdfInput("menu.jpg")).toBe(false);
  });
});

describe("textFromItems", () => {
  const item = (str: string, x: number, y: number, height = 12) => ({ str, x, y, width: str.length * 6, height });

  it("joins pieces on one line in x order and starts a line at a new y", () => {
    const text = textFromItems([item("18.000", 300, 700), item("Empanadas", 72, 700), item("Sopa", 72, 690)]);
    expect(text).toBe("Empanadas 18.000\nSopa");
  });

  it("puts a blank line between far-apart groups so section breaks survive", () => {
    expect(textFromItems([item("ENTRADAS", 72, 720), item("Empanadas", 72, 700), item("BEBIDAS", 72, 500)])).toBe("ENTRADAS\nEmpanadas\n\nBEBIDAS");
  });

  it("ignores empty and non-text items", () => {
    expect(textFromItems([item("", 0, 0), { str: undefined }, item("Pan", 72, 700)])).toBe("Pan");
  });

  it("reads a two-column menu column by column", () => {
    const text = textFromItems([
      item("ENTRADAS", 72, 700), item("Lomo 50000", 72, 685), item("Pollo 40000", 72, 670),
      item("BEBIDAS", 360, 700), item("Agua 5000", 360, 685), item("Vino 20000", 360, 670),
    ]);
    expect(text).toBe("ENTRADAS\nLomo 50000\nPollo 40000\n\nBEBIDAS\nAgua 5000\nVino 20000");
  });

  it("leaves a single column of prices alone, even though it has a wide gap", () => {
    const text = textFromItems([
      item("Empanadas", 72, 700), item("18000", 340, 700),
      item("Sopa", 72, 685), item("12000", 340, 685),
      item("Lomo", 72, 670), item("50000", 340, 670),
    ]);
    expect(text).toBe("Empanadas 18000\nSopa 12000\nLomo 50000");
  });
});

describe("imageRects", () => {
  it("turns pdfjs' three-point coordinates into a pixel rectangle", () => {
    const canvas = { width: 100, height: 200 };
    expect(imageRects(canvas, [0, 0, 0, 1, 1, 0])).toEqual([{ x: 0, y: 0, width: 100, height: 200 }]);
    expect(imageRects(canvas, [0.1, 0.25, 0.1, 0.5, 0.3, 0.25])).toEqual([{ x: 10, y: 50, width: 20, height: 50 }]);
    expect(imageRects(canvas, [])).toEqual([]);
  });
});

describe("readPdfSource", () => {
  it("reads a local PDF and rejects a file that is not one", async () => {
    const projectDir = project();
    const file = writePdf(projectDir, [textPage()]);
    const source = await readPdfSource(file, { projectDir });
    expect(source.host).toBe("local");
    expect(Buffer.from(source.bytes.subarray(0, 5)).toString()).toBe("%PDF-");

    const notPdf = join(projectDir, "not.pdf");
    writeFileSync(notPdf, "hello");
    await expect(readPdfSource("not.pdf", { projectDir })).rejects.toMatchObject({ code: "EUSAGE" });
  });

  it("reports a missing file as a usage error", async () => {
    const projectDir = project();
    await expect(readPdfSource("nope.pdf", { projectDir })).rejects.toThrow(/Could not read/);
  });
});

describe("PDF menu pipeline", () => {
  it("lists a PDF's pages with their text size", async () => {
    const projectDir = project();
    const file = writePdf(projectDir, [textPage(), { content: "q 400 0 0 400 100 300 cm /Im0 Do Q", images: [{ width: 1, height: 1, rgb: [1, 2, 3] }] }]);
    const pages = await listMenuImages({ urls: [file], projectDir });
    expect(pages.map((p: Anything) => [p.number, p.kind])).toEqual([[1, "pdf"], [2, "pdf"]]);
    expect(pages[0].chars).toBeGreaterThan(40);
    expect(pages[1].chars).toBe(0);
  });

  it("reads a text PDF page with the model, normalizes the price and caches the transcription", async () => {
    const projectDir = project();
    const file = writePdf(projectDir, [textPage()]);
    const calls = stubApi();
    const first = await fetchImageMenu({ urls: [file], apiKey: "k", projectDir });
    expect(calls).toHaveLength(1);
    expect(first.menu[0].sections[0].products[0]).toMatchObject({ name: "Empanadas", price: 18000, currency: "COP" });
    expect(first.title).toMatch(/PDF menu: 1 pages/);
    // The page text reaches the model, fenced as data.
    expect(JSON.stringify(calls[0])).toContain("<<<PAGE");

    const second = await fetchImageMenu({ urls: [file], apiKey: "k", projectDir });
    expect(calls).toHaveLength(1); // served from the saved transcription
    expect(second.title).toMatch(/0 read/);
    expect(existsSync(join(projectDir, ".tablefacts", "cache", "local"))).toBe(true);
  });

  it("--only selects PDF pages, and a bad selection is a usage error", async () => {
    const projectDir = project();
    const file = writePdf(projectDir, [textPage(), textPage([["Ceviche", "$30.000"]])]);
    const found = await findPages({ urls: [file], only: "2", projectDir });
    expect(found.chosen.map((p: Anything) => p.number)).toEqual([2]);
    await found.close();
    await expect(findPages({ urls: [file], only: "9", projectDir })).rejects.toMatchObject({ code: "EUSAGE" });
  });

  it("a scanned page is rendered and read as a picture", async () => {
    const projectDir = project();
    const file = writePdf(projectDir, [{ content: "q 100 0 0 100 200 500 cm /Im0 Do Q", images: [{ width: 4, height: 4, rgb: Array(48).fill(9) }] }]);
    const calls = stubApi();
    const result = await fetchImageMenu({ urls: [file], apiKey: "k", projectDir });
    expect(calls).toHaveLength(1);
    // A scan is sent as an image, not text.
    expect(JSON.stringify(calls[0])).toContain("image/png");
    expect(result.menu[0].sections[0].products).toHaveLength(1);
    // The rendered page is kept next to the transcription.
    const cache = join(projectDir, ".tablefacts", "cache", "local");
    expect(readdirSync(cache).some((f) => f.endsWith(".png"))).toBe(true);
  });
});

describe("product photos from a PDF", () => {
  it("screenshots a placed image, matches it to the dish by name and saves it", async () => {
    const projectDir = project();
    const page = {
      ...textPage(),
      images: [{ width: 8, height: 8, rgb: Array(192).fill(0).map((_, i) => i % 255) }],
    };
    // Draw the photo under the Empanadas line (y 700), fully on the page.
    page.content += "\nq 120 0 0 120 72 600 cm /Im0 Do Q";
    const file = writePdf(projectDir, [page]);
    stubApi(() => anthropicReply([{ title: "Entradas", group: "food", items: [{ name: "Empanadas", description: null, prices: [{ text: "$18.000", label: null }] }] }]));

    const imagesDir = join(projectDir, "photos");
    const result = await fetchImageMenu({ urls: [file], apiKey: "k", projectDir, imageDir: imagesDir, imageBaseUrl: "https://cdn.example.com/menu/" });
    expect(result.menu[0].sections[0].products[0].image_url).toMatch(/^https:\/\/cdn\.example\.com\/menu\/p1-001-empanadas\.png$/);
    expect(readdirSync(imagesDir)).toEqual(["p1-001-empanadas.png"]);
    expect(result.notes.join("\n")).toMatch(/Saved 1 product photo/);

    // The crop is the photo's region (~120x120 at scale 2), not the whole page.
    const png = readFileSync(join(imagesDir, "p1-001-empanadas.png"));
    expect(png.readUInt32BE(16)).toBeGreaterThan(230);
    expect(png.readUInt32BE(16)).toBeLessThan(260);
    expect(png.readUInt32BE(20)).toBeGreaterThan(230);
    expect(png.readUInt32BE(20)).toBeLessThan(260);
  });

  it("places a photo correctly even under nested transforms", async () => {
    const projectDir = project();
    const page = { ...textPage(), images: [{ width: 8, height: 8, rgb: Array(192).fill(3) }] };
    // The same visual placement as above, but reached through two `cm`s:
    // q 2 0 0 2 0 0 cm q 60 0 0 60 36 360 cm /Im0 Do Q Q  ->  (72,720)-(192,840)
    page.content += "\nq 2 0 0 2 0 0 cm q 60 0 0 60 36 360 cm /Im0 Do Q Q";
    const file = writePdf(projectDir, [page]);
    stubApi(() => anthropicReply([{ title: "Entradas", group: "food", items: [{ name: "Empanadas", description: null, prices: [{ text: "$18.000", label: null }] }] }]));
    const result = await fetchImageMenu({ urls: [file], apiKey: "k", projectDir, imageDir: join(projectDir, "photos"), imageBaseUrl: "https://cdn.example.com/m/" });
    expect(result.menu[0].sections[0].products[0].image_url).toBe("https://cdn.example.com/m/p1-001-empanadas.png");
  });

  it("asks the model for photo boxes when a page's photos are flattened into it", async () => {
    const projectDir = project();
    // Text (so it would normally be read as text) plus one image covering the
    // whole page: geometry drops it, so the model must look at the page.
    const page = { ...textPage(), images: [{ width: 4, height: 4, rgb: Array(48).fill(0).map((_, i) => i % 255) }] };
    page.content += "\nq 612 0 0 792 0 0 cm /Im0 Do Q";
    const file = writePdf(projectDir, [page]);
    const calls = stubApi(() => anthropicReply([{ title: "Fuertes", group: "food", items: [{ name: "Lomo", description: null, prices: [{ text: "$50.000", label: null }], box: [0.1, 0.1, 0.2, 0.2] }] }]));
    const result = await fetchImageMenu({ urls: [file], apiKey: "k", projectDir, imageDir: join(projectDir, "photos"), imageBaseUrl: "https://cdn.example.com/m/" });
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0])).toContain("image/png"); // the page itself was read
    expect(result.menu[0].sections[0].products[0].image_url).toBe("https://cdn.example.com/m/p1-001-lomo.png");
    expect(result.notes.join("\n")).toMatch(/Saved 1 product photo/);
  });

  it("still reads a text page as text when photos are not requested", async () => {
    const projectDir = project();
    const page = { ...textPage(), images: [{ width: 4, height: 4, rgb: Array(48).fill(9) }] };
    page.content += "\nq 612 0 0 792 0 0 cm /Im0 Do Q";
    const file = writePdf(projectDir, [page]);
    const calls = stubApi();
    await fetchImageMenu({ urls: [file], apiKey: "k", projectDir });
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0])).not.toContain("image/png");
  });

  it("--image-boxes always reads every PDF page as a picture", async () => {
    const projectDir = project();
    const page = { ...textPage(), images: [{ width: 8, height: 8, rgb: Array(192).fill(1) }] };
    page.content += "\nq 120 0 0 120 72 600 cm /Im0 Do Q";
    const file = writePdf(projectDir, [page]);
    const calls = stubApi(() => anthropicReply([{ title: "Fuertes", group: "food", items: [{ name: "Lomo", description: null, prices: [{ text: "$50.000", label: null }], box: [0.1, 0.1, 0.2, 0.2] }] }]));
    const result = await fetchImageMenu({ urls: [file], apiKey: "k", projectDir, imageDir: join(projectDir, "photos"), imageBaseUrl: "https://cdn.example.com/m/", imageBoxes: "always" });
    expect(JSON.stringify(calls[0])).toContain("image/png");
    expect(result.menu[0].sections[0].products[0].image_url).toBe("https://cdn.example.com/m/p1-001-lomo.png");
  });

  it("rejects an unknown imageBoxes value before reading anything", async () => {
    const projectDir = project();
    const file = writePdf(projectDir, [textPage()]);
    await expect(fetchImageMenu({ urls: [file], apiKey: "k", projectDir, imageBoxes: "sometimes" })).rejects.toMatchObject({ code: "EUSAGE", option: "imageBoxes" });
  });

  it("saves the crops locally and leaves image_url empty without a base URL", async () => {
    const projectDir = project();
    const page = { ...textPage(), images: [{ width: 8, height: 8, rgb: Array(192).fill(5) }] };
    page.content += "\nq 120 0 0 120 72 720 cm /Im0 Do Q";
    const file = writePdf(projectDir, [page]);
    stubApi(() => anthropicReply([{ title: "Entradas", group: "food", items: [{ name: "Empanadas", description: null, prices: [{ text: "$18.000", label: null }] }] }]));
    const result = await fetchImageMenu({ urls: [file], apiKey: "k", projectDir, imageDir: join(projectDir, "photos") });
    expect(result.menu[0].sections[0].products[0].image_url).toBeNull();
    expect(result.notes.join("\n")).toMatch(/re-run with `imageBaseUrl`/);
  });

  it("refuses a non-https base URL before reading anything", async () => {
    const projectDir = project();
    const file = writePdf(projectDir, [textPage()]);
    await expect(fetchImageMenu({ urls: [file], apiKey: "k", projectDir, imageBaseUrl: "http://x.co/m/" })).rejects.toMatchObject({ code: "EUSAGE", option: "imageBaseUrl" });
  });

  it("crops the model's box on a scanned page", async () => {
    const projectDir = project();
    const file = writePdf(projectDir, [{ content: "q 100 0 0 100 200 500 cm /Im0 Do Q", images: [{ width: 4, height: 4, rgb: Array(48).fill(7) }] }]);
    stubApi(() => anthropicReply([{ title: "Fuertes", group: "food", items: [{ name: "Lomo", description: null, prices: [{ text: "$50.000", label: null }], box: [0.1, 0.1, 0.2, 0.2] }] }]));
    const result = await fetchImageMenu({ urls: [file], apiKey: "k", projectDir, imageDir: join(projectDir, "photos"), imageBaseUrl: "https://cdn.example.com/m/" });
    expect(result.menu[0].sections[0].products[0].image_url).toBe("https://cdn.example.com/m/p1-001-lomo.png");
  });
});

describe("matchPlacements", () => {
  const page = (extra: Anything = {}) => ({ width: 612, items: [], placed: [], direct: [], ...extra });

  it("matches by geometry and does not warn about dishes that have no photo", () => {
    const pages = new Map([[1, page({ items: [{ str: "Empanadas", x: 72, y: 700, width: 100, height: 12 }], placed: [{ id: "1:p0", png: Buffer.from("x"), rect: { x0: 72, y0: 720, x1: 192, y1: 800 } }] })]]);
    const { matches, notes } = matchPlacements(
      [
        { page: 1, name: "Empanadas", box: null, products: [{}] },
        { page: 1, name: "Sopa", box: null, products: [{}] },
      ],
      pages,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].crop.id).toBe("1:p0");
    expect(notes).toEqual([]);
  });

  it("names photos that were found but not matched to a dish", () => {
    const pages = new Map([[1, page({ items: [{ str: "Sopa", x: 0, y: 0, width: 10, height: 10 }], placed: [{ id: "1:p0", png: Buffer.from("x"), rect: { x0: 300, y0: 300, x1: 400, y1: 400 } }] })]]);
    const { matches, notes } = matchPlacements([{ page: 1, name: "Sopa", box: null, products: [{}] }], pages);
    expect(matches).toHaveLength(0);
    expect(notes.join()).toMatch(/1 printed photo\(s\) could not be matched/);
  });

  it("uses the model's item name on a scanned page", () => {
    const pages = new Map([[1, page({ direct: [{ id: "1:b0", png: Buffer.from("x"), name: "Lomo" }] })]]);
    const { matches } = matchPlacements([{ page: 1, name: "Lomo", box: [0, 0, 1, 1], products: [{}] }], pages);
    expect(matches[0].crop.id).toBe("1:b0");
  });

  it("does not give one photo to two items", () => {
    const pages = new Map([[1, page({ items: [{ str: "A", x: 0, y: 0, width: 10, height: 10 }, { str: "B", x: 0, y: 20, width: 10, height: 10 }], placed: [{ id: "1:p0", png: Buffer.from("x"), rect: { x0: 15, y0: 5, x1: 25, y1: 25 } }] })]]);
    const { matches } = matchPlacements(
      [
        { page: 1, name: "A", box: null, products: [{}] },
        { page: 1, name: "B", box: null, products: [{}] },
      ],
      pages,
    );
    expect(matches).toHaveLength(1);
  });

  it("findNameItem prefers an exact line over one that merely contains the name", () => {
    const found = findNameItem([{ str: "Vino Malbec", x: 0, y: 0, width: 10, height: 10 }, { str: "Malbec", x: 0, y: 0, width: 10, height: 10 }], "Malbec");
    expect(found.str).toBe("Malbec");
  });

  it("findNameItem does not match a name inside a longer word", () => {
    expect(findNameItem([{ str: "Banana split", x: 0, y: 0, width: 10, height: 10 }], "Ana")).toBeNull();
  });
});

describe("text mode on the vision providers", () => {
  it("sends the page text without an image and keeps the one-part shape each API expects", () => {
    const input = { model: "m", apiKey: "K", text: "MENU", withBoxes: false };
    const anthropic = providers.anthropic.request(input);
    expect(anthropic.body.messages[0].content).toHaveLength(1);
    expect(anthropic.body.messages[0].content[0].text).toContain("MENU");

    const gemini = providers.gemini.request(input);
    expect(gemini.body.contents[0].parts).toHaveLength(1);

    const groq = providers.groq.request(input);
    expect(groq.body.messages[0].content).toHaveLength(1);
  });

  it("adds the photo box to the schema only when boxes are requested", () => {
    const without = providers.anthropic.request({ model: "m", apiKey: "K", data: "B", mediaType: "image/png", withBoxes: false });
    const item = without.body.tools[0].input_schema.properties.sections.items.properties.items.items;
    expect(item.properties.box).toBeUndefined();

    const withBoxes = providers.groq.request({ model: "m", apiKey: "K", data: "B", mediaType: "image/png", withBoxes: true });
    const boxedItem = withBoxes.body.response_format.json_schema.schema.properties.sections.items.properties.items.items;
    expect(boxedItem.required).toContain("box");
    expect(boxedItem.properties.box.type).toEqual(["array", "null"]);
  });
});
