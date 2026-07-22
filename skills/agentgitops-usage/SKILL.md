---
name: agentgitops-usage
description: AgentGitOps 使用指南 Skill。当用户需要在某个仓库中使用 AgentGitOps 管理任务、跨机器交接、生成证据包、执行 closeout/handoff 时使用。触发词：agentgitops、ago、task create、task resume、closeout、handoff、sync push、team init、cross-machine dogfood、跨机器协作。
metadata:
  version: 1.2
---

# AgentGitOps 使用指南

## 最低版本要求

本 Skill 中标注的功能需要 AgentGitOps **最新构建版本**（2026-07-15 之后）。

如果遇到 `unknown option` 错误，说明当前安装版本较旧，需升级：

```bash
# 检查当前版本
ago --version

# 升级（重新构建并更新全局命令）
cd /path/to/agentgitops
git pull
pnpm install && pnpm build
# 全局命令会自动指向最新构建产物
```

### 版本兼容性表

| 功能 | 最低版本 | v0.1.0 fallback |
|------|----------|------------------|
| `task closeout --auto-fix` | 2026-07-14+ | 手动运行 `package` + `handoff generate` |
| `task closeout --push` | 2026-07-14+ | 手动 `git add -f .agentgitops/ && git commit && git push` |
| `sync push --auto-commit` | 2026-07-13+ | 手动 `git add -f .agentgitops/sync/outbox/ && git commit && git push` |
| `sync pull --git-pull` | 2026-07-13+ | 先 `git pull` 再 `ago sync pull` |
| `task resume --recreate-worktree` | 2026-07-14+ | 手动 `ago task start <task-id>` |
| `package --from-git-diff` | 2026-07-14+ | 需在 worktree 中运行 `ago package <task-id>` |
| `init` 自动排除 db.sqlite | 2026-07-15+ | 手动在 `.gitignore` 添加 `.agentgitops/db.sqlite` |
| SQLite warning 抑制 | 2026-07-15+ | 忽略 warning 输出 |
| Windows spawn shell 修复 | 2026-07-15+ | 直接运行项目脚本替代 `ago test` |

## 触发条件

- 用户要求在某个仓库内使用 AgentGitOps 管理任务
- 用户要求跨机器交接、生成证据包
- 用户要求执行 closeout、handoff、sync push/pull
- 用户提到 agentgitops 或 ago 命令
- 用户要求多地机器协作开发

## 强制规则：每次开发必须创建 task

**无论是修复 bug、添加功能还是更新文档，都必须通过 task 模式管理。**

完整流程：
```bash
# 1. 创建 task
agentgitops task create "<描述>" --agent <agent> --allow <paths> --check <checks> --objective "<目标>"

# 2. 启动 task（创建 worktree）
agentgitops task start <task-id>

# 3. 在 worktree 中开发
# ...编辑代码...
git -C <worktree> add <files>
git -C <worktree> commit -m "<message>"

# 4. 生成证据
agentgitops package <task-id> --from-git-diff
agentgitops handoff generate <task-id>

# 5. 收尾
agentgitops task closeout <task-id> --auto-fix --push --record
agentgitops sync push --auto-commit --cleanup
```

**例外**：仅文档拼写修正等微小改动（<5 行）可直接在 main 上提交。

## 强制流程顺序（关键！）

**必须按此顺序执行，否则会失败：**

```
1. agentgitops init              # 初始化项目配置
2. agentgitops project add       # 注册到项目列表
3. agentgitops team init         # 初始化 Team Sync（必须在 task create 之前！）
4. agentgitops agent register    # 注册 code agent
5. agentgitops task create       # 创建任务
6. agentgitops task start        # 创建 worktree
7. ...开发...
8. agentgitops package           # 生成 Change Package
9. agentgitops handoff generate  # 生成 handoff（需要 Team Sync 已初始化）
10. agentgitops task closeout    # 执行 closeout
11. agentgitops sync push        # 同步到远端
```

## 正确 CLI 选项速查

### task create

```bash
agentgitops task create "<title>" \
  --agent <agent-name> \
  --risk <low|medium|high|critical> \
  --allow "path1/**" "path2/**" \      # 注意是 --allow 不是 --allowed-path
  --check "cmd1" "cmd2" \              # 注意是 --check 不是 --required-check
  --objective "<objective>"
```

### team init

```bash
agentgitops team init --name <team-name> --sync-mode git-native
# 如果有 Git remote，自动获取 repo URL
# 无需 --relay-url 和 --secret（git-native 模式不需要）
```

### task closeout（一键收尾）

```bash
agentgitops task closeout <task-id> \
  --mode checkpoint \
  --record \
  --auto-fix \        # 自动生成 package/handoff/outbox
  --push              # 自动 git add -f + commit + push
```

### sync push（一键同步）

```bash
agentgitops sync push --auto-commit --cleanup
# --auto-commit: 导出 + git add -f + commit + push
# --cleanup: push 后清理 outbox 事件文件
```

### sync pull（一键拉取）

```bash
agentgitops sync pull --git-pull
# --git-pull: 先 git pull 再导入 outbox 事件
```

### task resume（跨机器恢复）

```bash
agentgitops task resume <task-id> --recreate-worktree
# 从最新 closeout 记录恢复任务上下文
# --recreate-worktree: 重建 worktree
```

### package（跨机器生成）

```bash
agentgitops package <task-id> --from-git-diff
# 无需 worktree，从 git diff baseBranch..targetBranch 生成
```

## 平台差异处理

### Windows 注意事项

1. **`agentgitops test` 在 Windows 上可能失败**：Node.js `spawn` 不解析 `.cmd` 扩展名
   - 替代方案：直接在 worktree 中运行 `npm run typecheck && npm test && npm run build`
   - 已修复：最新版本对非路径命令启用 shell 模式

2. **路径分隔符**：Windows 用 `\`，跨机器时用 `/`

3. **SQLite ExperimentalWarning**：已抑制，不会出现在 CLI 输出中

## 元数据提交规则

1. **`agentgitops init` 自动在 `.gitignore` 中排除**：
   - `.agentgitops/db.sqlite`
   - `.agentgitops/logs/`
   - `.agentgitops/sync/applied.json`
   - `.agentgitops-worktrees/`

2. **closeout 后需要手动提交**（或用 `--push` 自动提交）：
   ```bash
   git add .agentgitops.yml .agentgitops/
   git commit -m "chore: agentgitops task artifacts"
   ```

3. **db.sqlite 必须排除**：它是本地运行时数据，不同步

## 错误恢复手册

### 问题：task create 使用了错误的选项名

- 错误：`--allowed-path`、`--required-check`
- 正确：`--allow`、`--check`

### 问题：handoff generate 失败 "Team Sync is not initialized"

- 根因：Team Sync 未初始化，或在 task create 之后才初始化
- 修复：先 `agentgitops team init --sync-mode git-native`，再创建新 task
- 如果 task 已创建但未 synced，重建 task 并 cherry-pick 代码

### 问题：spawn npm ENOENT（Windows）

- 根因：Node.js spawn 不解析 .cmd 扩展名
- 修复：已修复，直接运行项目脚本替代 `agentgitops test`

### 问题：closeout 产生的元数据未提交

- 修复：`agentgitops task closeout <task-id> --push` 自动提交
- 或手动：`git add .agentgitops/ && git commit && git push`

## End-Of-Location Checklist

离开当前地点前，确认以下 13 项：

1. [ ] 所有代码已提交到 task 分支
2. [ ] task 分支已 push 到远端
3. [ ] Change Package 已生成（`agentgitops package`）
4. [ ] Handoff 已生成（`agentgitops handoff generate`）
5. [ ] Closeout 已执行（`agentgitops task closeout --record`）
6. [ ] Closeout 记录已提交到 Git
7. [ ] Sync outbox 已导出（`agentgitops sync push`）
8. [ ] main 分支的 `.agentgitops/` 元数据已提交
9. [ ] main 分支已 push 到远端
10. [ ] `agentgitops task closeout` 无 error 级别问题
11. [ ] 没有 token/密钥泄露在 outbox 中
12. [ ] Worktree 已清理或已记录路径
13. [ ] 交接文档已写入或更新

## 参考文档

- [`docs/cross-machine-collaboration-guide.md`](../../docs/cross-machine-collaboration-guide.md)：通用多地协作操作手册（三种模式）
- [`docs/kateagent-agentgitops-code-agent-prompt.md`](../../docs/kateagent-agentgitops-code-agent-prompt.md)：kateagent 专属操作手册
- [`docs/multi-location-dogfood-plan.md`](../../docs/multi-location-dogfood-plan.md)：多地点 dogfood 完整规划
- [`docs/cli-reference.md`](../../docs/cli-reference.md)：CLI 命令参考
- [`docs/configuration.md`](../../docs/configuration.md)：配置参考
