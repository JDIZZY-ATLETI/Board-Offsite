// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MaskedSIN, toSafeMask } from "@/components/app/masked-sin";

const NINE_DIGITS = /\d{9}/;

describe("MaskedSIN (P6)", () => {
  it("renders the masked form with an accessible label", () => {
    render(<MaskedSIN masked="***-***-563" initials="A.A." />);
    const el = screen.getByTestId("masked-sin");
    expect(el).toHaveTextContent("***-***-563");
    expect(el).toHaveTextContent("A.A.");
    expect(screen.getByLabelText("SIN ending in 563")).toBeInTheDocument();
  });

  it("never renders 9 contiguous digits even when handed a full SIN", () => {
    const { container } = render(<MaskedSIN masked={"046" + "454" + "286"} />);
    expect(container.textContent).not.toMatch(NINE_DIGITS);
    expect(container.textContent).toContain("***-***-286");
  });

  it("handles null and garbage input", () => {
    expect(toSafeMask(null)).toBe("***-***-***");
    expect(toSafeMask("abc")).toBe("***-***-***");
    expect(toSafeMask("7")).toBe("***-***-**7");
    render(<MaskedSIN masked={null} />);
    expect(screen.getByLabelText("SIN not available")).toBeInTheDocument();
  });
});