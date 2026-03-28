import {
  type ComponentPropsWithRef,
  type CSSProperties,
  forwardRef,
  type ReactNode,
  useCallback,
} from "react";
import { type NavigateOptions, type To, useNavigate } from "react-router-dom";

type ViewTransitionProps = {
  name: string;
  children: ReactNode;
} & ComponentPropsWithRef<"div">;

export const ViewTransition = forwardRef<HTMLDivElement, ViewTransitionProps>(
  function ViewTransition({ name, className, children, style, ...rest }, ref) {
    return (
      <div
        ref={ref}
        className={className}
        style={{ ...style, viewTransitionName: name } as CSSProperties}
        {...rest}
      >
        {children}
      </div>
    );
  }
);

// eslint-disable-next-line react-refresh/only-export-components
export function useViewTransition() {
  const navigate = useNavigate();

  return useCallback(
    (to: To, options?: NavigateOptions) => {
      if (typeof document.startViewTransition === "function") {
        void document.startViewTransition(() => {
          void navigate(to, options);
        }).finished;
      } else {
        void navigate(to, options);
      }
    },
    [navigate]
  );
}
