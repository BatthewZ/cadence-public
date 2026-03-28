import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useToast } from "@/web/components/ui/ToastContext";
import { useWorkspace } from "@/web/contexts/WorkspaceContext";
import { useClickOutside } from "@/web/hooks/use-click-outside";

import { TaskDetailPanelInner } from "./components/TaskDetailPanelInner";

export function TaskDetailPanel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const taskId = searchParams.get("task");
  const panelRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { members } = useWorkspace();
  const [visible, setVisible] = useState(false);

  const close = useCallback(() => {
    const currentTask = new URLSearchParams(window.location.search).get("task");
    if (currentTask && currentTask !== taskId) return; // user switched tasks, don't close

    setVisible(false);
    // Wait for slide-out animation before removing from DOM
    setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("task");
        return next;
      });
    }, 200);
  }, [setSearchParams, taskId]);

  useClickOutside(panelRef, close, !!taskId);

  // Trigger slide-in when taskId appears
  useEffect(() => {
    if (taskId) {
      // Delay to allow initial render at translated position
      requestAnimationFrame(() => setVisible(true));
    }
  }, [taskId]);

  if (!taskId) return null;

  return (
    <TaskDetailPanelInner
      taskId={taskId}
      panelRef={panelRef}
      members={members}
      toast={toast}
      onClose={close}
      visible={visible}
    />
  );
}
