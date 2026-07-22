# 数据模型设计（Data Model）

> 项目：agentgitops
> 版本：v0.1（设计阶段）
> 关联文档：[`architecture.md`](./architecture.md)、[`task-lifecycle.md`](./task-lifecycle.md)、[`change-package.md`](./change-package.md)

本文档定义 agentgitops 的核心数据模型。所有模型以 TypeScript 类型表达，对应 SQLite（local）与 PostgreSQL（server）的表结构。

---

## 1. 模型总览

```
Project
  └─ Agent (registered agents)
  └─ TaskContract ──→ Workspace ──→ AgentSession
                          │
                          └─→ ChangePackage ──→ VerificationRun[]
                          │
                          └─→ Review[]
                          │
                          └─→ MergeRecord
  └─ AuditEvent (全局)
  └─ Policy (项目级策略)
```

| 模型 | 说明 | 存储位置 |
| --- | --- | --- |
| Project | 项目 | SQLite / Postgres |
| Agent | 已注册的 Code Agent | SQLite / Postgres |
| TaskContract | 任务合同 | SQLite / Postgres + YAML 文件 |
| Workspace | 任务工作区 | SQLite / Postgres |
| AgentSession | Agent 执行会话 | SQLite / Postgres |
| ChangePackage | 变更包 | SQLite / Postgres + JSON 文件 |
| VerificationRun | 验证执行记录 | SQLite / Postgres |
| Review | 人工评审记录 | SQLite / Postgres |
| MergeRecord | 合并记录 | SQLite / Postgres |
| AuditEvent | 审计事件 | SQLite / Postgres |
| Policy | 策略配置 | YAML 文件 + DB 缓存 |

---

## 2. Project

项目是 agentgitops 管理的顶层对象。

```ts
type Project = {
  id: string;              // 项目唯一 ID，如 "proj_demo-web"
  name: string;            // 项目名称
  rootPath: string;        // 项目根目录绝对路径
  repoUrl: string;         // Git 仓库地址
  defaultBranch: string;   // 默认分支，如 "main"
  gitProvider?: "github" | "gitlab" | "gitea" | "local";
  worktreeRoot?: string;   // worktree 根目录（默认 ../.agentgitops-worktrees）
  createdAt: string;       // ISO 8601 时间戳
  updatedAt: string;
};
```

**表结构（SQL 概要）**：

```sql
CREATE TABLE projects (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  root_path     TEXT NOT NULL,
  repo_url      TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  git_provider  TEXT,
  worktree_root TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
```

---

## 3. Agent

已注册的 Code Agent 配置。

```ts
type Agent = {
  id: string;
  name: string;            // 如 "claude-code"
  type: "generic-cli" | "codex" | "claude-code" | "opencode" | "cursor" | "cline" | "custom";
  command: string;         // 可执行命令，如 "claude"
  args?: string[];         // 命令参数模板
  env?: Record<string, string>;  // 环境变量
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};
```

**表结构**：

```sql
CREATE TABLE agents (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  type       TEXT NOT NULL,
  command    TEXT NOT NULL,
  args       TEXT,        -- JSON array
  env        TEXT,        -- JSON object
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

---

## 4. TaskContract

任务合同是 agentgitops 的核心对象，定义每个 Agent 任务的契约。

```ts
type TaskContract = {
  id: string;
  projectId: string;
  title: string;
  objective: string;       // 任务目标
  background?: string;     // 任务背景

  baseBranch: string;      // 基线分支
  targetBranch: string;    // 目标分支，如 "agent/task-001/claude-code"
  agentId: string;         // 执行 Agent ID

  allowedPaths: string[];      // 允许修改的路径（glob）
  forbiddenPaths: string[];    // 禁止修改的路径（glob）
  requiredChecks: string[];    // 必跑检查命令

  riskLevel: "low" | "medium" | "high" | "critical";
  riskDomains?: string[];      // 风险域，如 ["auth", "api"]

  approval: {
    required: boolean;
    reviewers?: string[];      // 如 ["@auth-owner"]
  };

  merge: {
    strategy: "auto" | "manual";  // 合并策略
    squash?: boolean;
  };

  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
};

type TaskStatus =
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
```

**表结构**：

```sql
CREATE TABLE tasks (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id),
  title          TEXT NOT NULL,
  objective      TEXT NOT NULL,
  background     TEXT,
  base_branch    TEXT NOT NULL,
  target_branch  TEXT NOT NULL,
  agent_id       TEXT NOT NULL REFERENCES agents(id),
  allowed_paths  TEXT,       -- JSON array
  forbidden_paths TEXT,      -- JSON array
  required_checks TEXT,      -- JSON array
  risk_level     TEXT NOT NULL,
  risk_domains   TEXT,       -- JSON array
  approval_required INTEGER NOT NULL DEFAULT 1,
  approval_reviewers TEXT,   -- JSON array
  merge_strategy TEXT NOT NULL DEFAULT 'manual',
  merge_squash   INTEGER,
  status         TEXT NOT NULL DEFAULT 'created',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_agent ON tasks(agent_id);
```

> Task Contract 同时以 YAML 文件形式存储在 `.agentgitops/tasks/{task_id}.yml`，便于版本管理与人类阅读。

---

## 5. Workspace

任务工作区，对应一个 `git worktree`。

```ts
type Workspace = {
  id: string;
  taskId: string;
  projectId: string;
  path: string;            // worktree 绝对路径
  branch: string;          // agent 分支
  baseBranch: string;      // 基线分支
  status: "created" | "dirty" | "clean" | "archived" | "removed";
  createdAt: string;
  updatedAt: string;
};
```

**表结构**：

```sql
CREATE TABLE workspaces (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  project_id  TEXT NOT NULL REFERENCES projects(id),
  path        TEXT NOT NULL,
  branch      TEXT NOT NULL,
  base_branch TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'created',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_workspaces_task ON workspaces(task_id);
```

---

## 6. AgentSession

Agent 执行会话，记录一次 Agent 运行。

```ts
type AgentSession = {
  id: string;
  taskId: string;
  agentId: string;
  workspaceId: string;
  command: string;         // 实际执行的完整命令
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  status: "running" | "completed" | "failed" | "canceled";
  logPath?: string;        // 日志文件路径
};
```

**表结构**：

```sql
CREATE TABLE agent_sessions (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id),
  agent_id     TEXT NOT NULL REFERENCES agents(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  command      TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  ended_at     TEXT,
  exit_code    INTEGER,
  status       TEXT NOT NULL DEFAULT 'running',
  log_path     TEXT
);

CREATE INDEX idx_sessions_task ON agent_sessions(task_id);
```

---

## 7. ChangePackage

变更包，每次 Agent 交付的标准证据包。详见 [`change-package.md`](./change-package.md)。

```ts
type ChangePackage = {
  id: string;
  taskId: string;
  projectId: string;
  summary: string;             // 变更摘要
  changedFiles: string[];      // 修改文件列表
  insertions: number;          // 新增行数
  deletions: number;           // 删除行数
  checks: VerificationRun[];   // 验证执行记录
  risk: RiskAssessment;        // 风险评估
  unverifiedItems: string[];   // 未验证项
  mergeRecommendation: string; // 合并建议
  prUrl?: string;              // PR / MR 链接
  createdAt: string;
};

type RiskAssessment = {
  level: "low" | "medium" | "high" | "critical";
  domains: string[];
  highRiskFilesTouched: boolean;
  forbiddenFilesTouched: boolean;
};
```

**表结构**：

```sql
CREATE TABLE change_packages (
  id                  TEXT PRIMARY KEY,
  task_id             TEXT NOT NULL REFERENCES tasks(id),
  project_id          TEXT NOT NULL REFERENCES projects(id),
  summary             TEXT NOT NULL,
  changed_files       TEXT NOT NULL,   -- JSON array
  insertions          INTEGER NOT NULL DEFAULT 0,
  deletions           INTEGER NOT NULL DEFAULT 0,
  risk_level          TEXT NOT NULL,
  risk_domains        TEXT,            -- JSON array
  high_risk_touched   INTEGER NOT NULL DEFAULT 0,
  forbidden_touched   INTEGER NOT NULL DEFAULT 0,
  unverified_items    TEXT,            -- JSON array
  merge_recommendation TEXT,
  pr_url              TEXT,
  created_at          TEXT NOT NULL
);

CREATE INDEX idx_packages_task ON change_packages(task_id);
```

> Change Package 同时以 JSON 文件存储在 `.agentgitops/packages/{task_id}.json`。

---

## 8. VerificationRun

验证执行记录，记录每次检查命令的执行结果。

```ts
type VerificationRun = {
  id: string;
  taskId: string;
  name: string;            // 检查名称，如 "lint"、"unit-test"
  command: string;         // 执行命令
  status: "passed" | "failed" | "skipped";
  durationMs?: number;     // 执行时长
  outputPath?: string;     // 输出日志路径
  startedAt: string;
  endedAt?: string;
};
```

**表结构**：

```sql
CREATE TABLE verification_runs (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  name        TEXT NOT NULL,
  command     TEXT NOT NULL,
  status      TEXT NOT NULL,
  duration_ms INTEGER,
  output_path TEXT,
  started_at  TEXT NOT NULL,
  ended_at    TEXT
);

CREATE INDEX idx_verification_task ON verification_runs(task_id);
```

---

## 9. Review

人工评审记录。

```ts
type Review = {
  id: string;
  changePackageId: string;
  reviewerId: string;      // 评审人
  action: "approve" | "reject" | "request_changes" | "ask_agent_to_fix" | "escalate" | "mark_high_risk" | "add_required_check";
  comment?: string;
  createdAt: string;
};
```

**表结构**：

```sql
CREATE TABLE reviews (
  id                 TEXT PRIMARY KEY,
  change_package_id  TEXT NOT NULL REFERENCES change_packages(id),
  reviewer_id        TEXT NOT NULL,
  action             TEXT NOT NULL,
  comment            TEXT,
  created_at         TEXT NOT NULL
);

CREATE INDEX idx_reviews_package ON reviews(change_package_id);
```

---

## 10. MergeRecord

合并记录，记录变更合并到主干的过程。

```ts
type MergeRecord = {
  id: string;
  changePackageId: string;
  taskId: string;
  mergeStrategy: "auto" | "manual";
  squash: boolean;
  mergedBy: string;        // 合并执行者（human / system）
  mergedAt: string;
  commitSha?: string;      // 合并后的 commit SHA
  reverted?: boolean;      // 是否已回滚
  revertedAt?: string;
};
```

**表结构**：

```sql
CREATE TABLE merge_records (
  id                 TEXT PRIMARY KEY,
  change_package_id  TEXT NOT NULL REFERENCES change_packages(id),
  task_id            TEXT NOT NULL REFERENCES tasks(id),
  merge_strategy     TEXT NOT NULL,
  squash             INTEGER NOT NULL DEFAULT 0,
  merged_by          TEXT NOT NULL,
  merged_at          TEXT NOT NULL,
  commit_sha         TEXT,
  reverted           INTEGER NOT NULL DEFAULT 0,
  reverted_at        TEXT
);
```

---

## 11. AuditEvent

审计事件，记录所有关键操作，支持回放。

```ts
type AuditEvent = {
  id: string;
  projectId: string;
  taskId?: string;
  actorType: "human" | "agent" | "system";
  actorId: string;         // 如 "user:alice"、"agent:claude-code"、"system"
  eventType: string;       // 如 "task.created"、"agent.started"、"merge.completed"
  payload: unknown;        // 事件详情（JSON）
  createdAt: string;
};
```

**事件类型枚举**：

```ts
type AuditEventType =
  | "project.created"
  | "project.updated"
  | "agent.registered"
  | "agent.updated"
  | "task.created"
  | "task.started"
  | "task.canceled"
  | "workspace.created"
  | "workspace.removed"
  | "agent.session.started"
  | "agent.session.completed"
  | "agent.session.failed"
  | "verification.run.started"
  | "verification.run.completed"
  | "change_package.generated"
  | "policy.violation"
  | "conflict.detected"
  | "review.submitted"
  | "merge.queued"
  | "merge.completed"
  | "merge.reverted"
  | "pr.created"
  | "pr.updated";
```

**表结构**：

```sql
CREATE TABLE audit_events (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  task_id     TEXT,
  actor_type  TEXT NOT NULL,
  actor_id    TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  payload     TEXT,        -- JSON
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_audit_project ON audit_events(project_id);
CREATE INDEX idx_audit_task ON audit_events(task_id);
CREATE INDEX idx_audit_type ON audit_events(event_type);
CREATE INDEX idx_audit_time ON audit_events(created_at);
```

> Enterprise 版本审计日志需写入不可篡改的合规存储（append-only / WORM）。

---

## 12. Policy

策略配置，主要存储在 `.agentgitops.yml`，DB 中可缓存以加速查询。详见 [`policy.md`](./policy.md)。

```ts
type Policy = {
  projectId: string;
  branch: {
    protected: string[];          // 保护分支
    denyDirectPush: string[];     // 禁止直接 push 的分支
  };
  paths: {
    highRisk: string[];           // 高风险路径
    forbiddenForAgents: string[]; // Agent 禁止修改的路径
  };
  approval: {
    highRiskPathsRequireReview: boolean;
    requiredReviewers: Record<string, string[]>;  // 路径 → reviewers
  };
  checks: {
    required: { name: string; command: string }[];
  };
  merge: {
    allowAutoMergeForLowRisk: boolean;
    blockMergeIfUnverifiedItemsExist: boolean;
  };
};
```

---

## 13. 实体关系图（ER 概要）

```
Project 1───* Agent
Project 1───* TaskContract
TaskContract 1───1 Workspace
TaskContract 1───* AgentSession
TaskContract 1───1 ChangePackage
ChangePackage 1───* VerificationRun
ChangePackage 1───* Review
ChangePackage 1───1 MergeRecord
Project 1───* AuditEvent
TaskContract 1───* AuditEvent
```

---

## 14. Team Sync 模型

| 类型 | 位置 | 说明 |
| --- | --- | --- |
| `TeamProject` | `packages/core/src/models/team-sync.ts` | 团队项目、repo、relay、同步模式和安全设置 |
| `TeamMember` | `packages/core/src/models/team-sync.ts` | 团队成员、角色、本地 Hub 归属和在线状态 |
| `LocalHubRegistration` | `packages/core/src/models/team-sync.ts` | 本机 Local Hub 在团队内的注册记录 |
| `SyncEvent` | `packages/core/src/models/team-sync.ts` | 本地待推送/已应用的幂等同步事件 |
| `SyncCursor` | `packages/core/src/models/team-sync.ts` | push / pull 两个方向的同步游标 |
| `SyncedTask` | `packages/core/src/models/team-sync.ts` | 可同步任务摘要，不包含源码、完整 diff 或原始 Prompt |
| `SyncedChangePackage` | `packages/core/src/models/team-sync.ts` | 可同步 Change Package 摘要 |
| `SyncedReviewContext` | `packages/core/src/models/team-sync.ts` | 可同步评审上下文摘要 |
| `SyncedAgentNote` | `packages/core/src/models/team-sync.ts` | 可同步 Agent 交接笔记摘要 |
| `AgentContextFeed` | `packages/core/src/models/team-sync.ts` | 面向 Code Agent 的团队上下文输入包 |
| `HandoffPackage` | `packages/core/src/models/team-sync.ts` | 分支接手/继续开发交接包 |
| `BranchAdoption` | `packages/core/src/models/team-sync.ts` | 多人接手同一任务或分支的状态记录 |
| `ConflictGraphEdge` | `packages/core/src/models/team-sync.ts` | 团队任务之间的冲突信号边 |
| `TeamSyncPullRequestContext` | `packages/core/src/models/team-sync.ts` | 供 PR/MR `team-sync` body 模板消费的展示上下文 |
| `TeamSyncControlPlaneState` | `packages/core/src/models/team-sync.ts` | 标记 Team Control Plane 状态：`enabled` / `disabled` / `unknown` |

本地存储已由 `packages/local-hub/src/team-sync-store.ts` 落地，SQLite 表包括：

```text
team_projects
team_members
local_hub_registrations
sync_cursors
sync_events
synced_tasks
synced_change_packages
synced_review_contexts
synced_agent_notes
handoff_packages
branch_adoptions
conflict_graph_edges
```

设计边界：

- `packages/core` 只放稳定模型与契约。
- `packages/local-hub` 负责本地持久化、pending queue、Context Feed 脱敏。
- Relay 只存元数据信号，不存源码、完整 diff、原始日志或 Prompt。
- `team_secret` 不存原文，只允许存 hash 或配置引用；CLI 状态输出不打印 hash 和机器指纹。

---

## 15. ID 生成规则

| 实体 | ID 格式 | 示例 |
| --- | --- | --- |
| Project | `proj_{slug}` | `proj_demo-web` |
| Agent | `agent_{name}` | `agent_claude-code` |
| Task | `task-{YYYYMMDD}-{seq}` | `task-20260703-001` |
| Workspace | `ws_{taskId}` | `ws_task-20260703-001` |
| AgentSession | `sess_{uuid}` | `sess_a1b2c3d4` |
| ChangePackage | `pkg_{taskId}` | `pkg_task-20260703-001` |
| VerificationRun | `verify_{uuid}` | `verify_e5f6g7h8` |
| Review | `review_{uuid}` | `review_i9j0k1l2` |
| MergeRecord | `merge_{uuid}` | `merge_m3n4o5p6` |
| AuditEvent | `audit_{uuid}` | `audit_q7r8s9t0` |
| SyncEvent | `sync_{uuid}` | `sync_a1b2c3d4` |
| SyncCursor | `cursor_{timestamp}_{seq}` | `cursor_20260709T130000Z_0001` |
| HandoffPackage | `handoff_{taskId}_{uuid}` | `handoff_task-20260709-001_a1b2` |

---

## 16. 存储策略

| 数据 | Local-first | Team / Enterprise |
| --- | --- | --- |
| Project / Agent / Task | SQLite | PostgreSQL |
| Workspace 元数据 | SQLite | PostgreSQL |
| AgentSession 日志 | 文件（`.agentgitops/logs/`） | 文件 + DB 索引 |
| ChangePackage | JSON 文件 + SQLite | PostgreSQL + 对象存储 |
| VerificationRun 输出 | 文件 | 文件 + DB 索引 |
| AuditEvent | SQLite | PostgreSQL（合规存储） |
| Policy | YAML 文件 | YAML + DB 缓存 |
| Team Sync cache | SQLite（Phase 7） | Relay SQLite / PostgreSQL |
| SyncEvent | SQLite pending queue（Phase 7） | Relay event log |

---

## 17. 相关文档

| 文档 | 说明 |
| --- | --- |
| [`task-lifecycle.md`](./task-lifecycle.md) | 任务生命周期与状态机 |
| [`change-package.md`](./change-package.md) | Change Package 规范 |
| [`policy.md`](./policy.md) | 策略引擎 |
| [`api-reference.md`](./api-reference.md) | API 参考 |
| [`security.md`](./security.md) | 安全设计 |
| [`git-native-sync.md`](./git-native-sync.md) | Git-native Team Sync 设计 |
| [`relay-deployment.md`](./relay-deployment.md) | Relay 部署说明 |
