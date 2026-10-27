import "server-only";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { RapError } from "./config";

const root = path.resolve(process.cwd(), ".data", "rap-private");
function objectPath(key: string) {
  if (!/^rap\/[a-f0-9-]+\/(?:[a-f0-9-]+\.(?:jpg|mp4))$/.test(key)) throw new RapError(400, "INVALID_STORAGE_KEY");
  return path.join(root, key);
}
function remote() {
  if (!process.env.RAP_STORAGE_BUCKET) {
    if (process.env.NODE_ENV === "production") throw new RapError(503, "PRIVATE_STORAGE_REQUIRED");
    return null;
  }
  if (!process.env.STORAGE_ACCESS_KEY_ID || !process.env.STORAGE_SECRET_ACCESS_KEY || !process.env.STORAGE_ENDPOINT) {
    throw new RapError(503, "PRIVATE_STORAGE_REQUIRED");
  }
  return new S3Client({ region: process.env.STORAGE_REGION || "auto", endpoint: process.env.STORAGE_ENDPOINT,
    credentials: { accessKeyId: process.env.STORAGE_ACCESS_KEY_ID, secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY } });
}
export async function putRapObject(key: string, bytes: Buffer, contentType: string) {
  const filename = objectPath(key); const client = remote();
  if (client) await client.send(new PutObjectCommand({ Bucket: process.env.RAP_STORAGE_BUCKET, Key: key, Body: bytes, ContentType: contentType }));
  else { await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, bytes); }
}
export async function getRapObject(key: string) {
  const filename = objectPath(key); const client = remote();
  if (!client) return readFile(filename);
  const result = await client.send(new GetObjectCommand({ Bucket: process.env.RAP_STORAGE_BUCKET, Key: key }));
  if (!result.Body) throw new RapError(404, "MEDIA_NOT_FOUND");
  return Buffer.from(await result.Body.transformToByteArray());
}
export async function deleteRapObject(key: string) {
  const filename = objectPath(key); const client = remote();
  if (client) await client.send(new DeleteObjectCommand({ Bucket: process.env.RAP_STORAGE_BUCKET, Key: key }));
  else { try { await unlink(filename); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
}
