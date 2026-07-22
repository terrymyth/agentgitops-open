# CLI 命令参考（CLI Reference）

> 项目：agentgitops
> 版本：v0.1（设计阶段）
> 关联文档：[`api-reference.md`](./api-reference.md)、[`configuration.md`](./configuration.md)

CLI 是 agentgitops 的第一入口，也是 Agent 自动化注册和管理的核心工具。CLI 是 REST API 的封装，所有 CLI 命令对应底层 API 调用。

---

## 1. 全局选项

```bash
agentgitops [command] [options]
```

| 选项 | 说明 | 默认值 |
| --- | --- | --- |
| `--config <path>` | 指定配置文件路径 | `.agentgitops.yml` |
| `--api <url>` | 指定 Control Plane API 地址 | `http://localhost:4789` |
| `--token <token>` | 认证 Token（Team/Enterprise） | - |
| `--json` | 以 JSON 格式输出 | false |
| `--verbose` | 详细日志 | false |
| `--quiet` | 静默模式 | false |
| `--help` | 显示帮助 | - |
| `--version` | 显示版本 | - |

---

## 2. init — 项目初始化

```bash
agentgitops init [options]
```

在当前目录初始化 agentgitops 项目。

**选项**：

| 选项 | 说明 |
| --- | --- |
| `--name <name>` | 项目名称 |
| `--git-provider <provider>` | Git 平台（github/gitlab/gitea/local） |
| `--default-branch <branch>` | 默认分支 |
| `--force` | 覆盖已有配置 |

**示例**：

```bash
agentgitops init --name demo-web --git-provider github
```

**行为**：
1. 创建 `.agentgitops/` 目录结构
2. 生成 `.agentgitops.yml` 默认配置
3. 初始化 SQLite 数据库
4. 注册当前项目

---

## 3. doctor — 环境诊断

```bash
agentgitops doctor
```

检查环境是否就绪。

**检查项**：
- Git 是否安装且版本满足要求
- 配置文件是否合法
- 已注册 Agent 命令是否可用
- Git 平台 Token 是否有效
- worktree 根目录是否可写

**示例输出**：

```
✓ git: 2.43.0
✓ config: .agentgitops.yml (valid)
✓ claude-code: available (claude v1.2.3)
✗ codex: command not found
✓ opencode: available (opencode v0.5.0)
✓ github token: valid
✓ worktree root: writable
```

---

## 4. project — 项目管理

### 4.1 register

```bash
agentgitops project register [options]
```

注册项目到 Control Plane（Team/Enterprise）。

### 4.2 status

```bash
agentgitops project status
```

显示当前项目状态概览。

---

## 5. agent — Agent 管理

### 5.1 register

```bash
agentgitops agent register <name> [options]
```

注册一个 Code Agent。

**选项**：

| 选项 | 说明 |
| --- | --- |
| `--command <cmd>` | Agent 可执行命令 |
| `--type <type>` | Adapter 类型（generic-cli/codex/claude-code/opencode） |
| `--args <args...>` | 命令参数 |
| `--env <key=value...>` | 环境变量 |

**示例**：

```bash
agentgitops agent register claude-code --command claude --type generic-cli --args "{{task_prompt_file}}"

agentgitops agent register codex --command codex --type generic-cli --args "run" "--cwd" "{{workspace_path}}" "--task-file" "{{task_prompt_file}}"
```

### 5.2 list

```bash
agentgitops agent list
```

列出所有已注册 Agent。

### 5.3 remove

```bash
agentgitops agent remove <name>
```

移除已注册 Agent。

---

## 6. task — 任务管理

### 6.1 create

```bash
agentgitops task create <title> [options]
```

创建一个任务合同（Task Contract）。

**选项**：

| 选项 | 说明 |
| --- | --- |
| `--agent <name>` | 执行 Agent 名称 |
| `--template <name>` | 使用 `.agentgitops.yml` 中的任务模板 |
| `--objective <text>` | 任务目标 |
| `--base-branch <branch>` | 基线分支（默认项目配置 default_branch） |
| `--allow <paths...>` | 允许修改的路径 |
| `--forbid <paths...>` | 禁止修改的路径 |
| `--check <commands...>` | 必跑检查命令 |
| `--risk <level>` | 风险等级（low/medium/high/critical） |
| `--reviewer <users...>` | 必须 Reviewer |
| `--prompt-file <path>` | 自定义任务提示文件 |

**示例**：

```bash
agentgitops task create "Fix expired token returning 500" \
  --agent claude-code \
  --objective "修复登录 token 过期时返回 500 的问题" \
  --allow "src/auth/**" "tests/auth/**" \
  --forbid "db/migrations/**" "infra/**" \
  --check "npm test -- auth" "npm run lint" \
  --risk medium \
  --reviewer "@auth-owner"

agentgitops task create "Polish task board empty state" --template frontend
```

### 6.2 start

```bash
agentgitops task start <task-id>
```

启动任务（创建 workspace + 启动 Agent）。

### 6.3 status

```bash
agentgitops task status [task-id]
```

查看任务状态。不指定 task-id 时显示所有任务概览。

**示例输出**：

```
TASK ID                  AGENT         STATUS      RISK     FILES  PR
task-20260703-001        claude-code   reviewing   medium   2      #42
task-20260703-002        codex         running     low      -      -
task-20260703-003        opencode      testing     high     5      -
```

### 6.4 cancel

```bash
agentgitops task cancel <task-id>
```

取消任务。

### 6.5 list

```bash
agentgitops task list [options]
```

**选项**：

| 选项 | 说明 |
| --- | --- |
| `--status <status...>` | 状态过滤 |
| `--agent <name>` | Agent 过滤 |

### 6.6 adopt

```bash
agentgitops task adopt <branch-or-task> [--preview] [--force]
```

接管已有 Team Sync task / branch，生成 Handoff Package，记录 BranchAdoption，并创建本地 worktree。默认阻断已有 active adoption；需要明确覆盖时使用 `--force`。

`--preview` 只打印 handoff Markdown，不写文件、不创建 worktree。

### 6.7 continue

```bash
agentgitops task continue <task-id> [--agent <name>] [--title <title>] [--objective <text>] [--preview]
```

基于源任务分支创建新的继续开发任务和分支。`--preview` 只预览 handoff，不创建新任务。

### 6.8 closeout

```bash
agentgitops task closeout <task-id> [--mode checkpoint|pause|done|merged-direct|state-only] [--json] [--record] [--auto-fix] [--push]
```

多地协作收尾诊断。默认只检查任务是否适合离开当前地点、交给另一台机器继续或进入完成态；传入 `--auto-fix` 时会尽量生成缺失的 package/outbox 证据，传入 `--push` 时会提交并推送 task artifacts。

传入 `--record` 时，会额外写入一份 portable CloseoutRecord：

```text
.agentgitops/closeouts/<task-id>/<timestamp>-<mode>.json
```

CloseoutRecord 会包含诊断摘要、任务分支、workspace、检查结果和 `ready_for_resume` / `blocked` 状态。该文件需要随 task 分支或协作状态提交到 Git，未来云端 Control Plane 也可直接导入。

检查内容包括：

| 检查 | 说明 |
| --- | --- |
| task snapshot | `.agentgitops/tasks/<task-id>.yml` 是否存在且已提交 |
| workspace / branch | task worktree 是否存在，当前 branch 是否等于 targetBranch |
| dirty tree | workspace 是否存在未提交或未跟踪文件 |
| remote head | 本地 HEAD 是否等于本地 remote-tracking branch |
| Change Package | package 是否存在、匹配 task、未过期且已提交 |
| verification | 是否已有 VerificationStore 记录，或 Change Package 中已提交的 checks |
| sync outbox | `.agentgitops/sync/outbox` 是否有未提交同步事件 |
| closeout records | `.agentgitops/closeouts/<task-id>` 是否有未提交收尾记录 |
| handoff | checkpoint/pause/done 时是否已有 JSON 或 Markdown handoff package |

**模式**：

| 模式 | 场景 |
| --- | --- |
| `checkpoint` | 中途保存，准备换地点继续 |
| `pause` | 主动暂停当前地点开发 |
| `done` | 任务完成，要求 Change Package 和验证更完整 |
| `merged-direct` | 代码已直接进入 main，需要补状态闭环 |
| `state-only` | 无代码变更，仅同步任务或协作状态 |

**示例**：

```bash
agentgitops task closeout task-20260713-944 --mode checkpoint
agentgitops task closeout task-20260713-944 --mode checkpoint --record
agentgitops task closeout task-20260713-944 --mode checkpoint --auto-fix --push
agentgitops task closeout task-20260713-944 --mode done --json
```

### 6.9 resume

```bash
agentgitops task resume <task-id> [--recreate-worktree] [--json]
```

从最新 CloseoutRecord 恢复任务上下文，适用于公司/家里、多机器、多 Agent 继续开发。

`resume` 会检查：

- task YAML 是否存在并可加载；
- 最新 closeout record 是否可读；
- task branch 是否已经可从 base branch 到达，即 `mergedDirect=true`；
- worktree 是否存在，必要时可用 `--recreate-worktree` 重建。

当 `mergedDirect=true` 时，代表任务代码已进入 `main` 或 base branch。后续应从 base branch 继续，以 closeout record、Change Package、handoff 作为上下文证据，不要默认复活旧 task branch。

### 6.10 reconcile / sync-snapshots

```bash
agentgitops task reconcile [--dry-run] [--json]
agentgitops task sync-snapshots [--dry-run] [--json]
```

以 Git 中提交的 `.agentgitops/tasks/*.yml` 为准，检查并修复本机 SQLite 任务状态漂移。多地协作开始时建议先运行：

```bash
git pull --ff-only
agentgitops task reconcile --dry-run
agentgitops task reconcile
```

`--dry-run` 只报告 drift，不修改 SQLite；正式执行会把有 Git 快照的任务回写到本机 SQLite。SQLite-only 任务会被保留并报告，避免误删本机尚未提交的任务。

---

## 7. run — 启动 Agent 执行

```bash
agentgitops run --agent <name> --task <task-id> [options]
```

启动 Agent 执行指定任务。

**选项**：

| 选项 | 说明 |
| --- | --- |
| `--agent <name>` | Agent 名称（必填） |
| `--task <task-id>` | 任务 ID（必填） |
| `--foreground` | 前台运行，实时输出日志 |
| `--timeout <minutes>` | 超时时间 |
| `--auto-package` | 执行完成后自动生成 Change Package |
| `--auto-pr` | 自动创建 PR |

**示例**：

```bash
# 前台运行，实时查看日志
agentgitops run --agent claude-code --task task-20260703-001 --foreground

# 后台运行，完成后自动打包和创建 PR
agentgitops run --agent codex --task task-20260703-002 --auto-package --auto-pr
```

**行为**：
1. 校验任务状态为 `created` 或 `workspace_created`
2. 创建 workspace（如未创建）
3. 生成任务提示文件
4. 通过 Agent Adapter 启动 Agent
5. 实时采集日志
6. Agent 退出后触发 testing
7. （可选）自动生成 Change Package
8. （可选）自动创建 PR

---

## 8. workspace — 工作区管理

### 8.1 list

```bash
agentgitops workspace list
```

列出所有工作区。

### 8.2 open

```bash
agentgitops workspace open <task-id>
```

在文件管理器 / 终端中打开工作区目录。

### 8.3 clean

```bash
agentgitops workspace clean <task-id>
```

清理工作区（归档 worktree，保留分支）。

### 8.4 remove

```bash
agentgitops workspace remove <task-id>
```

### 8.5 sweep

```bash
agentgitops workspace sweep [--cleanup-after-days 14] [--dry-run]
```

根据 `workspace.archive_statuses` 归档已完成任务的 worktree，并在达到 `cleanup_after_days` 后清理本地 worktree。`--dry-run` 只展示将被清理的工作区，不执行删除。

移除工作区（删除 worktree 和分支）。

---

## 9. diff — 查看变更

```bash
agentgitops diff <task-id>
```

查看任务的 git diff。

**选项**：

| 选项 | 说明 |
| --- | --- |
| `--stat` | 仅显示统计信息 |
| `--file <path>` | 仅查看指定文件 |

---

## 10. test — 运行验证检查

```bash
agentgitops test <task-id>
```

运行任务的必跑检查。

---

## 11. package — 生成变更包

```bash
agentgitops package <task-id>
```

生成 Change Package。

**选项**：

| 选项 | 说明 |
| --- | --- |
| `--output <path>` | 输出文件路径 |
| `--skip-checks` | 跳过验证检查（使用已有结果） |

**示例**：

```bash
agentgitops package task-20260703-001
```

**输出**：

```
✓ Collecting git diff...
✓ Changed files: 2
✓ Running verification checks...
  ✓ npm test -- auth (passed, 12.0s)
  ✓ npm run lint (passed, 5.8s)
✓ Evaluating risk...
  Level: medium (domains: auth, api)
  High-risk files touched: yes
✓ Detecting conflicts...
  No conflicts detected
✓ Change Package generated:
  .agentgitops/packages/task-20260703-001.json
```

---

## 12. pr — 创建 PR

```bash
agentgitops pr preflight <task-id> [--real] [--no-commit] [--body-template ce|team-sync]
agentgitops pr <task-id> [--draft|--no-draft] [--no-commit] [--dry-run] [--review-context-comment] [--body-template ce|team-sync]
```

根据 Change Package 创建 PR / MR。

**选项**：

| 选项 | 说明 |
| --- | --- |
| `--draft` | 创建为 Draft PR |
| `--no-draft` | 创建为 Ready for review |
| `--no-commit` | 不在 workspace 内自动 commit |
| `--dry-run` | 只打印 PR/MR body，不 commit、不 push、不调用 Provider API |
| `--review-context-comment` | 幂等创建或更新 PR/MR 评论，内容为 Review Context Summary |
| `--body-template <template>` | PR/MR 描述模板：`ce` 为单机开源模板，`team-sync` 追加团队协作上下文 |
| `preflight --real` | 检查真实创建所需 Provider token |

**示例**：

```bash
agentgitops pr preflight task-20260703-001 --real
agentgitops pr task-20260703-001 --no-draft
agentgitops pr task-20260703-001 --dry-run --body-template team-sync
```

**行为**：
1. 自动执行 PR preflight，检查 provider、workspace、Change Package、branch、remote、Git author 和 token。
2. 若 workspace 有未提交变更，自动 commit；缺失 Git author 时会阻断并输出 `git -C <workspace> config ...` 恢复命令。
3. push agent 分支到远端。
4. 通过 Git Provider 创建或更新 PR/MR；同一 head/base 会幂等更新已有 PR/MR。
5. 在 PR 描述中写入 Change Package 摘要和 Review Context Summary，并把 PR URL/number 写回 Change Package。
6. 若传入 `--review-context-comment`，按 `<!-- agentgitops:review-context -->` marker 幂等创建或更新评论。
7. `--body-template ce` 使用当前 Change Package + Evidence 模板；`--body-template team-sync` 在当前模板后追加 Team Sync Context、Collaboration Impact、Agent Context Feed 和 Sync State。Team Sync Control Plane 尚未配置时，模板会明确显示 `local-only` / `disabled`，不会伪装成已同步。
8. 失败时按 Git identity、Git push、Provider token/API、base/head 分支等类型输出恢复建议。

`preflight` 和所有错误恢复都不会打印 token。

**模板 smoke**：

```bash
pnpm build
pnpm smoke:pr-body-template
```

该 smoke 在临时本地 Git repo 中创建任务、运行本地写文件 Agent、生成 Change Package，并分别执行 `--body-template ce` 与 `--body-template team-sync` 的 PR dry-run。它不会 commit 到远端、不会 push、不会调用 Git Provider API。

---

## 13. review — 评审

### 13.1 approve

```bash
agentgitops review approve <task-id> [options]
```

**选项**：`--comment <text>`

### 13.2 reject

```bash
agentgitops review reject <task-id> [options]
```

### 13.3 request-changes

```bash
agentgitops review request-changes <task-id> [options]
```

### 13.4 ask-fix

```bash
agentgitops review ask-fix <task-id> [options]
```

要求 Agent 修复（触发重新执行）。

### 13.5 context

```bash
agentgitops review context <task-id> [--json] [--record] [--output review-context.json]
```

生成 Review Agent 可消费的上下文，包含 Change Package、Review、Agent Notes、Audit 和审查 checklist。`--record` 会写入 `review.context.generated` 审计事件。

### 13.6 context feed

```bash
agentgitops context feed --task <task-id> [--agent codex|claude|generic] [--format json|markdown|prompt] [--compression minimal|standard|detailed] [--token-budget <count>] [--output context.md]
```

生成 Code Agent 执行前可消费的 Team Sync Context Feed。它和 `review context` 不同：

- `review context` 面向 Review Agent 和 PR/MR 审查。
- `context feed` 面向继续开发的 Code Agent，包含当前任务、团队任务摘要、Change Package 摘要、Review Context、Agent Notes、文件重叠信号和 Sync State。
- 输出前会经过 Context Feed Privacy Filter，默认脱敏 token、password、private key、JWT、GitHub token、AWS access key。
- `--format prompt` 会附加 Agent 使用边界提示，要求把 stale/inferred 信息只作为提示。

### 13.7 handoff

```bash
agentgitops handoff preview <task-id> [--type adopt|continue] [--target-task <task-id>] [--target-branch <branch>]
agentgitops handoff generate <task-id> [--type adopt|continue] [--target-task <task-id>] [--target-branch <branch>]
```

生成 Team Sync Handoff Package。交接包包含源任务、源分支、目标任务/分支、剩余工作、已知风险和 Agent Context Feed，并写入 `.agentgitops/handoffs/`。

**安全行为**：

- Handoff 内容复用 Context Feed Privacy Filter。
- 不写源码、不写完整 diff、不写原始 Prompt。
- `preview` 只打印 Markdown，不写文件。

---

## 14. merge — 合并

### 14.1 queue

```bash
agentgitops merge queue
```

查看合并队列。

### 14.2 approve

```bash
agentgitops merge approve <task-id> [options]
```

**选项**：

| 选项 | 说明 |
| --- | --- |
| `--squash` | Squash 合并 |
| `--strategy <strategy>` | GitHub 合并策略：`merge` / `squash` / `rebase` |
| `--dry-run` | 只执行 Merge Gate，不调用远端 Provider |
| `--local-only` | 只记录本地合并批准，不调用远端 Provider |

**行为**：
1. 读取 Change Package 和本地 Review 记录
2. 执行 Merge Gate：阻止失败检查、开放冲突、策略错误、拒绝/要求修改和缺失审批
3. GitHub 调用 `PUT /repos/{owner}/{repo}/pulls/{number}/merge`
4. GitLab 调用 `PUT /projects/{project}/merge_requests/{iid}/merge`
5. 合并成功后任务状态更新为 `merged` 并写入审计事件

### 14.3 block

```bash
agentgitops merge block <task-id>
```

阻止合并。

## 15. board — 看板

```bash
agentgitops board
```

在终端显示任务看板（TUI 模式）。

---

## 16. sync — 同步

```bash
agentgitops sync
agentgitops sync status [--json]
agentgitops sync push [--dry-run]
agentgitops sync pull [--dry-run]
agentgitops team init [--name <name>] [--repo <url>] [--relay <url>] [--secret <secret>] [--sync-mode local|git-native|relay|hybrid]
agentgitops team join --team-id <id> [--name <name>] [--repo <url>] [--relay <url>] [--secret <secret>] [--member <name>] [--sync-mode local|git-native|relay|hybrid]
agentgitops team conflicts [--json]
```

`agentgitops sync` 保持兼容：输出当前单机项目、任务和 Change Package 摘要，并提示 Control Plane 尚未配置。

### 16.1 team init

初始化本地 Team Sync 项目，在 `.agentgitops/db.sqlite` 中创建 `TeamProject`、`TeamMember`、`LocalHubRegistration` 和一条 `team.initialized` pending event。

**安全行为**：

- `--secret` 只用于计算本地 hash，不保存原文。
- 未传 `--secret` 时 CLI 会生成一次性 secret 并只保存 hash，不打印 secret。
- 状态输出不会打印 `teamSecretHash` 和机器指纹。

### 16.2 team join

把当前 Local Hub 加入已有 Team Sync 项目，写入本地成员、Hub 注册和 `team.joined` pending event。当前 MVP 不调用 Relay，所以 `join` 是本地注册入口，后续 TS-P0-006 Relay API 会负责远端校验。

### 16.3 sync status

```bash
agentgitops sync status
agentgitops sync status --json
```

读取本地 Team Sync 状态，包括 team、hub、member、pending events、cached synced tasks、push/pull cursor。`--json` 用于 Web/API/脚本消费，输出为脱敏后的公开视图。

### 16.4 sync push / pull

```bash
agentgitops sync push --dry-run
agentgitops sync pull --dry-run
agentgitops sync push --relay http://127.0.0.1:4318
agentgitops sync pull --relay http://127.0.0.1:4318
```

`sync push/pull` 现在支持真实 Relay 传输：

- `push --dry-run` 打印待推送事件，不改变状态。
- `push` 将 pending SyncEvent 推送到 Relay，成功后标记为 pushed 并写入 push cursor。
- `pull` 从 Relay 拉取增量事件，应用到本地 Team Sync cache，并写入 pull cursor。
- 未配置 Relay 或 Relay 不可达时，本地 pending queue 会保留，命令返回非 0。
- Relay 只传输元数据事件，不上传源码、完整 diff、Prompt、原始日志或 token。

### 16.5 team conflicts

```bash
agentgitops team conflicts
agentgitops team conflicts --json
```

基于本地 Team Sync cache 构建 Conflict Graph，并写入 `conflict_graph_edges`。当前使用元数据，不读取源码、不读取完整 diff：

- `same_file`：两个任务修改同一文件。
- `same_directory`：两个任务修改同一目录。
- `risk_domain`：两个任务有相同风险域。
- `config` / `migration` / `lockfile`：配置、迁移、锁文件等高风险路径加权。

输出包含 severity、edge type、任务对、文件/信号和合并建议。

---

## 17. server — 服务管理

### 17.1 start

```bash
agentgitops server start [options]
```

启动 Control Plane 服务。

**选项**：

| 选项 | 说明 | 默认值 |
| --- | --- | --- |
| `--port <port>` | 监听端口 | 4789 |
| `--host <host>` | 监听地址 | localhost |
| `--db <path>` | 数据库路径 | `.agentgitops/db.sqlite` |

### 17.2 stop

```bash
agentgitops server stop
```

停止服务。

---

## 18. web — 启动 Web UI

```bash
agentgitops web [options]
```

启动本地 Web UI 并自动打开浏览器。

启动前会诊断 Web 静态资源、端口合法性和 `.agentgitops.yml` 是否存在；端口占用、权限不足、资源缺失会输出 `recovery:` 建议。缺少配置只是 warning，因为 Web UI 可初始化当前项目。

**选项**：

| 选项 | 说明 | 默认值 |
| --- | --- | --- |
| `--port <port>` | 端口 | 4789 |
| `--no-open` | 不自动打开浏览器 | false |

---

## 19. audit — 审计

### 19.1 list

```bash
agentgitops audit list [options]
```

**选项**：

| 选项 | 说明 |
| --- | --- |
| `--task <task-id>` | 任务过滤 |
| `--event <type>` | 事件类型过滤 |
| `--actor <actor-id>` | Actor ID 过滤 |
| `--actor-type <type>` | Actor 类型过滤：`human` / `agent` / `system` |
| `--from <date>` | 起始时间 |
| `--to <date>` | 结束时间 |
| `--limit <count>` | 返回数量，最大 500 |

### 19.2 replay

```bash
agentgitops audit replay <task-id>
```

回放任务的完整审计链。

---

## 20. note — Agent 变更记录

### 20.1 add

```bash
agentgitops note add <task-id> \
  --agent codex \
  --summary "实现 Web Merge Queue provider merge 和恢复提示" \
  --file apps/server/src/index.ts apps/web/src/pages/MergeQueue.tsx \
  --verify "pnpm exec turbo run typecheck lint test build --force" \
  --review-focus "provider merge failure recovery" \
  --risk "真实 merge 仍依赖远端分支保护和 token 权限"
```

用于记录 Code Agent 的交接说明，方便后续 Agent 和 Review Agent 理解改动。

### 20.2 list

```bash
agentgitops note list [task-id]
```

---

## 21. MVP 关键命令

MVP 阶段最关键的命令集合：

```bash
agentgitops init
agentgitops task create
agentgitops run --agent generic --task task-001
agentgitops status
agentgitops package task-001
agentgitops pr task-001
```

---

## 22. 命令速查表

| 命令 | 说明 |
| --- | --- |
| `agentgitops init` | 初始化项目 |
| `agentgitops doctor` | 环境诊断 |
| `agentgitops agent register` | 注册 Agent |
| `agentgitops agent list` | 列出 Agent |
| `agentgitops task create` | 创建任务 |
| `agentgitops task start` | 启动任务 |
| `agentgitops task status` | 查看任务状态 |
| `agentgitops task cancel` | 取消任务 |
| `agentgitops task adopt` | 接管 Team Sync 任务分支 |
| `agentgitops task continue` | 基于已有任务继续开发 |
| `agentgitops task closeout` | 多地协作收尾诊断 |
| `agentgitops run` | 启动 Agent 执行 |
| `agentgitops workspace list` | 列出工作区 |
| `agentgitops workspace clean` | 清理工作区 |
| `agentgitops diff` | 查看变更 |
| `agentgitops test` | 运行检查 |
| `agentgitops package` | 生成变更包 |
| `agentgitops pr` | 创建 PR |
| `agentgitops pr preflight` | PR/MR 交付预检 |
| `agentgitops review approve` | 批准 |
| `agentgitops review reject` | 拒绝 |
| `agentgitops review request-changes` | 要求修改 |
| `agentgitops context feed` | 生成 Team Sync Agent Context Feed |
| `agentgitops handoff generate` | 生成 Team Sync Handoff Package |
| `agentgitops merge queue` | 查看合并队列 |
| `agentgitops merge approve` | 批准合并 |
| `agentgitops board` | 终端看板 |
| `agentgitops sync` | 同步 |
| `agentgitops sync status` | 查看本地 Team Sync 状态 |
| `agentgitops team init` | 初始化本地 Team Sync 项目 |
| `agentgitops team join` | 加入本地 Team Sync 项目 |
| `agentgitops team conflicts` | 构建并查看 Team Sync Conflict Graph |
| `agentgitops server start` | 启动服务 |
| `agentgitops web` | 启动 Web UI |
| `agentgitops audit list` | 审计查询 |
| `agentgitops audit replay` | 审计回放 |
| `agentgitops note add` | 记录 Agent 变更说明 |
| `agentgitops note list` | 查看 Agent 变更说明 |

---

## 23. 相关文档

| 文档 | 说明 |
| --- | --- |
| [`api-reference.md`](./api-reference.md) | REST API（CLI 的底层） |
| [`configuration.md`](./configuration.md) | 配置参考 |
| [`task-lifecycle.md`](./task-lifecycle.md) | 任务生命周期 |
| [`release-checklist.md`](./release-checklist.md) | 发布检查清单 |
