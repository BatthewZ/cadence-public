import {
  type ComponentPropsWithRef,
  createContext,
  forwardRef,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { mergeRefs } from "@/web/util/merge-refs";
import { cn } from "@/web/util/style/style";

import { IconButton } from "./IconButton";

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

type CarouselContextValue = {
  trackRef: RefObject<HTMLDivElement | null>;
  canScrollPrev: boolean;
  canScrollNext: boolean;
  scrollPrev: () => void;
  scrollNext: () => void;
};

const CarouselContext = createContext<CarouselContextValue | null>(null);

function useCarouselContext() {
  const ctx = useContext(CarouselContext);
  if (!ctx) throw new Error("Carousel compound components must be used within <Carousel>");
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Carousel (root)                                                    */
/* ------------------------------------------------------------------ */

type CarouselProps = {
  title?: ReactNode;
} & Omit<ComponentPropsWithRef<"div">, "title">;

const CarouselRoot = forwardRef<HTMLDivElement, CarouselProps>(function Carousel(
  { title, className, children, ...props },
  ref
) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const updateScrollState = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;

    setCanScrollPrev(track.scrollLeft > 0);
    setCanScrollNext(track.scrollLeft + track.clientWidth < track.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    // Initial check
    updateScrollState();

    // Scroll listener with rAF debounce
    let rafId = 0;
    function handleScroll() {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updateScrollState);
    }

    track.addEventListener("scroll", handleScroll, { passive: true });

    // Resize observer for dynamic content
    const observer = new ResizeObserver(() => {
      updateScrollState();
    });
    observer.observe(track);

    return () => {
      track.removeEventListener("scroll", handleScroll);
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [updateScrollState]);

  const scrollPrev = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;

    const peek = parseFloat(getComputedStyle(track).paddingLeft) || 0;
    track.scrollBy({ left: -(track.clientWidth - peek), behavior: "smooth" });
  }, []);

  const scrollNext = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;

    const peek = parseFloat(getComputedStyle(track).paddingLeft) || 0;
    track.scrollBy({ left: track.clientWidth - peek, behavior: "smooth" });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        scrollPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        scrollNext();
      }
    },
    [scrollPrev, scrollNext]
  );

  const baseId = useId();
  const titleId = title ? `${baseId}-carousel-title` : undefined;

  return (
    <CarouselContext.Provider
      value={{ trackRef, canScrollPrev, canScrollNext, scrollPrev, scrollNext }}
    >
      <div
        ref={ref}
        className={cn("carousel", className)}
        aria-roledescription="carousel"
        aria-label={titleId ? undefined : "Carousel"}
        aria-labelledby={titleId}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        {...props}
      >
        {title && (
          <div id={titleId} className="carousel-title">
            {title}
          </div>
        )}
        {children}
        <IconButton
          aria-label="Previous"
          className="carousel-arrow carousel-arrow--prev"
          data-hidden={!canScrollPrev}
          onClick={scrollPrev}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M10 12L6 8L10 4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </IconButton>
        <IconButton
          aria-label="Next"
          className="carousel-arrow carousel-arrow--next"
          data-hidden={!canScrollNext}
          onClick={scrollNext}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M6 4L10 8L6 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </IconButton>
      </div>
    </CarouselContext.Provider>
  );
});

/* ------------------------------------------------------------------ */
/*  Carousel.Track                                                     */
/* ------------------------------------------------------------------ */

type CarouselTrackProps = ComponentPropsWithRef<"div">;

const CarouselTrack = forwardRef<HTMLDivElement, CarouselTrackProps>(function CarouselTrack(
  { className, onMouseDown, onClickCapture, ...props },
  forwardedRef
) {
  const { trackRef } = useCarouselContext();
  const dragState = useRef({
    isDragging: false,
    startX: 0,
    startScroll: 0,
    didDrag: false,
    velocity: 0,
    prevX: 0,
    prevTime: 0,
  });

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      onMouseDown?.(e);
      if (e.button !== 0) return; // left click only
      e.preventDefault(); // prevent native image drag from hijacking the gesture
      const track = trackRef.current;
      if (!track) return;

      const now = performance.now();
      dragState.current = {
        isDragging: true,
        startX: e.clientX,
        startScroll: track.scrollLeft,
        didDrag: false,
        prevX: e.clientX,
        prevTime: now,
        velocity: 0,
      };
      track.classList.add("carousel-track--dragging");
    },
    [onMouseDown, trackRef]
  );

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    function handleMouseMove(e: MouseEvent) {
      const state = dragState.current;
      if (!state.isDragging) return;

      const now = performance.now();
      const dt = now - state.prevTime;

      const dx = e.clientX - state.startX;
      if (Math.abs(dx) > 3) state.didDrag = true;
      track!.scrollLeft = state.startScroll - dx;

      // Track velocity (px/ms), smoothed with previous value
      if (dt > 0) {
        const instantVelocity = (state.prevX - e.clientX) / dt;
        state.velocity = 0.7 * instantVelocity + 0.3 * state.velocity;
      }
      state.prevX = e.clientX;
      state.prevTime = now;
    }

    function handleMouseUp() {
      const state = dragState.current;
      if (!state.isDragging) return;
      state.isDragging = false;
      track!.classList.remove("carousel-track--dragging");

      const elapsed = performance.now() - state.prevTime;
      const hasVelocity = elapsed < 100 && Math.abs(state.velocity) > 0.1;

      if (hasVelocity) {
        // Animate from current drag position directly to one frame away
        // from where the drag started — same distance as the arrow buttons.
        const peek = parseFloat(getComputedStyle(track!).paddingLeft) || 0;
        const frameSize = track!.clientWidth - peek;
        const target =
          state.velocity > 0 ? state.startScroll + frameSize : state.startScroll - frameSize;
        track!.scrollTo({ left: target, behavior: "smooth" });
      }
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [trackRef]);

  const handleClickCapture = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Prevent click on children after a drag
      if (dragState.current.didDrag) {
        e.preventDefault();
        e.stopPropagation();
        dragState.current.didDrag = false;
        return;
      }
      onClickCapture?.(e);
    },
    [onClickCapture]
  );

  return (
    <div
      ref={mergeRefs(forwardedRef, trackRef)}
      role="region"
      aria-label="Carousel items"
      className={cn("carousel-track", className)}
      onMouseDown={handleMouseDown}
      onClickCapture={handleClickCapture}
      {...props}
    />
  );
});

/* ------------------------------------------------------------------ */
/*  Carousel.Item                                                      */
/* ------------------------------------------------------------------ */

type CarouselItemProps = ComponentPropsWithRef<"div">;

const CarouselItem = forwardRef<HTMLDivElement, CarouselItemProps>(function CarouselItem(
  { className, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      role="group"
      aria-roledescription="slide"
      className={cn("carousel-item", className)}
      {...props}
    />
  );
});

/* ------------------------------------------------------------------ */
/*  Compound export                                                    */
/* ------------------------------------------------------------------ */

export const Carousel = Object.assign(CarouselRoot, {
  Track: CarouselTrack,
  Item: CarouselItem,
});
