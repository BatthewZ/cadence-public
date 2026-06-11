import { useWorkspace } from "@/web/contexts/WorkspaceContext";
import { useDocumentTitle } from "@/web/hooks/use-document-title";
import { useWorkspaceWebhooks } from "@/web/hooks/use-workspace-webhooks";

import { WebhookDetailView } from "./components/WebhookDetailView";
import { WebhookListView } from "./components/WebhookListView";

/* ------------------------------------------------------------------ */
/*  WorkspaceWebhooks                                                  */
/*                                                                     */
/*  Thin orchestrator: instantiates the hook and delegates rendering   */
/*  to either the list view or detail view based on selection state.   */
/* ------------------------------------------------------------------ */

export default function WorkspaceWebhooks() {
  const { workspace } = useWorkspace();
  useDocumentTitle(`${workspace.name} — Webhooks`);
  const hook = useWorkspaceWebhooks();

  if (hook.selectedWebhookId) {
    return <WebhookDetailView hook={hook} />;
  }

  return <WebhookListView hook={hook} />;
}
