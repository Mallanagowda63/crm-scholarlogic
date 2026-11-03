import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const uploadRoot = () => path.resolve(process.env.UPLOAD_DIR ?? "uploads");

const FILE_TYPES = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
} as const;

type Extension = keyof typeof FILE_TYPES;

/** Judges a file by its first bytes, because a file's name and stated type can be anything. */
export function detectFileType(bytes: Buffer): Extension | null {
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "jpg";
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") {
    return "webp";
  }
  return null;
}

/** Saves under a random name, so nothing a person chooses ever reaches the file system. */
export async function saveUpload(bytes: Buffer, extension: Extension) {
  const key = `${randomUUID()}.${extension}`;
  await mkdir(uploadRoot(), { recursive: true });
  await writeFile(path.join(uploadRoot(), key), bytes);
  return key;
}

export async function readUpload(key: string) {
  const match = key.match(/^[0-9a-f-]{36}\.(pdf|png|jpg|webp)$/);
  if (!match) throw new Error("Invalid storage key");
  return {
    bytes: await readFile(path.join(uploadRoot(), key)),
    contentType: FILE_TYPES[match[1] as Extension],
  };
}
