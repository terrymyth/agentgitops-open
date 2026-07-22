/**
 * AgentNote records an AI/code agent handoff entry for a task.
 */
export interface AgentNote {
  id: string;
  taskId: string;
  agentId: string;
  summary: string;
  files: string[];
  verification: string[];
  reviewFocus: string[];
  risks: string[];
  commitSha?: string;
  prUrl?: string;
  createdAt: string;
}
