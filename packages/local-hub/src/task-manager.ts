import fs from "node:fs/promises";
import path from "node:path";
import { stringify, parse } from "yaml";
import type { TaskContract, TaskStatus, RiskLevel } from "@agentgitops/core";
import { CONFIG_DIR } from "@agentgitops/core";
import { LocalDb } from "./local-db.js";

/**
 * TaskManager - 创建和管理 Task Contract
 */
export class TaskManager {
  constructor(private readonly projectPath: string) {}

  private get tasksDir(): string {
    return path.join(this.projectPath, CONFIG_DIR, "tasks");
  }

  /**
   * 生成任务 ID
   */
  generateTaskId(): string {
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const seq = String(Math.floor(Math.random() * 999) + 1).padStart(3, "0");
    return `task-${dateStr}-${seq}`;
  }

  /**
   * 创建任务
   */
  async create(params: TaskCreateParams): Promise<TaskContract> {
    const taskId = params.taskId ?? this.generateTaskId();
    const now = new Date().toISOString();
    const targetBranch = `agent/${taskId}/${params.agentName}`;

    const task: TaskContract = {
      id: taskId,
      projectId: params.projectName,
      title: params.title,
      objective: params.objective ?? params.title,
      background: params.background,
      baseBranch: params.baseBranch ?? "main",
      targetBranch,
      agentId: params.agentName,
      allowedPaths: params.allowedPaths ?? [],
      forbiddenPaths: params.forbiddenPaths ?? [],
      requiredChecks: params.requiredChecks ?? [],
      riskLevel: params.riskLevel ?? "low",
      riskDomains: params.riskDomains,
      approval: {
        required: params.riskLevel === "high" || params.riskLevel === "critical",
        reviewers: params.reviewers,
      },
      merge: {
        strategy: "manual",
        squash: true,
      },
      status: "created",
      createdAt: now,
      updatedAt: now,
    };

    await this.save(task);
    return task;
  }

  /**
   * 保存任务到 YAML 文件
   */
  async save(task: TaskContract): Promise<void> {
    this.upsertSqliteTask(task);
    await fs.mkdir(this.tasksDir, { recursive: true });
    const filePath = path.join(this.tasksDir, `${task.id}.yml`);
    const content = stringify(task);
    await fs.writeFile(filePath, content, "utf-8");
  }

  /**
   * 加载任务
   */
  async load(taskId: string): Promise<TaskContract> {
    const snapshotTask = await this.loadYamlTask(taskId);
    if (snapshotTask) {
      this.upsertSqliteTask(snapshotTask);
      return snapshotTask;
    }

    const dbTask = this.loadSqliteTask(taskId);
    if (dbTask) return dbTask;

    throw new Error(`Task not found: ${taskId}`);
  }

  /**
   * 列出所有任务
   */
  async list(): Promise<TaskContract[]> {
    const byId = new Map<string, TaskContract>();
    for (const task of this.listSqliteTasks()) byId.set(task.id, task);

    try {
      for (const task of await this.listYamlTasks()) {
        this.upsertSqliteTask(task);
        byId.set(task.id, task);
      }
    } catch {
      // SQLite remains the source of truth when YAML snapshots are absent.
    }
    return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * 检查 Git task 快照与本机 SQLite 运行态之间的漂移，不修改本机状态。
   */
  async inspectSnapshotDrift(): Promise<TaskSnapshotDrift[]> {
    const sqliteTasks = new Map(this.listSqliteTasks().map((task) => [task.id, task]));
    const snapshotTasks = new Map((await this.listYamlTasks()).map((task) => [task.id, task]));
    const ids = new Set([...sqliteTasks.keys(), ...snapshotTasks.keys()]);
    const drift: TaskSnapshotDrift[] = [];

    for (const taskId of [...ids].sort()) {
      const snapshot = snapshotTasks.get(taskId);
      const sqlite = sqliteTasks.get(taskId);
      if (snapshot && !sqlite) {
        drift.push(buildSnapshotDrift(taskId, snapshot, sqlite, "missing-sqlite"));
      } else if (!snapshot && sqlite) {
        drift.push(buildSnapshotDrift(taskId, snapshot, sqlite, "missing-snapshot"));
      } else if (snapshot && sqlite && snapshot.status !== sqlite.status) {
        drift.push(buildSnapshotDrift(taskId, snapshot, sqlite, "status-mismatch"));
      } else if (snapshot && sqlite && snapshot.updatedAt !== sqlite.updatedAt) {
        drift.push(buildSnapshotDrift(taskId, snapshot, sqlite, "updatedAt-mismatch"));
      }
    }

    return drift;
  }

  /**
   * 以已提交/已拉取的 YAML 快照为准，把 SQLite 恢复到 Git-native 状态。
   */
  async reconcileFromSnapshots(
    options: TaskSnapshotReconcileOptions = {},
  ): Promise<TaskSnapshotReconcileResult> {
    const drift = await this.inspectSnapshotDrift();
    const snapshotBackedDrift = drift.filter((item) => item.reason !== "missing-snapshot");
    const checked = new Set([
      ...this.listSqliteTasks().map((task) => task.id),
      ...(await this.listYamlTasks()).map((task) => task.id),
    ]).size;
    if (!options.dryRun) {
      for (const item of snapshotBackedDrift) {
        const task = await this.loadYamlTask(item.taskId);
        if (task) this.upsertSqliteTask(task);
      }
    }

    const sqliteOnly = drift.filter((item) => item.reason === "missing-snapshot").length;
    return {
      checked,
      updated: options.dryRun ? 0 : snapshotBackedDrift.length,
      pending: options.dryRun ? snapshotBackedDrift.length : 0,
      unchanged: Math.max(0, checked - drift.length),
      sqliteOnly,
      drift,
    };
  }

  /**
   * 更新任务状态
   */
  async updateStatus(taskId: string, status: TaskStatus): Promise<TaskContract> {
    const task = await this.load(taskId);
    task.status = status;
    task.updatedAt = new Date().toISOString();
    await this.save(task);
    return task;
  }

  /**
   * 更新任务合同字段，并同时写回 SQLite 与 YAML 快照。
   */
  async update(taskId: string, params: TaskUpdateParams): Promise<TaskContract> {
    const task = await this.load(taskId);
    if (params.title !== undefined) task.title = params.title;
    if (params.objective !== undefined) task.objective = params.objective;
    if (params.background !== undefined) task.background = params.background;
    if (params.allowedPaths !== undefined) task.allowedPaths = params.allowedPaths;
    if (params.forbiddenPaths !== undefined) task.forbiddenPaths = params.forbiddenPaths;
    if (params.requiredChecks !== undefined) task.requiredChecks = params.requiredChecks;
    if (params.riskLevel !== undefined) {
      task.riskLevel = params.riskLevel;
      task.approval.required = params.riskLevel === "high" || params.riskLevel === "critical";
    }
    if (params.riskDomains !== undefined) task.riskDomains = params.riskDomains;
    if (params.reviewers !== undefined) task.approval.reviewers = params.reviewers;
    task.updatedAt = new Date().toISOString();
    await this.save(task);
    return task;
  }

  private upsertSqliteTask(task: TaskContract): void {
    const db = new LocalDb(this.projectPath);
    try {
      db.upsertTask(task);
    } finally {
      db.close();
    }
  }

  private loadSqliteTask(taskId: string): TaskContract | null {
    const db = new LocalDb(this.projectPath);
    try {
      return db.getTask(taskId);
    } finally {
      db.close();
    }
  }

  private async loadYamlTask(taskId: string): Promise<TaskContract | null> {
    try {
      const filePath = path.join(this.tasksDir, `${taskId}.yml`);
      const content = await fs.readFile(filePath, "utf-8");
      return parse(content) as TaskContract;
    } catch {
      return null;
    }
  }

  private async listYamlTasks(): Promise<TaskContract[]> {
    const tasks: TaskContract[] = [];
    let files: string[];
    try {
      files = await fs.readdir(this.tasksDir);
    } catch {
      return [];
    }
    for (const file of files) {
      if (file.endsWith(".yml")) {
        const content = await fs.readFile(path.join(this.tasksDir, file), "utf-8");
        tasks.push(parse(content) as TaskContract);
      }
    }
    return tasks;
  }

  private listSqliteTasks(): TaskContract[] {
    const db = new LocalDb(this.projectPath);
    try {
      return db.listTasks();
    } finally {
      db.close();
    }
  }
}

export interface TaskCreateParams {
  taskId?: string;
  projectName: string;
  title: string;
  objective?: string;
  background?: string;
  agentName: string;
  baseBranch?: string;
  allowedPaths?: string[];
  forbiddenPaths?: string[];
  requiredChecks?: string[];
  riskLevel?: RiskLevel;
  riskDomains?: string[];
  reviewers?: string[];
}

export interface TaskUpdateParams {
  title?: string;
  objective?: string;
  background?: string;
  allowedPaths?: string[];
  forbiddenPaths?: string[];
  requiredChecks?: string[];
  riskLevel?: RiskLevel;
  riskDomains?: string[];
  reviewers?: string[];
}

export type TaskSnapshotDriftReason =
  "missing-sqlite" | "missing-snapshot" | "status-mismatch" | "updatedAt-mismatch";

export interface TaskSnapshotDrift {
  taskId: string;
  title: string;
  reason: TaskSnapshotDriftReason;
  snapshotStatus?: TaskStatus;
  sqliteStatus?: TaskStatus;
  snapshotUpdatedAt?: string;
  sqliteUpdatedAt?: string;
}

export interface TaskSnapshotReconcileOptions {
  dryRun?: boolean;
}

export interface TaskSnapshotReconcileResult {
  checked: number;
  updated: number;
  pending: number;
  unchanged: number;
  sqliteOnly: number;
  drift: TaskSnapshotDrift[];
}

function buildSnapshotDrift(
  taskId: string,
  snapshot: TaskContract | undefined,
  sqlite: TaskContract | undefined,
  reason: TaskSnapshotDriftReason,
): TaskSnapshotDrift {
  return {
    taskId,
    title: snapshot?.title ?? sqlite?.title ?? taskId,
    reason,
    snapshotStatus: snapshot?.status,
    sqliteStatus: sqlite?.status,
    snapshotUpdatedAt: snapshot?.updatedAt,
    sqliteUpdatedAt: sqlite?.updatedAt,
  };
}
