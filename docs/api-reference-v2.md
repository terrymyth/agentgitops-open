# REST API 参考

> 项目：agentgitops
> 版本：v1.0.0
> OpenAPI 规范：[`openapi.json`](./openapi.json)
> Base URL：`http://localhost:4789`（Local-first 默认）

---

## 概览

agentgitops Server 提供 REST API，供 CLI、Web UI 和外部系统集成。所有 API 返回 JSON 格式，实时事件使用 SSE（Server-Sent Events）。

### 认证

- **CE（本地模式）**：无认证，默认监听 localhost
- **EE（企业模式）**：通过 IdentityProvider 注入 OIDC/SAML 认证，Bearer token

### 内容类型

- 请求体：`application/json`
- 响应体：`application/json`
- 事件流：`text/event-stream`

---

## 端点列表

### Health

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |

### Project

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/actor` | 获取当前操作者 |
| GET | `/api/project` | 获取项目配置 |
| POST | `/api/project/init` | 初始化项目 |
| GET | `/api/projects` | 列出所有注册项目（多项目） |
| POST | `/api/projects/add` | 添加项目到注册表 |

### Tasks

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/tasks` | 列出所有任务 |
| POST | `/api/tasks` | 创建任务 |
| POST | `/api/tasks/{taskId}/run` | 运行任务（启动 Agent） |
| POST | `/api/tasks/{taskId}/package` | 生成 Change Package |
| POST | `/api/tasks/{taskId}/pr` | 创建 PR |
| GET | `/api/logs` | 列出 Agent 会话日志 |
| GET | `/api/agent-notes` | 列出 Agent Notes |

### Workspaces

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/workspaces` | 列出所有工作区 |

### Change Packages

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/change-packages` | 列出所有 Change Package |

### Merge Queue

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/merge-queue` | 列出合并队列 |
| POST | `/api/merge-queue/{taskId}/approve` | 批准合并 |
| POST | `/api/merge-queue/{taskId}/block` | 阻止合并 |
| POST | `/api/merge-queue/{taskId}/rebase` | rebase |

### Conflicts

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/conflicts` | 列出所有冲突 |
| POST | `/api/conflicts/{conflictId}/resolve` | 解决冲突 |
| POST | `/api/conflicts/{conflictId}/false-positive` | 标记为误报 |

### Audit

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/audit` | 查询审计事件（支持 taskId/eventType/limit 过滤） |

### AgentOps

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/agentops` | 获取 AgentOps 运营指标 |

### Workflow Jobs

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/workflow-jobs` | 列出工作流任务（支持 status 过滤） |
| POST | `/api/workflow-jobs/{jobId}/retry` | 重试工作流任务 |
| POST | `/api/workflow-jobs/{jobId}/cancel` | 取消工作流任务 |

### Team Sync

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/sync/push` | 推送同步事件到 Relay |
| POST | `/api/sync/pull` | 从 Relay 拉取同步事件 |
| GET | `/api/team/status` | 获取团队状态 |
| GET | `/api/team/tasks` | 获取团队任务列表 |
| GET | `/api/team/conflicts` | 获取团队冲突列表 |
| GET | `/api/team/sync-status` | 获取自动同步状态 |
| POST | `/api/team/sync-now` | 立即触发同步 |
| GET | `/api/team/sync-watch` | 同步状态实时流（SSE） |

### Context Feed

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/context-feed` | 获取 Context Feed 预览（支持 taskId 参数） |

### Handoff Documents

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/handoff-docs` | 列出交接文档 |

### Events

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/events/stream` | 实时事件流（SSE） |

### Webhooks

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/webhooks/github` | GitHub Webhook 接收 |

---

## 关键数据模型

### TaskContract

```json
{
  "id": "task-20260712-001",
  "projectId": "demo-web",
  "title": "Fix expired token returning 500",
  "objective": "修复登录 token 过期时返回 500 的问题",
  "status": "running",
  "riskLevel": "medium",
  "agentId": "claude-code",
  "baseBranch": "main",
  "targetBranch": "agent/task-20260712-001/claude-code",
  "allowedPaths": ["src/auth/**"],
  "forbiddenPaths": ["secrets/**"],
  "createdAt": "2026-07-12T10:00:00Z",
  "updatedAt": "2026-07-12T10:05:00Z"
}
```

### ChangePackage

```json
{
  "id": "cp-20260712-001",
  "taskId": "task-20260712-001",
  "diff": {
    "stats": { "filesChanged": 3, "insertions": 45, "deletions": 12 }
  },
  "verification": {
    "status": "passed",
    "gates": [{ "name": "lint", "status": "passed" }]
  },
  "riskLevel": "medium",
  "unverifiedItems": [],
  "conflicts": [],
  "mergeRecommendation": "auto-merge",
  "createdAt": "2026-07-12T10:30:00Z"
}
```

### AuditEvent

```json
{
  "id": "evt-20260712-001",
  "taskId": "task-20260712-001",
  "eventType": "task.merge",
  "actor": "alice",
  "actorType": "user",
  "projectId": "demo-web",
  "payload": { "mergeMethod": "squash" },
  "timestamp": "2026-07-12T11:00:00Z"
}
```

---

## SSE 事件流

`GET /api/events/stream` 返回 Server-Sent Events 流，推送以下事件类型：

| 事件类型 | 说明 |
| --- | --- |
| `task.created` | 任务创建 |
| `task.status_changed` | 任务状态变更 |
| `task.completed` | 任务完成 |
| `agent.session.started` | Agent 会话启动 |
| `agent.session.completed` | Agent 会话完成 |
| `change_package.generated` | Change Package 生成 |
| `review.submitted` | 评审提交 |
| `merge.approved` | 合并批准 |
| `merge.blocked` | 合并阻止 |
| `conflict.detected` | 冲突检测 |
| `audit.recorded` | 审计记录 |

---

## 错误响应

所有错误返回以下格式：

```json
{
  "error": "错误描述",
  "code": "ERROR_CODE",
  "details": {}
}
```

常见 HTTP 状态码：

| 状态码 | 含义 |
| --- | --- |
| 200 | 成功 |
| 201 | 创建成功 |
| 400 | 请求错误 |
| 401 | 未认证 |
| 403 | 无权限 |
| 404 | 未找到 |
| 500 | 服务器错误 |

---

## OpenAPI 规范

完整的 OpenAPI 3.0 规范见 [`openapi.json`](./openapi.json)，可用于：
- 生成客户端 SDK
- 导入 Swagger UI
- 集成到 API 网关
