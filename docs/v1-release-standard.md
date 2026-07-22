# v1 发布开发标准

> 状态：Release Candidate
> 生效日期：2026-07-21
> 适用范围：CE、公开的 Team/Enterprise 运行时扩展、npm 包、Docker/Helm 交付物和公开仓库 `main`

本文档是 agentgitops v1 的统一验收目标。历史功能任务标记“已完成”，不代表产品已可发布；只有下列 P0 门禁全部通过，才能将状态改为 Production Ready。

## 1. 标准目标

v1 必须达到：可安装、可启动、可恢复、可测试、可观测、可审计、权限不可绕过，且公开交付物不包含私有运行数据。任何 P0 门禁失败都必须阻断发布，不得以手工口头确认代替。

## 2. P0 发布门禁

| 领域 | 强制验收标准 | 自动化证据 |
| --- | --- | --- |
| 工具链 | Node 24 + pnpm 9，Linux/macOS/Windows 通过 | GitHub Actions 三系统矩阵 |
| 代码质量 | Lint、TypeScript、Prettier 零错误 | `pnpm lint && pnpm typecheck && pnpm format:check` |
| 测试 | 全量单测通过；Web 关键路径覆盖率达到设定阈值 | `pnpm test` + Web coverage |
| 构建 | 所有 workspace 包可从干净环境构建 | `pnpm build` |
| 包发布 | 发布 tarball 无 `workspace:*`，安装后 CLI help/version 可用 | `pnpm smoke:npm-install` |
| Schema | 真实配置和 Change Package 示例通过，非法样例被拒绝 | `pnpm validate:schemas` |
| 安全 | OIDC 验签及 issuer/audience/exp 校验；API 401/403；RBAC 无越权 | local-hub/server 安全测试 |
| 数据 | PostgreSQL ESM 加载可用；连接失败释放资源；默认禁止静默降级 | enterprise storage tests |
| 部署 | Docker 使用 Node 24 并构建正确 CLI；Compose/Helm 可渲染；健康检查可用 | `pnpm smoke:deployment`；发布前开启 real smoke |
| 兼容 | Git-native sync、PR body、Relay HMAC/cursor、multi-project isolation 通过 | 对应 smoke scripts |
| 公开卫生 | 公开分支无运行时数据、内部文档、密钥和个人绝对路径 | `pnpm validate:release -- --public` |
| 文档 | README、配置、安全、OpenAPI 与实现一致 | deployment/schema/release checks + review |

## 3. 企业级强制边界

- 启用 Enterprise OIDC 后，除健康检查、Webhook 和独立 HMAC Sync 路由外，API 必须携带有效 Bearer token。
- JWT 必须验证签名、issuer、audience 和时间声明；仅 decode 不属于认证。
- 身份主体必须来自已验证 token，不得被 body、query 或 `x-agentgitops-actor` 覆盖。
- 配置 PostgreSQL/SSO/RBAC/SIEM 后初始化失败必须停止启动。`allowCeFallback` 默认为 `false`。
- 秘密只通过环境变量或密钥管理系统注入，日志、审计和错误响应不得回显。

## 4. 完成定义

每个发布项必须同时具备：代码/配置、正常与异常路径测试、用户或运维文档、失败恢复方式、CI 门禁。仅有代码、仅有文档、仅在开发机通过，都不算完成。

## 5. 外部交付门禁

以下操作需要仓库/发布平台权限，不应由本地代码通过来替代：

1. 公开仓库 `main` 的 ruleset、PR 门禁和 required checks 已生效。
2. 公开分支在远程 CI 的完整三系统矩阵通过。
3. 候选 npm 包在空缓存环境安装成功。
4. Docker 镜像真实构建并启动，Helm chart 通过 `helm template` 及目标集群验证。
5. 发布签名、SBOM/依赖审查、镜像和 npm provenance 按发布策略完成。

这些门禁未完成前，项目状态保持 Release Candidate。

## 6. 2026-07-21 审查快照

| 项目 | 状态 | 证据 / 剩余动作 |
| --- | --- | --- |
| Lint / TypeScript / Prettier / Build | ✅ 本地通过 | 全 workspace 门禁通过 |
| 全量单测 | ✅ 本地通过 | 266 tests（含 OIDC、RBAC、PostgreSQL、Server HTTP） |
| Web 关键路径 | ✅ 本地通过 | 7 tests；statements 87.75%、branches 68.75%、functions 73.68%、lines 87.75% |
| Web 真实浏览器 | ✅ 本地通过 | Chromium 验证 Team Sync 错误/保存态和多项目添加 |
| Schema 实例 | ✅ 本地通过 | 有效配置/示例通过，非法样例被拒绝 |
| npm tarball 安装 | ✅ 本地通过 | 5 个本地 tarball 安装，CLI help/version 通过 |
| npm 发布流程 | ✅ dry-run 通过 | 5 个包逐个 `pnpm publish --dry-run`；真发布需 npm 权限 |
| 跨模块 smoke | ✅ 本地通过 | Git-native、PR body/dry-run、rebase、Team Sync E2E、Relay HMAC/cursor、multi-project |
| Compose | ✅ 本地通过 | `docker compose config --quiet` |
| Docker 真实构建 | ⚠️ 外部阻塞 | Docker Hub token 请求超时；静态检查已通过，需在可访问 Docker Hub 的 CI 重跑 |
| Helm 渲染 | ⚠️ 本机缺少工具 | Chart 静态检查通过；需在安装 Helm 的发布环境执行 |
| 公开仓库当前树卫生 | ✅ 当前分支通过 | 自动扫描禁止路径、敏感文本和绝对路径 |
| 公开仓库历史卫生 | ✅ 已建立门禁 | 要求单一独立根提交并扫描全部历史对象 |
| 远程 CI / branch protection / 真发布 | ⏳ 需平台权限 | 本地开发不能代替的最终交付门禁 |
