// Turns a profile into what a person (or an agent) acts on: a report that mirrors
// BRIEF.md's table, and the answers file `npm run setup` reads from stdin.
const val = (f) => {
  if (!f) return "";
  const v = f.value;
  if (Array.isArray(v)) return v.join(", ");
  if (v && typeof v === "object") return `${v.lat}, ${v.lng}`;
  return String(v);
};

const ROWS = [
  ["Legal and display name", "name", "`site.name`"],
  ["Street address", "street", "`site.street`"],
  ["City", "locality", "`site.locality`"],
  ["Region", "region", "`site.region`"],
  ["Country (ISO)", "country", "`site.country`"],
  ["Map point", "coordinates", "`site.coordinates`"],
  ["WhatsApp number", "whatsapp", "`site.whatsapp`, `whatsappDisplay`"],
  ["Landline or reservations number", "phone", "`site.phone` (hide it if it is the WhatsApp number)"],
  ["Email", "email", "`site.email`"],
  ["Instagram", "instagram", "`site.instagram`, `instagramHandle`"],
  ["Reservations platform", "reserveUrl", "`site.reserveUrl` (WhatsApp link if none)"],
  ["Cuisine(s)", "cuisines", "`site.cuisines`"],
  ["Price range", "priceRange", "BRIEF only"],
  ["Menu language", "menuLocale", "`MENU_LOCALE`"],
  ["Current website", "website", "reference (the new `site.url` is the new domain)"],
  ["TripAdvisor", "tripadvisor", "reference"],
  ["Facebook", "facebook", "reference"],
  ["TikTok", "tiktok", "reference"],
  ["Google Maps", "mapsUrl", "reference"],
  ["Descriptor (tagline idea)", "descriptor", "`brand.tagline`, both languages"],
];

const cell = (s) => String(s).replace(/\|/g, "\\|");

export function renderReport(p, { notes, photos }) {
  const out = [];
  const q = p.query;
  out.push(`# Research: ${q.name}${q.location ? `, ${q.location}` : ""}`, "", `Generated ${p.generatedAt}. Everything here is **unconfirmed**: check it with the client and copy the answers into \`BRIEF.md\`. Sources disagree often, and the confidence column says how many agreed.`, "");
  if (p.warnings.length) out.push("## Warnings", "", ...p.warnings.map((w) => `- ${w}`), "");
  if (notes.length) out.push("## What each source did", "", ...notes.map((n) => `- ${n}`), "");

  out.push("## Facts", "", "| Item | Value | Source | Confidence | Goes in |", "| --- | --- | --- | --- | --- |");
  for (const [label, key, goes] of ROWS) {
    const f = p.fields[key];
    out.push(`| ${label} | ${f ? cell(val(f)) : "_not found_"} | ${f?.source ?? ""} | ${f?.confidence ?? ""} | ${goes} |`);
  }
  out.push("");

  const conflicts = Object.entries(p.fields).filter(([, f]) => f?.alternatives?.length);
  if (conflicts.length) {
    out.push("## Sources disagree", "");
    for (const [key, f] of conflicts) out.push(`- **${key}**: using \`${val(f)}\` (${f.source}); others say ${f.alternatives.map((a) => `\`${val({ value: a.value })}\` (${a.source})`).join(", ")}`);
    out.push("");
  }
  for (const key of ["whatsapp", "menuLocale"]) if (p.fields[key]?.note) out.push(`> ${key}: ${p.fields[key].note}`, "");

  out.push("## Opening hours", "");
  if (p.hours) {
    out.push(`From ${p.hours.source} (${p.hours.confidence}). Paste into \`visit.hoursRows\`:`, "");
    for (const lang of ["es", "en"]) out.push(`\`${lang}\``, "```ts", "hoursRows: [", ...p.hours.rows[lang].map((r) => `  { label: ${JSON.stringify(r.label)}, value: ${JSON.stringify(r.value)} },`), "],", "```", "");
    for (const c of p.hours.conflicts) out.push(`- ${c.source} disagrees: ${c.rows.map((r) => `${r.label} ${r.value}`).join("; ")}`);
  } else out.push("No structured hours found.");
  if (p.textHours.length) out.push("", "Hours text found on the website (verify, then use):", ...p.textHours.map((t) => `- ${t}`));
  out.push("");

  out.push("## Links worth following", "");
  const list = (label, arr) => arr.length && out.push(`- **${label}:** ${arr.map((u) => u).join(", ")}`);
  list("Menu", p.links.menu);
  list("Delivery", p.links.delivery);
  list("Link-in-bio", p.links.hubs);
  list("Waze", p.links.waze);
  if (p.links.menu.some((u) => /cluvi/i.test(u))) out.push("- The menu is on Cluvi: use `tablefacts menu cluvi` (see `src/menu/README.md` in the tablefacts package).");
  else if (p.links.menu.some((u) => /\.pdf/i.test(u))) out.push("- The menu is a PDF: `tablefacts menu raw` reads it.");
  out.push("");

  if (p.ratings.length) out.push("## Ratings (context only)", "", ...p.ratings.map((r) => `- ${r.source}: ${r.value}${r.count ? ` (${r.count} reviews)` : ""}`), "");
  if (p.social.instagram && !p.social.instagram.blocked) out.push(`Instagram @${p.social.instagram.handle}: ${p.social.instagram.followers} followers, ${p.social.instagram.posts} posts.`, "");

  out.push("## Images", "");
  out.push(`- Website images found: ${p.images.site.length}; link-in-bio: ${p.images.hub.length}; Google photos available: ${p.images.googlePhotos}.`);
  if (p.images.logos[0]) out.push(`- Logo candidates: ${p.images.logos.slice(0, 4).map((l) => l.url).join(", ")}`);
  if (p.images.themeColor) out.push(`- Site theme colour: \`${p.images.themeColor}\` (a hint for \`tokens.css\`).`);
  if (photos.length) out.push(`- Downloaded to \`photos/\` (${photos.length}). **They are reference, not assets**: the restaurant or the photographer owns them. Ask the client for originals, or get written permission, before shipping any.`);
  out.push("");

  out.push("## Material for the copy", "", "Facts and tone only. Rewrite it in the template's voice in both languages; do not paste it.", "");
  const c = p.copySources;
  for (const [label, text] of [["Google summary", c.googleSummary], ["Site description", c.siteDescription], ["Instagram bio", c.instagramBio], ["TripAdvisor", c.tripadvisor]]) if (text) out.push(`- **${label}:** ${text}`);
  if (c.headings.length) out.push(`- **Site headings:** ${c.headings.slice(0, 12).join(" / ")}`);
  for (const t of c.paragraphs.slice(0, 6)) out.push(`  - ${t}`);
  out.push("");

  const missing = ROWS.filter(([, key]) => !p.fields[key] && ["name", "street", "coordinates", "whatsapp", "instagram", "reserveUrl", "cuisines"].includes(key)).map(([l]) => l);
  out.push("## Ask the client", "", ...[...missing, "Opening hours incl. holidays", "Logo as SVG and original photos", "The story, signature dishes and events", "Production domain"].filter((v, i, a) => a.indexOf(v) === i && (v !== "Opening hours incl. holidays" || true)).map((m) => `- ${m}`), "");
  out.push("## Next", "", "```bash", `npm run setup < .tablefacts/research/${q.slug}/setup-answers.txt`, "git diff   # review before keeping it", "```", "", "Blank lines in that file keep the template's current value, so anything not found stays a placeholder.", "");
  return out.join("\n");
}

/** One line per prompt of `data/scripts/setup.mjs`, in its order. Blank keeps the current value. */
export function setupAnswers(p) {
  const f = p.fields;
  const ig = f.instagram?.value;
  return [
    val(f.name),
    "", // production URL: the new domain, not the current website
    f.reserveUrl?.value ?? "",
    f.whatsapp?.display ?? "",
    ig ? `@${ig}` : "",
    val(f.street),
    val(f.locality),
    val(f.region),
    val(f.country),
    f.coordinates?.value?.lat ?? "",
    f.coordinates?.value?.lng ?? "",
    val(f.cuisines),
  ].join("\n") + "\n";
}
