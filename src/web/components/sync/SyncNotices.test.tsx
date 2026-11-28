import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WRITE_ERROR_CODES } from "@/shared/constants/offline-sync";
import { ToastProvider } from "@/web/components/ui/ToastContext";
import type { Refusal } from "@/web/lib/offline/outbox";
import type { QueuedWrite } from "@/web/lib/offline/perform-write";

const refusals = vi.hoisted(() => ({ emit: null as ((refusal: Refusal) => void) | null }));

vi.mock("@/web/lib/offline/hooks", () => ({
  useSyncRefusals: (cb: (refusal: Refusal) => void) => {
    refusals.emit = cb;
  },
}));

import { REFUSAL_COLLAPSE_MS, SyncNotices } from "./SyncNotices";

function refusal(label: string, overrides: Partial<Refusal> = {}, body: unknown = {}): Refusal {
  const write: QueuedWrite = {
    v: 1,
    id: 1,
    method: "PATCH",
    path: "/api/tasks/t1",
    body,
    label,
    order: 1,
    key: label,
    createdAt: 0,
    attempts: 1,
    stuck: false,
    lastError: null,
  };
  return { write, status: 404, message: "Task not found", body: undefined, ...overrides };
}

function emit(r: Refusal) {
  act(() => refusals.emit?.(r));
}

function renderNotices() {
  return render(
    <ToastProvider>
      <SyncNotices />
    </ToastProvider>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  refusals.emit = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SyncNotices", () => {
  it("renders nothing of its own", () => {
    const { container } = renderNotices();

    expect(container).toBeEmptyDOMElement();
  });

  it("reports a single refused write with the server's reason", () => {
    renderNotices();

    emit(refusal("Move “Fix login”"));
    act(() => {
      vi.advanceTimersByTime(REFUSAL_COLLAPSE_MS);
    });

    expect(screen.getByText("An offline change couldn't be saved")).toBeInTheDocument();
    expect(screen.getByText("Move “Fix login” — Task not found")).toBeInTheDocument();
  });

  it("collapses refusals that arrive together into one toast listing them", () => {
    renderNotices();

    emit(refusal("Move “A”"));
    act(() => {
      vi.advanceTimersByTime(REFUSAL_COLLAPSE_MS / 2);
    });
    emit(refusal("Complete “B”"));
    emit(refusal("Comment on “C”"));
    act(() => {
      vi.advanceTimersByTime(REFUSAL_COLLAPSE_MS);
    });

    expect(screen.getByText("3 offline changes couldn't be saved")).toBeInTheDocument();
    expect(screen.getByText("Move “A”, Complete “B”, Comment on “C”")).toBeInTheDocument();
    expect(screen.queryByText("An offline change couldn't be saved")).not.toBeInTheDocument();
  });

  it("gives a description conflict its own toast that copies the person's version", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderNotices();

    emit(refusal("Move “A”"));
    emit(
      refusal(
        "Edit description of “Fix login”",
        {
          status: 409,
          code: WRITE_ERROR_CODES.descriptionConflict,
          message: "The description changed since this edit was made",
          body: { code: WRITE_ERROR_CODES.descriptionConflict, task: { title: "Fix login" } },
        },
        { description: "My offline notes", descriptionBase: "Old notes" }
      )
    );

    expect(
      screen.getByText(
        "Someone else changed the description of “Fix login” while you were offline, so your edit wasn't saved."
      )
    ).toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: "Copy my version" }).click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("My offline notes");
    expect(screen.getByText("Your version is on the clipboard.")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(REFUSAL_COLLAPSE_MS);
    });
    expect(screen.getByText("Move “A” — Task not found")).toBeInTheDocument();
  });

  it.each([
    ["is missing (an insecure context)", undefined],
    [
      "refuses the write",
      { writeText: vi.fn(() => Promise.reject(new DOMException("Denied", "NotAllowedError"))) },
    ],
  ])("says the copy failed when the clipboard %s", async (_case, clipboard) => {
    Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
    renderNotices();

    emit(
      refusal(
        "Edit description of “Fix login”",
        {
          status: 409,
          code: WRITE_ERROR_CODES.descriptionConflict,
          message: "The description changed since this edit was made",
          body: { code: WRITE_ERROR_CODES.descriptionConflict, task: { title: "Fix login" } },
        },
        { description: "My offline notes", descriptionBase: "Old notes" }
      )
    );

    await act(async () => {
      screen.getByRole("button", { name: "Copy my version" }).click();
      await Promise.resolve();
    });
    expect(screen.getByText("Couldn't copy to the clipboard.")).toBeInTheDocument();
    expect(screen.queryByText("Your version is on the clipboard.")).not.toBeInTheDocument();
  });
});
