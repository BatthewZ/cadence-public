/**
 * Unsplash search/curated handlers.
 *
 * These endpoints proxy the Unsplash REST API via `createUnsplashService`.
 * They exist as a proxy (rather than calling Unsplash from the browser) so:
 * - The Unsplash access key is never exposed to the client.
 * - We can apply our own per-user rate limit (the route-level middleware) so a
 *   single browser cannot burn through our shared Unsplash quota.
 * - We normalise the raw Unsplash payload into the `UnsplashCoverPayload`
 *   shape the client and DB both expect, including mandatory UTM parameters.
 *
 * Error surfaces returned to the client are normalised via `errorResponse` so
 * they always carry `requestId` and never leak upstream response bodies —
 * Unsplash error text can contain undocumented internal details we do not
 * want to echo to end users.
 */

import type { Context } from "hono";

import {
  unsplashCuratedQuerySchema,
  unsplashSearchSchema,
} from "../../../shared/schemas/unsplash";
import type { AppEnv } from "../../env";
import { errorResponse } from "../../lib/error-response";
import { createUnsplashService, UnsplashError } from "../../lib/unsplash";
import { validQuery } from "../../lib/validated";

/**
 * Maps an upstream Unsplash status code to the status we return to the
 * client. We return 502 ("bad gateway") for upstream errors because they are
 * not the client's fault; we explicitly surface 429 so clients can implement
 * backoff, and 401/403 surface so ops can see misconfigured keys in logs.
 */
function mapUpstreamStatus(upstream: number): 429 | 502 {
  if (upstream === 429) return 429;
  return 502;
}

function handleUnsplashError(c: Context<AppEnv>, err: unknown, context: string) {
  if (err instanceof UnsplashError) {
    const status = mapUpstreamStatus(err.status);
    console.error(
      `[Unsplash] ${context} upstream error: status=${err.status} → returning ${status}`,
    );
    return errorResponse(c, "Unsplash request failed", status, {
      upstreamStatus: err.status,
    });
  }
  console.error(`[Unsplash] ${context} unexpected error:`, err);
  return errorResponse(c, "Unsplash request failed", 502);
}

/**
 * GET /unsplash/search?query=&page=&perPage=&orientation=
 *
 * Returns a normalised `UnsplashSearchResponse`. Requires auth and is rate
 * limited per user (see routes file).
 */
export async function unsplashSearch(c: Context<AppEnv>) {
  const service = createUnsplashService(c.env);
  if (!service) {
    return errorResponse(c, "Unsplash is not configured", 503);
  }

  const input = validQuery(c, unsplashSearchSchema);
  try {
    const response = await service.searchPhotos(input);
    return c.json(response);
  } catch (err) {
    return handleUnsplashError(c, err, "searchPhotos");
  }
}

/**
 * GET /unsplash/curated?page=&perPage=
 *
 * Returns the latest curated Unsplash photos in the same normalised shape as
 * search. The client uses this as the default picker view before the user
 * types a query.
 */
export async function unsplashCurated(c: Context<AppEnv>) {
  const service = createUnsplashService(c.env);
  if (!service) {
    return errorResponse(c, "Unsplash is not configured", 503);
  }

  const input = validQuery(c, unsplashCuratedQuerySchema);
  try {
    const response = await service.listCurated(input);
    return c.json(response);
  } catch (err) {
    return handleUnsplashError(c, err, "listCurated");
  }
}
