import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/web/lib/api/client";

import { useFileUpload } from "./use-file-upload";

// Mock the api client module
vi.mock("@/web/lib/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/web/lib/api/client")>(
    "@/web/lib/api/client",
  );
  return {
    ...actual,
    api: Object.assign(vi.fn(), {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    }),
  };
});

import { api } from "@/web/lib/api/client";
const mockPut = api.put as ReturnType<typeof vi.fn>;
const mockPost = api.post as ReturnType<typeof vi.fn>;

function createFile(name: string, size: number, type: string): File {
  const content = new Uint8Array(size);
  return new File([content], name, { type });
}

describe("useFileUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts in idle state with no error or data", () => {
    const { result } = renderHook(() => useFileUpload());

    expect(result.current.state).toBe("idle");
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBeNull();
  });

  describe("validate", () => {
    it("returns null for a valid file", () => {
      const { result } = renderHook(() => useFileUpload());
      const file = createFile("photo.png", 1024, "image/png");

      const error = result.current.validate(file, {
        accept: ["image/png", "image/jpeg"],
        maxSize: 5 * 1024 * 1024,
      });

      expect(error).toBeNull();
    });

    it("returns an invalid-type error when file type is not accepted", () => {
      const { result } = renderHook(() => useFileUpload());
      const file = createFile("doc.pdf", 1024, "application/pdf");

      const error = result.current.validate(file, {
        accept: ["image/png", "image/jpeg"],
      });

      expect(error).not.toBeNull();
      expect(error!.type).toBe("invalid-type");
      expect(error!.message).toContain("application/pdf");
      expect(error!.message).toContain("image/png");
    });

    it("returns a file-too-large error when file exceeds maxSize", () => {
      const { result } = renderHook(() => useFileUpload());
      const file = createFile("big.png", 10 * 1024 * 1024, "image/png");

      const error = result.current.validate(file, {
        maxSize: 5 * 1024 * 1024,
      });

      expect(error).not.toBeNull();
      expect(error!.type).toBe("file-too-large");
      expect(error!.message).toContain("too large");
    });

    it("allows any type when accept is empty or undefined", () => {
      const { result } = renderHook(() => useFileUpload());
      const file = createFile("anything.xyz", 100, "application/octet-stream");

      expect(result.current.validate(file, { accept: [] })).toBeNull();
      expect(result.current.validate(file, {})).toBeNull();
    });
  });

  describe("upload", () => {
    it("transitions to uploading state during upload", async () => {
      let resolveFn: (value: unknown) => void;
      mockPut.mockReturnValue(
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
      );

      const { result } = renderHook(() => useFileUpload());
      const file = createFile("photo.png", 1024, "image/png");

      let uploadPromise: Promise<unknown>;
      act(() => {
        uploadPromise = result.current.upload(file, { endpoint: "/api/upload" });
      });

      expect(result.current.state).toBe("uploading");
      expect(result.current.error).toBeNull();

      // Resolve and wait for completion
      await act(async () => {
        resolveFn!({ url: "/uploaded.png" });
        await uploadPromise;
      });
    });

    it("sends FormData with the file using the default field name and put method", async () => {
      const response = { url: "/uploaded.png" };
      mockPut.mockResolvedValue(response);

      const { result } = renderHook(() => useFileUpload());
      const file = createFile("photo.png", 1024, "image/png");

      await act(async () => {
        await result.current.upload(file, { endpoint: "/api/upload" });
      });

      expect(mockPut).toHaveBeenCalledTimes(1);
      const [endpoint, formData, options] = mockPut.mock.calls[0] as [string, FormData, { signal: AbortSignal }];
      expect(endpoint).toBe("/api/upload");
      expect(formData).toBeInstanceOf(FormData);
      expect(formData.get("file")).toBe(file);
      expect(options.signal).toBeInstanceOf(AbortSignal);
    });

    it("uses custom fieldName and method when specified", async () => {
      mockPost.mockResolvedValue({ ok: true });

      const { result } = renderHook(() => useFileUpload());
      const file = createFile("doc.pdf", 1024, "application/pdf");

      await act(async () => {
        await result.current.upload(file, {
          endpoint: "/api/documents",
          method: "post",
          fieldName: "document",
        });
      });

      expect(mockPost).toHaveBeenCalledTimes(1);
      const [, formData] = mockPost.mock.calls[0] as [string, FormData, { signal: AbortSignal }];
      expect(formData.get("document")).toBe(file);
    });

    it("transitions to success state and returns data on successful upload", async () => {
      const response = { id: 42, url: "/files/42.png" };
      mockPut.mockResolvedValue(response);

      const { result } = renderHook(() => useFileUpload<typeof response>());
      const file = createFile("photo.png", 1024, "image/png");

      let returnValue: typeof response | null;
      await act(async () => {
        returnValue = await result.current.upload(file, { endpoint: "/api/upload" });
      });

      expect(result.current.state).toBe("success");
      expect(result.current.data).toEqual(response);
      expect(result.current.error).toBeNull();
      expect(returnValue!).toEqual(response);
    });

    it("transitions to error state on ApiError", async () => {
      mockPut.mockRejectedValue(new ApiError(413, "Payload too large"));

      const { result } = renderHook(() => useFileUpload());
      const file = createFile("photo.png", 1024, "image/png");

      await act(async () => {
        const returnValue = await result.current.upload(file, { endpoint: "/api/upload" });
        expect(returnValue).toBeNull();
      });

      expect(result.current.state).toBe("error");
      expect(result.current.error).toBe("Payload too large");
      expect(result.current.data).toBeNull();
    });

    it("transitions to error state on generic Error", async () => {
      mockPut.mockRejectedValue(new Error("Network failure"));

      const { result } = renderHook(() => useFileUpload());
      const file = createFile("photo.png", 1024, "image/png");

      await act(async () => {
        await result.current.upload(file, { endpoint: "/api/upload" });
      });

      expect(result.current.state).toBe("error");
      expect(result.current.error).toBe("Network failure");
    });
  });

  describe("cancel", () => {
    it("aborts an in-flight upload and resets state", () => {
      mockPut.mockReturnValue(new Promise(() => {})); // never resolves

      const { result } = renderHook(() => useFileUpload());
      const file = createFile("photo.png", 1024, "image/png");

      act(() => {
        void result.current.upload(file, { endpoint: "/api/upload" });
      });

      expect(result.current.state).toBe("uploading");

      act(() => {
        result.current.cancel();
      });

      expect(result.current.state).toBe("idle");
      expect(result.current.error).toBeNull();
      expect(result.current.data).toBeNull();
    });
  });

  describe("reset", () => {
    it("resets state back to idle after a successful upload", async () => {
      mockPut.mockResolvedValue({ url: "/photo.png" });

      const { result } = renderHook(() => useFileUpload());
      const file = createFile("photo.png", 1024, "image/png");

      await act(async () => {
        await result.current.upload(file, { endpoint: "/api/upload" });
      });

      expect(result.current.state).toBe("success");

      act(() => {
        result.current.reset();
      });

      expect(result.current.state).toBe("idle");
      expect(result.current.data).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it("resets state back to idle after an error", async () => {
      mockPut.mockRejectedValue(new Error("fail"));

      const { result } = renderHook(() => useFileUpload());
      const file = createFile("photo.png", 1024, "image/png");

      await act(async () => {
        await result.current.upload(file, { endpoint: "/api/upload" });
      });

      expect(result.current.state).toBe("error");

      act(() => {
        result.current.reset();
      });

      expect(result.current.state).toBe("idle");
      expect(result.current.error).toBeNull();
    });
  });
});
