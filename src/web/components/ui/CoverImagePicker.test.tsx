import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { UnsplashCoverPayload } from "@/shared/schemas/unsplash";

/* ------------------------------------------------------------------ */
/*  Mocks — must be declared before imports that depend on them       */
/* ------------------------------------------------------------------ */

const mockFeaturesValue = { current: { data: { unsplash: true } } };

vi.mock("@/web/hooks/use-features", () => ({
  useFeatures: () => mockFeaturesValue.current,
}));

interface MockSearchState {
  results: UnsplashCoverPayload[];
  debouncedQuery: string;
  isCurated: boolean;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  fetchNextPage: ReturnType<typeof vi.fn>;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  refetch: ReturnType<typeof vi.fn>;
  totalPages: number;
  total: number;
}

const mockSearchState: { current: MockSearchState } = {
  current: createMockSearchState(),
};

let lastSearchArgs: {
  query: string;
  orientation?: "landscape" | "portrait" | "squarish";
  enabled?: boolean;
} = { query: "" };

function createMockSearchState(overrides: Partial<MockSearchState> = {}): MockSearchState {
  return {
    results: [],
    debouncedQuery: "",
    isCurated: true,
    isLoading: false,
    isError: false,
    error: null,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: vi.fn(),
    totalPages: 1,
    total: 0,
    ...overrides,
  };
}

vi.mock("@/web/hooks/use-unsplash-search", () => ({
  useUnsplashSearch: (args: {
    query: string;
    orientation?: "landscape" | "portrait" | "squarish";
    enabled?: boolean;
  }) => {
    lastSearchArgs = args;
    return mockSearchState.current;
  },
}));

vi.mock("@/web/util/image-optimization", async () => {
  const actual = await vi.importActual<typeof import("@/web/util/image-optimization")>(
    "@/web/util/image-optimization",
  );
  return {
    ...actual,
    // Skip real Canvas-based optimization in jsdom — return a distinct File so
    // the test can confirm the optimized output was passed through.
    optimizeImage: vi.fn(async (file: File) => {
      return new File([await file.arrayBuffer()], `optimized-${file.name}`, {
        type: "image/webp",
      });
    }),
    isAnimatedGif: vi.fn((file: File) => Promise.resolve(file.name.includes("animated"))),
  };
});

vi.mock("@/web/hooks/use-reduced-motion", () => ({
  usePrefersReducedMotion: () => true,
}));

/* ------------------------------------------------------------------ */
/*  Polyfills & globals                                                */
/* ------------------------------------------------------------------ */

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

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

/* ------------------------------------------------------------------ */
/*  IntersectionObserver stub with manual trigger hook                 */
/* ------------------------------------------------------------------ */

type IoCallback = (entries: IntersectionObserverEntry[]) => void;

const ioInstances: Array<{ cb: IoCallback; trigger: () => void }> = [];

class IntersectionObserverStub {
  cb: IoCallback;
  constructor(cb: IoCallback) {
    this.cb = cb;
    ioInstances.push({
      cb,
      trigger: () => {
        cb([
          {
            isIntersecting: true,
            target: document.createElement("div"),
            intersectionRatio: 1,
            boundingClientRect: {} as DOMRectReadOnly,
            intersectionRect: {} as DOMRectReadOnly,
            rootBounds: null,
            time: 0,
          },
        ]);
      },
    });
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.IntersectionObserver =
  IntersectionObserverStub as unknown as typeof IntersectionObserver;

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

function makePhoto(id: string, overrides: Partial<UnsplashCoverPayload> = {}): UnsplashCoverPayload {
  return {
    id,
    rawUrl: `https://images.unsplash.com/${id}-raw.jpg`,
    url: `https://images.unsplash.com/${id}.jpg`,
    thumbUrl: `https://images.unsplash.com/${id}-thumb.jpg`,
    blurHash: null,
    color: "#123456",
    description: `Photo ${id}`,
    width: 3000,
    height: 2000,
    photoUrl: `https://unsplash.com/photos/${id}?utm_source=cadence&utm_medium=referral`,
    downloadLocation: `https://api.unsplash.com/photos/${id}/download`,
    user: {
      name: `Author ${id}`,
      username: `author_${id}`,
      profileUrl: `https://unsplash.com/@author_${id}?utm_source=cadence&utm_medium=referral`,
    },
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Render helper                                                      */
/* ------------------------------------------------------------------ */

import { CoverImagePicker } from "./CoverImagePicker";

interface RenderOpts {
  open?: boolean;
  initialTab?: "upload" | "unsplash";
  onUploadFile?: (file: File) => void;
  onSelectUnsplash?: (payload: UnsplashCoverPayload) => void;
  onClose?: () => void;
}

function renderPicker(opts: RenderOpts = {}) {
  const onUploadFile = opts.onUploadFile ?? vi.fn();
  const onSelectUnsplash = opts.onSelectUnsplash ?? vi.fn();
  const onClose = opts.onClose ?? vi.fn();

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  const utils = render(
    <CoverImagePicker
      open={opts.open ?? true}
      onClose={onClose}
      onUploadFile={onUploadFile}
      onSelectUnsplash={onSelectUnsplash}
      initialTab={opts.initialTab}
    />,
    { wrapper: Wrapper },
  );

  return { ...utils, onUploadFile, onSelectUnsplash, onClose };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("CoverImagePicker", () => {
  beforeEach(() => {
    mockFeaturesValue.current = { data: { unsplash: true } };
    mockSearchState.current = createMockSearchState();
    ioInstances.length = 0;
    lastSearchArgs = { query: "" };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("feature flag gating", () => {
    it("renders only the Upload panel when Unsplash is disabled", () => {
      mockFeaturesValue.current = { data: { unsplash: false } };
      renderPicker();

      expect(screen.queryByRole("tab", { name: /unsplash/i })).toBeNull();
      expect(screen.queryByRole("tab", { name: /upload/i })).toBeNull();
      // Upload panel content is visible
      expect(
        screen.getByLabelText("Upload cover image"),
      ).toBeInTheDocument();
    });

    it("renders both tabs when Unsplash is enabled and defaults to Unsplash", () => {
      renderPicker();

      expect(screen.getByRole("tab", { name: /upload/i })).toBeInTheDocument();
      const unsplashTab = screen.getByRole("tab", { name: /unsplash/i });
      expect(unsplashTab).toHaveAttribute("aria-selected", "true");
    });

    it("respects initialTab='upload' override even when Unsplash is enabled", () => {
      renderPicker({ initialTab: "upload" });

      expect(screen.getByRole("tab", { name: /upload/i })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
  });

  describe("Upload tab", () => {
    it("clicking the drop zone opens the hidden file input", async () => {
      mockFeaturesValue.current = { data: { unsplash: false } };
      const user = userEvent.setup();
      renderPicker();

      const dropZone = screen.getByLabelText("Upload cover image");
      const input = dropZone.querySelector(
        "input[type='file']",
      ) as HTMLInputElement;
      const clickSpy = vi.spyOn(input, "click");

      await user.click(dropZone);
      expect(clickSpy).toHaveBeenCalled();
    });

    it("selecting a valid file calls onUploadFile with an optimized file and closes", async () => {
      mockFeaturesValue.current = { data: { unsplash: false } };
      const onUploadFile = vi.fn();
      const onClose = vi.fn();
      renderPicker({ onUploadFile, onClose });

      const dropZone = screen.getByLabelText("Upload cover image");
      const input = dropZone.querySelector(
        "input[type='file']",
      ) as HTMLInputElement;
      const file = new File(["hello"], "cover.png", { type: "image/png" });

      await act(async () => {
        fireEvent.change(input, { target: { files: [file] } });
        // Allow the async handleFile promise chain to settle inside act().
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(onUploadFile).toHaveBeenCalledTimes(1);
      });
      const uploaded = onUploadFile.mock.calls[0][0] as File;
      expect(uploaded.name).toBe("optimized-cover.png");
      expect(uploaded.type).toBe("image/webp");
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("animated GIFs skip optimization and upload the original file", async () => {
      mockFeaturesValue.current = { data: { unsplash: false } };
      const onUploadFile = vi.fn();
      renderPicker({ onUploadFile });

      const input = screen
        .getByLabelText("Upload cover image")
        .querySelector("input[type='file']") as HTMLInputElement;
      const file = new File(["gif-data"], "animated-banner.gif", {
        type: "image/gif",
      });

      await act(async () => {
        fireEvent.change(input, { target: { files: [file] } });
        // Allow the async handleFile promise chain to settle inside act().
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(onUploadFile).toHaveBeenCalledTimes(1);
      });
      const uploaded = onUploadFile.mock.calls[0][0] as File;
      expect(uploaded.name).toBe("animated-banner.gif");
      expect(uploaded.type).toBe("image/gif");
    });

    it("shows a validation error for invalid MIME types and does not upload", async () => {
      mockFeaturesValue.current = { data: { unsplash: false } };
      const onUploadFile = vi.fn();
      renderPicker({ onUploadFile });

      const input = screen
        .getByLabelText("Upload cover image")
        .querySelector("input[type='file']") as HTMLInputElement;
      const file = new File(["pdf"], "doc.pdf", { type: "application/pdf" });

      await act(async () => {
        fireEvent.change(input, { target: { files: [file] } });
        // Allow the async handleFile promise chain to settle inside act().
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(/is not allowed/i);
      });
      expect(onUploadFile).not.toHaveBeenCalled();
    });

    it("shows a validation error when the file exceeds MAX_UPLOAD_SIZE", async () => {
      mockFeaturesValue.current = { data: { unsplash: false } };
      const onUploadFile = vi.fn();
      renderPicker({ onUploadFile });

      const input = screen
        .getByLabelText("Upload cover image")
        .querySelector("input[type='file']") as HTMLInputElement;
      // Create a file that reports oversized length without actually allocating.
      const file = new File([""], "huge.png", { type: "image/png" });
      Object.defineProperty(file, "size", { value: 10 * 1024 * 1024 });

      await act(async () => {
        fireEvent.change(input, { target: { files: [file] } });
        // Allow the async handleFile promise chain to settle inside act().
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(/too large/i);
      });
      expect(onUploadFile).not.toHaveBeenCalled();
    });
  });

  describe("Unsplash tab", () => {
    it("renders the curated grid when the query is empty", () => {
      mockSearchState.current = createMockSearchState({
        results: [makePhoto("a"), makePhoto("b")],
      });
      renderPicker();

      expect(
        screen.getByRole("button", { name: /use photo by author a/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /use photo by author b/i }),
      ).toBeInTheDocument();
    });

    it("clicking a card calls onSelectUnsplash with the full payload and closes", async () => {
      const photo = makePhoto("hero");
      mockSearchState.current = createMockSearchState({ results: [photo] });

      const onSelectUnsplash = vi.fn();
      const onClose = vi.fn();
      const user = userEvent.setup();
      renderPicker({ onSelectUnsplash, onClose });

      await user.click(
        screen.getByRole("button", { name: /use photo by author hero/i }),
      );

      expect(onSelectUnsplash).toHaveBeenCalledTimes(1);
      expect(onSelectUnsplash).toHaveBeenCalledWith(photo);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("typing in the search input threads the raw query into useUnsplashSearch", async () => {
      const user = userEvent.setup();
      renderPicker();

      // Mount pass — initial call has empty query.
      expect(lastSearchArgs.query).toBe("");

      const input = screen.getByRole("searchbox");
      await user.type(input, "mountain");

      // Hook is called with raw query; debounce lives inside the hook.
      expect(lastSearchArgs.query).toBe("mountain");
      expect(lastSearchArgs.enabled).toBe(true);
    });

    it("renders the empty state when a search returns zero results", () => {
      mockSearchState.current = createMockSearchState({
        results: [],
        debouncedQuery: "obscure-query",
        isCurated: false,
      });
      renderPicker();

      expect(
        screen.getByText(/no photos match that search/i),
      ).toBeInTheDocument();
    });

    it("renders an error alert with a working Retry button", async () => {
      const refetch = vi.fn();
      mockSearchState.current = createMockSearchState({
        isError: true,
        error: new Error("Unsplash timeout"),
        refetch,
      });
      const user = userEvent.setup();
      renderPicker();

      expect(screen.getByRole("alert")).toHaveTextContent(/unsplash timeout/i);
      await user.click(screen.getByRole("button", { name: /retry/i }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it("intersecting the sentinel calls fetchNextPage", () => {
      const fetchNextPage = vi.fn();
      mockSearchState.current = createMockSearchState({
        results: [makePhoto("a")],
        hasNextPage: true,
        isFetchingNextPage: false,
        fetchNextPage,
      });

      renderPicker();

      // The most recently created IO instance is the one for the Unsplash panel
      // sentinel — trigger it manually to simulate scroll arrival.
      const last = ioInstances.at(-1);
      expect(last).toBeTruthy();
      if (last) act(() => last.trigger());

      expect(fetchNextPage).toHaveBeenCalled();
    });

    it("photographer links open in a new tab with noopener noreferrer", () => {
      mockSearchState.current = createMockSearchState({
        results: [makePhoto("credit")],
      });
      renderPicker();

      // Two links per card: profile (photographer name) + photo-on-unsplash
      // icon. Both must be new-tab with the noopener/noreferrer hardening.
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThanOrEqual(2);
      for (const link of links) {
        if (link.getAttribute("href")?.includes("unsplash.com/")) {
          expect(link).toHaveAttribute("target", "_blank");
          expect(link).toHaveAttribute("rel", "noopener noreferrer");
        }
      }
      const profile = links.find((l) =>
        l.getAttribute("href")?.includes("/@author_credit"),
      );
      expect(profile).toBeTruthy();
      expect(profile?.getAttribute("href")).toContain("utm_source=cadence");
    });
  });

  describe("dialog lifecycle", () => {
    it("ESC (cancel event on <dialog>) invokes onClose", () => {
      const onClose = vi.fn();
      renderPicker({ onClose });

      const dialog = screen.getByRole("dialog");
      const cancelEvent = new Event("cancel", {
        bubbles: false,
        cancelable: true,
      });
      dialog.dispatchEvent(cancelEvent);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("backdrop click (event target === dialog) invokes onClose", () => {
      const onClose = vi.fn();
      renderPicker({ onClose });

      const dialog = screen.getByRole("dialog");
      fireEvent.click(dialog, { target: dialog });
      // jsdom's fireEvent.click passes target as the dialog itself — the
      // Dialog primitive checks `e.target === dialog` so this exercises the
      // backdrop-close path.
      expect(onClose).toHaveBeenCalled();
    });

    it("explicit close button invokes onClose", async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();
      renderPicker({ onClose });

      await user.click(screen.getByRole("button", { name: /^close$/i }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("does not fire Unsplash requests while open=false", () => {
      mockFeaturesValue.current = { data: { unsplash: true } };
      renderPicker({ open: false });

      // The hook is always called (React rules of hooks), but its `enabled`
      // flag must be false when the picker is closed.
      expect(lastSearchArgs.enabled).toBe(false);
    });
  });
});
