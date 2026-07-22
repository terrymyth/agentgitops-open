import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { ChangePackage, TaskContract } from "@agentgitops/core";
import { CONFIG_DIR } from "@agentgitops/core";
import type { AgentgitopsConfig } from "./config-loader.js";
import { TaskManager } from "./task-manager.js";
import { VerificationStore } from "./verification-store.js";

export type TaskCloseoutMode = "checkpoint" | "pause" | "done" | "merged-direct" | "state-only";
export type TaskCloseoutCheckStatus = "ok" | "warning" | "error";

export interface TaskCloseoutCheck {
  name: string;
  status: TaskCloseoutCheckStatus;
  detail: string;
  recovery?: string[];
}

export interface TaskCloseoutReport {
  taskId: string;
  mode: TaskCloseoutMode;
  projectPath: string;
  generatedAt: string;
  summary: {
    ok: number;
    warning: number;
    error: number;
    readyForHandoff: boolean;
  };
  task?: {
    status: string;
    baseBranch: string;
    targetBranch: string;
    workspacePath: string;
  };
  checks: TaskCloseoutCheck[];
}

export interface TaskCloseoutCheckOptions {
  mode?: TaskCloseoutMode;
  remote?: string;
}

export interface TaskCloseoutRecord {
  schemaVersion: 1;
  taskId: string;
  mode: TaskCloseoutMode;
  status: "ready_for_resume" | "blocked";
  projectPath: string;
  generatedAt: string;
  recordedAt: string;
  task?: TaskCloseoutReport["task"];
  summary: TaskCloseoutReport["summary"];
  checks: TaskCloseoutCheck[];
}

export interface TaskCloseoutRecordWriteResult {
  record: TaskCloseoutRecord;
  path: string;
}

export class TaskCloseoutChecker {
  constructor(
    private readonly projectPath: string,
    private readonly config: AgentgitopsConfig,
  ) {}

  async check(taskId: string, options: TaskCloseoutCheckOptions = {}): Promise<TaskCloseoutReport> {
    const mode = options.mode ?? "checkpoint";
    const remote = options.remote ?? this.config.git.remote;
    const checks: TaskCloseoutCheck[] = [];
    const generatedAt = new Date().toISOString();

    let task: TaskContract;
    try {
      task = await new TaskManager(this.projectPath).load(taskId);
      checks.push({
        name: "task",
        status: "ok",
        detail: `${task.id} [${task.status}] ${task.title}`,
      });
    } catch (error) {
      checks.push({
        name: "task",
        status: "error",
        detail: `Task not found: ${taskId}. ${errorMessage(error)}`,
        recovery: [`Run agentgitops task list and choose an existing task id.`],
      });
      return this.buildReport(taskId, mode, generatedAt, checks);
    }

    const workspacePath = this.workspacePathFor(task);
    checks.push(await this.checkTaskSnapshot(task));
    checks.push(await this.checkWorkspace(task, workspacePath));
    checks.push(await this.checkWorkspaceBranch(task, workspacePath));
    checks.push(await this.checkWorkspaceDirty(workspacePath));
    checks.push(await this.checkRemote(remote));
    checks.push(await this.checkRemoteTrackingBranch(task, workspacePath, remote));
    checks.push(await this.checkChangePackage(task, mode, workspacePath));
    checks.push(await this.checkVerification(task, mode));
    checks.push(await this.checkOutboxCommitted());
    checks.push(await this.checkTaskArtifactsCommitted(task));
    checks.push(await this.checkCloseoutRecordsCommitted(task));
    checks.push(await this.checkHandoff(task, mode));
    checks.push(this.checkTaskLifecycle(task, mode, workspacePath));

    return this.buildReport(task.id, mode, generatedAt, checks, task, workspacePath);
  }

  async writeRecord(report: TaskCloseoutReport): Promise<TaskCloseoutRecordWriteResult> {
    const portableTask = report.task
      ? {
          ...report.task,
          workspacePath: toPortablePath(this.projectPath, report.task.workspacePath),
        }
      : undefined;
    const record: TaskCloseoutRecord = {
      schemaVersion: 1,
      taskId: report.taskId,
      mode: report.mode,
      status: report.summary.readyForHandoff ? "ready_for_resume" : "blocked",
      projectPath: ".",
      generatedAt: report.generatedAt,
      recordedAt: new Date().toISOString(),
      task: portableTask,
      summary: report.summary,
      checks: report.checks.map((check) =>
        toPortableCheck(this.projectPath, report.task?.workspacePath, check),
      ),
    };
    const dir = path.join(this.projectPath, CONFIG_DIR, "closeouts", report.taskId);
    await fs.mkdir(dir, { recursive: true });
    const fileName = `${sanitizeTimestamp(report.generatedAt)}-${report.mode}.json`;
    const recordPath = path.join(dir, fileName);
    await fs.writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
    return { record, path: recordPath };
  }

  /**
   * 读取指定任务的最新 CloseoutRecord
   *
   * 扫描 .agentgitops/closeouts/<task-id>/ 目录，按文件名时间戳排序，返回最新的记录。
   * 用于 task resume 命令恢复任务上下文。
   */
  static async readLatestCloseoutRecord(
    projectPath: string,
    taskId: string,
  ): Promise<TaskCloseoutRecord | null> {
    const dir = path.join(projectPath, CONFIG_DIR, "closeouts", taskId);
    if (!existsSync(dir)) return null;

    const entries = await fs.readdir(dir);
    const jsonFiles = entries
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();
    if (jsonFiles.length === 0) return null;

    const latestPath = path.join(dir, jsonFiles[0]);
    try {
      const content = await fs.readFile(latestPath, "utf-8");
      return JSON.parse(content) as TaskCloseoutRecord;
    } catch {
      return null;
    }
  }

  /**
   * 检测任务是否已直接合并到 main（merged-direct）
   *
   * 当 task 分支的 HEAD 已包含在 baseBranch 中时，说明代码已直接合并到 main。
   */
  static async detectMergedDirect(
    projectPath: string,
    targetBranch: string,
    baseBranch: string,
  ): Promise<boolean> {
    try {
      const result = await execa("git", [
        "-C",
        projectPath,
        "merge-base",
        "--is-ancestor",
        targetBranch,
        baseBranch,
      ]);
      return result.exitCode === 0;
    } catch {
      // merge-base --is-ancestor 返回非 0 表示不是祖先
      return false;
    }
  }

  private workspacePathFor(task: TaskContract): string {
    return path.join(
      path.resolve(this.projectPath, this.config.project.worktree_root),
      `${this.config.project.name}-${task.id}`,
    );
  }

  private async checkTaskSnapshot(task: TaskContract): Promise<TaskCloseoutCheck> {
    const relativePath = path.join(CONFIG_DIR, "tasks", `${task.id}.yml`);
    const absolutePath = path.join(this.projectPath, relativePath);
    if (!(await pathExists(absolutePath))) {
      return {
        name: "task-snapshot",
        status: "error",
        detail: `${relativePath} is missing. The task may exist only in local SQLite.`,
        recovery: [
          `Run agentgitops task update ${task.id} --title "${escapeShellText(task.title)}" to rewrite the task snapshot.`,
        ],
      };
    }

    const dirty = await this.gitStatus([relativePath]);
    if (dirty.trim()) {
      return {
        name: "task-snapshot",
        status: "error",
        detail: `${relativePath} has uncommitted changes.`,
        recovery: [`Commit and push ${relativePath} before leaving this location.`],
      };
    }

    return {
      name: "task-snapshot",
      status: "ok",
      detail: `${relativePath} is present and committed.`,
    };
  }

  private async checkWorkspace(
    task: TaskContract,
    workspacePath: string,
  ): Promise<TaskCloseoutCheck> {
    if (await pathExists(workspacePath)) {
      return { name: "workspace", status: "ok", detail: workspacePath };
    }

    const currentBranch = await this.tryGit(["branch", "--show-current"]);
    if (currentBranch === task.targetBranch) {
      return {
        name: "workspace",
        status: "warning",
        detail: `Task worktree is missing, but the current repository is checked out to ${task.targetBranch}.`,
        recovery: [
          `Recreate the task worktree with agentgitops task start ${task.id} when possible.`,
        ],
      };
    }

    return {
      name: "workspace",
      status: "error",
      detail: `Workspace not found: ${workspacePath}.`,
      recovery: [
        `Run agentgitops task start ${task.id} or agentgitops task resume ${task.id} after resume exists.`,
      ],
    };
  }

  private async checkWorkspaceBranch(
    task: TaskContract,
    workspacePath: string,
  ): Promise<TaskCloseoutCheck> {
    const repoPath = (await pathExists(workspacePath)) ? workspacePath : this.projectPath;
    const currentBranch = await this.tryGit(["branch", "--show-current"], repoPath);
    if (!currentBranch) {
      return {
        name: "workspace-branch",
        status: "error",
        detail: "Unable to read the current branch.",
        recovery: [`Inspect git status in ${repoPath}.`],
      };
    }
    if (currentBranch !== task.targetBranch) {
      return {
        name: "workspace-branch",
        status: "error",
        detail: `Current branch is ${currentBranch}, expected ${task.targetBranch}.`,
        recovery: [
          `Switch to the task workspace or run git -C ${repoPath} checkout ${task.targetBranch}.`,
        ],
      };
    }
    return { name: "workspace-branch", status: "ok", detail: currentBranch };
  }

  private async checkWorkspaceDirty(workspacePath: string): Promise<TaskCloseoutCheck> {
    const repoPath = (await pathExists(workspacePath)) ? workspacePath : this.projectPath;
    const status = await this.tryGit(["status", "--porcelain"], repoPath);
    if (status === undefined) {
      return {
        name: "workspace-dirty",
        status: "error",
        detail: `Unable to inspect git status in ${repoPath}.`,
        recovery: [`Run git -C ${repoPath} status --short manually.`],
      };
    }
    if (status.trim()) {
      const files = status.trim().split("\n").slice(0, 8).join("; ");
      return {
        name: "workspace-dirty",
        status: "error",
        detail: `Workspace has uncommitted changes: ${files}`,
        recovery: [
          "Commit the changes to the task branch, or stash them explicitly before closeout.",
          "Do not leave code changes only on one machine.",
        ],
      };
    }
    return {
      name: "workspace-dirty",
      status: "ok",
      detail: "Workspace has no uncommitted changes.",
    };
  }

  private async checkRemote(remote: string): Promise<TaskCloseoutCheck> {
    const remoteUrl = await this.tryGit(["remote", "get-url", remote]);
    if (!remoteUrl) {
      return {
        name: "git-remote",
        status: "error",
        detail: `Git remote not found: ${remote}.`,
        recovery: [`Configure a remote with git remote add ${remote} <url>.`],
      };
    }
    return { name: "git-remote", status: "ok", detail: `${remote}: ${redactRemoteUrl(remoteUrl)}` };
  }

  private async checkRemoteTrackingBranch(
    task: TaskContract,
    workspacePath: string,
    remote: string,
  ): Promise<TaskCloseoutCheck> {
    const repoPath = (await pathExists(workspacePath)) ? workspacePath : this.projectPath;
    const localHead = await this.tryGit(["rev-parse", "HEAD"], repoPath);
    if (!localHead) {
      return {
        name: "remote-head",
        status: "error",
        detail: "Unable to read local HEAD.",
        recovery: [`Run git -C ${repoPath} rev-parse HEAD manually.`],
      };
    }

    const remoteRef = `refs/remotes/${remote}/${task.targetBranch}`;
    const remoteHead = await this.tryGit(["rev-parse", "--verify", remoteRef], repoPath);
    if (!remoteHead) {
      return {
        name: "remote-head",
        status: "error",
        detail: `Remote tracking branch is missing: ${remote}/${task.targetBranch}.`,
        recovery: [
          `Run git fetch ${remote} and retry.`,
          `If the task has commits, push it with git -C ${repoPath} push -u ${remote} ${task.targetBranch}.`,
        ],
      };
    }

    if (localHead !== remoteHead) {
      return {
        name: "remote-head",
        status: "error",
        detail: `Local HEAD ${shortSha(localHead)} differs from ${remote}/${task.targetBranch} ${shortSha(remoteHead)}.`,
        recovery: [
          `Push or reconcile the branch before closeout: git -C ${repoPath} push ${remote} ${task.targetBranch}`,
        ],
      };
    }

    return {
      name: "remote-head",
      status: "ok",
      detail: `${remote}/${task.targetBranch} is at ${shortSha(remoteHead)}.`,
    };
  }

  private async checkChangePackage(
    task: TaskContract,
    mode: TaskCloseoutMode,
    workspacePath: string,
  ): Promise<TaskCloseoutCheck> {
    const relativePath = path.join(CONFIG_DIR, "packages", `${task.id}.json`);
    const absolutePath = path.join(this.projectPath, relativePath);
    const pkg = await this.loadChangePackage(absolutePath);
    const required = mode === "done" || mode === "merged-direct";
    if (!pkg) {
      return {
        name: "change-package",
        status: required ? "error" : "warning",
        detail: `Change Package not found: ${relativePath}.`,
        recovery: [`Run agentgitops package ${task.id}.`],
      };
    }

    if (pkg.taskId !== task.id || pkg.id !== `pkg_${task.id}`) {
      return {
        name: "change-package",
        status: "error",
        detail: `Change Package ${pkg.id} does not match task ${task.id}.`,
        recovery: [`Run agentgitops package ${task.id} again.`],
      };
    }

    if (pkg.baseBranch !== task.baseBranch || pkg.targetBranch !== task.targetBranch) {
      return {
        name: "change-package",
        status: "error",
        detail: `Package branches (${pkg.baseBranch} -> ${pkg.targetBranch}) differ from task (${task.baseBranch} -> ${task.targetBranch}).`,
        recovery: [`Run agentgitops package ${task.id} again.`],
      };
    }

    const dirty = await this.gitStatus([relativePath]);
    if (dirty.trim()) {
      return {
        name: "change-package",
        status: "error",
        detail: `${relativePath} has uncommitted changes.`,
        recovery: [`Commit and push ${relativePath} before closeout.`],
      };
    }

    const repoPath = (await pathExists(workspacePath)) ? workspacePath : this.projectPath;
    const latestSubstantiveCommitTime = await this.latestSubstantiveCommitTime(repoPath);
    if (
      latestSubstantiveCommitTime &&
      new Date(pkg.createdAt).getTime() < new Date(latestSubstantiveCommitTime).getTime()
    ) {
      return {
        name: "change-package",
        status: "warning",
        detail: `Package was generated before latest non-artifact commit time (${pkg.createdAt} < ${latestSubstantiveCommitTime}).`,
        recovery: [`Run agentgitops package ${task.id} again after the latest commit.`],
      };
    }

    const emptyPackage = pkg.changedFiles.length === 0 || pkg.stats.filesChanged === 0;
    if (emptyPackage && required) {
      return {
        name: "change-package",
        status: "error",
        detail: "Change Package has no changed files for a completion closeout.",
        recovery: [
          `Regenerate the package after code changes, or close out with --mode state-only if this task has no code changes.`,
        ],
      };
    }

    return {
      name: "change-package",
      status: emptyPackage ? "warning" : "ok",
      detail: `${pkg.id}: ${pkg.changedFiles.length} files, +${pkg.stats.insertions} -${pkg.stats.deletions}.`,
      recovery: emptyPackage
        ? [`Confirm this is intentionally a state-only or planning closeout.`]
        : undefined,
    };
  }

  private async checkVerification(
    task: TaskContract,
    mode: TaskCloseoutMode,
  ): Promise<TaskCloseoutCheck> {
    const runs = await new VerificationStore(this.projectPath).load(task.id);
    const required = mode === "done" || mode === "merged-direct";
    if (runs.length === 0) {
      const packageChecks = await this.loadChangePackageChecks(task);
      if (packageChecks.length > 0) {
        const failed = packageChecks.filter((check) => check.status !== "passed");
        if (failed.length > 0) {
          return {
            name: "verification",
            status: "error",
            detail: `${failed.length}/${packageChecks.length} packaged verification checks did not pass.`,
            recovery: failed.map((check) => `Fix and rerun packaged check: ${check.name}`),
          };
        }

        return {
          name: "verification",
          status: "ok",
          detail: `${packageChecks.length} packaged verification checks passed.`,
        };
      }

      return {
        name: "verification",
        status: required ? "error" : "warning",
        detail: "No verification runs recorded for this task.",
        recovery:
          task.requiredChecks.length > 0
            ? [`Run agentgitops test ${task.id}.`]
            : ["Record manual verification or add required checks before completion closeout."],
      };
    }

    const failed = runs.filter((run) => run.status !== "passed");
    if (failed.length > 0) {
      return {
        name: "verification",
        status: "error",
        detail: `${failed.length}/${runs.length} verification checks did not pass.`,
        recovery: failed.map((run) => `Fix and rerun: ${run.command}`),
      };
    }

    return {
      name: "verification",
      status: "ok",
      detail: `${runs.length} verification checks passed.`,
    };
  }

  private async loadChangePackageChecks(
    task: TaskContract,
  ): Promise<Array<{ name: string; status: string }>> {
    const packagePath = path.join(this.projectPath, CONFIG_DIR, "packages", `${task.id}.json`);
    const pkg = await this.loadChangePackage(packagePath);
    if (!pkg || !Array.isArray(pkg.checks)) return [];

    return pkg.checks
      .map((check) => ({
        name: typeof check.name === "string" ? check.name : "unnamed check",
        status: typeof check.status === "string" ? check.status : "unknown",
      }))
      .filter((check) => check.status.length > 0);
  }

  private async checkOutboxCommitted(): Promise<TaskCloseoutCheck> {
    const relativePath = path.join(CONFIG_DIR, "sync", "outbox");
    const absolutePath = path.join(this.projectPath, relativePath);
    if (!(await pathExists(absolutePath))) {
      return { name: "sync-outbox", status: "ok", detail: "No git-native outbox directory found." };
    }

    const eventCount = await countJsonFiles(path.join(absolutePath, "events"));
    const dirty = await this.gitStatus([relativePath]);
    if (dirty.trim()) {
      return {
        name: "sync-outbox",
        status: "error",
        detail: `${relativePath} has uncommitted sync files (${eventCount} event files total).`,
        recovery: [
          "Run agentgitops sync push --auto-commit --cleanup.",
          `Or commit ${relativePath} manually before switching locations.`,
        ],
      };
    }

    return {
      name: "sync-outbox",
      status: "ok",
      detail: `${eventCount} event files are committed.`,
    };
  }

  private async checkTaskArtifactsCommitted(task: TaskContract): Promise<TaskCloseoutCheck> {
    const paths = [
      path.join(CONFIG_DIR, "tasks", `${task.id}.yml`),
      path.join(CONFIG_DIR, "packages", `${task.id}.json`),
    ];
    const dirty = await this.gitStatus(paths);
    if (dirty.trim()) {
      return {
        name: "task-artifacts",
        status: "error",
        detail: `Task artifacts have uncommitted changes: ${dirty.trim().split("\n").join("; ")}`,
        recovery: [`Commit task/package artifacts before closeout.`],
      };
    }
    return {
      name: "task-artifacts",
      status: "ok",
      detail: "Task and package artifact paths are committed or absent.",
    };
  }

  private async checkCloseoutRecordsCommitted(task: TaskContract): Promise<TaskCloseoutCheck> {
    const relativePath = path.join(CONFIG_DIR, "closeouts", task.id);
    const absolutePath = path.join(this.projectPath, relativePath);
    if (!(await pathExists(absolutePath))) {
      return {
        name: "closeout-records",
        status: "warning",
        detail: `No closeout records found for ${task.id}.`,
        recovery: [`Run agentgitops task closeout ${task.id} --mode checkpoint --record.`],
      };
    }

    const recordCount = await countJsonFiles(absolutePath);
    if (recordCount === 0) {
      return {
        name: "closeout-records",
        status: "warning",
        detail: `No closeout records found for ${task.id}.`,
        recovery: [`Run agentgitops task closeout ${task.id} --mode checkpoint --record.`],
      };
    }

    const dirty = await this.gitStatus([relativePath]);
    if (dirty.trim()) {
      return {
        name: "closeout-records",
        status: "error",
        detail: `Closeout records have uncommitted changes: ${dirty.trim().split("\n").join("; ")}`,
        recovery: [`Commit ${relativePath} before switching locations.`],
      };
    }

    return {
      name: "closeout-records",
      status: "ok",
      detail: `${recordCount} closeout record files are committed.`,
    };
  }

  private async checkHandoff(
    task: TaskContract,
    mode: TaskCloseoutMode,
  ): Promise<TaskCloseoutCheck> {
    const handoffDir = path.join(this.projectPath, CONFIG_DIR, "handoffs");
    const required = mode === "pause" || mode === "checkpoint" || mode === "done";
    if (!(await pathExists(handoffDir))) {
      return {
        name: "handoff",
        status: required ? "warning" : "ok",
        detail: "No handoff directory found.",
        recovery: required ? [`Run agentgitops handoff generate ${task.id}.`] : undefined,
      };
    }

    const files = (await fs.readdir(handoffDir)).filter(
      (file) => file.endsWith(".json") || file.endsWith(".md"),
    );
    for (const file of files) {
      const handoffPath = path.join(handoffDir, file);
      const matchesTask = file.endsWith(".json")
        ? handoffSourceTaskId(await readJson(handoffPath)) === task.id
        : await markdownHandoffMatchesTask(handoffPath, task.id);
      if (matchesTask) {
        const dirty = await this.gitStatus([path.join(CONFIG_DIR, "handoffs")]);
        if (dirty.trim()) {
          return {
            name: "handoff",
            status: "warning",
            detail: `Handoff exists but has uncommitted changes under ${CONFIG_DIR}/handoffs.`,
            recovery: [`Commit the handoff files or export them through git-native sync.`],
          };
        }
        return { name: "handoff", status: "ok", detail: `Latest matching handoff file: ${file}.` };
      }
    }

    return {
      name: "handoff",
      status: required ? "warning" : "ok",
      detail: `No handoff package found for ${task.id}.`,
      recovery: required ? [`Run agentgitops handoff generate ${task.id}.`] : undefined,
    };
  }

  private checkTaskLifecycle(
    task: TaskContract,
    mode: TaskCloseoutMode,
    workspacePath: string,
  ): TaskCloseoutCheck {
    if (task.status === "merged" && mode !== "merged-direct" && mode !== "state-only") {
      return {
        name: "task-lifecycle",
        status: "warning",
        detail: `Task is already ${task.status}; closeout should normally use --mode merged-direct or state-only.`,
      };
    }
    if (task.status === "canceled" || task.status === "failed") {
      return {
        name: "task-lifecycle",
        status: "warning",
        detail: `Task is in terminal status ${task.status}.`,
      };
    }
    if (task.status === "workspace_created" && !existsSync(workspacePath)) {
      return {
        name: "task-lifecycle",
        status: "warning",
        detail:
          "Task says workspace_created, but the workspace is missing. This is a resume ambiguity.",
        recovery: [
          `Run agentgitops task start ${task.id} or mark the task with an explicit closeout state once supported.`,
        ],
      };
    }
    return {
      name: "task-lifecycle",
      status: "ok",
      detail: `Task status ${task.status} is acceptable for ${mode} closeout.`,
    };
  }

  private async loadChangePackage(pkgPath: string): Promise<ChangePackage | null> {
    try {
      return JSON.parse(await fs.readFile(pkgPath, "utf-8")) as ChangePackage;
    } catch {
      return null;
    }
  }

  private async gitStatus(paths: string[]): Promise<string> {
    const existingOrRequested = paths.filter(Boolean);
    if (existingOrRequested.length === 0) return "";
    return (await this.tryGit(["status", "--porcelain", "--", ...existingOrRequested])) ?? "";
  }

  private async tryGit(args: string[], cwd = this.projectPath): Promise<string | undefined> {
    try {
      const result = await execa("git", args, { cwd });
      return result.stdout.trim();
    } catch {
      return undefined;
    }
  }

  private async latestSubstantiveCommitTime(repoPath: string): Promise<string | undefined> {
    const log = await this.tryGit(["log", "-50", "--format=%H%x00%cI"], repoPath);
    if (!log) return undefined;
    for (const line of log.split("\n")) {
      const [sha, committedAt] = line.split("\0");
      if (!sha || !committedAt) continue;
      const files = await this.tryGit(
        ["diff-tree", "--no-commit-id", "--name-only", "-r", sha],
        repoPath,
      );
      const changedFiles = files?.split("\n").filter(Boolean) ?? [];
      if (changedFiles.some((filePath) => !isTaskArtifactPath(filePath))) {
        return committedAt;
      }
    }
    return undefined;
  }

  private buildReport(
    taskId: string,
    mode: TaskCloseoutMode,
    generatedAt: string,
    checks: TaskCloseoutCheck[],
    task?: TaskContract,
    workspacePath?: string,
  ): TaskCloseoutReport {
    const summary = {
      ok: checks.filter((check) => check.status === "ok").length,
      warning: checks.filter((check) => check.status === "warning").length,
      error: checks.filter((check) => check.status === "error").length,
      readyForHandoff: !checks.some((check) => check.status === "error"),
    };
    return {
      taskId,
      mode,
      projectPath: this.projectPath,
      generatedAt,
      summary,
      task:
        task && workspacePath
          ? {
              status: task.status,
              baseBranch: task.baseBranch,
              targetBranch: task.targetBranch,
              workspacePath,
            }
          : undefined,
      checks,
    };
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function markdownHandoffMatchesTask(filePath: string, taskId: string): Promise<boolean> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content.includes(taskId);
  } catch {
    return false;
  }
}

async function countJsonFiles(dir: string): Promise<number> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) count += await countJsonFiles(entryPath);
      else if (entry.isFile() && entry.name.endsWith(".json")) count++;
    }
    return count;
  } catch {
    return 0;
  }
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function redactRemoteUrl(remoteUrl: string): string {
  return remoteUrl.replace(/https:\/\/[^@/]+@/, "https://***@").replace(/:\/\/[^/@]+@/, "://***@");
}

function escapeShellText(text: string): string {
  return text.replace(/"/g, '\\"');
}

function sanitizeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}

function toPortableCheck(
  projectPath: string,
  workspacePath: string | undefined,
  check: TaskCloseoutCheck,
): TaskCloseoutCheck {
  return {
    ...check,
    detail: toPortableText(projectPath, workspacePath, check.detail),
    recovery: check.recovery?.map((item) => toPortableText(projectPath, workspacePath, item)),
  };
}

function toPortableText(
  projectPath: string,
  workspacePath: string | undefined,
  value: string,
): string {
  let portable = value.split(projectPath).join(".");
  if (workspacePath) {
    portable = portable.split(workspacePath).join(toPortablePath(projectPath, workspacePath));
  }
  return portable;
}

function toPortablePath(projectPath: string, targetPath: string): string {
  const relativePath = path.relative(projectPath, targetPath);
  return relativePath && !relativePath.startsWith("..")
    ? path.join(".", relativePath)
    : relativePath;
}

function isTaskArtifactPath(filePath: string): boolean {
  return (
    filePath.startsWith(".agentgitops/packages/") ||
    filePath.startsWith(".agentgitops/closeouts/") ||
    filePath.startsWith(".agentgitops/handoffs/") ||
    filePath.startsWith(".agentgitops/sync/outbox/") ||
    filePath.startsWith(".agentgitops/tasks/") ||
    filePath.startsWith(".agentgitops/verifications/") ||
    filePath === ".agentgitops/db.sqlite" ||
    filePath === ".agentgitops/db.sqlite-journal" ||
    filePath === ".agentgitops/db.sqlite-shm" ||
    filePath === ".agentgitops/db.sqlite-wal"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function handoffSourceTaskId(value: Record<string, unknown> | null): string | undefined {
  if (!value) return undefined;
  if (typeof value.sourceTaskId === "string") return value.sourceTaskId;
  const nested = value.handoff;
  if (nested && typeof nested === "object" && "sourceTaskId" in nested) {
    const sourceTaskId = (nested as { sourceTaskId?: unknown }).sourceTaskId;
    return typeof sourceTaskId === "string" ? sourceTaskId : undefined;
  }
  return undefined;
}
