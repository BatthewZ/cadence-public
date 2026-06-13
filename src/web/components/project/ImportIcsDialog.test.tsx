/**
 * Component tests for the .ics import dialog.
 *
 * Why these matter: this dialog is the ONLY place the client-side parse →
 * preview → POST mapping is wired together, and the mapping carries the
 * date-model contract the import schema enforces server-side — single-day
 * events must send `dueDate` ONLY (startDate exists solely to open a range),
 * multi-day events send both inclusive bounds, and the ICS `UID` becomes
 * `sourceUid` (the re-import dedupe key). A drift here would either 400 the
 * whole batch or quietly import every event a day long/short. The 500-item
 * cap test pins the client-side mirror of `importTasksSchema.max(500)`:
 * without it the endpoint rejects the entire request instead of truncating.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { TaskGroup } from "@/web/contexts/ProjectContext";

// ---------------------------------------------------------------------------
// Mocks — declared before the dynamic import of the component under test
// ---------------------------------------------------------------------------

const mockToast = vi.fn();

vi.mock("@/web/components/ui/ToastContext", () => ({
  useToast: () => ({ toast: mockToast, dismiss: vi.fn(), dismissAll: vi.fn() }),
}));

const mockRefetchTasks = vi.fn();

/**
 * Deliberately OUT of position order: the dialog must default its group
 * select to the first group by fractional-index position (the left-most
 * board column), not to array order.
 */
let mockTaskGroups: TaskGroup[] = [];

vi.mock("@/web/contexts/ProjectContext", () => ({
  useProject: () => ({
    project: { id: "proj-1", name: "Test Project", status: "active", workspaceId: "ws-1" },
    members: [],
    taskGroups: mockTaskGroups,
    tasks: [],
    tasksError: null,
    taskGroupsError: null,
    refetchTasks: mockRefetchTasks,
    refetchTaskGroups: vi.fn(),
    refetch: vi.fn(),
    updateProject: vi.fn(),
    updateTask: vi.fn(),
    removeTask: vi.fn(),
    addTask: vi.fn(),
    updateTaskGroup: vi.fn(),
    removeTaskGroup: vi.fn(),
    addTaskGroup: vi.fn(),
  }),
}));

vi.mock("@/web/lib/api/client", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return {
    ApiError,
    api: Object.assign(vi.fn(), {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    }),
  };
});

import { api, ApiError } from "@/web/lib/api/client";

const mockPost = api.post as Mock<(path: string, body: unknown) => Promise<unknown>>;

// ---------------------------------------------------------------------------
// jsdom polyfill: HTMLDialogElement.showModal / close (same as Dialog tests)
// ---------------------------------------------------------------------------

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
});

// ---------------------------------------------------------------------------
// Dynamic import so mocks are established first
// ---------------------------------------------------------------------------

const { ImportIcsDialog, MAX_IMPORT_FILE_BYTES } = await import("./ImportIcsDialog");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeGroup(overrides: Partial<TaskGroup> & { id: string; position: string }): TaskGroup {
  return { name: overrides.id, isCompletionGroup: false, ...overrides };
}

function makeIcs(body: string): string {
  return `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Test//EN\n${body}END:VCALENDAR\n`;
}

/**
 * One single-day event (with UID), one multi-day span (no UID, with
 * description), one date-less event (with UID) — together they cover every
 * branch of the event → import-item mapping.
 */
const SAMPLE_ICS = makeIcs(
  [
    "BEGIN:VEVENT",
    "UID:evt-single@example.com",
    "DTSTAMP:20260601T000000Z",
    "DTSTART;VALUE=DATE:20260310",
    "DTEND;VALUE=DATE:20260311",
    "SUMMARY:Single day event",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTAMP:20260601T000000Z",
    "DTSTART;VALUE=DATE:20260310",
    "DTEND;VALUE=DATE:20260313",
    "SUMMARY:Multi day event",
    "DESCRIPTION:Across three days",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:evt-undated@example.com",
    "DTSTAMP:20260601T000000Z",
    "SUMMARY:Undated event",
    "END:VEVENT",
    "",
  ].join("\n"),
);

/** SAMPLE_ICS plus one VEVENT with an impossible DTSTART → 1 parser warning. */
const ICS_WITH_BROKEN_EVENT = makeIcs(
  [
    "BEGIN:VEVENT",
    "UID:evt-ok@example.com",
    "DTSTART;VALUE=DATE:20260310",
    "DTEND;VALUE=DATE:20260311",
    "SUMMARY:Good event",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART;VALUE=DATE:20269999",
    "SUMMARY:Broken event",
    "END:VEVENT",
    "",
  ].join("\n"),
);

function icsFile(content: string, name = "calendar.ics"): File {
  return new File([content], name, { type: "text/calendar" });
}

/**
 * Selects a file through the hidden input with `fireEvent.change` rather
 * than `userEvent.upload`: upload() clicks the input, the click bubbles to
 * FileUpload's wrapper (whose onClick re-clicks the input), and jsdom has no
 * user-activation gate to break that recursion.
 */
function selectFile(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

function renderDialog(onClose = vi.fn()) {
  render(<ImportIcsDialog open onClose={onClose} />);
  return onClose;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTaskGroups = [
    makeGroup({ id: "g-done", name: "Done", position: "a2", isCompletionGroup: true }),
    makeGroup({ id: "g-todo", name: "To Do", position: "a0" }),
    makeGroup({ id: "g-doing", name: "Doing", position: "a1" }),
  ];
  mockPost.mockResolvedValue({ created: 3, skipped: 0, total: 3 });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ImportIcsDialog", () => {
  it("previews a valid file: count, rows with date ranges, dedupe helper copy", async () => {
    renderDialog();
    selectFile(icsFile(SAMPLE_ICS));

    expect(await screen.findByText(/3 events found in/)).toBeInTheDocument();
    expect(screen.getByText("calendar.ics")).toBeInTheDocument();

    // Rows: title + UTC-safe date range (single day, span, no date).
    expect(screen.getByText("Single day event")).toBeInTheDocument();
    expect(screen.getByText("Mar 10, 2026")).toBeInTheDocument();
    expect(screen.getByText("Multi day event")).toBeInTheDocument();
    expect(screen.getByText("Mar 10, 2026 – Mar 12, 2026")).toBeInTheDocument();
    expect(screen.getByText("Undated event")).toBeInTheDocument();
    expect(screen.getByText("No date")).toBeInTheDocument();

    // The no-UID dedupe caveat is stated up front.
    expect(
      screen.getByText(/Events without an ID are\s+always created again/),
    ).toBeInTheDocument();

    // No warnings → no "couldn't be read" alert.
    expect(screen.queryByText(/couldn't\s+be read/)).not.toBeInTheDocument();
  });

  it("defaults the group select to the first group by position, not array order", async () => {
    renderDialog();
    selectFile(icsFile(SAMPLE_ICS));

    // Matcher-based assertions (repo precedent: Select.test.tsx) sidestep the
    // tests project's conflicting DOM typings — a non-lib.dom HTMLElement is
    // in scope there, so neither `as HTMLSelectElement` nor the
    // testing-library generic typechecks. jest-dom's toHaveValue reads the
    // select's value without any type narrowing.
    const select = await screen.findByLabelText("Add tasks to");
    expect(select).toHaveValue("g-todo");
    // All groups offered, in position order.
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    expect(options).toEqual(["g-todo", "g-doing", "g-done"]);
  });

  it("imports: posts the mapped payload (single-day → dueDate only, span → both, uid → sourceUid), toasts, refetches, closes", async () => {
    const user = userEvent.setup();
    mockPost.mockResolvedValue({ created: 2, skipped: 1, total: 3 });
    const onClose = renderDialog();
    selectFile(icsFile(SAMPLE_ICS));

    const select = await screen.findByLabelText("Add tasks to");
    await user.selectOptions(select, "g-doing");
    await user.click(screen.getByRole("button", { name: "Import 3 tasks" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/api/projects/proj-1/tasks/import", {
        taskGroupId: "g-doing",
        tasks: [
          {
            title: "Single day event",
            sourceUid: "evt-single@example.com",
            dueDate: "2026-03-10",
          },
          {
            title: "Multi day event",
            description: "Across three days",
            startDate: "2026-03-10",
            dueDate: "2026-03-12",
          },
          {
            title: "Undated event",
            sourceUid: "evt-undated@example.com",
          },
        ],
      });
    });

    expect(mockToast).toHaveBeenCalledWith("Imported 2 tasks (1 duplicate skipped)", {
      variant: "success",
    });
    expect(mockRefetchTasks).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("omits the skipped clause from the toast when nothing was skipped", async () => {
    const user = userEvent.setup();
    mockPost.mockResolvedValue({ created: 3, skipped: 0, total: 3 });
    renderDialog();
    selectFile(icsFile(SAMPLE_ICS));

    await screen.findByText(/3 events found in/);
    await user.click(screen.getByRole("button", { name: "Import 3 tasks" }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith("Imported 3 tasks", { variant: "success" });
    });
  });

  it("surfaces parser warnings as a count alert while still previewing salvaged events", async () => {
    renderDialog();
    selectFile(icsFile(ICS_WITH_BROKEN_EVENT));

    expect(await screen.findByText(/1 event found in/)).toBeInTheDocument();
    expect(
      screen.getByText(/1 event couldn't\s+be read and will be left out/),
    ).toBeInTheDocument();
    expect(screen.getByText("Good event")).toBeInTheDocument();
    expect(screen.queryByText("Broken event")).not.toBeInTheDocument();
  });

  it("shows the no-readable-events alert for a file with zero VEVENTs and allows another pick", async () => {
    renderDialog();
    selectFile(icsFile(makeIcs("")));

    expect(
      await screen.findByText(/This file doesn't contain any readable events/),
    ).toBeInTheDocument();
    // Not a dead end: the dropzone is still there and no Import button appeared.
    expect(screen.getByRole("button", { name: "Upload file" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Import/ })).not.toBeInTheDocument();

    // Recover by picking a valid file.
    selectFile(icsFile(SAMPLE_ICS));
    expect(await screen.findByText(/3 events found in/)).toBeInTheDocument();
  });

  it("rejects an oversize file client-side without reading or parsing it", async () => {
    renderDialog();
    selectFile(
      new File([new Uint8Array(MAX_IMPORT_FILE_BYTES + 1)], "huge.ics", {
        type: "text/calendar",
      }),
    );

    expect(
      await screen.findByText("File is too large — the limit is 1 MB."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/events found in/)).not.toBeInTheDocument();
  });

  it("rejects a non-.ics file with a clear message", async () => {
    renderDialog();
    selectFile(new File(["not a calendar"], "notes.txt", { type: "text/plain" }));

    expect(
      await screen.findByText("That doesn't look like an .ics calendar file."),
    ).toBeInTheDocument();
  });

  it("caps the payload at 500 items and says so (mirror of the endpoint's hard limit)", async () => {
    const user = userEvent.setup();
    mockPost.mockResolvedValue({ created: 500, skipped: 0, total: 500 });
    const manyEvents = Array.from({ length: 501 }, (_, i) =>
      [
        "BEGIN:VEVENT",
        `UID:bulk-${i}@example.com`,
        "DTSTART;VALUE=DATE:20260310",
        "DTEND;VALUE=DATE:20260311",
        `SUMMARY:Event ${i}`,
        "END:VEVENT",
        "",
      ].join("\n"),
    ).join("");
    renderDialog();
    selectFile(icsFile(makeIcs(manyEvents)));

    expect(await screen.findByText(/501 events found in/)).toBeInTheDocument();
    expect(
      screen.getByText(/only the\s+first 500 events will be imported/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Import 500 tasks" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalled();
    });
    const body = mockPost.mock.calls[0][1] as { tasks: unknown[] };
    expect(body.tasks).toHaveLength(500);
  });

  it("keeps the dialog open and toasts the server message when the endpoint rejects", async () => {
    const user = userEvent.setup();
    mockPost.mockRejectedValue(new ApiError(403, "Forbidden"));
    const onClose = renderDialog();
    selectFile(icsFile(SAMPLE_ICS));

    await screen.findByText(/3 events found in/);
    await user.click(screen.getByRole("button", { name: "Import 3 tasks" }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith("Forbidden", { variant: "error" });
    });
    // Preview still mounted for retry; nothing refetched or closed.
    expect(screen.getByText(/3 events found in/)).toBeInTheDocument();
    expect(mockRefetchTasks).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("resets back to the dropzone via 'Choose another file'", async () => {
    const user = userEvent.setup();
    renderDialog();
    selectFile(icsFile(SAMPLE_ICS));

    await screen.findByText(/3 events found in/);
    await user.click(screen.getByRole("button", { name: "Choose another file" }));

    expect(screen.queryByText(/3 events found in/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload file" })).toBeInTheDocument();
  });
});
