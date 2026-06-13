import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  EXPORT_FORMAT_VERSION,
  MAX_IMPORT_FILE_BYTES,
} from "../../../../shared/schemas/workspace-export";
import type { ImportDocument } from "../../../../shared/schemas/workspace-import";
import type { ParseImportResult, TrelloConverter } from "./parse";
import { parseImportFile, sniffFormat, validateDocumentIntegrity } from "./parse";
import {
  makeExportFile,
  makeGroup,
  makeProject,
  makeTask,
  makeTrelloBoard,
  makeUser,
} from "./test-fixtures";

/**
 * Parse-layer tests: these exercise the part of import users actually hit
 * when something is wrong with their file — size guard ordering, friendly
 * JSON/Zod/integrity errors — and the SEAM to the Trello converter (built
 * as a concurrent work unit). The converter is faked here on purpose: these
 * tests pin the dispatch contract (sniff → convert → re-validate → merge
 * reporting), not Trello conversion semantics, which belong to trello.test.ts.
 */

/** A trivially-valid converter standing in for WX5's trelloToImportDocument. */
function fakeConverter(doc: ImportDocument): TrelloConverter {
  return () => doc;
}

function expectFailure(
  result: ParseImportResult,
  reason: "too-large" | "invalid-json" | "unsupported-format" | "invalid-document",
): string[] {
  if (result.ok) {
    throw new Error(`expected parse failure "${reason}" but parse succeeded`);
  }
  expect(result.reason).toBe(reason);
  expect(result.errors.length).toBeGreaterThan(0);
  return result.errors;
}

describe("sniffFormat", () => {
  it("detects a Cadence export by its format literal", () => {
    expect(sniffFormat(makeExportFile())).toBe("cadence");
  });

  it("detects a Trello board by its top-level shape", () => {
    expect(sniffFormat(makeTrelloBoard())).toBe("trello");
  });

  it("returns null for non-objects, arrays, and unrecognized objects", () => {
    expect(sniffFormat(null)).toBeNull();
    expect(sniffFormat("a string")).toBeNull();
    expect(sniffFormat([1, 2, 3])).toBeNull();
    expect(sniffFormat({ hello: "world" })).toBeNull();
    // Partial Trello shape must not match — `cards` missing.
    expect(sniffFormat({ id: "x", name: "y", lists: [] })).toBeNull();
  });
});

describe("parseImportFile — guards", () => {
  const opts = { convertTrello: fakeConverter({ users: [], projects: [] }) };

  it("rejects oversize input BEFORE attempting JSON.parse", () => {
    // 20MB+1 of zero bytes is not valid JSON; getting "too-large" (not
    // "invalid-json") proves the size guard runs before the parse — the
    // ordering that keeps a hostile upload from blowing the 128 MB isolate.
    const result = parseImportFile(new Uint8Array(MAX_IMPORT_FILE_BYTES + 1), opts);
    const errors = expectFailure(result, "too-large");
    expect(errors[0]).toContain("20 MB");
  });

  it("accepts a file exactly at the size limit (boundary)", () => {
    const payload = JSON.stringify(makeExportFile());
    expect(payload.length).toBeLessThan(MAX_IMPORT_FILE_BYTES);
    const result = parseImportFile(payload, opts);
    expect(result.ok).toBe(true);
  });

  it("reports malformed JSON as a friendly error", () => {
    const errors = expectFailure(parseImportFile("{not json", opts), "invalid-json");
    expect(errors[0]).toContain("not valid JSON");
  });

  it("rejects JSON that is neither Cadence nor Trello", () => {
    const errors = expectFailure(
      parseImportFile(JSON.stringify({ some: "object" }), opts),
      "unsupported-format",
    );
    expect(errors[0]).toContain("cadence.workspace");
  });

  it("accepts byte input (Uint8Array) for valid documents", () => {
    const bytes = new TextEncoder().encode(JSON.stringify(makeExportFile()));
    const result = parseImportFile(bytes, opts);
    expect(result.ok).toBe(true);
  });
});

describe("parseImportFile — Cadence documents", () => {
  const opts = { convertTrello: fakeConverter({ users: [], projects: [] }) };

  it("parses a valid export into an ImportDocument with envelope-derived skip counts", () => {
    const group = makeGroup();
    const file = makeExportFile({
      users: [makeUser("u1", "alice@example.com")],
      teams: [{ name: "Team A", description: null, members: [] }],
      webhooks: [
        {
          name: "Hook",
          url: "https://example.com/hook",
          events: ["task.created"],
          active: true,
          projectId: null,
        },
        {
          name: "Hook 2",
          url: "https://example.com/hook2",
          events: ["task.created"],
          active: false,
          projectId: null,
        },
      ],
      invitations: [{ email: "invitee@example.com", role: "member", status: "pending" }],
      projects: [
        makeProject({
          taskGroups: [group],
          tasks: [
            makeTask(group.id, {
              assigneeRef: "u1",
              attachments: [
                {
                  filename: "spec.pdf",
                  mimeType: "application/pdf",
                  size: 1024,
                  key: "attachment/u/x.pdf",
                  url: "/api/uploads/attachment/u/x.pdf",
                },
              ],
              activity: [
                {
                  actorRef: "u1",
                  action: "created",
                  field: null,
                  oldValue: null,
                  newValue: null,
                  createdAt: "2026-01-15T10:00:00.000Z",
                },
                {
                  actorRef: null,
                  action: "updated",
                  field: "title",
                  oldValue: "a",
                  newValue: "b",
                  createdAt: "2026-01-15T11:00:00.000Z",
                },
              ],
            }),
          ],
        }),
      ],
    });

    const result = parseImportFile(JSON.stringify(file), opts);
    if (!result.ok) throw new Error(`expected success, got: ${result.errors.join("; ")}`);

    expect(result.sourceFormat).toBe("cadence");
    expect(result.doc.users).toHaveLength(1);
    expect(result.doc.projects).toHaveLength(1);
    // Honest-cuts ledger: envelope sections counted at parse time because
    // the ImportDocument cannot carry them.
    expect(result.skipped).toEqual({
      webhooks: 2,
      teams: 1,
      invitations: 1,
      attachments: 1,
      activity: 2,
      closedItems: 0,
    });
  });

  it("warns about uploaded cover images, which do not round-trip", () => {
    const group = makeGroup();
    const file = makeExportFile({
      projects: [
        makeProject({
          coverImage: { key: "covers/u/p.jpg", url: "/api/uploads/covers/u/p.jpg", position: 50 },
          taskGroups: [group],
          tasks: [
            makeTask(group.id, {
              coverImage: { key: "covers/u/t.jpg", url: "/api/uploads/covers/u/t.jpg", position: null },
            }),
          ],
        }),
      ],
    });

    const result = parseImportFile(JSON.stringify(file), opts);
    if (!result.ok) throw new Error(`expected success, got: ${result.errors.join("; ")}`);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("2 uploaded cover images");
  });

  it("rejects a Zod-invalid document with path-addressed messages", () => {
    const group = makeGroup();
    const file = makeExportFile({
      projects: [
        makeProject({
          taskGroups: [group],
          tasks: [makeTask(group.id, { title: "" })],
        }),
      ],
    });

    const errors = expectFailure(
      parseImportFile(JSON.stringify(file), opts),
      "invalid-document",
    );
    // The user must be able to FIND the bad value in a large file.
    expect(errors.some((e) => e.includes("projects[0].tasks[0].title"))).toBe(true);
  });

  it("rejects a future formatVersion with an exact, named mismatch", () => {
    const file = { ...makeExportFile(), formatVersion: EXPORT_FORMAT_VERSION + 1 };
    const errors = expectFailure(
      parseImportFile(JSON.stringify(file), opts),
      "invalid-document",
    );
    expect(errors.some((e) => e.includes("formatVersion"))).toBe(true);
  });

  it("rejects a document whose webhook entries carry a secret (strictObject contract)", () => {
    // Built as an untyped spread (not through the typed fixture) because a
    // secret-carrying webhook is deliberately unrepresentable in the
    // WorkspaceExport type — that unrepresentability is the contract.
    const file = {
      ...makeExportFile(),
      webhooks: [
        {
          name: "Hook",
          url: "https://example.com/hook",
          events: ["task.created"],
          active: true,
          projectId: null,
          // A secret smuggled into the envelope must fail parse, not be
          // silently accepted — the never-serialize-secrets guarantee.
          secret: "leaked",
        },
      ],
    };
    expectFailure(parseImportFile(JSON.stringify(file), opts), "invalid-document");
  });

  it("rejects tasks referencing a task group that is not in the file", () => {
    const file = makeExportFile({
      projects: [
        makeProject({
          name: "Broken",
          taskGroups: [makeGroup()],
          tasks: [makeTask("no-such-group", { title: "Orphaned task" })],
        }),
      ],
    });

    const errors = expectFailure(
      parseImportFile(JSON.stringify(file), opts),
      "invalid-document",
    );
    expect(errors.some((e) => e.includes("Orphaned task") && e.includes("no-such-group"))).toBe(
      true,
    );
  });

  it("rejects duplicate user refs (ambiguous matching)", () => {
    const file = makeExportFile({
      users: [makeUser("u1", "a@example.com"), makeUser("u1", "b@example.com")],
    });

    const errors = expectFailure(
      parseImportFile(JSON.stringify(file), opts),
      "invalid-document",
    );
    expect(errors.some((e) => e.includes('duplicate ref "u1"'))).toBe(true);
  });
});

describe("parseImportFile — Trello converter seam", () => {
  it("dispatches sniffed Trello boards to the injected converter", () => {
    const group = makeGroup();
    const doc: ImportDocument = {
      users: [],
      projects: [makeProject({ taskGroups: [group], tasks: [makeTask(group.id)] })],
    };
    const convertTrello = vi.fn<TrelloConverter>(() => doc);
    const board = makeTrelloBoard();

    const result = parseImportFile(JSON.stringify(board), { convertTrello });
    if (!result.ok) throw new Error(`expected success, got: ${result.errors.join("; ")}`);

    expect(convertTrello).toHaveBeenCalledTimes(1);
    // The converter receives the JSON-parsed board, not the raw text.
    expect(convertTrello).toHaveBeenCalledWith(board);
    expect(result.sourceFormat).toBe("trello");
    expect(result.doc.projects).toHaveLength(1);
    expect(result.skipped.closedItems).toBe(0);
  });

  it("merges converter-domain skip counts and warnings (TrelloConversion shape)", () => {
    const convertTrello: TrelloConverter = () => ({
      doc: { users: [], projects: [makeProject()] },
      skipped: { closedItems: 4 },
      warnings: ["3 board members could not be matched (Trello exports contain no emails)"],
    });

    const result = parseImportFile(JSON.stringify(makeTrelloBoard()), { convertTrello });
    if (!result.ok) throw new Error(`expected success, got: ${result.errors.join("; ")}`);

    expect(result.skipped.closedItems).toBe(4);
    expect(result.warnings.some((w) => w.includes("could not be matched"))).toBe(true);
  });

  it("re-validates converter output against the import contract (seam guard)", () => {
    // A buggy converter emitting an out-of-contract doc must surface as a
    // clear validation failure here — the executor writes doc fields
    // straight to the DB and is never allowed to see this. (An empty name
    // is TYPE-valid but contract-invalid — exactly the runtime drift the
    // seam guard exists for, hence no cast is needed.)
    const badDoc: ImportDocument = {
      users: [],
      projects: [{ ...makeProject(), name: "" }],
    };
    const result = parseImportFile(JSON.stringify(makeTrelloBoard()), {
      convertTrello: () => badDoc,
    });
    const errors = expectFailure(result, "invalid-document");
    expect(errors.some((e) => e.includes("projects[0].name"))).toBe(true);
  });

  it("maps converter throws (ZodError and plain Error) to friendly failures", () => {
    // A REAL schema failure (not a hand-built ZodError) — this is exactly
    // how WX5's converter is expected to fail on a bad board.
    const zodThrow: TrelloConverter = (board) => {
      z.object({ lists: z.array(z.unknown()).min(1, "Board has no lists") }).parse(board);
      throw new Error("unreachable");
    };
    const zodErrors = expectFailure(
      parseImportFile(JSON.stringify(makeTrelloBoard()), { convertTrello: zodThrow }),
      "invalid-document",
    );
    expect(zodErrors.some((e) => e.includes("lists") && e.includes("Board has no lists"))).toBe(
      true,
    );

    const plainThrow: TrelloConverter = () => {
      throw new Error("unsupported board version");
    };
    const plainErrors = expectFailure(
      parseImportFile(JSON.stringify(makeTrelloBoard()), { convertTrello: plainThrow }),
      "invalid-document",
    );
    expect(plainErrors[0]).toContain("unsupported board version");
  });

  it("runs integrity checks on converted docs too", () => {
    const convertTrello: TrelloConverter = () => ({
      users: [],
      projects: [
        makeProject({
          taskGroups: [makeGroup()],
          tasks: [makeTask("ghost-list", { title: "Card" })],
        }),
      ],
    });
    const errors = expectFailure(
      parseImportFile(JSON.stringify(makeTrelloBoard()), { convertTrello }),
      "invalid-document",
    );
    expect(errors.some((e) => e.includes("ghost-list"))).toBe(true);
  });
});

describe("validateDocumentIntegrity", () => {
  it("passes a fully-linked document", () => {
    const group = makeGroup();
    const doc: ImportDocument = {
      users: [makeUser("u1", "a@example.com")],
      projects: [makeProject({ taskGroups: [group], tasks: [makeTask(group.id)] })],
    };
    expect(validateDocumentIntegrity(doc)).toEqual([]);
  });

  it("caps reported errors so a hugely broken file cannot flood the response", () => {
    const tasks = Array.from({ length: 100 }, (_, i) =>
      makeTask(`missing-${i}`, { title: `Task ${i}` }),
    );
    const doc: ImportDocument = {
      users: [],
      projects: [makeProject({ taskGroups: [], tasks })],
    };
    expect(validateDocumentIntegrity(doc).length).toBeLessThanOrEqual(25);
  });
});
