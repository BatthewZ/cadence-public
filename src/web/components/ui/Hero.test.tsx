import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { Hero } from "./Hero";

// Mock animation components to avoid their side-effects in tests
vi.mock("@/web/components/animation/Parallax", () => ({
  Parallax: ({ children, ...props }: { children: React.ReactNode }) => (
    <div data-testid="parallax" {...props}>{children}</div>
  ),
}));

vi.mock("@/web/components/animation/ScrollReveal", () => ({
  ScrollReveal: ({ children, ...props }: { children: React.ReactNode }) => (
    <div data-testid="scroll-reveal" {...props}>{children}</div>
  ),
}));

vi.mock("@/web/components/animation/Stagger", () => ({
  Stagger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="stagger">{children}</div>
  ),
}));

describe("Hero", () => {
  describe("Root", () => {
    it("renders a section element", () => {
      render(<Hero>Content</Hero>);
      const section = screen.getByText("Content").closest("section");
      expect(section).toBeInTheDocument();
    });

    it("applies hero base class", () => {
      render(<Hero data-testid="hero">Content</Hero>);
      expect(screen.getByTestId("hero").className).toContain("hero");
    });

    it("applies the default md size class", () => {
      render(<Hero data-testid="hero">Content</Hero>);
      expect(screen.getByTestId("hero").className).toContain("hero--md");
    });

    it("applies sm size class", () => {
      render(<Hero data-testid="hero" size="sm">Content</Hero>);
      expect(screen.getByTestId("hero").className).toContain("hero--sm");
    });

    it("applies lg size class", () => {
      render(<Hero data-testid="hero" size="lg">Content</Hero>);
      expect(screen.getByTestId("hero").className).toContain("hero--lg");
    });

    it("applies full size class", () => {
      render(<Hero data-testid="hero" size="full">Content</Hero>);
      expect(screen.getByTestId("hero").className).toContain("hero--full");
    });

    it("applies the default end alignment class", () => {
      render(<Hero data-testid="hero">Content</Hero>);
      expect(screen.getByTestId("hero").className).toContain("hero--align-end");
    });

    it("applies start alignment class", () => {
      render(<Hero data-testid="hero" align="start">Content</Hero>);
      expect(screen.getByTestId("hero").className).toContain("hero--align-start");
    });

    it("applies center alignment class", () => {
      render(<Hero data-testid="hero" align="center">Content</Hero>);
      expect(screen.getByTestId("hero").className).toContain("hero--align-center");
    });

    it("renders the overlay by default", () => {
      const { container } = render(<Hero>Content</Hero>);
      const overlay = container.querySelector(".hero__overlay");
      expect(overlay).toBeInTheDocument();
      expect(overlay?.getAttribute("aria-hidden")).toBe("true");
    });

    it("does not render the overlay when overlay is false", () => {
      const { container } = render(<Hero overlay={false}>Content</Hero>);
      expect(container.querySelector(".hero__overlay")).not.toBeInTheDocument();
    });

    it("merges custom className", () => {
      render(<Hero data-testid="hero" className="my-hero">Content</Hero>);
      const cls = screen.getByTestId("hero").className;
      expect(cls).toContain("hero");
      expect(cls).toContain("my-hero");
    });

    it("forwards ref", () => {
      const ref = createRef<HTMLElement>();
      render(<Hero ref={ref}>Content</Hero>);
      expect(ref.current).toBeInstanceOf(HTMLElement);
      expect(ref.current?.tagName).toBe("SECTION");
    });
  });

  describe("Background", () => {
    it("renders a div with hero__background class", () => {
      render(<Hero.Background data-testid="bg" />);
      expect(screen.getByTestId("bg").className).toContain("hero__background");
    });

    it("renders an image when src is provided", () => {
      render(<Hero.Background src="/hero.jpg" alt="Hero image" />);
      const img = screen.getByRole("img", { name: "Hero image" });
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute("src", "/hero.jpg");
    });

    it("renders image with role=presentation when no alt", () => {
      render(<Hero.Background src="/hero.jpg" />);
      expect(screen.getByRole("presentation")).toBeInTheDocument();
    });

    it("does not render an image when src is not provided", () => {
      const { container } = render(<Hero.Background data-testid="bg" />);
      expect(container.querySelector("img")).not.toBeInTheDocument();
    });

    it("wraps image in Parallax when parallax is true", () => {
      render(<Hero.Background src="/hero.jpg" parallax />);
      expect(screen.getByTestId("parallax")).toBeInTheDocument();
    });

    it("applies parallax class when parallax is true", () => {
      render(<Hero.Background src="/hero.jpg" parallax data-testid="bg" />);
      expect(screen.getByTestId("bg").className).toContain("hero__background--parallax");
    });

    it("does not apply parallax class when parallax is false", () => {
      render(<Hero.Background src="/hero.jpg" data-testid="bg" />);
      expect(screen.getByTestId("bg").className).not.toContain("hero__background--parallax");
    });

    it("merges custom className", () => {
      render(<Hero.Background className="custom-bg" data-testid="bg" />);
      const cls = screen.getByTestId("bg").className;
      expect(cls).toContain("hero__background");
      expect(cls).toContain("custom-bg");
    });

    it("forwards ref", () => {
      const ref = createRef<HTMLDivElement>();
      render(<Hero.Background ref={ref} />);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });

  describe("Content", () => {
    it("renders a div with hero__content class", () => {
      render(<Hero.Content data-testid="content">Text</Hero.Content>);
      expect(screen.getByTestId("content").className).toContain("hero__content");
    });

    it("renders children directly when animate is false", () => {
      render(<Hero.Content>Plain content</Hero.Content>);
      expect(screen.getByText("Plain content")).toBeInTheDocument();
      expect(screen.queryByTestId("scroll-reveal")).not.toBeInTheDocument();
    });

    it("wraps children in ScrollReveal and Stagger when animate is true", () => {
      render(<Hero.Content animate>Animated content</Hero.Content>);
      expect(screen.getByTestId("scroll-reveal")).toBeInTheDocument();
      expect(screen.getByTestId("stagger")).toBeInTheDocument();
      expect(screen.getByText("Animated content")).toBeInTheDocument();
    });

    it("merges custom className", () => {
      render(<Hero.Content className="custom-content" data-testid="content">C</Hero.Content>);
      const cls = screen.getByTestId("content").className;
      expect(cls).toContain("hero__content");
      expect(cls).toContain("custom-content");
    });

    it("forwards ref", () => {
      const ref = createRef<HTMLDivElement>();
      render(<Hero.Content ref={ref}>Ref</Hero.Content>);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });

  describe("Compound usage", () => {
    it("renders a complete hero composition", () => {
      render(
        <Hero data-testid="hero" size="lg" align="center">
          <Hero.Background src="/bg.jpg" alt="Background" />
          <Hero.Content>
            <h1>Welcome</h1>
            <p>Subtitle text</p>
            <button>Get Started</button>
          </Hero.Content>
        </Hero>
      );

      expect(screen.getByTestId("hero")).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "Background" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Welcome" })).toBeInTheDocument();
      expect(screen.getByText("Subtitle text")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Get Started" })).toBeInTheDocument();
    });
  });
});
