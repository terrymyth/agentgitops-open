# Change Package 规范（Change Package Specification）

> 项目：agentgitops
> 版本：v0.1（设计阶段）
> 关联文档：[`data-model.md`](./data-model.md)、[`policy.md`](./policy.md)、[`task-lifecycle.md`](./task-lifecycle.md)

本文档定义 agentgitops 的 Change Package——每次 Agent 交付的标准证据包。Change Package 是 Review Board、Merge Gate、Audit Replay 的数据基础。

---

## 1. 设计目标

Change Package 解决的核心问题：

> Agent 产出的 PR 不应只是一段 Diff，而应是一份**带有任务目标、修改范围、测试证据、风险评估、未验证项和合并建议的完整证据包**。

让人类 Reviewer 能够：

```
看清楚 Agent 改了什么
看清楚 Agent 为什么改
看清楚改动的风险在哪
看清楚哪些已验证、哪些未验证
看清楚是否可以合并
```

---

## 2. Change Package 结构

### 2.1 完整 JSON 示例

```json
{
  "package_id": "pkg-task-20260703-001",
  "task_id": "task-20260703-001",
  "project_id": "proj_demo-web",
  "version": "1.0",
  "agent": {
    "name": "claude-code",
    "adapter": "generic-cli",
    "sessionId": "sess_a1b2c3d4"
  },
  "base_branch": "main",
  "target_branch": "agent/task-20260703-001/claude-code",
  "objective": "修复登录 token 过期时返回 500 的问题",
  "background": "用户 token 过期后接口应返回 401，而不是服务端异常。",
  "summary": "修改 token 校验错误处理逻辑，新增 token 过期测试。",
  "changed_files": [
    "src/auth/token.ts",
    "tests/auth/token-expired.test.ts"
  ],
  "stats": {
    "files_changed": 2,
    "insertions": 48,
    "deletions": 12
  },
  "diff_summary": {
    "src/auth/token.ts": {
      "insertions": 32,
      "deletions": 8,
      "hunks": 3
    },
    "tests/auth/token-expired.test.ts": {
      "insertions": 16,
      "deletions": 4,
      "hunks": 2
    }
  },
  "checks": [
    {
      "id": "verify_e5f6g7h8",
      "name": "npm test -- auth",
      "command": "npm test -- auth",
      "status": "passed",
      "duration_ms": 12034,
      "output_path": ".agentgitops/logs/task-20260703-001/verify-npm-test-auth.log",
      "started_at": "2026-07-03T04:00:10Z",
      "ended_at": "2026-07-03T04:00:22Z"
    },
    {
      "id": "verify_i9j0k1l2",
      "name": "npm run lint",
      "command": "npm run lint",
      "status": "passed",
      "duration_ms": 5811,
      "output_path": ".agentgitops/logs/task-20260703-001/verify-npm-run-lint.log",
      "started_at": "2026-07-03T04:00:22Z",
      "ended_at": "2026-07-03T04:00:28Z"
    }
  ],
  "risk": {
    "level": "medium",
    "domains": ["auth", "api"],
    "high_risk_files_touched": true,
    "forbidden_files_touched": false,
    "violations": []
  },
  "unverified_items": [
    "未运行完整 E2E 登录链路测试"
  ],
  "conflicts": [],
  "merge_recommendation": "需要 auth owner 审核后合并",
  "pr_url": "https://github.com/org/demo-web/pull/42",
  "pr_number": 42,
  "created_at": "2026-07-03T04:00:30Z"
}
```

### 2.2 字段说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `package_id` | string | 变更包唯一 ID |
| `task_id` | string | 关联任务 ID |
| `project_id` | string | 关联项目 ID |
| `version` | string | Change Package 规范版本 |
| `agent` | object | Agent 信息（name, adapter, sessionId） |
| `base_branch` | string | 基线分支 |
| `target_branch` | string | 目标分支 |
| `objective` | string | 任务目标 |
| `background` | string | 任务背景 |
| `summary` | string | 变更摘要（Agent 生成或人工填写） |
| `changed_files` | string[] | 修改文件列表 |
| `stats` | object | 变更统计（files_changed, insertions, deletions） |
| `diff_summary` | object | 每个文件的 diff 摘要 |
| `checks` | VerificationRun[] | 验证执行记录 |
| `risk` | RiskAssessment | 风险评估 |
| `unverified_items` | string[] | 未验证项 |
| `conflicts` | Conflict[] | 冲突信息 |
| `merge_recommendation` | string | 合并建议 |
| `pr_url` | string | PR / MR 链接 |
| `pr_number` | number | PR / MR 编号 |
| `created_at` | string | 创建时间 |

---

## 3. 风险评估（RiskAssessment）

```ts
type RiskAssessment = {
  level: "low" | "medium" | "high" | "critical";
  domains: string[];
  high_risk_files_touched: boolean;
  forbidden_files_touched: boolean;
  required_reviewers?: string[];
  violations: PolicyViolation[];
};
```

### 3.1 风险等级

| 等级 | 条件 | 合并策略 |
| --- | --- | --- |
| `low` | 普通业务代码，测试通过，无高风险路径 | 允许自动合并或快速审批 |
| `medium` | 涉及核心模块或中等风险域 | 必须至少一个 Owner Review |
| `high` | 触碰高风险路径（auth/payment/migration/infra） | 必须指定 Reviewer 审批 |
| `critical` | 触碰禁止路径或危险命令 | 不允许提交代码，只允许生成建议 |

### 3.2 评估流程

```
1. 扫描 changed_files
2. 匹配 forbidden_for_agents → 若命中 → critical
3. 匹配 high_risk → 若命中 → high
4. 检查 riskDomains → 核心域至少 medium
5. 检查变更规模 → 超限提升一级
6. 检查未验证项 → 存在则不低于 medium
7. 检查冲突 → 存在则不低于 medium
8. 汇总 violations
```

详见 [`policy.md`](./policy.md)。

---

## 4. 验证记录（VerificationRun）

```ts
type VerificationRun = {
  id: string;
  taskId: string;
  name: string;
  command: string;
  status: "passed" | "failed" | "skipped";
  exit_code?: number;
  duration_ms?: number;
  output_path?: string;
  output_summary?: {
    errors: number;
    warnings: number;
    tests_passed?: number;
    tests_failed?: number;
    tests_skipped?: number;
  };
  external_url?: string;
  started_at: string;
  ended_at?: string;
};
```

### 4.1 检查类型

| 类型 | 说明 | MVP |
| --- | --- | --- |
| 必跑命令检查 | `requiredChecks` 中的命令 | ✓ |
| 退出码检查 | 命令退出码为 0 | ✓ |
| 测试日志采集 | 采集测试输出并解析 errors/warnings/test counts | ✓ |
| GitHub Checks | 查询目标分支 CI 状态并记录外部链接 | ✓ |
| Lint 检查 | 代码规范检查 | ✓ |
| 变更范围检查 | 校验 changed_files 是否在 allowed_paths 内 | ✓ |
| 高风险文件检查 | 校验是否触碰 high_risk 路径 | ✓ |
| PR 描述完整性检查 | 校验 PR 描述是否包含必要信息 | ✓ |
| SAST | 静态应用安全测试 | 后续 |
| Secret Scan | 密钥扫描 | 后续 |
| Dependency Scan | 依赖漏洞扫描 | 后续 |
| License Scan | 许可证扫描 | 后续 |
| API Contract Test | API 契约测试 | 后续 |
| 性能回归 | 性能基准对比 | 后续 |
| 测试覆盖率比较 | 覆盖率不下降 | 后续 |

---

## 5. 未验证项（unverified_items）

未验证项是 Change Package 的关键透明性设计——**明确声明哪些没有验证**。

### 5.1 常见未验证项

```
未运行完整 E2E 登录链路测试
未在目标数据库环境验证 migration
未验证与其他 Agent 变更的兼容性
未运行性能基准测试
未覆盖边界条件 X
未在 Windows 环境验证
```

### 5.2 未验证项来源

| 来源 | 说明 |
| --- | --- |
| Agent 自主声明 | Agent 在执行过程中主动记录 |
| Skill 指导 | Testing Skill 要求 Agent 声明未验证项 |
| 系统检测 | 系统检测到测试未覆盖的变更路径 |
| 人工补充 | Reviewer 补充未验证项 |

### 5.3 合并影响

若策略 `block_merge_if_unverified_items_exist: true`，则存在未验证项时阻止自动合并，必须人工审批。

---

## 6. 冲突信息（Conflict）

```ts
type Conflict = {
  id: string;
  type: "same_file" | "same_risk_domain" | "dependency" | "migration" | "ci_config" | "high_risk_concurrent" | "api_contract" | "type_definition" | "schema" | "call_chain" | "test_coverage" | "permission_logic" | "dependency_version";
  conflicting_task_id: string;
  file_path?: string;
  severity: "low" | "medium" | "high";
  suggestion: "serial_merge" | "rebase" | "retest" | "human_takeover" | "mark_false_positive";
  status: "open" | "resolved";
};
```

详见 [`architecture.md`](./architecture.md) Conflict Engine 部分。

---

## 7. Change Package 生成流程

```
1. Agent 执行完成（running → testing）
2. Verification Gate 运行必跑检查
3. 采集 git diff（GitService.diff）
4. 统计 changed_files / insertions / deletions
5. Policy Engine 评估风险
6. Conflict Engine 检测冲突
7. 汇总未验证项
8. 生成 merge_recommendation
9. 写入 change-package.json
10. 持久化到 DB
11. 状态转移：testing → packaging → reviewing
```

### 7.1 生成接口

```ts
interface ChangePackageGenerator {
  generate(taskId: string): Promise<ChangePackage>;
}
```

### 7.2 存储位置

```
.agentgitops/packages/{task_id}.json
```

同时入库（SQLite / Postgres）。

---

## 8. PR 描述模板

创建 PR/MR 时，agentgitops 支持两类描述模板。

| 模板 | 适用场景 | 内容边界 |
| --- | --- | --- |
| `ce` | 单机开源版、本地任务、普通 PR/MR | 当前 Change Package + Evidence + Review Context Summary |
| `team-sync` | 多开发者、多 Local Hub、多 Agent 协作 | 在 `ce` 模板后追加 Team Sync Context、Collaboration Impact、Agent Context Feed 和 Sync State |

`ce` 是默认模板。`team-sync` 当前用于为 Team Sync MVP 预留结构化 PR/MR 描述入口；在 Team Control Plane 尚未启用时，模板必须明确显示 `local-only` / `disabled`，避免让 Reviewer 误以为上下文已经完成团队同步。

### 8.1 CE 单机模板

创建 PR 时，Change Package 摘要写入 PR 描述：

```markdown
## 🤖 Agent Change Package

**Task**: task-20260703-001
**Agent**: claude-code (generic-cli)
**Objective**: 修复登录 token 过期时返回 500 的问题

### Summary
修改 token 校验错误处理逻辑，新增 token 过期测试。

### Changed Files (2)
- `src/auth/token.ts` (+32 -8)
- `tests/auth/token-expired.test.ts` (+16 -4)

### Verification
| Check | Status | Duration |
| --- | --- | --- |
| npm test -- auth | ✅ passed | 12.0s |
| npm run lint | ✅ passed | 5.8s |

### Risk Assessment
- **Level**: 🟡 medium
- **Domains**: auth, api
- **High-risk files touched**: yes (src/auth/**)

### Unverified Items
- ⚠️ 未运行完整 E2E 登录链路测试

### Merge Recommendation
需要 auth owner 审核后合并

---
_Generated by agentgitops_
```

### 8.2 Team Sync 模板追加段

当 CLI 或 API 传入 `bodyTemplate=team-sync` 时，PR/MR 描述在 CE 模板后追加以下团队协作段落：

```markdown
### Team Sync Context
<!-- agentgitops:team-sync -->
- Team Project: `agentgitops`
- Task ID: `task-20260703-001`
- Parent / Related Tasks: `task-20260703-002`
- Continuation Of: `not_recorded`
- Adopted From: `not_recorded`
- Agent: `codex`
- Local Hub Instance: `not_recorded`
- Source Branch: `agent/task-20260703-001/codex`
- Base Branch: `main`
- Related Branches: `agent/task-20260703-001/codex`
- Related PRs: `none`

### Collaboration Impact
- Touched Domains: `auth`
- Overlapping Files: `src/auth/token.ts`
- Potential Conflict Signals: `same_file`
- Depends On: `none`
- Blocks: `none`

### Agent Context Feed
- Context Feed ID: `not_recorded`
- Generated At: `not_recorded`
- Source Change Packages: `pkg_task-20260703-001`
- Used By Agent: `unknown`
- Human Confirmation Required: `none`

### Sync State
- Sync Status: `local-only`
- Last Sync Cursor: `not_recorded`
- Team Control Plane: `disabled`
- Offline Changes: `unknown`
```

Team Sync 模板的设计原则：

- PR/MR body 只作为团队协作索引页，不承载完整审计事实源。
- Change Package 仍是单任务结构化证据源。
- Agent Context Feed 供 Code Agent 消费，必须经过摘要、脱敏和结构化边界控制。
- Team Control Plane 后续负责跨任务、跨分支、跨 Local Hub 的同步游标、冲突图和权限审计。
- 未接入真实 Team Sync 数据前，模板只能展示本地可推导信息和明确的 `not_recorded` / `local-only` 状态。

---

## 9. 合并建议（merge_recommendation）

系统根据风险评估自动生成合并建议：

| 风险等级 | 合并建议 |
| --- | --- |
| low | "测试通过，可自动合并" |
| medium | "需要至少一个 Owner 审核后合并" |
| high | "需要指定 Reviewer（@auth-owner）审批后合并" |
| critical | "不建议合并，请人工评估" |

---

## 10. Change Package 版本

```json
{
  "version": "1.0"
}
```

版本规则：
- `1.0`：MVP 版本，包含基础字段
- 后续版本向后兼容，新增字段为可选

---

## 11. 相关文档

| 文档 | 说明 |
| --- | --- |
| [`data-model.md`](./data-model.md) | 数据模型（ChangePackage 类型定义） |
| [`policy.md`](./policy.md) | 策略引擎（风险评估规则） |
| [`task-lifecycle.md`](./task-lifecycle.md) | 任务生命周期（packaging / reviewing） |
| [`api-reference.md`](./api-reference.md) | Change Package API |
| [`git-provider-integration.md`](./git-provider-integration.md) | PR 创建与描述注入 |
