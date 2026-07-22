# 配置参考（Configuration Reference）

> 项目：agentgitops
> 版本：v1 Release Candidate
> 关联文档：[`policy.md`](./policy.md)、[`adapters.md`](./adapters.md)、[`cli-reference.md`](./cli-reference.md)

本文档定义 agentgitops 的配置文件 `.agentgitops.yml` 的完整语法与所有选项。

---

## 1. 配置文件位置

| 文件 | 位置 | 说明 |
| --- | --- | --- |
| `.agentgitops.yml` | 项目根目录 | 项目级配置（主配置） |
| `.agentgitops/config.yml` | `.agentgitops/` 目录 | 备选位置 |
| `~/.agentgitops/config.yml` | 用户主目录 | 全局默认配置 |

**加载优先级**：项目根目录 > `.agentgitops/` 目录 > 用户主目录。

---

## 2. 完整配置示例

```yaml
version: 1

project:
  name: demo-web
  default_branch: main
  worktree_root: ../.agentgitops-worktrees

git:
  provider: github
  remote: origin
  path: git            # 可选，git 可执行文件路径

organization:
  name: demo-org
  policies:
    branch:
      protected:
        - main
        - release/*
    paths:
      forbidden:
        - secrets/**

agents:
  claude-code:
    type: generic-cli
    command: claude
    args:
      - "{{task_prompt_file}}"
    env: {}
    timeout_ms: 600000
    enabled: true

  codex:
    type: generic-cli
    command: codex
    args:
      - run
      - "--cwd"
      - "{{workspace_path}}"
      - "--task-file"
      - "{{task_prompt_file}}"
    enabled: true

  opencode:
    type: generic-cli
    command: opencode
    args:
      - "{{workspace_path}}"
    enabled: true

policies:
  branch:
    protected:
      - main
      - release/*
    deny_direct_push:
      - main
      - release/*

  paths:
    high_risk:
      - src/auth/**
      - src/payment/**
      - db/migrations/**
      - infra/**
      - .github/workflows/**
    forbidden:
      - secrets/**
      - "*.pem"
      - "*.key"
      - production.env

  approval:
    high_risk_paths_require_review: true
    required_reviewers:
      src/auth/**:
        - "@auth-owner"
      db/migrations/**:
        - "@db-owner"
      src/payment/**:
        - "@payment-owner"

  checks:
    required:
      - name: lint
        command: npm run lint
      - name: test
        command: npm test
    github:
      enabled: true
      require_success: true
      ref: target_branch

  merge:
    allow_auto_merge_for_low_risk: true
    block_merge_if_unverified_items_exist: true
    block_merge_if_conflict_exists: true

  commands:
    allowed:
      - node
      - pnpm
      - git
    forbidden:
      - "rm -rf"
      - "git reset --hard"
      - "git push --force"
      - "DROP TABLE"
      - "sudo"

  limits:
    max_changed_files: 50
    max_insertions: 2000
    max_deletions: 1000
    task_timeout_minutes: 30

change_package:
  include_diff_summary: true
  include_test_output: true
  include_unverified_items: true
  include_risk_assessment: true

ui:
  port: 4789
  host: localhost
  open_browser: true

security:
  web:
    require_actor: true
    owners:
      - your-username
    reviewers:
      - local-reviewer

extensions:
  enabled: false
  modules: []

enterprise:
  enabled: false
  license: ce
  licenseKeyEnv: AGENTGITOPS_LICENSE_KEY
  storage:
    type: sqlite
    url: .agentgitops/db.sqlite

workspace:
  archive_statuses:
    - merged
    - canceled
  cleanup_after_days: 14
  env:
    AGENTGITOPS_WORKSPACE_MODE: local

task_templates:
  frontend:
    agent: codex
    allowed_paths:
      - apps/web/**
      - packages/core/**
    required_checks:
      - pnpm --filter @agentgitops/web typecheck
    risk_level: medium

server:
  port: 4789
  host: localhost
  log_level: info

storage:
  db_path: .agentgitops/db.sqlite
  logs_dir: .agentgitops/logs
  packages_dir: .agentgitops/packages
  tasks_dir: .agentgitops/tasks

skills:
  - id: skill-testing-node
    name: Node.js Testing Skill
    scope:
      languages: [typescript, javascript]
    file: .agentgitops/skills/testing-node.md
```

---

## 3. 配置段详解

### 3.1 version

```yaml
version: 1
```

配置文件版本号。当前为 `1`。

### 3.2 project

```yaml
project:
  name: demo-web              # 项目名称
  default_branch: main        # 默认分支
  worktree_root: ../.agentgitops-worktrees  # worktree 根目录
```

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `name` | string | （目录名） | 项目名称 |
| `default_branch` | string | `main` | 默认分支 |
| `worktree_root` | string | `../.agentgitops-worktrees` | worktree 存放根目录 |

### 3.3 git

```yaml
git:
  provider: github    # github | gitlab | gitea | local
  remote: origin      # 远端名称
  path: git           # git 可执行文件路径（可选）
```

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `provider` | string | `github` | Git 平台类型 |
| `remote` | string | `origin` | Git 远端名称 |
| `path` | string | `git`（从 PATH） | git 可执行文件路径 |

### 3.4 agents

Agent 注册配置，详见 [`adapters.md`](./adapters.md)。

```yaml
agents:
  <agent-name>:
    type: generic-cli          # Adapter 类型
    command: claude            # 可执行命令
    args: [...]                # 命令参数模板
    env: {}                    # 环境变量
    timeout_ms: 600000         # 超时（毫秒）
    enabled: true              # 是否启用
```

**模板变量**：

| 变量 | 说明 |
| --- | --- |
| `{{workspace_path}}` | worktree 绝对路径 |
| `{{task_prompt_file}}` | 任务提示文件路径 |
| `{{task_id}}` | 任务 ID |
| `{{task_objective}}` | 任务目标 |
| `{{task_title}}` | 任务标题 |
| `{{base_branch}}` | 基线分支 |
| `{{target_branch}}` | 目标分支 |
| `{{project_root}}` | 项目根路径 |

### 3.5 policies

策略配置，详见 [`policy.md`](./policy.md)。

#### branch

```yaml
policies:
  branch:
    protected: [main, "release/*"]        # 保护分支
    deny_direct_push: [main, "release/*"] # 禁止直接 push
```

#### paths

```yaml
policies:
  paths:
    high_risk: [src/auth/**, db/migrations/**]      # 高风险路径
    forbidden: [secrets/**, "*.pem", "*.key"]       # 禁止路径
```

路径匹配使用 glob 语法：
- `**` 递归匹配任意层级
- `*` 匹配单层任意字符
- `?` 匹配单个字符
- `[abc]` 匹配字符集

#### approval

```yaml
policies:
  approval:
    high_risk_paths_require_review: true  # 高风险路径需审批
    required_reviewers:                   # 路径 → Reviewer 映射
      src/auth/**: ["@auth-owner"]
      db/migrations/**: ["@db-owner"]
```

#### checks

```yaml
policies:
  checks:
    required:
      - name: lint
        command: npm run lint
      - name: test
        command: npm test
    github:
      enabled: true              # 将 GitHub Checks API 状态纳入 VerificationRun
      require_success: true      # pending/failed/无检查均阻止通过
      ref: target_branch         # target_branch | base_branch
```

#### merge

```yaml
policies:
  merge:
    allow_auto_merge_for_low_risk: true              # 低风险允许自动合并
    block_merge_if_unverified_items_exist: true      # 有未验证项阻止合并
    block_merge_if_conflict_exists: true             # 有冲突阻止合并
```

#### commands

```yaml
policies:
  commands:
    allowed: ["node", "pnpm", "git"]       # 可选；配置后只有这些命令可执行
    forbidden: ["rm -rf", "git reset --hard", "git push --force", "DROP TABLE", "sudo"]
```

`policies.commands` 会在 Agent 启动和 Verification Gate 执行命令前硬拦截。`forbidden` 优先级高于 `allowed`，匹配命令名或完整命令字符串，支持 glob 风格 `*` / `**`。

#### limits

```yaml
policies:
  limits:
    max_changed_files: 50          # 单任务最大修改文件数
    max_insertions: 2000           # 单任务最大新增行数
    max_deletions: 1000            # 单任务最大删除行数
    task_timeout_minutes: 30       # 任务超时（分钟）
```

### 3.6 change_package

```yaml
change_package:
  include_diff_summary: true       # 包含 diff 摘要
  include_test_output: true        # 包含测试输出
  include_unverified_items: true   # 包含未验证项
  include_risk_assessment: true    # 包含风险评估
```

### 3.7 ui

```yaml
ui:
  port: 4789            # Web UI 端口
  host: localhost       # 监听地址
  open_browser: true    # 启动时自动打开浏览器
```

### 3.8 security

```yaml
security:
  web:
    require_actor: true      # Web 写操作要求声明 actor
    owners: [your-username]      # 可执行 provider merge、block、初始化等 owner 操作
    reviewers: [reviewer-1]  # 可评审、本地批准、处理低风险冲突、写 Agent Notes
```

当前 Web actor 是本地治理身份，用于审计和最小权限约束；企业部署需要接入真实认证系统。

### 3.9 organization

```yaml
organization:
  name: demo-org
  policies:
    branch:
      protected:
        - main
        - release/*
    paths:
      forbidden:
        - secrets/**
```

`organization.policies` 是项目策略的上级默认值。加载配置时，AgentGitOps 会把组织级策略与项目级 `policies` 合并：列表类字段去重合并，`limits`、`merge`、`checks.github` 等对象字段由项目级覆盖组织级。这个能力为企业版组织级策略下发预留兼容边界。

### 3.10 workspace

```yaml
workspace:
  archive_statuses:
    - merged
    - canceled
  cleanup_after_days: 14
  env:
    AGENTGITOPS_WORKSPACE_MODE: local
```

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `archive_statuses` | string[] | `merged,canceled` | `workspace sweep` 视为可归档的任务状态。 |
| `cleanup_after_days` | number | `14` | 任务 `updatedAt` 超过该天数后，清理已归档 worktree。 |
| `env` | map | `{}` | 注入 Agent 运行环境的工作区级变量，Agent 自身 env 优先级更高。 |

### 3.11 task_templates

```yaml
task_templates:
  frontend:
    agent: codex
    allowed_paths:
      - apps/web/**
      - packages/core/**
    required_checks:
      - pnpm --filter @agentgitops/web typecheck
    risk_level: medium
```

任务模板用于复用路径约束、必检命令、默认 Agent、风险等级和 reviewer。CLI 可通过 `agentgitops task create "title" --template frontend` 使用；Web/API 可在创建任务时传入 `template` 字段。显式参数优先级高于模板。

### 3.12 extensions

```yaml
extensions:
  enabled: true
  modules:
    - name: enterprise-audit
      package: "@agentgitops/ee-audit"
      enabled: true
    - name: enterprise-policy
      package: "@agentgitops/ee-policy"
      enabled: false
```

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | 是否启用扩展模块发现。 |
| `modules[].name` | string | - | 扩展模块唯一名称。 |
| `modules[].package` | string | - | 可选包名或模块标识，仅作为配置元数据。 |
| `modules[].enabled` | boolean | `true` | 单个模块是否启用；当顶层 `enabled: false` 时全部视为禁用。 |

开源版只读取并暴露扩展模块元数据，不会根据 `package` 动态加载代码。企业版或私有插件应通过 `ExtensionRegistry` 注入 `AuditSink`、`PolicyProvider`、`ConflictDetector`、`GitReviewProvider`、`MetricsSink` 等实现，保持 CE/EE 在运行时边界上的解耦。

### 3.13 enterprise

```yaml
enterprise:
  enabled: true
  license: enterprise
  licenseKeyEnv: AGENTGITOPS_LICENSE_KEY
  allowCeFallback: false
  storage:
    type: postgresql
    url: postgresql://user:pass@localhost:5432/agentgitops
    poolSize: 10
    timeoutMs: 5000
    ssl: false
  oidc:
    issuer: https://idp.example.com
    clientId: agentgitops
    audience: agentgitops
    jwksUri: https://idp.example.com/.well-known/jwks.json
  rbac:
    superAdmins:
      - platform-owner@example.com
  siem:
    siemType: splunk
    siemWebhookUrl: https://splunk.example.com/services/collector
    autoPush: true
  compliance:
    reportStorageDir: .agentgitops/compliance
```

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | 是否启用 Team/Enterprise 运行时扩展解析。为 `false` 时强制使用 CE 默认实现。 |
| `license` | enum | `ce` | 可选 `ce`、`team`、`enterprise`、`enterprise-plus`。 |
| `licenseKeyEnv` | string | `AGENTGITOPS_LICENSE_KEY` | 指向 license key 的环境变量名，避免密钥写入仓库。 |
| `allowCeFallback` | boolean | `false` | EE 组件启动失败时是否允许降级。生产建议保持 `false`，避免 PostgreSQL/SSO/RBAC 失效后静默回退。 |
| `storage.type` | enum | `sqlite` | EE 可切换为 `postgresql`，用于审计、合规等模块持久化。 |
| `oidc` / `saml` | object | - | 企业 SSO 配置。OIDC JWT 模式必须配置 `jwksUri`；introspection 模式必须配置 `useIntrospection: true` 和 `introspectionEndpoint`。 |
| `rbac` | object | - | 企业权限配置，运行时注入 AuthorizationProvider。 |
| `siem` | object | - | 不可篡改审计与 SIEM 推送配置。 |
| `compliance` | object | - | 合规报告输出配置。 |

环境变量优先级高于配置文件：`AGENTGITOPS_EDITION`、`AGENTGITOPS_LICENSE_KEY`、`AGENTGITOPS_STORAGE_TYPE`、`AGENTGITOPS_DATABASE_URL`、`AGENTGITOPS_OIDC_ISSUER`、`AGENTGITOPS_OIDC_CLIENT_ID`、`AGENTGITOPS_OIDC_JWKS_URI`、`AGENTGITOPS_OIDC_AUDIENCE`、`AGENTGITOPS_RBAC_SUPER_ADMINS`、`AGENTGITOPS_SIEM_*` 等会在 Server/CLI 启动时覆盖对应字段。

### 3.14 server

```yaml
server:
  port: 4789            # 服务端口
  host: localhost       # 监听地址
  log_level: info       # trace | debug | info | warn | error | fatal
```

### 3.15 storage

```yaml
storage:
  db_path: .agentgitops/db.sqlite       # 数据库路径
  logs_dir: .agentgitops/logs           # 日志目录
  packages_dir: .agentgitops/packages   # 变更包目录
  tasks_dir: .agentgitops/tasks         # 任务合同目录
```

### 3.16 skills

```yaml
skills:
  - id: skill-testing-node
    name: Node.js Testing Skill
    scope:
      languages: [typescript, javascript]
      paths: [src/**, tests/**]
    file: .agentgitops/skills/testing-node.md
```

详见 [`product-design.md`](./product-design.md) Skill Pack 部分。

---

### 3.17 team

Team Sync 配置，控制多机协同时事件摘要的同步范围和模式。

```yaml
team:
  sync:
    # 基础协同（默认开）
    tasks: true
    changedFiles: true
    riskLevel: true
    verification: true
    conflicts: true
    # 敏感内容（默认关）
    agentExecution: false
    failureReason: false
    filesRead: false
    tokenUsage: false
    # 可选内容
    agentNotes: false
    reviewContext: false
    handoff: false
    # 同步模式
    mode: manual          # manual | auto
    intervalSeconds: 60
    # git-native 专用配置
    gitNative:
      autoExport: true
      autoImportOnPull: true
      cleanupExported: true
```

#### syncMode（通过 `team init --sync-mode` 设置）

| 模式 | 说明 |
|------|------|
| `local` | 仅本地摘要，不网络同步（默认） |
| `git-native` | 通过 Git 仓库文件同步事件摘要（无需 Relay 服务器） |
| `relay` | 通过 Relay HTTP API 同步（需独立部署 Relay） |
| `hybrid` | 同时支持 git-native 和 relay |

#### git-native 模式

适用于无云服务器的双机 dogfood 场景。事件摘要通过 `.agentgitops/sync/outbox/` 目录的 JSON 文件同步，代码本身走标准 Git push/pull。

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `autoExport` | `true` | task 事件产生时自动导出到 outbox |
| `autoImportOnPull` | `true` | sync pull 时自动导入 outbox 中的新事件 |
| `cleanupExported` | `true` | 导出后清理已 pushed 的事件文件 |

详见 [`docs/git-native-sync.md`](./git-native-sync.md)。

---

## 4. 环境变量

配置可通过环境变量覆盖（优先级高于配置文件）：

| 环境变量 | 对应配置 | 说明 |
| --- | --- | --- |
| `AGENTGITOPS_CONFIG` | `--config` | 配置文件路径 |
| `AGENTGITOPS_API` | `--api` | API 地址 |
| `AGENTGITOPS_TOKEN` | `--token` | 认证 Token |
| `AGENTGITOPS_LOG_LEVEL` | `server.log_level` | 日志级别 |
| `AGENTGITOPS_PORT` | `server.port` / `ui.port` | 端口 |
| `GITHUB_TOKEN` | Git Provider | GitHub Token |
| `GITLAB_TOKEN` | Git Provider | GitLab Token |
| `GITEA_TOKEN` | Git Provider | Gitea Token |

---

## 5. 目录结构

`agentgitops init` 创建的目录结构：

```
project-root/
├─ .agentgitops.yml              # 主配置文件
├─ .agentgitops/
│  ├─ config.yml                 # 备选配置（可选）
│  ├─ db.sqlite                  # 本地数据库
│  ├─ tasks/                     # 任务合同
│  │  └─ task-20260703-001.yml
│  ├─ agents/                    # Agent 配置缓存
│  ├─ packages/                  # Change Package
│  │  └─ task-20260703-001.json
│  ├─ logs/                      # 日志
│  │  └─ task-20260703-001/
│  │     ├─ agent-stdout.log
│  │     └─ agent-stderr.log
│  └─ skills/                    # Skill Pack
│     └─ testing-node.md
│
../.agentgitops-worktrees/       # worktree 根目录
├─ demo-web-task-001-claude-code/
├─ demo-web-task-002-codex/
└─ demo-web-task-003-opencode/
```

---

## 6. 配置校验

`agentgitops doctor` 会校验配置：

```
✓ config: .agentgitops.yml (valid)
✓ project: demo-web
✓ git provider: github (token valid)
✓ agents: 3 registered (2 available)
✓ policies: valid
✓ storage: writable
```

常见配置错误：

| 错误 | 说明 |
| --- | --- |
| `version` 缺失 | 必须指定配置版本 |
| `project.name` 缺失 | 必须指定项目名称 |
| `agents` 为空 | 至少注册一个 Agent |
| `policies.paths.forbidden` 包含项目必要文件 | 误禁 |
| worktree_root 不可写 | 权限问题 |

---

## 7. 最小配置

最小可用配置：

```yaml
version: 1

project:
  name: my-project

git:
  provider: github

agents:
  generic:
    type: generic-cli
    command: echo
    args: ["{{task_objective}}"]

policies:
  branch:
    protected: [main]
```

---

## 8. 相关文档

| 文档 | 说明 |
| --- | --- |
| [`policy.md`](./policy.md) | 策略引擎（policies 段详解） |
| [`adapters.md`](./adapters.md) | Agent Adapter（agents 段详解） |
| [`cli-reference.md`](./cli-reference.md) | CLI 命令 |
| [`security.md`](./security.md) | 安全设计（Token 存储） |
