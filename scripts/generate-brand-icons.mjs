/**
 * Brand asset generator — derives the in-app logo, favicons, and PWA icons
 * from the single supplied HATI PLC source image (public/logo.jpg).
 *
 * Usage: node scripts/generate-brand-icons.mjs
 *
 * Re-run this after replacing public/logo.jpg to regenerate every derived
 * asset. The emblem is trimmed of its white margin so it fills a circular
 * badge at any size (sidebar, sign-in, favicon, home-screen icon).
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(root, "public", "logo.jpg");
const BRAND_DIR = join(root, "public", "brand");
const PUBLIC = join(root, "public");
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

mkdirSync(BRAND_DIR, { recursive: true });

/** Trimmed emblem, opaque white background, transparent outside the circle. */
async function emblem(size) {
  const trimmed = await sharp(SOURCE)
    .flatten({ background: WHITE })
    .trim({ background: WHITE, threshold: 16 })
    .png()
    .toBuffer();

  return sharp(trimmed)
    .resize(size, size, { fit: "contain", background: WHITE })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Square icon with the emblem padded inside a solid white tile. */
async function paddedIcon(size, paddingRatio) {
  const inner = Math.round(size * (1 - paddingRatio * 2));
  const emblemBuffer = await emblem(inner);
  const offset = Math.round((size - inner) / 2);

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: WHITE,
    },
  })
    .composite([{ input: emblemBuffer, top: offset, left: offset }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const outputs = [
  ["public/brand/hati-logo.png", await emblem(512)],
  ["public/favicon-32.png", await emblem(32)],
  ["public/favicon-192.png", await paddedIcon(192, 0.06)],
  ["public/favicon-512.png", await paddedIcon(512, 0.08)],
  ["public/apple-touch-icon.png", await paddedIcon(180, 0.12)],
];

for (const [path, buffer] of outputs) {
  await sharp(buffer).toFile(join(root, path));
  console.log(`wrote ${path} (${Math.round(buffer.length / 1024)} KB)`);
}

// Fail loudly if the source image is unreadable rather than shipping a blank icon.
const meta = await sharp(join(root, "public/brand/hati-logo.png")).metadata();
if (!meta.width || meta.width < 32) {
  throw new Error("Generated logo is too small — check public/logo.jpg");
}
console.log(`brand assets ready (emblem ${meta.width}x${meta.height})`);
