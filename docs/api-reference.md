# API 参考（API Reference）

> 项目：agentgitops
> 版本：v0.1（设计阶段）
> 关联文档：[`data-model.md`](./data-model.md)、[`task-lifecycle.md`](./task-lifecycle.md)

agentgitops MVP 阶段采用 REST API。所有 API 返回 JSON，使用标准 HTTP 状态码。后续将基于 REST 生成 OpenAPI Spec 并派生 SDK。

---

## 1. 通用约定

### 1.1 Base URL

```
Local-first:  http://localhost:4789/api
Team/Enterprise: https://{control-plane-host}/api
```

### 1.2 认证

| 部署形态 | 认证方式 |
| --- | --- |
| Local-first | 无认证（仅监听 localhost） |
| Team / Enterprise | Bearer Token（`Authorization: Bearer <token>`） |

### 1.3 通用响应格式

**成功**：

```json
{
  "data": { ... },
  "meta": {
    "requestId": "req_xxx",
    "timestamp": "2026-07-03T04:00:00Z"
  }
}
```

**列表**：

```json
{
  "data": [ ... ],
  "meta": {
    "requestId": "req_xxx",
    "timestamp": "2026-07-03T04:00:00Z",
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 42
    }
  }
}
```

**错误**：

```json
{
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "Task task-xxx not found",
    "details": { ... }
  },
  "meta": {
    "requestId": "req_xxx",
    "timestamp": "2026-07-03T04:00:00Z"
  }
}
```

### 1.4 HTTP 状态码

| 状态码 | 含义 |
| --- | --- |
| 200 | 成功 |
| 201 | 创建成功 |
| 204 | 成功无内容 |
| 400 | 请求参数错误 |
| 401 | 未认证 |
| 403 | 无权限 |
| 404 | 资源不存在 |
| 409 | 状态冲突（如状态机非法转移） |
| 422 | 校验失败 |
| 500 | 服务器内部错误 |

### 1.5 实时通信

状态变更通过 WebSocket / SSE 推送：

```
WebSocket:  ws://localhost:4789/ws
SSE:        GET /api/events/stream
```

事件示例：

```json
{
  "type": "task.status_changed",
  "data": {
    "taskId": "task-20260703-001",
    "from": "running",
    "to": "testing",
    "timestamp": "2026-07-03T04:00:00Z"
  }
}
```

---

## 2. Project API

### 2.0 初始化当前本地项目

```http
POST /api/project/init
```

**请求体**：

```json
{
  "name": "agentgitops",
  "actorId": "your-username",
  "force": false
}
```

用于 Web UI 在缺少 `.agentgitops.yml` 时自恢复初始化当前目录。初始化后会把 `actorId` 写入本地 Web owner 列表，并记录 `project.created` 审计事件。

### 2.1 创建项目

```http
POST /api/projects
```

**请求体**：

```json
{
  "name": "demo-web",
  "rootPath": "/path/to/demo-web",
  "repoUrl": "git@github.com:org/demo-web.git",
  "defaultBranch": "main",
  "gitProvider": "github"
}
```

**响应** `201`：

```json
{
  "data": {
    "id": "proj_demo-web",
    "name": "demo-web",
    "rootPath": "/path/to/demo-web",
    "repoUrl": "git@github.com:org/demo-web.git",
    "defaultBranch": "main",
    "gitProvider": "github",
    "createdAt": "2026-07-03T04:00:00Z",
    "updatedAt": "2026-07-03T04:00:00Z"
  }
}
```

### 2.2 列出项目

```http
GET /api/projects
```

### 2.3 获取项目

```http
GET /api/projects/:id
```

### 2.4 更新项目

```http
PATCH /api/projects/:id
```

### 2.5 删除项目

```http
DELETE /api/projects/:id
```

### 2.6 项目看板概览

```http
GET /api/projects/:id/dashboard
```

**响应**：

```json
{
  "data": {
    "projectId": "proj_demo-web",
    "activeTaskCount": 3,
    "activeWorkspaceCount": 3,
    "pendingReviewCount": 2,
    "conflictRiskCount": 1,
    "mergeQueueCount": 1,
    "highRiskChangeCount": 1,
    "ciFailedCount": 0,
    "recentMerged": [ ... ]
  }
}
```

---

## 3. Agent API

### 3.1 注册 Agent

```http
POST /api/agents
```

**请求体**：

```json
{
  "name": "claude-code",
  "type": "generic-cli",
  "command": "claude",
  "args": ["{{task_prompt_file}}"],
  "env": {},
  "enabled": true
}
```

### 3.2 列出 Agent

```http
GET /api/agents
```

### 3.3 获取 Agent

```http
GET /api/agents/:id
```

### 3.4 更新 Agent

```http
PATCH /api/agents/:id
```

### 3.5 删除 Agent

```http
DELETE /api/agents/:id
```

---

## 4. Task API

### 4.1 创建任务

```http
POST /api/tasks
```

**请求体**：

```json
{
  "projectId": "proj_demo-web",
  "title": "Fix expired token returning 500",
  "objective": "修复登录 token 过期时返回 500 的问题",
  "background": "用户 token 过期后接口应返回 401，而不是服务端异常。",
  "baseBranch": "main",
  "agentId": "agent_claude-code",
  "allowedPaths": ["src/auth/**", "tests/auth/**"],
  "forbiddenPaths": ["db/migrations/**", "infra/**"],
  "requiredChecks": ["npm test -- auth", "npm run lint"],
  "riskLevel": "medium",
  "riskDomains": ["auth", "api"],
  "approval": {
    "required": true,
    "reviewers": ["@auth-owner"]
  },
  "merge": {
    "strategy": "manual",
    "squash": true
  }
}
```

**当前实现**：本地 Web API 使用当前项目配置派生 `projectId`，支持 `title`、`objective`、`background`、`baseBranch`、`agentId`、`allowedPaths`、`forbiddenPaths`、`requiredChecks`、`riskLevel`、`reviewers`、`actorId`。返回 `{ task, message }`，并写入 `task.created` 审计事件。

### 4.2 列出任务

```http
GET /api/tasks?projectId=proj_demo-web&status=running,reviewing&page=1&pageSize=20
```

**查询参数**：

| 参数 | 说明 |
| --- | --- |
| `projectId` | 项目 ID |
| `status` | 状态过滤（逗号分隔） |
| `agentId` | Agent ID 过滤 |
| `page` | 页码 |
| `pageSize` | 每页数量 |

### 4.3 获取任务

```http
GET /api/tasks/:id
```

### 4.4 更新任务

```http
PATCH /api/tasks/:id
```

> 仅在 `created` 状态下可更新任务合同字段。

### 4.5 启动任务

```http
POST /api/tasks/:id/start
```

**行为**：
1. 创建 workspace（如未创建）
2. 状态转移：`created` → `workspace_created`
3. 写入 `workspace.created` / `task.started` 审计事件

**响应**：

```json
{
  "data": {
    "task": { "id": "task-20260703-001", "status": "workspace_created" },
    "workspacePath": "../.agentgitops-worktrees/demo-task-20260703-001",
    "message": "Task workspace ready: ..."
  }
}
```

### 4.6 运行 Agent

```http
POST /api/tasks/:id/run
```

**请求体**：

```json
{ "actorId": "local-owner" }
```

**行为**：确保 workspace 存在，调用任务绑定的 Agent adapter，将日志写入 `.agentgitops/logs/:taskId`，状态成功转为 `testing`，失败转为 `failed`，并写入 `agent.session.started/completed/failed` 审计事件。

### 4.7 执行验证

```http
POST /api/tasks/:id/test
```

**行为**：运行配置和任务中的 required checks，保存 `.agentgitops/verifications/:taskId.json`。验证命令通过跨平台执行器运行，并写入 `exitCode`、`outputSummary.errors/warnings`、测试计数和日志路径。若 `policies.checks.github.enabled=true`，会调用 GitHub Checks API 查询目标分支 CI 状态并作为同一组 VerificationRun 证据保存。无 required checks 且未启用 GitHub Checks 时写入 skipped 记录并转为 `packaging`。

### 4.8 生成 Change Package

```http
POST /api/tasks/:id/package
```

**行为**：从任务 workspace 采集 diff、读取 verification 记录、执行策略和冲突检测，生成 `.agentgitops/packages/:taskId.json`，任务转为 `reviewing`。

### 4.9 创建或预检 PR/MR

```http
POST /api/tasks/:id/pr
```

**请求体**：

```json
{
  "actorId": "local-owner",
  "dryRun": true,
  "draft": true,
  "commit": true,
  "reviewContextComment": true,
  "bodyTemplate": "team-sync"
}
```

**行为**：
1. `dryRun=true` 时只返回 repo/title/base/head/body，不提交、不推送、不调用 provider。
2. 真实执行会按需 commit、push 任务分支，并通过 GitHub/GitLab Provider 创建或更新 PR/MR。
3. PR/MR 描述包含 Change Package 与 Review Context Summary。
4. `reviewContextComment=true` 时按 `<!-- agentgitops:review-context -->` marker 幂等创建或更新 PR/MR 评论。
5. `bodyTemplate` 可选值为 `ce` 或 `team-sync`，默认 `ce`。`team-sync` 会在现有 Change Package + Evidence 模板后追加 Team Sync Context、Collaboration Impact、Agent Context Feed 和 Sync State。
6. 真实写 provider 需要 owner 权限和 `GITHUB_TOKEN` / `GH_TOKEN` / `GITLAB_TOKEN`，不会保存 token。

#### Team Sync Relay 端点

以下端点用于 Team Sync 元数据信号同步。Relay 只保存任务、变更包摘要、Review Context、Agent Note、adopt 等结构化事件；不保存源码、完整 diff、Prompt、原始日志或 token。

```http
GET  /api/team/status
GET  /api/team/tasks
GET  /api/team/conflicts
POST /api/sync/push
GET  /api/sync/pull
```

`POST /api/sync/push` 请求体包含 `teamId`、`hubId`、`cursor` 和 `events`。`GET /api/sync/pull` 使用 `teamId`、`hubId`、`cursor`、`limit` 查询增量事件。`push/pull` 使用 `x-agentgitops-timestamp` 与 `x-agentgitops-signature` 做 Team Sync HMAC 校验，成功响应返回新的同步 cursor。

### 4.10 取消任务

```http
POST /api/tasks/:id/cancel
```

**行为**：终止运行中的 Agent，状态转移至 `canceled`。

### 4.11 获取任务 Diff

```http
GET /api/tasks/:id/diff
```

**响应**：

```json
{
  "data": {
    "taskId": "task-20260703-001",
    "baseBranch": "main",
    "targetBranch": "agent/task-20260703-001/claude-code",
    "changedFiles": ["src/auth/token.ts", "tests/auth/token-expired.test.ts"],
    "stats": { "insertions": 48, "deletions": 12 },
    "diff": "--- a/src/auth/token.ts\n+++ b/src/auth/token.ts\n..."
  }
}
```

---

## 5. Workspace API

### 5.1 创建工作区

```http
POST /api/tasks/:id/workspace
```

**行为**：基于 `baseBranch` 创建 agent 分支与 `git worktree`。

### 5.2 列出工作区

```http
GET /api/workspaces?projectId=proj_demo-web
```

### 5.3 获取工作区

```http
GET /api/workspaces/:id
```

### 5.4 清理工作区

```http
POST /api/workspaces/:id/clean
```

**行为**：归档并移除 worktree（保留分支）。

### 5.5 删除工作区

```http
DELETE /api/workspaces/:id
```

**行为**：移除 worktree 并删除 agent 分支。

---

## 6. Change Package API

### 6.1 生成变更包

```http
POST /api/tasks/:id/package
```

**行为**：
1. 采集 git diff
2. 运行验证检查（如未运行）
3. 评估风险
4. 检测冲突
5. 生成 `change-package.json`

**响应** `201`：返回完整 ChangePackage。

### 6.2 列出变更包

```http
GET /api/packages?projectId=proj_demo-web&status=pending_review
```

### 6.3 获取变更包

```http
GET /api/packages/:id
```

### 6.4 创建 PR

```http
POST /api/tasks/:id/pr
```

**请求体**（可选）：

```json
{
  "draft": false,
  "reviewContextComment": true
}
```

**行为**：
1. push agent 分支到远端
2. 通过 Git Provider 创建 PR / MR
3. 在 PR 描述中写入 Change Package 摘要和 Review Context Summary
4. 可选幂等更新 Review Context 评论
5. 更新 `prUrl` / `prNumber`

**响应**：

```json
{
  "data": {
    "packageId": "pkg_task-20260703-001",
    "prUrl": "https://github.com/org/demo-web/pull/42",
    "prNumber": 42
  }
}
```

---

## 7. Review API

### 7.1 提交评审

```http
POST /api/packages/:id/reviews
```

**请求体**：

```json
{
  "reviewerId": "user:alice",
  "action": "approve",
  "comment": "LGTM, tests look good."
}
```

**action 枚举**：

| action | 说明 |
| --- | --- |
| `approve` | 批准，进入 Merge Queue |
| `reject` | 拒绝，任务进入 `failed` |
| `request_changes` | 要求修改，任务回到 `running` |
| `ask_agent_to_fix` | 要求 Agent 修复，任务回到 `running` |
| `escalate` | 升级给 Owner |
| `mark_high_risk` | 标记为高风险 |
| `add_required_check` | 增加必跑检查 |

### 7.2 批准

```http
POST /api/packages/:id/approve
```

### 7.3 拒绝

```http
POST /api/packages/:id/reject
```

### 7.4 要求修改

```http
POST /api/packages/:id/request-changes
```

### 7.5 列出评审记录

```http
GET /api/packages/:id/reviews
```

---

## 8. Merge API

### 8.1 列出合并队列

```http
GET /api/merge-queue
```

**响应**：

```json
{
  "data": [
    {
      "task": { "id": "task-20260703-001", "status": "reviewing" },
      "changePackage": { "id": "pkg_task-20260703-001" },
      "gate": {
        "allowed": false,
        "blockers": ["Open conflict: same_file with task-20260703-003"],
        "warnings": []
      },
      "prUrl": "https://github.com/org/demo-web/pull/42",
      "prNumber": 42
    }
  ]
}
```

### 8.2 门禁检查

```http
POST /api/merge-queue/:taskId/evaluate
```

只运行 Merge Gate，不更新本地任务，也不调用 provider。

### 8.3 批准合并

```http
POST /api/merge-queue/:taskId/approve
```

**请求体**：

```json
{
  "actorId": "user:alice",
  "strategy": "squash",
  "squash": true,
  "localOnly": false,
  "dryRun": false
}
```

**行为**：
1. Merge Gate 校验（策略、检查、审批、冲突）
2. 如果 `dryRun` 或门禁失败，不执行 provider 调用
3. 如果 `localOnly`，只记录 `merge.queued` 审计事件
4. 真实合并要求 Change Package 存在 `prNumber`
5. 使用运行时 token（`GITHUB_TOKEN` / `GH_TOKEN` / `gh auth token` / `GITLAB_TOKEN`）
6. provider 确认合并后才将任务状态转为 `merged`
7. 记录审计事件 `merge.completed`

### 8.4 阻止合并

```http
POST /api/merge-queue/:taskId/block
```

### 8.5 重新运行检查

```http
POST /api/packages/:id/recheck
```

### 8.6 回滚合并

```http
POST /api/packages/:id/revert
```

---

## 9. Conflict API

### 9.1 列出冲突

```http
GET /api/conflicts
```

**响应**：

```json
{
  "data": [
    {
      "id": "conflict_xxx",
      "type": "same_file",
      "taskId": "task-20260703-001",
      "conflictingTaskId": "task-20260703-003",
      "filePath": "src/auth/token.ts",
      "severity": "high",
      "suggestion": "serial_merge",
      "status": "open",
      "packageId": "pkg_task-20260703-001"
    }
  ]
}
```

### 9.2 获取冲突详情

```http
GET /api/conflicts/:id
```

### 9.3 处理冲突

```http
POST /api/conflicts/:id/resolve
POST /api/conflicts/:id/false-positive
POST /api/conflicts/:id/rebase
POST /api/conflicts/:id/human-takeover
```

**请求体**：

```json
{
  "actorId": "user:alice",
  "note": "已经人工确认并串行处理"
}
```

**行为**：

| endpoint | 行为 |
| --- | --- |
| `/resolve` | 将冲突状态标记为 `resolved` |
| `/false-positive` | 将冲突状态标记为 `resolved`，建议标记为 `mark_false_positive` |
| `/rebase` | 在任务 worktree 中执行 `git fetch <remote> <baseBranch>` + `git rebase <remote>/<baseBranch>`；成功后将冲突置为 `resolved`、任务回到 `testing`，失败时自动尝试 `git rebase --abort`、冲突保持 `open`、任务置为 `blocked` |
| `/human-takeover` | 保持 `open`，建议改为 `human_takeover`，并将任务置为 `blocked` |

**响应**：

```json
{
  "data": {
    "conflict": {
      "id": "conflict_xxx",
      "taskId": "task-20260703-001",
      "conflictingTaskId": "task-20260703-003",
      "type": "same_file",
      "filePath": "src/auth/token.ts",
      "severity": "high",
      "suggestion": "rebase",
      "status": "resolved",
      "packageId": "pkg_task-20260703-001"
    },
    "task": {
      "id": "task-20260703-001",
      "status": "testing"
    },
    "actionResult": {
      "status": "completed",
      "command": "git rebase origin/main"
    }
  }
}
```

所有处理都会记录审计事件并通过 SSE 广播 `conflict.updated` / `task.updated` / `data.changed`。`actionResult.output` 和 `actionResult.error` 会被裁剪后写入审计，避免长日志撑爆本地数据库。

### 9.4 本地 Web 权限

Web 本地治理操作使用 `.agentgitops.yml` 中的 `security.web.owners` / `security.web.reviewers` 派生角色：

| 角色 | 可执行操作 |
| --- | --- |
| `owner` | provider merge、block、rebase、human takeover、初始化 |
| `reviewer` | review、本地批准、resolve、false positive、agent note |
| `viewer` | 只读、Merge Gate dry-run |

当前是本地治理身份，不是企业 SSO。后续接入多用户服务端时应替换为真实认证授权。

---

## 10. Policy API

### 10.1 获取策略

```http
GET /api/projects/:id/policy
```

### 10.2 更新策略

```http
PUT /api/projects/:id/policy
```

**请求体**：见 [`configuration.md`](./configuration.md) 中 `policies` 部分。

### 10.3 校验变更

```http
POST /api/projects/:id/policy/evaluate
```

**请求体**：

```json
{
  "changedFiles": ["src/auth/token.ts", "db/migrations/001.sql"],
  "taskId": "task-20260703-001"
}
```

**响应**：

```json
{
  "data": {
    "allowed": false,
    "violations": [
      {
        "rule": "forbidden_paths",
        "file": "db/migrations/001.sql",
        "message": "Forbidden path for agents: db/migrations/**"
      }
    ],
    "riskLevel": "high",
    "requiresApproval": true,
    "requiredReviewers": ["@db-owner"]
  }
}
```

---

## 11. Audit API

### 11.1 查询审计事件

```http
GET /api/audit?taskId=task-20260703-001&eventType=merge.completed&actorId=owner&limit=50
```

**查询参数**：

| 参数 | 说明 |
| --- | --- |
| `taskId` | 任务 ID |
| `eventType` | 事件类型 |
| `actorType` | Actor 类型：`human` / `agent` / `system` |
| `actorId` | Actor ID |
| `from` | 起始 ISO 时间 |
| `to` | 结束 ISO 时间 |
| `limit` | 返回数量，最大 500 |
| `from` / `to` | 后续扩展 |
| `page` / `pageSize` | 后续扩展 |

Web Audit 页面基于该 API 提供 task/event 过滤和时间线回放；后端返回事件按本地审计存储读取，前端按 `createdAt` 排序展示。

### 11.2 任务审计回放

```http
GET /api/tasks/:id/audit-trail
```

**响应**：按时间排序的完整审计事件链。

---

## 12. AgentOps API

### 12.1 项目指标

```http
GET /api/agentops
```

**响应**：

```json
{
  "data": {
    "generatedAt": "2026-07-04T00:00:00.000Z",
    "taskTotals": { "reviewing": 2, "blocked": 1 },
    "agentTotals": { "codex": 3 },
    "riskTotals": { "medium": 2, "high": 1 },
    "mergeGate": {
      "queued": 3,
      "allowed": 1,
      "blocked": 2,
      "blockers": 4,
      "warnings": 1
    },
    "logs": {
      "taskDirectories": 3,
      "files": 8
    },
    "audit": {
      "total": 18,
      "recent": []
    }
  }
}
```

当前 AgentOps API 会写入并返回最近本地快照历史；同一指标在 60 秒内不会重复写入，避免打开 Dashboard 时高频写大 SQLite：

```json
{
  "history": [
    {
      "id": "agentops_xxx",
      "createdAt": "2026-07-04T00:00:00.000Z",
      "metrics": {
        "taskTotals": { "reviewing": 1 },
        "mergeGate": { "queued": 1, "allowed": 0, "blocked": 1, "blockers": 1, "warnings": 0 },
        "logs": { "taskDirectories": 1, "files": 3 },
        "auditTotal": 10
      }
    }
  ]
}
```

### 12.2 Agent 指标

```http
GET /api/agents/:id/metrics?range=30d
```

### 12.3 Agent 排行

```http
GET /api/projects/:id/agent-ranking?range=30d
```

### 12.4 Workflow Jobs

```http
GET /api/workflow-jobs
GET /api/workflow-jobs?taskId=task-20260705-001&limit=20
```

用于查询 Web/CLI workflow action 的 durable job 记录。当前 job 先入队再执行，会持久化 `queued`、`running`、`completed`、`failed`、`canceled` 状态，便于 UI、审计和后续后台队列复用。Server 启动时会把超过恢复窗口的 `running` job 标记为失败，避免进程崩溃后永久卡住。

**响应**：

```json
{
  "data": [
    {
      "id": "job_xxx",
      "action": "task.package",
      "taskId": "task-20260705-001",
      "actorId": "your-username",
      "source": "web",
      "status": "completed",
      "retryOf": null,
      "attempt": 1,
      "maxAttempts": 2,
      "result": {
        "message": "Change Package generated: pkg_task-20260705-001"
      },
      "createdAt": "2026-07-05T00:00:00.000Z",
      "startedAt": "2026-07-05T00:00:00.001Z",
      "completedAt": "2026-07-05T00:00:02.000Z",
      "updatedAt": "2026-07-05T00:00:02.000Z"
    }
  ]
}
```

### 12.5 Workflow Job 操作

```http
POST /api/workflow-jobs/:jobId/cancel
POST /api/workflow-jobs/:jobId/retry
```

`cancel` 可取消 `queued` / `running` job。`retry` 可重试 `failed` / `canceled` 的 task workflow job，并创建一条带 `retryOf` 的新 job。真实 PR/MR job 的 retry 仍要求 owner 权限和运行时 provider token。

---

## 13. Agent Notes API

### 13.1 列出全部 Agent 变更记录

```http
GET /api/agent-notes
```

用于 Web 日志中心和 Review Agent 聚合视图。

### 13.2 列出任务 Agent 变更记录

```http
GET /api/tasks/:taskId/notes
```

### 13.3 新增 Agent 变更记录

```http
POST /api/tasks/:taskId/notes
```

**请求体**：

```json
{
  "actorId": "codex",
  "agentId": "codex",
  "summary": "实现 Web Merge Queue provider merge 和恢复提示",
  "files": ["apps/server/src/index.ts", "apps/web/src/pages/MergeQueue.tsx"],
  "verification": ["pnpm exec turbo run typecheck lint test build --force"],
  "reviewFocus": ["provider merge failure recovery", "token 不落库"],
  "risks": ["真实 merge 仍依赖远端分支保护和 token 权限"],
  "commitSha": "abc123",
  "prUrl": "https://github.com/org/repo/pull/1"
}
```

新增记录会同时写入 `agent.note.added` 审计事件。禁止写入 token、私钥或其它敏感信息。

---

## 14. Review Context API

### 14.1 生成 Review Agent 上下文

```http
GET /api/review-context/:taskId
GET /api/review-context/:taskId?record=1&actorId=codex
```

聚合 `Task`、`Change Package`、本地 Review、Agent Notes、Audit 和审查 checklist。`record=1` 会写入 `review.context.generated` 审计事件，用于证明 Review Agent 或 Reviewer 已读取上下文。

---

## 15. Webhook API

接收 Git 平台事件。

### 15.1 GitHub Webhook

```http
POST /api/webhooks/github
Headers:
  X-GitHub-Event: pull_request
  X-GitHub-Delivery: <delivery-id>
  X-Hub-Signature-256: <signature>
```

**处理事件**：

| GitHub Event | 处理 |
| --- | --- |
| `pull_request` (opened/synchronized) | 更新 PR 状态 |
| `pull_request` (closed/merged) | 触发合并完成流程 |
| `pull_request_review` | 同步 Review 状态 |
| `check_run` / `check_suite` | 同步 CI 状态 |
| `push` | 检测主干变更，触发冲突重检 |

### 15.2 GitLab Webhook

```http
POST /api/webhooks/gitlab
Headers:
  X-Gitlab-Event: Merge Request Hook
  X-Gitlab-Token: <token>
```

### 15.3 Gitea Webhook

```http
POST /api/webhooks/gitea
Headers:
  X-Gitea-Event: pull_request
  X-Gitea-Signature: <signature>
```

> Webhook 安全：验证签名 / Token，拒绝非法请求。详见 [`security.md`](./security.md)。

---

## 16. Health API

### 16.1 健康检查

```http
GET /api/health
```

**响应**：

```json
{
  "data": {
    "status": "ok",
    "version": "0.1.0",
    "uptime": 3600,
    "db": "ok",
    "git": "ok"
  }
}
```

### 16.2 环境诊断

```http
GET /api/doctor
```

**响应**：检查 Git、配置、Agent 命令是否可用。

---

## 17. 错误码

| 错误码 | HTTP | 说明 |
| --- | --- | --- |
| `PROJECT_NOT_FOUND` | 404 | 项目不存在 |
| `AGENT_NOT_FOUND` | 404 | Agent 不存在 |
| `TASK_NOT_FOUND` | 404 | 任务不存在 |
| `WORKSPACE_NOT_FOUND` | 404 | 工作区不存在 |
| `PACKAGE_NOT_FOUND` | 404 | 变更包不存在 |
| `INVALID_STATE_TRANSITION` | 409 | 非法状态转移 |
| `POLICY_VIOLATION` | 422 | 策略违规 |
| `FORBIDDEN_PATH` | 422 | 修改了禁止路径 |
| `MERGE_GATE_BLOCKED` | 409 | 合并门禁拦截 |
| `CONFLICT_DETECTED` | 409 | 检测到冲突 |
| `AGENT_COMMAND_NOT_FOUND` | 422 | Agent 命令不存在 |
| `GIT_OPERATION_FAILED` | 500 | Git 操作失败 |
| `PROVIDER_ERROR` | 502 | Git 平台 API 错误 |

---

## 18. 相关文档

| 文档 | 说明 |
| --- | --- |
| [`data-model.md`](./data-model.md) | 数据模型 |
| [`task-lifecycle.md`](./task-lifecycle.md) | 任务生命周期 |
| [`cli-reference.md`](./cli-reference.md) | CLI 命令（CLI 是 API 的封装） |
| [`git-provider-integration.md`](./git-provider-integration.md) | Git 平台集成与 Webhook |
| [`security.md`](./security.md) | 安全设计 |
