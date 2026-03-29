import type { Context } from "hono";

import type { AppEnv } from "../env";

export function requireParam(c: Context<AppEnv>, name: string): string {
  const value = c.req.param(name);
  if (!value) {
    throw new Error(`Missing required path parameter: ${name}`);
  }
  return value;
}

export function requireParams<K extends string>(c: Context<AppEnv>, ...names: K[]): Record<K, string> {
  const result = {} as Record<K, string>;
  for (const name of names) {
    result[name] = requireParam(c, name);
  }
  return result;
}
