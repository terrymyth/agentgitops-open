# 任务生命周期与状态机（Task Lifecycle）

> 项目：agentgitops
> 版本：v0.1（设计阶段）
> 关联文档：[`data-model.md`](./data-model.md)、[`change-package.md`](./change-package.md)

本文档定义 agentgitops 中 Task（任务）的完整生命周期、状态机、状态转移规则，以及每个阶段对应的系统行为。

---

## 1. 任务状态总览

### 1.1 正常流程状态

```
created
  ↓
workspace_created
  ↓
running
  ↓
testing
  ↓
packaging
  ↓
reviewing
  ↓
merged
```

### 1.2 异常 / 终止状态

```
blocked    （检测到冲突或审批不通过，等待处理）
failed     （系统或 Agent 执行失败）
canceled   （人工取消）
```

### 1.3 状态枚举

```ts
type TaskStatus =
  | "created"           // 任务已创建，尚未创建工作区
  | "workspace_created" // 工作区已创建，Agent 尚未启动
  | "running"           // Agent 正在执行
  | "testing"           // Agent 执行完成，正在运行验证检查
  | "packaging"         // 正在生成 Change Package
  | "reviewing"         // 进入 Review Board，等待人类审核
  | "blocked"           // 被阻塞（冲突 / 审批不通过）
  | "merged"            // 已合并到主干（终态）
  | "failed"            // 执行失败（终态）
  | "canceled";         // 已取消（终态）
```

---

## 2. 状态转移图

```
                         ┌──────────┐
                         │ canceled │ (终态)
                         └──────────┘
                              ↑
                              │ (任意状态可取消)
                              │
┌─────────┐    ┌──────────────────┐    ┌─────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌────────┐
│ created │───→│ workspace_created│───→│ running │───→│ testing  │───→│packaging │───→│reviewing │───→│ merged │
└─────────┘    └──────────────────┘    └─────────┘    └──────────┘    └──────────┘    └────┬─────┘    └────────┘
                                          │               │                              │             (终态)
                                          │               │                              │
                                          ↓               ↓                              ↓
                                     ┌────────┐     ┌────────┐                   ┌─────────┐
                                     │ failed │     │ failed │                   │ blocked │
                                     └────────┘     └────────┘                   └────┬────┘
                                       (终态)         (终态)                            │
                                                                          冲突解决/审批通过 │
                                                                                         ↓
                                                                                    回到 reviewing
                                                                                         │
                                                                                         ↓
                                                                                     ┌────────┐
                                                                                     │ merged │
                                                                                     └────────┘
```

---

## 3. 状态转移规则

| 当前状态 | 可转移到 | 触发条件 | 执行者 |
| --- | --- | --- | --- |
| `created` | `workspace_created` | worktree 创建成功 | Local Hub |
| `created` | `failed` | worktree 创建失败 | Local Hub |
| `created` | `canceled` | 人工取消 | Human |
| `workspace_created` | `running` | Agent 启动成功 | Local Hub |
| `workspace_created` | `failed` | Agent 启动失败 | Local Hub |
| `workspace_created` | `canceled` | 人工取消 | Human |
| `running` | `testing` | Agent 执行完成（exit） | Local Hub |
| `running` | `failed` | Agent 异常退出（非 0 退出码且无变更） | Local Hub |
| `running` | `canceled` | 人工取消 | Human |
| `testing` | `packaging` | 所有必跑检查完成 | Verification Gate |
| `testing` | `failed` | 必跑检查失败且无法自动修复 | Verification Gate |
| `testing` | `canceled` | 人工取消 | Human |
| `packaging` | `reviewing` | Change Package 生成成功 | Change Package Generator |
| `packaging` | `failed` | Change Package 生成失败 | Change Package Generator |
| `reviewing` | `merged` | 人类 Approve + Merge Gate 通过 | Human + Merge Gate |
| `reviewing` | `blocked` | 检测到冲突或审批不通过 | Conflict Engine / Human |
| `reviewing` | `running` | Request Changes → Agent 重新执行 | Human → Local Hub |
| `reviewing` | `canceled` | 人工取消 | Human |
| `blocked` | `reviewing` | 冲突解决 / 审批通过 | Human |
| `blocked` | `failed` | 人工标记失败 | Human |
| `blocked` | `canceled` | 人工取消 | Human |
| 任意 | `canceled` | 人工取消（终态除外） | Human |
| 任意 | `failed` | 系统或 Agent 失败（终态除外） | System |

> 终态（`merged` / `failed` / `canceled`）不可再转移。

---

## 4. 各状态详细说明

### 4.1 created（已创建）

任务合同（Task Contract）已创建并持久化。

**进入条件**：
- `agentgitops task create` 执行成功
- Task Contract YAML 写入 `.agentgitops/tasks/{task_id}.yml`
- SQLite 中创建任务记录

**系统行为**：
- 记录审计事件 `task.created`
- 任务出现在 Task Board 的 Backlog 列

**退出条件**：
- 执行 `agentgitops run` 或 `agentgitops workspace create` → 进入 `workspace_created`

### 4.2 workspace_created（工作区已创建）

已为任务创建独立的 git worktree 和 agent 分支。

**进入条件**：
- 基于 `baseBranch` 创建 agent 分支
- 基于 agent 分支创建 `git worktree`
- 注入任务提示文件与项目上下文
- Workspace 记录入库

**系统行为**：
- 记录审计事件 `workspace.created`
- 任务进入 Planning 列

**退出条件**：
- Agent Adapter 启动 Agent → 进入 `running`

### 4.3 running（执行中）

Agent 已启动并在 workspace 内执行任务。

**进入条件**：
- Agent Adapter 调用 Agent 命令
- Agent 进程启动成功
- AgentSession 记录入库

**系统行为**：
- 记录审计事件 `agent.session.started`
- 实时采集 stdout / stderr 到日志文件
- 文件变更监听器记录修改
- 任务进入 Running 列

**退出条件**：
- Agent 进程退出 → 进入 `testing`
- Agent 异常退出且无有效变更 → 进入 `failed`

### 4.4 testing（测试中）

Agent 执行完成，正在运行验证检查。

**进入条件**：
- Agent 进程退出
- 触发 Verification Gate

**系统行为**：
- 运行 `requiredChecks` 中的所有命令
- 采集每个检查的退出码、耗时、输出
- 记录 VerificationRun
- 任务进入 Testing 列

**退出条件**：
- 所有必跑检查完成 → 进入 `packaging`
- 必跑检查失败 → 进入 `failed`（或触发 Agent 自动修复，回到 `running`）

### 4.5 packaging（打包中）

正在生成 Change Package。

**进入条件**：
- Verification Gate 通过

**系统行为**：
- 采集 git diff
- 统计文件变更、行数变更
- 评估风险（Policy Engine）
- 检测冲突（Conflict Engine）
- 生成 `change-package.json`
- 任务进入 Packaging 列

**退出条件**：
- Change Package 生成成功 → 进入 `reviewing`
- 生成失败 → 进入 `failed`

### 4.6 reviewing（评审中）

Change Package 已生成，进入 Review Board 等待人类审核。

**进入条件**：
- Change Package 生成成功

**系统行为**：
- 记录审计事件 `change_package.generated`
- 任务进入 Reviewing 列
- Review Board 展示完整证据
- 通知相关 Reviewer（Team 版）

**人类可执行动作**：
- `Approve` → 进入 Merge Queue
- `Reject` → 进入 `failed`
- `Request Changes` → 回到 `running`（Agent 重新执行）
- `Ask Agent to Fix` → 回到 `running`
- `Escalate to Human Owner` → 转交
- `Mark as High Risk` → 提升风险等级
- `Add Required Check` → 增加检查项

**退出条件**：
- Approve + Merge Gate 通过 → 进入 `merged`
- 检测到冲突 / 审批不通过 → 进入 `blocked`
- Request Changes → 回到 `running`

### 4.7 blocked（阻塞）

任务被阻塞，等待处理。

**进入条件**：
- Conflict Engine 检测到冲突
- 审批不通过
- 高风险变更需要额外审批

**系统行为**：
- 任务进入 Blocked 列
- Conflict Center 展示冲突详情
- 通知相关人类处理

**退出条件**：
- 冲突解决 / 审批通过 → 回到 `reviewing`
- 人工标记失败 → 进入 `failed`
- 人工取消 → 进入 `canceled`

### 4.8 merged（已合并，终态）

变更已合并到主干。

**进入条件**：
- 人类 Approve
- Merge Gate 通过
- Git Platform 执行合并成功

**系统行为**：
- 记录 MergeRecord
- 记录审计事件 `merge.completed`
- 更新 AgentOps 指标
- workspace 归档
- 任务进入 Merged 列

### 4.9 failed（失败，终态）

任务执行失败。

**进入条件**：
- worktree 创建失败
- Agent 启动失败
- Agent 异常退出且无有效变更
- 必跑检查失败
- Change Package 生成失败
- 人工标记失败

**系统行为**：
- 记录审计事件 `task.failed`
- 任务进入 Failed 列
- 保留 workspace 与日志供排查
- 可由人类接管后重新创建任务

### 4.10 canceled（已取消，终态）

任务被人工取消。

**进入条件**：
- 人工执行 `agentgitops task cancel`

**系统行为**：
- 终止运行中的 Agent 进程（如存在）
- 记录审计事件 `task.canceled`
- 任务进入 Canceled 列
- workspace 可选清理

---

## 5. 特殊流程

### 5.1 Request Changes 循环

```
reviewing → (Request Changes) → running → testing → packaging → reviewing
```

Reviewer 要求修改后，Agent 重新执行，重新走 testing → packaging → reviewing 流程。每次循环记录 Review 历史。

### 5.2 冲突处理流程

```
reviewing → (conflict detected) → blocked → (conflict resolved) → reviewing → merged
```

或：

```
reviewing → (conflict detected) → blocked → (rebase + retest) → running → testing → packaging → reviewing
```

### 5.3 自动修复流程

```
testing → (check failed) → running (agent auto-fix) → testing
```

若配置了自动修复策略，检查失败时可自动触发 Agent 重新修复，而非直接进入 `failed`。

### 5.4 回滚流程

```
merged → (revert) → merged (reverted=true)
```

合并后发现问题的回滚不改变任务状态（仍为 `merged`），但在 MergeRecord 中标记 `reverted=true`，并记录审计事件 `merge.reverted`。

---

## 6. 状态与看板列映射

| Task Board 列 | 对应状态 |
| --- | --- |
| Backlog | `created` |
| Planning | `workspace_created` |
| Running | `running` |
| Testing | `testing` |
| Packaging | `packaging` |
| Reviewing | `reviewing` |
| Blocked | `blocked` |
| Merged | `merged` |
| Failed | `failed` |
| Canceled | `canceled` |

---

## 7. 状态持久化

每次状态转移：

1. 更新 SQLite / Postgres 中 `tasks.status` 字段
2. 更新 `tasks.updated_at`
3. 写入 `audit_events`（`task.started` / `task.canceled` 等）
4. 通过 WebSocket / SSE 推送状态变更到 Web UI（如已连接）

---

## 8. 并发与一致性

- 同一 Task 的状态转移串行化，避免并发冲突
- Local-first 模式：单进程，无并发问题
- Team / Enterprise 模式：通过乐观锁（`updated_at` 版本号）或行锁保证一致性
- 状态转移前校验当前状态是否允许目标转移（状态机校验）

---

## 9. 相关文档

| 文档 | 说明 |
| --- | --- |
| [`data-model.md`](./data-model.md) | 数据模型（TaskContract 定义） |
| [`change-package.md`](./change-package.md) | Change Package 规范 |
| [`policy.md`](./policy.md) | 策略引擎（影响 blocked / merged） |
| [`api-reference.md`](./api-reference.md) | Task API（状态转移接口） |
