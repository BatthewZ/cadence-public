export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * The message to show a user for a failed request: the server's own wording
 * when there is one, otherwise the caller's fallback.
 *
 * Why the server's wording is preferred rather than a per-screen generic: the
 * API's refusals name a rule the user can act on — "Only the workspace owner
 * can remove an admin", "This invitation has expired", "Cannot remove yourself
 * from the workspace" — and replacing those with "Something went wrong" is a
 * strictly worse product for the same amount of code. The fallback is for the
 * one case with no server message at all: a transport failure, where `err` is
 * not an `ApiError`.
 *
 * Lives here rather than in a page module because it is a rule about what every
 * screen tells the user, and the same ternary had already been written twice
 * (CLAUDE.md rule 4).
 */
export function apiErrorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError && err.message ? err.message : fallback;
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

  // 204 No Content has no body — return undefined instead of parsing
  if (res.status === 204) {
    return undefined as T;
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
