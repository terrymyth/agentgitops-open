# Git-Native 同步技术设计文档

> 日期：2026-07-13
> 状态：设计阶段
> 关联规划：Git-native sync design notes
> 关联代码：[`packages/local-hub/src/team-sync-store.ts`](../packages/local-hub/src/team-sync-store.ts)、[`packages/local-hub/src/relay-client.ts`](../packages/local-hub/src/relay-client.ts)、[`apps/cli/src/index.ts`](../apps/cli/src/index.ts)

---

## 1. 现状分析

### 1.1 Team Sync 同步模式定义

[`packages/core/src/models/team-sync.ts:2`](../packages/core/src/models/team-sync.ts:2) 定义了四种同步模式：

```typescript
export type TeamSyncMode = "local" | "git-native" | "relay" | "hybrid";
```

| 模式 | 实现状态 | 同步媒介 | 适用场景 |
|------|----------|----------|----------|
| `local` | ✅ 已实现 | 无（仅本地 Store） | 单机使用 |
| `git-native` | ❌ 仅占位 | Git 仓库内 JSON 文件 | 2 机低频协同，无云服务器 |
| `relay` | ✅ 已实现 | 独立 Relay HTTP 服务器 | 多机实时协同 |
| `hybrid` | ❌ 未实现 | Relay + Git 仓库 | 混合模式（未来） |

### 1.2 现有 Relay 同步数据流

```
TeamSyncEventProducer → TeamSyncStore.enqueueSyncEvent (pending)
                                    ↓
sync push 命令 → RelayClient.push(events) → Relay HTTP API
                                    ↓
sync pull 命令 → RelayClient.pull(cursor) → TeamSyncEventApplier.apply()
                                    ↓
                            TeamSyncStore (synced_tasks, synced_change_packages, ...)
```

**关键依赖**：
- [`RelayClient`](../packages/local-hub/src/relay-client.ts:66) 封装 HTTP 通信
- [`TeamSyncStore.listPendingEvents()`](../packages/local-hub/src/team-sync-store.ts:400) 获取待同步事件
- [`TeamSyncStore.markEventsPushed()`](../packages/local-hub/src/team-sync-store.ts:439) 标记已推送
- [`TeamSyncEventApplier.apply()`](../packages/local-hub/src/team-sync-event-applier.ts:20) 应用事件到本地

### 1.3 sync push/pull 的 Relay 强依赖

[`apps/cli/src/index.ts:1067-1071`](../apps/cli/src/index.ts:1067)：

```typescript
const relayUrl = opts.relay ?? summary.team.relayUrl;
if (!relayUrl) {
  console.log("Relay URL is not configured; pending events were retained locally.");
  process.exitCode = 1;
  return;
}
```

**问题**：无论 syncMode 是什么，只要没有 relayUrl 就退出。git-native 模式需要绕过这个检查。

---

## 2. 设计方案

### 2.1 核心思路

git-native 模式用 **Git 仓库内的 JSON 文件**替代 Relay HTTP API 作为事件传输媒介：

- **push = 导出**：将 pending events 序列化为 JSON 文件写入 `.agentgitops/sync/outbox/`
- **pull = 导入**：读取 outbox 中的 JSON 文件，反序列化并应用
- **传输 = git push/pull**：用户手动 `git add -f` + `git push`，对方 `git pull`

### 2.2 目录结构设计

```
.agentgitops/
└── sync/
    ├── outbox/                    # 同步事件存储（需 git add -f 提交）
    │   ├── manifest.json          # 导出清单
    │   └── events/
    │       ├── hub-A/
    │       │   ├── evt_001.json   # 机器 A 产生的事件
    │       │   └── evt_002.json
    │       └── hub-B/
    │           └── evt_003.json   # 机器 B 产生的事件
    └── applied.json               # 本机已应用事件游标（不同步，.gitignore）
```

**设计决策**：

1. **按 hubId 分子目录**：避免两机事件文件名冲突，Git 合并时不会冲突
2. **每个事件独立文件**：支持增量提交，`git add` 粒度细
3. **manifest.json**：记录每个 hub 的导出元数据，便于对方判断新鲜度
4. **applied.json**：本机游标，记录已应用事件 ID，实现幂等

### 2.3 事件文件格式

单个事件文件 `events/hub-A/evt_001.json`：

```json
{
  "schemaVersion": 1,
  "event": {
    "eventId": "evt_001",
    "teamId": "team-xxx",
    "hubId": "hub-A",
    "actorId": "member-001",
    "action": "task.created",
    "resourceType": "task",
    "resourceId": "task-20260713-001",
    "idempotencyKey": "task.created:task-20260713-001:2026-07-13T...",
    "payload": {
      "taskId": "task-20260713-001",
      "title": "实现 git-native 导出器",
      "objective": "...",
      "status": "running",
      "agentId": "claude-code",
      "baseBranch": "main",
      "targetBranch": "agent/task-001/claude-code",
      "riskLevel": "medium",
      "changedFiles": [],
      "relatedTasks": []
    },
    "createdAt": "2026-07-13T03:00:00.000Z",
    "updatedAt": "2026-07-13T03:00:00.000Z"
  }
}
```

**注意**：`status` 和 `error` 字段不导出——这些是本地状态，导入方应根据 `action` 重新应用。

### 2.4 manifest.json 格式

```json
{
  "schemaVersion": 1,
  "hubs": {
    "hub-A": {
      "exportedAt": "2026-07-13T03:00:00.000Z",
      "eventCount": 5,
      "lastEventId": "evt_005",
      "lastEventCreatedAt": "2026-07-13T03:00:00.000Z"
    }
  }
}
```

### 2.5 applied.json 格式

```json
{
  "schemaVersion": 1,
  "appliedEventIds": ["evt_001", "evt_002", "evt_003"],
  "appliedIdempotencyKeys": ["task.created:task-001:...", "change_package.created:pkg-001:..."],
  "updatedAt": "2026-07-13T03:05:00.000Z"
}
```

---

## 3. 模块设计

### 3.1 GitNativeSyncExporter

**文件**：`packages/local-hub/src/git-native-sync-exporter.ts`

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import type { SyncEvent } from "@agentgitops/core";
import { TeamSyncStore } from "./team-sync-store.js";
import { ContextFeedPrivacyFilter } from "./context-feed-privacy-filter.js";

export interface GitNativeExportResult {
  exported: number;
  skipped: number;
  manifest: SyncManifest;
}

export class GitNativeSyncExporter {
  private readonly syncDir: string;
  private readonly outboxDir: string;
  private readonly eventsDir: string;
  private readonly privacyFilter = new ContextFeedPrivacyFilter();

  constructor(
    private readonly projectPath: string,
    private readonly hubId: string,
  ) {
    this.syncDir = path.join(projectPath, ".agentgitops", "sync");
    this.outboxDir = path.join(this.syncDir, "outbox");
    this.eventsDir = path.join(this.outboxDir, "events", hubId);
  }

  /**
   * 导出所有 pending events 到 outbox
   */
  async exportPending(): Promise<GitNativeExportResult> {
    const store = new TeamSyncStore(this.projectPath);
    try {
      const events = store.listPendingEvents();
      return this.exportEvents(events);
    } finally {
      store.close();
    }
  }

  /**
   * 导出指定事件到 outbox
   */
  async exportEvents(events: SyncEvent[]): Promise<GitNativeExportResult> {
    await fs.mkdir(this.eventsDir, { recursive: true });

    let exported = 0;
    let skipped = 0;
    let lastEventId: string | undefined;
    let lastEventCreatedAt: string | undefined;

    for (const event of events) {
      // 幂等：已导出的文件不重复写
      const filePath = path.join(this.eventsDir, `${event.eventId}.json`);
      if (await this.fileExists(filePath)) {
        skipped++;
        continue;
      }

      // 隐私过滤
      const filteredEvent = this.applyPrivacyFilter(event);

      const fileContent = {
        schemaVersion: 1,
        event: filteredEvent,
      };

      await fs.writeFile(filePath, JSON.stringify(fileContent, null, 2), "utf-8");
      exported++;
      lastEventId = event.eventId;
      lastEventCreatedAt = event.createdAt;
    }

    const manifest = await this.updateManifest(exported, lastEventId, lastEventCreatedAt);
    return { exported, skipped, manifest };
  }

  private applyPrivacyFilter(event: SyncEvent): SyncEvent {
    // 复用 ContextFeedPrivacyFilter 对 payload 中的敏感字段脱敏
    // 根据 TeamSyncConfig 决定是否导出 agentExecution/failureReason 等
    return {
      ...event,
      payload: this.redactPayload(event.payload, event.action),
    };
  }

  private redactPayload(payload: Record<string, unknown>, action: string): Record<string, unknown> {
    // 根据 action 类型和 TeamSyncConfig 过滤敏感字段
    // 详见安全设计章节
    return payload;
  }

  private async updateManifest(
    eventCount: number,
    lastEventId?: string,
    lastEventCreatedAt?: string,
  ): Promise<SyncManifest> {
    const manifestPath = path.join(this.outboxDir, "manifest.json");
    let manifest: SyncManifest = { schemaVersion: 1, hubs: {} };

    try {
      const content = await fs.readFile(manifestPath, "utf-8");
      manifest = JSON.parse(content);
    } catch {
      // 首次创建
    }

    manifest.hubs[this.hubId] = {
      exportedAt: new Date().toISOString(),
      eventCount,
      lastEventId,
      lastEventCreatedAt,
    };

    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    return manifest;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

export interface SyncManifest {
  schemaVersion: number;
  hubs: Record<string, {
    exportedAt: string;
    eventCount: number;
    lastEventId?: string;
    lastEventCreatedAt?: string;
  }>;
}
```

### 3.2 GitNativeSyncImporter

**文件**：`packages/local-hub/src/git-native-sync-importer.ts`

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import type { SyncEvent } from "@agentgitops/core";
import { TeamSyncStore } from "./team-sync-store.js";
import { TeamSyncEventApplier } from "./team-sync-event-applier.js";

export interface GitNativeImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export class GitNativeSyncImporter {
  private readonly syncDir: string;
  private readonly outboxDir: string;
  private readonly appliedPath: string;

  constructor(private readonly projectPath: string) {
    this.syncDir = path.join(projectPath, ".agentgitops", "sync");
    this.outboxDir = path.join(this.syncDir, "outbox");
    this.appliedPath = path.join(this.syncDir, "applied.json");
  }

  /**
   * 导入所有未应用的 outbox 事件
   */
  async importNew(): Promise<GitNativeImportResult> {
    const applied = await this.loadApplied();
    const store = new TeamSyncStore(this.projectPath);
    const applier = new TeamSyncEventApplier(store);

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    try {
      // 遍历所有 hub 的事件目录
      const eventsRoot = path.join(this.outboxDir, "events");
      let hubDirs: string[] = [];
      try {
        hubDirs = await fs.readdir(eventsRoot);
      } catch {
        return { imported: 0, skipped: 0, errors: ["outbox/events directory not found"] };
      }

      for (const hubDir of hubDirs) {
        const hubPath = path.join(eventsRoot, hubDir);
        const stat = await fs.stat(hubPath);
        if (!stat.isDirectory()) continue;

        const files = await fs.readdir(hubPath);
        for (const file of files) {
          if (!file.endsWith(".json")) continue;

          try {
            const filePath = path.join(hubPath, file);
            const content = await fs.readFile(filePath, "utf-8");
            const parsed = JSON.parse(content) as { event: SyncEvent };
            const event = parsed.event;

            // 幂等检查 1：eventId
            if (applied.appliedEventIds.includes(event.eventId)) {
              skipped++;
              continue;
            }

            // 幂等检查 2：idempotencyKey
            if (applied.appliedIdempotencyKeys.includes(event.idempotencyKey)) {
              skipped++;
              continue;
            }

            // 幂等检查 3：本地 Store 已存在
            const existing = store.getSyncEvent(event.eventId)
              ?? store.getSyncEventByIdempotencyKey(event.idempotencyKey);
            if (existing) {
              skipped++;
              applied.appliedEventIds.push(event.eventId);
              applied.appliedIdempotencyKeys.push(event.idempotencyKey);
              continue;
            }

            // 入队并应用
            store.enqueueSyncEvent({ ...event, status: "pushed" });
            const result = applier.apply(event);

            if (result.applied) {
              imported++;
              applied.appliedEventIds.push(event.eventId);
              applied.appliedIdempotencyKeys.push(event.idempotencyKey);
            } else {
              skipped++;
            }
          } catch (err) {
            errors.push(`Failed to import ${file}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      applied.updatedAt = new Date().toISOString();
      await this.saveApplied(applied);

      return { imported, skipped, errors };
    } finally {
      store.close();
    }
  }

  private async loadApplied(): Promise<AppliedRecord> {
    try {
      const content = await fs.readFile(this.appliedPath, "utf-8");
      return JSON.parse(content);
    } catch {
      return { schemaVersion: 1, appliedEventIds: [], appliedIdempotencyKeys: [], updatedAt: "" };
    }
  }

  private async saveApplied(record: AppliedRecord): Promise<void> {
    await fs.mkdir(path.dirname(this.appliedPath), { recursive: true });
    await fs.writeFile(this.appliedPath, JSON.stringify(record, null, 2), "utf-8");
  }
}

interface AppliedRecord {
  schemaVersion: number;
  appliedEventIds: string[];
  appliedIdempotencyKeys: string[];
  updatedAt: string;
}
```

### 3.3 CLI 适配

修改 [`apps/cli/src/index.ts`](../apps/cli/src/index.ts) sync push/pull action，根据 syncMode 分支：

```typescript
// sync push action 中
const syncMode = summary.team.syncMode;

if (syncMode === "git-native") {
  // git-native 模式：导出到 outbox
  const exporter = new GitNativeSyncExporter(cwd, summary.localHub.hubId);
  const result = await exporter.exportPending();
  console.log(`✓ Exported ${result.exported} event(s) to outbox, ${result.skipped} skipped.`);
  console.log(`  Outbox: .agentgitops/sync/outbox/events/${summary.localHub.hubId}/`);
  console.log(`  Next: git add -f .agentgitops/sync/outbox/ && git commit && git push`);
  return;
}

// 现有 relay 逻辑...
const relayUrl = opts.relay ?? summary.team.relayUrl;
if (!relayUrl) { ... }
```

```typescript
// sync pull action 中
const syncMode = summary.team.syncMode;

if (syncMode === "git-native") {
  // git-native 模式：从 outbox 导入
  const importer = new GitNativeSyncImporter(cwd);
  const result = await importer.importNew();
  console.log(`✓ Imported ${result.imported} event(s), ${result.skipped} skipped.`);
  if (result.errors.length > 0) {
    console.log(`  Errors: ${result.errors.length}`);
    for (const err of result.errors) console.log(`    - ${err}`);
  }
  return;
}

// 现有 relay 逻辑...
```

### 3.4 配置扩展

[`packages/local-hub/src/config-loader.ts`](../packages/local-hub/src/config-loader.ts:172) 的 `TeamSyncConfig` 新增：

```typescript
export interface TeamSyncConfig {
  // ... 现有字段 ...
  mode?: "manual" | "auto";
  intervalSeconds?: number;
  // git-native 专用配置
  gitNative?: {
    /** task 事件产生时自动导出到 outbox */
    autoExport?: boolean;
    /** 导出后自动清理已 pushed 的事件文件 */
    cleanupExported?: boolean;
  };
}
```

默认值：

```typescript
export function defaultTeamSyncConfig(): TeamSyncConfig {
  return {
    // ... 现有默认值 ...
    gitNative: {
      autoExport: true,
      cleanupExported: false,
    },
  };
}
```

---

## 4. 安全设计

### 4.1 隐私过滤

git-native 模式下事件文件会提交到 Git 仓库，**必须严格遵守 TeamSyncConfig 隐私过滤**。

| 事件 action | payload 敏感字段 | 默认是否导出 | 配置项 |
|-------------|------------------|:------------:|--------|
| task.created/updated | changedFiles | ✅ | `sync.changedFiles` |
| task.created/updated | riskLevel | ✅ | `sync.riskLevel` |
| change_package.created | summary | ✅ | - |
| change_package.created | verificationSummary | ✅ | `sync.verification` |
| agent.session.completed | executionSummary.strategy | ❌ | `sync.agentExecution` |
| agent.session.completed | executionSummary.steps | ❌ | `sync.agentExecution` |
| agent.session.completed | executionSummary.filesRead | ❌ | `sync.filesRead` |
| agent.session.completed | executionSummary.failureReason | ❌ | `sync.failureReason` |
| agent_note.created | summary | ❌ | `sync.agentNotes` |

**实现**：`GitNativeSyncExporter.applyPrivacyFilter()` 读取 `TeamSyncConfig`，对 payload 中对应字段进行删除或脱敏。

### 4.2 不导出的内容

以下内容**永远不导出**，无论配置如何：
- 源代码 / diff 内容
- Agent Prompt
- Token / 密钥 / 凭据
- 完整 review payload（只导出摘要）
- 本地 SQLite 数据库

### 4.3 .gitignore 策略

```gitignore
# git-native sync: outbox 需提交，applied.json 不提交
.agentgitops/sync/applied.json
```

**注意**：`.agentgitops/sync/outbox/` **不加入 .gitignore**，但需要用户手动 `git add -f`（因为 `.agentgitops/` 部分内容被忽略，Git 可能不自动跟踪子目录）。

---

## 5. 与现有模块的关系

### 5.1 复用的模块

| 模块 | 复用方式 |
|------|----------|
| [`TeamSyncStore`](../packages/local-hub/src/team-sync-store.ts:1) | Exporter 读取 pending events，Importer 写入 synced events |
| [`TeamSyncEventApplier`](../packages/local-hub/src/team-sync-event-applier.ts:1) | Importer 直接调用 `apply()` 应用事件 |
| [`TeamSyncEventProducer`](../packages/local-hub/src/team-sync-event-producer.ts:1) | 事件产生逻辑不变，新增自动导出钩子 |
| [`ContextFeedPrivacyFilter`](../packages/local-hub/src/context-feed-privacy-filter.ts:1) | Exporter 复用其脱敏能力 |
| [`TeamSyncConfig`](../packages/local-hub/src/config-loader.ts:172) | 隐私过滤配置 |

### 5.2 不修改的模块

| 模块 | 原因 |
|------|------|
| `RelayClient` | relay 模式逻辑保持不变 |
| `AutoSyncManager` | auto 模式仍走 Relay；git-native 的自动导出由 Producer 钩子触发 |
| `TeamSyncEventApplier` | 应用逻辑与同步媒介无关，完全复用 |

### 5.3 新增的模块

| 模块 | 文件 |
|------|------|
| `GitNativeSyncExporter` | `packages/local-hub/src/git-native-sync-exporter.ts` |
| `GitNativeSyncImporter` | `packages/local-hub/src/git-native-sync-importer.ts` |

---

## 6. 测试策略

### 6.1 单元测试

| 测试文件 | 覆盖内容 |
|----------|----------|
| `git-native-sync-exporter.test.ts` | 导出 pending events、manifest 生成、幂等（已存在跳过）、隐私过滤 |
| `git-native-sync-importer.test.ts` | 导入事件、幂等去重（eventId + idempotencyKey + Store）、错误处理 |

### 6.2 CLI Smoke 测试

在 [`apps/cli/tests/cli-smoke.test.ts`](../apps/cli/tests/cli-smoke.test.ts:1) 中新增：
- `team init --sync-mode git-native` 后 `sync push` 导出文件
- `sync pull` 导入文件并应用
- `sync status` 显示 git-native 状态

### 6.3 端到端 Smoke

新增 `scripts/git-native-sync-smoke.mjs`：
1. 创建临时 Git 仓库
2. 机器 A：`team init --sync-mode git-native`，创建任务，`sync push`
3. 模拟 git push/pull（复制 outbox 目录）
4. 机器 B：`team join`，`sync pull`，验证 Team Board 显示 A 的任务
5. 机器 B：创建任务，`sync push`
6. 模拟 git push/pull 回 A
7. 机器 A：`sync pull`，验证双向同步

---

## 7. 边界与限制

### 7.1 不支持的能力

| 能力 | 原因 | 替代方案 |
|------|------|----------|
| 实时同步 | git-native 是批处理模式 | 手动 `sync push` + `git push` + `git pull` + `sync pull` |
| 自动 git push | 不自动执行 git 命令（安全考虑） | 用户手动 `git add -f` + `git push` |
| 多 Hub 冲突仲裁 | 无中心仲裁者 | 依赖 Git 合并 + 手动解决 |
| 事件清理 GC | outbox 文件会累积 | 提供 `sync cleanup` 命令手动清理（未来） |

### 7.2 与 relay 模式的对比

| 维度 | git-native | relay |
|------|-----------|-------|
| 基础设施 | 无需（用 Git 仓库） | 需部署 Relay 服务器 |
| 实时性 | 低（依赖手动 git push/pull） | 高（HTTP 实时） |
| 多 Hub 扩展 | 适合 2-3 机 | 适合 N 机 |
| 冲突风险 | 中（outbox 文件可能合并冲突） | 低（Relay 中心化） |
| 离线友好 | ✅ 完全离线 | ❌ 依赖 Relay 可达 |
| 安全 | 事件提交到 Git 仓库（需隐私过滤） | 事件只在 Relay（HTTPS + Token） |

---

## 8. 后续演进

### 8.1 hybrid 模式（未来）

`hybrid` 模式可同时使用 relay + git-native：
- 优先走 relay（实时性）
- relay 不可用时 fallback 到 git-native（离线容错）
- 事件去重靠 idempotencyKey

### 8.2 Git Hook 自动化（未来）

提供 `agentgitops hook install` 安装 Git hooks：
- `post-commit`：自动 `sync push`（导出 outbox）
- `post-merge`：自动 `sync pull`（导入 outbox）

这样用户只需正常 `git commit` / `git pull`，同步自动完成。

### 8.3 outbox GC（未来）

`sync cleanup` 命令清理已应用的事件文件，避免 outbox 无限膨胀。
