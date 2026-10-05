// Opening hours in one shape, whatever the source: week[0..6] (Monday first),
// each day a list of ["HH:MM", "HH:MM"] slots; a closed day is []. The template
// shows them as `visit.hoursRows`, consecutive identical days merged.

const pad = (n) => String(n).padStart(2, "0");
const hm = (h, m = 0) => `${pad(h)}:${pad(m)}`;
const emptyWeek = () => Array.from({ length: 7 }, () => []);
const allDay = () => Array.from({ length: 7 }, () => [["00:00", "24:00"]]);

/** Google `regularOpeningHours.periods` (day 0 = Sunday). */
export function fromGoogle(periods = []) {
  if (!periods.length) return null;
  if (periods.length === 1 && !periods[0].close) return { week: allDay() };
  const week = emptyWeek();
  for (const p of periods) {
    if (!p.open || !p.close) continue;
    week[(p.open.day + 6) % 7].push([hm(p.open.hour, p.open.minute ?? 0), hm(p.close.hour, p.close.minute ?? 0)]);
  }
  week.forEach((d) => d.sort());
  return { week };
}

const DAY_INDEX = { mo: 0, tu: 1, we: 2, th: 3, fr: 4, sa: 5, su: 6 };

function expandDays(text) {
  const out = [];
  for (const part of text.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [a, b] = part.split("-").map((s) => DAY_INDEX[s.trim().toLowerCase().slice(0, 2)]);
    if (a === undefined || (part.includes("-") && b === undefined)) return null;
    if (b === undefined) out.push(a);
    else for (let d = a; ; d = (d + 1) % 7) { out.push(d); if (d === b) break; }
  }
  return out.length ? out : null;
}

/** OpenStreetMap / schema.org `openingHours` syntax: "Mo-Th 12:00-22:00; Fr,Sa 12:00-00:00; Su off". */
export function fromOsm(text) {
  if (!text) return null;
  if (/^\s*24\/7\s*$/.test(text)) return { week: allDay() };
  const week = emptyWeek();
  let any = false;
  let partial = false;
  for (const rule of text.split(";").map((s) => s.trim()).filter(Boolean)) {
    const m = !/\b(PH|SH|week|sunrise|sunset|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b|[\[\]()"]/i.test(rule) &&
      rule.match(/^([A-Za-z,\- ]+?)?\s*((?:\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*,?\s*)+|off|closed)$/i);
    const days = m ? (m[1] ? expandDays(m[1]) : [0, 1, 2, 3, 4, 5, 6]) : null;
    if (!m || !days) { partial = true; continue; }
    const slots = /^(off|closed)$/i.test(m[2])
      ? []
      : [...m[2].matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)].map((x) => [hm(+x[1], +x[2]), hm(+x[3], +x[4])]);
    for (const d of days) week[d] = slots;
    any = true;
  }
  return any ? { week, partial } : null;
}

const EN_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/** schema.org `openingHoursSpecification` entries. */
export function fromSpec(specs = []) {
  const week = emptyWeek();
  let any = false;
  for (const s of [specs].flat()) {
    if (!s || !s.opens || !s.closes) continue;
    for (const d of [s.dayOfWeek].flat()) {
      const i = EN_DAYS.indexOf(String(d ?? "").split("/").pop().toLowerCase());
      if (i < 0) continue;
      week[i].push([String(s.opens).slice(0, 5), String(s.closes).slice(0, 5)]);
      any = true;
    }
  }
  week.forEach((d) => d.sort());
  return any ? { week } : null;
}

const signature = (slots) => slots.map((s) => s.join("-")).join(",");
export const weekSignature = (week) => week.map(signature).join("|");

const NAMES = {
  es: { days: ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"], and: "y", to: "a", closed: "Cerrado", allDay: "24 horas", every: "Todos los días" },
  en: { days: EN_DAYS, and: "and", to: "to", closed: "Closed", allDay: "24 hours", every: "Every day" },
};
const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** Rows for `visit.hoursRows`: { label, value }, matching the template's wording. */
export function formatRows(week, lang) {
  const t = NAMES[lang];
  const runs = [];
  week.forEach((slots, d) => {
    const last = runs.at(-1);
    if (last && signature(last.slots) === signature(slots)) last.days.push(d);
    else runs.push({ days: [d], slots });
  });
  if (runs.every((r) => !r.slots.length)) return [];
  return runs.map(({ days, slots }) => {
    const a = t.days[days[0]];
    const label =
      days.length === 7 ? t.every
      : days.length === 1 ? cap(a)
      : days.length === 2 ? `${cap(a)} ${t.and} ${t.days[days[1]]}`
      : `${cap(a)} ${t.to} ${t.days[days.at(-1)]}`;
    const value = !slots.length
      ? t.closed
      : signature(slots) === "00:00-24:00"
        ? t.allDay
        : slots.map(([o, c]) => `${o} ${t.to} ${c}`).join(", ");
    return { label, value };
  });
}
