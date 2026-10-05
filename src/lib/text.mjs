// Text helpers shared by the research and menu tools.

/** Lowercase and accent-free, to compare names typed by different people. */
export const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "Café Ñandú & Co." to "cafe-nandu-co" (empty when nothing letter-like is left). */
export const slugify = (s) => fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
