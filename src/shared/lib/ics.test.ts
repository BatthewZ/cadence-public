import { describe, expect, it } from "vitest";

import type { ICSEvent } from "./ics";
import { generateICS } from "./ics";

const encoder = new TextEncoder();
/** Strict decoder: throws on invalid UTF-8 instead of substituting U+FFFD. */
const strictDecoder = new TextDecoder("utf-8", { fatal: true });

/** Helper: UTF-8 octet length of a string (RFC 5545 line limits are octets, not chars). */
function octets(value: string): number {
  return encoder.encode(value).length;
}

/**
 * Helper: RFC 5545 §3.1 unfolding — remove CRLF followed by a single space.
 * The generator only folds with a space (never a tab), so this restores
 * logical lines exactly.
 */
function unfold(ics: string): string {
  return ics.replace(/\r\n /g, "");
}

/** Helper: physical lines of the output (excluding the empty tail after the final CRLF). */
function physicalLines(ics: string): string[] {
  const segments = ics.split("\r\n");
  expect(segments[segments.length - 1]).toBe(""); // output must end with CRLF
  return segments.slice(0, -1);
}

/** Helper: logical (unfolded) lines of the output. */
function logicalLines(ics: string): string[] {
  return physicalLines(unfold(ics));
}

/** Helper: find the single logical line starting with the given property prefix. */
function getLine(ics: string, prefix: string): string | undefined {
  return logicalLines(ics).find((line) => line.startsWith(prefix));
}

/** Helper: a minimal valid event with overridable fields. */
function makeEvent(overrides: Partial<ICSEvent> = {}): ICSEvent {
  return {
    uid: "task-42@cadence",
    summary: "Write the report",
    startDate: "2026-03-10",
    endDateExclusive: "2026-03-11",
    dtstamp: new Date(Date.UTC(2026, 5, 11, 12, 0, 0)),
    ...overrides,
  };
}

function generate(events: ICSEvent[], calendarName = "Cadence"): string {
  return generateICS({ calendarName, events });
}

// ---------------------------------------------------------------------------
// VCALENDAR wrapper
// ---------------------------------------------------------------------------

describe("VCALENDAR wrapper", () => {
  it("empty event list yields a complete, valid VCALENDAR", () => {
    const ics = generate([]);
    expect(ics).toBe(
      "BEGIN:VCALENDAR\r\n" +
        "VERSION:2.0\r\n" +
        "PRODID:-//Cadence//Cadence//EN\r\n" +
        "CALSCALE:GREGORIAN\r\n" +
        "METHOD:PUBLISH\r\n" +
        "X-WR-CALNAME:Cadence\r\n" +
        "END:VCALENDAR\r\n",
    );
  });

  it("uses CRLF line endings exclusively (no bare LF or CR)", () => {
    const ics = generate([makeEvent()]);
    for (const line of physicalLines(ics)) {
      expect(line).not.toContain("\n");
      expect(line).not.toContain("\r");
    }
  });

  it("output ends with CRLF", () => {
    expect(generate([])).toMatch(/\r\n$/);
    expect(generate([makeEvent()])).toMatch(/\r\n$/);
  });

  it("escapes the calendar name as a TEXT value", () => {
    const ics = generate([], "Work; Personal, and\nmore\\stuff");
    expect(getLine(ics, "X-WR-CALNAME:")).toBe(
      "X-WR-CALNAME:Work\\; Personal\\, and\\nmore\\\\stuff",
    );
  });

  it("wraps events between the calendar headers and END:VCALENDAR", () => {
    const lines = logicalLines(generate([makeEvent()]));
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines[lines.length - 1]).toBe("END:VCALENDAR");
    expect(lines.indexOf("BEGIN:VEVENT")).toBeGreaterThan(lines.indexOf("X-WR-CALNAME:Cadence"));
    expect(lines.indexOf("END:VEVENT")).toBeLessThan(lines.indexOf("END:VCALENDAR"));
  });
});

// ---------------------------------------------------------------------------
// VEVENT fields
// ---------------------------------------------------------------------------

describe("VEVENT fields", () => {
  it("emits UID verbatim for plain caller-supplied identifiers", () => {
    const ics = generate([makeEvent({ uid: "task-abc123@cadence" })]);
    expect(getLine(ics, "UID:")).toBe("UID:task-abc123@cadence");
  });

  it("emits DTSTART and DTEND as VALUE=DATE (all-day, floating — no time component)", () => {
    const ics = generate([makeEvent({ startDate: "2026-03-10", endDateExclusive: "2026-03-11" })]);
    expect(getLine(ics, "DTSTART")).toBe("DTSTART;VALUE=DATE:20260310");
    expect(getLine(ics, "DTEND")).toBe("DTEND;VALUE=DATE:20260311");
  });

  it("passes endDateExclusive through verbatim (caller owns the +1-day math)", () => {
    // Multi-day event: 2026-03-10 .. 2026-03-14 inclusive → exclusive end 2026-03-15.
    // The generator must NOT add or subtract days itself.
    const ics = generate([makeEvent({ startDate: "2026-03-10", endDateExclusive: "2026-03-15" })]);
    expect(getLine(ics, "DTEND")).toBe("DTEND;VALUE=DATE:20260315");
  });

  it("converts YYYY-MM-DD by string manipulation (date preserved exactly, no UTC shift)", () => {
    // Dates that are classic UTC off-by-one candidates (1st of month, leap day).
    const ics = generate([makeEvent({ startDate: "2024-02-29", endDateExclusive: "2024-03-01" })]);
    expect(getLine(ics, "DTSTART")).toBe("DTSTART;VALUE=DATE:20240229");
    expect(getLine(ics, "DTEND")).toBe("DTEND;VALUE=DATE:20240301");
  });

  it("throws on malformed date strings instead of emitting a broken feed", () => {
    expect(() => generate([makeEvent({ startDate: "2026-3-10" })])).toThrow(/startDate/);
    expect(() => generate([makeEvent({ endDateExclusive: "20260311" })])).toThrow(
      /endDateExclusive/,
    );
  });

  it("formats DTSTAMP in UTC basic format", () => {
    const ics = generate([makeEvent({ dtstamp: new Date(Date.UTC(2026, 5, 11, 12, 0, 0)) })]);
    expect(getLine(ics, "DTSTAMP:")).toBe("DTSTAMP:20260611T120000Z");
  });

  it("zero-pads DTSTAMP components", () => {
    const ics = generate([makeEvent({ dtstamp: new Date(Date.UTC(2026, 0, 5, 3, 4, 5)) })]);
    expect(getLine(ics, "DTSTAMP:")).toBe("DTSTAMP:20260105T030405Z");
  });

  it("includes STATUS:COMPLETED only when status is COMPLETED", () => {
    const completed = generate([makeEvent({ status: "COMPLETED" })]);
    expect(getLine(completed, "STATUS:")).toBe("STATUS:COMPLETED");

    const open = generate([makeEvent()]);
    expect(getLine(open, "STATUS:")).toBeUndefined();
  });

  it("omits DESCRIPTION and URL when absent", () => {
    const ics = generate([makeEvent()]);
    expect(getLine(ics, "DESCRIPTION:")).toBeUndefined();
    expect(getLine(ics, "URL:")).toBeUndefined();
  });

  it("omits DESCRIPTION when empty (an empty TEXT property carries no information)", () => {
    const ics = generate([makeEvent({ description: "" })]);
    expect(getLine(ics, "DESCRIPTION:")).toBeUndefined();
  });

  it("includes DESCRIPTION and URL when present", () => {
    const ics = generate([
      makeEvent({
        description: "Details here",
        url: "https://cadence.example/w/1/tasks/42",
      }),
    ]);
    expect(getLine(ics, "DESCRIPTION:")).toBe("DESCRIPTION:Details here");
    expect(getLine(ics, "URL:")).toBe("URL:https://cadence.example/w/1/tasks/42");
  });

  it("emits URL verbatim (URI value type — TEXT escaping does not apply)", () => {
    const ics = generate([makeEvent({ url: "https://cadence.example/t?ids=1,2;mode=x" })]);
    expect(getLine(ics, "URL:")).toBe("URL:https://cadence.example/t?ids=1,2;mode=x");
  });

  it("emits one VEVENT block per event, in input order", () => {
    const ics = generate([
      makeEvent({ uid: "task-1@cadence", summary: "First" }),
      makeEvent({ uid: "task-2@cadence", summary: "Second" }),
    ]);
    const lines = logicalLines(ics);
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(2);
    expect(lines.filter((l) => l === "END:VEVENT")).toHaveLength(2);
    expect(lines.indexOf("UID:task-1@cadence")).toBeLessThan(lines.indexOf("UID:task-2@cadence"));
  });
});

// ---------------------------------------------------------------------------
// TEXT escaping
// ---------------------------------------------------------------------------

describe("TEXT escaping", () => {
  it("escapes backslash, semicolon, comma, and newline in SUMMARY", () => {
    const ics = generate([makeEvent({ summary: "back\\slash;semi,comma\nnewline" })]);
    expect(getLine(ics, "SUMMARY:")).toBe("SUMMARY:back\\\\slash\\;semi\\,comma\\nnewline");
  });

  it("escapes backslash, semicolon, comma, and newline in DESCRIPTION", () => {
    const ics = generate([makeEvent({ description: "a\\b;c,d\ne" })]);
    expect(getLine(ics, "DESCRIPTION:")).toBe("DESCRIPTION:a\\\\b\\;c\\,d\\ne");
  });

  it("escapes backslash before the other characters (no double-escaping of inserted backslashes)", () => {
    // If ";" were escaped first ("\;") and backslashes after ("\\\;"), parsers
    // would read a literal backslash followed by an escaped semicolon — wrong.
    const ics = generate([makeEvent({ summary: "\\;" })]);
    expect(getLine(ics, "SUMMARY:")).toBe("SUMMARY:\\\\\\;");
  });

  it("normalizes CRLF and lone CR to the literal \\n sequence", () => {
    const ics = generate([makeEvent({ description: "one\r\ntwo\rthree" })]);
    expect(getLine(ics, "DESCRIPTION:")).toBe("DESCRIPTION:one\\ntwo\\nthree");
  });

  it("a raw newline in input never produces a raw line break in output", () => {
    const ics = generate([makeEvent({ summary: "line1\nline2" })]);
    // Unfolded output must contain the summary as ONE logical line.
    expect(getLine(ics, "SUMMARY:")).toBe("SUMMARY:line1\\nline2");
    // And no physical line consists of the dangling second half.
    expect(logicalLines(ics)).not.toContain("line2");
  });
});

// ---------------------------------------------------------------------------
// Line folding at 75 octets
// ---------------------------------------------------------------------------

describe("line folding", () => {
  it("a line of exactly 75 octets is NOT folded", () => {
    // "SUMMARY:" is 8 octets; 67 ASCII chars → exactly 75 octets.
    const summary = "a".repeat(67);
    const ics = generate([makeEvent({ summary })]);
    const line = physicalLines(ics).find((l) => l.startsWith("SUMMARY:"));
    expect(line).toBe(`SUMMARY:${summary}`);
    expect(octets(line!)).toBe(75);
  });

  it("a line of 76 octets is folded into 75 octets + continuation", () => {
    // 68 ASCII chars → 76 octets: must fold after the 75th octet.
    const summary = "a".repeat(68);
    const ics = generate([makeEvent({ summary })]);
    const lines = physicalLines(ics);
    const start = lines.findIndex((l) => l.startsWith("SUMMARY:"));
    expect(lines[start]).toBe(`SUMMARY:${"a".repeat(67)}`);
    expect(octets(lines[start])).toBe(75);
    expect(lines[start + 1]).toBe(" a");
    // Unfolding restores the logical line exactly.
    expect(getLine(ics, "SUMMARY:")).toBe(`SUMMARY:${summary}`);
  });

  it("continuation lines start with a single space and stay within 75 octets", () => {
    const summary = "a".repeat(200);
    const ics = generate([makeEvent({ summary })]);
    const lines = physicalLines(ics);
    const start = lines.findIndex((l) => l.startsWith("SUMMARY:"));
    const continuations = [lines[start + 1], lines[start + 2]];
    for (const cont of continuations) {
      expect(cont.startsWith(" ")).toBe(true);
      expect(cont.startsWith("  ")).toBe(false);
      expect(octets(cont)).toBeLessThanOrEqual(75);
    }
    expect(getLine(ics, "SUMMARY:")).toBe(`SUMMARY:${summary}`);
  });

  it("never splits a 3-octet CJK character: folds early rather than mid-sequence", () => {
    // "SUMMARY:" (8) + 66 ASCII (66) = 74 octets, then a 3-octet CJK char
    // would hit 77. Filling to 75 would split the character — the fold must
    // instead happen at 74 octets, before the character.
    const summary = `${"a".repeat(66)}日`;
    const ics = generate([makeEvent({ summary })]);
    const lines = physicalLines(ics);
    const start = lines.findIndex((l) => l.startsWith("SUMMARY:"));
    expect(octets(lines[start])).toBe(74);
    expect(lines[start]).toBe(`SUMMARY:${"a".repeat(66)}`);
    expect(lines[start + 1]).toBe(" 日");
    expect(getLine(ics, "SUMMARY:")).toBe(`SUMMARY:${summary}`);
  });

  it("folds a long emoji/CJK summary without breaking UTF-8 and remains unfoldable", () => {
    // 4-octet emoji (surrogate pairs in UTF-16) interleaved with 3-octet CJK:
    // forces multiple folds mid-text at awkward octet boundaries.
    const summary = "🎉日🚀本🧪語".repeat(12);
    const ics = generate([makeEvent({ summary })]);

    for (const line of physicalLines(ics)) {
      expect(octets(line)).toBeLessThanOrEqual(75);
      // Strict round-trip: a split surrogate pair would either throw in the
      // fatal decoder or surface as U+FFFD and fail the equality check.
      const decoded = strictDecoder.decode(encoder.encode(line));
      expect(decoded).toBe(line);
      expect(line).not.toContain("�");
      // No physical line may end in a lone high surrogate (broken pair).
      expect(/[\uD800-\uDBFF]$/.test(line)).toBe(false);
    }

    // Unfolding restores the original logical line byte-for-byte.
    expect(getLine(ics, "SUMMARY:")).toBe(`SUMMARY:${summary}`);
  });

  it("folds long DESCRIPTION and URL lines too", () => {
    const description = "d".repeat(300);
    const url = `https://cadence.example/tasks/${"x".repeat(120)}`;
    const ics = generate([makeEvent({ description, url })]);
    for (const line of physicalLines(ics)) {
      expect(octets(line)).toBeLessThanOrEqual(75);
    }
    expect(getLine(ics, "DESCRIPTION:")).toBe(`DESCRIPTION:${description}`);
    expect(getLine(ics, "URL:")).toBe(`URL:${url}`);
  });
});

// ---------------------------------------------------------------------------
// Determinism / UID stability
// ---------------------------------------------------------------------------

describe("determinism", () => {
  it("same input produces byte-identical output across calls (UID + feed stability)", () => {
    // Subscription clients diff feeds by UID; byte-identical regeneration is
    // what lets them update events in place instead of duplicating them.
    const events = [
      makeEvent({ uid: "task-1@cadence", summary: "Stable 🎯", description: "desc" }),
      makeEvent({ uid: "task-2@cadence", status: "COMPLETED" }),
    ];
    const first = generateICS({ calendarName: "Cadence", events });
    const second = generateICS({ calendarName: "Cadence", events });
    expect(second).toBe(first);
  });
});

// ---------------------------------------------------------------------------
// Global output invariants
// ---------------------------------------------------------------------------

describe("global output invariants", () => {
  it("every physical line is at most 75 octets and output ends with CRLF", () => {
    const ics = generate(
      [
        makeEvent({
          uid: `task-${"1".repeat(80)}@cadence`,
          summary: `Launch 🚀 ${"планирование".repeat(10)}`,
          description: `Multi-line\n${"詳細な説明".repeat(20)}; with, specials\\`,
          url: `https://cadence.example/w/1/p/2/t/${"a".repeat(100)}`,
          status: "COMPLETED",
        }),
        makeEvent({ uid: "task-short@cadence", summary: "ok" }),
      ],
      "My Team Calendar 📅 with a fairly long name that itself needs folding!",
    );

    expect(ics.endsWith("\r\n")).toBe(true);
    for (const line of physicalLines(ics)) {
      expect(octets(line)).toBeLessThanOrEqual(75);
    }
  });
});
