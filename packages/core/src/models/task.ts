/**
 * TaskContract 数据模型
 */
export interface TaskContract {
  id: string;
  projectId: string;
  title: string;
  objective: string;
  background?: string;
  baseBranch: string;
  targetBranch: string;
  agentId: string;
  allowedPaths: string[];
  forbiddenPaths: string[];
  requiredChecks: string[];
  riskLevel: RiskLevel;
  riskDomains?: string[];
  approval: TaskApproval;
  merge: TaskMerge;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type TaskStatus =
  | "created"
  | "workspace_created"
  | "running"
  | "testing"
  | "packaging"
  | "reviewing"
  | "blocked"
  | "merged"
  | "failed"
  | "canceled";

export interface TaskApproval {
  required: boolean;
  reviewers?: string[];
}

export interface TaskMerge {
  strategy: "auto" | "manual";
  squash?: boolean;
}
