import { createMiddleware } from "hono/factory";

import type { AppBindings, AuthVariables } from "../env";
import { createAuth } from "../lib/auth";

export const authSessionMiddleware = createMiddleware<{
  Bindings: AppBindings;
  Variables: AuthVariables;
}>(async (c, next) => {
  // Skip session resolution when no auth credentials are present.
  // Better Auth resolves sessions from cookies (default: "better-auth.session_token").
  // If neither a cookie header nor an authorization header is sent, there is
  // no possible session to look up — avoid the DB round-trip entirely.
  const cookieHeader = c.req.header("cookie");
  const authHeader = c.req.header("authorization");

  if (!cookieHeader && !authHeader) {
    c.set("user", null);
    c.set("session", null);
    await next();
    return;
  }

  const auth = createAuth(c.env);

  let session: Awaited<ReturnType<typeof auth.api.getSession>> = null;
  try {
    session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        middleware: "authSession",
        method: c.req.method,
        path: c.req.path,
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }

  if (session) {
    c.set("user", session.user);
    c.set("session", session.session);
  } else {
    c.set("user", null);
    c.set("session", null);
  }

  await next();
});
