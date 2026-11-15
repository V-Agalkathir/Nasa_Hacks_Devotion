// Colour tokens and labels (spec 06 section 5). Tiers rise in darkness so they read without hue;
// "can't measure" and "not enough data" are always hatched, never flat.
export const C = {
  page: "#F7F2DC", card: "#FFFCF0", inset: "#ECE4B7", text: "#311E10", muted: "#5E4733",
  cta: "#DD6031", ctaHover: "#C4532A", water: "#A3BAC3",
};
export const TIER = {
  lower: { label: "Lower-risk ground", short: "Lower", fill: "#DCEDD2", text: C.text, bars: 1 },
  moderate: { label: "Moderate risk", short: "Moderate", fill: "#E9B949", text: C.text, bars: 2 },
  higher: { label: "Higher risk", short: "Higher", fill: "#7A3214", text: "#FFFCF0", bars: 3 },
  not_enough_data: { label: "Not enough data", short: "Not enough data", fill: "#D9D3BD", text: C.text, bars: 0, hatch: true },
};
export const HEIGHT_BINS = [
  { max: 2.5, color: "#2F3A5E", label: "Under 2.5 m: storm-surge reach" },
  { max: 4, color: "#5D6680", label: "2.5–4 m" },
  { max: 8, color: "#9A967E", label: "4–8 m" },
  { max: 15, color: "#CDBF7E", label: "8–15 m" },
  { max: Infinity, color: "#F2E6A6", label: "15 m or more" },
];
export const COAST_BANDS = [
  { max: 100, color: "#2F3A5E", label: "Within 100 m of shore" },
  { max: 300, color: "#93A0BC", label: "100–300 m" },
  { max: Infinity, color: "#F2EBD3", label: "More than 300 m: not a factor" },
];
export const TRANSECT = [
  { label: "Change within ±15 m", color: "#5E4733" },
  { label: "15–40 m landward", color: "#E08214" },
  { label: "More than 40 m landward", color: "#7A3214" },
  { label: "Moved seaward", color: "#542788" },
];
export const CLASS = {
  stable: { label: "Stable", color: "#2E7D8C" },
  seasonal_only: { label: "Seasonal only", color: "#E9B949" },
  degrading: { label: "Degrading", color: "#B8521A" },
  cant_measure: { label: "Can't measure", color: "#D9D3BD", hatch: true },
};
export const MOTION = [
  { label: "Sank 2 cm or more", color: "#B35806" },
  { label: "Sank 1–2 cm", color: "#FDB863" },
  { label: "Within ±1 cm: noise", color: "#F4EEDC" },
  { label: "Rose 1–2 cm", color: "#B2ABD2" },
  { label: "Rose 2 cm or more", color: "#542788" },
];
export const CORE = { promising: "#1F6F7D", conflicting: "#311E10", other: "#E7E0C4" };
export const STATUS = {
  pass: { label: "Passed", glyph: "✓", cls: "chip-pass" },
  partial: { label: "Partly passed", glyph: "◐", cls: "chip-partial" },
  fail: { label: "Failed", glyph: "✕", cls: "chip-fail" },
  not_run: { label: "Not run", glyph: "–", cls: "chip-notrun" },
  not_available: { label: "Not available", glyph: "–", cls: "chip-na" },
  pending: { label: "Pending", glyph: "…", cls: "chip-na" },
};
export const LIMITS_FALLBACK = [
  "Block scale: 240 m squares, 80 m radar", "Thaw season only (June to September)",
  "Motion is relative to the airport gravel pad", "A screen, not an engineering sign-off", "“Lower-risk” doesn’t mean “safe”",
];
