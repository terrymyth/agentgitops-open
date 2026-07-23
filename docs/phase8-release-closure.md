# Phase 8：Release Closure

> 启动日期：2026-07-23<br>
> 状态：进行中<br>
> 事实源：本文档和 [`v1-release-standard.md`](./v1-release-standard.md)

Phase 8 不增加新的功能面。它把已经实现的能力收口为可安装、可部署、可验证、可追溯、
可恢复的公开发行版，并固化私有研发仓库到公开发行仓库的安全交付链。

## 1. 完成定义

只有同时满足以下条件，Phase 8 才能标记完成：

1. 私有仓库变更通过私有 PR 合并，公开安全部分通过独立公开 PR 合并。
2. 五个 npm 包、CLI、Helm Chart 和 Git tag 使用同一个 SemVer。
3. 空缓存 npm 安装、Docker 真实启动、Compose 配置、Helm lint/template 全部通过。
4. 公开 tag 自动产生 npm provenance、GHCR 镜像、源码与镜像 SBOM、SHA-256 校验和和
   GitHub Artifact Attestation。
5. 公开 `main` 三平台 required checks 全绿，发布工作流只允许在
   `terrymyth/agentgitops-open` 执行。
6. Release Notes 包含安装方式、破坏性变更、已知限制、验证命令和恢复方式。
7. 发布后从 npm、GHCR 和 Helm Chart 各执行一次消费者视角验证。

## 2. 任务清单

| 编号   | 任务                       | 状态   | 验收证据                                            |
| ------ | -------------------------- | ------ | --------------------------------------------------- |
| P8-001 | 双仓与版本事实源收口       | 进行中 | 文档不再依赖 `open-source/main`；版本元数据自动校验 |
| P8-002 | npm 发布保护与 provenance  | 进行中 | 仅公开仓库 `main` 的匹配 tag 可真发布               |
| P8-003 | GHCR 镜像发布与健康检查    | 进行中 | 镜像真实启动且 `/api/health` 成功                   |
| P8-004 | Helm lint/template/package | 进行中 | Release workflow 生成 Chart 制品                    |
| P8-005 | SBOM、校验和与制品证明     | 进行中 | Release assets 可用 `gh attestation verify` 验证    |
| P8-006 | 依赖升级审查               | 待开始 | Dependabot PR 按生产/开发/重大版本分批验证          |
| P8-007 | 正式候选版本发布           | 待开始 | npm、GHCR、GitHub Release 三端消费者验证            |
| P8-008 | 目标 Kubernetes 集群 smoke | 待开始 | 部署、探针、持久卷、升级和回滚记录                  |
| P8-009 | npm OIDC 可信发布迁移      | 待开始 | 首次发布后启用 Trusted Publisher 并撤销长期 token   |

## 3. 发布顺序

```text
私有功能分支
  → 私有 PR / CI / 审查
  → 私有 main
  → 公开安全补丁或 clean cherry-pick
  → 公开 PR / CI / ruleset
  → 公开 main
  → 版本 tag
  → Release workflow
  → npm + GHCR + Helm + SBOM + Attestation
  → 消费者验证
```

禁止从私有仓库创建公开 tag、发布 npm 包或推送 GHCR 正式镜像。

## 4. 阻断条件

- 版本不一致、tag 不匹配或 npm 元数据指向私有仓库。
- 公开历史卫生检查失败。
- Docker 只能构建但不能启动。
- Helm 只能静态存在但不能 lint/template。
- npm、镜像或 Release asset 缺少校验和、SBOM 或 provenance。
- 发布凭据缺失、权限过大、写入日志，或发布来源不是公开仓库。
- npm 包已具备 Trusted Publisher 条件但仍长期依赖可复用写 token。
- 依赖重大版本升级未通过完整测试和迁移审查。

## 5. 回滚策略

- npm 已发布版本不可覆盖；发现问题后发布修复版本，必要时通过 dist-tag 撤下默认推荐。
- GHCR 镜像按不可变 digest 使用；回滚到上一个已验证 digest，不复用已发布 tag。
- Helm 使用 `helm rollback` 回到上一个 release revision。
- GitHub Release 可标记为 pre-release 或撤下，但不得重写对应 Git tag 的历史。
