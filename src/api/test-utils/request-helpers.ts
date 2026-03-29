// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

/** Shorthand to build a JSON request. */
export function jsonRequest(
  method: string,
  path: string,
  body?: unknown,
): Request {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost${path}`, init);
}
