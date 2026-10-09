// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ColumnDef } from "@tanstack/react-table";
import { describe, expect, it, vi } from "vitest";
import { DataTable } from "@/components/app/data-table/data-table";

interface Row {
  id: string;
  name: string;
  n: number;
}

const rows: Row[] = [
  { id: "a", name: "Charlie", n: 3 },
  { id: "b", name: "Alpha", n: 1 },
  { id: "c", name: "Bravo", n: 2 },
];

const columns: ColumnDef<Row, unknown>[] = [
  { id: "name", header: "Name", accessorKey: "name" },
  { id: "n", header: "N", accessorKey: "n", meta: { align: "right" } },
];

function names() {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[0].textContent);
}

describe("DataTable (section 4.4 / 8.2)", () => {
  it("renders a visually-hidden caption and sortable headers with aria-sort", () => {
    render(<DataTable columns={columns} data={rows} rowId={(r) => r.id} caption="Test rows" emptyState={{ title: "none" }} />);
    expect(screen.getByText("Test rows")).toHaveClass("sr-only");
    const nameHeader = screen.getByRole("columnheader", { name: /name/i });
    expect(nameHeader).toHaveAttribute("aria-sort", "none");
  });

  it("sorts client-side when a header button is clicked", () => {
    render(<DataTable columns={columns} data={rows} rowId={(r) => r.id} caption="Test rows" emptyState={{ title: "none" }} />);
    expect(names()).toEqual(["Charlie", "Alpha", "Bravo"]);
    fireEvent.click(screen.getByRole("button", { name: /name/i }));
    expect(names()).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(screen.getByRole("columnheader", { name: /name/i })).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(screen.getByRole("button", { name: /name/i }));
    expect(names()).toEqual(["Charlie", "Bravo", "Alpha"]);
  });

  it("supports roving focus with arrow keys, Home/End and Enter", () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} data={rows} rowId={(r) => r.id} caption="Test rows" emptyState={{ title: "none" }} onRowClick={onRowClick} sorting="none" />);
    const body = screen.getAllByRole("row").slice(1);
    expect(body[0]).toHaveAttribute("tabindex", "0");
    expect(body[1]).toHaveAttribute("tabindex", "-1");
    body[0].focus();
    fireEvent.keyDown(body[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(body[1]);
    fireEvent.keyDown(body[1], { key: "End" });
    expect(document.activeElement).toBe(body[2]);
    fireEvent.keyDown(body[2], { key: "Home" });
    expect(document.activeElement).toBe(body[0]);
    fireEvent.keyDown(body[0], { key: "Enter" });
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it("expands with ArrowRight and collapses with ArrowLeft", () => {
    render(<DataTable columns={columns} data={rows} rowId={(r) => r.id} caption="Test rows" emptyState={{ title: "none" }} sorting="none" expandable={{ render: (r) => <div>Detail {r.name}</div> }} />);
    const first = screen.getAllByRole("row")[1];
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("region", { name: "Row details" })).toHaveTextContent("Detail Charlie");
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(screen.queryByRole("region", { name: "Row details" })).toBeNull();
  });

  it("renders the empty state and the loading skeleton", () => {
    const { rerender } = render(<DataTable columns={columns} data={[]} rowId={(r) => r.id} caption="Test rows" emptyState={{ title: "Nothing here", description: "Try again" }} />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    rerender(<DataTable columns={columns} data={[]} rowId={(r) => r.id} caption="Test rows" emptyState={{ title: "Nothing here" }} state={{ status: "loading" }} />);
    expect(screen.getByRole("region", { name: "Test rows" })).toHaveAttribute("aria-busy", "true");
  });

  it("groups rows under rowgroup headers", () => {
    render(<DataTable columns={columns} data={rows} rowId={(r) => r.id} caption="Test rows" emptyState={{ title: "none" }} sorting="none" groupBy={{ getKey: (r) => (r.n > 1 ? "big" : "small"), renderHeader: (k, rs) => <span>{`${k} (${rs.length})`}</span> }} />);
    expect(screen.getByText("big (2)")).toBeInTheDocument();
    expect(screen.getByText("small (1)")).toBeInTheDocument();
  });
});