import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PasswordRequirements } from "./PasswordRequirements";

describe("PasswordRequirements", () => {
  it("renders all four default requirements", () => {
    render(<PasswordRequirements password="" />);
    const list = screen.getByRole("list", { name: "Password requirements" });
    const items = screen.getAllByRole("listitem");
    expect(list).toBeInTheDocument();
    expect(items).toHaveLength(4);
  });

  it("marks 'At least 8 characters' as unmet for short passwords", () => {
    render(<PasswordRequirements password="short" />);
    const item = screen.getByText("At least 8 characters").closest("li");
    expect(item?.className).toContain("password-requirements__item--unmet");
  });

  it("marks 'At least 8 characters' as met for passwords with 8+ chars", () => {
    render(<PasswordRequirements password="longpassword" />);
    const item = screen.getByText("At least 8 characters").closest("li");
    expect(item?.className).toContain("password-requirements__item--met");
  });

  it("marks uppercase requirement as met when password contains uppercase", () => {
    render(<PasswordRequirements password="Password" />);
    const item = screen.getByText("Contains an uppercase letter").closest("li");
    expect(item?.className).toContain("password-requirements__item--met");
  });

  it("marks uppercase requirement as unmet when password has no uppercase", () => {
    render(<PasswordRequirements password="password" />);
    const item = screen.getByText("Contains an uppercase letter").closest("li");
    expect(item?.className).toContain("password-requirements__item--unmet");
  });

  it("marks lowercase requirement as met when password contains lowercase", () => {
    render(<PasswordRequirements password="password" />);
    const item = screen.getByText("Contains a lowercase letter").closest("li");
    expect(item?.className).toContain("password-requirements__item--met");
  });

  it("marks lowercase requirement as unmet when password is all uppercase", () => {
    render(<PasswordRequirements password="PASSWORD" />);
    const item = screen.getByText("Contains a lowercase letter").closest("li");
    expect(item?.className).toContain("password-requirements__item--unmet");
  });

  it("marks number requirement as met when password contains a digit", () => {
    render(<PasswordRequirements password="pass1" />);
    const item = screen.getByText("Contains a number").closest("li");
    expect(item?.className).toContain("password-requirements__item--met");
  });

  it("marks number requirement as unmet when password has no digits", () => {
    render(<PasswordRequirements password="password" />);
    const item = screen.getByText("Contains a number").closest("li");
    expect(item?.className).toContain("password-requirements__item--unmet");
  });

  it("marks all requirements as met for a strong password", () => {
    render(<PasswordRequirements password="Str0ngPwd" />);
    const items = screen.getAllByRole("listitem");
    for (const item of items) {
      expect(item.className).toContain("password-requirements__item--met");
    }
  });

  it("marks all requirements as unmet for an empty password", () => {
    render(<PasswordRequirements password="" />);
    const items = screen.getAllByRole("listitem");
    for (const item of items) {
      expect(item.className).toContain("password-requirements__item--unmet");
    }
  });

  it("accepts custom requirements", () => {
    const customRequirements = [
      { label: "Has exclamation mark", test: (pw: string) => pw.includes("!") },
    ];
    render(<PasswordRequirements password="hello!" requirements={customRequirements} />);
    expect(screen.getByText("Has exclamation mark")).toBeInTheDocument();
    const item = screen.getByText("Has exclamation mark").closest("li");
    expect(item?.className).toContain("password-requirements__item--met");
  });

  it("forwards ref to the ul element", () => {
    const ref = { current: null as HTMLUListElement | null };
    render(<PasswordRequirements ref={ref} password="" />);
    expect(ref.current).toBeInstanceOf(HTMLUListElement);
  });

  it("merges custom className", () => {
    render(<PasswordRequirements password="" className="my-custom" />);
    const list = screen.getByRole("list", { name: "Password requirements" });
    expect(list.className).toContain("password-requirements");
    expect(list.className).toContain("my-custom");
  });
});
