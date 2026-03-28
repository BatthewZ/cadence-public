import { Search, X } from "lucide-react";
import { type ComponentPropsWithRef, forwardRef } from "react";

import { cn } from "@/web/util/style/style";

import { Input } from "./Input";

type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  size?: "sm" | "md";
} & Omit<ComponentPropsWithRef<"input">, "onChange" | "value" | "type" | "size">;

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(
    {
      value,
      onChange,
      onClear,
      onKeyDown,
      placeholder = "Search...",
      size = "md",
      className,
      ...props
    },
    ref
  ) {
    const iconSize = size === "sm" ? 14 : 16;

    function handleClear() {
      onChange("");
      onClear?.();
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
      if (e.key === "Escape") {
        handleClear();
      }
      onKeyDown?.(e);
    }

    return (
      <div className={cn("search-input", className)}>
        <Search
          size={iconSize}
          className="search-input__icon"
          aria-hidden="true"
        />
        <Input
          ref={ref}
          type="search"
          role="searchbox"
          aria-label="Search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            "search-input__input",
            size === "sm" && "search-input__input--sm"
          )}
          {...props}
        />
        {value && (
          <button
            type="button"
            className="search-input__clear"
            onClick={handleClear}
            aria-label="Clear search"
          >
            <X size={iconSize} />
          </button>
        )}
      </div>
    );
  }
);
