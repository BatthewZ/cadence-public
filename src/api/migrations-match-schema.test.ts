/// <reference types="@cloudflare/workers-types" />
/**
 * The Drizzle schema declares each foreign key's referential action, but
 * production runs whatever the SQL in `migrations/` built. `drizzle-kit`
 * drops `ON DELETE` from `ALTER TABLE ... ADD ... REFERENCES`, so the two
 * can disagree silently until a delete is blocked (or not cascaded) in prod.
 * This compares every declared foreign key against the migrated database.
 */

import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "../db/schema";
import { createTestD1 } from "./test-utils";

interface PragmaForeignKey {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
}

const tables = Object.values<unknown>(schema).filter((value): value is SQLiteTable =>
  is(value, SQLiteTable),
);

function describeForeignKey(fk: {
  from: string[];
  table: string;
  to: string[];
  onUpdate: string;
  onDelete: string;
}): string {
  return `(${fk.from.join(", ")}) -> ${fk.table}(${fk.to.join(", ")}) ON UPDATE ${fk.onUpdate} ON DELETE ${fk.onDelete}`;
}

function declaredForeignKeys(table: SQLiteTable): string[] {
  return getTableConfig(table)
    .foreignKeys.map((fk) => {
      const ref = fk.reference();
      return describeForeignKey({
        from: ref.columns.map((c) => c.name),
        table: getTableConfig(ref.foreignTable).name,
        to: ref.foreignColumns.map((c) => c.name),
        onUpdate: (fk.onUpdate ?? "no action").toLowerCase(),
        onDelete: (fk.onDelete ?? "no action").toLowerCase(),
      });
    })
    .sort();
}

async function migratedForeignKeys(d1: D1Database, tableName: string): Promise<string[]> {
  const { results } = await d1
    .prepare("SELECT * FROM pragma_foreign_key_list(?)")
    .bind(tableName)
    .all<PragmaForeignKey>();

  const byId = new Map<number, PragmaForeignKey[]>();
  for (const row of results) {
    byId.set(row.id, [...(byId.get(row.id) ?? []), row]);
  }

  return [...byId.values()]
    .map((rows) => {
      const ordered = [...rows].sort((a, b) => a.seq - b.seq);
      return describeForeignKey({
        from: ordered.map((r) => r.from),
        table: ordered[0].table,
        to: ordered.map((r) => r.to),
        onUpdate: ordered[0].on_update.toLowerCase(),
        onDelete: ordered[0].on_delete.toLowerCase(),
      });
    })
    .sort();
}

let d1: D1Database;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ d1, dispose } = await createTestD1());
});

afterAll(async () => {
  await dispose();
});

describe("migrations build the foreign keys the schema declares", () => {
  it("finds the schema's tables", () => {
    expect(tables.length).toBeGreaterThan(0);
  });

  it.each(tables.map((table) => [getTableConfig(table).name, table] as const))(
    "%s",
    async (tableName, table) => {
      expect(await migratedForeignKeys(d1, tableName)).toEqual(declaredForeignKeys(table));
    },
  );
});
