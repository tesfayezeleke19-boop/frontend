/**
 * Theme token codemod — replaces hard-coded hex utilities with the semantic
 * design tokens defined in src/index.css so every screen supports light and
 * dark mode from a single palette.
 *
 * Usage: node scripts/theme-tokens-codemod.mjs [--dry-run]
 *
 * Run once when the palette changes; it is idempotent (no hex utilities left
 * to rewrite after the first pass).
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const DRY = process.argv.includes("--dry-run");

/** hex -> { prefix: token } semantic replacements. */
const TOKENS = {
  // Layout neutrals
  "0a0a0b": { bg: "background", text: "foreground", border: "border", from: "background", to: "background", via: "background", ring: "ring", fill: "background", stroke: "foreground" },
  "09090b": { bg: "background", text: "primary-foreground", border: "border", ring: "ring", fill: "background", stroke: "background" },
  "0d0d0f": { bg: "sidebar", text: "sidebar-foreground", border: "border", from: "sidebar", to: "sidebar", fill: "sidebar", stroke: "sidebar-foreground" },
  "111113": { bg: "card", text: "card-foreground", border: "border", from: "card", to: "card", fill: "card", stroke: "foreground" },
  "141416": { bg: "popover", text: "popover-foreground", border: "input", from: "popover", to: "popover", fill: "popover", stroke: "foreground" },
  "16161a": { bg: "muted", text: "muted-foreground", border: "border", fill: "muted" },
  "18181b": { bg: "secondary", text: "secondary-foreground", border: "border", fill: "secondary" },
  "1a1a1e": { bg: "accent", text: "accent-foreground", border: "border", fill: "accent" },
  "1a1a1f": { bg: "muted", text: "muted-foreground", border: "border", fill: "muted" },
  "1f1f24": { bg: "sidebar", text: "sidebar-foreground", border: "border", fill: "sidebar" },
  "232329": { bg: "muted", text: "muted-foreground", border: "border", fill: "muted" },
  "2e2e35": { bg: "popover", text: "muted-foreground", border: "input", fill: "popover" },
  "292929": { bg: "muted", text: "muted-foreground", border: "border", fill: "muted" },
  "777780": { bg: "muted", text: "muted-foreground", border: "border", fill: "muted" },
  "71717a": { bg: "muted", text: "muted-foreground", border: "border", fill: "muted" },
  a1a1aa: { bg: "muted", text: "muted-foreground", border: "border", fill: "muted" },
  d4d4d8: { bg: "secondary", text: "foreground", border: "border", fill: "secondary" },
  e4e4e7: { bg: "secondary", text: "foreground", border: "border", fill: "secondary" },
  f4f4f5: { bg: "primary", text: "foreground", border: "border", fill: "primary" },
  "8a8a93": { bg: "muted", text: "muted-foreground", border: "border", fill: "muted" },
  "5c5c66": { bg: "muted", text: "muted-foreground/70", border: "border", fill: "muted" },

  // Brand accents
  "34d399": { bg: "success", text: "success", border: "success", ring: "ring", from: "success", to: "success", via: "success", fill: "success", stroke: "success", shadow: "success" },
  "4ade80": { bg: "success", text: "success", border: "success", ring: "success", from: "success", to: "success", via: "success", fill: "success", stroke: "success" },
  f87171: { bg: "destructive", text: "destructive", border: "destructive", ring: "destructive", from: "destructive", to: "destructive", via: "destructive", fill: "destructive", stroke: "destructive" },
  fca5a5: { bg: "destructive", text: "destructive", border: "destructive", fill: "destructive" },
  "60a5fa": { bg: "info", text: "info", border: "info", ring: "info", from: "info", to: "info", via: "info", fill: "info", stroke: "info" },
  fbbf24: { bg: "warning", text: "warning", border: "warning", ring: "warning", from: "warning", to: "warning", via: "warning", fill: "warning", stroke: "warning" },
  f59e0b: { bg: "warning", text: "warning", border: "warning", fill: "warning", stroke: "warning" },
  eab308: { bg: "warning", text: "warning", border: "warning", fill: "warning", stroke: "warning" },
  a78bfa: { bg: "violet", text: "violet", border: "violet", from: "violet", to: "violet", fill: "violet", stroke: "violet" },

  // Soft status fills and borders
  "0d2a1c": { bg: "success-soft", border: "success-border", text: "success", fill: "success-soft" },
  "1e4d34": { bg: "success-soft", border: "success-border", text: "success" },
  "2b2110": { bg: "warning-soft", border: "warning-border", text: "warning", fill: "warning-soft" },
  "4a3a18": { bg: "warning-soft", border: "warning-border", text: "warning" },
  "2a230d": { bg: "warning-soft", border: "warning-border", text: "warning" },
  "3d3523": { bg: "warning-soft", border: "warning-border", text: "warning" },
  "321415": { bg: "destructive-soft", border: "destructive-border", text: "destructive", fill: "destructive-soft" },
  "5b2323": { bg: "destructive-soft", border: "destructive-border", text: "destructive" },
  "2a0d0d": { bg: "destructive-soft", border: "destructive-border", text: "destructive" },
  "3d2323": { bg: "destructive-soft", border: "destructive-border", text: "destructive" },
  "10263f": { bg: "info-soft", border: "info-border", text: "info", fill: "info-soft" },
  "204466": { bg: "info-soft", border: "info-border", text: "info" },
  "0d1a2a": { bg: "info-soft", border: "info-border", text: "info" },
  "1a0d2a": { bg: "violet-soft", border: "violet-border", text: "violet", fill: "violet-soft" },
  "2d2345": { bg: "violet-soft", border: "violet-border", text: "violet" },

  // One-off shades used by a handful of screens
  "3b3324": { bg: "warning-soft", border: "warning-border" },
  "5a4820": { bg: "warning-soft", border: "warning-border" },
  a17b27: { bg: "warning-soft", border: "warning-border", text: "warning" },
  "512727": { bg: "destructive-soft", border: "destructive-border" },
  "493030": { bg: "destructive-soft", border: "destructive-border" },
  "42272a": { bg: "destructive-soft", border: "destructive-border" },
  "33333b": { bg: "accent", border: "foreground/20" },
  "27272a": { bg: "accent", border: "border" },
  "3f3f47": { bg: "accent", border: "border" },
  "3a3a42": { bg: "accent", border: "border" },
  "2e352c": { bg: "success-soft", border: "success-border" },
  "6ee7b7": { bg: "success/80", text: "success", border: "success/80" },
  "3f1a1b": { bg: "destructive-soft", border: "destructive-border" },
  "252529": { bg: "accent" },
  "1c1c21": { bg: "accent" },
  "242429": { bg: "accent" },
  "202025": { bg: "accent" },
  "1a1a1d": { bg: "accent" },
  "151515": { bg: "muted" },
  "15130f": { bg: "warning-soft" },
  "29251b": { bg: "warning-soft" },
  "3b3010": { bg: "warning-soft" },
  "242016": { bg: "warning-soft" },
  "211d15": { bg: "warning-soft" },
  "1c1a13": { bg: "warning-soft" },
  "3b1414": { bg: "destructive-soft" },
  "241717": { bg: "destructive-soft" },
  "171313": { bg: "destructive-soft" },
  "171113": { bg: "destructive-soft" },
  "123b27": { bg: "success/20" },
  "101a13": { bg: "success-soft" },
  "3f3f46": { text: "muted-foreground" },
  "07140e": { text: "primary-foreground" },
  "052e1b": { text: "primary-foreground" },
  d1fae5: { text: "success" },
  a7b5a8: { text: "muted-foreground" },
  "3a3a43": { text: "muted-foreground/50" },
};

const PREFIXES = [
  "bg", "text", "border", "border-t", "border-b", "border-l", "border-r",
  "border-x", "border-y", "from", "to", "via", "ring", "ring-offset", "fill",
  "stroke", "divide", "outline", "shadow", "decoration", "caret", "accent",
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "_generated") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if ([".ts", ".tsx"].includes(extname(full))) out.push(full);
  }
  return out;
}

const counts = { hex: 0, white: 0, files: new Set() };

for (const file of walk(SRC)) {
  let source = readFileSync(file, "utf8");
  const before = source;

  // Theme-independent "white overlay" hovers become foreground tints.
  source = source
    .replace(/\bbg-white\/\[0\.0(\d+)\]/g, "bg-foreground/[0.0$1]")
    .replace(/\bbg-white\/\[0?\.(\d+)\]/g, "bg-foreground/[0.$1]")
    .replace(/\bbg-white\/(\d+)/g, "bg-foreground/$1")
    .replace(/\bhover:bg-white\b(?!\/)/g, "hover:bg-primary/90")
    .replace(/\bhover:text-white\b/g, "hover:text-foreground");

  const pattern = new RegExp(
    `\\b(${PREFIXES.join("|")})-\\[#([0-9a-fA-F]{6})\\](\\/[0-9]+)?`,
    "g",
  );

  source = source.replace(pattern, (match, prefix, hex, opacity = "") => {
    const map = TOKENS[hex.toLowerCase()];
    const token = map?.[prefix] ?? map?.bg ?? map?.text;
    if (!token) return match;
    counts.hex += 1;
    if (token.includes("/")) return `${prefix}-${token}${opacity}`;
    return `${prefix}-${token}${opacity}`;
  });

  if (source !== before) {
    counts.files.add(file.replace(ROOT, ""));
    if (!DRY) writeFileSync(file, source);
  }
}

console.log(
  `${DRY ? "[dry-run] " : ""}rewrote ${counts.hex} hex utilities across ${counts.files.size} files`,
);
