# 策略引擎设计（Policy Engine）

> 项目：agentgitops
> 版本：v0.1（设计阶段）
> 关联文档：[`architecture.md`](./architecture.md)、[`configuration.md`](./configuration.md)、[`security.md`](./security.md)

本文档定义 agentgitops 的 Policy Engine——负责系统级硬约束，确保 Code Agent 的行为符合团队策略。

---

## 1. 设计理念

### 1.1 Skill 是软约束，Policy 是硬约束

| 维度 | Skill | Policy Engine |
| --- | --- | --- |
| 性质 | 软约束（指导） | 硬约束（强制） |
| 执行方 | Agent 自主遵守 | 系统强制拦截 |
| 失败后果 | Agent 可能不遵守 | 违规即拦截 |
| 作用 | 告诉 Agent 怎么做 | 判断 Agent 能不能做 |

### 1.2 硬约束清单

```
强制每个任务独立 worktree
强制限制修改范围（allowed_paths / forbidden_paths）
强制禁止直接 push main
强制记录 Agent 执行过程
强制生成 Change Package
强制通过测试与扫描
强制高风险文件人工审批
强制所有合并经过 Merge Gate
```

---

## 2. 策略配置

策略通过 `.agentgitops.yml` 的 `policies` 段配置。

### 2.1 完整策略示例

```yaml
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
      - db/migrations/**
      - infra/**
      - .github/workflows/**
      - src/auth/**
      - src/payment/**

    forbidden_for_agents:
      - secrets/**
      - production.env
      - "*.pem"
      - "*.key"

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
      - name: unit-test
        command: npm test

  merge:
    allow_auto_merge_for_low_risk: true
    block_merge_if_unverified_items_exist: true
    block_merge_if_conflict_exists: true

  commands:
    forbidden:
      - "rm -rf"
      - "git push --force"
      - "DROP TABLE"
      - "sudo"

  limits:
    max_changed_files: 50
    max_insertions: 2000
    max_deletions: 1000
    task_timeout_minutes: 30
```

---

## 3. 策略规则详解

### 3.1 分支策略（branch）

| 规则 | 说明 |
| --- | --- |
| `protected` | 保护分支列表，Agent 不能直接 push |
| `deny_direct_push` | 禁止直接 push 的分支（Agent 分支必须通过 PR 合并） |

**执行点**：
- Agent 分支创建时校验 `targetBranch` 不等于保护分支
- PR 创建时校验目标分支
- Merge Gate 校验

### 3.2 路径策略（paths）

| 规则 | 说明 |
| --- | --- |
| `high_risk` | 高风险路径，修改需人工审批 |
| `forbidden_for_agents` | Agent 禁止修改的路径（如密钥、生产配置） |

**路径匹配**：使用 glob 语法（`**` 递归匹配，`*` 单层匹配）。

**执行点**：
- Change Package 生成时，扫描 `changedFiles`
- 若触碰 `forbidden_for_agents` → 生成失败，记录违规
- 若触碰 `high_risk` → 标记 `highRiskFilesTouched: true`，要求审批

### 3.3 审批策略（approval）

| 规则 | 说明 |
| --- | --- |
| `high_risk_paths_require_review` | 高风险路径修改是否必须人工审批 |
| `required_reviewers` | 路径 → 必须 Reviewer 映射 |

**执行点**：
- Review Board 展示必须 Reviewer
- Merge Gate 校验必须 Reviewer 是否已 Approve

### 3.4 检查策略（checks）

| 规则 | 说明 |
| --- | --- |
| `required` | 必跑检查列表（name + command） |

**执行点**：
- Verification Gate 运行所有必跑检查
- 任一必跑检查失败 → 不允许进入 reviewing

### 3.5 合并策略（merge）

| 规则 | 说明 |
| --- | --- |
| `allow_auto_merge_for_low_risk` | 低风险变更是否允许自动合并 |
| `block_merge_if_unverified_items_exist` | 存在未验证项时阻止合并 |
| `block_merge_if_conflict_exists` | 存在冲突时阻止合并 |

**执行点**：Merge Gate。

### 3.6 命令策略（commands）

| 规则 | 说明 |
| --- | --- |
| `forbidden` | 禁止 Agent 执行的命令（子串匹配） |

**执行点**：
- Trace Collector 监控 Agent 执行的命令
- 检测到禁止命令 → 记录违规，可选终止 Agent

### 3.7 限制策略（limits）

| 规则 | 说明 | 默认值 |
| --- | --- | --- |
| `max_changed_files` | 单任务最大修改文件数 | 50 |
| `max_insertions` | 单任务最大新增行数 | 2000 |
| `max_deletions` | 单任务最大删除行数 | 1000 |
| `task_timeout_minutes` | 任务超时时间（分钟） | 30 |

**执行点**：
- Change Package 生成时校验变更规模
- Agent 执行时超时控制

---

## 4. Policy Engine 架构

```
┌─────────────────────────────────────┐
│           Policy Config             │  (.agentgitops.yml)
└──────────────────┬──────────────────┘
                   ↓
┌─────────────────────────────────────┐
│           Policy Engine             │
│  ┌───────────┐  ┌────────────────┐  │
│  │ Path Risk │  │ Approval Rules │  │
│  └───────────┘  └────────────────┘  │
│  ┌───────────┐  ┌────────────────┐  │
│  │ Branch    │  │ Check Rules    │  │
│  │ Rules     │  │                │  │
│  └───────────┘  └────────────────┘  │
│  ┌───────────┐  ┌────────────────┐  │
│  │ Merge     │  │ Command Rules  │  │
│  │ Rules     │  │                │  │
│  └───────────┘  └────────────────┘  │
│  ┌───────────┐                      │
│  │ Limits    │                      │
│  └───────────┘                      │
└──────────────────┬──────────────────┘
                   ↓
┌─────────────────────────────────────┐
│         Evaluation Result           │
│  allowed / violations / riskLevel   │
└─────────────────────────────────────┘
```

### 4.1 核心接口

```ts
interface PolicyEngine {
  /** 加载策略配置 */
  load(config: PolicyConfig): void;

  /** 评估变更是否合规 */
  evaluate(input: PolicyEvaluationInput): PolicyEvaluationResult;

  /** 校验分支是否受保护 */
  isProtectedBranch(branch: string): boolean;

  /** 获取路径风险等级 */
  getPathRisk(filePath: string): "forbidden" | "high_risk" | "normal";

  /** 获取必须 Reviewer */
  getRequiredReviewers(changedFiles: string[]): string[];
}

interface PolicyEvaluationInput {
  changedFiles: string[];
  targetBranch: string;
  insertions: number;
  deletions: number;
  checksPassed: boolean;
  unverifiedItems: string[];
  hasConflict: boolean;
}

interface PolicyEvaluationResult {
  allowed: boolean;
  violations: PolicyViolation[];
  riskLevel: "low" | "medium" | "high" | "critical";
  requiresApproval: boolean;
  requiredReviewers: string[];
  canAutoMerge: boolean;
}

interface PolicyViolation {
  rule: string;        // 如 "forbidden_paths"
  file?: string;
  message: string;
  severity: "error" | "warning";
}
```

---

## 5. 风险等级评估

### 5.1 风险等级定义

| 等级 | 定义 | 合并策略 |
| --- | --- | --- |
| Low | 普通业务代码修改，测试通过 | 测试通过后允许自动合并或快速审批 |
| Medium | 涉及核心模块或中等风险域 | 必须至少一个 Owner Review |
| High | 触碰高风险路径（auth/payment/migration/infra） | 必须指定 Reviewer 审批，禁止自动合并 |
| Critical | 触碰禁止路径或危险命令 | 不允许 Agent 直接提交代码，只允许生成建议 |

### 5.2 风险评估规则

```
1. 若触碰 forbidden_for_agents → Critical
2. 若触碰 high_risk → High
3. 若 riskDomains 包含核心域（auth/payment/db）→ 至少 Medium
4. 若变更规模超限 → 提升一级
5. 若存在未验证项 → 不低于 Medium
6. 若检测到冲突 → 不低于 Medium
7. 否则 → Low
```

### 5.3 风险域（riskDomains）

Task Contract 中可声明 `riskDomains`，用于辅助风险评估：

```yaml
risk:
  level: medium
  domains:
    - auth
    - api
```

常见风险域：`auth`、`payment`、`db`、`api`、`infra`、`security`、`config`。

---

## 6. Merge Gate

Merge Gate 是 Policy Engine 在合并阶段的执行点。

### 6.1 合并门禁检查清单

```
□ 策略校验通过（无 forbidden 路径）
□ 所有必跑检查通过
□ 风险等级对应的审批已完成
□ 必须 Reviewer 已 Approve
□ 无未解决冲突
□ 无未验证项（若 block_merge_if_unverified_items_exist）
□ 变更规模在限制内
□ 目标分支非保护分支（或通过 PR 合并）
```

### 6.2 合并流程

```
Change Package 生成
→ Verification Gate（必跑检查）
→ Conflict Engine（冲突检测）
→ Review Board（人类审核）
→ Human Approval
→ Merge Gate（策略校验）
→ Merge Queue（排队）
→ Git Platform Merge（执行合并）
→ Audit Event（记录）
```

### 6.3 自动合并条件

当以下条件**全部**满足时，允许自动合并：

```
- riskLevel === "low"
- allow_auto_merge_for_low_risk === true
- 所有必跑检查通过
- 无冲突
- 无未验证项
- 变更规模在限制内
- approval.required === false（Task Contract 声明）
```

---

## 7. 策略违规处理

### 7.1 违规类型

| 违规 | 严重度 | 处理 |
| --- | --- | --- |
| 触碰禁止路径 | error | Change Package 生成失败，任务进入 `failed` |
| 触碰高风险路径 | warning | 标记需审批，进入 `reviewing` |
| 必跑检查未通过 | error | 不允许进入 `reviewing` |
| 执行禁止命令 | error | 记录违规，可选终止 Agent |
| 变更规模超限 | warning | 提升风险等级，需审批 |
| 直接 push 保护分支 | error | 拦截 push |

### 7.2 违规记录

所有策略违规记录为审计事件 `policy.violation`：

```json
{
  "eventType": "policy.violation",
  "actorType": "agent",
  "actorId": "agent:claude-code",
  "payload": {
    "taskId": "task-20260703-001",
    "rule": "forbidden_paths",
    "file": "secrets/api-key.pem",
    "message": "Forbidden path for agents: secrets/**"
  }
}
```

---

## 8. 策略优先级

当多个策略规则同时触发时，按优先级处理：

```
1. forbidden_for_agents（最高，直接拦截）
2. deny_direct_push
3. forbidden_commands
4. high_risk_paths
5. required_checks
6. required_reviewers
7. limits
8. merge_rules
```

---

## 9. 策略继承与覆盖

### 9.1 Team / Enterprise 版本

```
全局策略（组织级）
  ↓ 继承
项目策略（.agentgitops.yml）
  ↓ 覆盖
任务策略（Task Contract）
```

- 子级策略可以收紧父级策略（更严格）
- 子级策略不能放宽父级策略（如父级禁止的路径，子级不能允许）

### 9.2 策略合并规则

| 规则类型 | 合并方式 |
| --- | --- |
| `protected` / `deny_direct_push` | 并集（取所有层级） |
| `high_risk` / `forbidden_for_agents` | 并集 |
| `required_reviewers` | 并集 |
| `required` checks | 并集 |
| `limits` | 取最严格值（最小 max） |
| `allow_auto_merge_for_low_risk` | 取最严格值（false 优先） |

---

## 10. 相关文档

| 文档 | 说明 |
| --- | --- |
| [`configuration.md`](./configuration.md) | 配置参考（策略配置语法） |
| [`architecture.md`](./architecture.md) | 技术架构（Policy Engine 模块） |
| [`change-package.md`](./change-package.md) | Change Package（风险评估结果） |
| [`task-lifecycle.md`](./task-lifecycle.md) | 任务生命周期（blocked / merged） |
| [`security.md`](./security.md) | 安全设计 |
