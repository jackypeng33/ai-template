export type RapDraft = {
  left?: File; right?: File; requestId: string; leftAssetId?: string; rightAssetId?: string; savedAt: number;
};
const DATABASE = "booth-draft-v1";
async function store() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export async function readRapDraft(): Promise<RapDraft | undefined> {
  const database = await store();
  try {
    const value = await new Promise<RapDraft | undefined>((resolve, reject) => {
      const request = database.transaction("drafts").objectStore("drafts").get("current");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    if (value && Date.now() - value.savedAt > 24 * 3600_000) { await clearRapDraft(); return undefined; }
    return value;
  } finally { database.close(); }
}
export async function writeRapDraft(value: RapDraft) {
  const database = await store();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("drafts", "readwrite");
      transaction.objectStore("drafts").put(value, "current");
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
    });
  } finally { database.close(); }
}
export async function clearRapDraft() {
  const database = await store();
  try { await new Promise<void>((resolve, reject) => {
    const tx = database.transaction("drafts", "readwrite"); tx.objectStore("drafts").delete("current");
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  }); } finally { database.close(); }
}
