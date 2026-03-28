export function generateObjectKey(
  purpose: string,
  userId: string,
  filename: string,
): string {
  const id = crypto.randomUUID();
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
  return `${purpose}/${userId}/${id}${ext}`;
}

export async function putObject(
  storage: R2Bucket,
  key: string,
  body: ReadableStream | ArrayBuffer | string,
  metadata: { mimeType: string; filename: string },
): Promise<void> {
  await storage.put(key, body, {
    httpMetadata: { contentType: metadata.mimeType },
    customMetadata: { filename: metadata.filename },
  });
}

export async function getObject(
  storage: R2Bucket,
  key: string,
): Promise<R2ObjectBody | null> {
  return storage.get(key);
}

export async function deleteObject(
  storage: R2Bucket,
  key: string,
): Promise<void> {
  await storage.delete(key);
}
