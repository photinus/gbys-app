// Accent-color helpers for themed program home pages (pure; client-safe).

export const ACCENT_RE = /^#[0-9a-f]{6}$/;

/** Preset accents offered in the editor (all pass 4.5:1 with white or near-black text). */
export const ACCENT_PRESETS = [
  { name: "Indigo", hex: "#4f46e5" },
  { name: "Royal blue", hex: "#1d4ed8" },
  { name: "Teal", hex: "#0f766e" },
  { name: "Forest", hex: "#15803d" },
  { name: "Crimson", hex: "#b91c1c" },
  { name: "Orange", hex: "#c2410c" },
  { name: "Gold", hex: "#facc15" },
  { name: "Purple", hex: "#7e22ce" },
  { name: "Navy", hex: "#1e3a8a" },
  { name: "Charcoal", hex: "#1f2937" },
] as const;

export function normalizeHex(input: string): string | null {
  const s = input.trim().toLowerCase();
  const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const full = /^#?([0-9a-f]{6})$/.exec(s);
  return full ? `#${full[1]}` : null;
}

function channel(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const ON_DARK = "#ffffff";
export const ON_LIGHT = "#111827";

/** Text color to put on the accent (whichever of white / near-black contrasts more). */
export function readableTextOn(accent: string): string {
  return contrastRatio(accent, ON_DARK) >= contrastRatio(accent, ON_LIGHT) ? ON_DARK : ON_LIGHT;
}

/** WCAG AA for normal text against the better of white / near-black. */
export function accentIsAccessible(accent: string): boolean {
  return Math.max(contrastRatio(accent, ON_DARK), contrastRatio(accent, ON_LIGHT)) >= 4.5;
}
