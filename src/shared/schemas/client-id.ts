import { z } from "zod";

/**
 * Optional client-generated id on a create body, so an offline client can
 * reference the row (move it, comment on it) before the server has seen it.
 * A taken id answers 409 `id_conflict`.
 */
export const clientIdSchema = z.uuid().optional();
