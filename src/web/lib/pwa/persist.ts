let asked = false;

/**
 * Asks the browser not to evict our IndexedDB under storage pressure, once per page load. Call
 * it after a signed-in boot: Firefox shows a permission prompt, so never on a signed-out page.
 * No localStorage flag: browsers remember the answer (`persisted()` short-circuits).
 * Resolves the answer, or null when not asked this time (already asked, unsupported, or threw).
 */
export async function requestPersistentStorage(): Promise<boolean | null> {
  if (asked) return null;
  asked = true;
  const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
  if (!storage?.persist) return null;
  try {
    if (await storage.persisted?.()) return true;
    return await storage.persist();
  } catch {
    return null;
  }
}
