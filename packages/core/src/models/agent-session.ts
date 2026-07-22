/**
 * AgentSession 数据模型
 */
export interface AgentSession {
  id: string;
  taskId: string;
  agentId: string;
  workspaceId: string;
  command: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  status: AgentSessionStatus;
  logPath?: string;
}

export type AgentSessionStatus = "running" | "completed" | "failed" | "canceled";
