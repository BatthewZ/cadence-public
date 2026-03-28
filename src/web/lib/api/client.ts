export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(handler: (() => void) | null) {
  onUnauthorized = handler;
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const isFormData = options?.body instanceof FormData;
  const res = await fetch(path, {
    ...options,
    credentials: "include",
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
    };
    if (res.status === 401 && onUnauthorized) {
      onUnauthorized();
    }
    throw new ApiError(res.status, body.error ?? res.statusText);
  }

  return res.json() as Promise<T>;
}

function serializeBody(body: unknown): BodyInit {
  return body instanceof FormData ? body : JSON.stringify(body);
}

api.get = <T>(path: string, options?: RequestInit) => api<T>(path, options);
api.post = <T>(path: string, body: unknown, options?: RequestInit) =>
  api<T>(path, { method: "POST", body: serializeBody(body), ...options });
api.put = <T>(path: string, body: unknown, options?: RequestInit) =>
  api<T>(path, { method: "PUT", body: serializeBody(body), ...options });
api.patch = <T>(path: string, body: unknown, options?: RequestInit) =>
  api<T>(path, { method: "PATCH", body: serializeBody(body), ...options });
api.delete = <T>(path: string, options?: RequestInit) =>
  api<T>(path, { method: "DELETE", ...options });
