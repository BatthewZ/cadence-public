/**
 * Saved Views UI — the consumer of the saved-view data hooks
 * (`use-saved-views.ts`) and pure view-state utils (`view-state.ts`).
 *
 * One feature, two mount points (hence two exports): the filter bar shows the
 * views pill FIRST in its controls row, but the zero-views "Save view"
 * affordance lives in the right-side cluster beside "Clear filters". A single
 * component cannot render in both positions without portal tricks, so
 * {@link ViewSwitcher} (the pill + menu) and {@link SaveViewButton} (the
 * zero-views affordance) are siblings that share state through the
 * react-query cache (`useSavedViews` is deduped) and the URL — there is no
 * other shared state, so the two mount points can never disagree.
 *
 * Ethos: invisible until useful. With no saved views and no active filters
 * the feature renders NOTHING — the filter bar is pixel-identical to a world
 * where saved views don't exist. There are no modals and no settings page;
 * naming and renaming happen in inline inputs (the ProjectLayout
 * inline-title-edit pattern).
 *
 * URL-WRITE RULE (gate-found bug class — do not regress): applying or
 * creating a view writes the multi-param URL in ONE `navigate()` call built
 * via `viewStateToSearch`. Never sequential `setSearchParams` calls (each
 * closes over render-time params and clobbers the previous write) and never
 * the object form (it replaces the whole query string).
 *
 * DROPDOWN-VS-POPOVER DECISION (the plan's flagged risk): we stayed on the
 * `DropdownMenu` primitive, but every row and inline input inside
 * `DropdownMenu.Content` is a PLAIN element, not a `DropdownMenu.Item`:
 *
 * - `Item` is a single `<button>` with unconditional close-on-select. A view
 *   row hosts THREE interactive controls (apply / rename / delete) — nesting
 *   buttons inside Item's button is invalid HTML, and a rename input must not
 *   close the menu on commit of the keyboard's Enter.
 * - `open` is therefore CONTROLLED here, so the component decides exactly
 *   which interactions close the menu (apply / update / create close; rename
 *   and delete keep it open so users can keep managing views).
 * - The roving-focus/typeahead machinery only sees registered Items, so with
 *   none registered it no-ops; keyboard users navigate the menu with Tab,
 *   which `FloatingFocusManager` traps inside the open menu. Inputs stop
 *   propagation of key/click events so the menu's dismiss/typeahead handlers
 *   on the floating element never observe them (verified by the component
 *   tests — the fallback Popover was not needed).
 *
 * The dirty indicator ("Edited") and all state comparisons go through
 * `isViewStateEqual`, which normalizes comma-list order / absent-vs-empty so
 * the indicator cannot false-positive (see view-state.ts for why that
 * matters).
 */
import { Bookmark, BookmarkPlus, Check, FilterX, Pencil, RefreshCw, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import type { SavedView } from "@/shared/schemas/saved-view";
import { DropdownMenu } from "@/web/components/ui/DropdownMenu";
import { useToast } from "@/web/components/ui/ToastContext";
import { useWorkspace } from "@/web/contexts/WorkspaceContext";
import {
  useCreateSavedView,
  useDeleteSavedView,
  useSavedViews,
  useUpdateSavedView,
} from "@/web/hooks/use-saved-views";
import { ApiError } from "@/web/lib/api/client";
import {
  captureViewState,
  clearViewSearch,
  isViewStateEqual,
  resolveViewTab,
  viewStateToSearch,
} from "@/web/lib/view-state";

export interface ViewSwitcherProps {
  projectId: string;
}

/**
 * Shared per-mount-point plumbing: where we are (tab + captured URL state),
 * where views live (the deduped list query), and the one navigation-coupled
 * mutation (create must navigate to the SERVER-assigned id, which is why
 * `useCreateSavedView` is non-optimistic — see use-saved-views.ts).
 */
function useViewSwitcherState(projectId: string) {
  const { workspace } = useWorkspace();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Same tab derivation as ProjectLayout: last path segment, defaulting to
  // "board" (the bar only mounts on board/list/timeline, and a bare project
  // URL lands on board). resolveViewTab encodes exactly this fallback.
  const segments = location.pathname.split("/");
  const tab = resolveViewTab(segments[segments.length - 1]);

  const currentState = useMemo(
    () => captureViewState(tab, searchParams),
    [tab, searchParams],
  );

  // Is there any filter/grouping state worth saving? Both mount points gate
  // on this (the bar's zero-views affordance and the menu footer), so it is
  // derived once here rather than recomputed identically at each call site.
  const capturable = Object.keys(currentState.params).length > 0;

  const basePath = `/w/${workspace.slug}/projects/${projectId}`;

  const { data } = useSavedViews(projectId);
  const views = data?.views;

  const createView = useCreateSavedView(projectId);

  /**
   * Create-then-apply: awaits the server-assigned id, then writes the FULL
   * new URL (params + `view=<id>`) in one navigate call. The `view` param is
   * what survives refresh and drives the dirty check.
   */
  async function createAndApply(name: string) {
    const { view } = await createView.mutateAsync({ name, state: currentState });
    void navigate(`${basePath}/${tab}?${viewStateToSearch(currentState, view.id)}`);
  }

  return { views, currentState, capturable, basePath, tab, navigate, searchParams, createAndApply };
}

interface ViewNameFormProps {
  ariaLabel: string;
  defaultValue?: string;
  placeholder?: string;
  /** Extra class for placement variants (bar vs menu). */
  className?: string;
  /** Persists the trimmed name; throws `ApiError` on failure (409 = duplicate). */
  onCommit: (name: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * The single inline name input used by every naming flow (first save, "Save
 * current as view", "Save as new", rename) so the keyboard contract and error
 * handling cannot drift between them: Enter commits, Escape cancels, a 409
 * duplicate-name renders INLINE under the input (the user can fix it in
 * place), and any other failure (e.g. the 20-view cap's 400) surfaces the
 * server's message via toast — the input stays mounted so the typed name is
 * not lost.
 *
 * Key/click events stop propagation: when this form lives inside the open
 * DropdownMenu, the menu's dismiss handler must not see Escape (Escape means
 * "cancel the input", not "close the menu") and its typeahead must not
 * interpret typing as item navigation.
 */
function ViewNameForm({
  ariaLabel,
  defaultValue = "",
  placeholder = "View name",
  className,
  onCommit,
  onCancel,
}: ViewNameFormProps) {
  const { toast } = useToast();
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function commit() {
    const name = value.trim();
    if (!name) {
      // Empty commit == cancel (mirrors ProjectLayout's title-edit no-op).
      onCancel();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // On success the parent unmounts this form, so busy is never reset here.
      await onCommit(name);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 409) {
        setError("You already have a view with this name");
      } else {
        toast(err instanceof ApiError ? err.message : "Failed to save view.", {
          variant: "error",
        });
      }
    }
  }

  return (
    <div
      role="none"
      className={`view-switcher__form${className ? ` ${className}` : ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* autoFocus: the form only ever mounts from an explicit user action
          (click on a save/rename affordance), so stealing focus is the
          expected UX — same as ProjectLayout's inline title input. */}
      <input
        autoFocus
        className="view-switcher__input"
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        disabled={busy}
        onChange={(e) => {
          setValue(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") onCancel();
        }}
      />
      {error && (
        <span className="view-switcher__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * Zero-views save affordance: a quiet text button beside "Clear filters"
 * that swaps for an inline name input. Renders ONLY when the views list has
 * loaded empty AND there is capturable state — once the first view exists,
 * saving moves into the pill menu's footer and this renders nothing.
 *
 * TaskFilterBar additionally mounts it inside its `hasActiveFilters` block,
 * so the bar stays pixel-identical to today when no filters are active; the
 * self-gating here is defense in depth and what makes the component
 * independently testable.
 */
export function SaveViewButton({ projectId }: ViewSwitcherProps) {
  const { views, capturable, createAndApply } = useViewSwitcherState(projectId);
  const [naming, setNaming] = useState(false);

  if (!views || views.length > 0 || !capturable) return null;

  if (!naming) {
    return (
      <button
        type="button"
        className="view-switcher__save"
        onClick={() => setNaming(true)}
      >
        <BookmarkPlus size={13} aria-hidden="true" />
        Save view
      </button>
    );
  }

  return (
    <ViewNameForm
      ariaLabel="View name"
      className="view-switcher__form--bar"
      onCommit={async (name) => {
        await createAndApply(name);
        setNaming(false);
      }}
      onCancel={() => setNaming(false)}
    />
  );
}

/**
 * The views pill + menu. Renders nothing until at least one view exists.
 *
 * The active view is whichever list entry matches the URL's `view` param; an
 * unresolvable id (deleted view, or a shared link from someone else's private
 * view) is silently ignored — the pill degrades to "Views" and the plain
 * filter params still apply, so a recipient of a shared link loses nothing
 * but the bookmark itself.
 */
export function ViewSwitcher({ projectId }: ViewSwitcherProps) {
  const { views, currentState, capturable, basePath, tab, navigate, searchParams, createAndApply } =
    useViewSwitcherState(projectId);
  const updateView = useUpdateSavedView(projectId);
  const deleteView = useDeleteSavedView(projectId);
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const activeViewId = searchParams.get("view");
  const activeView = views?.find((v) => v.id === activeViewId) ?? null;
  const isDirty = activeView !== null && !isViewStateEqual(currentState, activeView.state);

  if (!views || views.length === 0) return null;

  /** Closing the menu always resets transient editing state. */
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setCreating(false);
      setRenamingId(null);
    }
  }

  /**
   * Applying = ONE navigate with the view's full serialized state. The tab
   * goes through `resolveViewTab` so a view saved by a future client on a tab
   * this deployment can't render (e.g. "calendar") still lands on board
   * instead of a dead route.
   */
  function applyView(view: SavedView) {
    handleOpenChange(false);
    void navigate(
      `${basePath}/${resolveViewTab(view.state.tab)}?${viewStateToSearch(view.state, view.id)}`,
    );
  }

  /**
   * Exits the active view back to the project default: ONE navigate to the
   * current tab with `view` and every filter/grouping param stripped (see
   * `clearViewSearch`). This is the "unselect" the pill's radio rows alone
   * can't express — a radio group has no off state — so without it the only
   * ways out of a view were editing it, deleting it, or hand-clearing the URL.
   * Stays on the current tab (we are not re-applying a view, just dropping its
   * state) and preserves unrelated params like an open `task` panel.
   */
  function clearView() {
    handleOpenChange(false);
    const search = clearViewSearch(searchParams);
    void navigate(`${basePath}/${tab}${search ? `?${search}` : ""}`);
  }

  /**
   * Overwrites the active view's snapshot with the current URL state. No
   * navigation needed: the URL already IS the new state (including
   * `view=<id>`), and the optimistic cache patch clears the dirty flag
   * instantly.
   */
  function handleUpdateActive(view: SavedView) {
    handleOpenChange(false);
    updateView.mutateAsync({ viewId: view.id, state: currentState }).catch((err: unknown) => {
      toast(err instanceof ApiError ? err.message : "Failed to update view.", {
        variant: "error",
      });
    });
  }

  /**
   * Optimistic delete; menu stays open so several views can be cleaned up in
   * one visit. Deleting the ACTIVE view leaves a dangling `view` param in the
   * URL, which the active-view lookup above ignores by construction — the
   * pill degrades to "Views" with no special-casing.
   */
  function handleDelete(view: SavedView) {
    if (renamingId === view.id) setRenamingId(null);
    deleteView.mutateAsync(view.id).catch((err: unknown) => {
      toast(err instanceof ApiError ? err.message : "Failed to delete view.", {
        variant: "error",
      });
    });
  }

  // The create form renders in the footer whenever a naming flow is active
  // ("Save as new" while dirty, or "Save current as view"); the footer
  // *button* additionally requires capturable state and hides while dirty
  // because the top "Save as new" action IS the same flow — two identical
  // affordances in one small menu would just be noise.
  const showFooter = creating || (!isDirty && capturable);

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="task-filter-bar__trigger view-switcher__pill">
          <Bookmark size={14} aria-hidden="true" className="shrink-0" />
          <span className="view-switcher__pill-name">
            {activeView ? activeView.name : "Views"}
          </span>
          {isDirty && <span className="view-switcher__edited">· Edited</span>}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content className="view-switcher__menu">
        {activeView && (
          <>
            {isDirty && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="dropdown-menu-item"
                  onClick={() => handleUpdateActive(activeView)}
                >
                  <span className="dropdown-menu-item-icon">
                    <RefreshCw size={13} />
                  </span>
                  <span className="view-switcher__action-text">
                    Update “{activeView.name}”
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="dropdown-menu-item"
                  onClick={() => setCreating(true)}
                >
                  <span className="dropdown-menu-item-icon">
                    <BookmarkPlus size={13} />
                  </span>
                  Save as new
                </button>
              </>
            )}
            {/* The "unselect" affordance: leaves the view and drops its
                filters, returning the board to its default state. Always
                present while a view is active so users are never stranded in a
                filtered view with no way back short of editing/deleting it. */}
            <button
              type="button"
              role="menuitem"
              className="dropdown-menu-item"
              onClick={clearView}
            >
              <span className="dropdown-menu-item-icon">
                <FilterX size={13} />
              </span>
              Clear view
            </button>
            <DropdownMenu.Divider />
          </>
        )}

        {views.map((view) =>
          renamingId === view.id ? (
            <ViewNameForm
              key={view.id}
              ariaLabel={`New name for ${view.name}`}
              defaultValue={view.name}
              onCommit={async (name) => {
                await updateView.mutateAsync({ viewId: view.id, name });
                setRenamingId(null);
              }}
              onCancel={() => setRenamingId(null)}
            />
          ) : (
            <div key={view.id} role="none" className="view-switcher__row">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={view.id === activeView?.id}
                className="dropdown-menu-item view-switcher__row-apply"
                onClick={() => applyView(view)}
              >
                <span
                  className="dropdown-menu-item-icon view-switcher__row-check"
                  aria-hidden="true"
                >
                  {view.id === activeView?.id && <Check size={14} />}
                </span>
                <span className="view-switcher__row-name">{view.name}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="view-switcher__row-action"
                aria-label={`Rename view ${view.name}`}
                onClick={() => setRenamingId(view.id)}
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                role="menuitem"
                className="view-switcher__row-action view-switcher__row-action--danger"
                aria-label={`Delete view ${view.name}`}
                onClick={() => handleDelete(view)}
              >
                <X size={13} />
              </button>
            </div>
          ),
        )}

        {showFooter && (
          <>
            <DropdownMenu.Divider />
            {creating ? (
              <ViewNameForm
                ariaLabel="View name"
                onCommit={async (name) => {
                  await createAndApply(name);
                  handleOpenChange(false);
                }}
                onCancel={() => setCreating(false)}
              />
            ) : (
              <button
                type="button"
                role="menuitem"
                className="dropdown-menu-item"
                onClick={() => setCreating(true)}
              >
                <span className="dropdown-menu-item-icon">
                  <BookmarkPlus size={13} />
                </span>
                Save current as view
              </button>
            )}
          </>
        )}
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}
