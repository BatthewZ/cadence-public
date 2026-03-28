import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Carousel } from "./Carousel";

// jsdom does not provide ResizeObserver; stub it with a class.
class ResizeObserverStub {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Helper to find the carousel root element via its aria-roledescription. */
function getCarouselRoot(): HTMLElement {
  const el = document.querySelector("[aria-roledescription='carousel']");
  if (!el) throw new Error("Could not find carousel root");
  return el as HTMLElement;
}

describe("Carousel", () => {
  it("renders slides", () => {
    render(
      <Carousel>
        <Carousel.Track>
          <Carousel.Item>Slide 1</Carousel.Item>
          <Carousel.Item>Slide 2</Carousel.Item>
          <Carousel.Item>Slide 3</Carousel.Item>
        </Carousel.Track>
      </Carousel>,
    );

    expect(screen.getByText("Slide 1")).toBeInTheDocument();
    expect(screen.getByText("Slide 2")).toBeInTheDocument();
    expect(screen.getByText("Slide 3")).toBeInTheDocument();
  });

  it("has aria-roledescription='carousel' on root", () => {
    render(
      <Carousel>
        <Carousel.Track>
          <Carousel.Item>Slide 1</Carousel.Item>
        </Carousel.Track>
      </Carousel>,
    );

    const root = getCarouselRoot();
    expect(root).toHaveAttribute("aria-roledescription", "carousel");
  });

  it("slides have aria-roledescription='slide'", () => {
    render(
      <Carousel>
        <Carousel.Track>
          <Carousel.Item>Slide 1</Carousel.Item>
          <Carousel.Item>Slide 2</Carousel.Item>
        </Carousel.Track>
      </Carousel>,
    );

    const slides = screen.getAllByRole("group");
    for (const slide of slides) {
      expect(slide).toHaveAttribute("aria-roledescription", "slide");
    }
    expect(slides).toHaveLength(2);
  });

  it("renders Previous and Next buttons", () => {
    render(
      <Carousel>
        <Carousel.Track>
          <Carousel.Item>Slide 1</Carousel.Item>
        </Carousel.Track>
      </Carousel>,
    );

    expect(screen.getByRole("button", { name: "Previous" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
  });

  it("Next button calls scrollBy on the track", async () => {
    const user = userEvent.setup();
    render(
      <Carousel>
        <Carousel.Track>
          <Carousel.Item>Slide 1</Carousel.Item>
          <Carousel.Item>Slide 2</Carousel.Item>
        </Carousel.Track>
      </Carousel>,
    );

    const track = screen.getByRole("region", { name: "Carousel items" });
    const scrollBySpy = vi.fn();
    track.scrollBy = scrollBySpy;

    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(scrollBySpy).toHaveBeenCalledOnce();
    expect(scrollBySpy).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth" }),
    );
  });

  it("Previous button calls scrollBy on the track", async () => {
    const user = userEvent.setup();
    render(
      <Carousel>
        <Carousel.Track>
          <Carousel.Item>Slide 1</Carousel.Item>
          <Carousel.Item>Slide 2</Carousel.Item>
        </Carousel.Track>
      </Carousel>,
    );

    const track = screen.getByRole("region", { name: "Carousel items" });
    const scrollBySpy = vi.fn();
    track.scrollBy = scrollBySpy;

    await user.click(screen.getByRole("button", { name: "Previous" }));

    expect(scrollBySpy).toHaveBeenCalledOnce();
    expect(scrollBySpy).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth" }),
    );
  });

  it("renders title when provided", () => {
    render(
      <Carousel title="Featured items">
        <Carousel.Track>
          <Carousel.Item>Slide 1</Carousel.Item>
        </Carousel.Track>
      </Carousel>,
    );

    expect(screen.getByText("Featured items")).toBeInTheDocument();
  });

  it("uses aria-labelledby when title is provided", () => {
    render(
      <Carousel title="Featured items">
        <Carousel.Track>
          <Carousel.Item>Slide 1</Carousel.Item>
        </Carousel.Track>
      </Carousel>,
    );

    const titleEl = screen.getByText("Featured items");
    const root = getCarouselRoot();
    expect(root).toHaveAttribute("aria-labelledby", titleEl.id);
  });

  it("uses aria-label='Carousel' when no title is provided", () => {
    render(
      <Carousel>
        <Carousel.Track>
          <Carousel.Item>Slide 1</Carousel.Item>
        </Carousel.Track>
      </Carousel>,
    );

    const root = getCarouselRoot();
    expect(root).toHaveAttribute("aria-label", "Carousel");
  });

  it("track has role='region' with aria-label='Carousel items'", () => {
    render(
      <Carousel>
        <Carousel.Track>
          <Carousel.Item>Slide 1</Carousel.Item>
        </Carousel.Track>
      </Carousel>,
    );

    expect(screen.getByRole("region", { name: "Carousel items" })).toBeInTheDocument();
  });

  it("supports keyboard navigation with arrow keys", async () => {
    const user = userEvent.setup();
    render(
      <Carousel>
        <Carousel.Track>
          <Carousel.Item>Slide 1</Carousel.Item>
          <Carousel.Item>Slide 2</Carousel.Item>
        </Carousel.Track>
      </Carousel>,
    );

    const track = screen.getByRole("region", { name: "Carousel items" });
    const scrollBySpy = vi.fn();
    track.scrollBy = scrollBySpy;

    // Focus the carousel root (it has tabIndex={0})
    const root = getCarouselRoot();
    root.focus();

    await user.keyboard("{ArrowRight}");
    expect(scrollBySpy).toHaveBeenCalled();

    scrollBySpy.mockClear();

    await user.keyboard("{ArrowLeft}");
    expect(scrollBySpy).toHaveBeenCalled();
  });
});
