import "server-only";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { mkdir, readFile, writeFile, unlink, stat, mkdtemp, open, rm, copyFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { RapError } from "./config";
import { rapStorageConfig } from "./r2-config";
export { rapStorageReady } from "./r2-config";

const root = path.resolve(process.cwd(), ".data", "rap-private");
function objectPath(key: string) {
  if (!/^(?:rap|temp)\/[a-f0-9-]+\/[a-f0-9-]+\.(?:jpg|png|webp|mp4)$/.test(key)) throw new RapError(400, "INVALID_STORAGE_KEY");
  return path.join(root, key);
}
let cached: { identity: string; client: S3Client } | undefined;
function remote(required = false) {
  const config = rapStorageConfig();
  if (!config) {
    const configured = process.env.RAP_STORAGE_BUCKET || process.env.R2_BUCKET_NAME;
    if (required || configured || process.env.NODE_ENV === "production") throw new RapError(503, "PRIVATE_STORAGE_REQUIRED");
    return null;
  }
  const identity = JSON.stringify(config);
  if (cached?.identity !== identity) {
    cached?.client.destroy();
    cached = { identity, client: new S3Client({ region: config.region, endpoint: config.endpoint,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 60_000 }, maxAttempts: 3 }) };
  }
  return { client: cached.client, bucket: config.bucket };
}
export async function putRapObject(key: string, bytes: Buffer, contentType: string) {
  const filename = objectPath(key); const target = remote();
  if (target) {
    await target.client.send(new PutObjectCommand({ Bucket: target.bucket, Key: key, Body: bytes, ContentType: contentType }));
    const head = await target.client.send(new HeadObjectCommand({ Bucket: target.bucket, Key: key }));
    if (head.ContentLength !== bytes.length) throw new RapError(502, "STORAGE_UPLOAD_INCOMPLETE");
  } else { await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, bytes); }
}
export async function getRapObject(key: string, maxBytes = 100 * 1024 * 1024) {
  const filename = objectPath(key); const target = remote();
  if (!target) {
    if ((await stat(filename)).size > maxBytes) throw new RapError(413, "MEDIA_TOO_LARGE");
    return readFile(filename);
  }
  const result = await target.client.send(new GetObjectCommand({ Bucket: target.bucket, Key: key }));
  if (!result.Body) throw new RapError(404, "MEDIA_NOT_FOUND");
  if ((result.ContentLength ?? 0) > maxBytes) { await result.Body.transformToWebStream().cancel(); throw new RapError(413, "MEDIA_TOO_LARGE"); }
  const reader = result.Body.transformToWebStream().getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > maxBytes) throw new RapError(413, "MEDIA_TOO_LARGE");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}
export async function deleteRapObject(key: string) {
  const filename = objectPath(key); const target = remote();
  if (target) await target.client.send(new DeleteObjectCommand({ Bucket: target.bucket, Key: key }));
  else { try { await unlink(filename); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
}
export async function headRapObject(key: string) {
  objectPath(key); const target = remote(true)!;
  const object = await target.client.send(new HeadObjectCommand({ Bucket: target.bucket, Key: key }));
  return { size: object.ContentLength, contentType: object.ContentType };
}
export async function getRapUploadUrl(key: string, contentType: string) {
  objectPath(key); const target = remote(true)!;
  return getSignedUrl(target.client, new PutObjectCommand({ Bucket: target.bucket, Key: key, ContentType: contentType }), { expiresIn: 300 });
}
export async function getRapSignedUrl(key: string, expiresIn = 3600) {
  objectPath(key); const target = remote(true)!;
  if (!Number.isInteger(expiresIn) || expiresIn < 60 || expiresIn > 86400) throw new RapError(400, "INVALID_SIGNATURE_TTL");
  return getSignedUrl(target.client, new GetObjectCommand({ Bucket: target.bucket, Key: key }), { expiresIn });
}
export async function objectExists(key: string) {
  const filename = objectPath(key); const target = remote();
  try {
    if (target) await target.client.send(new HeadObjectCommand({ Bucket: target.bucket, Key: key }));
    else await stat(filename);
    return true;
  } catch (error) {
    const e = error as { code?: string; name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.code === "ENOENT" || e.name === "NotFound" || e.$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
}

// Bound memory independently of video size. Vercel /tmp is only a transfer spool;
// R2 remains the durable copy and the temporary directory is always removed.
export async function persistRapVideo(response: Response, key: string) {
  const destination = objectPath(key);
  const maxBytes = 100 * 1024 * 1024;
  if (!response.ok || !response.body || Number(response.headers.get("content-length") || 0) > maxBytes) {
    throw new RapError(502, "MEDIA_DOWNLOAD_FAILED");
  }
  const directory = await mkdtemp(path.join(tmpdir(), "rap-transfer-"));
  const filename = path.join(directory, "video.mp4");
  const hash = createHash("sha256"); let size = 0; let prefix = Buffer.alloc(0);
  try {
    const file = await open(filename, "w"); const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > maxBytes) throw new RapError(413, "MEDIA_TOO_LARGE");
        hash.update(value);
        if (prefix.length < 100) prefix = Buffer.concat([prefix, Buffer.from(value.subarray(0, 100 - prefix.length))]);
        // FileHandle.write can legally make partial progress.
        let offset = 0;
        while (offset < value.length) {
          const { bytesWritten } = await file.write(value, offset, value.length - offset);
          if (!bytesWritten) throw new RapError(502, "STORAGE_UPLOAD_INCOMPLETE");
          offset += bytesWritten;
        }
      }
    } finally { await reader.cancel(); await file.close(); }
    if (size < 16 || !prefix.includes(Buffer.from("ftyp"))) throw new RapError(502, "VIDEO_INVALID");
    await validateVideoDuration(filename, size);
    const target = remote();
    if (target) {
      const stream = createReadStream(filename);
      try {
        await target.client.send(new PutObjectCommand({ Bucket: target.bucket, Key: key, Body: stream,
          ContentType: "video/mp4", ContentLength: size }));
      } finally { stream.destroy(); }
      const stored = await target.client.send(new HeadObjectCommand({ Bucket: target.bucket, Key: key }));
      if (stored.ContentLength !== size) throw new RapError(502, "STORAGE_UPLOAD_INCOMPLETE");
    } else { await mkdir(path.dirname(destination), { recursive: true }); await copyFile(filename, destination); }
    return { mediaHash: hash.digest("hex") };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function validateVideoDuration(filename: string, totalSize: number) {
  const file = await open(filename, "r");
  try {
    // Read atom headers only, including 64-bit lengths. No unbounded moov buffer.
    async function atoms(start: number, end: number, findMovieHeader: boolean): Promise<number | null> {
      let position = start; let count = 0;
      while (position + 8 <= end && count++ < 10000) {
        const header = Buffer.alloc(48);
        const { bytesRead } = await file.read(header, 0, Math.min(48, end - position), position);
        if (bytesRead < 8) break;
        let size = header.readUInt32BE(0); let headerSize = 8;
        if (size === 1) {
          if (bytesRead < 16) break;
          const big = header.readBigUInt64BE(8);
          if (big > BigInt(Number.MAX_SAFE_INTEGER)) break;
          size = Number(big); headerSize = 16;
        } else if (size === 0) size = end - position;
        if (size < headerSize || position + size > end) break;
        const type = header.toString("ascii", 4, 8);
        if (type === "moov" && !findMovieHeader) return atoms(position + headerSize, position + size, true);
        if (type === "mvhd" && findMovieHeader) {
          const version = header[headerSize];
          const offset = headerSize + (version === 0 ? 12 : 20);
          if (![0, 1].includes(version) || bytesRead < offset + (version === 0 ? 8 : 12) || size < offset + (version === 0 ? 8 : 12)) break;
          const scale = header.readUInt32BE(offset);
          const duration = version === 0 ? header.readUInt32BE(offset + 4) : Number(header.readBigUInt64BE(offset + 4));
          return scale ? duration / scale : null;
        }
        position += size;
      }
      return null;
    }
    const duration = await atoms(0, totalSize, false);
    if (duration === null || !Number.isFinite(duration) || duration <= 0 || duration > 30) throw new RapError(502, "VIDEO_DURATION_INVALID");
  } finally { await file.close(); }
}
