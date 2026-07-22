import path from "node:path";
import fs from "node:fs/promises";
import { WorktreeService } from "@agentgitops/git";
import type { TaskContract, TaskStatus, Workspace } from "@agentgitops/core";

export interface WorkspaceSweepOptions {
  archiveStatuses?: TaskStatus[];
  cleanupAfterDays?: number;
  now?: Date;
  dryRun?: boolean;
}

export interface WorkspaceSweepResult {
  archived: Workspace[];
  removed: Workspace[];
  skipped: { taskId: string; path: string; reason: string }[];
}

/**
 * WorkspaceManager - 管理任务级工作区
 */
export class WorkspaceManager {
  constructor(
    private readonly repoPath: string,
    private readonly worktreeRoot: string,
  ) {}

  /**
   * 为任务创建独立 worktree
   */
  async create(task: TaskContract): Promise<Workspace> {
    const worktreeService = new WorktreeService(this.repoPath);
    const worktreePath = path.join(this.worktreeRoot, `${task.projectId}-${task.id}`);

    await worktreeService.add(worktreePath, task.targetBranch, task.baseBranch);

    return {
      id: `ws_${task.id}`,
      taskId: task.id,
      projectId: task.projectId,
      path: worktreePath,
      branch: task.targetBranch,
      baseBranch: task.baseBranch,
      status: "created",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 清理工作区
   *
   * 任务结束后 worktree 内可能存在 Agent 产生的 untracked 文件，
   * 使用 --force 强制移除，避免 `git worktree remove` 因脏文件拒绝删除。
   */
  async clean(workspace: Workspace): Promise<void> {
    const worktreeService = new WorktreeService(this.repoPath);
    await worktreeService.remove(workspace.path, true);
  }

  async sweep(
    tasks: TaskContract[],
    options: WorkspaceSweepOptions = {},
  ): Promise<WorkspaceSweepResult> {
    const archiveStatuses = new Set(options.archiveStatuses ?? ["merged", "canceled"]);
    const now = options.now ?? new Date();
    const result: WorkspaceSweepResult = { archived: [], removed: [], skipped: [] };

    for (const task of tasks) {
      const workspace = this.workspaceForTask(task, "archived");
      if (!archiveStatuses.has(task.status)) continue;
      if (!(await pathExists(workspace.path))) {
        result.skipped.push({ taskId: task.id, path: workspace.path, reason: "workspace_missing" });
        continue;
      }

      result.archived.push(workspace);
      if (shouldCleanup(task, now, options.cleanupAfterDays)) {
        if (!options.dryRun) await this.clean(workspace);
        result.removed.push({ ...workspace, status: "removed", updatedAt: now.toISOString() });
      }
    }

    return result;
  }

  workspaceForTask(task: TaskContract, status: Workspace["status"] = "created"): Workspace {
    const workspacePath = path.join(this.worktreeRoot, `${task.projectId}-${task.id}`);
    return {
      id: `ws_${task.id}`,
      taskId: task.id,
      projectId: task.projectId,
      path: workspacePath,
      branch: task.targetBranch,
      baseBranch: task.baseBranch,
      status,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }
}

export function buildWorkspaceEnvironment(
  workspaceEnv: Record<string, string> | undefined,
  agentEnv: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const merged = { ...(workspaceEnv ?? {}), ...(agentEnv ?? {}) };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function shouldCleanup(task: TaskContract, now: Date, cleanupAfterDays?: number): boolean {
  if (cleanupAfterDays === undefined) return false;
  const ageMs = now.getTime() - Date.parse(task.updatedAt);
  return ageMs >= cleanupAfterDays * 24 * 60 * 60 * 1000;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
