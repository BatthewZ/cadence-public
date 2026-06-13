/**
 * Tests for the client-side project calendar export.
 *
 * Why these matter: the export shares its generator (and these tests share a
 * parser) with the subscription feed, so a regression here usually means a
 * malformed calendar that desktop clients reject WHOLESALE — and the date
 * mapping (`.slice(0, 10)` + exclusive DTEND = due + 1 day) is exactly the
 * UTC off-by-one bug class this repo treats as highest-risk. The round-trip
 * suite pins generator and parser against each other: if either side's
 * exclusivity handling drifts by a day, the inclusive dates stop matching.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseICS } from "@/shared/lib/ics-parse";

import {
  buildProjectICS,
  downloadProjectICS,
  type ExportableTask,
  icsFileName,
  projectTasksToICSEvents,
} from "./export-ics";

const DTSTAMP = new Date("2026-06-12T08:00:00.000Z");

function makeTask(overrides: Partial<ExportableTask> & { id: string }): ExportableTask {
  return {
    title: "Task",
    completed: false,
    ...overrides,
  };
}

describe("projectTasksToICSEvents", () => {
  it("maps a multi-day span: DTSTART = start day, exclusive DTEND = due + 1 day", () => {
    const events = projectTasksToICSEvents(
      [
        makeTask({
          id: "t1",
          title: "Span task",
          startDate: "2026-03-10T00:00:00.000Z",
          dueDate: "2026-03-12T00:00:00.000Z",
        }),
      ],
      DTSTAMP,
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      uid: "task-t1@cadence",
      summary: "Span task",
      startDate: "2026-03-10",
      endDateExclusive: "2026-03-13",
    });
  });

  it("maps a single-day task (due only): one day, DTEND = due + 1", () => {
    const events = projectTasksToICSEvents(
      [makeTask({ id: "t2", dueDate: "2026-03-10T00:00:00.000Z" })],
      DTSTAMP,
    );

    expect(events[0].startDate).toBe("2026-03-10");
    expect(events[0].endDateExclusive).toBe("2026-03-11");
  });

  it("maps a start-only task (no due date) to a single all-day event on the start day", () => {
    // A task that begins on a day with no deadline is still scheduled work, so
    // it lands on the calendar on its start date rather than being dropped.
    const events = projectTasksToICSEvents(
      [makeTask({ id: "t-start-only", startDate: "2026-03-10T00:00:00.000Z", dueDate: null })],
      DTSTAMP,
    );

    expect(events).toHaveLength(1);
    expect(events[0].startDate).toBe("2026-03-10");
    expect(events[0].endDateExclusive).toBe("2026-03-11");
  });

  it("crosses month and year boundaries with UTC math (Dec 31 due → Jan 1 DTEND)", () => {
    const events = projectTasksToICSEvents(
      [
        makeTask({ id: "t3", dueDate: "2026-01-31T00:00:00.000Z" }),
        makeTask({ id: "t4", dueDate: "2026-12-31T00:00:00.000Z" }),
      ],
      DTSTAMP,
    );

    expect(events[0].endDateExclusive).toBe("2026-02-01");
    expect(events[1].endDateExclusive).toBe("2027-01-01");
  });

  it("skips date-less tasks entirely (no day to place an all-day event on)", () => {
    const events = projectTasksToICSEvents(
      [
        makeTask({ id: "t5", title: "No dates" }),
        makeTask({ id: "t6", title: "Dated", dueDate: "2026-03-10T00:00:00.000Z" }),
      ],
      DTSTAMP,
    );

    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe("task-t6@cadence");
  });

  it("clamps a start date at/after the due date to a single-day event (defensive, mirrors the feed)", () => {
    const events = projectTasksToICSEvents(
      [
        makeTask({
          id: "t7",
          startDate: "2026-03-15T00:00:00.000Z",
          dueDate: "2026-03-10T00:00:00.000Z",
        }),
      ],
      DTSTAMP,
    );

    expect(events[0].startDate).toBe("2026-03-10");
    expect(events[0].endDateExclusive).toBe("2026-03-11");
  });

  it("includes descriptions (explicit local download — unlike the subscription feed) and STATUS for completed tasks", () => {
    const events = projectTasksToICSEvents(
      [
        makeTask({
          id: "t8",
          description: "Full details here",
          dueDate: "2026-03-10T00:00:00.000Z",
          completed: true,
        }),
        makeTask({ id: "t9", dueDate: "2026-03-10T00:00:00.000Z" }),
      ],
      DTSTAMP,
    );

    expect(events[0].description).toBe("Full details here");
    expect(events[0].status).toBe("COMPLETED");
    expect(events[1].description).toBeUndefined();
    expect(events[1].status).toBeUndefined();
  });
});

describe("buildProjectICS round-trip through the shared parser", () => {
  it("re-imports with the same inclusive dates, titles, descriptions, and UIDs", () => {
    const ics = buildProjectICS(
      "Roadmap",
      [
        makeTask({
          id: "t1",
          title: "Span task",
          description: "Body, with; specials\nand a newline",
          startDate: "2026-03-10T00:00:00.000Z",
          dueDate: "2026-03-12T00:00:00.000Z",
        }),
        makeTask({ id: "t2", title: "Single day", dueDate: "2026-04-01T00:00:00.000Z" }),
        makeTask({ id: "t3", title: "Date-less — skipped" }),
      ],
      DTSTAMP,
    );

    const { events, warnings } = parseICS(ics);

    expect(warnings).toHaveLength(0);
    expect(events).toHaveLength(2);

    // The parser reverses the generator's exclusive DTEND, so inclusive
    // bounds must come back EXACTLY — any drift is the classic ±1-day bug.
    expect(events[0]).toEqual({
      uid: "task-t1@cadence",
      summary: "Span task",
      description: "Body, with; specials\nand a newline",
      startDate: "2026-03-10",
      endDate: "2026-03-12",
    });
    expect(events[1]).toEqual({
      uid: "task-t2@cadence",
      summary: "Single day",
      startDate: "2026-04-01",
      endDate: "2026-04-01",
    });
  });

  it("produces a valid, importable calendar even when no task has dates", () => {
    const ics = buildProjectICS("Empty", [makeTask({ id: "t1" })], DTSTAMP);

    expect(ics).toContain("BEGIN:VCALENDAR");
    const { events } = parseICS(ics);
    expect(events).toHaveLength(0);
  });
});

describe("icsFileName", () => {
  it("appends .ics to the project name", () => {
    expect(icsFileName("Roadmap")).toBe("Roadmap.ics");
  });

  it("strips filesystem-hostile characters and collapses whitespace", () => {
    expect(icsFileName('Q3 / Launch: "Phase <2>"?')).toBe("Q3 Launch Phase 2.ics");
    expect(icsFileName("a\\b|c*d")).toBe("a b c d.ics");
  });

  it("falls back to calendar.ics when nothing printable remains", () => {
    expect(icsFileName("///")).toBe("calendar.ics");
    expect(icsFileName("   ")).toBe("calendar.ics");
  });
});

describe("downloadProjectICS", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubDownloadApis() {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:cadence-test");
    const revokeObjectURL = vi.fn<(url: string) => void>();
    // jsdom has no object-URL implementation; define them on the URL global.
    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectURL,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: revokeObjectURL,
      writable: true,
      configurable: true,
    });
    // Block jsdom's "not implemented: navigation" on anchor click.
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    return { createObjectURL, revokeObjectURL, click };
  }

  it("downloads <project-name>.ics with text/calendar content and returns the event count", async () => {
    const { createObjectURL, revokeObjectURL, click } = stubDownloadApis();
    let downloadName = "";
    click.mockImplementation(function (this: HTMLAnchorElement) {
      downloadName = this.download;
    });

    const exported = downloadProjectICS("My Project", [
      makeTask({ id: "t1", dueDate: "2026-03-10T00:00:00.000Z" }),
      makeTask({ id: "t2", title: "No dates" }),
    ]);

    expect(exported).toBe(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(downloadName).toBe("My Project.ics");

    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("text/calendar;charset=utf-8");
    const text = await blob.text();
    expect(text).toContain("BEGIN:VCALENDAR");
    expect(text).toContain("UID:task-t1@cadence");

    // The object URL must be released — exports can be re-triggered freely.
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:cadence-test");
  });

  it("returns 0 and triggers no download when no task has dates", () => {
    const { createObjectURL, click } = stubDownloadApis();

    const exported = downloadProjectICS("My Project", [
      makeTask({ id: "t1", title: "No dates" }),
    ]);

    expect(exported).toBe(0);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });
});
