# 技术架构文档（Technical Architecture）

> 项目：agentgitops
> 版本：v0.1（设计阶段）
> 关联文档：[`product-design.md`](./product-design.md)、[`data-model.md`](./data-model.md)

---

## 1. 架构总览

### 1.1 三层运行形态

agentgitops 采用 Hybrid 架构：

```
┌──────────────────────────────────────────────┐
│            Web UI / Review Console            │
│  人类监控、审核、冲突处理、合并授权、审计回放   │
└───────────────────┬──────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│       agentgitops Control Plane / Server      │
│  任务、策略、评审、冲突、合并、审计、指标       │
└───────────────────┬──────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│          agentgitops Local Hub / CLI          │
│  worktree、Agent Adapter、文件采集、测试、Diff  │
└───────────────────┬──────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│       Codex / Claude Code / OpenCode / etc.   │
│           真实代码修改与命令执行              │
└───────────────────┬──────────────────────────┘
                    ↓
┌──────────────────────────────────────────────┐
│       GitHub / GitLab / Gitea / Gerrit        │
│        Repo、Branch、Commit、PR/MR、CI         │
└──────────────────────────────────────────────┘
```

### 1.2 分层职责

| 层级 | 职责 | 部署形态 |
| --- | --- | --- |
| Web UI / Review Console | 人类可视化治理：监控、审核、冲突处理、合并授权、审计回放 | Local Web / Team Web |
| Control Plane / Server | 任务调度、策略执行、评审管理、冲突仲裁、合并门禁、审计、指标 | 单机内嵌 / 独立服务 |
| Local Hub / CLI | worktree 管理、Agent Adapter 调用、文件采集、测试运行、Diff 生成、Change Package 生成、本地存储 | 本地常驻进程 / CLI |
| Code Agent | 理解任务、修改代码、运行命令、生成 PR | 外部进程 |
| Git Platform | Repo、Branch、Commit、PR/MR、CI、Webhook | 外部 SaaS / 自建 |

### 1.3 数据流

```
人类创建 Task Contract
  → Local Hub 创建 worktree + agent 分支
  → Agent Adapter 启动 Agent（限定 workspace）
  → Agent 修改代码、运行命令
  → Local Hub 采集 diff、命令日志、测试结果
  → 生成 Change Package
  → Policy Engine 评估风险
  → Verification Gate 校验
  → Conflict Engine 检测冲突
  → Review Board 展示证据
  → 人类 Approve / Agent Fix
  → Merge Gate 排队合并
  → Git Platform 执行合并
  → Audit Event 记录
  → AgentOps 指标更新
```

---

## 2. 部署形态

### 2.1 Local-first 单机版

适合个人开发者和开源项目维护者。

```
agentgitops CLI
+ Local Hub（CLI 内嵌或本地 daemon）
+ SQLite
+ Local Web UI（内嵌或独立进程）
+ GitHub/GitLab Token（本地存储）
```

特点：
- 零外部依赖，单机即可运行
- Local Hub 与 CLI 同进程，或作为本地 daemon
- Web UI 内嵌在 Local Hub 中，默认端口 4789
- 数据存储在项目 `.agentgitops/db.sqlite`

能力：本地多 Agent 任务管理、本地 worktree 隔离、本地任务看板、本地 Change Package、本地 PR 创建。

### 2.2 Team Hybrid 团队版

适合 3—30 人研发团队。

```
Local Hub（每台开发机）
+ Team Control Plane（中心服务）
+ Postgres
+ Web Review Board（中心 Web）
+ GitHub / GitLab Webhook
+ Merge Gate（中心服务）
```

特点：
- Local Hub 负责本地 worktree 与 Agent 执行
- Control Plane 负责团队共享状态、策略、审计
- Local Hub 与 Control Plane 通过 sync 机制同步
- Webhook 接收 Git 平台事件，驱动状态更新

能力：团队共享项目看板、统一 Agent 任务登记、统一策略、统一 Review Board、统一 Merge Queue、统一审计。

#### Team Sync MVP 边界

Team Sync 采用“代码走 Git、信号走同步层”的 Hybrid 设计。TS 开发时按以下模块边界落地：

| 模块 | 职责 |
| --- | --- |
| `packages/core` | Team Sync 领域模型与稳定契约，例如 `TeamSyncPullRequestContext`、后续 `SyncEvent`、`SyncCursor`、`SyncedTask` |
| `packages/local-hub` | 本地 Team Sync Store、pending event queue、Context Feed Builder、隐私过滤、Handoff Package |
| `packages/git` | Git provider 和 PR/MR body formatter；只消费 Team Sync presentation context，不生成同步事实 |
| `apps/server/src/routes/team-routes.ts` | `/api/team/*` 路由匹配 |
| `apps/server/src/routes/sync-routes.ts` | `/api/sync/*` 路由匹配 |
| `apps/server/src/services/team-sync-service.ts` | Team Sync Relay 服务入口；处理 HMAC 校验、push/pull cursor、幂等事件写入和 Relay cache 应用 |

当前 `/api/team/status`、`/api/team/tasks`、`/api/team/conflicts`、`/api/sync/push`、`/api/sync/pull` 已具备轻量 Relay 能力：代码仍走 Git，团队协作信号通过 signed SyncEvent + cursor 同步，Relay 层显式过滤 diff、Prompt、token、secret、原始日志等敏感字段。

### 2.3 Enterprise 私有化版

适合企业内部研发体系。

```
Private Control Plane（高可用集群）
+ 多项目 / 多团队 / 多仓库
+ SSO / RBAC
+ 审计留存（合规存储）
+ Policy Engine（中心策略）
+ 高可用部署（多副本 + 负载均衡）
+ GitHub Enterprise / GitLab Self-managed / Gitea 集成
```

特点：
- 多租户 / 多项目隔离
- 企业 SSO 集成（OIDC / SAML）
- 审计日志合规留存（不可篡改）
- 中心化策略管理与下发
- 高可用、可横向扩展

---

## 3. 核心模块设计

### 3.1 agentgitops CLI

CLI 是项目第一入口，也是 Agent 自动化注册和管理的核心工具。

职责：
- 项目初始化（`init`）
- 环境诊断（`doctor`）
- 项目 / Agent / Task / Workspace 管理
- 启动 Agent 执行（`run`）
- 采集 diff / 运行测试 / 生成 Change Package
- 创建 PR
- 启动本地 Web UI
- 与 Control Plane 同步

详见 [`cli-reference.md`](./cli-reference.md)。

### 3.2 Local Hub

Local Hub 是本地常驻进程或 CLI 管理器，是 agentgitops 的 MVP 核心。

```
Local Hub
├─ 项目初始化
├─ 本地配置读取（.agentgitops.yml）
├─ worktree 创建与清理
├─ Agent Adapter 调用
├─ 文件变更监听
├─ 命令执行记录
├─ 测试运行
├─ Diff 生成
├─ Change Package 生成
├─ 本地 SQLite 存储
└─ 与 Control Plane 同步
```

### 3.3 Agent Adapter

不同 Code Agent 的启动方式不同，所以需要 Adapter 层。

```
Agent Adapter
├─ generic-cli      # 通用 CLI，通过命令模板兼容任意 Agent
├─ codex            # Codex 专用
├─ claude-code      # Claude Code 专用
├─ opencode         # OpenCode 专用
├─ cursor           # Cursor 专用
├─ cline            # Cline 专用
└─ custom           # 自定义
```

MVP 阶段优先实现 `generic-cli` Adapter。详见 [`adapters.md`](./adapters.md)。

Adapter 职责：

```
启动 Agent
注入任务合同（Task Contract → prompt file）
限定工作目录（chdir 到 workspace）
记录 stdout / stderr
采集退出码
采集 Agent 过程日志
触发测试
生成最终变更
```

### 3.4 Task Contract

Task Contract 是 agentgitops 的核心对象，定义每个 Agent 任务的契约。详见 [`change-package.md`](./change-package.md) 与 [`data-model.md`](./data-model.md)。

### 3.5 Workspace Manager

Workspace Manager 负责把每个任务变成独立工作区。

```
Workspace Manager
├─ 基于 base_branch 创建 agent 分支
├─ 基于 agent 分支创建 git worktree
├─ 初始化任务提示文件
├─ 注入项目上下文
├─ 注入 Skill Pack
├─ 限制工作目录
├─ 记录 workspace metadata
└─ 任务完成后归档 / 清理
```

推荐目录结构：

```
project-root/
├─ .agentgitops/
│  ├─ config.yml
│  ├─ tasks/
│  │  └─ task-20260703-001.yml
│  ├─ agents/
│  ├─ packages/
│  ├─ logs/
│  └─ db.sqlite
│
../.agentgitops-worktrees/
├─ demo-web-task-001-claude-code/
├─ demo-web-task-002-codex/
└─ demo-web-task-003-opencode/
```

> worktree 默认放在项目同级目录的 `.agentgitops-worktrees/` 下，避免污染项目目录，也避免被项目 `.gitignore` 误伤。

### 3.6 Change Package Generator

采集 git diff、测试结果、风险文件，生成标准 `change-package.json`。详见 [`change-package.md`](./change-package.md)。

### 3.7 Review Board

Review Board 是 Web UI 的核心页面，是 Agent 变更证据中心。详见 [`product-design.md`](./product-design.md) 第 8 节。

### 3.8 Policy Engine

Policy Engine 负责硬约束。详见 [`policy.md`](./policy.md)。

### 3.9 Verification Gate

Verification Gate 负责验证 Agent 变更是否满足进入 Review / Merge 的条件。

MVP 阶段支持：

```
必跑命令检查
退出码检查
测试日志采集
Lint 检查
变更范围检查
高风险文件检查
PR 描述完整性检查
```

后续增强：

```
SAST
Secret Scan
Dependency Scan
License Scan
API Contract Test
性能回归
测试覆盖率比较
```

### 3.10 Conflict Engine

Conflict Engine 分两阶段建设。

#### 阶段一：轻量冲突检测

```
同文件修改检测
同目录风险域检测
package.json / lock 文件冲突
migration 文件冲突
CI 配置冲突
高风险路径并发修改
```

#### 阶段二：语义冲突检测

```
API 契约冲突
类型定义冲突
数据库 Schema 冲突
调用链影响冲突
测试覆盖冲突
权限逻辑冲突
依赖版本冲突
```

> 多智能体不应停留在"多个 Agent 群聊"，而应围绕任务拆解、独立工作区、产物汇聚、冲突仲裁、人工评审形成工程化协作。agentgitops 把这一原则落到 Code Agent 的研发协作场景中。

### 3.11 Merge Queue / Merge Gate

Merge Gate 决定一个 Agent 变更能不能进入主干。

合并策略：

| 风险等级 | 策略 |
| --- | --- |
| Low | 测试通过后允许自动合并或快速审批 |
| Medium | 必须至少一个 Owner Review |
| High | 必须指定 Reviewer 审批，禁止自动合并 |
| Critical | 不允许 Agent 直接提交代码，只允许生成建议 |

合并流程：

```
Change Package 生成
→ Verification Gate
→ Conflict Engine
→ Review Board
→ Human Approval
→ Merge Queue
→ Git Platform Merge
→ Audit Event
```

### 3.12 AgentOps Dashboard

AgentOps 用于长期运营治理。指标体系详见 [`product-design.md`](./product-design.md) 第 9 节。

### 3.13 Skill Pack

Skill 不是硬约束系统，但作为 Agent 执行经验资产。详见 [`product-design.md`](./product-design.md) 第 10 节。

---

## 4. 技术架构选型

### 4.1 推荐技术路线：TypeScript-first Monorepo

MVP 阶段优先使用 TypeScript 全栈，原因：

1. AI Coding 友好，Codex / Claude Code / OpenCode 对 TS 项目生成能力较强。
2. CLI、Server、Web、SDK 可以统一语言。
3. 社区生态成熟，适合快速做开源项目。
4. 后续可将高性能 Local Daemon 或 Git Engine 拆成 Go / Rust。

| 层 | 选型 |
| --- | --- |
| 语言 | TypeScript |
| 包管理 | pnpm |
| Monorepo | Turborepo / pnpm workspace |
| CLI | commander / cac |
| Server | Fastify / Hono / NestJS |
| Web | Vite + React 或 Next.js |
| UI | shadcn/ui + Tailwind CSS |
| DB | SQLite（local）+ PostgreSQL（server） |
| ORM | Drizzle 或 Prisma |
| Git 操作 | 优先 shell git，封装 GitService |
| 队列 | BullMQ / PQueue / 内置轻量任务队列 |
| 日志 | pino |
| API | REST first，后续 OpenAPI |
| 实时通信 | WebSocket / Server-Sent Events |
| 测试 | Vitest + Playwright |
| 打包 | tsup |

### 4.2 为什么 Git 操作优先调用系统 Git

不建议 MVP 阶段完全依赖 JS Git 实现（如 isomorphic-git）。

原因：

```
系统 Git 行为最可靠
worktree / merge / rebase / diff 等能力成熟
与开发者本地环境一致
便于排查问题
```

封装方式（`GitService`）：

```
GitService
├─ clone
├─ fetch
├─ checkout
├─ branch
├─ worktreeAdd
├─ worktreeList
├─ worktreeRemove
├─ status
├─ diff
├─ commit
├─ push
└─ createPatch
```

### 4.3 后续可演进为 Go Local Daemon

当 Local Hub 需要更强跨平台稳定性时，可以把本地 daemon 用 Go 重写。

Go 适合：

```
长期后台进程
文件系统 watcher
命令执行控制
跨平台二进制分发
低资源占用
```

但 MVP 不必一开始用 Go，否则会增加 AI Coding 跨语言复杂度。

---

## 5. 仓库结构

```
agentgitops/
├─ README.md
├─ LICENSE
├─ package.json
├─ pnpm-workspace.yaml
├─ turbo.json
├─ tsconfig.base.json
│
├─ apps/
│  ├─ cli/
│  │  ├─ src/
│  │  └─ package.json
│  │
│  ├─ server/
│  │  ├─ src/
│  │  └─ package.json
│  │
│  └─ web/
│     ├─ src/
│     └─ package.json
│
├─ packages/
│  ├─ core/
│  │  ├─ src/
│  │  │  ├─ models/
│  │  │  ├─ schemas/
│  │  │  ├─ events/
│  │  │  └─ constants/
│  │  └─ package.json
│  │
│  ├─ git/
│  │  ├─ src/
│  │  │  ├─ git-service.ts
│  │  │  ├─ worktree-service.ts
│  │  │  └─ diff-service.ts
│  │  └─ package.json
│  │
│  ├─ local-hub/
│  │  ├─ src/
│  │  │  ├─ workspace-manager.ts
│  │  │  ├─ trace-collector.ts
│  │  │  ├─ change-package-generator.ts
│  │  │  └─ local-db.ts
│  │  └─ package.json
│  │
│  ├─ adapters/
│  │  ├─ src/
│  │  │  ├─ generic-cli-adapter.ts
│  │  │  ├─ claude-code-adapter.ts
│  │  │  ├─ codex-adapter.ts
│  │  │  └─ opencode-adapter.ts
│  │  └─ package.json
│  │
│  ├─ policy/
│  │  ├─ src/
│  │  │  ├─ policy-engine.ts
│  │  │  ├─ path-risk.ts
│  │  │  └─ approval-rules.ts
│  │  └─ package.json
│  │
│  ├─ verification/
│  │  ├─ src/
│  │  │  ├─ check-runner.ts
│  │  │  ├─ test-parser.ts
│  │  │  └─ verification-gate.ts
│  │  └─ package.json
│  │
│  ├─ providers/
│  │  ├─ github/
│  │  ├─ gitlab/
│  │  └─ gitea/
│  │
│  └─ ui/
│     └─ src/
│
├─ docs/
│  ├─ product-design.md
│  ├─ architecture.md
│  ├─ data-model.md
│  ├─ task-lifecycle.md
│  ├─ api-reference.md
│  ├─ cli-reference.md
│  ├─ configuration.md
│  ├─ adapters.md
│  ├─ policy.md
│  ├─ change-package.md
│  ├─ git-provider-integration.md
│  ├─ security.md
│  └─ release-checklist.md
│
├─ examples/
│  ├─ node-app/
│  ├─ python-app/
│  └─ monorepo-app/
│
└─ .github/
   ├─ workflows/
   └─ ISSUE_TEMPLATE/
```

### 5.1 包职责说明

| 包 | 职责 |
| --- | --- |
| `apps/cli` | agentgitops CLI 入口，命令解析与路由 |
| `apps/server` | Control Plane 服务，REST API + Webhook + Merge Gate |
| `apps/web` | Review Console Web UI |
| `packages/core` | 核心模型、Schema、事件、常量（无副作用，可被所有包依赖） |
| `packages/git` | GitService 封装，worktree / diff / status |
| `packages/local-hub` | Workspace Manager、Trace Collector、Change Package Generator、本地 DB |
| `packages/adapters` | Agent Adapter 实现 |
| `packages/policy` | Policy Engine、路径风险评估、审批规则 |
| `packages/verification` | Check Runner、测试解析、Verification Gate |
| `packages/providers` | Git 平台 Provider（GitHub / GitLab / Gitea） |
| `packages/ui` | 共享 UI 组件库 |

### 5.2 依赖关系

```
apps/cli ──→ packages/local-hub ──→ packages/git
   │              │                      │
   │              ├──→ packages/adapters
   │              ├──→ packages/policy
   │              ├──→ packages/verification
   │              └──→ packages/core
   │
   ├──→ packages/providers ──→ packages/core
   │
apps/server ──→ packages/core
   │
apps/web ──→ packages/ui ──→ packages/core
```

> `packages/core` 是最底层包，不依赖任何业务包，只定义类型与常量。

### 5.3 扩展接口边界

Open Core 的工程边界不通过 fork 分支实现，而通过 `packages/core/src/extensions.ts` 中的端口接口注入。开源版提供本地实现，企业版或插件包沿接口替换实现，不能反向依赖 `apps/server` 或直接绕过本地治理模型。

| 接口 | 开源版默认实现 | 企业版/插件扩展方向 |
| --- | --- | --- |
| `AuditSink` | SQLite 本地审计事件 | 不可篡改签名链、SIEM/合规导出、长期留存 |
| `PolicyProvider` | `.agentgitops.yml` 本地策略 | 组织级策略继承、OPA/Rego、审批组/RBAC |
| `ConflictDetector` | 单仓库路径/文件/API/schema/CI 冲突检测 | 跨仓库依赖图谱、语义冲突、调用链冲突 |
| `GitReviewProvider` | GitHub.com/GitLab.com PR/MR Provider | GitHub Enterprise、GitLab Self-managed、Gerrit/Azure DevOps |
| `MetricsSink` | SQLite AgentOps 快照 | 时序库、组织级 ROI 看板、BI/数据仓库接入 |

接口设计原则：

1. Core 只定义类型和端口，不持有外部服务客户端。
2. Local Hub 负责本地实现，Server/CLI 只依赖端口能力。
3. 企业模块通过组合和配置注入，不修改开源版数据模型的兼容字段。
4. 所有扩展输出必须能落回 Change Package、Audit Event 或 Metrics Snapshot，保证降级可读。

---

## 6. 关键设计决策

### 6.1 为什么 Local-first

- 降低使用门槛：个人开发者无需部署服务即可使用
- 数据主权：任务、变更、审计数据留在本地
- 离线可用：不依赖中心服务即可管理本地 Agent 任务
- 渐进增强：从单机到团队到企业，平滑升级

### 6.2 为什么用 worktree 而非 clone

- `git worktree` 共享 `.git` 对象库，节省磁盘与网络
- 创建/销毁比 clone 快
- 分支切换天然隔离
- 与 Claude Code 官方建议一致（每 session 独立 worktree）

### 6.3 为什么 REST first

- MVP 阶段简单直接，易于 Agent 调用
- 调试方便（curl / 浏览器）
- 后续可基于 REST 生成 OpenAPI Spec，再派生 SDK

### 6.4 为什么系统 Git 而非 JS Git

- worktree / merge / rebase 行为最可靠
- 与开发者本地环境一致，便于排查
- 避免重复实现 Git 的复杂边界情况

### 6.5 为什么 TypeScript Monorepo

- AI Coding 友好
- CLI / Server / Web / SDK 统一语言
- 社区生态成熟
- 后续可拆分高性能模块到 Go / Rust

---

## 7. 跨平台兼容性

agentgitops 需支持 macOS、Linux、Windows。

关键注意点：

| 关注点 | 策略 |
| --- | --- |
| 路径分隔符 | 统一使用 `path` 模块，避免硬编码 `/` 或 `\` |
| Shell 命令 | Agent 命令模板需兼容不同 Shell；优先使用跨平台二进制 |
| Git 路径 | 支持配置 `git.path`，默认从 PATH 查找 |
| worktree 路径 | 避免使用含空格或特殊字符的路径 |
| 文件权限 | Windows 无 Unix 权限模型，权限相关策略需降级处理 |
| 进程管理 | 使用跨平台进程库（如 `execa`） |

---

## 8. 可观测性

### 8.1 日志

- 使用 `pino` 结构化日志
- 日志级别：`trace` / `debug` / `info` / `warn` / `error` / `fatal`
- Local Hub 日志写入 `.agentgitops/logs/`
- Agent Session 日志按 task_id 分目录存储

### 8.2 指标

- AgentOps 指标（见 [`product-design.md`](./product-design.md) 第 9 节）
- 运行时指标：任务队列长度、worktree 数量、活跃 Agent 数

### 8.3 追踪

- Trace Collector 记录 Agent 执行全过程
- 审计事件链（AuditEvent）支持回放

---

## 9. 扩展点

agentgitops 设计了清晰的扩展点：

| 扩展点 | 机制 | 示例 |
| --- | --- | --- |
| Agent Adapter | 实现 Adapter 接口 | 新增 `aider` adapter |
| Git Provider | 实现 Provider 接口 | 新增 `bitbucket` provider |
| Verification Check | 注册 Check 插件 | 新增 `sonarqube` check |
| Policy Rule | 配置策略 YAML | 新增高风险路径规则 |
| Skill Pack | 添加 Skill YAML | 新增 `java-testing` skill |
| Conflict Detector | 实现 Detector 接口 | 新增 `openapi-contract` detector |

---

## 10. 相关文档

| 文档 | 说明 |
| --- | --- |
| [`product-design.md`](./product-design.md) | 产品设计 |
| [`data-model.md`](./data-model.md) | 数据模型 |
| [`task-lifecycle.md`](./task-lifecycle.md) | 任务生命周期 |
| [`api-reference.md`](./api-reference.md) | API 参考 |
| [`cli-reference.md`](./cli-reference.md) | CLI 参考 |
| [`configuration.md`](./configuration.md) | 配置参考 |
| [`adapters.md`](./adapters.md) | Agent Adapter |
| [`policy.md`](./policy.md) | 策略引擎 |
| [`change-package.md`](./change-package.md) | Change Package |
| [`git-provider-integration.md`](./git-provider-integration.md) | Git 平台集成 |
| [`security.md`](./security.md) | 安全设计 |
| [`release-checklist.md`](./release-checklist.md) | 发布检查清单 |
