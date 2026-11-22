import { onlineManager } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OfflineError } from "@/web/lib/api/client";

import { isUnavailableOffline, NEEDS_CONNECTION_HINT, useOnlineOnly } from "./use-online-only";

afterEach(() => {
  onlineManager.setOnline(true);
});

describe("useOnlineOnly", () => {
  it("leaves the control enabled with no tooltip while online", () => {
    onlineManager.setOnline(true);
    const { result } = renderHook(() => useOnlineOnly());

    expect(result.current).toEqual({ online: true, disabled: false, title: undefined });
  });

  it("disables the control and explains why while offline", () => {
    onlineManager.setOnline(false);
    const { result } = renderHook(() => useOnlineOnly());

    expect(result.current).toEqual({ online: false, disabled: true, title: NEEDS_CONNECTION_HINT });
  });

  it("uses the caller's hint", () => {
    onlineManager.setOnline(false);
    const { result } = renderHook(() => useOnlineOnly("Sign out needs a connection"));

    expect(result.current.title).toBe("Sign out needs a connection");
  });

  it("follows the connection as it changes", () => {
    onlineManager.setOnline(true);
    const { result } = renderHook(() => useOnlineOnly());

    act(() => onlineManager.setOnline(false));
    expect(result.current.disabled).toBe(true);

    act(() => onlineManager.setOnline(true));
    expect(result.current.disabled).toBe(false);
  });
});

describe("isUnavailableOffline", () => {
  it("is true for a paused query with nothing cached", () => {
    expect(isUnavailableOffline({ data: undefined, fetchStatus: "paused", error: null })).toBe(
      true
    );
  });

  it("is true for a query that failed with no connection and nothing cached", () => {
    expect(
      isUnavailableOffline({ data: undefined, fetchStatus: "idle", error: new OfflineError() })
    ).toBe(true);
  });

  it("is false once there is data to show, even while paused", () => {
    expect(isUnavailableOffline({ data: { ok: true }, fetchStatus: "paused", error: null })).toBe(
      false
    );
  });

  it("is false for a loading or server-failed query", () => {
    expect(isUnavailableOffline({ data: undefined, fetchStatus: "fetching", error: null })).toBe(
      false
    );
    expect(
      isUnavailableOffline({ data: undefined, fetchStatus: "idle", error: new Error("500") })
    ).toBe(false);
  });
});
