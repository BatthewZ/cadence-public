/**
 * RFC 5545 iCalendar (ICS) parser — pure, isomorphic, dependency-free.
 *
 * Powers the one-shot `.ics` import flow: the CLIENT parses the user's file
 * with this module, shows a preview, and then POSTs structured JSON to the
 * import endpoint. Because the file comes straight from end users (Google
 * Calendar exports, Outlook exports, hand-edited files), the parser is
 * deliberately lenient: one malformed VEVENT must never kill the whole
 * import, so bad blocks are SKIPPED and reported via `warnings` instead of
 * thrown.
 *
 * ## Downstream mapping (what consumers do with `ParsedEvent`)
 *
 * The import schema/endpoint — NOT this parser — maps and constrains fields:
 *
 * - `summary`  → task title (capped at 200 chars by the import schema)
 * - `description` → task description (capped at 5000 chars by the schema)
 * - `startDate === endDate` (single-day) → `dueDate` only
 * - `startDate < endDate` (multi-day)    → `startDate` + `dueDate`
 *
 * The parser intentionally does NOT truncate text (separation of concerns:
 * the import schema is the single source of truth for caps, and truncating
 * here would silently hide data from the preview the user approves).
 *
 * ## Date handling: date-only, UTC-safe, lossy by design
 *
 * Cadence tasks are date-only (no times), so DATE-TIME values are TRUNCATED
 * to their literal calendar-date part: `DTSTART;TZID=America/New_York:
 * 20260102T090000` imports as `2026-01-02`. No timezone conversion is
 * performed — the wall-clock date the event's producer wrote is the date the
 * user perceives, and converting through zones could shift it. This is
 * documented lossy behavior (the time of day is discarded).
 *
 * All date arithmetic is done by splitting `Y/M/D` and using `Date.UTC`
 * math. We NEVER do `new Date("YYYY-MM-DD")` followed by local-time
 * accessors: that string parses as UTC midnight, and local getters shift the
 * date by a day for anyone west of UTC — this repo's highest-risk bug class.
 *
 * ## DTEND exclusivity reversal
 *
 * RFC 5545 §3.8.2.2: for all-day (`VALUE=DATE`) events, DTEND is the first
 * day AFTER the event (exclusive). The sibling generator (`ics.ts`) exports
 * a task due 2026-03-10 as `DTEND;VALUE=DATE:20260311`; this parser reverses
 * that: imported `endDate` = DTEND − 1 day for all-day events. DATE-TIME
 * DTENDs are NOT decremented — their literal date part is the end date
 * (a meeting 09:30–10:30 ends the same day it starts). Getting this reversal
 * wrong in either direction is the classic off-by-one that grows or shrinks
 * every imported event by a day, which is why the test suite pins a full
 * `generateICS` → `parseICS` round-trip.
 *
 * ## Robustness rules
 *
 * - CRLF, LF, and lone-CR line endings are all accepted.
 * - Folded lines (CRLF + space/tab continuation, RFC 5545 §3.1) are
 *   unfolded BEFORE any other processing, so a fold may land mid-escape
 *   (`...\` + CRLF + ` ,...`) and still unescape correctly.
 * - Property parameters are stripped via a quote-aware scanner, so
 *   `DTSTART;TZID=America/New_York:20260102T090000` and parameters with
 *   quoted values containing `:` / `;` both parse.
 * - VTODO / VJOURNAL / VTIMEZONE / any non-VEVENT component is ignored
 *   silently — including properties INSIDE them (a VTIMEZONE's nested
 *   `DTSTART:16010101T020000` must never leak into an event), and nested
 *   components inside a VEVENT (VALARM's DESCRIPTION must not override the
 *   event's own DESCRIPTION).
 * - A VEVENT whose date-bearing property (DTSTART/DTEND/DURATION) has an
 *   unparseable value is skipped with a warning; remaining events still
 *   parse. Unterminated VEVENTs are likewise skipped with a warning.
 * - Events missing SUMMARY import as `"(untitled event)"`.
 * - An empty file or a file with zero VEVENTs returns `events: []` plus a
 *   warning (pinned by tests): a zero-event import is almost always user
 *   error, and the preview UI should be able to say why it is empty.
 */

/**
 * One successfully parsed VEVENT, normalized to Cadence's date-only model.
 *
 * When `startDate` is present, `endDate` is always present too and
 * `endDate >= startDate`; single-day events have `startDate === endDate`.
 * Events with no DTSTART import with both dates `undefined` (a task without
 * dates is a valid import target).
 */
export interface ParsedEvent {
  uid?: string;
  summary: string;
  description?: string;
  /** First day of the event, `"YYYY-MM-DD"`. */
  startDate?: string;
  /** Last day of the event (INCLUSIVE — exclusivity already reversed), `"YYYY-MM-DD"`. */
  endDate?: string;
}

/** Result of {@link parseICS}: parsed events plus human-readable warnings for the preview UI. */
export interface ParseICSResult {
  events: ParsedEvent[];
  warnings: string[];
}

/** Fallback title for VEVENTs with no (or blank) SUMMARY. */
const UNTITLED_SUMMARY = "(untitled event)";

const MS_PER_DAY = 86_400_000;

/** A content line split into name / parameters / value (RFC 5545 §3.1). */
interface ContentLine {
  /** Property name, uppercased (names are case-insensitive per §3.1). */
  name: string;
  /** Parameter map, keys uppercased, quoted values unquoted. */
  params: Map<string, string>;
  /** Raw (still-escaped) property value. */
  value: string;
}

/** Properties collected from one VEVENT block before validation. First occurrence wins. */
interface RawEvent {
  /** 1-based position of this VEVENT in the file, used to label warnings. */
  ordinal: number;
  uid?: string;
  summary?: string;
  description?: string;
  dtstart?: ContentLine;
  dtend?: ContentLine;
  duration?: string;
}

/** A parsed DTSTART/DTEND value. */
interface ICSDateValue {
  /** Calendar-date part, `"YYYY-MM-DD"`. For DATE-TIMEs this is the (lossy) truncation. */
  date: string;
  /** True for `VALUE=DATE`-shaped values (`YYYYMMDD`), false for DATE-TIMEs. */
  dateOnly: boolean;
  /**
   * UTC timestamp of the value (midnight for date-only values, the literal
   * wall-clock time treated as UTC for date-times). Only ever used for
   * DURATION arithmetic, where the zone cancels out.
   */
  ts: number;
}

/**
 * Splits raw ICS text into unfolded logical lines.
 *
 * Folding (RFC 5545 §3.1) breaks long lines with CRLF + a single space or
 * tab; unfolding removes the break AND exactly one whitespace character.
 * This must happen before any escaping/parsing because producers may fold at
 * ANY octet boundary — including between the `\` and `,` of an escape
 * sequence — and only the rejoined line is meaningful.
 */
function unfoldLines(text: string): string[] {
  const raw = text.split(/\r\n|\n|\r/);
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/**
 * Reverses RFC 5545 §3.3.11 TEXT escaping: `\\`→`\`, `\;`→`;`, `\,`→`,`,
 * `\n`/`\N`→newline. Done in a single regex pass so an unescaped result can
 * never be re-interpreted as another escape (the mirror-image of why the
 * generator must escape backslashes FIRST).
 */
function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, ch: string) =>
    ch === "n" || ch === "N" ? "\n" : ch,
  );
}

/**
 * Parses one logical line into name / params / value.
 *
 * The `:` separating params from the value — and the `;` separating params —
 * must be found with a quote-aware scan: parameter values may be quoted and
 * contain both characters (e.g. `ALTREP="http://example.com/a:b"`). Returns
 * null for lines that are not content lines (garbage tolerance: such lines
 * are simply ignored by the caller).
 */
function parseContentLine(line: string): ContentLine | null {
  let inQuotes = false;
  let sep = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ":" && !inQuotes) {
      sep = i;
      break;
    }
  }
  if (sep <= 0) return null;

  const head = line.slice(0, sep);
  const value = line.slice(sep + 1);

  const segments: string[] = [];
  let current = "";
  inQuotes = false;
  for (const ch of head) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === ";" && !inQuotes) {
      segments.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  segments.push(current);

  const name = segments[0].trim().toUpperCase();
  if (name === "") return null;

  const params = new Map<string, string>();
  for (const segment of segments.slice(1)) {
    const eq = segment.indexOf("=");
    if (eq === -1) continue;
    const key = segment.slice(0, eq).trim().toUpperCase();
    let val = segment.slice(eq + 1).trim();
    if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    }
    if (key !== "") params.set(key, val);
  }

  return { name, params, value };
}

/**
 * Builds a UTC timestamp from date parts without `new Date(string)` parsing.
 *
 * Uses `setUTCFullYear` rather than `Date.UTC(y, ...)` because `Date.UTC`
 * maps two-digit years 0–99 to 1900–1999 — a file containing year `0099`
 * would otherwise silently become 1999. Out-of-range month/day overflow is
 * normalized by the Date API and rejected by the caller's round-trip check.
 */
function utcTimestamp(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  const date = new Date(0);
  date.setUTCFullYear(y, mo - 1, d);
  date.setUTCHours(h, mi, s, 0);
  return date.getTime();
}

/** Formats a UTC timestamp as `"YYYY-MM-DD"` (UTC accessors only — never local). */
function utcDateString(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * Adds `days` (may be negative) to a `"YYYY-MM-DD"` string via UTC math.
 * This is the function that performs the DTEND −1 exclusivity reversal, so
 * it must be immune to local-timezone drift and to month/year boundaries.
 */
function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return utcDateString(utcTimestamp(y, m, d + days));
}

const DATE_ONLY_RE = /^(\d{4})(\d{2})(\d{2})$/;
const DATE_TIME_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/;

/**
 * Parses a DTSTART/DTEND value in RFC 5545 basic DATE (`20260102`) or
 * DATE-TIME (`20260102T090000`, optional `Z`) form. Detection is shape-based
 * rather than `VALUE=DATE`-parameter-based so that producers that omit the
 * parameter on bare dates still parse correctly; TZID parameters are ignored
 * (see module JSDoc — the literal wall-clock date is what we keep).
 *
 * Returns null for malformed values, including impossible dates like
 * `20260230` (caught by round-tripping the parts through UTC Date math and
 * checking nothing was normalized away).
 */
function parseICSDateValue(rawValue: string): ICSDateValue | null {
  const value = rawValue.trim();

  let y: number;
  let mo: number;
  let d: number;
  let h = 0;
  let mi = 0;
  let s = 0;
  let dateOnly: boolean;

  const dateMatch = DATE_ONLY_RE.exec(value);
  if (dateMatch) {
    [y, mo, d] = [Number(dateMatch[1]), Number(dateMatch[2]), Number(dateMatch[3])];
    dateOnly = true;
  } else {
    const dtMatch = DATE_TIME_RE.exec(value);
    if (!dtMatch) return null;
    [y, mo, d, h, mi, s] = [
      Number(dtMatch[1]),
      Number(dtMatch[2]),
      Number(dtMatch[3]),
      Number(dtMatch[4]),
      Number(dtMatch[5]),
      Number(dtMatch[6]),
    ];
    if (h > 23 || mi > 59 || s > 60) return null;
    if (s === 60) s = 59; // leap second: clamp; sub-minute precision is irrelevant to dates
    dateOnly = false;
  }

  const ts = utcTimestamp(y, mo, d, h, mi, s);
  const check = new Date(ts);
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d
  ) {
    return null; // impossible date (e.g. month 13, Feb 30) was normalized away
  }

  return { date: utcDateString(ts), dateOnly, ts };
}

const DURATION_RE = /^\+?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/**
 * Parses an RFC 5545 §3.3.6 DURATION (`P2W`, `P1D`, `PT1H30M`, `P1DT12H`)
 * into milliseconds. Negative durations and durations with no components at
 * all (`P`, `PT`) return null — a backwards event span is malformed input,
 * not something to silently "fix".
 */
function parseDurationMs(rawValue: string): number | null {
  const match = DURATION_RE.exec(rawValue.trim());
  if (!match) return null;
  const [, w, d, h, mi, s] = match;
  if (
    w === undefined &&
    d === undefined &&
    h === undefined &&
    mi === undefined &&
    s === undefined
  ) {
    return null;
  }
  return (
    (Number(w ?? 0) * 7 + Number(d ?? 0)) * MS_PER_DAY +
    Number(h ?? 0) * 3_600_000 +
    Number(mi ?? 0) * 60_000 +
    Number(s ?? 0) * 1_000
  );
}

/** Records a property line into the raw event. First occurrence wins (RFC: at most one each). */
function recordProperty(event: RawEvent, line: ContentLine): void {
  switch (line.name) {
    case "UID":
      if (event.uid === undefined) event.uid = line.value;
      break;
    case "SUMMARY":
      if (event.summary === undefined) event.summary = line.value;
      break;
    case "DESCRIPTION":
      if (event.description === undefined) event.description = line.value;
      break;
    case "DTSTART":
      if (event.dtstart === undefined) event.dtstart = line;
      break;
    case "DTEND":
      if (event.dtend === undefined) event.dtend = line;
      break;
    case "DURATION":
      if (event.duration === undefined) event.duration = line.value;
      break;
    default:
      break; // everything else (DTSTAMP, STATUS, URL, X-props, ...) is irrelevant to import
  }
}

/**
 * Validates a collected VEVENT and appends it to `events`, or appends a
 * warning explaining why it was skipped. Skipping (rather than throwing) is
 * the core robustness contract: one bad block must never kill the import.
 */
function finalizeEvent(raw: RawEvent, events: ParsedEvent[], warnings: string[]): void {
  const summaryText =
    raw.summary !== undefined ? unescapeText(raw.summary).trim() : "";
  const summary = summaryText === "" ? UNTITLED_SUMMARY : summaryText;
  const label =
    summaryText === ""
      ? `VEVENT #${raw.ordinal}`
      : `VEVENT #${raw.ordinal} ("${summaryText}")`;

  const descriptionText =
    raw.description !== undefined ? unescapeText(raw.description).trim() : "";
  const description = descriptionText === "" ? undefined : descriptionText;

  const uidText = raw.uid !== undefined ? unescapeText(raw.uid).trim() : "";
  const uid = uidText === "" ? undefined : uidText;

  if (raw.dtstart === undefined) {
    // A task without dates is a valid import target; DTEND without DTSTART
    // is meaningless on its own, so it is dropped with a warning.
    if (raw.dtend !== undefined || raw.duration !== undefined) {
      warnings.push(
        `${label}: has DTEND/DURATION but no DTSTART; imported without dates`,
      );
    }
    events.push({ uid, summary, description });
    return;
  }

  const start = parseICSDateValue(raw.dtstart.value);
  if (start === null) {
    warnings.push(
      `${label} skipped: invalid DTSTART value "${raw.dtstart.value.trim()}"`,
    );
    return;
  }

  let endDate: string;
  if (raw.dtend !== undefined) {
    const end = parseICSDateValue(raw.dtend.value);
    if (end === null) {
      warnings.push(
        `${label} skipped: invalid DTEND value "${raw.dtend.value.trim()}"`,
      );
      return;
    }
    // DTEND exclusivity reversal: all-day DTEND is the first day AFTER the
    // event, so the inclusive end is DTEND − 1 day. DATE-TIME DTENDs are an
    // instant ON the last day, so their literal date part IS the end date.
    endDate = end.dateOnly ? addDays(end.date, -1) : end.date;
  } else if (raw.duration !== undefined) {
    const durationMs = parseDurationMs(raw.duration);
    if (durationMs === null) {
      warnings.push(
        `${label} skipped: invalid DURATION value "${raw.duration.trim()}"`,
      );
      return;
    }
    if (start.dateOnly) {
      // start + duration is the EXCLUSIVE end instant (like DTEND); the last
      // included day is 1ms before it. P1D from 2026-03-10 → 2026-03-10.
      endDate =
        durationMs <= 0 ? start.date : utcDateString(start.ts + durationMs - 1);
    } else {
      // Mirrors the DATE-TIME DTEND rule: the end instant's date part.
      endDate = utcDateString(start.ts + durationMs);
    }
  } else {
    // DTSTART-only event: single day.
    endDate = start.date;
  }

  // Producers occasionally emit DTEND == DTSTART for all-day events (invalid
  // per RFC — DTEND must be later); after the −1 reversal that would yield
  // endDate < startDate. Clamp to a single-day event rather than skip or
  // emit a backwards range (lexicographic compare is safe on ISO dates).
  if (endDate < start.date) endDate = start.date;

  events.push({ uid, summary, description, startDate: start.date, endDate });
}

/**
 * Parses iCalendar text into date-only events plus warnings.
 *
 * Never throws on malformed input: every failure mode (bad dates,
 * unterminated blocks, empty files) degrades to a warning so the import
 * preview can show the user exactly what was salvaged and what was not.
 * See the module JSDoc for the full set of robustness and date-handling
 * contracts; the test suite pins each one, including a full
 * `generateICS` → `parseICS` round-trip against the sibling generator.
 */
export function parseICS(text: string): ParseICSResult {
  const events: ParsedEvent[] = [];
  const warnings: string[] = [];

  if (text.trim() === "") {
    return { events, warnings: ["File is empty."] };
  }

  let current: RawEvent | null = null;
  /** Depth of non-VEVENT components opened INSIDE the current VEVENT (e.g. VALARM). */
  let nestedDepth = 0;
  let ordinal = 0;
  let sawVevent = false;

  for (const line of unfoldLines(text)) {
    if (line === "") continue;
    const parsed = parseContentLine(line);
    if (parsed === null) continue; // garbage tolerance: non-content lines are ignored

    if (parsed.name === "BEGIN") {
      const component = parsed.value.trim().toUpperCase();
      if (component === "VEVENT") {
        if (current !== null) {
          warnings.push(
            `VEVENT #${current.ordinal} skipped: missing END:VEVENT before next BEGIN:VEVENT`,
          );
        }
        ordinal += 1;
        sawVevent = true;
        current = { ordinal };
        nestedDepth = 0;
      } else if (current !== null) {
        nestedDepth += 1; // nested component (VALARM, ...) — its properties must not leak
      }
      continue;
    }

    if (parsed.name === "END") {
      const component = parsed.value.trim().toUpperCase();
      if (component === "VEVENT") {
        // Lenient: an unterminated nested component does not invalidate the event.
        if (current !== null) {
          finalizeEvent(current, events, warnings);
          current = null;
          nestedDepth = 0;
        }
      } else if (current !== null && nestedDepth > 0) {
        nestedDepth -= 1;
      }
      continue;
    }

    // Only collect properties that belong DIRECTLY to a VEVENT. Properties of
    // nested components (VALARM's DESCRIPTION) and of non-VEVENT components
    // (VTIMEZONE's DTSTART, VTODO's SUMMARY) are ignored here by construction.
    if (current !== null && nestedDepth === 0) {
      recordProperty(current, parsed);
    }
  }

  if (current !== null) {
    warnings.push(
      `VEVENT #${current.ordinal} skipped: missing END:VEVENT (file ended)`,
    );
  }

  if (!sawVevent) {
    warnings.push("No events (VEVENT components) found in file.");
  }

  return { events, warnings };
}
