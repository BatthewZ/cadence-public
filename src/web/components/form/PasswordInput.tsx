import { Eye, EyeOff } from "lucide-react";
import { type ComponentPropsWithRef, forwardRef, useState } from "react";

import { Input } from "./Input";

type PasswordInputProps = Omit<ComponentPropsWithRef<typeof Input>, "type">;

/**
 * Password input with a visibility toggle button (eye/eye-off icon).
 *
 * This component exists because users need to verify what they typed in
 * password fields -- especially on mobile where typos are common and
 * autocomplete is unreliable. Without a toggle, mistyped passwords
 * cause silent authentication failures and frustrate users.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className, ...props }, ref) {
    const [visible, setVisible] = useState(false);

    return (
      <div className="password-input">
        <Input
          ref={ref}
          type={visible ? "text" : "password"}
          className={["password-input__input", className].filter(Boolean).join(" ")}
          {...props}
        />
        <button
          type="button"
          className="password-input__toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          tabIndex={-1}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    );
  }
);
