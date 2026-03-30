import type { ProjectRole } from "@/shared/types/roles";

interface UpdateProjectInput {
  name: string;
  description: string;
  status: "active" | "archived" | "completed";
  budget: number | null;
  autoAssignCreator?: boolean;
}

interface AddProjectMemberInput {
  userId: string;
  role: ProjectRole;
}

interface CreateTaskGroupInput {
  name: string;
  color: string;
}

interface UpdateTaskGroupInput {
  name: string;
  color: string;
  isCompletionGroup: boolean;
}

interface ReorderTaskGroupInput {
  position: string;
}

export type { AddProjectMemberInput, CreateTaskGroupInput, ReorderTaskGroupInput, UpdateProjectInput, UpdateTaskGroupInput };
