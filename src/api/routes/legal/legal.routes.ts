import { Hono } from "hono";

import { acceptTosSchema } from "../../../shared/schemas/legal";
import type { AppEnv } from "../../env";
import { requireAuth } from "../../middleware/require-auth";
import { validateBody } from "../../middleware/validate";
import { acceptTos, getTosStatus } from "./legal.handlers";

const app = new Hono<AppEnv>();

app.get("/legal/tos-status", requireAuth, getTosStatus);

app.post(
  "/legal/accept-tos",
  requireAuth,
  validateBody(acceptTosSchema),
  acceptTos,
);

export default app;
