# 跨机器协作操作手册

> 日期：2026-07-15
> 适用范围：任何使用 AgentGitOps 管理 AI Coding 的 Git 仓库
> 关联文档：[`git-native-sync.md`](./git-native-sync.md)、[`relay-deployment.md`](./relay-deployment.md)

本手册覆盖三种跨机器协作模式，按基础设施成本从低到高排列。

---

## 模式一：无云服务器（当前可用）

### 1.1 适用场景

- 2-3 台个人开发机器（如公司 Windows + 家里 Mac）
- 无云服务器或内网服务器
- 通过 GitHub/GitLab 托管代码
- 低频协同（每天切换 1-2 次）

### 1.2 架构

```
机器A (公司)                          机器B (家里)
    │                                     │
    ├─ agentgitops task create            ├─ git pull
    ├─ agentgitops task start             ├─ agentgitops task resume
    ├─ ...开发...                         ├─ ...开发...
    ├─ agentgitops package                │
    ├─ agentgitops handoff generate       │
    ├─ agentgitops task closeout          │
    ├─ agentgitops sync push              │
    ├─ git add -f .agentgitops/          │
    └─ git push → GitHub ←── git pull ──┘
```

**同步媒介**：
- 代码 → GitHub/GitLab 标准 push/pull
- 事件摘要 → `.agentgitops/sync/outbox/` JSON 文件（随 Git 提交）
- 任务证据 → `.agentgitops/tasks/`、`packages/`、`closeouts/`、`handoffs/`（随 Git 提交）

### 1.3 首次接入流程

```bash
# 1. 确认 ago 命令可用
ago --version

# 2. 进入项目仓库
cd /path/to/your-project

# 3. 初始化 AgentGitOps
ago init --name your-project --git-provider github
ago project add .

# 4. 初始化 Team Sync（git-native 模式，无需云服务器）
ago team init --name your-team --sync-mode git-native

# 5. 注册 code agent
ago agent register codex --command codex
ago agent register claude-code --command claude

# 6. 检查环境
ago doctor
```

### 1.4 日常开发流程

**开始开发前（拉取）**：
```bash
git pull --ff-only
ago task reconcile
ago sync pull --git-pull
ago task resume <task-id> --recreate-worktree  # 如果有未完成的任务
```

**创建新任务**：
```bash
ago task create "任务标题" \
  --agent codex \
  --risk medium \
  --allow "src/**" "docs/**" \
  --check "npm test" "npm run build" \
  --objective "任务目标"
ago task start <task-id>
```

**开发中**：
```bash
# 在 worktree 中编辑代码
git -C <worktree> add <files>
git -C <worktree> commit -m "feat: xxx"
```

**离开前（收尾）**：
```bash
ago package <task-id> --from-git-diff
ago handoff generate <task-id>
ago task closeout <task-id> --auto-fix --push --record
ago sync push --auto-commit --cleanup
git push origin main
```

### 1.5 限制

- 无实时冲突感知（需 pull 后才发现）
- 无自动同步（需手动 sync push/pull）
- 适合 2-3 机，不适合大规模团队

---

## 模式二：有 Relay 服务器（未来）

### 2.1 适用场景

- 3+ 台开发机器或多成员团队
- 有一台内网或云服务器可部署 Relay
- 需要近实时同步（秒级延迟）
- 代码仍走 GitHub/GitLab

### 2.2 架构

```
机器A/B/C                              Relay 服务器
    │                                      │
    ├─ agentgitops task create             ├─ agentgitops server start --mode relay
    ├─ ...开发...                          ├─ 只暴露 /api/sync/* 和 /api/team/*
    ├─ agentgitops sync push ──────────→  ├─ 接收事件摘要
    │   (事件摘要 HTTP POST)              ├─ 游标管理
    │                                      ├─ 幂等去重
    ├─ agentgitops sync pull ←──────────  └─ 返回增量事件
    │   (事件摘要 HTTP GET)
    │
    └─ git push → GitHub ←── git pull (代码仍走 Git)
```

**同步媒介**：
- 代码 → GitHub/GitLab（不变）
- 事件摘要 → Relay HTTP API（实时，秒级）
- 任务证据 → Git 仓库（不变）

### 2.3 部署 Relay

```bash
# 在服务器上
git clone https://github.com/terrymyth/agentgitops-open.git
cd agentgitops
pnpm install && pnpm build

# 启动 Relay 模式
node apps/cli/dist/index.js server start --mode relay --host 0.0.0.0 --port 4790
```

### 2.4 接入流程

```bash
# 每台机器
ago team init --name your-team --relay-url http://relay-server:4790 --sync-mode relay --secret <team-secret>
# 或
ago team join --team-id <team-id> --relay-url http://relay-server:4790 --secret <team-secret>
```

### 2.5 日常流程

与模式一相同，但 `sync push/pull` 走 Relay HTTP 而非 Git 文件。支持 `auto` 模式自动定时同步。

### 2.6 优势

- 实时冲突感知（秒级）
- 自动同步（`sync.mode: auto`）
- 支持多成员团队
- Relay 只存事件摘要（KB 级），不存代码

---

## 模式三：云端 Control Plane（未来）

### 3.1 适用场景

- 多团队、多项目、多组织
- 需要统一任务状态、审计、策略、RBAC
- 需要团队看板、提醒、自动化
- 企业级治理需求

### 3.2 架构

```
云端 Control Plane
├─ 任务状态中心（PostgreSQL）
├─ 审计链（不可篡改）
├─ 策略中心（组织级策略继承）
├─ RBAC/SSO（OIDC/SAML）
├─ SIEM（安全事件推送）
├─ 团队看板（Web）
├─ Webhook（GitHub/GitLab 集成）
└─ Relay（事件中转）

机器A/B/C/D...
├─ Local Hub（本地治理）
├─ sync push/pull → 云端 Relay
├─ git push → GitHub
└─ Web UI → 云端看板
```

### 3.3 部署

```bash
# 云端服务器
docker-compose up -d  # PostgreSQL + Relay + Web
# 或 Kubernetes
helm install agentgitops deploy/helm/
```

### 3.4 接入流程

```bash
# 管理员初始化组织
ago team init --name org-team --relay-url https://ago.example.com --sync-mode hybrid --secret <secret>

# 成员加入
ago team join --team-id <team-id> --relay-url https://ago.example.com --secret <secret>
```

### 3.5 日常流程

与模式二相同，但增加了：
- 云端 Web 看板（团队级任务视图）
- 自动化策略（组织级策略继承）
- 审计链（不可篡改的操作记录）
- RBAC（角色权限控制）
- Webhook 集成（PR 状态自动同步）

### 3.6 优势

- 企业级治理
- 统一事实源
- 团队可视化
- 安全合规

---

## 三种模式对比

| 维度 | 模式一（无云） | 模式二（Relay） | 模式三（云端） |
|------|:------------:|:--------------:|:------------:|
| 基础设施 | 无 | 1 台服务器 | 云端集群 |
| 实时性 | 低（手动） | 高（秒级） | 高（秒级） |
| 多机扩展 | 2-3 机 | N 机 | N 团队 |
| 冲突感知 | 离线 | 实时 | 实时 |
| 自动同步 | ❌ | ✅ | ✅ |
| 团队看板 | ❌ | ❌ | ✅ |
| RBAC/SSO | ❌ | ❌ | ✅ |
| 审计链 | 本地 | Relay | 不可篡改 |
| 成本 | 免费 | 低 | 中-高 |

---

## 通用规则（三种模式都适用）

### 每次开发必须创建 task

无论是哪种模式，每次功能开发或修复都必须通过 task 模式管理：
```bash
ago task create "描述" --agent <agent> --allow <paths> --check <checks>
ago task start <task-id>
# ...开发...
ago package <task-id> --from-git-diff
ago handoff generate <task-id>
ago task closeout <task-id> --auto-fix --push --record
ago sync push --auto-commit --cleanup
```

### Git 是代码事实源

所有模式中，代码变更都通过 Git push/pull 同步。Relay 和云端只同步事件摘要，不传输源码。

### 离开地点前必须 closeout

执行 `ago task closeout --record` 生成 closeout 记录，确保另一台机器能通过 `ago task resume` 恢复。

### 敏感信息不进入 Git

outbox/handoff/package 写入前经过隐私扫描，token/密钥/JWT 等被自动过滤。
