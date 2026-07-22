# Agent Adapter 设计（Agent Adapters）

> 项目：agentgitops
> 版本：v0.2（generic-cli + 官方基础 adapter 已实现）
> 关联文档：[`architecture.md`](./architecture.md)、[`configuration.md`](./configuration.md)

本文档定义 agentgitops 的 Agent Adapter 层——负责把不同 Code Agent（Codex、Claude Code、OpenCode、Cursor、Cline 等）统一接入 agentgitops 的任务执行流程。

---

## 1. 为什么需要 Adapter

不同 Code Agent 的启动方式、参数格式、交互模式各不相同：

| Agent | 启动命令 | 工作目录参数 | 任务输入方式 |
| --- | --- | --- | --- |
| Claude Code | `claude` | `--project <path>` | prompt 文件 / stdin |
| Codex | `codex run` | `--cwd <path>` | `--task-file <file>` |
| OpenCode | `opencode` | 位置参数 `<path>` | 交互式 / prompt |
| Cursor | CLI / IDE | 项目目录 | 选区 / chat |
| Cline | VS Code 扩展 | 工作区 | chat |

因此需要 Adapter 层屏蔽差异，让 agentgitops 以统一方式：

```
启动 Agent
注入任务合同
限定工作目录
记录 stdout / stderr
采集退出码
采集 Agent 过程日志
触发测试
生成最终变更
```

---

## 2. Adapter 类型

```
Agent Adapter
├─ generic-cli      # 通用 CLI，通过命令模板兼容任意 Agent
├─ codex            # Codex 专用
├─ claude-code      # Claude Code 专用
├─ opencode         # OpenCode 专用
├─ cursor           # Cursor 专用
├─ cline            # Cline 专用
└─ custom           # 自定义（实现 Adapter 接口）
```

### 2.1 当前实现策略

当前已实现 `generic-cli` 通用适配器，并通过 `createAgentAdapter(type)` 提供 Claude Code、Codex、OpenCode 三个官方基础 adapter。Claude Code 与 Codex 的工厂入口直接复用各自专用 adapter 实现，不再维护第二份简化逻辑；专用 adapter 仍复用通用执行、安全环境白名单、日志采集和 forbidden command 拦截能力，但提供稳定的默认参数模板、专属 prompt 和输出统计解析。

| Adapter | 默认命令参数 | 说明 |
| --- | --- | --- |
| `claude-code` | `--project {{workspace_path}} --prompt-file {{task_prompt_file}}` | 面向 Claude Code CLI 的项目路径和 prompt 文件 |
| `codex` | `run --cwd {{workspace_path}} --task-file {{task_prompt_file}}` | 面向 Codex CLI 的非交互任务执行 |
| `opencode` | `run --cwd {{workspace_path}} --task-file {{task_prompt_file}}` | 面向 OpenCode CLI 的非交互任务执行 |

如果 `.agentgitops.yml` 中显式配置了 `agents.<id>.args`，专用 adapter 会优先使用配置参数，便于适配不同 CLI 版本。

---

## 3. Adapter 接口

```ts
/**
 * Agent Adapter 接口
 * 所有 Adapter 须实现此接口
 */
interface AgentAdapter {
  /** Adapter 类型标识 */
  readonly type: string;

  /** 启动 Agent 执行任务 */
  run(params: AdapterRunParams): Promise<AdapterRunResult>;

  /** 检查 Agent 命令是否可用 */
  checkAvailability(): Promise<AvailabilityResult>;

  /** 获取 Agent 版本信息 */
  getVersion?(): Promise<string>;
}

interface AdapterRunParams {
  /** 任务合同 */
  taskContract: TaskContract;
  /** 工作区路径（worktree 绝对路径） */
  workspacePath: string;
  /** 任务提示文件路径 */
  promptFilePath: string;
  /** 注入的环境变量 */
  env?: Record<string, string>;
  /** 超时时间（毫秒） */
  timeoutMs?: number;
  /** 日志输出回调 */
  onLog?: (log: AgentLog) => void;
}

interface AdapterRunResult {
  exitCode: number;
  status: "completed" | "failed" | "canceled" | "timeout";
  startedAt: string;
  endedAt: string;
  logPath: string;
}

interface AgentLog {
  stream: "stdout" | "stderr";
  data: string;
  timestamp: string;
}

interface AvailabilityResult {
  available: boolean;
  version?: string;
  reason?: string;
}
```

---

## 4. Generic CLI Adapter

`generic-cli` 是最通用的 Adapter，通过命令模板启动任意 CLI Agent。

### 4.1 配置示例

```yaml
agents:
  claude-code:
    type: generic-cli
    command: "claude"
    args:
      - "--project"
      - "{{workspace_path}}"
    prompt_file: "{{task_prompt_file}}"

  opencode:
    type: generic-cli
    command: "opencode"
    args:
      - "{{workspace_path}}"

  codex:
    type: generic-cli
    command: "codex"
    args:
      - "run"
      - "--cwd"
      - "{{workspace_path}}"
      - "--task-file"
      - "{{task_prompt_file}}"

  custom-agent:
    type: generic-cli
    command: "/usr/local/bin/my-agent"
    args:
      - "--workspace"
      - "{{workspace_path}}"
      - "--task"
      - "{{task_prompt_file}}"
      - "--objective"
      - "{{task_objective}}"
    env:
      AGENT_MODE: "autonomous"
    timeout_ms: 600000
```

### 4.2 模板变量

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

### 4.3 执行流程

```
1. 渲染命令模板（替换变量）
2. 设置工作目录为 workspace_path
3. 注入环境变量
4. 启动子进程
5. 实时采集 stdout / stderr → 日志文件 + onLog 回调
6. 等待进程退出或超时
7. 采集退出码
8. 返回 AdapterRunResult
```

### 4.4 任务提示文件生成

Adapter 启动前，Local Hub 根据 Task Contract 生成提示文件：

```
.agentgitops/tasks/{task_id}/prompt.md
```

提示文件内容（示例）：

```markdown
# Task: Fix expired token returning 500

## Objective
修复登录 token 过期时返回 500 的问题

## Background
用户 token 过期后接口应返回 401，而不是服务端异常。

## Scope
- Allowed paths: src/auth/**, tests/auth/**
- Forbidden paths: db/migrations/**, infra/**, .github/workflows/**

## Required Checks
- npm test -- auth
- npm run lint

## Risk Level
medium (domains: auth, api)

## Notes
- 修改业务逻辑后必须补充或更新测试
- 如果局部测试通过但完整测试未运行，请在最终报告中注明
```

---

## 5. 专用 Adapter

专用 Adapter 在 `generic-cli` 基础上增加 Agent 特定逻辑。

### 5.1 Claude Code Adapter

```ts
class ClaudeCodeAdapter implements AgentAdapter {
  readonly type = "claude-code";

  async run(params: AdapterRunParams): Promise<AdapterRunResult> {
    // 1. 使用 claude --project <workspace> --prompt-file <file>
    // 2. 解析 Claude Code 特有的输出格式
    // 3. 采集 session ID（如支持）
    // 4. 支持 --resume 续接会话
  }
}
```

特性：
- 支持 `--project` 指定工作目录
- 支持 prompt 文件输入
- 支持 session 续接（`--resume <session-id>`）
- 解析 Claude Code 的结构化输出

### 5.2 Codex Adapter

```ts
class CodexAdapter implements AgentAdapter {
  readonly type = "codex";

  async run(params: AdapterRunParams): Promise<AdapterRunResult> {
    // 1. 使用 codex run --cwd <workspace> --task-file <file>
    // 2. 解析 Codex 输出
  }
}
```

### 5.3 OpenCode Adapter

```ts
class OpenCodeAdapter implements AgentAdapter {
  readonly type = "opencode";

  async run(params: AdapterRunParams): Promise<AdapterRunResult> {
    // 1. 使用 opencode <workspace>
    // 2. 通过 stdin 传入 prompt
  }
}
```

### 5.4 Cursor / Cline Adapter

Cursor 和 Cline 主要通过 IDE 运行，Adapter 需特殊处理：

- **Cursor**：通过 Cursor CLI 或 IDE 命令触发
- **Cline**：通过 VS Code 扩展 API 触发

> MVP 阶段不实现 Cursor / Cline 专用 Adapter，后续根据需求增加。

---

## 6. Adapter 注册与发现

### 6.1 内置 Adapter

```ts
const adapter = createAgentAdapter(agent.type);
await adapter.run({
  taskContract,
  workspacePath,
  command: agent.command,
  args: agent.args ?? [],
  env: agent.env,
  policies: config.policies,
});
```

### 6.2 自定义 Adapter

当前开源版的运行时扩展边界由 `ExtensionRegistry` 承载。自定义 Adapter 建议先以 `generic-cli` + 命令模板接入；企业版或私有模块如需插件化注册，应通过 registry/配置注入，而不是修改 server 或 fork 内置 adapter。

```ts
const registry = createExtensionRegistryFromConfig(config, {
  auditSink,
  policyProvider,
});
```

### 6.3 Adapter 选择逻辑

```
1. 读取 Agent 配置中的 type
2. 调用 `createAgentAdapter(type)`
3. 若为内置类型 → 使用专用 adapter 或 OpenCode 基础 adapter
4. 若未找到 → 回退到 `generic-cli`
5. 企业/私有插件通过 `ExtensionRegistry` 注入周边治理能力，Adapter CLI 接入优先保持配置化
```

---

## 7. 执行安全

Adapter 执行 Agent 时须保证安全：

| 安全项 | 策略 |
| --- | --- |
| 工作目录隔离 | 强制 `chdir` 到 workspace，Agent 无法访问其他任务工作区 |
| 环境变量过滤 | 仅注入白名单环境变量，过滤敏感变量 |
| 超时控制 | 默认超时 10 分钟，可配置 |
| 资源限制 | 可选：限制 CPU / 内存（通过 cgroups / job objects） |
| 命令注入防护 | 命令模板不直接拼接用户输入，使用参数数组 |
| 网络限制 | 可选：限制 Agent 网络访问（企业版） |

详见 [`security.md`](./security.md)。

---

## 8. 日志采集

### 8.1 日志存储

```
.agentgitops/logs/
└─ {task_id}/
   ├─ agent-stdout.log
   ├─ agent-stderr.log
   ├─ agent-session.json    (会话元数据)
   └─ commands/             (Agent 执行的命令记录，如可采集)
```

### 8.2 实时日志

Adapter 通过 `onLog` 回调实时推送日志到：
- Web UI（通过 WebSocket / SSE）
- 本地终端（`agentgitops run` 前台模式）

### 8.3 日志格式

每行日志带时间戳：

```
[2026-07-03T04:00:00.123Z] [stdout] Starting agent...
[2026-07-03T04:00:01.456Z] [stdout] Reading task file...
[2026-07-03T04:00:05.789Z] [stderr] Warning: deprecated API usage
```

---

## 9. Agent 可用性检查

`agentgitops doctor` 会检查所有已注册 Agent 的可用性：

```
1. 读取 Agent 配置
2. 执行 {command} --version（或配置的检查命令）
3. 记录可用性状态
4. 报告不可用的 Agent
```

示例输出：

```
✓ git: 2.43.0
✓ claude-code: available (claude v1.2.3)
✗ codex: command not found
✓ opencode: available (opencode v0.5.0)
```

---

## 10. Adapter 与 Skill Pack 协作

Adapter 启动 Agent 前，Workspace Manager 会注入 Skill Pack：

```
1. 根据 Task Contract 的 riskDomains 匹配 Skill
2. 根据 Agent 类型匹配 Skill
3. 将 Skill 内容追加到 prompt 文件
4. Adapter 启动 Agent
```

Skill 指导 Agent 怎么做，Policy Engine 判断能不能做，Verification Gate 验证是否做到。

---

## 11. 错误处理

| 场景 | 处理 |
| --- | --- |
| Agent 命令不存在 | `checkAvailability` 返回 false，`run` 抛出 `AGENT_COMMAND_NOT_FOUND` |
| Agent 启动失败 | 返回 `status: "failed"`，记录错误日志 |
| Agent 超时 | 终止进程，返回 `status: "timeout"` |
| Agent 异常退出 | 采集退出码，若退出码非 0 但有变更 → 继续 testing；若无变更 → failed |
| Agent 无响应 | 心跳检测，超时后终止 |

---

## 12. 相关文档

| 文档 | 说明 |
| --- | --- |
| [`architecture.md`](./architecture.md) | 技术架构（Adapter 在整体架构中的位置） |
| [`configuration.md`](./configuration.md) | 配置参考（Agent 配置） |
| [`task-lifecycle.md`](./task-lifecycle.md) | 任务生命周期（running 状态） |
| [`security.md`](./security.md) | 安全设计（执行安全） |
