import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { type ComponentPropsWithRef, forwardRef } from "react";

import { cn } from "@/web/util/style/style";

import { IconButton } from "./IconButton";

function getPageRange(
  page: number,
  totalPages: number,
  siblingCount: number
): (number | "ellipsis")[] {
  const totalPageNumbers = siblingCount * 2 + 5;

  if (totalPages <= totalPageNumbers) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const leftSiblingIndex = Math.max(page - siblingCount, 1);
  const rightSiblingIndex = Math.min(page + siblingCount, totalPages);

  const showLeftEllipsis = leftSiblingIndex > 2;
  const showRightEllipsis = rightSiblingIndex < totalPages - 1;

  const result: (number | "ellipsis")[] = [];

  // Always include page 1
  result.push(1);

  if (showLeftEllipsis) {
    result.push("ellipsis");
  } else {
    // Fill pages between 1 and leftSiblingIndex
    for (let i = 2; i < leftSiblingIndex; i++) result.push(i);
  }

  // Sibling pages + current page
  for (let i = leftSiblingIndex; i <= rightSiblingIndex; i++) {
    if (i !== 1 && i !== totalPages) result.push(i);
  }

  if (showRightEllipsis) {
    result.push("ellipsis");
  } else {
    for (let i = rightSiblingIndex + 1; i < totalPages; i++) result.push(i);
  }

  // Always include last page
  if (totalPages > 1) result.push(totalPages);

  return result;
}

type PaginationProps = {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  siblingCount?: number;
  showEdges?: boolean;
  variant?: "full" | "compact";
} & Omit<ComponentPropsWithRef<"nav">, "children">;

export const Pagination = forwardRef<HTMLElement, PaginationProps>(
  function Pagination(
    {
      page,
      totalPages,
      onPageChange,
      siblingCount = 1,
      showEdges = true,
      variant = "full",
      className,
      ...props
    },
    ref
  ) {
    const isFirst = page <= 1;
    const isLast = page >= totalPages;

    return (
      <nav
        ref={ref}
        aria-label="Pagination"
        className={cn("pagination", className)}
        {...props}
      >
        <ul className="pagination__list">
          {/* First page button (full only, when showEdges) */}
          {variant === "full" && showEdges && (
            <li>
              <IconButton
                aria-label="First page"
                disabled={isFirst}
                onClick={() => onPageChange(1)}
                className="pagination__nav"
              >
                <ChevronsLeft size={16} />
              </IconButton>
            </li>
          )}

          {/* Prev button */}
          <li>
            <IconButton
              aria-label="Previous page"
              disabled={isFirst}
              onClick={() => onPageChange(page - 1)}
              className="pagination__nav"
            >
              <ChevronLeft size={16} />
            </IconButton>
          </li>

          {variant === "full" ? (
            // Page number buttons
            getPageRange(page, totalPages, siblingCount).map((item, i) =>
              item === "ellipsis" ? (
                <li
                  key={`ellipsis-${i}`}
                  className="pagination__ellipsis"
                  aria-hidden="true"
                >
                  <span>&hellip;</span>
                </li>
              ) : (
                <li key={item}>
                  <button
                    type="button"
                    className={cn(
                      "pagination__page",
                      item === page && "pagination__page--current"
                    )}
                    aria-current={item === page ? "page" : undefined}
                    aria-label={`Page ${item}`}
                    onClick={() => onPageChange(item)}
                  >
                    {item}
                  </button>
                </li>
              )
            )
          ) : (
            // Compact: "Page X of Y"
            <li className="pagination__info">
              <span>
                Page <strong>{page}</strong> of <strong>{totalPages}</strong>
              </span>
            </li>
          )}

          {/* Next button */}
          <li>
            <IconButton
              aria-label="Next page"
              disabled={isLast}
              onClick={() => onPageChange(page + 1)}
              className="pagination__nav"
            >
              <ChevronRight size={16} />
            </IconButton>
          </li>

          {/* Last page button (full only, when showEdges) */}
          {variant === "full" && showEdges && (
            <li>
              <IconButton
                aria-label="Last page"
                disabled={isLast}
                onClick={() => onPageChange(totalPages)}
                className="pagination__nav"
              >
                <ChevronsRight size={16} />
              </IconButton>
            </li>
          )}
        </ul>
      </nav>
    );
  }
);
