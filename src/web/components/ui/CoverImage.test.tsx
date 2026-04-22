import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { UnsplashCoverPayload } from "@/shared/schemas/unsplash";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

// Keep the picker's Unsplash tab hidden by default so the smoke tests focus on
// CoverImage's own wiring (opening the picker, rendering attribution) without
// needing to stub the Unsplash network layer. The `feature off` branch is
// already covered exhaustively in CoverImagePicker.test.tsx.
const mockFeaturesValue = { current: { data: { unsplash: false } } };

vi.mock("@/web/hooks/use-features", () => ({
  useFeatures: () => mockFeaturesValue.current,
}));

vi.mock("@/web/hooks/use-unsplash-search", () => ({
  useUnsplashSearch: () => ({
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
  }),
}));

/* ------------------------------------------------------------------ */
/*  Polyfills                                                          */
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

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

const SAMPLE_ATTRIBUTION = {
  name: "Jane Doe",
  profileUrl:
    "https://unsplash.com/@janedoe?utm_source=cadence&utm_medium=referral",
  photoUrl:
    "https://unsplash.com/photos/abc?utm_source=cadence&utm_medium=referral",
};

const SAMPLE_PAYLOAD: UnsplashCoverPayload = {
  id: "abc",
  rawUrl: "https://images.unsplash.com/abc-raw.jpg",
  url: "https://images.unsplash.com/abc.jpg",
  thumbUrl: "https://images.unsplash.com/abc-thumb.jpg",
  blurHash: null,
  color: "#112233",
  description: "A sample",
  width: 3000,
  height: 2000,
  photoUrl: SAMPLE_ATTRIBUTION.photoUrl,
  downloadLocation: "https://api.unsplash.com/photos/abc/download",
  user: {
    name: SAMPLE_ATTRIBUTION.name,
    username: "janedoe",
    profileUrl: SAMPLE_ATTRIBUTION.profileUrl,
  },
};

/* ------------------------------------------------------------------ */
/*  Render helper                                                      */
/* ------------------------------------------------------------------ */

import { CoverImage } from "./CoverImage";

interface RenderOpts {
  coverUrl?: string | null;
  attribution?: typeof SAMPLE_ATTRIBUTION | null;
  editable?: boolean;
  onUpload?: (file: File) => void;
  onRemove?: () => void;
  onApplyUnsplash?: (p: UnsplashCoverPayload) => void;
  onPositionChange?: (pos: number) => void;
}

function renderCover(opts: RenderOpts = {}) {
  const onUpload = opts.onUpload ?? vi.fn();
  const onRemove = opts.onRemove ?? vi.fn();
  const onApplyUnsplash = opts.onApplyUnsplash ?? vi.fn();

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  const utils = render(
    <CoverImage
      coverUrl={opts.coverUrl ?? null}
      coverAttribution={opts.attribution}
      onUpload={onUpload}
      onRemove={onRemove}
      onApplyUnsplash={onApplyUnsplash}
      editable={opts.editable ?? true}
      onPositionChange={opts.onPositionChange}
    />,
    { wrapper: Wrapper },
  );

  return { ...utils, onUpload, onRemove, onApplyUnsplash };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("CoverImage", () => {
  beforeEach(() => {
    mockFeaturesValue.current = { data: { unsplash: false } };
  });

  describe("picker wiring", () => {
    /**
     * The "Add cover" affordance is the primary entry point for setting a
     * cover. It MUST open `CoverImagePicker` — not the old bare file input —
     * because the picker is the only surface that exposes the Unsplash tab.
     */
    it("opens the picker when the empty placeholder is clicked", async () => {
      const user = userEvent.setup();
      renderCover({ coverUrl: null });

      // Before click — the dialog role is not rendered.
      expect(screen.queryByRole("dialog")).toBeNull();

      await user.click(screen.getByLabelText("Add cover image"));

      // After click — the picker's <dialog> is open. With the feature flag off
      // only the Upload panel is visible, which is enough for this smoke test.
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByLabelText("Upload cover image")).toBeInTheDocument();
    });

    /**
     * Once a cover exists, the "Change cover" button in the hover overlay
     * should also open the picker so the user can swap to an Unsplash photo
     * or upload a new file. The old bare file-input behavior is gone.
     */
    it("opens the picker when the 'Change cover' button is clicked", async () => {
      const user = userEvent.setup();
      renderCover({ coverUrl: "https://example.com/cover.jpg" });

      await user.click(
        screen.getByRole("button", { name: /change cover image/i }),
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("attribution overlay", () => {
    /**
     * When a Unsplash cover is active, the photographer credit chip MUST be
     * present in the DOM — the Unsplash API guidelines require attribution
     * on every displayed photo. Breaking this contract can get the API key
     * revoked, so we guard it with a test. (The chip is visually hidden
     * until hover/focus; that's a UX refinement, not a guidelines violation.)
     */
    it("renders the 'Photo by {name} on Unsplash' chip when attribution is provided", () => {
      renderCover({
        coverUrl: SAMPLE_PAYLOAD.url,
        attribution: SAMPLE_ATTRIBUTION,
      });

      expect(screen.getByText(/photo by/i)).toBeInTheDocument();
      const nameLink = screen.getByRole("link", { name: SAMPLE_ATTRIBUTION.name });
      expect(nameLink).toHaveAttribute("href", SAMPLE_ATTRIBUTION.profileUrl);
      expect(nameLink).toHaveAttribute("target", "_blank");
      expect(nameLink).toHaveAttribute("rel", "noopener noreferrer");

      const unsplashLink = screen.getByRole("link", { name: "Unsplash" });
      expect(unsplashLink).toHaveAttribute("href", SAMPLE_ATTRIBUTION.photoUrl);
      expect(unsplashLink).toHaveAttribute("target", "_blank");
      expect(unsplashLink).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("does not render the attribution chip when no attribution is provided", () => {
      renderCover({
        coverUrl: "https://example.com/cover.jpg",
        attribution: null,
      });
      expect(screen.queryByText(/photo by/i)).toBeNull();
    });

    /**
     * During reposition mode the attribution would sit on top of the drag
     * handles and be distracting, so it must disappear. This is a UX rule,
     * not a guidelines rule — but we lock it in because the reposition UI
     * relies on a clean overlay surface.
     */
    it("hides the attribution chip while repositioning", async () => {
      const user = userEvent.setup();
      renderCover({
        coverUrl: SAMPLE_PAYLOAD.url,
        attribution: SAMPLE_ATTRIBUTION,
        onPositionChange: vi.fn(),
      });

      // Sanity check: chip is in the DOM initially (hidden via opacity until
      // hover/focus — testing-library still finds it).
      expect(screen.getByText(/photo by/i)).toBeInTheDocument();

      await user.click(
        screen.getByRole("button", { name: /reposition cover image/i }),
      );

      // Entering reposition mode hides the chip.
      expect(screen.queryByText(/photo by/i)).toBeNull();
    });
  });

  describe("remove confirmation", () => {
    /**
     * Remove MUST be confirmation-gated. The invisible action row under the
     * cover is easy to hit by mistake, especially on touch devices where
     * :hover fires together with the tap that lands under your finger.
     * Breaking this guard means a stray click can permanently lose the
     * user's chosen cover.
     */
    it("does not call onRemove immediately — opens a confirm dialog", async () => {
      const user = userEvent.setup();
      const onRemove = vi.fn();
      renderCover({
        coverUrl: "https://example.com/cover.jpg",
        onRemove,
      });

      await user.click(
        screen.getByRole("button", { name: /remove cover image/i }),
      );

      expect(onRemove).not.toHaveBeenCalled();
      expect(screen.getByRole("heading", { name: /remove cover image\?/i })).toBeInTheDocument();
    });

    it("confirms the remove and fires onRemove", async () => {
      const user = userEvent.setup();
      const onRemove = vi.fn();
      renderCover({
        coverUrl: "https://example.com/cover.jpg",
        onRemove,
      });

      await user.click(
        screen.getByRole("button", { name: /remove cover image/i }),
      );
      await user.click(screen.getByRole("button", { name: "Remove" }));

      expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it("cancels and does not fire onRemove", async () => {
      const user = userEvent.setup();
      const onRemove = vi.fn();
      renderCover({
        coverUrl: "https://example.com/cover.jpg",
        onRemove,
      });

      await user.click(
        screen.getByRole("button", { name: /remove cover image/i }),
      );
      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(onRemove).not.toHaveBeenCalled();
    });
  });

  describe("tap-to-open on mobile", () => {
    /**
     * Tapping anywhere on an existing cover (not on an inline action button)
     * opens the picker. This is the only reliable way for touch-device users
     * to change a cover — they can't hover to reveal the action row. The
     * test simulates a click on the cover container outside any button.
     */
    it("opens the picker when the cover container itself is clicked", async () => {
      const user = userEvent.setup();
      const { container } = renderCover({
        coverUrl: "https://example.com/cover.jpg",
      });

      // Click the cover <img> — it's a child of the container and bubbles
      // up to the container's onClick. Doesn't hit any action button.
      const img = container.querySelector("img");
      if (!img) throw new Error("cover <img> not rendered");
      await user.click(img);

      expect(
        screen.getByRole("heading", { name: /set cover image/i }),
      ).toBeInTheDocument();
    });
  });
});
