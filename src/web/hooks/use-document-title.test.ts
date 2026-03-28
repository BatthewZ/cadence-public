import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useDocumentTitle } from "./use-document-title";
import { BASE_TITLE } from "./use-document-title";

describe("useDocumentTitle", () => {
  beforeEach(() => {
    document.title = BASE_TITLE;
  });

  it("sets document.title with the base suffix", () => {
    renderHook(() => useDocumentTitle("Dashboard"));
    expect(document.title).toBe(`Dashboard | ${BASE_TITLE}`);
  });

  it("restores previous title on unmount", () => {
    const { unmount } = renderHook(() => useDocumentTitle("Settings"));
    expect(document.title).toBe(`Settings | ${BASE_TITLE}`);

    unmount();
    expect(document.title).toBe(BASE_TITLE);
  });

  it("updates when the title argument changes", () => {
    const { rerender } = renderHook(({ title }) => useDocumentTitle(title), {
      initialProps: { title: "Dashboard" },
    });
    expect(document.title).toBe(`Dashboard | ${BASE_TITLE}`);

    rerender({ title: "Settings" });
    expect(document.title).toBe(`Settings | ${BASE_TITLE}`);
  });

  it("uses base title alone when empty string is passed", () => {
    renderHook(() => useDocumentTitle(""));
    expect(document.title).toBe(BASE_TITLE);
  });
});
