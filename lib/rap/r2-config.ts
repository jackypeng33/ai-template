
// Rap media is always private. Never fall back to the starter's public bucket.
export function rapStorageConfig() {
  const bucket = process.env.RAP_STORAGE_BUCKET || process.env.R2_BUCKET_NAME;
  const endpoint = process.env.STORAGE_ENDPOINT || (process.env.R2_ACCOUNT_ID
    ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY;
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return null;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) return null;
  } catch { return null; }
  return { bucket, endpoint, accessKeyId, secretAccessKey, region: process.env.STORAGE_REGION || "auto" };
}
export function rapStorageReady() { return Boolean(rapStorageConfig()); }
