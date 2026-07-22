import type { AgentType } from "@agentgitops/core";
import {
  GenericCliAdapter,
  type AdapterRunParams,
  type AdapterRunResult,
} from "./generic-cli-adapter.js";
import { ClaudeCodeAdapter as ClaudeCodeCliAdapter } from "./claude-code-adapter.js";
import { CodexAdapter as CodexCliAdapter } from "./codex-adapter.js";

export interface AgentAdapter {
  readonly type: AgentType;
  run(params: AdapterRunParams): Promise<AdapterRunResult>;
}

export class GenericAgentAdapter extends GenericCliAdapter implements AgentAdapter {
  readonly type = "generic-cli" as const;
}

export class ClaudeCodeAgentAdapter extends ClaudeCodeCliAdapter implements AgentAdapter {
  readonly type = "claude-code" as const;
}

export class CodexAgentAdapter extends CodexCliAdapter implements AgentAdapter {
  readonly type = "codex" as const;
}

export class OpenCodeAdapter implements AgentAdapter {
  readonly type = "opencode" as const;
  private readonly generic = new GenericCliAdapter();

  run(params: AdapterRunParams): Promise<AdapterRunResult> {
    return this.generic.run({
      ...params,
      args:
        params.args.length > 0
          ? params.args
          : ["run", "--cwd", "{{workspace_path}}", "--task-file", "{{task_prompt_file}}"],
      promptFileContent: params.promptFileContent ?? buildOpenCodePrompt(params),
    });
  }
}

export function createAgentAdapter(type: string): AgentAdapter {
  switch (type) {
    case "claude-code":
      return new ClaudeCodeAgentAdapter();
    case "codex":
      return new CodexAgentAdapter();
    case "opencode":
      return new OpenCodeAdapter();
    default:
      return new GenericAgentAdapter();
  }
}

function buildOpenCodePrompt(params: AdapterRunParams): string {
  const task = params.taskContract;
  return [
    "# OpenCode AgentGitOps Task",
    "",
    `Task: ${task.id}`,
    `Title: ${task.title}`,
    `Objective: ${task.objective}`,
    task.background ? `Background: ${task.background}` : undefined,
    "",
    "## Workspace Boundary",
    `- Workspace: ${params.workspacePath}`,
    `- Base branch: ${task.baseBranch}`,
    `- Target branch: ${task.targetBranch}`,
    `- Allowed paths: ${task.allowedPaths.join(", ") || "(none)"}`,
    `- Forbidden paths: ${task.forbiddenPaths.join(", ") || "(none)"}`,
    "",
    "## Required Checks",
    task.requiredChecks.map((check) => `- ${check}`).join("\n") || "(none)",
    "",
    "Keep all edits inside the workspace and preserve the task boundary.",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}
