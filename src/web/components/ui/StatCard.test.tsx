import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { StatCard } from "./StatCard";

// Mock the reduced motion hook to avoid IntersectionObserver issues
vi.mock("@/web/hooks/use-reduced-motion", () => ({
  usePrefersReducedMotion: () => true,
}));

describe("StatCard", () => {
  describe("Root", () => {
    it("renders a div with stat-card class", () => {
      render(<StatCard data-testid="card">Content</StatCard>);
      const el = screen.getByTestId("card");
      expect(el.tagName).toBe("DIV");
      expect(el.className).toContain("stat-card");
    });

    it("merges custom className", () => {
      render(<StatCard data-testid="card" className="custom">Content</StatCard>);
      const el = screen.getByTestId("card");
      expect(el.className).toContain("stat-card");
      expect(el.className).toContain("custom");
    });

    it("forwards ref", () => {
      const ref = createRef<HTMLDivElement>();
      render(<StatCard ref={ref}>Content</StatCard>);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });

  describe("Label", () => {
    it("renders a span with stat-card__label class", () => {
      render(<StatCard.Label>Total Users</StatCard.Label>);
      const el = screen.getByText("Total Users");
      expect(el.tagName).toBe("SPAN");
      expect(el.className).toContain("stat-card__label");
    });

    it("merges custom className", () => {
      render(<StatCard.Label className="extra">Label</StatCard.Label>);
      const el = screen.getByText("Label");
      expect(el.className).toContain("stat-card__label");
      expect(el.className).toContain("extra");
    });

    it("forwards ref", () => {
      const ref = createRef<HTMLSpanElement>();
      render(<StatCard.Label ref={ref}>Label</StatCard.Label>);
      expect(ref.current).toBeInstanceOf(HTMLSpanElement);
    });
  });

  describe("Value", () => {
    it("renders children when animateValue is false", () => {
      render(<StatCard.Value>1,234</StatCard.Value>);
      expect(screen.getByText("1,234")).toBeInTheDocument();
    });

    it("renders a span with stat-card__value class", () => {
      render(<StatCard.Value>99</StatCard.Value>);
      const el = screen.getByText("99");
      expect(el.tagName).toBe("SPAN");
      expect(el.className).toContain("stat-card__value");
    });

    it("shows final formatted value when animateValue is true and reduced motion", () => {
      render(<StatCard.Value animateValue from={0} to={500} />);
      expect(screen.getByText("500")).toBeInTheDocument();
    });

    it("uses custom format function", () => {
      const format = (v: number) => `$${v}`;
      render(<StatCard.Value animateValue from={0} to={100} format={format} />);
      expect(screen.getByText("$100")).toBeInTheDocument();
    });

    it("merges custom className", () => {
      render(<StatCard.Value className="big-value">42</StatCard.Value>);
      const el = screen.getByText("42");
      expect(el.className).toContain("stat-card__value");
      expect(el.className).toContain("big-value");
    });

    it("forwards ref", () => {
      const ref = createRef<HTMLSpanElement>();
      render(<StatCard.Value ref={ref}>0</StatCard.Value>);
      expect(ref.current).toBeInstanceOf(HTMLSpanElement);
    });
  });

  describe("Trend", () => {
    it("renders an up trend with + sign and percentage", () => {
      render(<StatCard.Trend value={12} direction="up" data-testid="trend" />);
      const el = screen.getByTestId("trend");
      expect(el.textContent).toContain("+");
      expect(el.textContent).toContain("12%");
    });

    it("renders a down trend with - sign and percentage", () => {
      render(<StatCard.Trend value={5} direction="down" data-testid="trend" />);
      const el = screen.getByTestId("trend");
      expect(el.textContent).toContain("-");
      expect(el.textContent).toContain("5%");
    });

    it("renders a neutral trend without a sign", () => {
      render(<StatCard.Trend value={0} direction="neutral" data-testid="trend" />);
      const el = screen.getByTestId("trend");
      expect(el.textContent).not.toContain("+");
      expect(el.textContent).not.toContain("-");
      expect(el.textContent).toContain("0%");
    });

    it("applies direction-specific class for up", () => {
      render(<StatCard.Trend value={10} direction="up" data-testid="trend" />);
      expect(screen.getByTestId("trend").className).toContain("stat-card__trend--up");
    });

    it("applies direction-specific class for down", () => {
      render(<StatCard.Trend value={3} direction="down" data-testid="trend" />);
      expect(screen.getByTestId("trend").className).toContain("stat-card__trend--down");
    });

    it("applies direction-specific class for neutral", () => {
      render(<StatCard.Trend value={0} direction="neutral" data-testid="trend" />);
      expect(screen.getByTestId("trend").className).toContain("stat-card__trend--neutral");
    });

    it("renders a trend arrow for up/down but not neutral", () => {
      const { container: upContainer } = render(
        <StatCard.Trend value={5} direction="up" />
      );
      expect(upContainer.querySelector("svg")).toBeInTheDocument();

      const { container: neutralContainer } = render(
        <StatCard.Trend value={0} direction="neutral" />
      );
      expect(neutralContainer.querySelectorAll("svg")).toHaveLength(0);
    });

    it("uses absolute value for display", () => {
      render(<StatCard.Trend value={-8} direction="down" data-testid="trend" />);
      expect(screen.getByTestId("trend").textContent).toContain("8%");
    });

    it("merges custom className", () => {
      render(<StatCard.Trend value={1} direction="up" className="extra" data-testid="trend" />);
      const el = screen.getByTestId("trend");
      expect(el.className).toContain("stat-card__trend");
      expect(el.className).toContain("extra");
    });

    it("forwards ref", () => {
      const ref = createRef<HTMLSpanElement>();
      render(<StatCard.Trend ref={ref} value={1} direction="up" />);
      expect(ref.current).toBeInstanceOf(HTMLSpanElement);
    });
  });

  describe("Icon", () => {
    it("renders a div with stat-card__icon class", () => {
      render(<StatCard.Icon data-testid="icon">Icon</StatCard.Icon>);
      const el = screen.getByTestId("icon");
      expect(el.tagName).toBe("DIV");
      expect(el.className).toContain("stat-card__icon");
    });

    it("merges custom className", () => {
      render(<StatCard.Icon className="custom-icon" data-testid="icon">I</StatCard.Icon>);
      const el = screen.getByTestId("icon");
      expect(el.className).toContain("stat-card__icon");
      expect(el.className).toContain("custom-icon");
    });

    it("forwards ref", () => {
      const ref = createRef<HTMLDivElement>();
      render(<StatCard.Icon ref={ref}>I</StatCard.Icon>);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });

  describe("Compound usage", () => {
    it("renders a full stat card composition", () => {
      render(
        <StatCard data-testid="stat">
          <StatCard.Icon>$</StatCard.Icon>
          <StatCard.Label>Revenue</StatCard.Label>
          <StatCard.Value>$50,000</StatCard.Value>
          <StatCard.Trend value={15} direction="up" data-testid="trend" />
        </StatCard>
      );

      expect(screen.getByTestId("stat")).toBeInTheDocument();
      expect(screen.getByText("Revenue")).toBeInTheDocument();
      expect(screen.getByText("$50,000")).toBeInTheDocument();
      expect(screen.getByTestId("trend").textContent).toContain("+15%");
    });
  });
});
