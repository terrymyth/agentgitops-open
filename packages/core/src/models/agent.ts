/**
 * Agent 数据模型
 */
export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AgentType =
  "generic-cli" | "codex" | "claude-code" | "opencode" | "cursor" | "cline" | "custom";
