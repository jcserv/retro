const STORAGE_KEY = "retro.clientId";

let cached: string | undefined;

export function readOrCreateClientId(getStorage: () => Storage): string {
  try {
    const storage = getStorage();
    const existing = storage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    storage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

export function getClientId(): string {
  cached ??= readOrCreateClientId(() => globalThis.localStorage);
  return cached;
}
