import fs from "node:fs";
import path from "node:path";

import { Miniflare } from "miniflare";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../migrations");

/**
 * Split a migration SQL string into individual statements.
 * Drizzle migrations use `--> statement-breakpoint` as separators.
 */
function splitStatements(sql: string): string[] {
  return sql
    .split(/-->\s*statement-breakpoint/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length > 0 &&
        !s.split("\n").every((line) => line.trim().startsWith("--") || line.trim() === ""),
    );
}

/**
 * Applies every migration file (in filename order) to the given D1 database.
 * Shared by the D1-only and D1+R2 fixtures so migration logic lives in one place.
 */
async function applyMigrations(d1: D1Database): Promise<void> {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f: string) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8").trim();
    if (!sql) continue;

    const stmts = splitStatements(sql);
    if (stmts.length === 0) continue;

    const prepared = stmts.map((s) => d1.prepare(s));
    await d1.batch(prepared);
  }
}

/**
 * Creates a fresh in-memory D1 database with all migrations applied.
 * Returns both the D1Database instance and a dispose function.
 *
 * Uses Miniflare to provide a real SQLite-backed D1 so handler tests exercise
 * actual SQL queries rather than brittle mocks.
 */
export async function createTestD1(): Promise<{
  d1: D1Database;
  dispose: () => Promise<void>;
}> {
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: ["DB"],
  });

  const d1 = await mf.getD1Database("DB");
  await applyMigrations(d1);

  return {
    d1,
    dispose: () => mf.dispose(),
  };
}

/**
 * Creates a fresh in-memory D1 database AND an R2 bucket (via Miniflare),
 * both with all migrations applied. Use this for handler tests that need to
 * exercise R2 storage paths (cover images, attachments, avatar uploads).
 *
 * The R2 binding is named `STORAGE` to match the worker's env binding.
 */
export async function createTestD1WithR2(): Promise<{
  d1: D1Database;
  storage: R2Bucket;
  dispose: () => Promise<void>;
}> {
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: ["DB"],
    r2Buckets: ["STORAGE"],
  });

  const d1 = await mf.getD1Database("DB");
  const storage = (await mf.getR2Bucket("STORAGE")) as unknown as R2Bucket;
  await applyMigrations(d1);

  return {
    d1,
    storage,
    dispose: () => mf.dispose(),
  };
}
