import {
  arrow,
  autoUpdate,
  flip,
  offset,
  type Placement,
  shift,
  useFloating as useFloatingUI,
} from "@floating-ui/react";

export type { Placement };

interface UseFloatingConfig {
  placement?: Placement;
  offsetPx?: number;
  arrowRef?: React.RefObject<Element>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function useFloating(config: UseFloatingConfig = {}) {
  const { placement = "bottom", offsetPx = 8, arrowRef, open, onOpenChange } = config;

  const middleware = [
    offset(offsetPx),
    flip(),
    shift({ padding: 8 }),
    ...(arrowRef ? [arrow({ element: arrowRef })] : []),
  ];

  return useFloatingUI({
    placement,
    middleware,
    whileElementsMounted: autoUpdate,
    open,
    onOpenChange,
  });
}

export {
  FloatingFocusManager,
  FloatingPortal,
  safePolygon,
  useClick,
  useDismiss,
  useFocus,
  useHover,
  useInteractions,
  useListNavigation,
  useRole,
  useTransitionStyles,
  useTypeahead,
} from "@floating-ui/react";
