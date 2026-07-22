import { Command } from "commander";
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

// 抑制 Node.js SQLite ExperimentalWarning 噪音
process.emitWarning = ((name: string, warning: Error) => {
  if (warning?.name === "ExperimentalWarning" && warning?.message?.includes("SQLite")) return;
  return process.emitWarning(warning, name);
}) as typeof process.emitWarning;
import type {
  ChangePackage,
  HandoffPackageType,
  LocalHubRegistration,
  ReviewAction,
  ReviewContext,
  SyncCursor,
  SyncEvent,
  SyncedTask,
  TaskContract,
  TeamSyncPullRequestContext,
  TaskStatus,
  BranchAdoption,
  TeamMember,
  TeamProject,
  TeamSyncMode,
} from "@agentgitops/core";
import {
  ConfigLoader,
  TaskManager,
  ChangePackageGenerator,
  WorkspaceManager,
  VerificationGate,
  VerificationStore,
  ReviewStore,
  LocalDb,
  TeamSyncStore,
  RelayClient,
  GitNativeSyncExporter,
  GitNativeSyncImporter,
  TeamSyncEventProducer,
  TeamSyncEventApplier,
  ContextFeedBuilder,
  formatAgentContextFeed,
  TeamSyncPullRequestContextBuilder,
  HandoffPackageBuilder,
  ConflictGraphBuilder,
  MergeGate,
  WorkflowJobRunner,
  buildWorkspaceEnvironment,
  collectRequiredChecks,
  createAgentAdapter,
  defaultTeamSyncConfig,
  resolveGitNativeConfig,
  resolveTaskTemplate,
  HandoffNoteGenerator,
  HandoffDocumentGenerator,
  HandoffDocumentStore,
  BranchOwnershipManager,
  ProjectRegistry,
  TaskCloseoutChecker,
  type AgentgitopsConfig,
  type ContextFeedFormat,
  type TaskCloseoutMode,
  type TaskCloseoutReport,
  type TeamSyncConfig,
  type TeamSyncStatusSummary,
} from "@agentgitops/local-hub";
import {
  GitService,
  WorktreeService,
  DiffService,
  GitHubProvider,
  GitLabProvider,
  formatChangePackagePullRequestBody,
  formatMergeRequestBody,
  formatReviewContextComment,
  formatHandoffComment,
  formatAgentNotesComment,
  getHandoffCommentMarker,
  getAgentNotesCommentMarker,
  parseGitHubRepository,
  parseGitLabRepository,
  type GitHubMergeMethod,
  type PullRequestBodyTemplate,
} from "@agentgitops/git";
import { buildReviewContext, startAgentGitOpsServer } from "@agentgitops/server";

const program = new Command();
const cwd = process.cwd();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);
const AGENTGITOPS_VERSION = "0.1.0";

type DiagnosticStatus = "ok" | "warning" | "error";

interface DiagnosticCheck {
  name: string;
  status: DiagnosticStatus;
  detail: string;
  recovery?: string[];
}

interface PullRequestContext {
  config: AgentgitopsConfig;
  task: TaskContract;
  pkg: ChangePackage;
  workspacePath: string;
  workspaceGit: GitService;
  repo: string;
  body: string;
  bodyTemplate: PullRequestBodyTemplate;
  reviewContext: ReviewContext;
  teamSync?: TeamSyncPullRequestContext;
  token?: string;
}

async function getConfig(): Promise<AgentgitopsConfig> {
  return ConfigLoader.load(cwd);
}

program
  .name("agentgitops")
  .description("Agent-native GitOps control plane for code agents")
  .version("0.1.0");

// ===== init =====
program
  .command("init")
  .description("Initialize agentgitops in the current project")
  .option("--name <name>", "Project name")
  .option("--git-provider <provider>", "Git provider (github/gitlab/gitea/local)")
  .option("--default-branch <branch>", "Default branch", "main")
  .option("--force", "Overwrite existing config")
  .action(async (opts: { name?: string; force?: boolean }) => {
    const name = opts.name ?? path.basename(cwd);
    const configPath = await ConfigLoader.init(cwd, name, { force: opts.force });
    console.log(`✓ Initialized agentgitops project: ${name}`);
    console.log(`  Config: ${configPath}`);
    console.log(`  Run 'agentgitops doctor' to verify environment`);
  });

// ===== doctor =====
program
  .command("doctor")
  .description("Check environment readiness")
  .action(async () => {
    const results = await ConfigLoader.doctor(cwd);
    for (const r of results) {
      const icon = r.status === "ok" ? "✓" : "✗";
      console.log(`${icon} ${r.name}: ${r.detail}`);
    }
    const allOk = results.every((r) => r.status === "ok");
    process.exitCode = allOk ? 0 : 1;
  });

// ===== project =====
const projectCmd = program.command("project").description("Project management");
projectCmd
  .command("status")
  .description("Show project status")
  .action(async () => {
    const config = await getConfig();
    const taskMgr = new TaskManager(cwd);
    const tasks = await taskMgr.list();
    console.log(`Project: ${config.project.name}`);
    console.log(`Git provider: ${config.git.provider}`);
    console.log(`Default branch: ${config.project.default_branch}`);
    console.log(`Agents: ${Object.keys(config.agents).join(", ")}`);
    console.log(`Tasks: ${tasks.length}`);
  });

// MP-001~005: 多项目工作区管理
projectCmd
  .command("list")
  .description("List all registered projects")
  .action(async () => {
    const registry = new ProjectRegistry();
    const projects = await registry.list();
    if (projects.length === 0) {
      console.log("No projects registered. Run 'agentgitops project add <path>' to add a project.");
      return;
    }
    const lastActive = await registry.getLastActive();
    console.log("ID".padEnd(12), "NAME".padEnd(20), "PATH".padEnd(50), "PORT".padEnd(8), "STATUS");
    for (const p of projects) {
      const marker = p.id === lastActive?.id ? " *" : "";
      console.log(
        p.id.padEnd(12),
        (p.name + marker).padEnd(20),
        p.path.padEnd(50),
        String(p.serverPort ?? "-").padEnd(8),
        p.status,
      );
    }
    console.log(`\n${projects.length} project(s) registered. (* = last active)`);
  });

projectCmd
  .command("add <path>")
  .description("Register a local Git repository as a project")
  .option("--name <name>", "Override project name")
  .action(async (inputPath: string, opts: { name?: string }) => {
    const registry = new ProjectRegistry();
    try {
      const project = await registry.add({ path: inputPath, name: opts.name });
      console.log(`✓ Project added: ${project.name}`);
      console.log(`  ID: ${project.id}`);
      console.log(`  Path: ${project.path}`);
      console.log(`  Git remote: ${project.gitRemote ?? "(none)"}`);
      console.log(`  Git provider: ${project.gitProvider ?? "(unknown)"}`);
      console.log(`  Default branch: ${project.defaultBranch ?? "(unknown)"}`);
      console.log(`  Server port: ${project.serverPort}`);
      console.log(`\nRun 'agentgitops web' to start the governance console.`);
    } catch (error) {
      console.error(
        `✗ Failed to add project: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    }
  });

projectCmd
  .command("remove <id>")
  .description("Remove a project from the registry")
  .action(async (id: string) => {
    const registry = new ProjectRegistry();
    const removed = await registry.remove(id);
    if (removed) {
      console.log(`✓ Project removed: ${id}`);
    } else {
      console.log(`Project not found: ${id}`);
      process.exitCode = 1;
    }
  });

projectCmd
  .command("switch <id>")
  .description("Switch the active project")
  .action(async (id: string) => {
    const registry = new ProjectRegistry();
    try {
      await registry.setActive(id);
      const project = await registry.get(id);
      console.log(`✓ Switched to: ${project?.name} (${id})`);
      console.log(`  Path: ${project?.path}`);
      console.log(`  Port: ${project?.serverPort}`);
    } catch (error) {
      console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  });

// ===== agent =====
const agentCmd = program.command("agent").description("Agent management");
agentCmd
  .command("register <name>")
  .description("Register or update an agent")
  .requiredOption("--command <command>", "Agent executable command")
  .option("--type <type>", "Agent adapter type", "generic-cli")
  .option("--arg <arg...>", "Agent command arguments")
  .option("--env <pair...>", "Environment variables as KEY=VALUE")
  .option("--disabled", "Register the agent as disabled")
  .action(
    async (
      name: string,
      opts: {
        command: string;
        type: string;
        arg?: string[];
        env?: string[];
        disabled?: boolean;
      },
    ) => {
      const config = await ConfigLoader.registerAgent(cwd, {
        name,
        type: opts.type,
        command: opts.command,
        args: opts.arg,
        env: parseEnvPairs(opts.env ?? []),
        enabled: opts.disabled ? false : true,
      });

      const agent = config.agents[name];
      console.log(`✓ Agent registered: ${name}`);
      console.log(`  Type: ${agent.type}`);
      console.log(`  Command: ${agent.command}`);
      console.log(`  Enabled: ${agent.enabled !== false ? "yes" : "no"}`);
    },
  );

agentCmd
  .command("list")
  .description("List registered agents")
  .action(async () => {
    const config = await getConfig();
    const agents = Object.entries(config.agents);
    if (agents.length === 0) {
      console.log("No agents registered.");
      return;
    }
    console.log("Registered agents:");
    for (const [name, agent] of agents) {
      const enabled = agent.enabled !== false ? "enabled" : "disabled";
      console.log(`  ${name} (${agent.type}, ${enabled}): ${agent.command}`);
    }
  });

agentCmd
  .command("remove <name>")
  .description("Remove a registered agent")
  .action(async (name: string) => {
    const config = await getConfig();
    if (!config.agents[name]) {
      console.error(`Agent not found: ${name}`);
      process.exitCode = 1;
      return;
    }
    delete config.agents[name];
    await ConfigLoader.save(cwd, config);
    await recordAudit(config, "agent.updated", { agent: name, action: "removed" });
    console.log(`✓ Agent removed: ${name}`);
  });

// ===== task =====
const taskCmd = program.command("task").description("Task management");

taskCmd
  .command("create <title>")
  .description("Create a task contract")
  .option("--agent <name>", "Agent name")
  .option("--template <name>", "Task template name from .agentgitops.yml")
  .option("--objective <text>", "Task objective")
  .option("--base-branch <branch>", "Base branch")
  .option("--allow <paths...>", "Allowed paths")
  .option("--forbid <paths...>", "Forbidden paths")
  .option("--check <commands...>", "Required check commands")
  .option("--risk <level>", "Risk level (low/medium/high/critical)")
  .option("--reviewer <users...>", "Required reviewers")
  .action(async (title: string, opts: Record<string, unknown>) => {
    const config = await getConfig();
    const template = resolveTaskTemplate(config, opts.template as string | undefined);
    const agentName = (opts.agent as string | undefined) ?? template?.agent ?? "generic";
    const taskMgr = new TaskManager(cwd);
    const task = await taskMgr.create({
      projectName: config.project.name,
      title,
      objective: (opts.objective as string | undefined) ?? template?.objective,
      background: template?.background,
      agentName,
      baseBranch:
        (opts.baseBranch as string | undefined) ??
        template?.base_branch ??
        config.project.default_branch,
      allowedPaths: await normalizeTaskPathPatterns(
        (opts.allow as string[] | undefined) ?? template?.allowed_paths,
      ),
      forbiddenPaths: await normalizeTaskPathPatterns(
        (opts.forbid as string[] | undefined) ?? template?.forbidden_paths,
      ),
      requiredChecks: (opts.check as string[] | undefined) ?? template?.required_checks,
      riskLevel:
        (opts.risk as "low" | "medium" | "high" | "critical" | undefined) ??
        template?.risk_level ??
        "low",
      riskDomains: template?.risk_domains,
      reviewers: (opts.reviewer as string[] | undefined) ?? template?.reviewers,
    });
    recordTeamSync((producer) => producer.recordTaskCreated(task));
    console.log(`✓ Task created: ${task.id}`);
    console.log(`  Title: ${task.title}`);
    console.log(`  Agent: ${task.agentId}`);
    console.log(`  Branch: ${task.targetBranch}`);
    console.log(`  Risk: ${task.riskLevel}`);
  });

taskCmd
  .command("update <task-id>")
  .description("Update a task contract")
  .option("--title <text>", "Task title")
  .option("--objective <text>", "Task objective")
  .option("--allow <paths...>", "Replace allowed paths")
  .option("--forbid <paths...>", "Replace forbidden paths")
  .option("--check <commands...>", "Replace required check commands")
  .option("--risk <level>", "Risk level (low/medium/high/critical)")
  .option("--reviewer <users...>", "Replace required reviewers")
  .action(async (taskId: string, opts: Record<string, unknown>) => {
    const riskLevel = opts.risk as "low" | "medium" | "high" | "critical" | undefined;
    if (riskLevel !== undefined && !["low", "medium", "high", "critical"].includes(riskLevel)) {
      console.error(`Invalid risk level: ${riskLevel}`);
      process.exitCode = 1;
      return;
    }

    const task = await new TaskManager(cwd).update(taskId, {
      title: opts.title as string | undefined,
      objective: opts.objective as string | undefined,
      allowedPaths: await normalizeTaskPathPatterns(opts.allow as string[] | undefined),
      forbiddenPaths: await normalizeTaskPathPatterns(opts.forbid as string[] | undefined),
      requiredChecks: opts.check as string[] | undefined,
      riskLevel,
      reviewers: opts.reviewer as string[] | undefined,
    });
    recordTeamSync((producer) => producer.recordTaskUpdated(task));
    console.log(`✓ Task updated: ${task.id}`);
    console.log(`  Title: ${task.title}`);
    console.log(`  Risk: ${task.riskLevel}`);
    console.log(`  Allowed: ${task.allowedPaths.join(", ") || "(any)"}`);
    console.log(`  Checks: ${task.requiredChecks.join(", ") || "(none)"}`);
  });

taskCmd
  .command("reconcile")
  .alias("sync-snapshots")
  .description("Reconcile local SQLite task state from Git task snapshots")
  .option("--dry-run", "Report snapshot drift without updating SQLite")
  .option("--json", "Print machine-readable JSON")
  .action(async (opts: { dryRun?: boolean; json?: boolean }) => {
    const result = await new TaskManager(cwd).reconcileFromSnapshots({ dryRun: opts.dryRun });
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`Task snapshot reconcile ${opts.dryRun ? "dry-run" : "complete"}`);
    console.log(`Checked: ${result.checked}`);
    console.log(`Updated from snapshots: ${result.updated}`);
    console.log(`Pending snapshot updates: ${result.pending}`);
    console.log(`Unchanged: ${result.unchanged}`);
    if (result.sqliteOnly > 0) console.log(`SQLite-only tasks: ${result.sqliteOnly}`);
    if (result.drift.length > 0) {
      console.log("Drift:");
      for (const item of result.drift.slice(0, 12)) {
        const status = `${item.sqliteStatus ?? "-"} -> ${item.snapshotStatus ?? "-"}`;
        console.log(`  - ${item.taskId}: ${item.reason} (${status})`);
      }
      if (result.drift.length > 12) console.log(`  ... ${result.drift.length - 12} more`);
    }
    if (opts.dryRun && result.pending > 0) {
      console.log(
        "Run agentgitops task reconcile to update local SQLite from committed task snapshots.",
      );
    }
  });

taskCmd
  .command("list")
  .description("List tasks")
  .action(async () => {
    const taskMgr = new TaskManager(cwd);
    const tasks = await taskMgr.list();
    if (tasks.length === 0) {
      console.log("No tasks found.");
      return;
    }
    console.log("TASK ID".padEnd(26), "AGENT".padEnd(16), "STATUS".padEnd(14), "RISK".padEnd(10));
    for (const t of tasks) {
      console.log(
        t.id.padEnd(26),
        t.agentId.padEnd(16),
        t.status.padEnd(14),
        t.riskLevel.padEnd(10),
      );
    }
  });

taskCmd
  .command("status [task-id]")
  .description("Show task status")
  .action(async (taskId?: string) => {
    const taskMgr = new TaskManager(cwd);
    if (taskId) {
      const task = await taskMgr.load(taskId);
      console.log(`Task: ${task.id}`);
      console.log(`  Title: ${task.title}`);
      console.log(`  Agent: ${task.agentId}`);
      console.log(`  Status: ${task.status}`);
      console.log(`  Risk: ${task.riskLevel}`);
      console.log(`  Base: ${task.baseBranch}`);
      console.log(`  Target: ${task.targetBranch}`);
      console.log(`  Allowed: ${task.allowedPaths.join(", ") || "(any)"}`);
      console.log(`  Forbidden: ${task.forbiddenPaths.join(", ") || "(none)"}`);
      console.log(`  Checks: ${task.requiredChecks.join(", ") || "(none)"}`);
    } else {
      const tasks = await taskMgr.list();
      console.log(`Total tasks: ${tasks.length}`);
      for (const t of tasks) {
        console.log(`  ${t.id} [${t.status}] ${t.title}`);
      }
    }
  });

taskCmd
  .command("closeout <task-id>")
  .description("Diagnose whether a task is safe to hand off, pause, or finish")
  .option(
    "--mode <mode>",
    "Closeout mode: checkpoint, pause, done, merged-direct, or state-only",
    "checkpoint",
  )
  .option("--remote <name>", "Git remote name")
  .option("--json", "Print machine-readable JSON")
  .option("--record", "Write a CloseoutRecord under .agentgitops/closeouts/<task-id>")
  .option("--auto-fix", "Generate missing package/outbox artifacts when possible before checking")
  .option("--push", "Auto git add -f + commit + push task artifacts after closeout")
  .action(
    async (
      taskId: string,
      opts: {
        mode?: string;
        remote?: string;
        json?: boolean;
        record?: boolean;
        autoFix?: boolean;
        push?: boolean;
      },
    ) => {
      const mode = parseTaskCloseoutMode(opts.mode);

      const config = await getConfig();
      const checker = new TaskCloseoutChecker(cwd, config);

      // --auto-fix: 自动补齐缺失的 package/outbox
      let autoFixResults: string[] = [];
      if (opts.autoFix) {
        autoFixResults = await autoFixCloseout(taskId, config);
      }

      const report = await checker.check(taskId, {
        mode,
        remote: opts.remote ?? config.git.remote,
      });
      const recordResult = opts.record ? await checker.writeRecord(report) : undefined;

      // --push: 自动 commit + push 任务产物
      let pushResult: { committed: boolean; pushed: boolean; error?: string } | undefined;
      if (opts.push) {
        pushResult = await autoGitCommitAndPush(`chore(closeout): ${taskId} ${mode}`);
      }

      if (opts.json) {
        console.log(
          JSON.stringify(
            { ...report, closeoutRecord: recordResult, autoFix: autoFixResults, push: pushResult },
            null,
            2,
          ),
        );
      } else {
        printTaskCloseoutReport(report);
        if (autoFixResults.length > 0) {
          console.log(`Auto-fix actions:`);
          for (const action of autoFixResults) {
            console.log(`  ✓ ${action}`);
          }
        }
        if (recordResult) {
          console.log(`Closeout record written: ${path.relative(cwd, recordResult.path)}`);
          console.log(`Closeout record status: ${recordResult.record.status}`);
        }
        if (pushResult) {
          if (pushResult.pushed) {
            console.log(`✓ Auto-committed and pushed.`);
          } else {
            console.log(`✗ Push failed: ${pushResult.error ?? "unknown"}`);
          }
        }
      }
      process.exitCode = report.summary.error > 0 ? 1 : 0;
    },
  );

taskCmd
  .command("start <task-id>")
  .description("Create or verify a task workspace")
  .action(async (taskId: string) => {
    const config = await getConfig();
    const taskMgr = new TaskManager(cwd);
    const task = await taskMgr.load(taskId);
    if (["canceled", "merged"].includes(task.status)) {
      console.error(`Task ${task.id} cannot be started from status ${task.status}.`);
      process.exitCode = 1;
      return;
    }

    const workspacePath = workspacePathFor(config, task);
    if (!(await pathExists(workspacePath))) {
      const worktreeRoot = path.resolve(cwd, config.project.worktree_root);
      await new WorkspaceManager(cwd, worktreeRoot).create(task);
      await recordAudit(
        config,
        "workspace.created",
        { taskId: task.id, path: workspacePath },
        task.id,
      );
    }

    const updated = await taskMgr.updateStatus(task.id, "workspace_created");
    recordTeamSync((producer) => producer.recordTaskUpdated(updated));
    await recordAudit(config, "task.started", { taskId: task.id, workspacePath }, task.id);
    console.log(`✓ Task workspace ready: ${task.id}`);
    console.log(`  Workspace: ${workspacePath}`);
  });

taskCmd
  .command("resume <task-id>")
  .description("Resume a task from the latest closeout record (cross-machine handoff)")
  .option("--recreate-worktree", "Recreate the worktree if it does not exist")
  .option("--json", "Print machine-readable JSON")
  .action(async (taskId: string, opts: { recreateWorktree?: boolean; json?: boolean }) => {
    const config = await getConfig();
    const taskMgr = new TaskManager(cwd);

    // 1. 加载任务
    let task: TaskContract;
    try {
      task = await taskMgr.load(taskId);
    } catch (error) {
      console.error(
        `Task not found: ${taskId}. ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
      return;
    }

    // 2. 检查任务状态
    if (["canceled", "merged", "failed"].includes(task.status)) {
      console.error(`Task ${task.id} cannot be resumed from status ${task.status}.`);
      process.exitCode = 1;
      return;
    }

    // 3. 读取最新 closeout 记录
    const closeoutRecord = await TaskCloseoutChecker.readLatestCloseoutRecord(cwd, taskId);
    if (!closeoutRecord) {
      console.log(`No closeout record found for ${taskId}.`);
      console.log(
        `  Run 'agentgitops task closeout ${taskId} --mode checkpoint --record' on the source machine first.`,
      );
      process.exitCode = 1;
      return;
    }

    // 4. 检测 merged-direct（代码已直接合并到 main）
    const mergedDirect = await TaskCloseoutChecker.detectMergedDirect(
      cwd,
      task.targetBranch,
      task.baseBranch,
    );

    // 5. 检查 worktree 是否存在
    const workspacePath = workspacePathFor(config, task);
    const worktreeExists = await pathExists(workspacePath);

    // 6. 必要时重建 worktree
    let worktreeRecreated = false;
    if (!worktreeExists && opts.recreateWorktree) {
      try {
        const worktreeRoot = path.resolve(cwd, config.project.worktree_root);
        await new WorkspaceManager(cwd, worktreeRoot).create(task);
        worktreeRecreated = true;
        await recordAudit(
          config,
          "workspace.created",
          { taskId: task.id, path: workspacePath, resumed: true },
          task.id,
        );
      } catch (error) {
        console.error(
          `Failed to recreate worktree: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exitCode = 1;
        return;
      }
    }

    // 7. 记录审计事件
    await recordAudit(
      config,
      "task.resumed",
      {
        taskId: task.id,
        closeoutMode: closeoutRecord.mode,
        closeoutStatus: closeoutRecord.status,
        mergedDirect,
        worktreeRecreated,
        workspacePath,
      },
      task.id,
    );

    // 8. 输出结果
    const resumeInfo = {
      taskId: task.id,
      title: task.title,
      status: task.status,
      closeout: {
        mode: closeoutRecord.mode,
        status: closeoutRecord.status,
        generatedAt: closeoutRecord.generatedAt,
        recordedAt: closeoutRecord.recordedAt,
        summary: closeoutRecord.summary,
      },
      mergedDirect,
      workspace: {
        path: workspacePath,
        exists: worktreeExists || worktreeRecreated,
        recreated: worktreeRecreated,
      },
      nextAction: mergedDirect
        ? {
            kind: "merged-direct",
            message: `Code from ${task.targetBranch} is already reachable from ${task.baseBranch}. Continue from ${task.baseBranch} and use closeout records as the handoff source.`,
            commands: [
              `git checkout ${task.baseBranch}`,
              `agentgitops task closeout ${task.id} --mode checkpoint --record`,
              "agentgitops task reconcile",
            ],
          }
        : undefined,
      warnings: closeoutRecord.checks
        .filter((c) => c.status === "warning" || c.status === "error")
        .map((c) => `${c.name}: ${c.detail}`),
    };

    if (opts.json) {
      console.log(JSON.stringify(resumeInfo, null, 2));
    } else {
      console.log(`✓ Task resumed: ${task.id}`);
      console.log(`  Title: ${task.title}`);
      console.log(`  Status: ${task.status}`);
      console.log(`  Closeout mode: ${closeoutRecord.mode}`);
      console.log(`  Closeout status: ${closeoutRecord.status}`);
      console.log(`  Closeout generated: ${closeoutRecord.generatedAt}`);
      if (mergedDirect) {
        console.log(
          `  ⚠ Code already merged to ${task.baseBranch} (merged-direct). Task may need status update.`,
        );
        console.log(
          `  Next action: continue from ${task.baseBranch}; use the closeout record as handoff evidence instead of reviving the old task branch.`,
        );
        console.log(`  Suggested: agentgitops task closeout ${task.id} --mode checkpoint --record`);
      }
      console.log(`  Workspace: ${workspacePath}`);
      if (worktreeRecreated) {
        console.log(`  ✓ Worktree recreated.`);
      } else if (!worktreeExists) {
        console.log(`  ⚠ Worktree not found. Use --recreate-worktree to create it.`);
      }
      if (resumeInfo.warnings.length > 0) {
        console.log(`  Closeout warnings (${resumeInfo.warnings.length}):`);
        for (const w of resumeInfo.warnings.slice(0, 5)) {
          console.log(`    - ${w}`);
        }
      }
    }
  });

taskCmd
  .command("cancel <task-id>")
  .description("Cancel a task")
  .action(async (taskId: string) => {
    const config = await getConfig();
    const task = await new TaskManager(cwd).updateStatus(taskId, "canceled");
    recordTeamSync((producer) => producer.recordTaskUpdated(task));
    await recordAudit(config, "task.canceled", { taskId }, task.id);
    console.log(`✓ Task canceled: ${task.id}`);
  });

taskCmd
  .command("adopt <branch-or-task>")
  .description("Adopt an existing Team Sync task branch and create a local worktree")
  .option("--force", "Allow adoption when another active adoption exists")
  .option("--preview", "Preview the handoff package without writing files or creating a worktree")
  .action(async (branchOrTask: string, opts: { force?: boolean; preview?: boolean }) => {
    const config = await getConfig();
    const store = new TeamSyncStore(cwd);
    let source = resolveSyncedTaskReference(store, branchOrTask);
    if (!source) {
      try {
        const localTask = await new TaskManager(cwd).load(branchOrTask);
        recordTeamSync((producer) => producer.recordTaskUpdated(localTask));
        source = resolveSyncedTaskReference(store, branchOrTask);
      } catch {
        // The input may be a raw branch name from a remote Team Sync cache.
      }
    }
    if (!source) {
      console.error(`No synced task or branch found for adoption: ${branchOrTask}`);
      process.exitCode = 1;
      store.close();
      return;
    }

    const summary = store.getStatusSummary(source.teamId);
    if (!summary.team || !summary.localHub) {
      console.error(
        "Team Sync is not initialized. Run 'agentgitops team init' or 'agentgitops team join'.",
      );
      process.exitCode = 1;
      store.close();
      return;
    }

    const active = store.getActiveBranchAdoption(summary.team.teamId, source.taskId);
    if (active && !opts.force) {
      console.error(
        `Task ${source.taskId} is already adopted by ${active.adoptedBy}. Use --force to override.`,
      );
      process.exitCode = 1;
      store.close();
      return;
    }
    store.close();

    const builder = new HandoffPackageBuilder(cwd);
    try {
      const built = await builder.build({
        type: "adopt",
        sourceTaskId: source.taskId,
        createdBy: summary.localHub.memberId,
      });
      if (opts.preview) {
        console.log(built.markdown);
        return;
      }

      const written = await builder.write(built);
      const worktreeRoot = path.resolve(cwd, config.project.worktree_root);
      const workspacePath = path.join(
        worktreeRoot,
        `${config.project.name}-adopt-${sanitizePathSegment(source.taskId)}`,
      );
      if (!(await pathExists(workspacePath))) {
        await new WorktreeService(cwd).addExisting(workspacePath, source.targetBranch);
      }
      const now = new Date().toISOString();
      const adoption: BranchAdoption = {
        adoptionId: `adopt_${randomUUID()}`,
        teamId: source.teamId,
        taskId: source.taskId,
        sourceBranch: source.targetBranch,
        adoptedBy: summary.localHub.memberId,
        previousOwner: source.ownerMemberId,
        status: "active",
        createdAt: now,
        updatedAt: now,
      };
      recordTeamSync((producer) => producer.recordTaskAdopted(adoption, written.handoff));
      await recordAudit(
        config,
        "task.adopted",
        {
          taskId: source.taskId,
          sourceBranch: source.targetBranch,
          handoffId: written.handoff.handoffId,
          workspacePath,
        },
        source.taskId,
      );
      console.log(`✓ Task adopted: ${source.taskId}`);
      console.log(`  Source branch: ${source.targetBranch}`);
      console.log(`  Workspace: ${workspacePath}`);
      console.log(`  Handoff: ${path.relative(cwd, written.markdownPath)}`);
    } finally {
      builder.close();
    }
  });

taskCmd
  .command("continue <task-id>")
  .description("Continue a Team Sync task on a new local task branch")
  .option("--agent <name>", "Agent name")
  .option("--title <title>", "New task title")
  .option("--objective <text>", "New task objective")
  .option("--preview", "Preview the handoff package without creating the new task")
  .action(
    async (
      sourceTaskId: string,
      opts: { agent?: string; title?: string; objective?: string; preview?: boolean },
    ) => {
      const config = await getConfig();
      const taskMgr = new TaskManager(cwd);
      const sourceTask = await taskMgr.load(sourceTaskId);

      const store = new TeamSyncStore(cwd);
      const summary = store.getStatusSummary();
      const syncedSource = store.getSyncedTask(sourceTaskId);
      store.close();
      if (!summary.team || !summary.localHub || !syncedSource) {
        console.error(
          "Team Sync source task is not available. Run 'agentgitops team init' and sync the source task first.",
        );
        process.exitCode = 1;
        return;
      }

      const builder = new HandoffPackageBuilder(cwd);
      try {
        const agentName = opts.agent ?? sourceTask.agentId;
        if (opts.preview) {
          const preview = await builder.build({
            type: "continue",
            sourceTaskId: sourceTask.id,
            targetTaskId: `preview_${sourceTask.id}`,
            targetBranch: `agent/preview-${sourceTask.id}/${agentName}`,
            createdBy: summary.localHub.memberId,
          });
          console.log(preview.markdown);
          return;
        }

        const targetTask = await taskMgr.create({
          projectName: config.project.name,
          title: opts.title ?? `Continue ${sourceTask.title}`,
          objective: opts.objective ?? `Continue work from ${sourceTask.id}`,
          agentName,
          baseBranch: sourceTask.targetBranch,
          riskLevel: sourceTask.riskLevel,
          riskDomains: sourceTask.riskDomains,
          allowedPaths: sourceTask.allowedPaths,
          forbiddenPaths: sourceTask.forbiddenPaths,
          requiredChecks: sourceTask.requiredChecks,
          reviewers: sourceTask.approval.reviewers,
        });

        const built = await builder.build({
          type: "continue",
          sourceTaskId: sourceTask.id,
          targetTaskId: targetTask.id,
          targetBranch: targetTask.targetBranch,
          createdBy: summary.localHub.memberId,
        });
        const written = await builder.write(built);
        const worktreeRoot = path.resolve(cwd, config.project.worktree_root);
        await new WorkspaceManager(cwd, worktreeRoot).create(targetTask);
        const updated = await taskMgr.updateStatus(targetTask.id, "workspace_created");
        recordTeamSync((producer) => {
          producer.recordTaskUpdated(sourceTask);
          producer.recordTaskCreated(updated);
          producer.recordTaskContinued(sourceTask, updated, written.handoff);
        });
        await recordAudit(
          config,
          "task.continued",
          {
            sourceTaskId: sourceTask.id,
            targetTaskId: updated.id,
            sourceBranch: sourceTask.targetBranch,
            targetBranch: updated.targetBranch,
            handoffId: written.handoff.handoffId,
          },
          updated.id,
        );
        console.log(`✓ Task continued: ${updated.id}`);
        console.log(`  Source task: ${sourceTask.id}`);
        console.log(`  Base branch: ${updated.baseBranch}`);
        console.log(`  Target branch: ${updated.targetBranch}`);
        console.log(`  Handoff: ${path.relative(cwd, written.markdownPath)}`);
      } finally {
        builder.close();
      }
    },
  );

// ===== run =====
program
  .command("run")
  .description("Run an agent for a task")
  .requiredOption("--agent <name>", "Agent name")
  .requiredOption("--task <task-id>", "Task ID")
  .option("--foreground", "Run in foreground with live logs")
  .action(async (opts: { agent: string; task: string; foreground?: boolean }) => {
    await runCliWorkflowJob("task.run", opts.task, { agent: opts.agent }, async () => {
      const config = await getConfig();
      const taskMgr = new TaskManager(cwd);
      const task = await taskMgr.load(opts.task);

      const agentConfig = config.agents[opts.agent];
      if (!agentConfig) {
        console.error(`Agent not found: ${opts.agent}`);
        console.error(`Available: ${Object.keys(config.agents).join(", ")}`);
        process.exitCode = 1;
        return { message: `Agent not found: ${opts.agent}` };
      }

      // Create workspace via WorktreeService
      const worktreeRoot = path.resolve(cwd, config.project.worktree_root);
      const workspacePath = path.join(worktreeRoot, `${config.project.name}-${task.id}`);

      const ws = new WorkspaceManager(cwd, worktreeRoot);
      await ws.create(task);

      // Update task status
      await taskMgr.updateStatus(task.id, "workspace_created");
      await taskMgr.updateStatus(task.id, "running");

      console.log(`Starting agent: ${opts.agent} for task: ${task.id}`);
      console.log(`  Workspace: ${workspacePath}`);

      const adapter = createAgentAdapter(agentConfig.type);
      const result = await adapter.run({
        taskContract: task,
        workspacePath,
        command: agentConfig.command,
        args: agentConfig.args ?? [],
        env: buildWorkspaceEnvironment(config.workspace?.env, agentConfig.env),
        policies: config.policies,
        logRoot: path.join(cwd, ".agentgitops", "logs"),
      });

      console.log(`Agent finished: exit=${result.exitCode}, status=${result.status}`);

      // 产生 agent.session.completed 事件（Sprint B1/B2），让接续 Agent 知道前一个 Agent 的策略、步骤、失败原因
      if (result.executionSummary) {
        const syncConfig = config.team?.sync ?? defaultTeamSyncConfig();
        recordTeamSync((producer) =>
          producer.recordAgentSessionCompleted(task.id, result.executionSummary!, syncConfig),
        );

        // TS-P1-005: 自动生成可审查的 AI Handoff Note
        const noteGenerator = new HandoffNoteGenerator();
        const handoffNote = noteGenerator.generate({
          taskId: task.id,
          agentId: opts.agent,
          execution: result.executionSummary,
        });
        const noteDb = new LocalDb(cwd);
        try {
          noteDb.insertAgentNote(handoffNote);
          noteDb.insertAuditEvent({
            id: `audit_${randomUUID()}`,
            projectId: config.project.name,
            taskId: task.id,
            actorType: "agent",
            actorId: opts.agent,
            eventType: "agent.note.auto_generated",
            payload: { noteId: handoffNote.id, executionStatus: result.executionSummary.status },
          });
        } finally {
          noteDb.close();
        }
        recordTeamSync((producer) => producer.recordAgentNoteCreated(handoffNote));
        console.log(`✓ Auto-generated handoff note: ${handoffNote.id}`);
      }

      // HD-002: 自动生成自由格式 Markdown 交接文档
      if (result.executionSummary) {
        try {
          const docGenerator = new HandoffDocumentGenerator();
          const docStore = new HandoffDocumentStore(cwd);
          const doc = docGenerator.generate({
            taskId: task.id,
            agentId: opts.agent,
            agentType: config.agents[opts.agent]?.type ?? "generic-cli",
            execution: result.executionSummary,
          });
          await docStore.save(doc);
          console.log(`✓ Auto-generated handoff document: ${doc.docId}`);
        } catch {
          // 交接文档生成失败不影响主流程
        }
      }

      const updated = await taskMgr.updateStatus(
        task.id,
        result.status === "completed" ? "testing" : "failed",
      );
      recordTeamSync((producer) => {
        producer.recordTaskUpdated(updated);
        producer.recordAgentSessionCompleted(
          task.id,
          result.executionSummary,
          resolveTeamSyncConfig(config.team?.sync),
        );
      });
      return { message: `Agent finished with status ${result.status}`, task: updated };
    });
  });

// ===== workspace =====
const workspaceCmd = program.command("workspace").description("Workspace management");

workspaceCmd
  .command("list")
  .description("List task workspaces")
  .action(async () => {
    const config = await getConfig();
    const tasks = await new TaskManager(cwd).list();
    if (tasks.length === 0) {
      console.log("No tasks found.");
      return;
    }

    console.log("TASK ID".padEnd(26), "STATUS".padEnd(14), "WORKSPACE");
    for (const task of tasks) {
      const workspacePath = workspacePathFor(config, task);
      const exists = await pathExists(workspacePath);
      console.log(
        task.id.padEnd(26),
        (exists ? workspaceStatusFromTask(task.status) : "removed").padEnd(14),
        workspacePath,
      );
    }
  });

workspaceCmd
  .command("sweep")
  .description("Archive and optionally clean completed task worktrees")
  .option("--cleanup-after-days <days>", "Override configured cleanup age")
  .option("--dry-run", "Preview archive/cleanup decisions without removing worktrees")
  .action(async (opts: { cleanupAfterDays?: string; dryRun?: boolean }) => {
    const config = await getConfig();
    const tasks = await new TaskManager(cwd).list();
    const cleanupAfterDays =
      opts.cleanupAfterDays === undefined
        ? config.workspace?.cleanup_after_days
        : Number.parseInt(opts.cleanupAfterDays, 10);
    if (
      cleanupAfterDays !== undefined &&
      (!Number.isFinite(cleanupAfterDays) || cleanupAfterDays < 0)
    ) {
      console.error("--cleanup-after-days must be a non-negative integer");
      process.exitCode = 1;
      return;
    }
    const manager = new WorkspaceManager(cwd, path.resolve(cwd, config.project.worktree_root));
    const result = await manager.sweep(tasks, {
      archiveStatuses: config.workspace?.archive_statuses,
      cleanupAfterDays,
      dryRun: opts.dryRun,
    });
    console.log(`Archived workspaces: ${result.archived.length}`);
    console.log(`${opts.dryRun ? "Would remove" : "Removed"} workspaces: ${result.removed.length}`);
    for (const workspace of result.removed) {
      console.log(`  ${workspace.taskId}: ${workspace.path}`);
    }
    if (result.skipped.length > 0) {
      console.log(`Skipped: ${result.skipped.length}`);
    }
  });

workspaceCmd
  .command("open <task-id>")
  .description("Open a workspace in Finder, or print the path when opening is unavailable")
  .option("--print", "Print the workspace path without opening Finder")
  .action(async (taskId: string, opts: { print?: boolean }) => {
    const config = await getConfig();
    const task = await new TaskManager(cwd).load(taskId);
    const workspacePath = workspacePathFor(config, task);
    if (!(await pathExists(workspacePath))) {
      console.error(`Workspace not found for ${task.id}: ${workspacePath}`);
      process.exitCode = 1;
      return;
    }

    if (opts.print || process.platform !== "darwin") {
      console.log(workspacePath);
      return;
    }

    await execFileAsync("open", [workspacePath]);
    console.log(`✓ Opened workspace: ${workspacePath}`);
  });

workspaceCmd
  .command("clean <task-id>")
  .description("Remove a task worktree and keep the branch")
  .action(async (taskId: string) => {
    const config = await getConfig();
    const task = await new TaskManager(cwd).load(taskId);
    const workspacePath = workspacePathFor(config, task);
    if (!(await pathExists(workspacePath))) {
      console.log(`Workspace already removed: ${workspacePath}`);
      return;
    }

    await new WorkspaceManager(cwd, path.resolve(cwd, config.project.worktree_root)).clean({
      id: `ws_${task.id}`,
      taskId: task.id,
      projectId: task.projectId,
      path: workspacePath,
      branch: task.targetBranch,
      baseBranch: task.baseBranch,
      status: "created",
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    });
    await recordAudit(
      config,
      "workspace.removed",
      { taskId: task.id, path: workspacePath, branchDeleted: false },
      task.id,
    );
    console.log(`✓ Workspace removed: ${workspacePath}`);
    console.log(`  Branch kept: ${task.targetBranch}`);
  });

workspaceCmd
  .command("remove <task-id>")
  .description("Remove a task worktree and local branch")
  .action(async (taskId: string) => {
    const config = await getConfig();
    const task = await new TaskManager(cwd).load(taskId);
    const workspacePath = workspacePathFor(config, task);
    if (await pathExists(workspacePath)) {
      await new WorkspaceManager(cwd, path.resolve(cwd, config.project.worktree_root)).clean({
        id: `ws_${task.id}`,
        taskId: task.id,
        projectId: task.projectId,
        path: workspacePath,
        branch: task.targetBranch,
        baseBranch: task.baseBranch,
        status: "created",
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      });
    }

    await deleteLocalBranch(task.targetBranch);
    await recordAudit(
      config,
      "workspace.removed",
      { taskId: task.id, path: workspacePath, branchDeleted: true },
      task.id,
    );
    console.log(`✓ Workspace removed: ${workspacePath}`);
    console.log(`✓ Local branch removed: ${task.targetBranch}`);
  });

// ===== diff =====
program
  .command("diff <task-id>")
  .description("Show git diff for a task")
  .option("--stat", "Show only statistics")
  .action(async (taskId: string, opts: { stat?: boolean }) => {
    const config = await getConfig();
    const taskMgr = new TaskManager(cwd);
    const task = await taskMgr.load(taskId);
    const worktreeRoot = path.resolve(cwd, config.project.worktree_root);
    const workspacePath = path.join(worktreeRoot, `${config.project.name}-${task.id}`);

    const diffService = new DiffService(workspacePath);
    if (opts.stat) {
      const stat = await diffService.getDiffStat(task.baseBranch);
      console.log(`Files changed: ${stat.changedFiles.length}`);
    } else {
      const files = await diffService.getChangedFiles(task.baseBranch);
      if (files.length === 0) {
        console.log("No changes detected.");
      } else {
        console.log("Changed files:");
        for (const f of files) {
          console.log(`  ${f}`);
        }
        console.log("\n--- Full diff ---");
        const diff = await diffService.getDiff(task.baseBranch);
        console.log(diff);
      }
    }
  });

// ===== merge =====
const mergeCmd = program.command("merge").description("Local merge governance");

mergeCmd
  .command("queue")
  .description("Show tasks waiting for merge review")
  .action(async () => {
    const tasks = await new TaskManager(cwd).list();
    const queued = tasks.filter((task) => task.status === "reviewing");
    if (queued.length === 0) {
      console.log("Merge queue is empty.");
      return;
    }
    console.log("TASK ID".padEnd(26), "RISK".padEnd(10), "PR");
    for (const task of queued) {
      const pkg = await tryLoadChangePackage(task.id);
      console.log(task.id.padEnd(26), task.riskLevel.padEnd(10), pkg?.prUrl ?? "(no PR)");
    }
  });

mergeCmd
  .command("approve <task-id>")
  .description("Run merge gate and merge the provider PR/MR when allowed")
  .option("--strategy <strategy>", "GitHub merge strategy: merge, squash, or rebase")
  .option("--squash", "Squash merge when the provider supports it")
  .option("--local-only", "Only record local merge approval; do not call the provider")
  .option("--dry-run", "Evaluate merge gate without mutating local or provider state")
  .action(
    async (
      taskId: string,
      opts: { strategy?: string; squash?: boolean; localOnly?: boolean; dryRun?: boolean },
    ) => {
      const config = await getConfig();
      const taskMgr = new TaskManager(cwd);
      const task = await taskMgr.load(taskId);
      const pkg = await loadChangePackage(taskId);
      const reviews = await new ReviewStore(cwd).list(pkg.id);
      const gate = new MergeGate().evaluate({ task, changePackage: pkg, reviews });

      for (const warning of gate.warnings) console.log(`! ${warning}`);
      if (!gate.allowed) {
        console.error(`Merge blocked for ${taskId}:`);
        for (const blocker of gate.blockers) console.error(`  - ${blocker}`);
        process.exitCode = 1;
        return;
      }

      if (opts.dryRun) {
        console.log(`✓ Merge gate passed: ${taskId}`);
        console.log("  Dry run only; no provider merge was executed.");
        return;
      }

      if (opts.localOnly) {
        await recordAudit(config, "merge.queued", { taskId, prUrl: pkg.prUrl }, taskId);
        console.log(`✓ Merge approved locally: ${taskId}`);
        return;
      }

      if (!pkg.prNumber) {
        console.error(
          `Change Package ${pkg.id} has no PR/MR number. Run 'agentgitops pr ${taskId}' first.`,
        );
        process.exitCode = 1;
        return;
      }

      const token = await getProviderToken(config.git.provider);
      if (!token) {
        console.error(getMissingTokenMessage(config.git.provider));
        process.exitCode = 1;
        return;
      }

      const repo = await getProviderRepository(config);
      const result =
        config.git.provider === "github"
          ? await new GitHubProvider({ token }).mergePullRequest({
              repo,
              number: pkg.prNumber,
              method: normalizeGitHubMergeMethod(opts.strategy, opts.squash, task.merge.squash),
              commitTitle: `[agent:${task.agentId}] ${task.title}`,
            })
          : await new GitLabProvider({ token, host: process.env.GITLAB_HOST }).mergePullRequest({
              repo,
              number: pkg.prNumber,
              squash: opts.squash ?? task.merge.squash ?? true,
            });

      if (!result.merged) {
        console.error(`Provider did not merge ${taskId}: ${result.message}`);
        process.exitCode = 1;
        return;
      }

      await taskMgr.updateStatus(taskId, "merged");
      await recordAudit(
        config,
        "merge.completed",
        {
          taskId,
          prUrl: pkg.prUrl,
          prNumber: pkg.prNumber,
          message: result.message,
          sha: result.sha,
        },
        taskId,
      );

      console.log(`✓ Merged: ${taskId}`);
      console.log(`  Provider: ${config.git.provider}`);
      if (result.sha) console.log(`  SHA: ${result.sha}`);
    },
  );

mergeCmd
  .command("block <task-id>")
  .description("Block a task from merging")
  .action(async (taskId: string) => {
    const config = await getConfig();
    const task = await new TaskManager(cwd).updateStatus(taskId, "blocked");
    await recordAudit(
      config,
      "conflict.detected",
      { taskId, reason: "manual merge block" },
      task.id,
    );
    console.log(`✓ Task blocked: ${task.id}`);
  });

// ===== board =====
program
  .command("board")
  .description("Show a terminal task board")
  .action(async () => {
    const tasks = await new TaskManager(cwd).list();
    if (tasks.length === 0) {
      console.log("No tasks found.");
      return;
    }
    const statuses: TaskStatus[] = [
      "created",
      "workspace_created",
      "running",
      "testing",
      "packaging",
      "reviewing",
      "blocked",
      "merged",
      "failed",
      "canceled",
    ];
    for (const status of statuses) {
      const group = tasks.filter((task) => task.status === status);
      if (group.length === 0) continue;
      console.log(`\n${status.toUpperCase()}`);
      for (const task of group) {
        console.log(`  ${task.id} [${task.riskLevel}] ${task.title}`);
      }
    }
  });

// ===== sync =====
const syncCmd = program
  .command("sync")
  .description("Summarize local and Team Sync state")
  .action(async () => {
    const config = await getConfig();
    const tasks = await new TaskManager(cwd).list();
    const packages = await Promise.all(tasks.map((task) => tryLoadChangePackage(task.id)));
    console.log(`Project: ${config.project.name}`);
    console.log(`Tasks: ${tasks.length}`);
    console.log(`Change Packages: ${packages.filter(Boolean).length}`);
    console.log("Control-plane sync is not configured; local state is current.");
  });

syncCmd
  .command("status")
  .description("Show local Team Sync state")
  .option("--json", "Print machine-readable JSON")
  .action(async (opts: { json?: boolean }) => {
    const store = new TeamSyncStore(cwd);
    try {
      const summary = store.getStatusSummary();
      if (opts.json) {
        console.log(JSON.stringify(publicTeamSyncSummary(summary), null, 2));
        return;
      }
      printTeamSyncStatus(summary);
    } finally {
      store.close();
    }
  });

syncCmd
  .command("push")
  .description("Push pending local Team Sync events to the configured relay")
  .option("--dry-run", "Print pending events without changing local state")
  .option("--relay <url>", "Override Team Sync Relay URL for this push")
  .option("--auto-commit", "git-native: auto git add -f + commit + push after export")
  .option(
    "--commit-message <msg>",
    "git-native: custom commit message",
    "chore(sync): export team sync events",
  )
  .option("--cleanup", "git-native: remove exported event files after push to prevent outbox bloat")
  .option("--json", "Print machine-readable JSON")
  .action(
    async (opts: {
      dryRun?: boolean;
      relay?: string;
      autoCommit?: boolean;
      commitMessage?: string;
      cleanup?: boolean;
      json?: boolean;
    }) => {
      const store = new TeamSyncStore(cwd);
      try {
        const summary = store.getStatusSummary();
        const events = store.listPendingEvents(summary.team?.teamId);
        console.log(`Pending Sync Events: ${events.length}`);
        for (const event of events.slice(0, 20)) {
          console.log(
            `  ${event.createdAt} ${event.action} ${event.resourceType}:${event.resourceId}`,
          );
        }
        if (opts.dryRun) {
          console.log("Dry run only; no events were pushed.");
          return;
        }
        if (!summary.team || !summary.localHub) {
          console.log(
            "Team Sync is not initialized. Run 'agentgitops team init' or 'agentgitops team join'.",
          );
          process.exitCode = 1;
          return;
        }
        // git-native 模式：导出到 outbox 目录，通过 git push 同步
        if (summary.team.syncMode === "git-native" || summary.team.syncMode === "hybrid") {
          const config = await ConfigLoader.load(cwd);
          const syncConfig = config.team?.sync ?? defaultTeamSyncConfig();
          const exporter = new GitNativeSyncExporter(cwd, syncConfig);
          const result = await exporter.exportPending();
          // DOG-P2-003: 同时导出 handoff 文件到 outbox
          const handoffResult = await exporter.exportHandoffs();
          const gitNativeConfig = resolveGitNativeConfig(syncConfig);
          if (gitNativeConfig.cleanupExported && result.exported > 0) {
            // 导出后不立即清理，等对方确认接收后手动或通过后续逻辑清理
          }
          // --auto-commit: 自动 git add -f + commit + push
          let autoCommitResult: { committed: boolean; pushed: boolean; error?: string } | undefined;
          if (opts.autoCommit && result.exported > 0) {
            autoCommitResult = await autoGitCommitAndPush(
              opts.commitMessage ?? "chore(sync): export team sync events",
            );
          }
          // --cleanup: push 成功后清理 outbox 事件文件，防止膨胀
          let cleanupResult: { removed: number } | undefined;
          if (opts.cleanup && (!autoCommitResult || autoCommitResult.pushed)) {
            cleanupResult = await exporter.cleanupExported();
          }
          if (opts.json) {
            console.log(
              JSON.stringify(
                {
                  mode: "git-native",
                  exported: result.exported,
                  handoffs: handoffResult.exported,
                  manifest: result.manifest,
                  autoCommit: autoCommitResult,
                  cleanup: cleanupResult,
                },
                null,
                2,
              ),
            );
            if (summary.team.syncMode !== "hybrid") return;
          } else {
            console.log(`✓ Exported ${result.exported} event(s) to .agentgitops/sync/outbox/`);
            if (handoffResult.exported > 0) {
              console.log(
                `  Exported ${handoffResult.exported} handoff file(s) to outbox/handoffs/`,
              );
            }
            if (opts.autoCommit && autoCommitResult) {
              if (autoCommitResult.pushed) {
                console.log(`✓ Auto-committed and pushed to remote.`);
              } else if (autoCommitResult.committed) {
                console.log(
                  `✓ Auto-committed but push failed: ${autoCommitResult.error ?? "unknown"}`,
                );
              } else {
                console.log(`✗ Auto-commit failed: ${autoCommitResult.error ?? "unknown"}`);
              }
            } else if (!opts.autoCommit) {
              console.log(
                `  Use --auto-commit for one-step sync, or manually: git add -f .agentgitops/sync/outbox/ && git commit && git push`,
              );
            }
            if (cleanupResult && cleanupResult.removed > 0) {
              console.log(
                `✓ Cleaned up ${cleanupResult.removed} exported event file(s) from outbox.`,
              );
            }
            if (summary.team.syncMode !== "hybrid") return;
          }
        }
        const relayUrl = opts.relay ?? summary.team.relayUrl;
        if (!relayUrl) {
          console.log("Relay URL is not configured; pending events were retained locally.");
          process.exitCode = 1;
          return;
        }
        const result = await createRelayClient({
          relayUrl,
          team: summary.team,
          hubId: summary.localHub.hubId,
        }).push(events);
        const syncedEventIds = result.events.map((event) => event.eventId);
        store.markEventsPushed(
          syncedEventIds,
          result.cursor
            ? makeSyncCursor(
                summary.team.teamId,
                summary.localHub.hubId,
                "push",
                result.cursor,
                syncedEventIds.at(-1),
              )
            : undefined,
        );
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log(
          `✓ Pushed ${result.accepted} event(s), ${result.duplicated} duplicate(s), ${result.applied} applied on relay.`,
        );
        console.log(`  Cursor: ${result.cursor ?? "-"}`);
      } finally {
        store.close();
      }
    },
  );

syncCmd
  .command("pull")
  .description("Pull Team Sync events from the configured relay")
  .option("--dry-run", "Print pull readiness without changing local state")
  .option("--relay <url>", "Override Team Sync Relay URL for this pull")
  .option("--git-pull", "git-native: auto git pull before importing outbox events")
  .option("--limit <count>", "Maximum events to pull", "100")
  .option("--json", "Print machine-readable JSON")
  .action(
    async (opts: {
      dryRun?: boolean;
      relay?: string;
      gitPull?: boolean;
      limit?: string;
      json?: boolean;
    }) => {
      const store = new TeamSyncStore(cwd);
      try {
        const summary = store.getStatusSummary();
        if (!summary.team) {
          console.log(
            "Team Sync is not initialized. Run 'agentgitops team init' or 'agentgitops team join'.",
          );
          process.exitCode = opts.dryRun ? 0 : 1;
          return;
        }
        console.log(`Team: ${summary.team.name} (${summary.team.teamId})`);
        const relayUrl = opts.relay ?? summary.team.relayUrl;
        console.log(`Relay: ${relayUrl ?? "not configured"}`);
        console.log(`Last pull cursor: ${summary.lastPullCursor?.cursor ?? "-"}`);
        if (opts.dryRun) {
          console.log("Dry run only; no relay data was pulled.");
          return;
        }
        if (!summary.localHub) {
          console.log(
            "Local hub registration is missing. Run 'agentgitops team init' or 'agentgitops team join'.",
          );
          process.exitCode = 1;
          return;
        }
        // git-native 模式：从 outbox 目录导入事件
        if (summary.team.syncMode === "git-native" || summary.team.syncMode === "hybrid") {
          // --git-pull: 先 git pull 拉取远端 outbox 事件
          let gitPullResult: { pulled: boolean; error?: string } | undefined;
          if (opts.gitPull) {
            gitPullResult = await autoGitPull();
            if (gitPullResult.pulled) {
              console.log(`✓ git pull succeeded; outbox events from remote are now local.`);
            } else {
              console.log(`✗ git pull failed: ${gitPullResult.error ?? "unknown"}`);
            }
          }
          const importer = new GitNativeSyncImporter(cwd);
          const result = await importer.importNew();
          if (opts.json) {
            console.log(
              JSON.stringify({ mode: "git-native", ...result, gitPull: gitPullResult }, null, 2),
            );
            // hybrid 模式继续走 relay
            if (summary.team.syncMode !== "hybrid") return;
          } else {
            console.log(
              `✓ Imported ${result.imported} event(s), skipped ${result.skipped} duplicate(s).`,
            );
            if (result.errors.length > 0) {
              console.log(`  Errors: ${result.errors.length}`);
              for (const err of result.errors.slice(0, 5)) {
                console.log(`    ${err}`);
              }
            }
            // hybrid 模式继续走 relay
            if (summary.team.syncMode !== "hybrid") return;
          }
        }
        if (!relayUrl) {
          console.log("Relay URL is not configured; local cache was not changed.");
          process.exitCode = 1;
          return;
        }
        const result = await createRelayClient({
          relayUrl,
          team: summary.team,
          hubId: summary.localHub.hubId,
        }).pull({
          cursor: summary.lastPullCursor?.cursor,
          limit: Number.parseInt(opts.limit ?? "100", 10) || 100,
        });
        const applier = new TeamSyncEventApplier(store);
        let applied = 0;
        for (const event of result.events) {
          const existing =
            store.getSyncEvent(event.eventId) ??
            store.getSyncEventByIdempotencyKey(event.idempotencyKey);
          if (!existing)
            store.enqueueSyncEvent({
              ...event,
              status: "pushed",
              appliedAt: event.appliedAt ?? new Date().toISOString(),
            });
          const appliedResult = applier.apply(event);
          if (appliedResult.applied) applied += 1;
        }
        if (result.cursor) {
          store.setSyncCursor(
            makeSyncCursor(
              summary.team.teamId,
              summary.localHub.hubId,
              "pull",
              result.cursor,
              result.events.at(-1)?.eventId,
            ),
          );
        }
        if (opts.json) {
          console.log(JSON.stringify({ ...result, applied }, null, 2));
          return;
        }
        console.log(`✓ Pulled ${result.events.length} event(s), ${applied} applied locally.`);
        console.log(`  Cursor: ${result.cursor ?? "-"}`);
      } finally {
        store.close();
      }
    },
  );

// TS-P1-006: sync watch — 通过长轮询监听本地团队同步状态变化
syncCmd
  .command("watch")
  .description("Watch Team Sync state changes (local polling)")
  .option("--interval <seconds>", "Polling interval in seconds", "5")
  .action(async (opts: { interval?: string }) => {
    const intervalMs = Math.max(1, Number.parseInt(opts.interval ?? "5", 10)) * 1000;
    const store = new TeamSyncStore(cwd);
    let lastPending = -1;
    let lastSyncAt: string | undefined;
    console.log(
      `Watching Team Sync state (interval: ${intervalMs / 1000}s). Press Ctrl+C to stop.`,
    );
    const poll = () => {
      try {
        const summary = store.getStatusSummary();
        const pending = summary.team ? store.listPendingEvents(summary.team.teamId).length : 0;
        const syncAt = summary.localHub?.lastSyncAt;
        if (pending !== lastPending || syncAt !== lastSyncAt) {
          lastPending = pending;
          lastSyncAt = syncAt;
          const time = new Date().toISOString();
          console.log(
            `[${time}] Pending: ${pending} | Last sync: ${syncAt ?? "-"} | Team: ${summary.team?.name ?? "-"}`,
          );
        }
      } catch {
        // 忽略读取错误
      }
    };
    poll();
    const timer = setInterval(poll, intervalMs);
    process.on("SIGINT", () => {
      clearInterval(timer);
      store.close();
      console.log("\nStopped watching.");
      process.exit(0);
    });
  });

// ===== team =====
const teamCmd = program.command("team").description("Team Sync local project management");

teamCmd
  .command("init")
  .description("Initialize a local Team Sync project")
  .option("--name <name>", "Team name")
  .option("--repo <url>", "Repository URL to associate with this team")
  .option("--relay <url>", "Team Sync Relay URL")
  .option("--relay-url <url>", "Team Sync Relay URL")
  .option("--secret <secret>", "Team secret used only to store a local hash")
  .option("--sync-mode <mode>", "Sync mode: local, git-native, relay, or hybrid", "local")
  .action(
    async (opts: {
      name?: string;
      repo?: string;
      relay?: string;
      relayUrl?: string;
      secret?: string;
      syncMode?: string;
    }) => {
      const config = await getConfig();
      const store = new TeamSyncStore(cwd);
      try {
        const now = new Date().toISOString();
        const teamId = createTeamSyncId("team");
        const hubId = createTeamSyncId("hub");
        const memberId = createTeamSyncId("member");
        const project: TeamProject = {
          teamId,
          name: opts.name ?? `${config.project.name} Team`,
          repoUrl: opts.repo ?? (await resolveSanitizedRepoUrl(config)),
          relayUrl: opts.relay ?? opts.relayUrl,
          syncMode: parseTeamSyncMode(opts.syncMode),
          teamSecretHash: hashTeamSecret(opts.secret ?? randomBytes(24).toString("base64url")),
          createdAt: now,
          updatedAt: now,
          settings: defaultTeamSyncSettings(),
        };
        const member: TeamMember = {
          memberId,
          teamId,
          displayName: process.env.USER ?? "local-user",
          hubId,
          role: "owner",
          joinedAt: now,
          lastSeenAt: now,
          status: "active",
        };
        const localHub: LocalHubRegistration = {
          hubId,
          teamId,
          memberId,
          machineFingerprint: createMachineFingerprint(),
          agentType: "local-cli",
          agentgitopsVersion: AGENTGITOPS_VERSION,
          registeredAt: now,
          lastSyncAt: now,
          status: "connected",
        };
        store.upsertTeamProject(project);
        store.upsertTeamMember(member);
        store.upsertLocalHubRegistration(localHub);
        store.enqueueSyncEvent(
          createTeamSyncEvent({
            teamId,
            hubId,
            actorId: memberId,
            action: "team.initialized",
            resourceType: "team",
            resourceId: teamId,
            idempotencyKey: `team.initialized:${teamId}:${hubId}`,
            payload: {
              name: project.name,
              repoUrl: project.repoUrl,
              syncMode: project.syncMode,
              relayConfigured: Boolean(project.relayUrl),
            },
          }),
        );
        console.log(`✓ Team initialized: ${project.name}`);
        console.log(`  Team: ${teamId}`);
        console.log(`  Hub: ${hubId}`);
        console.log(`  Sync mode: ${project.syncMode}`);
        console.log("  Team secret stored as hash only; no secret value was printed.");
      } finally {
        store.close();
      }
    },
  );

teamCmd
  .command("join")
  .description("Join an existing Team Sync project from this local hub")
  .requiredOption("--team-id <id>", "Team ID")
  .option("--name <name>", "Team display name")
  .option("--repo <url>", "Repository URL to associate with this team")
  .option("--relay <url>", "Team Sync Relay URL")
  .option("--relay-url <url>", "Team Sync Relay URL")
  .option("--secret <secret>", "Team secret used only to store a local hash")
  .option("--member <name>", "Local member display name")
  .option("--member-name <name>", "Local member display name")
  .option("--sync-mode <mode>", "Sync mode: local, git-native, relay, or hybrid", "local")
  .action(
    async (opts: {
      teamId: string;
      name?: string;
      repo?: string;
      relay?: string;
      relayUrl?: string;
      secret?: string;
      member?: string;
      memberName?: string;
      syncMode?: string;
    }) => {
      const config = await getConfig();
      const store = new TeamSyncStore(cwd);
      try {
        const existing = store.getTeamProject(opts.teamId);
        const now = new Date().toISOString();
        const hubId = createTeamSyncId("hub");
        const memberId = createTeamSyncId("member");
        const project: TeamProject = {
          teamId: opts.teamId,
          name: opts.name ?? existing?.name ?? `${config.project.name} Team`,
          repoUrl: opts.repo ?? existing?.repoUrl ?? (await resolveSanitizedRepoUrl(config)),
          relayUrl: opts.relay ?? opts.relayUrl ?? existing?.relayUrl,
          syncMode: parseTeamSyncMode(opts.syncMode ?? existing?.syncMode),
          teamSecretHash: opts.secret ? hashTeamSecret(opts.secret) : existing?.teamSecretHash,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          settings: existing?.settings ?? defaultTeamSyncSettings(),
        };
        const member: TeamMember = {
          memberId,
          teamId: project.teamId,
          displayName: opts.member ?? opts.memberName ?? process.env.USER ?? "local-user",
          hubId,
          role: "member",
          joinedAt: now,
          lastSeenAt: now,
          status: "active",
        };
        const localHub: LocalHubRegistration = {
          hubId,
          teamId: project.teamId,
          memberId,
          machineFingerprint: createMachineFingerprint(),
          agentType: "local-cli",
          agentgitopsVersion: AGENTGITOPS_VERSION,
          registeredAt: now,
          lastSyncAt: now,
          status: "connected",
        };
        store.upsertTeamProject(project);
        store.upsertTeamMember(member);
        store.upsertLocalHubRegistration(localHub);
        store.enqueueSyncEvent(
          createTeamSyncEvent({
            teamId: project.teamId,
            hubId,
            actorId: memberId,
            action: "team.joined",
            resourceType: "member",
            resourceId: memberId,
            idempotencyKey: `team.joined:${project.teamId}:${hubId}`,
            payload: {
              memberId,
              displayName: member.displayName,
              hubId,
            },
          }),
        );
        console.log(`✓ Team joined: ${project.name}`);
        console.log(`  Team: ${project.teamId}`);
        console.log(`  Hub: ${hubId}`);
        console.log("  Team secret stored as hash only; no secret value was printed.");
      } finally {
        store.close();
      }
    },
  );

teamCmd
  .command("status")
  .description("Show local Team Sync state")
  .option("--json", "Print machine-readable JSON")
  .action((opts: { json?: boolean }) => {
    const store = new TeamSyncStore(cwd);
    try {
      const summary = store.getStatusSummary();
      if (opts.json) {
        console.log(JSON.stringify(publicTeamSyncSummary(summary), null, 2));
        return;
      }
      printTeamSyncStatus(summary);
    } finally {
      store.close();
    }
  });

teamCmd
  .command("sync-config")
  .description("View or update Team Sync content-scope configuration")
  .option("--show", "Show current Team Sync configuration")
  .option("--mode <mode>", "Sync mode: manual or auto")
  .option("--interval <seconds>", "Auto sync interval in seconds")
  .option("--enable <keys...>", "Enable sync keys")
  .option("--disable <keys...>", "Disable sync keys")
  .option("--json", "Print machine-readable JSON")
  .action(
    async (opts: {
      show?: boolean;
      mode?: string;
      interval?: string;
      enable?: string[];
      disable?: string[];
      json?: boolean;
    }) => {
      const config = await getConfig();
      const current = resolveTeamSyncConfig(config.team?.sync);
      const next: TeamSyncConfig = { ...current };
      let changed = false;

      if (opts.mode !== undefined) {
        next.mode = parseTeamSyncConfigMode(opts.mode);
        changed = true;
      }
      if (opts.interval !== undefined) {
        next.intervalSeconds = parsePositiveSeconds(opts.interval);
        changed = true;
      }
      for (const key of opts.enable ?? []) {
        next[parseTeamSyncConfigBooleanKey(key)] = true;
        changed = true;
      }
      for (const key of opts.disable ?? []) {
        next[parseTeamSyncConfigBooleanKey(key)] = false;
        changed = true;
      }

      if (changed) {
        config.team = { ...(config.team ?? {}), sync: next };
        await ConfigLoader.save(cwd, config);
      }

      if (opts.json) {
        console.log(JSON.stringify({ config: next, changed }, null, 2));
        return;
      }
      printTeamSyncConfig(next);
      if (!changed && !opts.show) {
        console.log(
          "No changes requested. Use --enable/--disable, --mode, or --interval to update.",
        );
      }
    },
  );

teamCmd
  .command("conflicts")
  .description("Build and show Team Sync conflict graph")
  .option("--json", "Print machine-readable JSON")
  .action((opts: { json?: boolean }) => {
    const builder = new ConflictGraphBuilder(cwd);
    try {
      const result = builder.build();
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (result.edges.length === 0) {
        console.log("No Team Sync conflicts detected.");
        return;
      }
      console.log("SEVERITY".padEnd(10), "TYPE".padEnd(16), "TASKS".padEnd(54), "FILES / SIGNALS");
      for (const edge of result.edges) {
        console.log(
          edge.severity.padEnd(10),
          edge.type.padEnd(16),
          `${edge.sourceTaskId} <-> ${edge.targetTaskId}`.padEnd(54),
          edge.files.join(", "),
        );
        console.log(`  Suggestion: ${edge.suggestion}`);
      }
    } finally {
      builder.close();
    }
  });

// ===== server =====
const serverCmd = program.command("server").description("Server management");
serverCmd
  .command("start")
  .description("Start the local AgentGitOps server")
  .option("--host <host>", "Host to bind", "localhost")
  .option("--port <port>", "Port to bind")
  .option("--mode <mode>", "Server mode: full (default) or relay (Team Sync Relay only)", "full")
  .action(async (opts: { host?: string; port?: string; mode?: string }) => {
    await startWebServer(opts);
  });

serverCmd
  .command("stop")
  .description("Explain how to stop the foreground server")
  .action(() => {
    console.log("agentgitops server runs in the foreground in this MVP.");
    console.log("Stop it with Ctrl+C in the terminal where it was started.");
  });

// ===== audit =====
const auditCmd = program.command("audit").description("Audit event inspection");

auditCmd
  .command("list")
  .description("List local audit events")
  .option("--task <task-id>", "Filter by task id")
  .option("--event <type>", "Filter by event type")
  .option("--actor <actor-id>", "Filter by actor id")
  .option("--actor-type <type>", "Filter by actor type (human/agent/system)")
  .option("--from <iso>", "Filter events created at or after this ISO timestamp")
  .option("--to <iso>", "Filter events created at or before this ISO timestamp")
  .option("--limit <count>", "Maximum events to return", "100")
  .action(
    async (opts: {
      task?: string;
      event?: string;
      actor?: string;
      actorType?: string;
      from?: string;
      to?: string;
      limit?: string;
    }) => {
      const db = new LocalDb(cwd);
      try {
        const actorType =
          opts.actorType === "human" || opts.actorType === "agent" || opts.actorType === "system"
            ? opts.actorType
            : undefined;
        const events = db.listAuditEvents({
          taskId: opts.task,
          eventType: opts.event,
          actorId: opts.actor,
          actorType,
          createdFrom: opts.from,
          createdTo: opts.to,
          limit: Number.parseInt(opts.limit ?? "100", 10) || 100,
        });
        if (events.length === 0) {
          console.log("No audit events found.");
          return;
        }
        console.log("TIME".padEnd(24), "EVENT".padEnd(28), "TASK".padEnd(26), "ACTOR");
        for (const event of events) {
          console.log(
            event.created_at.padEnd(24),
            event.event_type.padEnd(28),
            (event.task_id ?? "-").padEnd(26),
            `${event.actor_type}:${event.actor_id}`,
          );
        }
      } finally {
        db.close();
      }
    },
  );

auditCmd
  .command("replay <task-id>")
  .description("Replay the audit chain for a task")
  .action(async (taskId: string) => {
    const db = new LocalDb(cwd);
    try {
      const events = db.listAuditEvents(taskId);
      if (events.length === 0) {
        console.log(`No audit events found for ${taskId}.`);
        return;
      }
      for (const event of events) {
        console.log(
          `${event.created_at} ${event.event_type} by ${event.actor_type}:${event.actor_id}`,
        );
        if (event.payload) console.log(`  ${event.payload}`);
      }
    } finally {
      db.close();
    }
  });

// ===== note =====
const noteCmd = program.command("note").description("Agent handoff notes");

noteCmd
  .command("add <task-id>")
  .description("Record an agent handoff note for future agents and reviewers")
  .requiredOption("--summary <text>", "What changed and why")
  .option("--agent <id>", "Agent id", process.env.USER ?? "local-agent")
  .option("--file <paths...>", "Files changed or worth reviewing")
  .option("--verify <items...>", "Validation commands or results")
  .option("--review-focus <items...>", "Review focus areas")
  .option("--risk <items...>", "Known risks or follow-ups")
  .option("--commit <sha>", "Related commit SHA")
  .option("--pr <url>", "Related PR/MR URL")
  .action(
    async (
      taskId: string,
      opts: {
        summary: string;
        agent: string;
        file?: string[];
        verify?: string[];
        reviewFocus?: string[];
        risk?: string[];
        commit?: string;
        pr?: string;
      },
    ) => {
      const config = await getConfig();
      const db = new LocalDb(cwd);
      try {
        const note = db.insertAgentNote({
          id: `note_${randomUUID()}`,
          taskId,
          agentId: opts.agent,
          summary: opts.summary,
          files: normalizeList(opts.file),
          verification: normalizeList(opts.verify),
          reviewFocus: normalizeList(opts.reviewFocus),
          risks: normalizeList(opts.risk),
          commitSha: opts.commit,
          prUrl: opts.pr,
        });
        db.insertAuditEvent({
          id: `audit_${randomUUID()}`,
          projectId: config.project.name,
          taskId,
          actorType: "agent",
          actorId: note.agentId,
          eventType: "agent.note.added",
          payload: {
            noteId: note.id,
            summary: note.summary,
            files: note.files,
            verification: note.verification,
            reviewFocus: note.reviewFocus,
            risks: note.risks,
            commitSha: note.commitSha,
            prUrl: note.prUrl,
          },
        });
        recordTeamSync((producer) => producer.recordAgentNoteCreated(note));
        console.log(`✓ Agent note recorded: ${note.id}`);
        console.log(`  Task: ${note.taskId}`);
        console.log(`  Agent: ${note.agentId}`);
      } finally {
        db.close();
      }
    },
  );

noteCmd
  .command("list [task-id]")
  .description("List agent handoff notes")
  .action((taskId?: string) => {
    const db = new LocalDb(cwd);
    try {
      const notes = db.listAgentNotes(taskId);
      if (notes.length === 0) {
        console.log("No agent notes found.");
        return;
      }
      for (const note of notes) {
        console.log(`${note.createdAt} ${note.id} ${note.taskId} by ${note.agentId}`);
        console.log(`  ${note.summary}`);
        if (note.files.length > 0) console.log(`  Files: ${note.files.join(", ")}`);
        if (note.verification.length > 0)
          console.log(`  Verification: ${note.verification.join(" | ")}`);
        if (note.reviewFocus.length > 0)
          console.log(`  Review focus: ${note.reviewFocus.join(" | ")}`);
        if (note.risks.length > 0) console.log(`  Risks: ${note.risks.join(" | ")}`);
      }
    } finally {
      db.close();
    }
  });

// ===== package =====
program
  .command("test <task-id>")
  .description("Run required verification checks for a task workspace")
  .action(async (taskId: string) => {
    await runCliWorkflowJob("task.test", taskId, {}, async () => {
      const config = await getConfig();
      const taskMgr = new TaskManager(cwd);
      const task = await taskMgr.load(taskId);
      const worktreeRoot = path.resolve(cwd, config.project.worktree_root);
      let workspacePath = path.join(worktreeRoot, `${config.project.name}-${task.id}`);
      if (!(await pathExists(workspacePath)) && (await currentBranchIs(task.targetBranch))) {
        console.log(
          `Task worktree not found; running verification in current checkout ${task.targetBranch}.`,
        );
        workspacePath = cwd;
      }
      const checks = await collectRequiredChecks(config, task, cwd);

      if (checks.length === 0) {
        const skipped = {
          id: `verify_${task.id}_no-required-checks`,
          taskId: task.id,
          name: "no required checks",
          command: "",
          status: "skipped" as const,
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
        };
        await new VerificationStore(cwd).save(task.id, [skipped]);
        const updated = await taskMgr.updateStatus(task.id, "packaging");
        recordTeamSync((producer) => producer.recordTaskUpdated(updated));
        console.log("No required checks configured.");
        return { message: "No required checks configured.", task: updated };
      }

      await taskMgr.updateStatus(task.id, "testing");
      const runs = await new VerificationGate(cwd, config.policies).run(
        task,
        workspacePath,
        checks,
      );
      await new VerificationStore(cwd).save(task.id, runs);
      const failed = runs.filter((run) => run.status === "failed");
      const updated = await taskMgr.updateStatus(
        task.id,
        failed.length === 0 ? "packaging" : "failed",
      );
      recordTeamSync((producer) => producer.recordTaskUpdated(updated));

      for (const run of runs) {
        const icon = run.status === "passed" ? "✓" : "✗";
        console.log(
          `${icon} ${run.name}: ${run.status}${run.durationMs ? ` (${run.durationMs}ms)` : ""}`,
        );
        if (run.outputPath) console.log(`  Log: ${run.outputPath}`);
      }
      process.exitCode = failed.length === 0 ? 0 : 1;
      return {
        message: failed.length === 0 ? "All checks passed." : `${failed.length} check(s) failed.`,
        task: updated,
      };
    });
  });

// ===== package =====
program
  .command("package <task-id>")
  .description("Generate Change Package")
  .option(
    "--from-git-diff",
    "Generate from git diff baseBranch..targetBranch (cross-machine, no worktree needed)",
  )
  .action(async (taskId: string, opts: { fromGitDiff?: boolean }) => {
    await runCliWorkflowJob("task.package", taskId, {}, async () => {
      const config = await getConfig();
      const taskMgr = new TaskManager(cwd);
      const task = await taskMgr.load(taskId);

      let diffService: DiffService;
      if (opts.fromGitDiff) {
        // 跨机器模式：优先用 git diff baseBranch..targetBranch；若 task branch 尚未创建，
        // 回退到当前工作区相对 baseBranch 的 diff，支撑 main 工作区内的 dogfood 收尾。
        if (await gitRefExists(task.targetBranch)) {
          diffService = DiffService.forGitDiff(cwd, task.baseBranch, task.targetBranch);
        } else {
          console.log(
            `Task branch ${task.targetBranch} not found; packaging current worktree diff against ${task.baseBranch}.`,
          );
          diffService = new DiffService(cwd);
        }
      } else {
        const workspacePath = await resolveDiffWorkspacePath(config, task);
        diffService = new DiffService(workspacePath);
      }

      const generator = new ChangePackageGenerator(diffService, cwd);
      const checks = await new VerificationStore(cwd).load(task.id);
      const pkg = await generator.generate(task, checks);

      await taskMgr.updateStatus(task.id, "packaging");
      const updated = await taskMgr.updateStatus(task.id, "reviewing");
      recordTeamSync((producer) => {
        producer.recordTaskUpdated(updated);
        producer.recordChangePackageCreated(updated, pkg);
      });

      console.log(`✓ Change Package generated: ${pkg.id}`);
      console.log(`  Files changed: ${pkg.changedFiles.length}`);
      console.log(`  Insertions: ${pkg.stats.insertions}`);
      console.log(`  Deletions: ${pkg.stats.deletions}`);
      console.log(`  Risk: ${pkg.risk.level}`);
      console.log(`  Summary: ${pkg.summary}`);
      return { message: `Change Package generated: ${pkg.id}`, task: updated, changePackage: pkg };
    });
  });

// ===== review =====
const reviewCmd = program.command("review").description("Review change packages");
reviewCmd
  .command("approve <task-id>")
  .description("Approve a change package")
  .option("--reviewer <id>", "Reviewer id", process.env.USER ?? "local-reviewer")
  .option("--comment <text>", "Review comment")
  .action(async (taskId: string, opts: { reviewer: string; comment?: string }) => {
    await submitReview(taskId, "approve", opts.reviewer, opts.comment);
  });

reviewCmd
  .command("reject <task-id>")
  .description("Reject a change package")
  .option("--reviewer <id>", "Reviewer id", process.env.USER ?? "local-reviewer")
  .option("--comment <text>", "Review comment")
  .action(async (taskId: string, opts: { reviewer: string; comment?: string }) => {
    await submitReview(taskId, "reject", opts.reviewer, opts.comment);
  });

reviewCmd
  .command("request-changes <task-id>")
  .description("Request changes for a change package")
  .option("--reviewer <id>", "Reviewer id", process.env.USER ?? "local-reviewer")
  .option("--comment <text>", "Review comment")
  .action(async (taskId: string, opts: { reviewer: string; comment?: string }) => {
    await submitReview(taskId, "request_changes", opts.reviewer, opts.comment);
  });

reviewCmd
  .command("ask-fix <task-id>")
  .description("Ask the agent to fix a change package")
  .option("--reviewer <id>", "Reviewer id", process.env.USER ?? "local-reviewer")
  .option("--comment <text>", "Review comment")
  .action(async (taskId: string, opts: { reviewer: string; comment?: string }) => {
    await submitReview(taskId, "ask_agent_to_fix", opts.reviewer, opts.comment);
  });

reviewCmd
  .command("context <task-id>")
  .description("Build review-agent context from Change Package, reviews, Agent Notes, and audit")
  .option("--json", "Print machine-readable JSON")
  .option("--record", "Record a review.context.generated audit event")
  .option("--output <path>", "Write the context to a file")
  .action(async (taskId: string, opts: { json?: boolean; record?: boolean; output?: string }) => {
    const config = await getConfig();
    const context = await buildReviewContext(cwd, taskId);
    const output = opts.json ? JSON.stringify(context, null, 2) : formatReviewContext(context);
    if (opts.output) {
      await fs.writeFile(path.resolve(cwd, opts.output), output, "utf-8");
      console.log(`✓ Review context written: ${opts.output}`);
    } else {
      console.log(output);
    }
    if (opts.record) {
      await recordAudit(
        config,
        "review.context.generated",
        {
          taskId,
          packageId: context.changePackage?.id,
          checklist: context.checklist.map((item) => item.severity),
          source: "cli",
        },
        taskId,
      );
    }
    recordTeamSync((producer) => producer.recordReviewContextUpdated(context));
  });

// ===== context =====
const contextCmd = program.command("context").description("Agent context generation");
contextCmd
  .command("feed")
  .description("Build a Team Sync context feed for an agent")
  .requiredOption("--task <task-id>", "Task ID")
  .option("--agent <type>", "Agent profile (codex/claude/generic)", "generic")
  .option("--format <format>", "Output format: json, markdown, or prompt", "markdown")
  .option("--compression <level>", "Compression: minimal, standard, or detailed")
  .option("--token-budget <count>", "Approximate token budget")
  .option("--output <path>", "Write feed to a file")
  .action(
    async (opts: {
      task: string;
      agent: string;
      format?: string;
      compression?: string;
      tokenBudget?: string;
      output?: string;
    }) => {
      const builder = new ContextFeedBuilder(cwd);
      try {
        const feed = await builder.build({
          taskId: opts.task,
          agentType: normalizeAgentProfile(opts.agent),
          compression: parseContextFeedCompression(opts.compression),
          tokenBudget: opts.tokenBudget ? Number.parseInt(opts.tokenBudget, 10) : undefined,
        });
        const output = formatAgentContextFeed(feed, parseContextFeedFormat(opts.format));
        if (opts.output) {
          await fs.writeFile(path.resolve(cwd, opts.output), output, "utf-8");
          console.log(`✓ Context feed written: ${opts.output}`);
          console.log(`  Feed: ${feed.feedId}`);
          console.log(`  Items: ${feed.items.length}`);
          return;
        }
        console.log(output);
      } finally {
        builder.close();
      }
    },
  );

// ===== handoff =====
const handoffCmd = program.command("handoff").description("Team Sync handoff packages");
handoffCmd
  .command("preview <task-id>")
  .description("Preview a Team Sync handoff package")
  .option("--type <type>", "Handoff type: adopt or continue", "continue")
  .option("--target-task <task-id>", "Target task id for continue handoffs")
  .option("--target-branch <branch>", "Target branch for continue handoffs")
  .action(
    async (taskId: string, opts: { type?: string; targetTask?: string; targetBranch?: string }) => {
      const builder = new HandoffPackageBuilder(cwd);
      const summaryStore = new TeamSyncStore(cwd);
      try {
        const summary = summaryStore.getStatusSummary();
        const built = await builder.build({
          type: parseHandoffType(opts.type),
          sourceTaskId: taskId,
          targetTaskId: opts.targetTask,
          targetBranch: opts.targetBranch,
          createdBy: summary.localHub?.memberId ?? process.env.USER ?? "local-user",
        });
        console.log(built.markdown);
      } finally {
        summaryStore.close();
        builder.close();
      }
    },
  );

handoffCmd
  .command("generate <task-id>")
  .description("Generate a Team Sync handoff package under .agentgitops/handoffs")
  .option("--type <type>", "Handoff type: adopt or continue", "continue")
  .option("--target-task <task-id>", "Target task id for continue handoffs")
  .option("--target-branch <branch>", "Target branch for continue handoffs")
  .action(
    async (taskId: string, opts: { type?: string; targetTask?: string; targetBranch?: string }) => {
      const summaryStore = new TeamSyncStore(cwd);
      const summary = summaryStore.getStatusSummary();
      summaryStore.close();
      // 问题 3 修复：Team Sync 未初始化时输出友好提示而非抛出未捕获异常
      if (!summary.team) {
        console.log(
          "Team Sync is not initialized. Run 'agentgitops team init --sync-mode git-native' first.",
        );
        console.log("  Handoff packages require Team Sync to register tasks as synced.");
        process.exitCode = 1;
        return;
      }
      const builder = new HandoffPackageBuilder(cwd);
      try {
        const written = await builder.write(
          await builder.build({
            type: parseHandoffType(opts.type),
            sourceTaskId: taskId,
            targetTaskId: opts.targetTask,
            targetBranch: opts.targetBranch,
            createdBy: summary.localHub?.memberId ?? process.env.USER ?? "local-user",
          }),
        );
        console.log(`✓ Handoff generated: ${written.handoff.handoffId}`);
        console.log(`  JSON: ${path.relative(cwd, written.jsonPath)}`);
        console.log(`  Markdown: ${path.relative(cwd, written.markdownPath)}`);
      } catch (err) {
        console.error(
          `✗ Handoff generation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        console.error(
          "  If the task was created before Team Sync init, recreate it after team init.",
        );
        process.exitCode = 1;
      } finally {
        builder.close();
      }
    },
  );

// HD-005: handoff doc 命令 — 查看和列出交接文档
const handoffDocCmd = handoffCmd.command("doc").description("Agent handoff documents");

handoffDocCmd
  .command("list")
  .description("List all handoff documents")
  .action(async () => {
    const store = new HandoffDocumentStore(cwd);
    const docs = await store.list();
    if (docs.length === 0) {
      console.log("No handoff documents found.");
      return;
    }
    console.log("DOC ID".padEnd(30), "TASK".padEnd(26), "AGENT".padEnd(15), "CREATED");
    for (const doc of docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      console.log(
        doc.docId.padEnd(30),
        doc.taskId.padEnd(26),
        doc.agentId.padEnd(15),
        doc.createdAt,
      );
    }
    console.log(`\n${docs.length} document(s).`);
  });

handoffDocCmd
  .command("<task-id>")
  .description("Show the latest handoff document for a task")
  .action(async (taskId: string) => {
    const store = new HandoffDocumentStore(cwd);
    const doc = await store.getLatestByTask(taskId);
    if (!doc) {
      console.log(`No handoff document found for task: ${taskId}`);
      process.exitCode = 1;
      return;
    }
    console.log(doc.markdown);
  });

// ===== status (alias for task status) =====
program
  .command("status")
  .description("Show overall status")
  .action(async () => {
    const config = await getConfig();
    const taskMgr = new TaskManager(cwd);
    const tasks = await taskMgr.list();
    console.log(`Project: ${config.project.name}`);
    console.log(`Tasks: ${tasks.length}`);
    if (tasks.length > 0) {
      console.log("");
      console.log("TASK ID".padEnd(26), "AGENT".padEnd(16), "STATUS".padEnd(14), "RISK".padEnd(10));
      for (const t of tasks) {
        console.log(
          t.id.padEnd(26),
          t.agentId.padEnd(16),
          t.status.padEnd(14),
          t.riskLevel.padEnd(10),
        );
      }
    }
  });

// ===== web =====
program
  .command("web")
  .description("Start the local governance console")
  .option("--host <host>", "Host to bind", "localhost")
  .option("--port <port>", "Port to bind")
  .option("--project <id>", "Project ID to start (from registry)")
  .action(async (opts: { host?: string; port?: string; project?: string }) => {
    // MP-003/005: 多项目工作区管理
    if (opts.project) {
      // 指定项目 ID
      const registry = new ProjectRegistry();
      const project = await registry.get(opts.project);
      if (!project) {
        console.error(`Project not found: ${opts.project}`);
        console.error("Run 'agentgitops project list' to see available projects.");
        process.exitCode = 1;
        return;
      }
      await registry.setActive(project.id);
      await startWebServer({
        host: opts.host,
        port: resolveWebPortOption(opts.port, project.serverPort),
        projectPath: project.path,
      });
      return;
    }

    // 尝试从注册表读取上次活跃项目
    const registry = new ProjectRegistry();
    const lastActive = await registry.getLastActive();
    if (lastActive) {
      console.log(`Resuming last active project: ${lastActive.name} (${lastActive.id})`);
      await startWebServer({
        host: opts.host,
        port: resolveWebPortOption(opts.port, lastActive.serverPort),
        projectPath: lastActive.path,
      });
      return;
    }

    // 无注册项目时，检查当前目录是否已初始化
    const projects = await registry.list();
    if (projects.length === 0) {
      console.log("No projects registered.");
      console.log("To add a project, run: agentgitops project add <path-to-git-repo>");
      console.log("Or initialize current directory: agentgitops init");
    }
    await startWebServer(opts);
  });

// ===== pr =====
const prCmd = program.command("pr").description("Pull request and merge request automation");

prCmd
  .command("preflight <task-id>")
  .description("Check PR/MR readiness without committing, pushing, or calling provider APIs")
  .option("--real", "Require provider token checks for a real PR/MR run")
  .option("--no-commit", "Skip commit-related checks")
  .option("--body-template <template>", "PR/MR body template: ce or team-sync", "ce")
  .action(
    async (taskId: string, opts: { real?: boolean; commit?: boolean; bodyTemplate?: string }) => {
      try {
        const context = await preparePullRequestContext(taskId, {
          requireToken: opts.real === true,
          bodyTemplate: parsePullRequestBodyTemplate(opts.bodyTemplate),
        });
        const diagnostics = await buildPullRequestPreflight(context, {
          commit: opts.commit !== false,
          requireToken: opts.real === true,
        });
        printDiagnostics(diagnostics);
        process.exitCode = hasBlockingDiagnostics(diagnostics) ? 1 : 0;
      } catch (error) {
        printRecoverableError("PR/MR preflight failed", error, [
          "Run agentgitops doctor.",
          `Run agentgitops package ${taskId} if the Change Package is missing.`,
        ]);
        process.exitCode = 1;
      }
    },
  );

prCmd
  .argument("<task-id>")
  .description("Push a task branch and create or update a pull request")
  .option("--draft", "Create as draft PR", true)
  .option("--no-draft", "Create as ready for review")
  .option("--no-commit", "Do not create a commit before pushing")
  .option(
    "--dry-run",
    "Validate and print the PR/MR body without committing, pushing, or calling provider APIs",
  )
  .option(
    "--review-context-comment",
    "Create or update a PR/MR comment with the Review Context summary",
  )
  .option("--handoff-comment", "Create or update a PR/MR comment with the Handoff Note (TS-P1-004)")
  .option("--body-template <template>", "PR/MR body template: ce or team-sync", "ce")
  .action(
    async (
      taskId: string,
      opts: {
        draft?: boolean;
        commit?: boolean;
        dryRun?: boolean;
        reviewContextComment?: boolean;
        handoffComment?: boolean;
        bodyTemplate?: string;
      },
    ) => {
      let context: PullRequestContext;
      try {
        context = await preparePullRequestContext(taskId, {
          requireToken: opts.dryRun !== true,
          bodyTemplate: parsePullRequestBodyTemplate(opts.bodyTemplate),
        });
      } catch (error) {
        printRecoverableError("PR/MR preparation failed", error, [
          "Run agentgitops doctor.",
          `Run agentgitops package ${taskId} if the Change Package is missing.`,
        ]);
        process.exitCode = 1;
        return;
      }
      const diagnostics = await buildPullRequestPreflight(context, {
        commit: opts.commit !== false,
        requireToken: opts.dryRun !== true,
      });
      const blocking = hasBlockingDiagnostics(diagnostics);

      if (opts.dryRun) {
        printDiagnostics(diagnostics);
        console.log(`Provider: ${context.config.git.provider}`);
        console.log(`Repository: ${context.repo}`);
        console.log(`Title: [agent:${context.task.agentId}] ${context.task.title}`);
        console.log(`Base: ${context.task.baseBranch}`);
        console.log(`Head: ${context.task.targetBranch}`);
        console.log(`Body template: ${context.bodyTemplate}`);
        console.log("\n--- PR/MR Body ---");
        console.log(context.body);
        process.exitCode = blocking ? 1 : 0;
        return;
      }

      if (blocking) {
        printDiagnostics(diagnostics);
        process.exitCode = 1;
        return;
      }

      try {
        await runCliWorkflowJob(
          "task.pr",
          taskId,
          {
            draft: opts.draft ?? true,
            commit: opts.commit !== false,
            reviewContextComment: opts.reviewContextComment === true,
            bodyTemplate: context.bodyTemplate,
          },
          async () => {
            const { config, task, pkg, workspaceGit, token } = context;
            if (opts.commit !== false) {
              const status = await workspaceGit.status();
              if (status.trim()) {
                await workspaceGit.commit(`chore(agent): ${task.title} [${task.id}]`);
              }
            }

            // TS-P1-008: push 前检查分支所有权软锁
            const ownershipMgr = new BranchOwnershipManager(cwd);
            try {
              const store = new TeamSyncStore(cwd);
              let teamId: string | undefined;
              try {
                const summary = store.getStatusSummary();
                teamId = summary.team?.teamId;
              } finally {
                store.close();
              }
              if (teamId) {
                const operator = process.env.USER ?? "local-user";
                const ownership = ownershipMgr.checkOwnership({
                  teamId,
                  taskId: task.id,
                  operator,
                });
                if (ownership.warning) {
                  console.warn(`⚠ ${ownership.warning}`);
                }
              }
            } finally {
              ownershipMgr.close();
            }

            await workspaceGit.push(config.git.remote, task.targetBranch);

            const provider =
              config.git.provider === "github"
                ? new GitHubProvider({ token: token ?? "" })
                : new GitLabProvider({ token: token ?? "", host: process.env.GITLAB_HOST });
            const pr = await provider.createOrUpdatePullRequest({
              repo: context.repo,
              title: `[agent:${task.agentId}] ${task.title}`,
              body: context.body,
              headBranch: task.targetBranch,
              baseBranch: task.baseBranch,
              draft: opts.draft ?? true,
            });

            let commentResult:
              Awaited<ReturnType<typeof provider.upsertPullRequestComment>> | undefined;
            if (opts.reviewContextComment) {
              commentResult = await provider.upsertPullRequestComment({
                repo: context.repo,
                number: pr.number,
                body: formatReviewContextComment(context.reviewContext),
              });
            }

            // TS-P1-004: 同步 Handoff Note 到 PR comment
            let handoffCommentResult:
              Awaited<ReturnType<typeof provider.upsertPullRequestComment>> | undefined;
            if (opts.handoffComment) {
              try {
                const handoffBuilder = new HandoffPackageBuilder(cwd);
                try {
                  const built = await handoffBuilder.build({
                    type: "continue",
                    sourceTaskId: task.id,
                    createdBy: task.agentId,
                  });
                  handoffCommentResult = await provider.upsertPullRequestComment({
                    repo: context.repo,
                    number: pr.number,
                    body: formatHandoffComment(built.handoff),
                    marker: getHandoffCommentMarker(),
                  });
                } finally {
                  handoffBuilder.close();
                }
              } catch {
                // Team Sync 未初始化时跳过 handoff comment
              }
            }

            // TS-P1-004: 同步 Agent Notes 到 PR comment
            let notesCommentResult:
              Awaited<ReturnType<typeof provider.upsertPullRequestComment>> | undefined;
            if (opts.handoffComment) {
              try {
                const noteDb = new LocalDb(cwd);
                try {
                  const notes = noteDb.listAgentNotes(task.id);
                  if (notes.length > 0) {
                    notesCommentResult = await provider.upsertPullRequestComment({
                      repo: context.repo,
                      number: pr.number,
                      body: formatAgentNotesComment(notes),
                      marker: getAgentNotesCommentMarker(),
                    });
                  }
                } finally {
                  noteDb.close();
                }
              } catch {
                // 忽略 Agent Notes 同步错误
              }
            }

            pkg.prUrl = pr.url;
            pkg.prNumber = pr.number;
            await saveChangePackage(taskId, pkg);
            const updated = await new TaskManager(cwd).updateStatus(task.id, "reviewing");

            console.log(`✓ Pull request ready: ${pr.url}`);
            console.log(`  Number: #${pr.number}`);
            console.log(`  Draft: ${pr.draft ? "yes" : "no"}`);
            if (commentResult) {
              console.log(
                `  Review Context comment: ${commentResult.action}${commentResult.url ? ` (${commentResult.url})` : ""}`,
              );
            }
            if (handoffCommentResult) {
              console.log(
                `  Handoff Note comment: ${handoffCommentResult.action}${handoffCommentResult.url ? ` (${handoffCommentResult.url})` : ""}`,
              );
            }
            if (notesCommentResult) {
              console.log(
                `  Agent Notes comment: ${notesCommentResult.action}${notesCommentResult.url ? ` (${notesCommentResult.url})` : ""}`,
              );
            }
            return {
              message: `Pull request ready: ${pr.url}`,
              task: updated,
              changePackage: pkg,
              provider: config.git.provider,
              prUrl: pr.url,
              prNumber: pr.number,
            };
          },
        );
      } catch (error) {
        printRecoverableError(
          "PR/MR creation failed",
          error,
          recoveryForPullRequestError(error, context.config.git.provider, context.workspacePath),
        );
        process.exitCode = 1;
      }
    },
  );

program.parse();

async function loadChangePackage(taskId: string): Promise<ChangePackage> {
  const pkgPath = path.join(cwd, ".agentgitops", "packages", `${taskId}.json`);
  try {
    const content = await fs.readFile(pkgPath, "utf-8");
    return JSON.parse(content) as ChangePackage;
  } catch {
    throw new Error(
      `Change Package not found for ${taskId}. Run 'agentgitops package ${taskId}' first.`,
    );
  }
}

async function saveChangePackage(taskId: string, pkg: ChangePackage): Promise<void> {
  const pkgPath = path.join(cwd, ".agentgitops", "packages", `${taskId}.json`);
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2), "utf-8");
}

function parsePullRequestBodyTemplate(value?: string): PullRequestBodyTemplate {
  const template = value?.trim() || "ce";
  if (template === "ce" || template === "team-sync") return template;
  throw new Error(`Unsupported PR/MR body template: ${template}. Use ce or team-sync.`);
}

function parseTeamSyncMode(value?: string): TeamSyncMode {
  const mode = value?.trim() || "local";
  if (mode === "local" || mode === "git-native" || mode === "relay" || mode === "hybrid")
    return mode;
  throw new Error(`Unsupported Team Sync mode: ${mode}. Use local, git-native, relay, or hybrid.`);
}

function parseHandoffType(value?: string): HandoffPackageType {
  const type = value?.trim() || "continue";
  if (type === "adopt" || type === "continue") return type;
  throw new Error(`Unsupported handoff type: ${type}. Use adopt or continue.`);
}

function parseContextFeedCompression(
  value?: string,
): TeamProject["settings"]["contextFeedCompression"] | undefined {
  if (!value) return undefined;
  const compression = value.trim();
  if (compression === "minimal" || compression === "standard" || compression === "detailed")
    return compression;
  throw new Error(
    `Unsupported context feed compression: ${compression}. Use minimal, standard, or detailed.`,
  );
}

function parseContextFeedFormat(value?: string): ContextFeedFormat {
  const format = value?.trim() || "markdown";
  if (format === "json" || format === "markdown" || format === "prompt") return format;
  throw new Error(`Unsupported context feed format: ${format}. Use json, markdown, or prompt.`);
}

function normalizeAgentProfile(value: string): string {
  const profile = value.trim().toLowerCase();
  if (profile === "claude-code") return "claude";
  if (profile === "codex" || profile === "claude" || profile === "generic") return profile;
  return "generic";
}

function defaultTeamSyncSettings(): TeamProject["settings"] {
  return {
    syncIntervalSeconds: 60,
    contextFeedCompression: "standard",
    conflictDetectionLevel: "file",
    autoSyncOnTaskChange: false,
  };
}

function createTeamSyncId(prefix: "team" | "hub" | "member" | "sync"): string {
  return `${prefix}_${randomUUID()}`;
}

function hashTeamSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function createMachineFingerprint(): string {
  return createHash("sha256")
    .update(`${cwd}:${process.env.USER ?? "unknown"}`)
    .digest("hex")
    .slice(0, 24);
}

async function resolveSanitizedRepoUrl(config: AgentgitopsConfig): Promise<string> {
  try {
    return sanitizeRemoteUrl(await new GitService(cwd).getRemoteUrl(config.git.remote));
  } catch {
    return `local:${config.project.name}`;
  }
}

function sanitizeRemoteUrl(remoteUrl: string): string {
  try {
    const parsed = new URL(remoteUrl);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return remoteUrl.replace(/:\/\/[^/@]+@/, "://");
  }
}

function createTeamSyncEvent(
  input: Omit<SyncEvent, "eventId" | "status" | "createdAt" | "updatedAt">,
): SyncEvent {
  const now = new Date().toISOString();
  return {
    ...input,
    eventId: createTeamSyncId("sync"),
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
}

function publicTeamSyncSummary(summary: TeamSyncStatusSummary): Record<string, unknown> {
  const team = summary.team ? { ...summary.team, teamSecretHash: undefined } : undefined;
  const localHub = summary.localHub
    ? { ...summary.localHub, machineFingerprint: undefined }
    : undefined;
  return {
    team,
    localHub,
    member: summary.member,
    members: summary.members,
    pendingEvents: summary.pendingEvents,
    cachedTasks: summary.cachedTasks,
    cachedChangePackages: summary.cachedChangePackages,
    cachedReviewContexts: summary.cachedReviewContexts,
    cachedAgentNotes: summary.cachedAgentNotes,
    handoffPackages: summary.handoffPackages,
    activeAdoptions: summary.activeAdoptions,
    conflictEdges: summary.conflictEdges,
    lastPushCursor: summary.lastPushCursor,
    lastPullCursor: summary.lastPullCursor,
  };
}

function printTeamSyncStatus(summary: TeamSyncStatusSummary): void {
  if (!summary.team) {
    console.log(
      "Team Sync is not initialized. Run 'agentgitops team init' or 'agentgitops team join'.",
    );
    return;
  }
  console.log(`Team: ${summary.team.name} (${summary.team.teamId})`);
  console.log(`Repo: ${summary.team.repoUrl}`);
  console.log(`Sync mode: ${summary.team.syncMode}`);
  console.log(`Relay: ${summary.team.relayUrl ?? "not configured"}`);
  console.log(`Local hub: ${summary.localHub?.hubId ?? "-"}`);
  console.log(`Member: ${summary.member?.displayName ?? "-"}`);
  console.log(`Members: ${summary.members}`);
  console.log(`Pending events: ${summary.pendingEvents}`);
  console.log(`Cached synced tasks: ${summary.cachedTasks}`);
  console.log(`Cached change packages: ${summary.cachedChangePackages}`);
  console.log(`Cached review contexts: ${summary.cachedReviewContexts}`);
  console.log(`Cached agent notes: ${summary.cachedAgentNotes}`);
  console.log(`Handoff packages: ${summary.handoffPackages}`);
  console.log(`Active adoptions: ${summary.activeAdoptions}`);
  console.log(`Conflict edges: ${summary.conflictEdges}`);
  console.log(`Last push cursor: ${summary.lastPushCursor?.cursor ?? "-"}`);
  console.log(`Last pull cursor: ${summary.lastPullCursor?.cursor ?? "-"}`);
}

type TeamSyncBooleanKey = Exclude<keyof TeamSyncConfig, "mode" | "intervalSeconds">;

const TEAM_SYNC_BOOLEAN_KEYS = [
  "tasks",
  "changedFiles",
  "riskLevel",
  "verification",
  "conflicts",
  "agentExecution",
  "failureReason",
  "filesRead",
  "tokenUsage",
  "agentNotes",
  "reviewContext",
  "handoff",
] as const satisfies readonly TeamSyncBooleanKey[];

function resolveTeamSyncConfig(config?: TeamSyncConfig): TeamSyncConfig {
  return { ...defaultTeamSyncConfig(), ...(config ?? {}) };
}

function printTeamSyncConfig(config: TeamSyncConfig): void {
  const resolved = resolveTeamSyncConfig(config);
  console.log(`Mode: ${resolved.mode}`);
  console.log(`Interval seconds: ${resolved.intervalSeconds}`);
  console.log("Content scope:");
  for (const key of TEAM_SYNC_BOOLEAN_KEYS) {
    console.log(`  ${key}: ${resolved[key] ? "enabled" : "disabled"}`);
  }
}

function parseTeamSyncConfigBooleanKey(value: string): TeamSyncBooleanKey {
  const normalized = value.trim();
  if ((TEAM_SYNC_BOOLEAN_KEYS as readonly string[]).includes(normalized)) {
    return normalized as TeamSyncBooleanKey;
  }
  throw new Error(
    `Unsupported Team Sync config key: ${value}. Use one of: ${TEAM_SYNC_BOOLEAN_KEYS.join(", ")}`,
  );
}

function parseTeamSyncConfigMode(value: string): NonNullable<TeamSyncConfig["mode"]> {
  if (value === "manual" || value === "auto") return value;
  throw new Error(`Unsupported Team Sync config mode: ${value}. Use manual or auto.`);
}

function parsePositiveSeconds(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed >= 5) return parsed;
  throw new Error("Team Sync interval must be at least 5 seconds.");
}

function createRelayClient(input: {
  relayUrl: string;
  team: TeamProject;
  hubId: string;
}): RelayClient {
  if (!input.team.teamSecretHash) {
    throw new Error(
      "Team secret hash is missing. Re-run team init/join with --secret before using Relay sync.",
    );
  }
  return new RelayClient({
    relayUrl: input.relayUrl,
    teamId: input.team.teamId,
    hubId: input.hubId,
    teamSecretHash: input.team.teamSecretHash,
  });
}

function makeSyncCursor(
  teamId: string,
  hubId: string,
  direction: SyncCursor["direction"],
  cursor: string,
  eventId?: string,
): SyncCursor {
  return {
    teamId,
    hubId,
    direction,
    cursor,
    eventId,
    updatedAt: new Date().toISOString(),
  };
}

function resolveSyncedTaskReference(store: TeamSyncStore, branchOrTask: string): SyncedTask | null {
  const summary = store.getStatusSummary();
  const tasks = store.listSyncedTasks(summary.team?.teamId);
  return (
    tasks.find((task) => task.taskId === branchOrTask || task.targetBranch === branchOrTask) ?? null
  );
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "task";
}

function recordTeamSync(handler: (producer: TeamSyncEventProducer) => void): void {
  const producer = new TeamSyncEventProducer(cwd);
  try {
    handler(producer);
  } finally {
    producer.close();
  }
  // git-native 自动导出：事件产生后自动导出到 outbox
  void autoExportIfGitNative();
}

async function autoExportIfGitNative(): Promise<void> {
  try {
    const store = new TeamSyncStore(cwd);
    try {
      const summary = store.getStatusSummary();
      if (!summary.team) return;
      if (summary.team.syncMode !== "git-native") return;
      const config = await ConfigLoader.load(cwd);
      const syncConfig = config.team?.sync ?? defaultTeamSyncConfig();
      const gitNativeConfig = resolveGitNativeConfig(syncConfig);
      if (!gitNativeConfig.autoExport) return;
      const exporter = new GitNativeSyncExporter(cwd, syncConfig);
      await exporter.exportPending();
    } finally {
      store.close();
    }
  } catch {
    // 自动导出失败不阻断主流程
  }
}

/**
 * git-native 模式下自动 git add -f + commit + push
 *
 * 将 outbox 目录的事件文件提交到 Git 仓库并推送，实现"编码后一键同步"。
 */
async function autoGitCommitAndPush(
  commitMessage: string,
): Promise<{ committed: boolean; pushed: boolean; error?: string }> {
  try {
    // 1. git add -f .agentgitops/sync/outbox/
    await execFileAsync("git", ["add", "-f", ".agentgitops/sync/outbox/"], { cwd });

    // 2. git commit
    let nothingToCommit = false;
    try {
      await execFileAsync("git", ["commit", "-m", commitMessage], { cwd });
    } catch (err) {
      const stderr = err instanceof Error ? err.message : String(err);
      if (stderr.includes("nothing to commit") || stderr.includes("no changes")) {
        nothingToCommit = true;
      } else {
        return { committed: false, pushed: false, error: `git commit failed: ${stderr}` };
      }
    }

    // 3. git push
    if (nothingToCommit) {
      return { committed: false, pushed: false, error: "nothing to commit" };
    }
    await execFileAsync("git", ["push"], { cwd });

    return { committed: true, pushed: true };
  } catch (err) {
    return {
      committed: false,
      pushed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * git-native 模式下自动 git pull
 *
 * 拉取远端代码和 outbox 事件文件，实现"编码前一键拉取"。
 */
async function autoGitPull(): Promise<{ pulled: boolean; error?: string }> {
  try {
    await execFileAsync("git", ["pull"], { cwd });
    return { pulled: true };
  } catch (err) {
    return { pulled: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * DOG-P2-001: task closeout --auto-fix
 *
 * 自动补齐 closeout 所需的产物：
 * 1. 如果 Change Package 不存在，尝试生成
 * 2. 如果有 pending Team Sync events，导出到 outbox
 * 3. 如果 handoff 目录不存在，创建占位
 */
async function autoFixCloseout(taskId: string, config: AgentgitopsConfig): Promise<string[]> {
  const actions: string[] = [];

  // 1. 检查并生成 Change Package
  const packagePath = path.join(cwd, ".agentgitops", "packages", `${taskId}.json`);
  if (!(await pathExists(packagePath))) {
    try {
      const task = await new TaskManager(cwd).load(taskId);
      const workspacePath = workspacePathFor(config, task);
      if (await pathExists(workspacePath)) {
        const diffService = new DiffService(workspacePath);
        const generator = new ChangePackageGenerator(diffService, cwd);
        const checks = await new VerificationStore(cwd).load(task.id);
        const pkg = await generator.generate(task, checks);
        actions.push(`Generated Change Package: ${pkg.id}`);
      } else {
        actions.push(`Skipped Change Package (workspace not found)`);
      }
    } catch (err) {
      actions.push(
        `Change Package generation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 2. 导出 pending Team Sync events 到 outbox
  try {
    const store = new TeamSyncStore(cwd);
    try {
      const summary = store.getStatusSummary();
      if (
        summary.team &&
        (summary.team.syncMode === "git-native" || summary.team.syncMode === "hybrid")
      ) {
        const syncConfig = config.team?.sync ?? defaultTeamSyncConfig();
        const exporter = new GitNativeSyncExporter(cwd, syncConfig);
        const result = await exporter.exportPending();
        if (result.exported > 0) {
          actions.push(`Exported ${result.exported} event(s) to outbox`);
        }
      }
    } finally {
      store.close();
    }
  } catch {
    // Team Sync 未初始化时跳过
  }

  // 3. 创建 handoff 占位目录
  const handoffDir = path.join(cwd, ".agentgitops", "handoffs");
  if (!(await pathExists(handoffDir))) {
    try {
      await fs.mkdir(handoffDir, { recursive: true });
      actions.push(`Created handoff directory`);
    } catch {
      // 忽略
    }
  }

  return actions;
}

async function runCliWorkflowJob<T>(
  action: string,
  taskId: string | undefined,
  payload: unknown,
  handler: () => Promise<T>,
): Promise<T> {
  const { job, result } = await new WorkflowJobRunner(cwd).run(
    {
      action,
      taskId,
      actorId: process.env.USER ?? "local-user",
      source: "cli",
      payload,
    },
    async (job) => {
      console.log(`Workflow job: ${job.id}`);
      return handler();
    },
  );
  console.log(`Workflow job completed: ${job.id}`);
  return result;
}

async function preparePullRequestContext(
  taskId: string,
  options: { requireToken: boolean; bodyTemplate?: PullRequestBodyTemplate },
): Promise<PullRequestContext> {
  const config = await getConfig();
  const task = await new TaskManager(cwd).load(taskId);
  const pkg = await loadChangePackage(taskId);
  const workspacePath = await resolveDiffWorkspacePath(config, task);
  const workspaceGit = new GitService(workspacePath);
  const remoteUrl = await new GitService(cwd).getRemoteUrl(config.git.remote);
  const repo =
    config.git.provider === "github"
      ? parseGitHubRepository(remoteUrl)
      : config.git.provider === "gitlab"
        ? parseGitLabRepository(remoteUrl)
        : "";
  const reviewContext = await buildReviewContext(cwd, taskId);
  const bodyTemplate = options.bodyTemplate ?? "ce";
  const teamSync =
    bodyTemplate === "team-sync" ? await buildTeamSyncPullRequestContext(task, pkg) : undefined;
  const bodyOptions = { template: bodyTemplate, teamSync };
  const body =
    config.git.provider === "github"
      ? formatChangePackagePullRequestBody(task, pkg, reviewContext, bodyOptions)
      : formatMergeRequestBody(task, pkg, reviewContext, bodyOptions);
  const token = options.requireToken ? await getProviderToken(config.git.provider) : undefined;
  return {
    config,
    task,
    pkg,
    workspacePath,
    workspaceGit,
    repo,
    body,
    bodyTemplate,
    reviewContext,
    teamSync,
    token,
  };
}

async function buildTeamSyncPullRequestContext(
  task: TaskContract,
  pkg: ChangePackage,
): Promise<TeamSyncPullRequestContext> {
  const builder = new TeamSyncPullRequestContextBuilder(cwd);
  try {
    return await builder.build(task, pkg);
  } finally {
    builder.close();
  }
}

async function buildPullRequestPreflight(
  context: PullRequestContext,
  options: { commit: boolean; requireToken: boolean },
): Promise<DiagnosticCheck[]> {
  const diagnostics: DiagnosticCheck[] = [];
  const { config, task, pkg, workspacePath, workspaceGit } = context;

  if (config.git.provider === "github" || config.git.provider === "gitlab") {
    diagnostics.push({
      name: "provider",
      status: "ok",
      detail: `${config.git.provider} / ${context.repo}`,
    });
  } else {
    diagnostics.push({
      name: "provider",
      status: "error",
      detail: `Unsupported git provider for PR/MR: ${config.git.provider}`,
      recovery: ["Set git.provider to github or gitlab in .agentgitops.yml."],
    });
  }

  diagnostics.push(
    await checkPath("workspace", workspacePath, [
      `Run agentgitops task start ${task.id}.`,
      `Run agentgitops run --agent ${task.agentId} --task ${task.id}.`,
    ]),
  );

  if (pkg.taskId !== task.id || pkg.id !== `pkg_${task.id}`) {
    diagnostics.push({
      name: "change-package",
      status: "error",
      detail: `Change Package ${pkg.id} does not match task ${task.id}.`,
      recovery: [`Run agentgitops package ${task.id} again.`],
    });
  } else if (pkg.changedFiles.length === 0 || pkg.stats.filesChanged === 0) {
    diagnostics.push({
      name: "change-package",
      status: "error",
      detail: "Change Package has zero changed files.",
      recovery: [
        "Inspect the task workspace with git status --short.",
        `Run agentgitops package ${task.id} after the workspace contains changes.`,
      ],
    });
  } else {
    diagnostics.push({
      name: "change-package",
      status: "ok",
      detail: `${pkg.changedFiles.length} files, +${pkg.stats.insertions} -${pkg.stats.deletions}`,
    });
  }

  if (pkg.baseBranch !== task.baseBranch || pkg.targetBranch !== task.targetBranch) {
    diagnostics.push({
      name: "branch-consistency",
      status: "error",
      detail: `Task branches (${task.baseBranch} -> ${task.targetBranch}) differ from package (${pkg.baseBranch} -> ${pkg.targetBranch}).`,
      recovery: [`Run agentgitops package ${task.id} again.`],
    });
  } else {
    diagnostics.push({
      name: "branch-consistency",
      status: "ok",
      detail: `${task.baseBranch} -> ${task.targetBranch}`,
    });
  }

  diagnostics.push(await checkGitRemote(config.git.remote));

  if (await pathExists(workspacePath)) {
    const workspaceStatus = await safeGitStatus(workspaceGit);
    if (options.commit && workspaceStatus.trim()) {
      diagnostics.push(await checkGitAuthor(workspacePath));
    } else {
      diagnostics.push({
        name: "git-author",
        status: "ok",
        detail: options.commit ? "No pending commit is required." : "Commit step disabled.",
      });
    }
  }

  if (options.requireToken) {
    if (context.token) {
      diagnostics.push({
        name: "provider-token",
        status: "ok",
        detail: `${config.git.provider} API token is available for this process.`,
      });
    } else {
      diagnostics.push({
        name: "provider-token",
        status: "error",
        detail: getMissingTokenMessage(config.git.provider),
        recovery: tokenRecoveryCommands(config.git.provider),
      });
    }
  } else {
    diagnostics.push({
      name: "provider-token",
      status: "warning",
      detail: "Token was not required because this is a dry-run/preflight-only check.",
      recovery: tokenRecoveryCommands(config.git.provider),
    });
  }

  return diagnostics;
}

async function checkPath(
  name: string,
  targetPath: string,
  recovery: string[],
): Promise<DiagnosticCheck> {
  return (await pathExists(targetPath))
    ? { name, status: "ok", detail: targetPath }
    : { name, status: "error", detail: `${targetPath} does not exist.`, recovery };
}

async function checkGitRemote(remote: string): Promise<DiagnosticCheck> {
  try {
    const remoteUrl = await new GitService(cwd).getRemoteUrl(remote);
    return {
      name: "git-remote",
      status: "ok",
      detail: `${remote}: ${redactRemoteUrl(remoteUrl)}`,
    };
  } catch (error) {
    return {
      name: "git-remote",
      status: "error",
      detail: errorMessage(error),
      recovery: [`Configure a remote with git remote add ${remote} <url>.`],
    };
  }
}

async function checkGitAuthor(repoPath: string): Promise<DiagnosticCheck> {
  const [name, email] = await Promise.all([
    gitConfig(repoPath, "user.name"),
    gitConfig(repoPath, "user.email"),
  ]);
  if (name && email) {
    return { name: "git-author", status: "ok", detail: `${name} <${email}>` };
  }
  return {
    name: "git-author",
    status: "error",
    detail: "Git author identity is missing in the task workspace.",
    recovery: [
      `git -C ${repoPath} config user.name "AgentGitOps Smoke"`,
      `git -C ${repoPath} config user.email "agentgitops-smoke@example.com"`,
    ],
  };
}

async function gitConfig(repoPath: string, key: string): Promise<string | undefined> {
  try {
    const result = await execFileAsync("git", ["config", "--get", key], {
      cwd: repoPath,
      maxBuffer: 1024 * 1024,
    });
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function safeGitStatus(git: GitService): Promise<string> {
  try {
    return await git.status();
  } catch {
    return "";
  }
}

function hasBlockingDiagnostics(diagnostics: DiagnosticCheck[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.status === "error");
}

function printDiagnostics(diagnostics: DiagnosticCheck[]): void {
  for (const diagnostic of diagnostics) {
    const icon = diagnostic.status === "ok" ? "✓" : diagnostic.status === "warning" ? "!" : "✗";
    const line = `${icon} ${diagnostic.name}: ${diagnostic.detail}`;
    if (diagnostic.status === "error") console.error(line);
    else console.log(line);
    for (const recovery of diagnostic.recovery ?? []) {
      const output = `  recovery: ${recovery}`;
      if (diagnostic.status === "error") console.error(output);
      else console.log(output);
    }
  }
}

function parseTaskCloseoutMode(value?: string): TaskCloseoutMode {
  const mode = value ?? "checkpoint";
  if (
    mode === "checkpoint" ||
    mode === "pause" ||
    mode === "done" ||
    mode === "merged-direct" ||
    mode === "state-only"
  ) {
    return mode;
  }
  throw new Error(
    `Unsupported closeout mode: ${mode}. Use checkpoint, pause, done, merged-direct, or state-only.`,
  );
}

function printTaskCloseoutReport(report: TaskCloseoutReport): void {
  console.log(`Task closeout dry-run: ${report.taskId}`);
  console.log(`Mode: ${report.mode}`);
  console.log(`Generated: ${report.generatedAt}`);
  if (report.task) {
    console.log(`Status: ${report.task.status}`);
    console.log(`Branch: ${report.task.baseBranch} -> ${report.task.targetBranch}`);
    console.log(`Workspace: ${report.task.workspacePath}`);
  }
  console.log(
    `Summary: ${report.summary.ok} ok, ${report.summary.warning} warning, ${report.summary.error} error`,
  );
  console.log("");

  for (const check of report.checks) {
    const icon = check.status === "ok" ? "✓" : check.status === "warning" ? "!" : "✗";
    const line = `${icon} ${check.name}: ${check.detail}`;
    if (check.status === "error") console.error(line);
    else console.log(line);
    for (const recovery of check.recovery ?? []) {
      const output = `  recovery: ${recovery}`;
      if (check.status === "error") console.error(output);
      else console.log(output);
    }
  }

  console.log("");
  if (report.summary.readyForHandoff) {
    console.log("Result: ready for handoff/resume. Review warnings before switching locations.");
  } else {
    console.error(
      "Result: not ready for handoff/resume. Resolve error checks before leaving this location.",
    );
  }
}

function parseEnvPairs(pairs: string[]): Record<string, string> | undefined {
  if (pairs.length === 0) return undefined;
  const env: Record<string, string> = {};
  for (const pair of pairs) {
    const separator = pair.indexOf("=");
    if (separator <= 0) {
      throw new Error(`Invalid env pair: ${pair}. Expected KEY=VALUE.`);
    }
    env[pair.slice(0, separator)] = pair.slice(separator + 1);
  }
  return env;
}

async function getProviderToken(provider: string): Promise<string | undefined> {
  if (provider === "github") {
    return process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? (await getGitHubCliToken());
  }
  if (provider === "gitlab") return process.env.GITLAB_TOKEN;
  return undefined;
}

function getMissingTokenMessage(provider: string): string {
  if (provider === "github") {
    return "Missing GitHub token. Set GITHUB_TOKEN/GH_TOKEN or run 'gh auth login'.";
  }
  if (provider === "gitlab") return "Missing GitLab token. Set GITLAB_TOKEN.";
  return `Missing token for provider: ${provider}`;
}

function tokenRecoveryCommands(provider: string): string[] {
  if (provider === "github") {
    return [
      "Set GITHUB_TOKEN or GH_TOKEN for this command only.",
      "Run gh auth login -h github.com --git-protocol https --web.",
      "For fine-grained tokens, grant Metadata read, Contents read/write, and Pull requests read/write.",
    ];
  }
  if (provider === "gitlab") {
    return [
      "Set GITLAB_TOKEN for this command only.",
      "Set GITLAB_HOST when using a self-hosted GitLab instance.",
    ];
  }
  return ["Configure git.provider as github or gitlab."];
}

function printRecoverableError(title: string, error: unknown, recovery: string[]): void {
  console.error(`✗ ${title}: ${errorMessage(error)}`);
  for (const hint of recovery) console.error(`  recovery: ${hint}`);
}

function recoveryForPullRequestError(
  error: unknown,
  provider: string,
  workspacePath: string,
): string[] {
  const text = errorMessage(error);
  if (
    text.includes("Author identity unknown") ||
    text.includes("unable to auto-detect email address")
  ) {
    return [
      `git -C ${workspacePath} config user.name "AgentGitOps Smoke"`,
      `git -C ${workspacePath} config user.email "agentgitops-smoke@example.com"`,
      "Retry the same agentgitops pr command; it is idempotent.",
    ];
  }
  if (text.includes("Permission denied") || text.includes("publickey")) {
    return [
      "Confirm the SSH public key is registered on the GitHub/GitLab account with repo access.",
      "Run ssh -T git@github.com or git ls-remote <remote-url> outside restricted sandboxes.",
      "Remember SSH fixes git push only; provider API still needs a token.",
    ];
  }
  if (text.includes("Authentication failed") || text.includes("could not read Username")) {
    return [
      "Confirm git push credentials for the configured remote.",
      "For HTTPS remotes, refresh the credential helper or use gh auth login.",
      "Retry after git ls-remote <remote-url> succeeds.",
    ];
  }
  if (
    text.includes("GitHub API") ||
    text.includes("GitLab API") ||
    text.includes("401") ||
    text.includes("403")
  ) {
    return [
      ...tokenRecoveryCommands(provider),
      "Confirm the token can access the target repository and PR/MR permissions.",
      "Retry the same agentgitops pr command; existing PR/MR lookup is idempotent.",
    ];
  }
  if (text.includes("422")) {
    return [
      "Confirm base and head branches both exist on the provider.",
      "Confirm an open PR/MR from the same head branch does not have incompatible metadata.",
      "Retry after running agentgitops pr preflight <task-id> --real.",
    ];
  }
  return [
    "Run agentgitops pr preflight <task-id> --real.",
    "Check git credentials separately from provider API token credentials.",
    "Retry the same command; PR/MR creation is designed to be idempotent.",
  ];
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const withStderr = error as Error & { stderr?: string; shortMessage?: string };
    return withStderr.stderr?.trim() || withStderr.shortMessage || error.message;
  }
  return String(error);
}

function redactRemoteUrl(remoteUrl: string): string {
  return remoteUrl
    .replace(/https:\/\/[^/@]+@/i, "https://<credential>@")
    .replace(/\/\/([^:/]+):([^@]+)@/g, "//<credential>@");
}

async function getProviderRepository(config: AgentgitopsConfig): Promise<string> {
  const remoteUrl = await new GitService(cwd).getRemoteUrl(config.git.remote);
  if (config.git.provider === "github") return parseGitHubRepository(remoteUrl);
  if (config.git.provider === "gitlab") return parseGitLabRepository(remoteUrl);
  throw new Error(`Unsupported git provider: ${config.git.provider}`);
}

function normalizeGitHubMergeMethod(
  strategy: string | undefined,
  squashOption: boolean | undefined,
  taskSquash: boolean | undefined,
): GitHubMergeMethod {
  if (strategy) {
    if (strategy === "merge" || strategy === "squash" || strategy === "rebase") return strategy;
    throw new Error(`Unsupported GitHub merge strategy: ${strategy}`);
  }
  return (squashOption ?? taskSquash ?? true) ? "squash" : "merge";
}

function resolveWebPortOption(cliPort?: string, registryPort?: number): string | undefined {
  const normalizedCliPort = cliPort?.trim();
  if (normalizedCliPort) return normalizedCliPort;
  return registryPort === undefined ? undefined : String(registryPort);
}

async function startWebServer(opts: {
  host?: string;
  port?: string;
  mode?: string;
  projectPath?: string;
}): Promise<void> {
  const mode = parseServerMode(opts.mode);
  const staticDir = path.resolve(__dirname, "../../web/dist");
  const port = opts.port ? parseInt(opts.port, 10) : undefined;
  const projectPath = opts.projectPath ?? cwd;

  // relay 模式跳过 Web 静态资源诊断（不提供 Web UI）
  if (mode === "full") {
    const diagnostics = await buildWebStartupDiagnostics(staticDir, opts.host ?? "localhost", port);
    const blocking = hasBlockingDiagnostics(diagnostics);
    if (blocking) {
      printDiagnostics(diagnostics);
      process.exitCode = 1;
      return;
    }
  }

  try {
    const started = await startAgentGitOpsServer({
      projectPath,
      staticDir,
      host: opts.host,
      port: Number.isFinite(port) ? port : undefined,
      mode,
    });

    if (mode === "relay") {
      console.log(`agentgitops relay listening on ${started.url}`);
      console.log("Relay mode: only /api/sync/* and /api/team/* routes are available.");
    } else {
      console.log(`agentgitops web listening on ${started.url}`);
    }
    console.log("Press Ctrl+C to stop.");
  } catch (error) {
    printRecoverableError(
      "Server failed to start",
      error,
      recoveryForWebStartupError(error, opts.host ?? "localhost", port),
    );
    process.exitCode = 1;
  }
}

function parseServerMode(value?: string): "full" | "relay" {
  if (!value || value === "full" || value === "app") return "full";
  if (value === "relay") return "relay";
  throw new Error(`Unsupported server mode: ${value}. Use full or relay.`);
}

async function buildWebStartupDiagnostics(
  staticDir: string,
  host: string,
  port?: number,
): Promise<DiagnosticCheck[]> {
  const diagnostics: DiagnosticCheck[] = [];
  const indexPath = path.join(staticDir, "index.html");
  diagnostics.push(
    await checkPath("web-assets", indexPath, [
      "Run pnpm exec turbo run build --filter @agentgitops/web.",
      "Run pnpm build from the repository root.",
    ]),
  );

  if (port !== undefined && (!Number.isInteger(port) || port <= 0 || port > 65535)) {
    diagnostics.push({
      name: "web-port",
      status: "error",
      detail: `Invalid port: ${String(port)}`,
      recovery: ["Use --port with a value between 1 and 65535."],
    });
  } else {
    diagnostics.push({
      name: "web-port",
      status: "ok",
      detail: `${host}:${port ?? "default"}`,
    });
  }

  try {
    await ConfigLoader.load(cwd);
    diagnostics.push({ name: "web-config", status: "ok", detail: ".agentgitops.yml is present." });
  } catch {
    diagnostics.push({
      name: "web-config",
      status: "warning",
      detail: ".agentgitops.yml is missing; Web UI can initialize the project.",
      recovery: ["Open the Web UI and use Initialize Current Project.", "Or run agentgitops init."],
    });
  }

  return diagnostics;
}

function recoveryForWebStartupError(error: unknown, host: string, port?: number): string[] {
  const text = errorMessage(error);
  const endpoint = `${host}:${port ?? "default"}`;
  if (text.includes("EADDRINUSE")) {
    return [
      `Another process is already listening on ${endpoint}.`,
      "Choose another --port, or stop the existing process.",
      "On macOS/Linux, inspect the port with lsof -nP -iTCP:<port> -sTCP:LISTEN.",
    ];
  }
  if (text.includes("EACCES") || text.includes("EPERM")) {
    return [
      `The process is not permitted to bind ${endpoint}.`,
      "Use --host 127.0.0.1 and a high port such as --port 4318.",
      "If running inside a sandbox, rerun with the approved local-server permission path.",
    ];
  }
  if (text.includes("WEB_ASSETS_NOT_FOUND")) {
    return ["Run pnpm build before starting the Web UI."];
  }
  return [
    "Run agentgitops doctor.",
    "Try --host 127.0.0.1 --port 4318.",
    "Confirm Web assets exist at apps/web/dist.",
  ];
}

async function getGitHubCliToken(): Promise<string | undefined> {
  try {
    const result = await execFileAsync("gh", ["auth", "token"], {
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    });
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function workspacePathFor(config: AgentgitopsConfig, task: TaskContract): string {
  return path.join(
    path.resolve(cwd, config.project.worktree_root),
    `${config.project.name}-${task.id}`,
  );
}

async function resolveDiffWorkspacePath(
  config: AgentgitopsConfig,
  task: TaskContract,
): Promise<string> {
  const workspacePath = workspacePathFor(config, task);
  if (await pathExists(workspacePath)) return workspacePath;

  try {
    const currentBranch = await new GitService(cwd).getCurrentBranch();
    if (currentBranch === task.targetBranch) return cwd;
  } catch {
    // Fall through to the standard missing-workspace error.
  }

  throw new Error(
    `Workspace not found for ${task.id}: ${workspacePath}. Current repository can be used only when checked out to ${task.targetBranch}.`,
  );
}

function workspaceStatusFromTask(status: TaskStatus): string {
  if (status === "merged" || status === "canceled") return "archived";
  if (status === "failed") return "dirty";
  return "created";
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function gitRefExists(ref: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", "--quiet", ref], { cwd });
    return true;
  } catch {
    return false;
  }
}

async function currentBranchIs(branch: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["branch", "--show-current"], { cwd });
    return stdout.trim() === branch;
  } catch {
    return false;
  }
}

async function deleteLocalBranch(branch: string): Promise<void> {
  try {
    await execFileAsync("git", ["branch", "-D", branch], { cwd });
  } catch {
    // Branch may already be absent; workspace removal should remain idempotent.
  }
}

async function tryLoadChangePackage(taskId: string): Promise<ChangePackage | null> {
  try {
    return await loadChangePackage(taskId);
  } catch {
    return null;
  }
}

async function recordAudit(
  config: AgentgitopsConfig,
  eventType: string,
  payload: unknown,
  taskId?: string,
): Promise<void> {
  const db = new LocalDb(cwd);
  try {
    db.insertAuditEvent({
      id: `audit_${randomUUID()}`,
      projectId: config.project.name,
      taskId,
      actorType: "human",
      actorId: process.env.USER ?? "local-user",
      eventType,
      payload,
    });
  } finally {
    db.close();
  }
}

async function submitReview(
  taskId: string,
  action: ReviewAction,
  reviewerId: string,
  comment?: string,
): Promise<void> {
  await loadChangePackage(taskId);
  const taskMgr = new TaskManager(cwd);
  const review = await new ReviewStore(cwd).submit({
    changePackageId: `pkg_${taskId}`,
    reviewerId,
    action,
    comment,
  });

  const nextStatus = statusAfterReview(action);
  const updated = await taskMgr.updateStatus(taskId, nextStatus);
  recordTeamSync((producer) => {
    producer.recordReviewSubmitted(updated, review);
    producer.recordTaskUpdated(updated);
  });

  console.log(`✓ Review submitted: ${review.id}`);
  console.log(`  Action: ${review.action}`);
  console.log(`  Reviewer: ${review.reviewerId}`);
  console.log(`  Next status: ${nextStatus}`);
}

function statusAfterReview(action: ReviewAction): "reviewing" | "blocked" | "running" | "failed" {
  switch (action) {
    case "approve":
      return "reviewing";
    case "request_changes":
    case "ask_agent_to_fix":
      return "running";
    case "reject":
      return "failed";
    case "escalate":
    case "mark_high_risk":
    case "add_required_check":
      return "blocked";
    default:
      return "reviewing";
  }
}

function formatReviewContext(context: ReviewContext): string {
  const lines: string[] = [];
  lines.push(`Review Context: ${context.task.id}`);
  lines.push(`Title: ${context.task.title}`);
  lines.push(`Status: ${context.task.status}`);
  lines.push(`Risk: ${context.summary.riskLevel}`);
  lines.push(`Changed files: ${context.summary.changedFiles}`);
  if (context.summary.prUrl) lines.push(`PR/MR: ${context.summary.prUrl}`);
  lines.push("");

  lines.push("Checklist:");
  for (const item of context.checklist) {
    lines.push(`- [${item.severity}] ${item.title}: ${item.detail}`);
  }
  lines.push("");

  lines.push("Agent Notes:");
  if (context.agentNotes.length === 0) {
    lines.push("- none");
  } else {
    for (const note of context.agentNotes.slice(0, 5)) {
      lines.push(`- ${note.createdAt} ${note.agentId}: ${note.summary}`);
      if (note.reviewFocus.length > 0)
        lines.push(`  review focus: ${note.reviewFocus.join(" | ")}`);
      if (note.risks.length > 0) lines.push(`  risks: ${note.risks.join(" | ")}`);
    }
  }
  lines.push("");

  lines.push("Reviews:");
  if (context.reviews.length === 0) {
    lines.push("- none");
  } else {
    for (const review of context.reviews) {
      lines.push(
        `- ${review.createdAt} ${review.reviewerId}: ${review.action}${review.comment ? ` - ${review.comment}` : ""}`,
      );
    }
  }
  lines.push("");

  lines.push("Recent Audit:");
  if (context.audit.length === 0) {
    lines.push("- none");
  } else {
    for (const event of context.audit.slice(-10)) {
      lines.push(`- ${event.createdAt} ${event.eventType} by ${event.actorId}`);
    }
  }

  return lines.join("\n");
}

function normalizeList(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

async function normalizeTaskPathPatterns(
  values: string[] | undefined,
): Promise<string[] | undefined> {
  if (values === undefined) return undefined;
  const patterns: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeTaskPathPattern(value);
    if (!normalized || isGeneratedPathPattern(normalized)) continue;
    const pattern = await expandDirectoryPattern(normalized);
    if (!seen.has(pattern)) {
      seen.add(pattern);
      patterns.push(pattern);
    }
  }
  return patterns;
}

function normalizeTaskPathPattern(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\\/g, "/").replace(/\/+$/g, "");
}

async function expandDirectoryPattern(pattern: string): Promise<string> {
  if (hasGlob(pattern)) return pattern;
  try {
    const stat = await fs.stat(path.resolve(cwd, pattern));
    if (stat.isDirectory()) return `${pattern}/**`;
  } catch {
    // Non-existent paths may still be valid future files or glob-like policy input.
  }
  return pattern;
}

function hasGlob(pattern: string): boolean {
  return /[*?[\]{}]/.test(pattern);
}

function isGeneratedPathPattern(pattern: string): boolean {
  return pattern
    .split("/")
    .some((segment) =>
      ["node_modules", "dist", "build", "coverage", ".turbo", ".cache"].includes(segment),
    );
}
