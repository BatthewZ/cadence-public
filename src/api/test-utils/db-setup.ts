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

  // Apply all migrations file-by-file using batch (d1.exec has issues in miniflare)
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

  return {
    d1,
    dispose: () => mf.dispose(),
  };
}
