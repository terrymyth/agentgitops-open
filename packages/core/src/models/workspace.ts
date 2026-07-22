/**
 * Workspace 数据模型
 */
export interface Workspace {
  id: string;
  taskId: string;
  projectId: string;
  path: string;
  branch: string;
  baseBranch: string;
  status: WorkspaceStatus;
  createdAt: string;
  updatedAt: string;
}

export type WorkspaceStatus = "created" | "dirty" | "clean" | "archived" | "removed";
