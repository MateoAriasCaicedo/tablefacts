// Reads one menu page picture with a vision model and returns its sections and
// dishes as data. The model transcribes; it does not interpret: prices come back
// as the text printed on the page ("$95.000") and normalize.mjs turns them into
// numbers, so a misjudged thousands separator cannot silently turn 95.000
// into 95.
//
// Anthropic, Gemini and Groq can read the pages. A provider is only how to send
// the picture and how to get the transcription out of the answer; the schema,
// the instructions, the retries and the checks are shared, so all of them return
// the same `{ sections, notes }`.
import { readFileSync } from "node:fs";
import { resolveEnv } from "../../lib/env.mjs";
import { optionError, TablefactsError } from "../../lib/errors.mjs";

const TOOL = "record_menu_page";
const MAX_TOKENS = 16000; // Groq's model stops at 16,384

// Every object is closed and every property required: Groq's strict mode
// demands both, and Anthropic and Gemini accept them.
const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sections: {
      type: "array",
      description: "Every menu section visible on the page, top to bottom (left column before right).",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: {
            type: ["string", "null"],
            description: "The section heading as printed (e.g. ENTRADAS, GIN). null when the page starts with dishes that continue the previous page's section, with no heading of their own.",
          },
          group: {
            type: "string",
            enum: ["food", "drink", "other"],
            description: "food: dishes, sides, desserts. drink: cocktails, wine, beer, spirits, coffee, soft drinks. other: anything not sold from the menu (thanks, QR code, chef's note).",
          },
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                description: { type: ["string", "null"], description: "Ingredients or details printed under or beside the name, joined into one line; null if none." },
                prices: {
                  type: "array",
                  description: "One entry per price printed for this item, left to right.",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      text: { type: "string", description: "The price exactly as printed, e.g. \"$95.000\" or \"12,5\"." },
                      label: {
                        type: ["string", "null"],
                        description: "What this price is for when the page says so, in the page's language: a size, a serving, or what a column icon stands for (a bottle icon is \"Botella\", a glass icon is \"Copa\" or \"Trago\"). null when there is a single price.",
                      },
                    },
                    required: ["text", "label"],
                  },
                },
              },
              required: ["name", "description", "prices"],
            },
          },
        },
        required: ["title", "group", "items"],
      },
    },
    notes: {
      type: "array",
      items: { type: "string" },
      description: "Anything a person should check: text too small or blurred to read with confidence, an item you could not place, a price you are unsure of. Empty when the page is clear.",
    },
  },
  required: ["sections", "notes"],
};

const intro = "You are transcribing one page of a restaurant menu from a picture, to load it into a database.";

const rules = `Rules:
- Transcribe, do not improve. Keep the language of the page, its spelling and accents. Never translate, invent, or fill in an item, ingredient or price that is not visible.
- Dish and drink names printed in capitals only as a style (LOMO AL GRILL) are written with normal capitalization (Lomo al Grill); keep capitals that are part of the name (MOM Gin, VSPR).
- Join a description that wraps over several lines into one line. Drop the dotted or underscore leaders between a name and its price.
- A price is only a price: copy the digits and separators as printed, drop nothing, add nothing. Currency symbols may stay.
- When a section has several price columns, give every item one price per column in the same order, and label each by the column heading or icon.
- Boxes and panels on one page (a side-dishes panel under the main list) are sections of their own.
- Decorative borders, logos, page numbers and chef's notes are not items. A page with no dishes or drinks (a thank-you card) returns no sections with items.
- If something is hard to read, give your best reading and say so in notes.`;

// Anthropic is made to call a tool. Gemini and Groq answer in JSON whose shape
// their server enforces; the schema goes in the prompt as well, because the
// descriptions in it only help if the model sees them.
const asToolCall = `${intro} Call ${TOOL} exactly once.\n\n${rules}`;
const asJson = `${intro} Answer with one JSON object that follows this JSON Schema, and nothing else.\n\n${rules}\n\nJSON Schema:\n${JSON.stringify(schema)}`;

const unusable = (why) => new TablefactsError(`The model did not return a usable transcription: ${why}.`, "EFAILED");

/** A JSON answer that stops in the middle was cut off by the token limit. */
function parseJson(text, cutOff) {
  try {
    return JSON.parse(text);
  } catch {
    throw unusable(cutOff ? "its answer was cut off (token limit)" : "its answer was not valid JSON");
  }
}

// `request` builds the call for one picture (`data` is its base64) and `read`
// returns the transcription object from the answer, or throws why there is none.
/** @type {Record<string, import('../../lib/types.mjs').VisionProvider>} */
export const providers = {
  anthropic: {
    label: "Anthropic",
    keyName: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-5-5",
    request: ({ model, apiKey, data, mediaType }) => ({
      url: "https://api.anthropic.com/v1/messages",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: {
        model,
        max_tokens: MAX_TOKENS,
        tools: [{ name: TOOL, description: "Record the sections and items transcribed from the menu page.", input_schema: schema }],
        tool_choice: { type: "tool", name: TOOL },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data } },
              { type: "text", text: asToolCall },
            ],
          },
        ],
      },
    }),
    read(response) {
      const call = response.content?.find((block) => block.type === "tool_use" && block.name === TOOL);
      if (!Array.isArray(call?.input?.sections)) {
        throw unusable(response.stop_reason === "max_tokens" ? "its answer was cut off (max_tokens)" : `it answered without calling ${TOOL}`);
      }
      return call.input;
    },
  },

  gemini: {
    label: "Gemini",
    keyName: "GEMINI_API_KEY",
    defaultModel: "gemini-3.8-flash",
    // generateContent, not the Interactions API the guides now lead with: that
    // one is in beta and its schema has already changed once, while Google
    // keeps generateContent as the path for stable use.
    request: ({ model, apiKey, data, mediaType }) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      headers: { "x-goog-api-key": apiKey },
      body: {
        contents: [{ role: "user", parts: [{ text: asJson }, { inlineData: { mimeType: mediaType, data } }] }],
        // Thinking models count their thoughts against the limit: leave room.
        generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema, maxOutputTokens: 32000 },
      },
    }),
    read(response) {
      const candidate = response.candidates?.[0];
      const text = (candidate?.content?.parts ?? []).filter((part) => !part.thought).map((part) => part.text ?? "").join("");
      if (!text) {
        const blocked = response.promptFeedback?.blockReason;
        throw unusable(blocked ? `Gemini blocked the page (${blocked})` : `it answered with no text (${candidate?.finishReason ?? "no candidate"})`);
      }
      return parseJson(text, candidate.finishReason === "MAX_TOKENS");
    },
  },

  groq: {
    label: "Groq",
    keyName: "GROQ_API_KEY",
    // The only vision model Groq lists (October 2026), and a preview one: when
    // it is retired, `model` names its successor.
    defaultModel: "qwen/qwen3.8-27b",
    request: ({ model, apiKey, data, mediaType }) => ({
      url: "https://api.groq.com/openai/v1/chat/completions",
      headers: { authorization: `Bearer ${apiKey}` },
      body: {
        model,
        messages: [{ role: "user", content: [{ type: "text", text: asJson }, { type: "image_url", image_url: { url: `data:${mediaType};base64,${data}` } }] }],
        response_format: { type: "json_schema", json_schema: { name: TOOL, strict: true, schema } },
        // Reading a page needs no reasoning, and none may leak into the JSON.
        reasoning_effort: "none",
        reasoning_format: "hidden",
        max_completion_tokens: MAX_TOKENS,
      },
    }),
    read(response) {
      const choice = response.choices?.[0];
      const text = choice?.message?.content;
      if (!text) throw unusable(`it answered with no text (${choice?.finish_reason ?? "no choice"})`);
      return parseJson(text, choice.finish_reason === "length");
    },
  },
};

export const defaultProvider = "anthropic";

const ATTEMPTS = 4;
const RETRY_STATUSES = [408, 429, 500, 502, 503, 504, 529];
const LONGEST_WAIT = 60; // seconds

/** Seconds the service asks us to wait: Retry-After (Groq, Anthropic) or the RetryInfo in a Gemini error. */
function askedWait(res, detail) {
  return [Number(res.headers.get("retry-after")), Number(detail.match(/"retryDelay":\s*"([\d.]+)s"/)?.[1])].find((seconds) => seconds > 0);
}

async function callApi(label, { url, headers, body }) {
  let failure;
  const payload = JSON.stringify(body);
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let wait = attempt * 2000;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: payload,
        signal: AbortSignal.timeout(180_000),
      });
      if (res.ok) return await res.json();
      const detail = await res.text();
      failure = Object.assign(new TablefactsError(`${label} API ${res.status}: ${detail.slice(0, 300)}`, "EFAILED"), { status: res.status });
      if (!RETRY_STATUSES.includes(res.status)) break; // a bad key or request will not fix itself
      const asked = askedWait(res, detail);
      if (asked > LONGEST_WAIT) break; // a quota that refills in hours is not worth waiting for here
      if (asked) wait = asked * 1000;
    } catch (error) {
      failure = error;
    }
    if (attempt < ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, wait));
  }
  throw failure;
}

/** `file` is a downloaded picture; returns `{ sections, notes }` as the schema above describes. */
export async function readPage({ file, mediaType }, { provider = defaultProvider, model, apiKey, env } = {}) {
  const reader = Object.hasOwn(providers, provider) ? providers[provider] : null;
  const names = Object.keys(providers).join(", ");
  if (!reader) throw optionError("provider", `"${provider}" is not a provider the pages can be read with (${names}).`, "ECONFIG");
  apiKey ??= resolveEnv(env)[reader.keyName];
  if (!apiKey) {
    throw optionError("provider", `${reader.keyName} is not set. Add it to .env (see .env.example); the menu pages are read with ${reader.label}. To use another provider, pass \`provider\` (${names}).`, "ECONFIG");
  }
  const request = reader.request({ model: model ?? reader.defaultModel, apiKey, data: readFileSync(file).toString("base64"), mediaType });
  const answer = reader.read(await callApi(reader.label, request));
  if (!Array.isArray(answer?.sections)) throw unusable('its answer has no "sections" list');
  return { sections: answer.sections, notes: Array.isArray(answer.notes) ? answer.notes : [] };
}
