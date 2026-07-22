# 命名规范与项目边界（Naming Conventions）

> 项目：agentgitops
> 版本：v0.1（设计阶段）
> 关联文档：[`configuration.md`](./configuration.md)、[`release-checklist.md`](./release-checklist.md)

本文档定义 agentgitops 的统一命名规范、项目边界与开源发布前的名称冲突检查清单。

---

## 1. 项目名称

```
项目名称：agentgitops
```

所有衍生产物（CLI、包、镜像、目录、端口）统一使用 `agentgitops` 作为基础命名。

---

## 2. 统一命名规范

| 产物 | 命名 | 说明 |
| --- | --- | --- |
| CLI binary | `agentgitops` | 命令行可执行文件名 |
| NPM package | `agentgitops` | npm 发布包名 |
| GitHub repo | `agentgitops/agentgitops` | GitHub 仓库（org/user/repo） |
| Docker image | `agentgitops/server` | Docker Hub / GHCR 镜像名 |
| GHCR image | `ghcr.io/agentgitops/agentgitops` | GitHub Container Registry 镜像 |
| 配置目录 | `.agentgitops/` | 项目内配置与数据目录 |
| 配置文件 | `.agentgitops.yml` | 项目根配置文件 |
| worktree 根目录 | `.agentgitops-worktrees/` | worktree 存放目录（默认项目同级） |
| 本地数据库 | `.agentgitops/db.sqlite` | Local-first SQLite 数据库 |
| 默认端口 | `4789` | Web UI / Server 默认端口 |
| 环境变量前缀 | `AGENTGITOPS_` | 环境变量统一前缀 |
| 审计事件前缀 | `audit_` | AuditEvent ID 前缀 |

---

## 3. 内部命名约定

### 3.1 ID 前缀

| 实体 | ID 前缀 | 格式 | 示例 |
| --- | --- | --- | --- |
| Project | `proj_` | `proj_{slug}` | `proj_demo-web` |
| Agent | `agent_` | `agent_{name}` | `agent_claude-code` |
| Task | `task-` | `task-{YYYYMMDD}-{seq}` | `task-20260703-001` |
| Workspace | `ws_` | `ws_{taskId}` | `ws_task-20260703-001` |
| AgentSession | `sess_` | `sess_{uuid}` | `sess_a1b2c3d4` |
| ChangePackage | `pkg_` | `pkg_{taskId}` | `pkg_task-20260703-001` |
| VerificationRun | `verify_` | `verify_{uuid}` | `verify_e5f6g7h8` |
| Review | `review_` | `review_{uuid}` | `review_i9j0k1l2` |
| MergeRecord | `merge_` | `merge_{uuid}` | `merge_m3n4o5p6` |
| AuditEvent | `audit_` | `audit_{uuid}` | `audit_q7r8s9t0` |
| Conflict | `conflict_` | `conflict_{uuid}` | `conflict_u1v2w3x4` |

### 3.2 分支命名

| 分支类型 | 命名格式 | 示例 |
| --- | --- | --- |
| Agent 任务分支 | `agent/{task_id}/{agent_name}` | `agent/task-20260703-001/claude-code` |
| 保护分支 | `main`、`release/*` | `main`、`release/v1.0` |
| 开发分支 | `dev`、`feat/*` | `feat/add-cursor-adapter` |

### 3.3 目录命名

```
.agentgitops/                    # 配置与数据根目录
├─ config.yml                    # 配置文件（备选位置）
├─ db.sqlite                     # 本地数据库
├─ tasks/                        # 任务合同 YAML
├─ agents/                       # Agent 配置缓存
├─ packages/                     # Change Package JSON
├─ logs/                         # 日志
├─ skills/                       # Skill Pack
└─ worktrees/                    # （可选）worktree 目录
```

### 3.4 环境变量命名

| 环境变量 | 说明 |
| --- | --- |
| `AGENTGITOPS_CONFIG` | 配置文件路径 |
| `AGENTGITOPS_API` | Control Plane API 地址 |
| `AGENTGITOPS_TOKEN` | 认证 Token |
| `AGENTGITOPS_LOG_LEVEL` | 日志级别 |
| `AGENTGITOPS_PORT` | 端口 |
| `GITHUB_TOKEN` | GitHub Token |
| `GITLAB_TOKEN` | GitLab Token |
| `GITEA_TOKEN` | Gitea Token |

---

## 4. 项目边界

### 4.1 agentgitops 是什么

```
Code Agent 的任务管理系统
+ Code Agent 的本地工作区管理系统
+ Code Agent 的变更证据系统
+ Code Agent 的 Review Board
+ Code Agent 的 Merge Gate
+ Code Agent 的 AgentOps
```

### 4.2 agentgitops 不是什么

| 非目标 | 原因 |
| --- | --- |
| 不重新实现 Git | Git 已经足够成熟，agentgitops 只做上层治理 |
| 不替代 GitHub / GitLab | 初期应通过 API / Webhook 集成现有平台 |
| 不直接训练代码模型 | 项目定位是治理层，不是模型层 |
| 不做完整 IDE | 可通过 CLI / Web / 插件与 IDE 集成 |
| 不做全自动无人合并 | 高风险变更必须保留人类授权 |
| 不做复杂语义冲突的一步到位 | 先从文件风险域、依赖、接口、测试覆盖做起 |

### 4.3 产品主线

```
Task Contract
  → Workspace Isolation
  → Agent Execution
  → Change Package
  → Review Board
  → Merge Gate
  → Audit Replay
  → AgentOps
```

---

## 5. 名称冲突检查

正式开源发布前需要完成以下名称冲突检查：

| 检查项 | 状态 | 说明 |
| --- | --- | --- |
| GitHub repo 名称 | 待检查 | `agentgitops/agentgitops` 或 `agentgitops/agentgitops` |
| npm package 名称 | 待检查 | `agentgitops` 是否已被占用 |
| Docker Hub image 名称 | 待检查 | `agentgitops/server` 是否已被占用 |
| GHCR image 名称 | 待检查 | `ghcr.io/agentgitops/agentgitops` |
| PyPI 名称 | 待检查 | 若未来发布 Python SDK |
| 域名 | 待检查 | `agentgitops.dev` / `agentgitops.io` 是否可注册 |

### 5.1 已知相似项目

初步检索中可以看到已有 `gitops-agent` 一类项目，但它们更偏传统 GitOps agent（面向 Kubernetes 声明式部署），并不等同于面向 Code Agent 编程治理的 `agentgitops`。正式发布前仍需做完整名称冲突检查。

### 5.2 区分要点

| 维度 | gitops-agent（传统） | agentgitops（本项目） |
| --- | --- | --- |
| 目标对象 | Kubernetes 集群 | Code Agent（Codex/Claude Code/OpenCode 等） |
| 核心问题 | 声明式部署同步 | 多 Agent 并发编程治理 |
| 工作区 | 无 | 任务级 worktree 隔离 |
| 变更证据 | 无 | Change Package |
| 合并治理 | 无 | Merge Gate + Review Board |

---

## 6. 相关文档

| 文档 | 说明 |
| --- | --- |
| [`release-checklist.md`](./release-checklist.md) | 开源发布检查清单 |
| [`configuration.md`](./configuration.md) | 配置参考（目录与环境变量） |
| [`product-design.md`](./product-design.md) | 产品设计（项目边界与主线） |
