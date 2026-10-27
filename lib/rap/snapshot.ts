import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { RAP_PRODUCT, rapPrompt, RapError } from "./config";
export async function rapMusic() {
  return readFile(path.join(process.cwd(), "public", "rap", "booth-original-v1.wav"));
}
export async function createRapSnapshot() {
  return JSON.stringify({ ...RAP_PRODUCT, prompt: rapPrompt, musicSha256: createHash("sha256").update(await rapMusic()).digest("hex") });
}
export async function verifiedRapMusic(snapshot: string) {
  const saved = JSON.parse(snapshot); const audio = await rapMusic();
  if (saved.key !== RAP_PRODUCT.key || saved.templateVersion !== RAP_PRODUCT.templateVersion || saved.prompt !== rapPrompt ||
    saved.musicSha256 !== createHash("sha256").update(audio).digest("hex")) throw new RapError(409, "TEMPLATE_REQUIRES_REVIEW");
  return audio;
}
