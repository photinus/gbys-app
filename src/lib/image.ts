import "server-only";
import sharp from "sharp";

/**
 * Validates an uploaded photo by magic bytes (PNG, JPEG, WEBP, HEIC/HEIF) and
 * normalises it: auto-rotate from EXIF, strip ALL metadata (incl. GPS), square
 * center-crop, resize, encode WEBP. Never trust the declared content type.
 */
export const MAX_PHOTO_UPLOAD_BYTES = 8 * 1024 * 1024; // phone photos

export type SniffedImage = "image/png" | "image/jpeg" | "image/webp" | "image/heic";

export function sniffPhotoType(buf: Buffer): SniffedImage | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    if (["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  return null;
}

export class PhotoError extends Error {}

export async function processPhoto(input: Buffer, size: 256 | 512 | 800): Promise<Buffer> {
  if (input.length === 0) throw new PhotoError("Choose a photo to upload.");
  if (input.length > MAX_PHOTO_UPLOAD_BYTES) throw new PhotoError("Photos must be 8 MB or smaller.");
  if (!sniffPhotoType(input)) throw new PhotoError("Use a JPEG, PNG, WEBP or HEIC photo.");
  try {
    return await sharp(input, { failOn: "error", limitInputPixels: 50_000_000 })
      .rotate()
      .resize(size, size, { fit: "cover", position: "attention" })
      .webp({ quality: 82 })
      .toBuffer(); // sharp drops EXIF/ICC/XMP unless withMetadata() is called
  } catch {
    throw new PhotoError("That photo couldn't be read. Try a different file.");
  }
}
