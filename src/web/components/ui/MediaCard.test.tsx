import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MediaCard } from "./MediaCard";

describe("MediaCard", () => {
  it("renders as an article element", () => {
    render(
      <MediaCard>
        <MediaCard.Image src="/photo.jpg" alt="A photo" />
      </MediaCard>,
    );
    expect(screen.getByRole("article")).toBeInTheDocument();
  });

  it("renders an image with src and alt text", () => {
    render(
      <MediaCard>
        <MediaCard.Image src="/photo.jpg" alt="Sunset" />
      </MediaCard>,
    );
    const img = screen.getByRole("img", { name: "Sunset" });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "/photo.jpg");
  });

  it("renders title and description via Content", () => {
    render(
      <MediaCard>
        <MediaCard.Image src="/img.jpg" alt="Pic" />
        <MediaCard.Content>
          <h3>Card Title</h3>
          <p>Card description text</p>
        </MediaCard.Content>
      </MediaCard>,
    );
    expect(screen.getByRole("heading", { level: 3, name: "Card Title" })).toBeInTheDocument();
    expect(screen.getByText("Card description text")).toBeInTheDocument();
  });

  it("applies portrait orientation class by default", () => {
    const { container } = render(
      <MediaCard>
        <MediaCard.Image src="/photo.jpg" alt="Photo" />
      </MediaCard>,
    );
    const imageContainer = container.querySelector(".media-card__image-container");
    expect(imageContainer?.className).toContain("media-card__image-container--portrait");
  });

  it("applies landscape orientation class", () => {
    const { container } = render(
      <MediaCard orientation="landscape">
        <MediaCard.Image src="/photo.jpg" alt="Photo" />
      </MediaCard>,
    );
    const imageContainer = container.querySelector(".media-card__image-container");
    expect(imageContainer?.className).toContain("media-card__image-container--landscape");
  });

  it("applies square orientation class", () => {
    const { container } = render(
      <MediaCard orientation="square">
        <MediaCard.Image src="/photo.jpg" alt="Photo" />
      </MediaCard>,
    );
    const imageContainer = container.querySelector(".media-card__image-container");
    expect(imageContainer?.className).toContain("media-card__image-container--square");
  });

  it("renders an action slot", () => {
    render(
      <MediaCard>
        <MediaCard.Image src="/img.jpg" alt="Photo" />
        <MediaCard.Action>
          <button type="button">Play</button>
        </MediaCard.Action>
      </MediaCard>,
    );
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("renders a badge slot", () => {
    render(
      <MediaCard>
        <MediaCard.Image src="/img.jpg" alt="Photo" />
        <MediaCard.Badge>New</MediaCard.Badge>
      </MediaCard>,
    );
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("renders an overlay", () => {
    const { container } = render(
      <MediaCard>
        <MediaCard.Image src="/img.jpg" alt="Photo" />
        <MediaCard.Overlay />
      </MediaCard>,
    );
    const overlay = container.querySelector(".media-card__overlay");
    expect(overlay).toBeInTheDocument();
    expect(overlay).toHaveAttribute("aria-hidden", "true");
  });

  it("forwards className to the root article", () => {
    render(
      <MediaCard className="card-custom">
        <MediaCard.Image src="/img.jpg" alt="Photo" />
      </MediaCard>,
    );
    const article = screen.getByRole("article");
    expect(article.className).toContain("card-custom");
  });
});
