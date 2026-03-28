import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { Text } from "./Text";

describe("Text", () => {
  it("renders a paragraph by default", () => {
    render(<Text>Hello world</Text>);
    const el = screen.getByText("Hello world");
    expect(el.tagName).toBe("P");
  });

  it("uses the default element for heading variants", () => {
    render(<Text variant="h1">Title</Text>);
    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument();
  });

  it("applies variant class for body-1 by default", () => {
    render(<Text>Body text</Text>);
    expect(screen.getByText("Body text").className).toContain("text-body-1");
  });

  it("applies variant class for h2", () => {
    render(<Text variant="h2">Heading 2</Text>);
    expect(screen.getByRole("heading", { level: 2 }).className).toContain("text-h2");
  });

  it("applies variant class for body-2", () => {
    render(<Text variant="body-2">Small body</Text>);
    expect(screen.getByText("Small body").className).toContain("text-body-2");
  });

  it("applies the default primary color class", () => {
    render(<Text>Colored</Text>);
    expect(screen.getByText("Colored").className).toContain("text-fg-primary");
  });

  it("applies the secondary color class", () => {
    render(<Text color="secondary">Secondary</Text>);
    expect(screen.getByText("Secondary").className).toContain("text-fg-secondary");
  });

  it("applies the muted color class", () => {
    render(<Text color="muted">Muted</Text>);
    expect(screen.getByText("Muted").className).toContain("text-fg-muted");
  });

  it("applies the inverse color class", () => {
    render(<Text color="inverse">Inverse</Text>);
    expect(screen.getByText("Inverse").className).toContain("text-fg-inverse");
  });

  it("applies the on-primary color class", () => {
    render(<Text color="on-primary">On Primary</Text>);
    expect(screen.getByText("On Primary").className).toContain("text-fg-on-primary");
  });

  it("changes element with the as prop", () => {
    render(<Text as="span">Span text</Text>);
    expect(screen.getByText("Span text").tagName).toBe("SPAN");
  });

  it("renders as a div when as='div'", () => {
    render(<Text as="div">Div text</Text>);
    expect(screen.getByText("Div text").tagName).toBe("DIV");
  });

  it("applies the weight class for semibold", () => {
    render(<Text weight="semibold">Semi</Text>);
    expect(screen.getByText("Semi").className).toContain("font-semibold");
  });

  it("applies the weight class for bold", () => {
    render(<Text weight="bold">Bold</Text>);
    expect(screen.getByText("Bold").className).toContain("font-bold");
  });

  it("does not apply a weight class when weight is not set", () => {
    render(<Text>No weight</Text>);
    const cls = screen.getByText("No weight").className;
    expect(cls).not.toContain("font-semibold");
    expect(cls).not.toContain("font-bold");
  });

  it("merges custom className", () => {
    render(<Text className="my-custom">Custom</Text>);
    const cls = screen.getByText("Custom").className;
    expect(cls).toContain("my-custom");
    expect(cls).toContain("text-body-1");
  });

  it("forwards ref to the rendered element", () => {
    const ref = createRef<HTMLParagraphElement>();
    render(<Text ref={ref}>Ref test</Text>);
    expect(ref.current).toBeInstanceOf(HTMLElement);
    expect(ref.current?.textContent).toBe("Ref test");
  });

  it("passes through additional HTML attributes", () => {
    render(<Text data-testid="custom-text" id="my-text">Attrs</Text>);
    const el = screen.getByTestId("custom-text");
    expect(el.id).toBe("my-text");
  });
});
