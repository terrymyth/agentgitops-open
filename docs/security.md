# 安全设计（Security Design）

> 项目：agentgitops
> 版本：v0.1（设计阶段）
> 关联文档：[`architecture.md`](./architecture.md)、[`policy.md`](./policy.md)、[`adapters.md`](./adapters.md)

本文档定义 agentgitops 的安全设计，覆盖执行安全、凭证管理、Webhook 安全、审计合规、数据保护等方面。

---

## 1. 安全目标

agentgitops 作为 Code Agent 与 Git 平台之间的治理层，安全目标：

```
1. 防止 Agent 越权修改（工作区隔离 + 路径策略）
2. 防止 Agent 执行危险命令（命令策略 + 拦截）
3. 防止凭证泄露（Token 加密存储 + 环境变量过滤）
4. 防止未授权合并（Merge Gate + 审批策略）
5. 防止审计篡改（不可篡改审计日志）
6. 防止 Webhook 伪造（签名验证）
7. 防止数据丢失（备份 + 回滚）
```

---

## 2. 执行安全

### 2.1 工作区隔离

每个 Agent 任务运行在独立的 `git worktree` 中：

```
强制 chdir 到 workspace
Agent 无法访问其他任务工作区
worktree 路径不重叠
任务完成后归档 / 清理
```

### 2.2 路径策略

Policy Engine 强制路径约束：

| 约束 | 说明 |
| --- | --- |
| `forbidden_for_agents` | Agent 禁止修改的路径（密钥、生产配置） |
| `high_risk` | 高风险路径，修改需审批 |
| `allowed_paths` | Task Contract 中声明的允许修改范围 |

触碰禁止路径 → Change Package 生成失败，任务进入 `failed`。

### 2.3 命令策略

Policy Engine 监控 Agent 执行的命令：

```yaml
policies:
  commands:
    forbidden:
      - "rm -rf"
      - "git push --force"
      - "DROP TABLE"
      - "sudo"
      - "chmod 777"
```

检测到禁止命令 → 在 Agent 或 Verification Gate 启动前硬拦截，记录为失败验证或失败 Agent 运行，不执行实际命令。可选配置 `allowed` 白名单；当 `allowed` 存在时，未匹配白名单的命令同样被拒绝。

### 2.4 环境变量过滤

Adapter 启动 Agent 时，仅注入白名单环境变量：

```
注入：PATH、HOME、LANG、任务相关变量、Agent 配置变量
过滤：GITHUB_TOKEN、GITLAB_TOKEN、数据库密码、其他敏感变量
```

> Agent 不应直接获取 Git 平台 Token。PR 创建等操作由 agentgitops 代为执行。

### 2.5 超时与资源控制

| 控制项 | 默认值 | 说明 |
| --- | --- | --- |
| 任务超时 | 30 分钟 | 可配置 `limits.task_timeout_minutes` |
| 最大修改文件数 | 50 | 可配置 `limits.max_changed_files` |
| 最大新增行数 | 2000 | 可配置 `limits.max_insertions` |
| 最大删除行数 | 1000 | 可配置 `limits.max_deletions` |

### 2.6 网络限制（企业版）

Enterprise 版本可选限制 Agent 网络访问：

```
白名单域名（仅允许访问 npm registry、API 文档等）
禁止访问内网敏感服务
禁止访问元数据服务（169.254.169.254）
```

---

## 3. Team Sync 安全红线

Team Sync 是多人、多 Local Hub、多 Agent 协作的同步层。它的默认安全边界是：**同步信号，不同步代码**。

### 3.1 Relay 禁止存储

Team Relay Service 和未来 `/api/sync/*` 端点不得存储：

```
源码内容
完整 diff
Agent 原始日志
原始 Prompt
GitHub / GitLab / Gitea token
API key / password / private key
未脱敏的本地绝对路径
```

### 3.2 Relay 允许存储

Relay 仅允许存储团队协作所需的元数据信号：

```
task id / title / status / owner / agent id
base branch / target branch / branch name
changed files 路径摘要
risk level / risk domains
verification summary
review summary
conflict edge
sync cursor / event id
Context Feed metadata
```

### 3.3 Context Feed 输出规则

Agent Context Feed 必须满足：

1. 先脱敏，再压缩，再格式化。
2. 每条上下文带 `source`、`freshness`、`confidence`。
3. `stale` 或 `unverified` 信息必须显式标记。
4. Agent Note 进入 Feed 前必须经过 prompt injection 与 secret pattern 检查。
5. Feed 输出必须受 token budget 限制，超出时按 Layer 0 → Layer 1 → Layer 2 优先级裁剪。

已落地的 `ContextFeedPrivacyFilter` 位于 `packages/local-hub/src/context-feed-privacy-filter.ts`，当前覆盖：

```
password / passwd / pwd
token / access_token / api_key / secret
GitHub ghp_* / github_pat_* token
AWS AKIA / ASIA access key
JWT
private key block
```

后续 Context Feed Builder、Relay push 和 PR body data injection 都必须在输出前调用该过滤器。

### 3.4 SyncEvent 幂等与审计

Team Sync 事件必须具备：

| 要求 | 说明 |
| --- | --- |
| `event_id` | 全局唯一幂等键，重复 push 不产生重复数据 |
| `sync_cursor` | 增量拉取游标 |
| `hub_id` | 事件来源 Local Hub |
| `actor_id` | 事件触发者 |
| 审计事件 | `team.sync.push`、`team.sync.pull`、`task.adopted`、`task.continued` 等关键动作必须可追踪 |

### 3.5 Adopt / Continue 安全要求

`task adopt` 和 `task continue` 必须：

- 默认不覆盖原任务所有权。
- 记录 BranchAdoption / Handoff Package。
- 并发 adopt 使用 CAS 或 soft lock 阻断。
- 对原 owner 后续继续 push 的风险给出冲突提示。
- 不把原任务完整日志或 Prompt 注入新 Agent。

---

## 4. 凭证管理

### 4.1 Token 存储

| 部署形态 | 存储方式 |
| --- | --- |
| Local-first | 本地加密存储（OS keychain / 加密文件） |
| Team / Enterprise | 服务端加密存储（数据库加密字段） |

**Local-first 凭证存储**：

| 平台 | 存储方式 |
| --- | --- |
| macOS | Keychain |
| Linux | libsecret / 加密文件 |
| Windows | Credential Manager |

> 不在配置文件中明文存储 Token。配置文件中只引用环境变量名。

### 4.2 Token 最小权限

| Token 类型 | 最小权限范围 |
| --- | --- |
| GitHub PAT | `repo`（或更细粒度的 GitHub App 权限） |
| GitLab PAT | `api`（仅项目级） |
| Gitea Token | 项目级 Token |

建议使用 GitHub App / GitLab Project Access Token，而非个人全权限 Token。

### 4.3 Webhook Secret

Webhook Secret 用于验证 Webhook 签名，加密存储，不日志输出。

---

## 5. Webhook 安全

### 5.1 签名验证

所有 Webhook 请求必须验证签名：

| 平台 | 签名 Header | 验证方式 |
| --- | --- | --- |
| GitHub | `X-Hub-Signature-256` | HMAC-SHA256 |
| GitLab | `X-Gitlab-Token` | 直接比对 |
| Gitea | `X-Gitea-Signature` | HMAC-SHA256 |

**验证流程**：

```
1. 读取请求 body
2. 使用 webhook secret 计算签名
3. 与 header 中的签名比对
4. 不匹配 → 返回 401，记录安全事件
5. 匹配 → 处理事件
```

### 5.2 IP 白名单（可选）

Enterprise 版本可配置 Webhook 来源 IP 白名单：

| 平台 | IP 范围 |
| --- | --- |
| GitHub | https://api.github.com/meta（hooks 字段） |
| GitLab | https://gitlab.com/gitlab-org/gitlab/-/raw/master/lib/gitlab/ip_addr.rb |
| Gitea | 自建实例 IP |

### 5.3 重放攻击防护

Webhook 请求包含时间戳 / delivery ID，agentgitops 记录已处理的 delivery ID，防止重放：

```
1. 提取 delivery ID（X-GitHub-Delivery / X-Gitlab-Event-UUID）
2. 查询是否已处理
3. 已处理 → 忽略
4. 未处理 → 处理并记录
```

---

## 6. 认证与授权

### 6.1 Local-first

- 仅监听 `localhost`，不接受外部连接
- 无需认证（单用户）

### 6.2 Team / Enterprise

| 机制 | 说明 |
| --- | --- |
| 认证 | Bearer Token / SSO（OIDC / SAML） |
| 授权 | RBAC（Viewer / Developer / Reviewer / Owner / Admin） |
| Token 过期 | Token 有效期 + 刷新机制 |
| 会话管理 | 会话超时、并发会话限制 |

Enterprise HTTP API 在 OIDC IdentityProvider 注入后要求 `Authorization: Bearer <token>`。JWT 必须通过 JWKS 签名、issuer、audience 和过期时间校验；不再接受仅解码未验签的 token。认证失败返回 `401`，RBAC 拒绝返回 `403`。`/api/health`、GitHub Webhook 和带独立 HMAC 校验的 Sync 端点保持独立认证边界；已启用 Enterprise 认证的项目初始化接口也必须通过 RBAC。

EE 默认采用严格启动：PostgreSQL、OIDC、RBAC、SIEM 或合规组件初始化失败时终止启动。只有运维明确设置 `enterprise.allowCeFallback: true` 时才允许 CE 降级，并应配套监控和审计。

### 6.3 RBAC 权限矩阵

| 操作 | Viewer | Developer | Reviewer | Owner | Admin |
| --- | --- | --- | --- | --- | --- |
| 查看看板 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 创建任务 | ✗ | ✓ | ✓ | ✓ | ✓ |
| 运行 Agent | ✗ | ✓ | ✓ | ✓ | ✓ |
| 创建 PR | ✗ | ✓ | ✓ | ✓ | ✓ |
| Approve / Reject | ✗ | ✗ | ✓ | ✓ | ✓ |
| 合并授权 | ✗ | ✗ | ✗ | ✓ | ✓ |
| 策略配置 | ✗ | ✗ | ✗ | ✓ | ✓ |
| 项目管理 | ✗ | ✗ | ✗ | ✗ | ✓ |
| 用户管理 | ✗ | ✗ | ✗ | ✗ | ✓ |

---

## 7. 审计与合规

### 7.1 审计日志

所有关键操作记录为 AuditEvent，详见 [`data-model.md`](./data-model.md) 第 11 节。

**审计原则**：

```
完整性：所有关键操作必须记录
不可篡改：审计日志不可修改 / 删除
可追溯：支持按时间、任务、执行者查询
可回放：支持任务级审计回放
```

### 7.2 合规存储（Enterprise）

Enterprise 版本审计日志写入合规存储：

| 要求 | 实现 |
| --- | --- |
| 不可篡改 | append-only / WORM 存储 |
| 长期留存 | 按合规要求留存（如 1 年 / 3 年 / 7 年） |
| 防删除 | 定期归档到对象存储，设置保留策略 |
| 可导出 | 支持导出为标准格式（JSON / CSV）供审计 |

### 7.3 敏感数据脱敏

审计日志中的敏感数据脱敏：

```
Token → ***（仅保留前 4 位）
密码 → ***
密钥内容 → ***
IP 地址 → 可选脱敏
```

---

## 8. 数据保护

### 8.1 数据加密

| 数据 | 加密方式 |
| --- | --- |
| 本地数据库 | 可选 SQLCipher 加密 |
| 凭证 | OS keychain / 加密文件 |
| 日志 | 不加密（可能含敏感信息，需访问控制） |
| 传输 | HTTPS（Team / Enterprise） |

### 8.2 数据留存

| 数据 | 留存策略 |
| --- | --- |
| 任务合同 | 永久（YAML 文件） |
| Change Package | 永久（JSON 文件 + DB） |
| Agent 日志 | 可配置（默认 30 天） |
| 审计事件 | 按合规要求（默认 1 年，Enterprise 更长） |
| worktree | 任务完成后归档，可配置清理 |

### 8.3 数据删除

- 项目删除时，关联数据级联删除
- worktree 清理时，仅删除工作区文件，保留分支与记录
- 审计日志不随项目删除（合规要求）

---

## 9. 安全事件响应

### 9.1 安全事件类型

| 事件 | 说明 |
| --- | --- |
| 策略违规 | Agent 触碰禁止路径 / 执行禁止命令 |
| Webhook 伪造 | 签名验证失败 |
| 认证失败 | Token 无效 / 过期 |
| 越权访问 | RBAC 权限不足 |
| 异常合并 | 绕过 Merge Gate 的合并尝试 |

### 9.2 响应流程

```
1. 检测安全事件
2. 记录审计事件（policy.violation / security.event）
3. 拦截操作
4. 通知管理员（Team / Enterprise）
5. 可选：终止 Agent、冻结任务
```

---

## 10. 安全检查清单

部署 agentgitops 前的安全检查：

```
□ Local-first 仅监听 localhost
□ Token 使用最小权限
□ Token 不在配置文件明文存储
□ Webhook Secret 已设置
□ forbidden_for_agents 包含密钥路径
□ forbidden_commands 包含危险命令
□ 任务超时已配置
□ 变更规模限制已配置
□ 审计日志已启用
□ HTTPS 已启用（Team / Enterprise）
□ RBAC 已配置（Team / Enterprise）
□ 审计日志合规留存（Enterprise）
```

---

## 11. 已知限制

| 限制 | 说明 | 缓解 |
| --- | --- | --- |
| Agent 可读取项目内所有文件 | worktree 隔离的是写入，非读取 | 通过 Skill 指导 + 路径策略 |
| Agent 可执行任意命令（非禁止列表内） | 命令策略是黑名单 | 后续支持白名单模式 |
| 本地无认证 | Local-first 设计 | 仅监听 localhost |
| 语义冲突检测有限 | MVP 仅做文件级 | 后续增强语义检测 |

---

## 12. 相关文档

| 文档 | 说明 |
| --- | --- |
| [`policy.md`](./policy.md) | 策略引擎（路径 / 命令策略） |
| [`adapters.md`](./adapters.md) | Agent Adapter（执行安全） |
| [`git-provider-integration.md`](./git-provider-integration.md) | Webhook 安全 |
| [`data-model.md`](./data-model.md) | AuditEvent（审计事件） |
| [`configuration.md`](./configuration.md) | 安全相关配置 |
| [`git-native-sync.md`](./git-native-sync.md) | Git-native sync 安全边界与 Context Feed 防污染 |
| [`relay-deployment.md`](./relay-deployment.md) | Relay 部署与传输安全 |
