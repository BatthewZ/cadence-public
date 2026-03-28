import { Hono } from "hono";

import type { AppEnv } from "../../env";
import { requireAuth } from "../../middleware/require-auth";
import { getMe } from "./users.handlers";

const app = new Hono<AppEnv>();

app.get("/me", requireAuth, getMe);

export default app;
