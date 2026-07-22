# Git 平台集成（Git Provider Integration）

> 项目：agentgitops
> 版本：v0.1（设计阶段）
> 关联文档：[`architecture.md`](./architecture.md)、[`api-reference.md`](./api-reference.md)、[`security.md`](./security.md)

本文档定义 agentgitops 与 Git 托管平台（GitHub、GitLab、Gitea、Gerrit）的集成方式，包括 API 调用、Webhook 处理、PR/MR 创建与状态同步。

---

## 1. 设计原则

agentgitops 不替代 Git 平台，而是通过 API / Webhook 集成现有平台：

```
agentgitops
  ↓ API 调用
GitHub / GitLab / Gitea / Gerrit
  ↓ Webhook 回调
agentgitops
```

| 集成方向 | 机制 | 用途 |
| --- | --- | --- |
| agentgitops → Git 平台 | REST API | 创建分支、push、创建 PR、合并、读取状态 |
| Git 平台 → agentgitops | Webhook | 同步 PR 状态、CI 状态、Review 状态 |

---

## 2. Provider 抽象

所有 Git 平台集成实现统一接口：

```ts
interface GitProvider {
  readonly name: "github" | "gitlab" | "gitea" | "gerrit";

  /** 推送分支到远端 */
  pushBranch(params: PushParams): Promise<PushResult>;

  /** 创建 PR / MR */
  createPullRequest(params: CreatePRParams): Promise<PRResult>;

  /** 获取 PR / MR 状态 */
  getPullRequest(repo: string, prNumber: number): Promise<PRResult>;

  /** 更新 PR / MR 描述 */
  updatePullRequest(repo: string, prNumber: number, body: string): Promise<void>;

  /** 合并 PR / MR */
  mergePullRequest(repo: string, prNumber: number, strategy: MergeStrategy): Promise<MergeResult>;

  /** 添加 Review 评论 */
  addReviewComment(repo: string, prNumber: number, comment: string): Promise<void>;

  /** 获取 CI 检查状态 */
  getCheckStatuses(repo: string, branch: string): Promise<CheckStatus[]>;

  /** 验证 Webhook 签名 */
  verifyWebhook(headers: Record<string, string>, body: string): boolean;

  /** 解析 Webhook 事件 */
  parseWebhookEvent(headers: Record<string, string>, body: string): WebhookEvent | null;
}

interface CreatePRParams {
  repo: string;            // 如 "org/demo-web"
  title: string;
  body: string;            // PR 描述（含 Change Package 摘要）
  headBranch: string;      // 源分支
  baseBranch: string;      // 目标分支
  draft?: boolean;
}

interface PRResult {
  number: number;
  url: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
}

interface MergeStrategy {
  method: "merge" | "squash" | "rebase";
}
```

---

## 3. GitHub 集成

### 3.1 认证

使用 Personal Access Token（PAT）或 GitHub App：

```
GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

或 GitHub App：

```
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY_PATH=/path/to/key.pem
GITHUB_INSTALLATION_ID=789
```

### 3.2 API 调用

| 操作 | GitHub API |
| --- | --- |
| 创建 PR | `POST /repos/{owner}/{repo}/pulls` |
| 获取 PR | `GET /repos/{owner}/{repo}/pulls/{pr_number}` |
| 更新 PR | `PATCH /repos/{owner}/{repo}/pulls/{pr_number}` |
| 合并 PR | `PUT /repos/{owner}/{repo}/pulls/{pr_number}/merge` |
| 添加评论 | `POST /repos/{owner}/{repo}/pulls/{pr_number}/comments` |
| 获取检查状态 | `GET /repos/{owner}/{repo}/commits/{ref}/check-runs` |

### 3.3 Webhook

**本地服务配置**：启动 `agentgitops web` 或 server 前设置 secret。服务端只检查环境变量是否存在，不会持久化 secret。

```bash
export AGENTGITOPS_GITHUB_WEBHOOK_SECRET="replace-with-random-secret"
# 兼容变量名：
# export GITHUB_WEBHOOK_SECRET="replace-with-random-secret"
```

可以用下面的方式生成随机 secret：

```bash
openssl rand -hex 32
```

**GitHub 仓库配置**：在 GitHub 仓库 Settings → Webhooks 中添加：

```
Payload URL: https://{control-plane}/api/webhooks/github
Content type: application/json
Secret: 与 AGENTGITOPS_GITHUB_WEBHOOK_SECRET 相同
Events:
  - Pull requests
  - Pull request reviews
  - Check runs
  - Check suites
  - Pushes
```

本地开发时 GitHub 无法直接访问 `localhost`，需要用 ngrok、cloudflared、反向代理或部署环境暴露 HTTPS 地址，例如：

```
https://example-tunnel.ngrok-free.app/api/webhooks/github
```

`agentgitops doctor` 会检查 `GITHUB_TOKEN`/`GH_TOKEN` 与 webhook secret 是否配置，但不会打印 secret 值。

**签名验证**：

```
Header: X-Hub-Signature-256: sha256=<hmac>
```

验证方式：使用 webhook secret 计算 HMAC-SHA256，与 header 比对。

**事件处理**：

| GitHub Event | Action | agentgitops 处理 |
| --- | --- | --- |
| `pull_request` | `opened` / `synchronized` | 更新 PR 状态 |
| `pull_request` | `closed` (merged=true) | 触发合并完成流程 |
| `pull_request` | `closed` (merged=false) | 标记为 rejected |
| `pull_request_review` | `submitted` | 同步 Review 状态 |
| `check_run` | `completed` | 同步 CI 状态 |
| `check_suite` | `completed` | 同步 CI 套件状态 |
| `push` | - | 检测主干变更，触发冲突重检 |

---

## 4. GitLab 集成

### 4.1 认证

使用 Personal Access Token：

```
GITLAB_TOKEN=glpat-xxxxxxxxxxxx
GITLAB_HOST=https://gitlab.com   # 或自建实例地址
```

### 4.2 API 调用

| 操作 | GitLab API |
| --- | --- |
| 创建 MR | `POST /projects/{id}/merge_requests` |
| 获取 MR | `GET /projects/{id}/merge_requests/{mr_iid}` |
| 更新 MR | `PUT /projects/{id}/merge_requests/{mr_iid}` |
| 合并 MR | `PUT /projects/{id}/merge_requests/{mr_iid}/merge` |
| 添加评论 | `POST /projects/{id}/merge_requests/{mr_iid}/notes` |
| 获取流水线状态 | `GET /projects/{id}/pipelines` |

> GitLab Merge Request API 支持自动化代码审查流程、连接外部工具，并可基于外部数据更新、批准、合并或阻止 MR。

### 4.3 Webhook

**配置**：在 GitLab 项目 Settings → Webhooks 中添加：

```
URL: https://{control-plane}/api/webhooks/gitlab
Secret token: {webhook_secret}
Triggers:
  - Merge request events
  - Pipeline events
  - Push events
```

**签名验证**：

```
Header: X-Gitlab-Token: {webhook_secret}
```

验证方式：直接比对 token。

**事件处理**：

| GitLab Event | agentgitops 处理 |
| --- | --- |
| Merge Request Hook | 更新 MR 状态 |
| Pipeline Hook | 同步 CI 状态 |
| Push Hook | 检测主干变更 |

---

## 5. Gitea 集成

### 5.1 认证

```
GITEA_TOKEN=xxxxxxxxxxxx
GITEA_HOST=https://gitea.example.com
```

### 5.2 API 调用

Gitea API 与 GitHub 高度兼容：

| 操作 | Gitea API |
| --- | --- |
| 创建 PR | `POST /repos/{owner}/{repo}/pulls` |
| 获取 PR | `GET /repos/{owner}/{repo}/pulls/{index}` |
| 合并 PR | `POST /repos/{owner}/{repo}/pulls/{index}/merge` |

### 5.3 Webhook

```
URL: https://{control-plane}/api/webhooks/gitea
Content type: application/json
Secret: {webhook_secret}
Events: Pull request, Push, Check run
```

**签名验证**：

```
Header: X-Gitea-Signature: <hmac>
```

---

## 6. PR 创建流程

```
1. agentgitops pr task-id
2. 校验 Change Package 已生成
3. GitService.commit（在 agent 分支提交变更）
4. GitService.push（push agent 分支到远端）
5. GitProvider.createPullRequest
   - title: "[agent:{agent_name}] {task_title}"
   - body: Change Package 摘要（见 change-package.md PR 描述模板）
   - head: agent 分支
   - base: base_branch
6. 更新 ChangePackage.prUrl / prNumber
7. 记录审计事件 pr.created
8. 输出 PR 链接
```

---

## 7. PR 描述注入

创建 PR 时，agentgitops 在 PR 描述中写入 Change Package 摘要，让 Reviewer 在 Git 平台原生界面也能看到完整证据。

详见 [`change-package.md`](./change-package.md) PR 描述模板。

> 若 PR 已存在描述，agentgitops 会在描述前追加 `## 🤖 Agent Change Package` 段落，保留原有内容。

---

## 8. 状态同步

agentgitops 通过 Webhook 与 Git 平台保持状态同步：

```
Git 平台 PR 状态变更
  → Webhook 通知 agentgitops
  → 更新 Task / ChangePackage 状态
  → 推送到 Web UI（WebSocket / SSE）
```

| Git 平台状态 | agentgitops Task 状态 |
| --- | --- |
| PR opened | reviewing |
| PR checks pending | testing |
| PR checks passed | reviewing |
| PR checks failed | failed / 回到 running（自动修复） |
| PR approved | 进入 Merge Queue |
| PR merged | merged |
| PR closed (not merged) | failed / canceled |
| PR changes requested | 回到 running |

---

## 9. CI 状态集成

agentgitops 不替代 CI，但会同步 CI 状态：

```
Git 平台 CI（GitHub Actions / GitLab CI / Gitea Actions）
  → Webhook 通知 CI 结果
  → agentgitops 记录 CheckStatus
  → Verification Gate 参考 CI 结果
```

| CI 状态 | agentgitops 处理 |
| --- | --- |
| pending | 等待 |
| success | 标记检查通过 |
| failure | 标记检查失败，阻止合并 |
| neutral | 忽略 |

---

## 10. 多平台支持策略

```
packages/providers/
├─ github/
│  ├─ github-provider.ts
│  └─ github-webhook.ts
├─ gitlab/
│  ├─ gitlab-provider.ts
│  └─ gitlab-webhook.ts
├─ gitea/
│  ├─ gitea-provider.ts
│  └─ gitea-webhook.ts
└─ provider-factory.ts
```

### 10.1 Provider 工厂

```ts
function createProvider(config: GitConfig): GitProvider {
  switch (config.provider) {
    case "github": return new GitHubProvider(config);
    case "gitlab": return new GitLabProvider(config);
    case "gitea": return new GiteaProvider(config);
    case "local": return new LocalGitProvider(config);
    default: throw new Error(`Unknown provider: ${config.provider}`);
  }
}
```

### 10.2 MVP 优先级

```
1. GitHub（MVP）
2. GitLab（Phase 3+）
3. Gitea（后续）
4. Gerrit（后续，change-based 模型不同）
```

---

## 11. 错误处理

| 场景 | 处理 |
| --- | --- |
| Token 无效 | `doctor` 检测，提示更新 Token |
| API 限流 | 指数退避重试 |
| PR 创建失败 | 记录错误，任务进入 `failed` |
| Webhook 签名验证失败 | 拒绝请求，记录安全事件 |
| Webhook 事件丢失 | 定期轮询 PR 状态补偿同步 |

---

## 12. 相关文档

| 文档 | 说明 |
| --- | --- |
| [`architecture.md`](./architecture.md) | 技术架构（Provider 在架构中的位置） |
| [`api-reference.md`](./api-reference.md) | Webhook API |
| [`change-package.md`](./change-package.md) | PR 描述模板 |
| [`security.md`](./security.md) | Token 存储与 Webhook 安全 |
| [`configuration.md`](./configuration.md) | git 段配置 |
