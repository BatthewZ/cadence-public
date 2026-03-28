import { Check, X } from "lucide-react";
import { type ComponentPropsWithRef, forwardRef, useMemo } from "react";

import { cn } from "@/web/util/style/style";

type PasswordRequirement = {
  label: string;
  test: (password: string) => boolean;
};

const DEFAULT_REQUIREMENTS: PasswordRequirement[] = [
  {
    label: "At least 8 characters",
    test: (pw) => pw.length >= 8,
  },
  {
    label: "Contains an uppercase letter",
    test: (pw) => /[A-Z]/.test(pw),
  },
  {
    label: "Contains a lowercase letter",
    test: (pw) => /[a-z]/.test(pw),
  },
  {
    label: "Contains a number",
    test: (pw) => /\d/.test(pw),
  },
];

type PasswordRequirementsProps = {
  /** The current password value to evaluate against requirements. */
  password: string;
  /**
   * Custom requirements to check. Defaults to standard requirements
   * (8+ chars, uppercase, lowercase, number).
   */
  requirements?: PasswordRequirement[];
} & Omit<ComponentPropsWithRef<"ul">, "children">;

/**
 * Real-time password requirements checklist.
 *
 * Provides immediate visual feedback as the user types, preventing the
 * frustration of discovering password rules only after a failed submission.
 * Each requirement displays a check or X icon with green/muted coloring
 * to clearly communicate met vs unmet criteria.
 */
export const PasswordRequirements = forwardRef<HTMLUListElement, PasswordRequirementsProps>(
  function PasswordRequirements(
    { password, requirements = DEFAULT_REQUIREMENTS, className, ...props },
    ref
  ) {
    const results = useMemo(
      () => requirements.map((req) => ({ ...req, met: req.test(password) })),
      [password, requirements]
    );

    return (
      <ul
        ref={ref}
        className={cn("password-requirements", className)}
        aria-label="Password requirements"
        {...props}
      >
        {results.map((req) => (
          <li
            key={req.label}
            className={cn(
              "password-requirements__item",
              req.met
                ? "password-requirements__item--met"
                : "password-requirements__item--unmet"
            )}
          >
            {req.met ? (
              <Check size={14} aria-hidden="true" />
            ) : (
              <X size={14} aria-hidden="true" />
            )}
            <span>{req.label}</span>
          </li>
        ))}
      </ul>
    );
  }
);
