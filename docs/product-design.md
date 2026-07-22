# 产品设计文档（Product Design）

> 项目：agentgitops
> 版本：v0.1（设计阶段）
> 关联文档：[`architecture.md`](./architecture.md)、[`configuration.md`](./configuration.md)

---

## 1. 产品定位

### 1.1 一句话定义

> **agentgitops 是一个面向 Code Agent 的 GitOps 管理系统，用于把多个 Code Agent 的代码任务、工作区、分支、变更、测试、评审、合并和审计统一纳入可视化、可验证、可治理的研发流程。**

口语化表达：

```
让多个 Code Agent 可以并行写代码，
但让每一行进入主干的代码都可解释、可验证、可审计、可回滚。
```

### 1.2 产品形态

```
Local-first + Server Control Plane + Web UI + Git Platform Integration
```

### 1.3 协议

Apache-2.0（开源友好，含专利授权条款，适合基础设施类项目）。

---

## 2. 背景与问题

### 2.1 行业趋势

Code Agent 正在从"辅助写代码"升级为"自主执行研发任务"。开发者可以同时让多个 Agent 处理 Bug 修复、测试补齐、依赖升级、重构、代码解释、PR 修复等任务。

传统协作链路（面向人类）：

```
人类开发者 → 分支 → Commit → PR / MR → Review → Merge
```

Agent 时代协作链路：

```
人类提出目标
→ 多个 Code Agent 并发执行
→ 多个工作区同时修改代码
→ 多个分支 / PR 同时产生
→ 自动测试 / 自动修复 / 自动 Review
→ 人类进行最终审核与授权合并
```

### 2.2 核心问题

| 问题 | 表现 | 影响 |
| --- | --- | --- |
| 工作区混乱 | 多个 Agent 同时修改同一个项目目录，文件互相覆盖 | 代码丢失、不可复现 |
| 分支混乱 | 大量 agent 临时分支、临时 commit、临时 PR 难以管理 | 仓库污染、清理成本高 |
| 上下文混乱 | 每个 Agent 对项目结构、任务范围、当前变更状态理解不同 | 改错地方、越权修改 |
| 冲突混乱 | 不仅有 Git 文本冲突，还有接口、依赖、权限、业务逻辑等语义冲突 | 合并后线上故障 |
| Review 压力 | Agent 产出 PR 速度远超人类 Review 吞吐能力 | Review 积压、质量下降 |
| 合并风险 | Agent 生成代码可能通过局部测试，但破坏全局链路 | 局部绿、全局红 |
| 审计缺失 | 很难追溯哪段代码由哪个 Agent、基于哪个任务、经过哪些验证后进入主干 | 合规风险、无法追责 |
| Skill 边界不足 | Skill 可以指导 Agent 遵循规范，但不能强制拦截越权修改和危险合并 | 软约束不可靠 |

### 2.3 核心判断

> Git 本身仍然是代码事实底座，但 Code Agent 时代需要新增一个 **Agentic GitOps Control Plane**，作为 Code Agent 与 Git 平台之间的任务治理、工作区治理、变更治理和合并治理层。

这与企业级智能体平台从 "Agent Builder" 升级到 "AI Native Agent Platform" 的趋势一致：平台竞争点正在从"能不能搭建智能体"转向"能不能稳定、可信、持续地把事情做成"。智能体平台需要运行空间、Harness、评测观测、安全合规、人在回路和经验沉淀等系统化能力，而不是只靠 Prompt 或 Skill 约束。

---

## 3. 设计理念

### 3.1 Git 是代码事实层，agentgitops 是 Agent 治理层

agentgitops 不重新发明 Git，也不直接替代 GitHub / GitLab / Gitea。

```
Code Agent Runtime
    ↓
agentgitops Local Hub / Control Plane
    ↓
GitHub / GitLab / Gitea / Gerrit
    ↓
Git Repository
```

| 层级 | 责任 |
| --- | --- |
| Git | 代码版本事实、Commit、Branch、Tag |
| GitHub / GitLab / Gitea | PR / MR、权限、CI、Review、Webhook |
| agentgitops | Agent 任务、工作区、变更包、冲突治理、评审证据、合并门禁、审计回放 |
| Code Agent | 理解任务、修改代码、运行命令、生成 PR |
| Skill / Prompt | 提供编码规范、测试规范、Review 规范、仓库理解方法 |

Git 官方 worktree 能力支持一个仓库关联多个工作树，从而同时 checkout 多个分支；Claude Code 官方文档也建议每个 session 使用独立 worktree，以避免不同 session 的编辑互相影响。agentgitops 将这种能力产品化为**任务级工作区管理**。

### 3.2 Skill 是软约束，agentgitops 是硬约束

Skill 可以告诉 Agent：

```
应该如何理解仓库
应该如何写代码
应该如何补测试
应该如何写 PR 描述
应该避免修改哪些文件
```

但 Skill **不能强制保证** Agent 一定遵守。

agentgitops 提供的是**系统级硬约束**：

```
强制每个任务独立 worktree
强制限制修改范围
强制禁止直接 push main
强制记录 Agent 执行过程
强制生成 Change Package
强制通过测试与扫描
强制高风险文件人工审批
强制所有合并经过 Merge Gate
```

这对应 Harness Engineering 的基本判断：Agent 可靠性不能只靠 Prompt，而要依赖模型外部的运行时软件基础设施，包括工具调度、上下文管理、安全执行、状态维护、评测和观测。

### 3.3 一个任务一个工作区，一个变更一个证据包

agentgitops 不允许多个 Agent 直接在同一个项目根目录里并发乱改。

正确模型：

```
Project
├─ main workspace：人类开发者主工作区
├─ task workspace 001：Codex 执行 Bug 修复
├─ task workspace 002：Claude Code 执行测试补齐
├─ task workspace 003：OpenCode 执行重构
└─ task workspace 004：Cursor 执行 PR 修复
```

每个任务输出一个标准化 Change Package：

```
Change Package
├─ 任务目标
├─ 任务范围
├─ Agent 信息
├─ 修改文件
├─ Diff 摘要
├─ 测试证据
├─ 安全扫描结果
├─ 风险等级
├─ 未验证项
├─ 冲突提示
├─ PR / MR 链接
└─ 合并建议
```

### 3.4 人类使用可视化界面，Agent 使用自动化接口

agentgitops 必须同时服务两类用户：

| 用户 | 使用方式 |
| --- | --- |
| 人类开发者 / Reviewer / 架构师 | Web UI / TUI / IDE 插件，用于监控、审核、批准、接管 |
| Code Agent | CLI / Local Daemon / MCP Server / HTTP API，用于自动注册任务、上报状态、创建变更包、请求合并 |

系统界面不是给 Agent "手动点击"的，而是给人类做**透明治理**的。

大部分操作由 Agent 自动完成：

```
自动注册 Agent Session
自动创建 Task Workspace
自动采集文件变更
自动运行测试
自动生成 Change Package
自动推送分支
自动创建 PR
自动更新任务状态
```

人类主要处理：

```
查看全局项目看板
审查高风险变更
确认冲突处理建议
批准 / 拒绝合并
接管失败任务
查看审计回放
维护策略规则
```

---

## 4. 产品目标与非目标

### 4.1 产品目标

agentgitops 第一阶段要解决：

1. **统一任务登记**：所有 Agent 任务都有 Task Contract。
2. **统一工作区隔离**：每个 Agent 任务都有独立 worktree / workspace。
3. **统一 Agent 接入**：支持 Codex、Claude Code、OpenCode 等通过 Adapter 接入。
4. **统一变更追踪**：采集 Agent 修改文件、执行命令、测试结果、最终 Diff。
5. **统一变更包**：每个任务生成标准 Change Package。
6. **统一可视化看板**：人类可以看到项目内所有 Agent 任务状态。
7. **统一评审证据**：PR 不再只是 Diff，而是带有任务目标、风险、验证结果。
8. **统一合并门禁**：低风险可自动化，高风险必须人类审核。
9. **统一审计回放**：能够追溯 Agent 从任务输入到代码合并的全过程。

### 4.2 非目标

MVP 阶段不做：

| 非目标 | 原因 |
| --- | --- |
| 不重新实现 Git | Git 已经足够成熟，agentgitops 只做上层治理 |
| 不替代 GitHub / GitLab | 初期应通过 API / Webhook 集成现有平台 |
| 不直接训练代码模型 | 项目定位是治理层，不是模型层 |
| 不做完整 IDE | 可通过 CLI / Web / 插件与 IDE 集成 |
| 不做全自动无人合并 | 高风险变更必须保留人类授权 |
| 不做复杂语义冲突的一步到位 | 先从文件风险域、依赖、接口、测试覆盖做起 |

---

## 5. 用户与角色

### 5.1 用户画像

| 角色 | 描述 | 核心诉求 |
| --- | --- | --- |
| **个人开发者 / OSS 维护者** | 独立使用多个 Agent 加速开发 | 本地隔离、不污染仓库、可回滚 |
| **团队 Tech Lead** | 3–30 人团队，管理多个 Agent 并发 | 统一看板、Review Board、合并门禁 |
| **Reviewer** | 负责审核 Agent 产出的 PR | 高效审核、证据充分、风险可见 |
| **平台 / DevOps 工程师** | 企业内部研发体系建设 | 策略治理、审计合规、多团队管理 |
| **Code Agent** | 自动化执行者 | 标准化接入、工作区隔离、状态上报 |

### 5.2 权限模型（RBAC）

| 角色 | 典型权限 |
| --- | --- |
| Viewer | 查看看板、Review Board、审计 |
| Developer | 创建任务、运行 Agent、创建 Change Package、创建 PR |
| Reviewer | Developer 权限 + Approve / Reject / Request Changes |
| Owner | Reviewer 权限 + 策略配置、合并授权、Merge Queue 管理 |
| Admin | Owner 权限 + 项目管理、用户管理、Agent 注册 |

> MVP 阶段以 Local-first 为主，权限模型简化为单用户。Team / Enterprise 版本启用完整 RBAC。

---

## 6. 核心产品概念

### 6.1 Task Contract（任务合同）

每个 Agent 任务的标准化契约，定义目标、范围、约束、风险、审批规则。是 agentgitops 的核心对象。详见 [`change-package.md`](./change-package.md) 与 [`data-model.md`](./data-model.md)。

### 6.2 Agent Workspace（工作区）

基于 `git worktree` 的任务级隔离工作区。Agent 只能在自己的 workspace 内修改代码。详见 [`architecture.md`](./architecture.md)。

### 6.3 Change Package（变更包）

每次 Agent 交付的标准证据包，包含 diff、测试、风险、未验证项、合并建议。详见 [`change-package.md`](./change-package.md)。

### 6.4 Review Board（评审看板）

Web UI 核心页面，不是普通 PR Diff 页面，而是 Agent 变更证据中心。详见第 8 节。

### 6.5 Merge Gate（合并门禁）

风险分级合并策略，决定变更能否进入主干。详见 [`policy.md`](./policy.md)。

### 6.6 Policy Engine（策略引擎）

系统级硬约束：保护分支、禁止路径、必跑检查、审批规则。详见 [`policy.md`](./policy.md)。

### 6.7 Conflict Engine（冲突引擎）

跨 Agent 冲突检测，分轻量检测与语义检测两阶段。详见 [`architecture.md`](./architecture.md)。

### 6.8 Audit & Replay（审计回放）

完整追溯 Agent 从任务输入到代码合并的全过程。详见 [`security.md`](./security.md)。

### 6.9 AgentOps（运营指标）

长期运营治理指标：成功率、合并率、冲突率、接管率。详见第 9 节。

---

## 7. 产品主线

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

这是 agentgitops 的第一版产品架构主线，每个环节都对应一个核心模块。

---

## 8. 可视化界面设计

### 8.1 页面一：Project Dashboard（项目总览）

用途：项目总览。

展示：

```
项目名称
当前活跃 Agent 任务数
活跃工作区数
待 Review 变更数
冲突风险数
Merge Queue 数量
高风险变更数量
CI 失败任务
最近合并任务
```

### 8.2 页面二：Agent Task Board（任务看板）

用途：所有 Agent 任务看板。

列：

```
Backlog → Planning → Running → Testing → Packaging → Reviewing → Blocked → Merged → Failed → Canceled
```

每个任务卡片展示：

```
任务标题
Agent 名称
工作区
风险等级
修改文件数
测试状态
PR 状态
冲突提示
```

### 8.3 页面三：Workspace Map（工作区地图）

用途：查看所有 worktree / workspace。

展示：

```
workspace path
task_id
agent_name
base_branch
target_branch
status
last_activity
changed_files
dirty state
```

### 8.4 页面四：Review Board（评审看板）

用途：人类审核 Agent 变更。

展示：

```
任务目标
Agent 执行摘要
Change Package
Diff
测试证据
风险说明
未验证项
冲突关系
人工审批按钮
```

人类 Reviewer 的关键动作：

```
Approve
Reject
Request Changes
Ask Agent to Fix
Escalate to Human Owner
Mark as High Risk
Add Required Check
```

### 8.5 页面五：Conflict Center（冲突中心）

用途：集中查看跨 Agent 冲突。

冲突类型：

```
同文件冲突
同风险域冲突
依赖冲突
Migration 冲突
API 契约冲突
测试覆盖冲突
```

操作：

```
建议串行合并
建议 rebase
建议重新测试
建议人工接管
标记为误报
```

### 8.6 页面六：Merge Queue（合并队列）

用途：合并队列管理。

展示：

```
等待合并的 Change Package
风险等级
检查状态
审批状态
冲突状态
建议合并顺序
```

操作：

```
Approve Merge
Block Merge
Re-run Checks
Rebase
Ask Agent to Fix
```

### 8.7 页面七：Policy Center（策略中心）

用途：维护策略。

功能：

```
高风险路径配置
Agent 权限配置
必跑测试配置
Review 规则配置
自动合并规则配置
禁止命令配置
敏感文件配置
```

### 8.8 页面八：AgentOps（运营看板）

用途：长期运营。

展示：

```
Agent 质量排行
Agent 成功率趋势
PR 合并率趋势
失败原因分布
高风险拦截统计
Review 时间统计
冲突热区
仓库风险热区
```

### 8.9 页面九：Audit & Replay（审计回放）

用途：审计回放。

展示：

```
任务创建时间
Agent 启动时间
读取文件
修改文件
执行命令
测试结果
生成 Commit
创建 PR
Review 记录
合并记录
```

---

## 9. AgentOps 指标体系

AgentOps 用于长期运营治理。

| 指标 | 说明 |
| --- | --- |
| Agent 任务数 | 每个 Agent 累计执行的任务总数 |
| Agent 成功率 | 任务最终 merged / 总任务数 |
| Agent PR 创建数 | 每个 Agent 创建的 PR 数 |
| Agent PR 合并率 | 合并 PR / 创建 PR |
| Agent PR 被拒率 | 被拒 PR / 创建 PR |
| CI 首次通过率 | 首次 CI 通过 / 总 PR |
| 平均修复轮次 | 从 Request Changes 到再次提交的平均轮次 |
| 平均 Review 时间 | 从 PR 创建到 Review 完成的平均时间 |
| 高风险变更数 | 标记为 high/critical 的变更数 |
| 高风险拦截数 | 被 Merge Gate 拦截的高风险变更数 |
| 冲突率 | 涉及冲突的任务 / 总任务 |
| 回滚率 | 合并后被回滚的 PR / 总合并 PR |
| 人工接管率 | 被人类接管的失败任务 / 总任务 |
| 平均任务耗时 | 每个 Agent 的平均任务执行时间 |
| 平均变更规模 | 每个 Agent 的平均文件变更数 / 代码行数 |

---

## 10. Skill Pack（技能包）

Skill 不是 agentgitops 的硬约束系统，但可以作为 Agent 执行经验资产。

建议内置：

```
Repo Understanding Skill
Coding Convention Skill
Testing Skill
Review Self-check Skill
PR Description Skill
Bug Fix Skill
Refactor Skill
Migration Safety Skill
Security Review Skill
```

Skill 的执行逻辑：

```
Skill 指导 Agent 怎么做
Policy Engine 判断能不能做
Verification Gate 验证是否做到
Review Board 让人类看清楚结果
```

---

## 11. 部署形态

### 11.1 Local-first 单机版

适合个人开发者和开源项目维护者。

```
agentgitops CLI
+ Local Hub
+ SQLite
+ Local Web UI
+ GitHub/GitLab Token
```

能力：本地多 Agent 任务管理、本地 worktree 隔离、本地任务看板、本地 Change Package、本地 PR 创建。

### 11.2 Team Hybrid 团队版

适合 3—30 人研发团队。

```
Local Hub
+ Team Control Plane
+ Postgres
+ Web Review Board
+ GitHub / GitLab Webhook
+ Merge Gate
```

能力：团队共享项目看板、统一 Agent 任务登记、统一策略、统一 Review Board、统一 Merge Queue、统一审计。

### 11.3 Enterprise 私有化版

适合企业内部研发体系。

```
Private Control Plane
+ 多项目 / 多团队 / 多仓库
+ SSO / RBAC
+ 审计留存
+ Policy Engine
+ 高可用部署
+ GitHub Enterprise / GitLab Self-managed / Gitea 集成
```

能力：组织级 Code AgentOps、多团队策略治理、高风险合并审批、安全合规报表、Agent 质量分析。

---

## 12. 典型用户旅程

### 旅程一：个人开发者本地多 Agent 并发

```
1. agentgitops init
2. agentgitops agent register claude-code --command claude
3. agentgitops agent register codex --command codex
4. agentgitops task create "Fix token expired 500" --agent claude-code
5. agentgitops task create "Add unit tests for auth" --agent codex
6. agentgitops run --agent claude-code --task task-001
7. agentgitops run --agent codex --task task-002   (并发)
8. agentgitops status   (查看两个任务状态)
9. agentgitops package task-001
10. agentgitops pr task-001
11. agentgitops web   (打开本地看板审核)
```

### 旅程二：团队 Reviewer 审核 Agent PR

```
1. 打开 Web Review Board
2. 看到 task-001 的 Change Package
3. 查看任务目标、修改文件、测试证据、风险等级
4. 发现修改了 src/auth/**（高风险路径）
5. 查看未验证项：未运行完整 E2E
6. 点击 Request Changes，要求补充 E2E 测试
7. Agent 收到反馈，自动重新执行并补充测试
8. Reviewer 再次审核，Approve
9. 进入 Merge Queue，通过 Merge Gate，合并到 main
10. 审计事件记录全过程
```

### 旅程三：冲突处理

```
1. task-001 和 task-003 同时修改了 src/auth/token.ts
2. Conflict Center 检测到同文件冲突
3. 建议串行合并：先合并 task-001，rebase task-003
4. task-003 rebase 后重新测试
5. 测试通过后进入 Review
```

---

## 13. 最终设计判断

agentgitops 的本质不是一个"AI Git 客户端"，而是：

```
Code Agent 的任务管理系统
+ Code Agent 的本地工作区管理系统
+ Code Agent 的变更证据系统
+ Code Agent 的 Review Board
+ Code Agent 的 Merge Gate
+ Code Agent 的 AgentOps
```

它解决的是 Code Agent 时代的新问题：

```
不是 Agent 能不能写代码，
而是 Agent 写出来的代码能不能被团队放心地管理、审核、合并和追溯。
```

---

## 14. 相关文档

| 文档 | 说明 |
| --- | --- |
| [`architecture.md`](./architecture.md) | 技术架构与模块设计 |
| [`data-model.md`](./data-model.md) | 核心数据模型 |
| [`task-lifecycle.md`](./task-lifecycle.md) | 任务生命周期与状态机 |
| [`api-reference.md`](./api-reference.md) | REST API 参考 |
| [`cli-reference.md`](./cli-reference.md) | CLI 命令参考 |
| [`configuration.md`](./configuration.md) | 配置参考 |
| [`adapters.md`](./adapters.md) | Agent Adapter 设计 |
| [`policy.md`](./policy.md) | 策略引擎设计 |
| [`change-package.md`](./change-package.md) | Change Package 规范 |
| [`git-provider-integration.md`](./git-provider-integration.md) | Git 平台集成 |
| [`security.md`](./security.md) | 安全设计 |
| [`release-checklist.md`](./release-checklist.md) | 发布检查清单 |
