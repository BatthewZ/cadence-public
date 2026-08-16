import { Button } from "@/web/components/ui/Button";
import { Tooltip } from "@/web/components/ui/Tooltip";
import {
  PROJECT_CREATION_DENIED_HINT,
  useWorkspacePermissions,
} from "@/web/hooks/use-permissions";

interface NewProjectButtonProps {
  /** Opens the create-project dialog. Never fires while creation is refused. */
  onClick: () => void;
  /** Button copy — the dashboard's empty state asks for a call to action rather than a toolbar label. */
  label?: string;
  /**
   * Disable for a reason unrelated to permission — the Projects page uses this
   * for its loading skeleton. Kept separate from the permission check so a
   * "still loading" button never inherits the "you're not allowed" tooltip.
   */
  disabled?: boolean;
}

/**
 * The button that opens the create-project dialog, with the workspace's
 * project-creation policy already applied.
 *
 * ## Why this is a component rather than a check at each call site
 *
 * Refusing an action correctly is three things that have to agree: the control
 * is disabled, it explains itself on hover, and the explanation is the same
 * sentence everywhere. Spread across call sites, the disable is the part
 * people remember and the tooltip is the part they forget — which produces the
 * worst version of this UI, a dead button with no stated reason. Bundling them
 * means a new surface gets all three by construction.
 *
 * The gate is a UX affordance and not the enforcement: `requireProjectCreation`
 * on the server is what actually refuses, and it refuses identically for a
 * scripted POST that never renders this button.
 */
export function NewProjectButton({
  onClick,
  label = "+ New Project",
  disabled = false,
}: NewProjectButtonProps) {
  const { canCreateProject } = useWorkspacePermissions();

  const button = (
    <Button onClick={onClick} disabled={disabled || !canCreateProject}>
      {label}
    </Button>
  );

  // Only wrapped when there is something to explain. An always-on tooltip
  // repeating the button's own label is noise that trains people to ignore
  // tooltips on this page, including this one when it finally matters.
  if (canCreateProject) return button;

  return (
    <Tooltip content={PROJECT_CREATION_DENIED_HINT}>
      {/*
        A disabled <button> fires no pointer events, so the tooltip would never
        open on the element itself. The span is the hover target that keeps the
        explanation reachable — without it the refusal is silent, which is the
        failure this component exists to prevent.
      */}
      <span className="inline-flex cursor-not-allowed">{button}</span>
    </Tooltip>
  );
}
