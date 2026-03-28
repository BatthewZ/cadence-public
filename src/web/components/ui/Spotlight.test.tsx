import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Spotlight } from "./Spotlight";

describe("Spotlight", () => {
  it("renders a container with the spotlight class", () => {
    const { container } = render(
      <Spotlight animate={false}>
        <Spotlight.Item>
          <Spotlight.Content>Hello</Spotlight.Content>
        </Spotlight.Item>
      </Spotlight>,
    );
    expect(container.querySelector(".spotlight")).toBeInTheDocument();
  });

  it("renders featured content inside Spotlight.Content", () => {
    render(
      <Spotlight animate={false}>
        <Spotlight.Item>
          <Spotlight.Content>
            <h2>Featured Article</h2>
            <p>Description of the feature.</p>
          </Spotlight.Content>
        </Spotlight.Item>
      </Spotlight>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Featured Article" })).toBeInTheDocument();
    expect(screen.getByText("Description of the feature.")).toBeInTheDocument();
  });

  it("renders an image via Spotlight.Image", () => {
    render(
      <Spotlight animate={false}>
        <Spotlight.Item>
          <Spotlight.Image src="/hero.jpg" alt="Hero image" />
          <Spotlight.Content>Content</Spotlight.Content>
        </Spotlight.Item>
      </Spotlight>,
    );
    const img = screen.getByRole("img", { name: "Hero image" });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "/hero.jpg");
  });

  it("renders image with presentation role when no alt is provided", () => {
    render(
      <Spotlight animate={false}>
        <Spotlight.Item>
          <Spotlight.Image src="/bg.jpg" />
          <Spotlight.Content>Content</Spotlight.Content>
        </Spotlight.Item>
      </Spotlight>,
    );
    expect(screen.getByRole("presentation")).toBeInTheDocument();
  });

  it("applies spotlight-item--reversed class when reversed prop is set", () => {
    const { container } = render(
      <Spotlight animate={false}>
        <Spotlight.Item reversed>
          <Spotlight.Content>Reversed</Spotlight.Content>
        </Spotlight.Item>
      </Spotlight>,
    );
    const item = container.querySelector(".spotlight-item");
    expect(item?.className).toContain("spotlight-item--reversed");
  });

  it("does not apply reversed class by default", () => {
    const { container } = render(
      <Spotlight animate={false}>
        <Spotlight.Item>
          <Spotlight.Content>Normal</Spotlight.Content>
        </Spotlight.Item>
      </Spotlight>,
    );
    const item = container.querySelector(".spotlight-item");
    expect(item?.className).not.toContain("spotlight-item--reversed");
  });

  it("applies spotlight-content class to content", () => {
    const { container } = render(
      <Spotlight animate={false}>
        <Spotlight.Item>
          <Spotlight.Content>Text</Spotlight.Content>
        </Spotlight.Item>
      </Spotlight>,
    );
    expect(container.querySelector(".spotlight-content")).toBeInTheDocument();
  });

  it("applies spotlight-image class to image wrapper", () => {
    const { container } = render(
      <Spotlight animate={false}>
        <Spotlight.Item>
          <Spotlight.Image src="/photo.jpg" alt="Photo" />
        </Spotlight.Item>
      </Spotlight>,
    );
    expect(container.querySelector(".spotlight-image")).toBeInTheDocument();
  });

  it("forwards className to the root container", () => {
    const { container } = render(
      <Spotlight className="custom-spotlight" animate={false}>
        <Spotlight.Item>
          <Spotlight.Content>Text</Spotlight.Content>
        </Spotlight.Item>
      </Spotlight>,
    );
    const root = container.querySelector(".spotlight");
    expect(root?.className).toContain("custom-spotlight");
  });

  it("forwards className to an item", () => {
    const { container } = render(
      <Spotlight animate={false}>
        <Spotlight.Item className="item-custom">
          <Spotlight.Content>Text</Spotlight.Content>
        </Spotlight.Item>
      </Spotlight>,
    );
    const item = container.querySelector(".spotlight-item");
    expect(item?.className).toContain("item-custom");
  });
});
