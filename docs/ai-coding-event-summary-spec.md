# AI Coding 事件摘要设计规范

> 日期：2026-07-10
> 视角：AI Coding 大模型协同专业视角
> 目标：定义 Relay Hub 提交时必须携带的事件摘要内容，让跨机 Agent 协同的"上下文接力"真正可用
> 关联：[`git-native-sync.md`](./git-native-sync.md)、[`relay-deployment.md`](./relay-deployment.md)

---

## 一、核心问题：为什么需要独立设计事件摘要？

当前 SyncEvent payload 只包含任务元数据（taskId、title、objective、changedFiles 列表、riskLevel），从 AI Coding 协同视角看，**缺少 Agent 执行过程的上下文信息**。

### 1.1 跨机 Agent 协同的"上下文接力"问题

当 Hub-A（Windows）的 Agent 完成部分工作后，Hub-B（Mac）的 Agent 要接续时，它需要知道：

| 信息类别 | 当前是否同步 | 为什么 Agent 需要 |
|----------|:------------:|-------------------|
| 任务目标与范围 | ✅ 已同步 | 知道要做什么 |
| 修改了哪些文件 | ✅ 已同步 | 知道改了什么 |
| 风险等级 | ✅ 已同步 | 知道改动的风险 |
| **Agent 用了什么策略** | ❌ 缺失 | 避免重复尝试已失败的方案 |
| **Agent 改到哪一步** | ❌ 缺失 | 知道从哪里接续 |
| **为什么失败/卡住** | ❌ 缺失 | 避免重蹈覆辙 |
| **Agent 的模型与版本** | ❌ 缺失 | 不同模型能力不同，接续时需调整策略 |
| **执行时长与 token 消耗** | ❌ 缺失 | 评估任务复杂度，预估接续成本 |
| **修改意图（为什么改这个文件）** | ❌ 缺失 | 理解改动逻辑，避免误覆盖 |
| **未验证项与已知风险** | ⚠️ 部分 | 知道哪些没测、哪些有坑 |

### 1.2 设计原则

1. **只传摘要，不传源码**：安全第一，代码走 Git 平台
2. **Agent 可读，人类可审**：摘要既要让接续 Agent 理解，也要让人类 Reviewer 审查
3. **脱敏优先**：所有摘要经 ContextFeedPrivacyFilter 过滤
4. **增量传递**：只传变更部分，不重复传全量
5. **幂等**：相同事件不产生重复

---

## 二、AI Coding 事件摘要分类设计

从 AI Coding 生命周期视角，事件摘要分 5 类：

### 2.1 任务意图摘要（Task Intent Summary）

**已有**：taskId、title、objective、allowedPaths、forbiddenPaths、riskLevel

**需补充**：

```typescript
interface TaskIntentSummary {
  // 已有字段
  taskId: string;
  title: string;
  objective: string;
  allowedPaths: string[];
  forbiddenPaths: string[];
  riskLevel: string;
  riskDomains: string[];

  // 需补充：任务上下文
  background?: string;              // 任务背景（为什么做这个）
  acceptanceCriteria?: string[];    // 验收标准（怎样算完成）
  relatedIssues?: string[];         // 关联 issue/PR 链接
  parentTaskId?: string;            // 父任务（如果是拆分的子任务）
}
```

**为什么需要**：接续 Agent 需要知道"为什么做这个"和"怎样算完成"，否则会偏离原始意图。

### 2.2 Agent 执行摘要（Agent Execution Summary）— 核心新增

**当前完全缺失**。这是跨机 Agent 协同最关键的信息。

```typescript
interface AgentExecutionSummary {
  // Agent 身份
  agentId: string;                  // Agent 标识（claude-code/codex/generic）
  agentType: string;                // 适配器类型
  agentVersion?: string;            // Agent 版本（如 claude 1.2.0）
  model?: string;                   // 底层模型（如 gpt-4o, claude-3.5-sonnet）

  // 执行状态
  status: "completed" | "failed" | "timeout" | "canceled" | "partial";
  exitCode: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;

  // 执行过程摘要
  strategy?: string;                // Agent 采用的策略（如"先读测试再改实现"）
  stepsCompleted?: string[];        // 已完成的步骤摘要
  stepsRemaining?: string[];        // 未完成的步骤（partial 时关键）
  filesRead?: string[];             // Agent 读取过的文件（帮助接续 Agent 跳过重复阅读）
  commandsExecuted?: string[];      // 执行过的命令摘要（脱敏后）

  // 失败/卡住原因
  failureReason?: string;           // 失败原因（如"测试 test-xxx 失败：期望 A 实际 B"）
  blockedBy?: string;               // 被什么阻塞（如"依赖 xxx-api 未发布"）

  // 资源消耗
  tokenUsage?: {
    input?: number;
    output?: number;
    total?: number;
  };
  toolCalls?: number;               // 工具调用次数

  // Agent 自评
  selfAssessment?: string;          // Agent 对自身输出的评估（如"测试通过但未覆盖边界"）
  confidence?: "high" | "medium" | "low";  // Agent 对完成度的信心
}
```

**为什么需要**：
- `strategy` + `stepsCompleted`：接续 Agent 知道前一个 Agent 试过什么，避免重复
- `failureReason`：接续 Agent 知道为什么卡住，换策略
- `filesRead`：接续 Agent 跳过已读文件，节省 token
- `model` + `tokenUsage`：评估任务复杂度，预估接续成本
- `selfAssessment` + `confidence`：人类 Reviewer 判断是否需要介入

### 2.3 变更意图摘要（Change Intent Summary）

**已有**：changedFiles 列表、summary（如"3 files changed"）、riskLevel

**需补充**：

```typescript
interface ChangeIntentSummary {
  // 已有字段
  changedFiles: string[];
  summary: string;
  riskLevel: string;
  riskDomains: string[];
  insertions: number;
  deletions: number;

  // 需补充：变更意图
  changeIntents?: Array<{
    file: string;
    intent: string;                 // 为什么改这个文件（如"修复 token 过期未处理的分支"）
    changeType: "add" | "modify" | "delete" | "rename";
  }>;

  // 需补充：影响范围
  impactedAreas?: string[];         // 影响的功能区域（如"认证模块"、"用户API"）
  breakingChanges?: boolean;        // 是否有破坏性变更
  migrationNeeded?: boolean;        // 是否需要数据迁移
}
```

**为什么需要**：接续 Agent 需要理解"为什么改这个文件"，否则可能误覆盖前一个 Agent 的意图性改动。

### 2.4 验证状态摘要（Verification Status Summary）

**已有**：verificationSummary（passed/failed/skipped 计数）

**需补充**：

```typescript
interface VerificationStatusSummary {
  // 已有字段
  verificationSummary: {
    passed: number;
    failed: number;
    skipped: number;
  };

  // 需补充：失败详情
  failedChecks?: Array<{
    name: string;                   // 检查名（如"lint"、"test"）
    errorSummary: string;           // 错误摘要（脱敏后，前 N 行）
    failingTests?: string[];        // 失败的测试名
  }>;

  // 需补充：未验证项
  unverifiedItems?: string[];       // 已知未验证的项
  unverifiedReason?: string;        // 为什么没验证（如"依赖服务未启动"）
}
```

**为什么需要**：接续 Agent 需要知道哪些测试失败、失败原因，才能修复而非重跑。

### 2.5 交接上下文摘要（Handoff Context Summary）

**已有**：HandoffPackage（含 Context Feed）

**需补充**：

```typescript
interface HandoffContextSummary {
  // 交接类型
  handoffType: "adopt" | "continue" | "review";

  // 接续建议
  recommendedNextSteps?: string[];     // 建议接续 Agent 下一步做什么
  warnings?: string[];                 // 接续时需注意的事项
  avoidRepeating?: string[];           // 前一个 Agent 试过但失败的方案

  // 上下文引用
  contextFeedId?: string;              // Context Feed ID（可拉取完整上下文）
  previousAgentNotes?: string[];       // 前 Agent 的 Agent Notes 摘要
}
```

**为什么需要**：`avoidRepeating` 是跨机 Agent 协同的核心——避免接续 Agent 重复前一个 Agent 的失败尝试。

---

## 三、Relay Hub 提交时必须携带的内容清单

从 AI Coding 大模型视角，Relay Hub 在 `sync push` 时，每个 SyncEvent 的 payload 必须包含以下内容（按事件类型）：

### 3.1 task.created 事件

| 字段 | 必须 | 说明 |
|------|:----:|------|
| taskId | ✅ | 任务唯一标识 |
| title | ✅ | 任务标题 |
| objective | ✅ | 任务目标 |
| background | 推荐 | 任务背景 |
| allowedPaths | ✅ | 允许修改路径 |
| forbiddenPaths | ✅ | 禁止修改路径 |
| riskLevel | ✅ | 风险等级 |
| acceptanceCriteria | 推荐 | 验收标准 |
| parentTaskId | 可选 | 父任务 |

### 3.2 agent.session.completed 事件（新增事件类型）

| 字段 | 必须 | 说明 |
|------|:----:|------|
| taskId | ✅ | 关联任务 |
| agentId | ✅ | Agent 标识 |
| agentType | ✅ | 适配器类型 |
| model | 推荐 | 底层模型 |
| status | ✅ | 执行状态 |
| strategy | 推荐 | 采用的策略 |
| stepsCompleted | 推荐 | 已完成步骤 |
| stepsRemaining | **关键** | 未完成步骤（partial 时） |
| failureReason | **关键** | 失败原因 |
| filesRead | 推荐 | 读取过的文件 |
| tokenUsage | 可选 | token 消耗 |
| selfAssessment | 推荐 | Agent 自评 |
| confidence | 推荐 | 信心等级 |

### 3.3 change_package.created 事件

| 字段 | 必须 | 说明 |
|------|:----:|------|
| packageId | ✅ | 变更包 ID |
| taskId | ✅ | 关联任务 |
| changedFiles | ✅ | 修改文件列表 |
| changeIntents | **关键** | 每个文件的修改意图 |
| summary | ✅ | 变更摘要 |
| riskLevel | ✅ | 风险等级 |
| verificationSummary | ✅ | 验证统计 |
| failedChecks | 推荐 | 失败检查详情 |
| unverifiedItems | 推荐 | 未验证项 |
| impactedAreas | 推荐 | 影响范围 |
| breakingChanges | 推荐 | 是否破坏性 |

### 3.4 task.adopted / task.continued 事件

| 字段 | 必须 | 说明 |
|------|:----:|------|
| taskId | ✅ | 任务 ID |
| handoffType | ✅ | 交接类型 |
| recommendedNextSteps | **关键** | 建议下一步 |
| warnings | 推荐 | 注意事项 |
| avoidRepeating | **关键** | 避免重复的失败方案 |
| contextFeedId | 推荐 | Context Feed 引用 |

---

## 四、当前设计匹配度评估

| 摘要类别 | 当前匹配度 | 缺口 |
|----------|:----------:|------|
| 任务意图摘要 | 70% | 缺 acceptanceCriteria、parentTaskId |
| Agent 执行摘要 | **10%** | 几乎全缺，只有 status 和 exitCode |
| 变更意图摘要 | 40% | 缺 changeIntents、impactedAreas、breakingChanges |
| 验证状态摘要 | 60% | 缺 failedChecks 详情、unverifiedReason |
| 交接上下文摘要 | 50% | 缺 avoidRepeating、recommendedNextSteps |

**最大缺口**：Agent 执行摘要（10%）。当前 SyncEvent 不包含 Agent 的执行策略、步骤、失败原因、读取的文件等，导致接续 Agent 无法有效接力。

---

## 五、实施建议

### 5.1 优先级

| 优先级 | 摘要类别 | 理由 |
|--------|----------|------|
| P0 | Agent 执行摘要 | 跨机接续的核心，缺它则接力无效 |
| P0 | 交接上下文摘要（avoidRepeating） | 避免接续 Agent 重复失败 |
| P1 | 变更意图摘要 | 理解改动逻辑 |
| P1 | 验证状态摘要（失败详情） | 知道哪里没通过 |
| P2 | 任务意图摘要（补充字段） | 锦上添花 |

### 5.2 落地步骤

1. **扩展 SyncEvent payload 类型**：在 `packages/core/src/models/team-sync.ts` 增加 `AgentExecutionSummary` 等接口
2. **扩展 TeamSyncEventProducer**：在 Agent session 结束时产生 `agent.session.completed` 事件，携带执行摘要
3. **扩展 GenericCliAdapter/ClaudeCodeAdapter/CodexAdapter**：在 `AdapterRunResult` 中返回 strategy/steps/filesRead 等信息
4. **扩展 ChangePackageGenerator**：在生成 Change Package 时填充 changeIntents
5. **扩展 HandoffPackageBuilder**：填充 avoidRepeating 和 recommendedNextSteps
6. **ContextFeedBuilder 集成**：将执行摘要纳入 Context Feed Layer 1（efficiency）

### 5.3 隐私与安全

所有新增字段必须经 `ContextFeedPrivacyFilter` 脱敏：
- `failureReason`：脱敏错误信息中的文件路径、token、密码
- `commandsExecuted`：脱敏命令中的参数（如 `git push https://***@github.com/...`）
- `filesRead`：只传相对路径，不传内容
- `selfAssessment`：脱敏 Agent 输出中的敏感信息

---

## 六、结论

当前 Team Sync 的事件摘要设计**匹配了任务元数据同步，但不匹配 AI Coding 协同的上下文接力需求**。最大缺口是 Agent 执行摘要——接续 Agent 不知道前一个 Agent 试过什么、为什么失败、改到哪一步。

补充 Agent 执行摘要和交接上下文摘要（avoidRepeating）是 P0 优先级，完成后跨机 Agent 协同才能真正可用。否则接续 Agent 只是在"盲目接力"，而非"知情接力"。
