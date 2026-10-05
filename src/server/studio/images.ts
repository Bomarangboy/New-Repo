/**
 * Upload checks for Studio images. The file's own bytes decide what it is (never its name or the browser's
 * claim). Only PNG, JPEG and WebP (plus ICO for the favicon) are accepted; SVG, HTML and anything else are
 * refused because they can carry scripts. Dimensions are read from the image header.
 */
export type ImageKind = "logo_light" | "logo_dark" | "favicon";
export interface ImageInfo { mime: "image/png" | "image/jpeg" | "image/webp" | "image/x-icon"; width: number; height: number }

export const IMAGE_RULES: Record<ImageKind, { maxBytes: number; mimes: ImageInfo["mime"][]; check: (w: number, h: number) => string | null; hint: string }> = {
  logo_light: { maxBytes: 512 * 1024, mimes: ["image/png", "image/jpeg", "image/webp"], hint: "PNG, JPEG or WebP, up to 512 KB, 80–2000 px wide, wider than tall works best.",
    check: (w, h) => (w < 80 || w > 2000 || h < 20 || h > 1000 ? "should be 80–2000 pixels wide and 20–1000 pixels tall" : null) },
  logo_dark: { maxBytes: 512 * 1024, mimes: ["image/png", "image/jpeg", "image/webp"], hint: "PNG or WebP with a transparent background, up to 512 KB.",
    check: (w, h) => (w < 80 || w > 2000 || h < 20 || h > 1000 ? "should be 80–2000 pixels wide and 20–1000 pixels tall" : null) },
  favicon: { maxBytes: 100 * 1024, mimes: ["image/png", "image/x-icon"], hint: "Square PNG (32–512 px) or ICO, up to 100 KB.",
    check: (w, h) => (w !== h || w < 16 || w > 512 ? "must be square, 16–512 pixels" : null) },
};

function png(b: Buffer): ImageInfo | null {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a || b.toString("ascii", 12, 16) !== "IHDR") return null;
  return { mime: "image/png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}
function jpeg(b: Buffer): ImageInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { mime: "image/jpeg", height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}
function webp(b: Buffer): ImageInfo | null {
  if (b.length < 30 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { mime: "image/webp", width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (chunk === "VP8 ") return { mime: "image/webp", width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") { const v = b.readUInt32LE(21); return { mime: "image/webp", width: 1 + (v & 0x3fff), height: 1 + ((v >> 14) & 0x3fff) }; }
  return null;
}
function ico(b: Buffer): ImageInfo | null {
  if (b.length < 22 || b.readUInt16LE(0) !== 0 || b.readUInt16LE(2) !== 1 || b.readUInt16LE(4) < 1) return null;
  const w = b[6] || 256, h = b[7] || 256;
  return { mime: "image/x-icon", width: w, height: h };
}

/** Returns the image's real type and size, or a plain-language reason it was refused. */
export function inspectImage(kind: ImageKind, bytes: Buffer): { ok: true; info: ImageInfo } | { ok: false; error: string } {
  const rule = IMAGE_RULES[kind];
  if (!bytes.length) return { ok: false, error: "The file is empty." };
  if (bytes.length > rule.maxBytes) return { ok: false, error: `The file is too large (${Math.ceil(bytes.length / 1024)} KB). ${rule.hint}` };
  const head = bytes.subarray(0, 512).toString("latin1").toLowerCase();
  if (head.includes("<svg") || head.includes("<?xml") || head.includes("<html") || head.includes("<script")) return { ok: false, error: "SVG and HTML files aren't accepted because they can contain scripts. Export the logo as PNG instead." };
  const info = png(bytes) ?? jpeg(bytes) ?? webp(bytes) ?? ico(bytes);
  if (!info) return { ok: false, error: `That isn't a supported image. ${rule.hint}` };
  if (!rule.mimes.includes(info.mime)) return { ok: false, error: `That image type isn't accepted here. ${rule.hint}` };
  const dim = rule.check(info.width, info.height);
  if (dim) return { ok: false, error: `The image is ${info.width}×${info.height} pixels; it ${dim}.` };
  return { ok: true, info };
}
