# 贡献指南（Contributing）

感谢你对 agentgitops 的关注！本文档说明如何参与项目贡献。

---

## 1. 行为准则

参与本项目即表示你同意遵守 [Code of Conduct](./CODE_OF_CONDUCT.md)。请在所有交流中保持尊重和包容。

---

## 2. 开发环境准备

### 2.1 前置要求

| 工具 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | >= 24 | 与项目 `engines.node` 保持一致 |
| pnpm | >= 9 | 包管理器 |
| Git | >= 2.30 | 需支持 worktree |
| TypeScript | >= 5.4 | 随依赖安装 |

### 2.2 安装依赖

```bash
git clone https://github.com/terrymyth/agentgitops-open.git
cd agentgitops-open
pnpm install
```

### 2.3 开发命令

```bash
# 构建
pnpm build

# 开发模式（watch）
pnpm dev

# 运行测试
pnpm test

# 运行 lint
pnpm lint

# 格式化代码
pnpm format

# 类型检查
pnpm typecheck
```

---

## 3. 项目结构

详见 [`docs/architecture.md`](./docs/architecture.md) 第 5 节。

```
agentgitops/
├─ apps/           # 应用（cli、server、web）
├─ packages/       # 核心包（core、git、local-hub、adapters、policy、verification、providers、ui）
├─ docs/           # 文档
├─ examples/       # 示例
└─ .github/        # CI 配置、Issue 模板
```

---

## 4. 贡献流程

### 4.1 找到任务

- 查看 [Issues](https://github.com/terrymyth/agentgitops-open/issues) 中标记为 `good first issue` 或 `help wanted` 的任务
- 或参考 [Issues](https://github.com/terrymyth/agentgitops-open/issues) 中的任务卡

### 4.2 创建分支

```bash
git checkout -b feat/your-feature
# 或
git checkout -b fix/your-bugfix
```

### 4.3 开发

- 遵循现有代码风格（ESLint + Prettier 已配置）
- 编写测试（Vitest）
- 更新相关文档

### 4.4 提交

使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**type 枚举**：

| type | 说明 |
| --- | --- |
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档变更 |
| `style` | 代码风格（不影响功能） |
| `refactor` | 重构 |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `chore` | 构建 / 工具链 |
| `ci` | CI 配置 |

**示例**：

```
feat(adapters): add cursor adapter
fix(git): handle worktree path with spaces
docs(api): add merge API examples
test(policy): add forbidden path tests
```

### 4.5 提交 PR

1. Push 分支到你的 fork
2. 创建 PR 到本仓库的 `main` 分支
3. 填写 PR 模板
4. 等待 Review

### 4.6 PR 要求

- [ ] 通过 CI（Linux/macOS/Windows 的 lint、typecheck、test、build 与冒烟检查）
- [ ] 包含测试（新功能必须有测试）
- [ ] 更新文档（如涉及 API / 配置变更）
- [ ] Commit 符合 Conventional Commits 规范
- [ ] PR 描述清晰
- [ ] 未提交本地运行时数据、私有路径、token、商业规划或内部 handoff 文档
- [ ] 已处理所有 Review 对话，且未通过 force-push 绕过审查记录

---

## 5. 代码规范

### 5.1 TypeScript

- 严格模式（`strict: true`）
- 优先使用类型推断，避免不必要的 `any`
- 公共 API 必须有类型声明
- 使用 `interface` 定义对象类型，`type` 定义联合 / 工具类型

### 5.2 命名

| 类型 | 规范 | 示例 |
| --- | --- | --- |
| 文件 | kebab-case | `git-service.ts` |
| 类 | PascalCase | `GitService` |
| 函数 | camelCase | `createWorktree` |
| 常量 | UPPER_SNAKE_CASE | `DEFAULT_PORT` |
| 类型 / 接口 | PascalCase | `TaskContract` |
| 枚举 | PascalCase + PascalCase 成员 | `TaskStatus.Running` |

### 5.3 测试

- 测试文件与源文件同目录，命名为 `*.test.ts`
- 使用 Vitest
- 测试覆盖核心逻辑与边界情况
- 目标覆盖率：核心包 >= 80%

```ts
import { describe, it, expect } from "vitest";
import { GitService } from "./git-service";

describe("GitService", () => {
  it("should create worktree", async () => {
    // ...
  });
});
```

---

## 6. 文档贡献

文档位于 `docs/` 目录，使用 Markdown 格式。

- 修改现有文档：直接编辑对应 `.md` 文件
- 新增文档：在 `docs/` 下创建文件，并在 `README.md` 文档表格中添加链接
- 文档语言：中文为主，代码示例与命令使用英文

---

## 7. 新增 Agent Adapter

贡献新的 Code Agent Adapter：

1. 在 `packages/adapters/src/` 下创建 `{agent-name}-adapter.ts`
2. 实现 `AgentAdapter` 接口（见 [`docs/adapters.md`](./docs/adapters.md)）
3. 在 `packages/adapters/src/index.ts` 中注册
4. 添加测试
5. 更新 [`docs/adapters.md`](./docs/adapters.md) 文档
6. 在 `examples/` 中添加配置示例

---

## 8. 新增 Git Provider

贡献新的 Git 平台 Provider：

1. 在 `packages/providers/{provider-name}/` 下创建
2. 实现 `GitProvider` 接口（见 [`docs/git-provider-integration.md`](./docs/git-provider-integration.md)）
3. 在 `provider-factory.ts` 中注册
4. 添加测试
5. 更新文档

---

## 9. Release 流程

- 版本号遵循 [Semantic Versioning](https://semver.org/)
- Release 由维护者执行
- Changelog 自动生成（基于 Conventional Commits）
- 发布前按 [`docs/release-checklist.md`](./docs/release-checklist.md) 执行验证

---

## 10. 问题与反馈

- Bug 报告：[创建 Issue](https://github.com/terrymyth/agentgitops-open/issues/new?template=bug_report.md)
- 功能建议：[创建 Issue](https://github.com/terrymyth/agentgitops-open/issues/new?template=feature_request.md)
- 安全漏洞：参见 [Security Policy](./SECURITY.md)（不公开 Issue，私下报告）

---

## 11. 许可证

贡献的代码将在 [Apache-2.0](./LICENSE) 协议下发布。提交 PR 即表示你同意该协议。
