/**
 * RFC 5545 iCalendar (ICS) generator — pure, isomorphic, dependency-free.
 *
 * Used by the Worker-side personal ICS subscription feed and the browser-side
 * one-off project export, so it must run identically in both runtimes (no IO,
 * no React, no Node APIs beyond the universal `TextEncoder`).
 *
 * ## Timezone strategy: floating all-day dates only
 *
 * Every event is emitted as an all-day `VALUE=DATE` event
 * (`DTSTART;VALUE=DATE:YYYYMMDD`). Per RFC 5545 §3.3.4, DATE values carry no
 * time and no zone — calendar clients render them on that calendar day in the
 * viewer's local timezone ("floating"). This is the ENTIRE timezone strategy:
 * we never emit a DTSTART with a time component, so there is no VTIMEZONE
 * block, no UTC conversion, and no possibility of an event drifting to the
 * previous/next day for users in other timezones.
 *
 * For the same reason, `YYYY-MM-DD` inputs are converted to `YYYYMMDD` by
 * string slicing ONLY — never via `new Date(str)` round-trips. `new
 * Date("2026-03-10")` parses as UTC midnight, and re-formatting that instant
 * with local-time getters shifts the date by a day for anyone west of UTC.
 * That UTC off-by-one is this repo's highest-risk bug class; pure string
 * manipulation makes it structurally impossible here.
 *
 * ## UID stability
 *
 * The caller supplies each event's UID (e.g. `task-<id>@cadence`). UIDs must
 * be STABLE across feed fetches: subscription clients (Google Calendar, Apple
 * Calendar, etc.) match events by UID, so a stable UID makes a changed task
 * UPDATE the existing calendar entry in place, while a UID that changes
 * between fetches duplicates every event on every refresh.
 *
 * ## DTEND exclusivity
 *
 * RFC 5545 §3.8.2.2: for `VALUE=DATE` events, DTEND is the first day AFTER
 * the event (exclusive). A single-day event on 2026-03-10 has
 * DTSTART=20260310 and DTEND=20260311. The caller passes
 * `endDateExclusive` pre-computed; this module writes it verbatim and never
 * does the +1-day math itself, keeping exactly one source of truth for that
 * calculation.
 *
 * ## Line folding (octets, not characters)
 *
 * RFC 5545 §3.1 limits content lines to 75 OCTETS (excluding CRLF), not 75
 * characters. Lengths are therefore measured in UTF-8 bytes via
 * `TextEncoder` — a CJK character is 3 octets and an emoji 4, so a
 * 30-character emoji summary already needs folding. Folds insert
 * CRLF + a single space; the continuation's leading space counts toward its
 * own 75-octet budget, so continuation content is capped at 74 octets.
 * Splitting happens at code-point boundaries only (`for…of` iterates code
 * points, not UTF-16 units), so a multi-byte UTF-8 sequence or surrogate
 * pair is never broken mid-sequence.
 */

/** Shared encoder for all octet-length measurements (RFC 5545 counts UTF-8 octets). */
const textEncoder = new TextEncoder();

/** RFC 5545 §3.1: content lines SHOULD NOT be longer than 75 octets, excluding CRLF. */
const MAX_LINE_OCTETS = 75;

/** Strict `YYYY-MM-DD` shape required for `startDate` / `endDateExclusive`. */
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A single all-day calendar event.
 *
 * All events are emitted as floating `VALUE=DATE` all-day events — see the
 * module JSDoc for the timezone strategy, UID stability, and DTEND
 * exclusivity contracts.
 */
export interface ICSEvent {
  /**
   * Globally unique, STABLE identifier, e.g. `task-<id>@cadence`.
   * Stability across fetches is what lets subscribed calendar clients UPDATE
   * an existing entry instead of duplicating it on every refresh.
   */
  uid: string;
  /** Event title → `SUMMARY` (TEXT-escaped). */
  summary: string;
  /** Optional body → `DESCRIPTION` (TEXT-escaped). Omitted when absent/empty. */
  description?: string;
  /**
   * Optional link back to the task/project → `URL`. Emitted verbatim:
   * RFC 5545 §3.8.4.6 types URL as a URI value, which does not take TEXT
   * backslash-escaping (escaping it would corrupt the link in strict
   * parsers). Omitted when absent/empty.
   */
  url?: string;
  /** First day of the event, `"YYYY-MM-DD"` → `DTSTART;VALUE=DATE`. */
  startDate: string;
  /**
   * First day AFTER the event, `"YYYY-MM-DD"` → `DTEND;VALUE=DATE`.
   * Already exclusive per RFC 5545 — the caller computes it; this module
   * passes it through verbatim (single source of truth for the +1-day math).
   */
  endDateExclusive: string;
  /** Generation timestamp → `DTSTAMP` in UTC basic format (`20260611T120000Z`). */
  dtstamp: Date;
  /** When `"COMPLETED"`, emits `STATUS:COMPLETED`; otherwise no STATUS line. */
  status?: "COMPLETED";
}

/**
 * Escapes a value for an RFC 5545 §3.3.11 TEXT property.
 *
 * Backslash MUST be escaped first (otherwise the backslashes introduced for
 * `;` and `,` would themselves be re-escaped). Newlines of any flavor
 * (CRLF, CR, LF) become the literal two-character sequence `\n` so that the
 * value can never inject a raw line break — a raw newline inside SUMMARY
 * would otherwise terminate the content line and corrupt the calendar.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Converts `"YYYY-MM-DD"` to RFC 5545 basic DATE format `YYYYMMDD` by string
 * slicing only. Deliberately never constructs a `Date` from the string —
 * `new Date("YYYY-MM-DD")` is parsed as UTC midnight and round-tripping it
 * through date getters is exactly the UTC off-by-one bug this module is
 * designed to make impossible (see module JSDoc).
 *
 * Throws on malformed input rather than emitting a silently broken calendar:
 * an invalid DATE value makes some clients reject the entire feed.
 */
function toBasicDate(isoDate: string, field: string): string {
  if (!DATE_ONLY_PATTERN.test(isoDate)) {
    throw new Error(`Invalid ${field}: expected "YYYY-MM-DD", got "${isoDate}"`);
  }
  return isoDate.slice(0, 4) + isoDate.slice(5, 7) + isoDate.slice(8, 10);
}

/**
 * Formats a `Date` as RFC 5545 UTC basic DATE-TIME, e.g. `20260611T120000Z`.
 * Always UTC (`Z` suffix) — DTSTAMP is metadata about when the feed was
 * generated, not an event time, so unlike DTSTART it is safe (and required
 * by RFC 5545 §3.8.7.2) to pin it to UTC.
 */
function formatDtStampUtc(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    String(date.getUTCFullYear()).padStart(4, "0") +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

/**
 * Folds one logical content line into physical lines of at most 75 octets
 * each, per RFC 5545 §3.1.
 *
 * Subtleties this encodes (and the tests pin down):
 * - The limit is 75 UTF-8 OCTETS, not 75 characters — measured with
 *   `TextEncoder`, so multi-byte characters consume 2–4 octets each.
 * - Continuation lines begin with a single space that counts toward their
 *   own 75-octet budget, so continuation CONTENT is capped at 74 octets.
 * - Iteration is by code point (`for…of`), never by UTF-16 code unit, so a
 *   fold can never split a surrogate pair / multi-byte UTF-8 sequence —
 *   doing so would emit U+FFFD garbage once encoded.
 * - A line of exactly 75 octets is NOT folded (the limit is inclusive).
 *
 * Unfolding (CRLF + space → nothing) restores the logical line byte-for-byte.
 */
function foldLine(line: string): string[] {
  if (textEncoder.encode(line).length <= MAX_LINE_OCTETS) {
    return [line];
  }

  const physicalLines: string[] = [];
  let current = "";
  let currentOctets = 0;
  let isContinuation = false;

  for (const codePoint of line) {
    const codePointOctets = textEncoder.encode(codePoint).length;
    // Continuation lines spend 1 of their 75 octets on the leading space.
    const contentBudget = isContinuation ? MAX_LINE_OCTETS - 1 : MAX_LINE_OCTETS;
    if (currentOctets + codePointOctets > contentBudget) {
      physicalLines.push(isContinuation ? ` ${current}` : current);
      current = codePoint;
      currentOctets = codePointOctets;
      isContinuation = true;
    } else {
      current += codePoint;
      currentOctets += codePointOctets;
    }
  }
  physicalLines.push(isContinuation ? ` ${current}` : current);

  return physicalLines;
}

/**
 * Generates a complete RFC 5545 VCALENDAR document.
 *
 * Output guarantees (each one backed by a test, because calendar clients are
 * unforgiving parsers and a single malformed line can reject the whole feed):
 * - CRLF (`\r\n`) line terminators throughout, including a trailing CRLF;
 * - every physical line ≤ 75 octets (folded with CRLF + single space, never
 *   splitting a multi-byte character);
 * - TEXT values (calendar name, UID, SUMMARY, DESCRIPTION) escaped per
 *   §3.3.11; URL emitted verbatim (URI value type — see {@link ICSEvent.url});
 * - byte-identical output for identical input — combined with caller-stable
 *   UIDs this is what lets subscription clients update events in place
 *   instead of duplicating them;
 * - an empty event list still yields a valid, importable VCALENDAR.
 */
export function generateICS(opts: { calendarName: string; events: ICSEvent[] }): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Cadence//Cadence//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.calendarName)}`,
  ];

  for (const event of opts.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeText(event.uid)}`,
      `DTSTAMP:${formatDtStampUtc(event.dtstamp)}`,
      `DTSTART;VALUE=DATE:${toBasicDate(event.startDate, "startDate")}`,
      `DTEND;VALUE=DATE:${toBasicDate(event.endDateExclusive, "endDateExclusive")}`,
      `SUMMARY:${escapeText(event.summary)}`,
    );
    if (event.description) {
      lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    }
    if (event.url) {
      lines.push(`URL:${event.url}`);
    }
    if (event.status === "COMPLETED") {
      lines.push("STATUS:COMPLETED");
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  return `${lines.flatMap(foldLine).join("\r\n")}\r\n`;
}
