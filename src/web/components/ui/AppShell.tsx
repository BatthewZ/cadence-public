import { type LucideIcon, Menu, PanelLeft, PanelLeftClose, X } from "lucide-react";
import {
  type ComponentPropsWithRef,
  createContext,
  forwardRef,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation } from "react-router-dom";

import { useClickOutside } from "@/web/hooks/use-click-outside";
import { useFocusTrap } from "@/web/hooks/use-focus-trap";
import { mergeRefs } from "@/web/util/merge-refs";
import { cn } from "@/web/util/style/style";

import { Portal } from "./Portal";
import { Tooltip } from "./Tooltip";

/* ─── Context ─── */

interface AppShellContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  isMobile: boolean;
  sidebarId: string;
}

const AppShellContext = createContext<AppShellContextValue | null>(null);

export function useAppShell() {
  const ctx = useContext(AppShellContext);
  if (!ctx) throw new Error("AppShell compound components must be used within <AppShell>");
  return ctx;
}

/**
 * Returns the AppShell context if available, or null when rendered outside
 * an <AppShell> provider. Useful for components like UserMenu that need to
 * adapt their behavior based on whether they're inside a shell layout.
 */
export function useOptionalAppShell(): AppShellContextValue | null {
  return useContext(AppShellContext);
}

/* ─── Root ─── */

type AppShellRootProps = {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultCollapsed?: boolean;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  children: ReactNode;
} & Omit<ComponentPropsWithRef<"div">, "children">;

const AppShellRoot = forwardRef<HTMLDivElement, AppShellRootProps>(function AppShellRoot(
  {
    defaultOpen = false,
    open: openProp,
    onOpenChange,
    defaultCollapsed = false,
    collapsed: collapsedProp,
    onCollapsedChange,
    className,
    children,
    ...props
  },
  ref
) {
  const [openInternal, setOpenInternal] = useState(() => {
    // On mobile the sidebar renders as a portal drawer, so never auto-open it.
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches) {
      return false;
    }
    return defaultOpen;
  });
  const open = openProp ?? openInternal;
  const setOpen = useCallback(
    (val: boolean) => {
      setOpenInternal(val);
      onOpenChange?.(val);
    },
    [onOpenChange]
  );

  const [collapsedInternal, setCollapsedInternal] = useState(defaultCollapsed);
  const collapsed = collapsedProp ?? collapsedInternal;
  const setCollapsed = useCallback(
    (val: boolean) => {
      setCollapsedInternal(val);
      onCollapsedChange?.(val);
    },
    [onCollapsedChange]
  );

  const [isMobile, setIsMobile] = useState(false);
  const sidebarId = `app-shell-sidebar-${useId()}`;

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 639px)");
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setIsMobile(e.matches);
    handler(mql);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // Close mobile sidebar on navigation (render-time state adjustment)
  const location = useLocation();
  const [prevPathname, setPrevPathname] = useState(location.pathname);
  if (prevPathname !== location.pathname) {
    setPrevPathname(location.pathname);
    if (isMobile && open) setOpen(false);
  }

  const ctx = useMemo(
    () => ({ open, setOpen, collapsed, setCollapsed, isMobile, sidebarId }),
    [open, setOpen, collapsed, setCollapsed, isMobile, sidebarId]
  );

  return (
    <AppShellContext.Provider value={ctx}>
      <div ref={ref} className={cn("app-shell", className)} {...props}>
        {children}
      </div>
    </AppShellContext.Provider>
  );
});

/* ─── Navbar ─── */

const AppShellNavbar = forwardRef<HTMLElement, ComponentPropsWithRef<"header">>(
  function AppShellNavbar({ className, ...props }, ref) {
    return <header ref={ref} className={cn("app-shell-navbar", className)} role="banner" {...props} />;
  }
);

/* ─── Brand ─── */

const AppShellBrand = forwardRef<HTMLDivElement, ComponentPropsWithRef<"div">>(
  function AppShellBrand({ className, ...props }, ref) {
    return <div ref={ref} className={cn("app-shell-brand", className)} {...props} />;
  }
);

/* ─── NavbarActions ─── */

const AppShellNavbarActions = forwardRef<HTMLDivElement, ComponentPropsWithRef<"div">>(
  function AppShellNavbarActions({ className, ...props }, ref) {
    return <div ref={ref} className={cn("app-shell-navbar-actions", className)} {...props} />;
  }
);

/* ─── Toggle ─── */

const AppShellToggle = forwardRef<HTMLButtonElement, Omit<ComponentPropsWithRef<"button">, "type">>(
  function AppShellToggle({ className, children, ...props }, ref) {
    const { open, setOpen, collapsed, setCollapsed, isMobile, sidebarId } = useAppShell();

    function handleClick() {
      if (isMobile) {
        setOpen(!open);
      } else {
        setCollapsed(!collapsed);
      }
    }

    const Icon = isMobile ? Menu : collapsed ? PanelLeft : PanelLeftClose;

    return (
      <button
        ref={ref}
        type="button"
        className={cn("app-shell-toggle", className)}
        onClick={handleClick}
        aria-expanded={isMobile ? open : !collapsed}
        aria-controls={sidebarId}
        aria-label={
          isMobile
            ? open
              ? "Close navigation"
              : "Open navigation"
            : collapsed
              ? "Expand sidebar"
              : "Collapse sidebar"
        }
        {...props}
      >
        {children ?? <Icon size={20} />}
      </button>
    );
  }
);

/* ─── Sidebar ─── */

type AppShellSidebarProps = Omit<ComponentPropsWithRef<"aside">, "role">;

const AppShellSidebar = forwardRef<HTMLElement, AppShellSidebarProps>(
  function AppShellSidebar({ className, children, ...props }, forwardedRef) {
    const { open, setOpen, collapsed, isMobile, sidebarId } = useAppShell();
    const sidebarRef = useRef<HTMLElement>(null);
    const merged = useMemo(() => mergeRefs(forwardedRef, sidebarRef), [forwardedRef, sidebarRef]);

    useClickOutside(sidebarRef, () => setOpen(false), isMobile && open);
    useFocusTrap(sidebarRef, isMobile && open);

    useEffect(() => {
      if (!isMobile || !open) return;
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") setOpen(false);
      };
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }, [isMobile, open, setOpen]);

    // Mobile: render in portal
    if (isMobile) {
      if (!open) return null;
      return (
        <Portal>
          <div className="app-shell-scrim" aria-hidden="true" />
          <aside
            ref={merged}
            id={sidebarId}
            role="navigation"
            aria-label="Main navigation"
            aria-modal="true"
            className={cn("app-shell-sidebar-mobile", className)}
            {...props}
          >
            <button
              type="button"
              className="app-shell-sidebar-mobile-close"
              onClick={() => setOpen(false)}
              aria-label="Close navigation"
            >
              <X size={18} />
            </button>
            {children}
          </aside>
        </Portal>
      );
    }

    // Desktop: inline sidebar
    return (
      <aside
        ref={merged}
        id={sidebarId}
        role="navigation"
        aria-label="Main navigation"
        data-collapsed={collapsed || undefined}
        className={cn("app-shell-sidebar", className)}
        {...props}
      >
        {children}
      </aside>
    );
  }
);

/* ─── SidebarSection ─── */

type SidebarSectionProps = {
  title?: string;
} & ComponentPropsWithRef<"div">;

const AppShellSidebarSection = forwardRef<HTMLDivElement, SidebarSectionProps>(
  function AppShellSidebarSection({ title, className, children, ...props }, ref) {
    return (
      <div ref={ref} className={cn("app-shell-sidebar-section", className)} {...props}>
        {title && <div className="app-shell-sidebar-section-title">{title}</div>}
        {children}
      </div>
    );
  }
);

/* ─── SidebarLink ─── */

type SidebarLinkProps = {
  to: string;
  icon?: LucideIcon;
  end?: boolean;
  /** Explicit accessible label. Falls back to `children` when it is a plain string. */
  label?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithRef<"a">, "href" | "children">;

const AppShellSidebarLink = forwardRef<HTMLAnchorElement, SidebarLinkProps>(
  function AppShellSidebarLink({ to, icon: Icon, end, label, className, children, ...props }, ref) {
    const { collapsed, isMobile } = useAppShell();
    const { pathname } = useLocation();

    const isActive = end
      ? pathname === to
      : to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(to + "/");
    const showCollapsed = collapsed && !isMobile;

    // Derive an accessible label: prefer explicit `label` prop, fall back to
    // `children` when it is a plain string.  When the sidebar is collapsed the
    // visible <span> gets `display:none` which removes it from the a11y tree,
    // so this aria-label ensures the link always has an accessible name.
    const ariaLabel = label ?? (typeof children === "string" ? children : undefined);

    const link = (
      <Link
        ref={ref}
        to={to}
        className={cn("app-shell-sidebar-link", className)}
        data-active={isActive || undefined}
        aria-current={isActive ? "page" : undefined}
        aria-label={ariaLabel}
        {...props}
      >
        {Icon && <Icon className="app-shell-sidebar-link-icon" />}
        <span className="app-shell-sidebar-link-label">{children}</span>
      </Link>
    );

    if (showCollapsed) {
      return <Tooltip content={children}>{link}</Tooltip>;
    }

    return link;
  }
);

/* ─── Main ─── */

const AppShellMain = forwardRef<HTMLDivElement, ComponentPropsWithRef<"div">>(
  function AppShellMain({ className, ...props }, ref) {
    return <div ref={ref} className={cn("app-shell-main", className)} {...props} />;
  }
);

/* ─── Export ─── */

export const AppShell = Object.assign(AppShellRoot, {
  Navbar: AppShellNavbar,
  Brand: AppShellBrand,
  NavbarActions: AppShellNavbarActions,
  Toggle: AppShellToggle,
  Sidebar: AppShellSidebar,
  SidebarSection: AppShellSidebarSection,
  SidebarLink: AppShellSidebarLink,
  Main: AppShellMain,
});
