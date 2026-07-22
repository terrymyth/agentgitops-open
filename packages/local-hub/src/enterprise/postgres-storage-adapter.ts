import type { StorageAdapter, StorageConfig } from "@agentgitops/core";

/**
 * PostgresStorageAdapter — EE PostgreSQL 存储适配器（P1-001）
 *
 * EE 通过注入此适配器将存储层从 SQLite 升级到 PostgreSQL。
 *
 * 设计原则：
 * 1. 不在 CE 中引入 pg 运行时依赖（离线/私有化友好）
 * 2. 通过动态 import 加载 pg，不可用时给出明确错误
 * 3. 支持连接池、SSL、超时
 * 4. 支持从 SQLite 迁移（migrateFromSqlite）
 *
 * 使用方式：
 *   const adapter = new PostgresStorageAdapter({
 *     type: "postgresql",
 *     url: "postgresql://user:pass@host:5432/agentgitops",
 *     poolSize: 10,
 *     ssl: true,
 *   });
 *   await adapter.initialize();
 */
export class PostgresStorageAdapter implements StorageAdapter {
  private config: StorageConfig;
  private pool: unknown | null = null;
  private pgModule: unknown | null = null;
  private connected = false;

  constructor(config: StorageConfig) {
    if (config.type !== "postgresql") {
      throw new Error(`PostgresStorageAdapter requires type "postgresql", got "${config.type}"`);
    }
    this.config = config;
  }

  /**
   * 动态加载 pg 模块
   *
   * 不在 CE package.json 中声明 pg 依赖，由 EE 环境自行安装。
   * 加载失败时抛出明确错误，指导用户安装 pg。
   */
  private async loadPgModule(): Promise<void> {
    if (this.pgModule) return;
    try {
      this.pgModule = await import("pg");
    } catch {
      throw new Error(
        "PostgreSQL adapter requires the 'pg' package. Install it with: npm install pg. " +
          "If you are using CE edition, use CeStorageAdapter (SQLite) instead.",
      );
    }
  }

  async initialize(): Promise<void> {
    try {
      await this.loadPgModule();
      const pg = this.pgModule as { Pool: new (config: unknown) => unknown };
      const poolConfig: Record<string, unknown> = {
        connectionString: this.config.url,
        max: this.config.poolSize ?? 10,
        connectionTimeoutMillis: this.config.timeoutMs ?? 5000,
        ssl: this.config.ssl ? { rejectUnauthorized: false } : false,
      };

      this.pool = new pg.Pool(poolConfig);

      // 验证连接
      const client = await this.getClient();
      try {
        await this.executeQuery(client, "SELECT 1 as ok");
        this.connected = true;
      } finally {
        this.releaseClient(client);
      }

      // 创建核心表结构（与 SQLite LocalDb 对齐）
      await this.createSchema();
    } catch (error) {
      await this.close().catch(() => undefined);
      throw new Error(
        `PostgreSQL adapter initialization failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  /**
   * 获取 PG 客户端
   */
  private async getClient(): Promise<unknown> {
    if (!this.pool) {
      throw new Error("PostgreSQL pool not initialized. Call initialize() first.");
    }
    const pool = this.pool as { connect: () => Promise<unknown> };
    return pool.connect();
  }

  /**
   * 释放 PG 客户端
   */
  private releaseClient(client: unknown): void {
    const c = client as { release: () => void };
    if (c && typeof c.release === "function") {
      c.release();
    }
  }

  /**
   * 执行查询
   */
  private async executeQuery(client: unknown, text: string, params?: unknown[]): Promise<unknown> {
    const c = client as {
      query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    };
    const result = await c.query(text, params);
    return result.rows;
  }

  /**
   * 创建表结构
   *
   * 与 LocalDb (SQLite) 的表结构对齐，使用 PostgreSQL 语法。
   */
  private async createSchema(): Promise<void> {
    const client = await this.getClient();
    try {
      await this.executeQuery(
        client,
        `
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          objective TEXT,
          status TEXT NOT NULL DEFAULT 'planning',
          risk_level TEXT DEFAULT 'low',
          agent_id TEXT,
          base_branch TEXT,
          target_branch TEXT,
          allowed_paths TEXT,
          forbidden_paths TEXT,
          required_checks TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          created_by TEXT,
          data TEXT
        )
      `,
      );

      await this.executeQuery(
        client,
        `
        CREATE TABLE IF NOT EXISTS audit_events (
          id TEXT PRIMARY KEY,
          task_id TEXT,
          event_type TEXT NOT NULL,
          actor TEXT,
          actor_type TEXT,
          project_id TEXT,
          payload TEXT,
          timestamp TEXT NOT NULL
        )
      `,
      );

      await this.executeQuery(
        client,
        `
        CREATE TABLE IF NOT EXISTS workflow_jobs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          task_id TEXT,
          job_type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          payload TEXT,
          result TEXT,
          error TEXT,
          created_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT,
          retry_count INTEGER DEFAULT 0
        )
      `,
      );

      await this.executeQuery(
        client,
        `
        CREATE TABLE IF NOT EXISTS immutable_audit (
          event_id TEXT PRIMARY KEY,
          previous_hash TEXT NOT NULL,
          current_hash TEXT NOT NULL,
          event_type TEXT NOT NULL,
          actor_id TEXT,
          actor_type TEXT,
          project_id TEXT,
          task_id TEXT,
          payload TEXT,
          timestamp TEXT NOT NULL,
          signature TEXT
        )
      `,
      );

      await this.executeQuery(
        client,
        `
        CREATE TABLE IF NOT EXISTS compliance_reports (
          report_id TEXT PRIMARY KEY,
          standard TEXT NOT NULL,
          format TEXT NOT NULL,
          generated_at TEXT NOT NULL,
          period_start TEXT NOT NULL,
          period_end TEXT NOT NULL,
          summary TEXT,
          data TEXT
        )
      `,
      );

      // 索引
      await this.executeQuery(
        client,
        "CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)",
      );
      await this.executeQuery(
        client,
        "CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)",
      );
      await this.executeQuery(
        client,
        "CREATE INDEX IF NOT EXISTS idx_audit_task ON audit_events(task_id)",
      );
      await this.executeQuery(
        client,
        "CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_events(event_type)",
      );
      await this.executeQuery(
        client,
        "CREATE INDEX IF NOT EXISTS idx_jobs_status ON workflow_jobs(status)",
      );
      await this.executeQuery(
        client,
        "CREATE INDEX IF NOT EXISTS idx_immutable_ts ON immutable_audit(timestamp)",
      );
    } finally {
      this.releaseClient(client);
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      const pool = this.pool as { end: () => Promise<void> };
      await pool.end();
      this.pool = null;
    }
    this.connected = false;
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> {
    if (!this.pool) {
      return { healthy: false, error: "Pool not initialized" };
    }
    const start = Date.now();
    try {
      const client = await this.getClient();
      try {
        await this.executeQuery(client, "SELECT 1 as ok");
        return { healthy: true, latencyMs: Date.now() - start };
      } finally {
        this.releaseClient(client);
      }
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  getType(): "postgresql" {
    return "postgresql";
  }

  getVersion(): string {
    return "1.0.0";
  }

  /**
   * 从 SQLite 迁移数据到 PostgreSQL
   *
   * 读取 SQLite 中的 tasks/audit_events/workflow_jobs 表，
   * 批量插入到 PostgreSQL。
   */
  async migrateFromSqlite(sqliteDb: {
    query: (sql: string) => Promise<unknown[]> | unknown[];
  }): Promise<{ migratedTasks: number; migratedAuditEvents: number; migratedJobs: number }> {
    const client = await this.getClient();
    try {
      // 迁移 tasks
      const tasks = (await sqliteDb.query("SELECT * FROM tasks")) as Array<Record<string, unknown>>;
      for (const task of tasks) {
        await this.executeQuery(
          client,
          `INSERT INTO tasks (id, project_id, title, objective, status, risk_level, agent_id, base_branch, target_branch, allowed_paths, forbidden_paths, required_checks, created_at, updated_at, created_by, data)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
           ON CONFLICT (id) DO NOTHING`,
          [
            task.id,
            task.project_id,
            task.title,
            task.objective,
            task.status,
            task.risk_level,
            task.agent_id,
            task.base_branch,
            task.target_branch,
            task.allowed_paths,
            task.forbidden_paths,
            task.required_checks,
            task.created_at,
            task.updated_at,
            task.created_by,
            task.data,
          ],
        );
      }

      // 迁移 audit_events
      const auditEvents = (await sqliteDb.query("SELECT * FROM audit_events")) as Array<
        Record<string, unknown>
      >;
      for (const event of auditEvents) {
        await this.executeQuery(
          client,
          `INSERT INTO audit_events (id, task_id, event_type, actor, actor_type, project_id, payload, timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO NOTHING`,
          [
            event.id,
            event.task_id,
            event.event_type,
            event.actor,
            event.actor_type,
            event.project_id,
            event.payload,
            event.timestamp,
          ],
        );
      }

      // 迁移 workflow_jobs
      const jobs = (await sqliteDb.query("SELECT * FROM workflow_jobs")) as Array<
        Record<string, unknown>
      >;
      for (const job of jobs) {
        await this.executeQuery(
          client,
          `INSERT INTO workflow_jobs (id, project_id, task_id, job_type, status, payload, result, error, created_at, started_at, completed_at, retry_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (id) DO NOTHING`,
          [
            job.id,
            job.project_id,
            job.task_id,
            job.job_type,
            job.status,
            job.payload,
            job.result,
            job.error,
            job.created_at,
            job.started_at,
            job.completed_at,
            job.retry_count,
          ],
        );
      }

      return {
        migratedTasks: tasks.length,
        migratedAuditEvents: auditEvents.length,
        migratedJobs: jobs.length,
      };
    } finally {
      this.releaseClient(client);
    }
  }

  /**
   * 执行原始查询（供其他 EE 模块使用）
   */
  async query(text: string, params?: unknown[]): Promise<unknown[]> {
    const client = await this.getClient();
    try {
      return (await this.executeQuery(client, text, params)) as unknown[];
    } finally {
      this.releaseClient(client);
    }
  }

  /**
   * 是否已连接
   */
  isConnected(): boolean {
    return this.connected;
  }
}
