import { describe, expect, it } from "vitest";

import type { ICSEvent } from "./ics";
import { generateICS } from "./ics";
import { parseICS } from "./ics-parse";

/**
 * Why these tests matter: the parser is the entry point of the one-shot
 * `.ics` import — it ingests files we do not control (Google Calendar,
 * Outlook, hand-edited). Each fixture below pins a real-world shape or an
 * RFC 5545 corner that, if regressed, either silently corrupts every
 * imported date (DTEND exclusivity, UTC math, truncation) or kills an entire
 * import because of one bad block (skip-with-warning contract). The
 * round-trip suite at the bottom pins the import side and the export side
 * (`ics.ts`) to ONE shared definition of DTEND exclusivity — the classic
 * failure is applying the +1/−1 in both directions or neither.
 */

/** Helper: join lines with CRLF (the RFC 5545 wire format). */
function crlf(lines: string[]): string {
  return lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Real-world fixture: Google Calendar export shape
// ---------------------------------------------------------------------------

const GOOGLE_FIXTURE = crlf([
  "BEGIN:VCALENDAR",
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "VERSION:2.0",
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  "X-WR-CALNAME:Personal",
  "X-WR-TIMEZONE:America/New_York",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20260310",
  "DTEND;VALUE=DATE:20260311",
  "DTSTAMP:20260301T120000Z",
  "UID:abc123def456@google.com",
  "CREATED:20260225T080000Z",
  "DESCRIPTION:Pick up dry cleaning\\, then dinner with Sam",
  "LAST-MODIFIED:20260225T080000Z",
  "SEQUENCE:0",
  "STATUS:CONFIRMED",
  "SUMMARY:Errand day",
  "TRANSP:TRANSPARENT",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "DESCRIPTION:This alarm text must not override the event description",
  "TRIGGER:-P0DT0H30M0S",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20260401",
  "DTEND;VALUE=DATE:20260404",
  "DTSTAMP:20260301T120000Z",
  "UID:ghi789@google.com",
  "SUMMARY:Conference trip",
  "END:VEVENT",
  "END:VCALENDAR",
]);

describe("parseICS — Google Calendar export shape", () => {
  it("parses all-day events with VALUE=DATE and no warnings", () => {
    const { events, warnings } = parseICS(GOOGLE_FIXTURE);
    expect(warnings).toEqual([]);
    expect(events).toHaveLength(2);
  });

  it("reverses DTEND exclusivity: single-day all-day event has endDate === startDate", () => {
    const { events } = parseICS(GOOGLE_FIXTURE);
    expect(events[0]).toMatchObject({
      uid: "abc123def456@google.com",
      summary: "Errand day",
      startDate: "2026-03-10",
      endDate: "2026-03-10",
    });
  });

  it("reverses DTEND exclusivity: multi-day all-day event ends DTEND − 1", () => {
    const { events } = parseICS(GOOGLE_FIXTURE);
    // DTEND 2026-04-04 exclusive → last included day is 2026-04-03
    expect(events[1]).toMatchObject({
      summary: "Conference trip",
      startDate: "2026-04-01",
      endDate: "2026-04-03",
    });
  });

  it("unescapes \\, in DESCRIPTION", () => {
    const { events } = parseICS(GOOGLE_FIXTURE);
    expect(events[0].description).toBe("Pick up dry cleaning, then dinner with Sam");
  });

  it("does not let a nested VALARM's DESCRIPTION override the event's", () => {
    const { events } = parseICS(GOOGLE_FIXTURE);
    expect(events[0].description).not.toContain("alarm text");
  });
});

// ---------------------------------------------------------------------------
// Real-world fixture: Outlook export shape (CRLF, TZID date-times, VTIMEZONE)
// ---------------------------------------------------------------------------

const OUTLOOK_FIXTURE = crlf([
  "BEGIN:VCALENDAR",
  "PRODID:Microsoft Exchange Server 2010",
  "VERSION:2.0",
  "X-WR-CALNAME:Work",
  "BEGIN:VTIMEZONE",
  "TZID:Eastern Standard Time",
  "BEGIN:STANDARD",
  "DTSTART:16010101T020000",
  "TZOFFSETFROM:-0400",
  "TZOFFSETTO:-0500",
  "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:16010101T020000",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0400",
  "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "UID:040000008200E00074C5B7101A82E00800000000B0",
  "SUMMARY:Quarterly planning",
  "DTSTART;TZID=Eastern Standard Time:20260415T093000",
  "DTEND;TZID=Eastern Standard Time:20260415T103000",
  "DTSTAMP:20260401T000000Z",
  "STATUS:CONFIRMED",
  "END:VEVENT",
  "END:VCALENDAR",
]);

describe("parseICS — Outlook export shape", () => {
  it("strips TZID parameters and truncates date-times to their date part", () => {
    const { events, warnings } = parseICS(OUTLOOK_FIXTURE);
    expect(warnings).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      summary: "Quarterly planning",
      startDate: "2026-04-15",
      endDate: "2026-04-15",
    });
  });

  it("ignores VTIMEZONE blocks entirely — their DTSTART lines never leak into events", () => {
    const { events } = parseICS(OUTLOOK_FIXTURE);
    // If VTIMEZONE leaked, startDate would be 1601-01-01 or extra events would appear.
    expect(events).toHaveLength(1);
    expect(events[0].startDate).toBe("2026-04-15");
  });
});

// ---------------------------------------------------------------------------
// Line unfolding
// ---------------------------------------------------------------------------

describe("parseICS — line unfolding", () => {
  it("unfolds CRLF + space continuations in long lines", () => {
    const text = crlf([
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260601",
      "SUMMARY:A meeting with an extremely long title that a conforming gener",
      " ator folded at the 75 octet boundary mid-word",
      "END:VEVENT",
      "END:VCALENDAR",
    ]);
    const { events, warnings } = parseICS(text);
    expect(warnings).toEqual([]);
    expect(events[0].summary).toBe(
      "A meeting with an extremely long title that a conforming generator folded at the 75 octet boundary mid-word",
    );
  });

  it("unfolds tab continuations (RFC 5545 allows HTAB)", () => {
    const text = crlf([
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260601",
      "SUMMARY:Tab fol",
      "\tded title",
      "END:VEVENT",
    ]);
    const { events } = parseICS(text);
    expect(events[0].summary).toBe("Tab folded title");
  });

  it("unfolds a fold between the two backslashes of an escaped backslash (\\\\)", () => {
    // Physical line 1 ends with the first "\" of an escaped backslash; the
    // continuation starts with the second "\" followed by an escaped comma.
    // Unfolding rejoins "...here\" + "\, and..." into "...here\\, and..."
    // which unescapes (single pass) to a literal backslash + comma.
    const text = crlf([
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260601",
      "DESCRIPTION:Escaped comma split across a fold right here\\",
      " \\, and the text continues",
      "SUMMARY:Fold mid-escape",
      "END:VEVENT",
    ]);
    const { events, warnings } = parseICS(text);
    expect(warnings).toEqual([]);
    expect(events[0].description).toBe(
      "Escaped comma split across a fold right here\\, and the text continues",
    );
  });

  it("unfolds a fold splitting a plain \\, escape between backslash and comma", () => {
    const text = crlf([
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260601",
      "DESCRIPTION:before\\",
      " ,after",
      "SUMMARY:Fold splits escape",
      "END:VEVENT",
    ]);
    const { events, warnings } = parseICS(text);
    expect(warnings).toEqual([]);
    // Unfold rejoins "\" + "," into the escape "\,", which unescapes to ","
    expect(events[0].description).toBe("before,after");
  });
});

// ---------------------------------------------------------------------------
// Text unescaping
// ---------------------------------------------------------------------------

describe("parseICS — TEXT unescaping", () => {
  it("unescapes \\\\, \\;, \\,, \\n and \\N", () => {
    const text = crlf([
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260601",
      "SUMMARY:Path C:\\\\temp\\; done\\, finally",
      "DESCRIPTION:line one\\nline two\\Nline three",
      "END:VEVENT",
    ]);
    const { events } = parseICS(text);
    expect(events[0].summary).toBe("Path C:\\temp; done, finally");
    expect(events[0].description).toBe("line one\nline two\nline three");
  });

  it("does not double-unescape: \\\\n stays a literal backslash + n", () => {
    const text = crlf([
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260601",
      "SUMMARY:literal \\\\n not newline",
      "END:VEVENT",
    ]);
    const { events } = parseICS(text);
    expect(events[0].summary).toBe("literal \\n not newline");
    expect(events[0].summary).not.toContain("\n");
  });
});

// ---------------------------------------------------------------------------
// Date forms, truncation, and DTEND handling
// ---------------------------------------------------------------------------

describe("parseICS — date handling", () => {
  it("accepts bare YYYYMMDD dates without a VALUE=DATE parameter", () => {
    const text = crlf([
      "BEGIN:VEVENT",
      "DTSTART:20260102",
      "SUMMARY:Bare date",
      "END:VEVENT",
    ]);
    const { events, warnings } = parseICS(text);
    expect(warnings).toEqual([]);
    expect(events[0]).toMatchObject({ startDate: "2026-01-02", endDate: "2026-01-02" });
  });

  it("truncates UTC date-times (Z suffix) to their date part", () => {
    const text = crlf([
      "BEGIN:VEVENT",
      "DTSTART:20260415T093000Z",
      "SUMMARY:UTC datetime",
      "END:VEVENT",
    ]);
    const { events } = parseICS(text);
    expect(events[0].startDate).toBe("2026-04-15");
    expect(events[0].endDate).toBe("2026-04-15");
  });

  it("missing DTEND → single-day event (endDate === startDate)", () => {
    const text = crlf([
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260310",
      "SUMMARY:No DTEND",
      "END:VEVENT",
    ]);
    const { events, warnings } = parseICS(text);
    expect(warnings).toEqual([]);
    expect(events[0]).toMatchObject({ startDate: "2026-03-10", endDate: "2026-03-10" });
  });

  it("all-day DTEND crossing a month boundary reverses correctly (DTEND 20260401 → endDate 2026-03-31)", () => {
    const text = crlf([
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260330",
      "DTEND;VALUE=DATE:20260401",
      "SUMMARY:Month boundary",
      "END:VEVENT",
    ]);
    const { events } = parseICS(text);
    expect(events[0]).toMatchObject({ startDate: "2026-03-30", endDate: "2026-03-31" });
  });

  it("date-time DTEND is NOT decremented — its date part is the end date", () => {
    const text = crlf([
      "BEGIN:VEVENT",
      "DTSTART:20260415T093000",
      "DTEND:20260416T103000",
      "SUMMARY:Overnight meeting",
      "END:VEVENT",
    ]);
    const { events } = parseICS(text);
    expect(events[0]).toMatchObject({ startDate: "2026-04-15", endDate: "2026-04-16" });
  });

  it("date-time DTEND at exactly midnight keeps its literal date part (pinned: no −1)", () => {
    const text = crlf([
      "BEGIN:VEVENT",
      "DTSTART:20260415T220000Z",
      "DTEND:20260416T000000Z",
      "SUMMARY:Ends at midnight",
      "END:VEVENT",
    ]);
    const { events } = parseICS(text);
    expect(events[0].endDate).toBe("2026-04-16");
  });

  it("same-day date-time DTSTART/DTEND → single-day", () => {
    const text = crlf([
      "BEGIN:VEVENT",
      "DTSTART:20260415T093000",
      "DTEND:20260415T103000",
      "SUMMARY:Same day",
      "END:VEVENT",
    ]);
    const { events } = parseICS(text);
    expect(events[0].startDate).toBe(events[0].endDate);
    expect(events[0].startDate).toBe("2026-04-15");
  });

  it("degenerate all-day DTEND === DTSTART (invalid per RFC) clamps to single-day instead of going backwards", () => {
    const text = crlf([
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260310",
      "DTEND;VALUE=DATE:20260310",
      "SUMMARY:Producer bug",
      "END:VEVENT",
    ]);
    const { events, warnings } = parseICS(text);
    expect(warnings).toEqual([]);
    expect(events[0]).toMatchObject({ startDate: "2026-03-10", endDate: "2026-03-10" });
  });

  it("DURATION on an all-day event: P3D spans start + 2 more days (exclusive like DTEND)", () => {
    const text = crlf([
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260310",
      "DURATION:P3D",
      "SUMMARY:Three day span",
      "END:VEVENT",
    ]);
    const { events, warnings } = parseICS(text);
    expect(warnings).toEqual([]);
    expect(events[0]).toMatchObject({ startDate: "2026-03-10", endDate: "2026-03-12" });
  });

  it("DURATION on a date-time event: PT1H stays single-day", () => {
    const text = crlf([
      "BEGIN:VEVENT",
      "DTSTART:20260310T090000",
      "DURATION:PT1H",
      "SUMMARY:One hour",
      "END:VEVENT",
    ]);
    const { events, warnings } = parseICS(text);
    expect(warnings).toEqual([]);
    expect(events[0]).toMatchObject({ startDate: "2026-03-10", endDate: "2026-03-10" });
  });
});

// ---------------------------------------------------------------------------
// Defaults and lenient parsing
// ---------------------------------------------------------------------------

describe("parseICS — defaults and leniency", () => {
  it('missing SUMMARY → "(untitled event)"', () => {
    const text = crlf([
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260310",
      "END:VEVENT",
    ]);
    const { events } = parseICS(text);
    expect(events[0].summary).toBe("(untitled event)");
  });

  it('blank SUMMARY → "(untitled event)"', () => {
    const text = crlf([
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260310",
      "SUMMARY:",
      "END:VEVENT",
    ]);
    const { events } = parseICS(text);
    expect(events[0].summary).toBe("(untitled event)");
  });

  it("event with no DTSTART imports without dates", () => {
    const text = crlf([
      "BEGIN:VEVENT",
      "SUMMARY:Dateless task",
      "END:VEVENT",
    ]);
    const { events, warnings } = parseICS(text);
    expect(warnings).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("Dateless task");
    expect(events[0].startDate).toBeUndefined();
    expect(events[0].endDate).toBeUndefined();
  });

  it("garbage between events is ignored and both events parse", () => {
    const text = crlf([
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260310",
      "SUMMARY:First",
      "END:VEVENT",
      "this line is garbage without a colon",
      "<<<>>> ???",
      "STRAY-PROP:not inside any event",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260311",
      "SUMMARY:Second",
      "END:VEVENT",
      "END:VCALENDAR",
    ]);
    const { events, warnings } = parseICS(text);
    expect(warnings).toEqual([]);
    expect(events.map((e) => e.summary)).toEqual(["First", "Second"]);
  });

  it("parses LF-only files (no CRLF anywhere)", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260310",
      "SUMMARY:Unix line endi",
      " ngs",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");
    const { events, warnings } = parseICS(text);
    expect(warnings).toEqual([]);
    expect(events[0].summary).toBe("Unix line endings");
  });

  it("property names are case-insensitive", () => {
    const text = crlf([
      "begin:vevent",
      "dtstart;value=date:20260310",
      "summary:Lowercase producer",
      "end:vevent",
    ]);
    const { events, warnings } = parseICS(text);
    expect(warnings).toEqual([]);
    expect(events[0]).toMatchObject({
      summary: "Lowercase producer",
      startDate: "2026-03-10",
    });
  });

  it("handles quoted parameter values containing : and ;", () => {
    const text = crlf([
      "BEGIN:VEVENT",
      'DTSTART;X-NOTE="weird:value;here";VALUE=DATE:20260310',
      "SUMMARY:Quoted params",
      "END:VEVENT",
    ]);
    const { events, warnings } = parseICS(text);
    expect(warnings).toEqual([]);
    expect(events[0].startDate).toBe("2026-03-10");
  });

  it("ignores VTODO and VJOURNAL components silently", () => {
    const text = crlf([
      "BEGIN:VCALENDAR",
      "BEGIN:VTODO",
      "SUMMARY:A todo that must not become an event",
      "DUE;VALUE=DATE:20260310",
      "END:VTODO",
      "BEGIN:VJOURNAL",
      "SUMMARY:A journal entry",
      "DTSTART;VALUE=DATE:20260311",
      "END:VJOURNAL",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260312",
      "SUMMARY:The only real event",
      "END:VEVENT",
      "END:VCALENDAR",
    ]);
    const { events, warnings } = parseICS(text);
    expect(warnings).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("The only real event");
  });
});

// ---------------------------------------------------------------------------
// Malformed input: skip + warn, never throw
// ---------------------------------------------------------------------------

describe("parseICS — malformed input", () => {
  it("skips a VEVENT with an invalid DTSTART, warns, and parses the rest", () => {
    const text = crlf([
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "SUMMARY:Bad event",
      "DTSTART:NOTADATE",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "SUMMARY:Good event",
      "DTSTART;VALUE=DATE:20260401",
      "END:VEVENT",
      "END:VCALENDAR",
    ]);
    const { events, warnings } = parseICS(text);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("Good event");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("DTSTART");
    expect(warnings[0]).toContain("Bad event");
  });

  it("skips a VEVENT with an impossible date (Feb 30) and warns", () => {
    const text = crlf([
      "BEGIN:VEVENT",
      "SUMMARY:Impossible",
      "DTSTART;VALUE=DATE:20260230",
      "END:VEVENT",
    ]);
    const { events, warnings } = parseICS(text);
    expect(events).toHaveLength(0);
    expect(warnings.some((w) => w.includes("DTSTART"))).toBe(true);
  });

  it("skips a VEVENT with an invalid DTEND and warns", () => {
    const text = crlf([
      "BEGIN:VEVENT",
      "SUMMARY:Bad end",
      "DTSTART;VALUE=DATE:20260310",
      "DTEND:whenever",
      "END:VEVENT",
    ]);
    const { events, warnings } = parseICS(text);
    expect(events).toHaveLength(0);
    expect(warnings.some((w) => w.includes("DTEND"))).toBe(true);
  });

  it("warns on an unterminated VEVENT at end of file and keeps earlier events", () => {
    const text = crlf([
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20260310",
      "SUMMARY:Complete",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "SUMMARY:Never closed",
      "DTSTART;VALUE=DATE:20260311",
    ]);
    const { events, warnings } = parseICS(text);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("Complete");
    expect(warnings.some((w) => w.includes("END:VEVENT"))).toBe(true);
  });

  it("warns when BEGIN:VEVENT appears before the previous one ended, and parses the new one", () => {
    const text = crlf([
      "BEGIN:VEVENT",
      "SUMMARY:Never closed",
      "DTSTART;VALUE=DATE:20260310",
      "BEGIN:VEVENT",
      "SUMMARY:Properly closed",
      "DTSTART;VALUE=DATE:20260311",
      "END:VEVENT",
    ]);
    const { events, warnings } = parseICS(text);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("Properly closed");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("missing END:VEVENT");
  });

  it("never throws on arbitrary garbage", () => {
    expect(() => parseICS("complete\x00garbage\nnot ics at all")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Empty / event-less files (pinned decision: warning, not silent empty)
// ---------------------------------------------------------------------------

describe("parseICS — empty and event-less files", () => {
  it('empty string → { events: [], warnings: ["File is empty."] }', () => {
    expect(parseICS("")).toEqual({ events: [], warnings: ["File is empty."] });
  });

  it("whitespace-only file is treated as empty", () => {
    expect(parseICS("  \r\n \n\t ")).toEqual({
      events: [],
      warnings: ["File is empty."],
    });
  });

  it("a valid VCALENDAR with zero VEVENTs returns a warning (so the preview can explain the empty result)", () => {
    const text = crlf(["BEGIN:VCALENDAR", "VERSION:2.0", "END:VCALENDAR"]);
    const { events, warnings } = parseICS(text);
    expect(events).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("No events");
  });
});

// ---------------------------------------------------------------------------
// generateICS ↔ parseICS round-trip (plan risk 2)
//
// Pins both sides of the DTEND exclusivity contract to one definition. The
// classic bug is applying the ±1 day in BOTH directions (events shrink on
// every export→import cycle) or NEITHER (events grow). If either module
// drifts, these tests fail with an off-by-one date.
// ---------------------------------------------------------------------------

describe("generateICS → parseICS round-trip", () => {
  const dtstamp = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));

  it("single-day: due X exports DTEND X+1 and imports back as endDate X", () => {
    const event: ICSEvent = {
      uid: "task-1@cadence",
      summary: "Single day task",
      startDate: "2026-03-10",
      endDateExclusive: "2026-03-11", // caller-computed exclusive end (due + 1)
      dtstamp,
    };
    const ics = generateICS({ calendarName: "Cadence", events: [event] });
    // Sanity-check the wire format actually contains the exclusive DTEND...
    expect(ics).toContain("20260311");

    const { events, warnings } = parseICS(ics);
    expect(warnings).toEqual([]);
    expect(events).toHaveLength(1);
    // ...and that the parser reverses it back to the original calendar day.
    expect(events[0]).toMatchObject({
      uid: "task-1@cadence",
      summary: "Single day task",
      startDate: "2026-03-10",
      endDate: "2026-03-10",
    });
  });

  it("multi-day: start A, due B round-trips to startDate A / endDate B", () => {
    const event: ICSEvent = {
      uid: "task-2@cadence",
      summary: "Multi day span",
      startDate: "2026-03-10",
      endDateExclusive: "2026-03-15", // due 2026-03-14 → exclusive end +1
      dtstamp,
    };
    const ics = generateICS({ calendarName: "Cadence", events: [event] });
    const { events, warnings } = parseICS(ics);
    expect(warnings).toEqual([]);
    expect(events[0]).toMatchObject({
      startDate: "2026-03-10",
      endDate: "2026-03-14",
    });
  });

  it("multi-day span crossing a month boundary round-trips exactly", () => {
    const event: ICSEvent = {
      uid: "task-3@cadence",
      summary: "Month crosser",
      startDate: "2026-01-30",
      endDateExclusive: "2026-02-03", // due 2026-02-02
      dtstamp,
    };
    const ics = generateICS({ calendarName: "Cadence", events: [event] });
    const { events } = parseICS(ics);
    expect(events[0]).toMatchObject({
      startDate: "2026-01-30",
      endDate: "2026-02-02",
    });
  });

  it("TEXT escaping round-trips: commas, semicolons, backslashes, newlines", () => {
    const event: ICSEvent = {
      uid: "task-4@cadence",
      summary: "Ship v2, finally; really\\truly",
      description: "Line one\nLine two, with; punctuation",
      startDate: "2026-03-10",
      endDateExclusive: "2026-03-11",
      dtstamp,
    };
    const ics = generateICS({ calendarName: "Cadence", events: [event] });
    const { events, warnings } = parseICS(ics);
    expect(warnings).toEqual([]);
    expect(events[0].summary).toBe("Ship v2, finally; really\\truly");
    expect(events[0].description).toBe("Line one\nLine two, with; punctuation");
  });

  it("a completed task's STATUS line does not disturb parsing", () => {
    const event: ICSEvent = {
      uid: "task-5@cadence",
      summary: "Done task",
      startDate: "2026-03-10",
      endDateExclusive: "2026-03-11",
      dtstamp,
      status: "COMPLETED",
    };
    const ics = generateICS({ calendarName: "Cadence", events: [event] });
    const { events, warnings } = parseICS(ics);
    expect(warnings).toEqual([]);
    expect(events[0]).toMatchObject({
      summary: "Done task",
      startDate: "2026-03-10",
      endDate: "2026-03-10",
    });
  });

  it("folded long summaries from the generator round-trip intact", () => {
    const longSummary =
      "A very long task title that absolutely exceeds the seventy-five octet line limit of RFC 5545 and therefore must be folded by the generator and unfolded by the parser without losing a single character";
    const event: ICSEvent = {
      uid: "task-6@cadence",
      summary: longSummary,
      startDate: "2026-03-10",
      endDateExclusive: "2026-03-11",
      dtstamp,
    };
    const ics = generateICS({ calendarName: "Cadence", events: [event] });
    const { events, warnings } = parseICS(ics);
    expect(warnings).toEqual([]);
    expect(events[0].summary).toBe(longSummary);
  });
});
